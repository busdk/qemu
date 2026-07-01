#!/usr/bin/env node
/*
 * Prove the browser persistent-disk block contract with native QEMU.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-native-persistent-disk-proof.mjs [OPTIONS]

Options:
  --kernel FILE       64-bit Linux bzImage
  --cpu MODEL         Optional guest CPU model passed to QEMU
  --machine MACHINE   Native QEMU machine (default: microvm,acpi=off)
  --memory SIZE       Guest memory size (default: 512M)
  --out FILE          Write proof JSON to FILE
  --persistent-disk-device KIND
                     Persistent disk device kind: virtio-mmio or virtio-pci
  --persistent-disk-path FILE
                     Writable raw disk path reused between write and verify
  --persistent-disk-size-bytes N
                     Persistent disk size when FILE does not exist
  --qemu-system FILE  Native qemu-system-x86_64 binary
  --rootfs FILE       Immutable raw root filesystem image exposed as /dev/vda
  --rootfs-device KIND
                     Rootfs block device kind: virtio-mmio or virtio-pci
  --timeout-ms MS     Timeout for each native QEMU run
  --verify-initrd FILE
                     Initramfs that verifies the persistent disk payload
  --write-initrd FILE Initramfs that writes the persistent disk payload
  --help              Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    cpu: null,
    kernel: null,
    machine: "microvm,acpi=off",
    memory: "512M",
    out: null,
    persistentDiskDevice: "virtio-mmio",
    persistentDiskPath: null,
    persistentDiskSizeBytes: 1024 * 1024,
    qemuSystem: "qemu-system-x86_64",
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    timeoutMs: 180000,
    verifyInitrd: null,
    writeInitrd: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cpu") {
      options.cpu = argv[++i];
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
    } else if (arg === "--machine") {
      options.machine = argv[++i];
    } else if (arg === "--memory") {
      options.memory = argv[++i];
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--persistent-disk-device") {
      options.persistentDiskDevice = argv[++i];
    } else if (arg === "--persistent-disk-path") {
      options.persistentDiskPath = argv[++i];
    } else if (arg === "--persistent-disk-size-bytes") {
      options.persistentDiskSizeBytes = Number(argv[++i]);
    } else if (arg === "--qemu-system") {
      options.qemuSystem = argv[++i];
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--verify-initrd") {
      options.verifyInitrd = argv[++i];
    } else if (arg === "--write-initrd") {
      options.writeInitrd = argv[++i];
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  validateOptions(options);
  return options;
}

export function validateOptions(options) {
  for (const field of ["kernel", "rootfs", "verifyInitrd", "writeInitrd"]) {
    if (options[field] === null || options[field] === "") {
      throw new Error(`--${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
    }
  }
  if (options.qemuSystem === null || options.qemuSystem === "") {
    throw new Error("--qemu-system is required");
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.rootfsDevice)) {
    throw new Error("--rootfs-device must be virtio-mmio or virtio-pci");
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.persistentDiskDevice)) {
    throw new Error("--persistent-disk-device must be virtio-mmio or virtio-pci");
  }
  if (!Number.isInteger(options.persistentDiskSizeBytes) || options.persistentDiskSizeBytes <= 0) {
    throw new Error("--persistent-disk-size-bytes must be a positive integer");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
}

async function requireReadable(path, label) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${label} is not readable: ${path}`);
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function blockDeviceArgs(kind, id, path, device, readOnly) {
  const drive = `file=${path},format=raw,if=none,id=${id}${readOnly ? ",readonly=on" : ""}`;
  if (kind === "virtio-mmio") {
    return ["-drive", drive, "-device", `virtio-blk-device,drive=${id}`];
  }
  return ["-drive", drive, "-device", `virtio-blk-pci,drive=${id}`];
}

function phaseExpectedText(phase) {
  return phase === "write"
    ? "QEMU_WASM_PERSISTENT_DISK_WRITE_OK"
    : "QEMU_WASM_PERSISTENT_DISK_VERIFY_OK";
}

async function runQemuPhase(options, phase, initrd, persistentDiskPath) {
  const expectedText = phaseExpectedText(phase);
  const kernelAppend = "console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1";
  const args = [
    "-M", options.machine,
    "-m", options.memory,
    "-accel", "tcg,thread=single",
    "-nographic",
    "-no-reboot",
    "-serial", "mon:stdio",
    "-monitor", "none",
    "-kernel", options.kernel,
    "-initrd", initrd,
    "-append", kernelAppend,
    ...blockDeviceArgs(options.rootfsDevice, "hd0", options.rootfs, "/dev/vda", true),
    ...blockDeviceArgs(options.persistentDiskDevice, "hd1", persistentDiskPath, "/dev/vdb", false),
  ];
  if (options.cpu !== null) {
    args.splice(4, 0, "-cpu", options.cpu);
  }

  const startTime = Date.now();
  let markerSeen = false;
  let expectedTextSeen = false;
  let timedOut = false;
  let outputBytes = 0;
  let outputSuppressed = false;
  let lines = 0;
  let lastLine = "";
  let lineBuffer = "";
  let recentText = "";
  const tail = [];

  return new Promise((resolvePhase, rejectPhase) => {
    const child = spawn(options.qemuSystem, args, { stdio: ["ignore", "pipe", "pipe"] });
    let hardKill = null;
    let completed = false;

    function finish(code, signal) {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timeout);
      clearTimeout(hardKill);
      const success = !timedOut && markerSeen && expectedTextSeen;
      resolvePhase({
        format: 1,
        phase,
        success,
        status: code,
        signal,
        timedOut,
        marker: "QEMU_WASM_LINUX_BOOT_OK",
        markerSeen,
        expectText: expectedText,
        expectedTextSeen,
        elapsedMs: Date.now() - startTime,
        timeoutMs: options.timeoutMs,
        outputBytes,
        outputSuppressed,
        lines,
        lastLine,
        serialTail: tail,
      qemuSystem: options.qemuSystem,
      cpu: options.cpu,
      qemuArgs: args,
      });
    }

    function maybeComplete() {
      if (!markerSeen || !expectedTextSeen || completed) {
        return;
      }
      child.kill("SIGKILL");
      finish(null, "SIGKILL");
    }

    function recordLine(line) {
      const cleanLine = line.replace(/\r$/, "");
      if (cleanLine === "") {
        return;
      }
      lines += 1;
      lastLine = cleanLine;
      tail.push(cleanLine);
      while (tail.length > 80) {
        tail.shift();
      }
      if (cleanLine.includes("QEMU_WASM_LINUX_BOOT_OK")) {
        markerSeen = true;
      }
      if (cleanLine.includes(expectedText)) {
        expectedTextSeen = true;
      }
    }

    function emit(chunk, stream) {
      const text = chunk.toString("utf8");
      recentText = `${recentText}${text}`.slice(-8192);
      if (recentText.includes("QEMU_WASM_LINUX_BOOT_OK")) {
        markerSeen = true;
      }
      if (recentText.includes(expectedText)) {
        expectedTextSeen = true;
      }
      outputBytes += Buffer.byteLength(text);
      if (outputBytes <= 60000) {
        stream.write(text);
      } else if (!outputSuppressed) {
        outputSuppressed = true;
        stream.write("\nwasm-native-persistent-disk-proof: output suppressed after 60000 bytes\n");
      }
      lineBuffer += text;
      const completeLines = lineBuffer.split(/\n/);
      lineBuffer = completeLines.pop() || "";
      for (const line of completeLines) {
        recordLine(line);
      }
      maybeComplete();
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => emit(chunk, process.stdout));
    child.stderr.on("data", (chunk) => emit(chunk, process.stderr));
    child.on("error", rejectPhase);
    child.on("exit", finish);
  });
}

export function resultPassed(result) {
  return Boolean(
    result &&
    result.write &&
    result.write.success &&
    result.write.persistentDiskState &&
    result.write.persistentDiskState.loadSource === "empty" &&
    result.verify &&
    result.verify.success &&
    result.verify.persistentDiskState &&
    result.verify.persistentDiskState.loadSource === "file" &&
    result.immutableRootfs &&
    result.immutableRootfs.unchanged &&
    result.persistentDisk &&
    result.persistentDisk.sha256AfterWrite === result.persistentDisk.sha256AfterVerify &&
    result.persistentDisk.sha256BeforeWrite !== result.persistentDisk.sha256AfterWrite,
  );
}

async function run() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage(2);
  }

  await requireReadable(options.kernel, "kernel");
  await requireReadable(options.rootfs, "rootfs");
  await requireReadable(options.writeInitrd, "write initrd");
  await requireReadable(options.verifyInitrd, "verify initrd");

  const temporaryDir = options.persistentDiskPath === null;
  const scratchDir = temporaryDir ? await mkdtemp(join(tmpdir(), "qemu-native-persistent-disk-")) : null;
  const persistentDiskPath = options.persistentDiskPath || join(scratchDir, "persistent.raw");
  await mkdir(dirname(resolve(persistentDiskPath)), { recursive: true });

  const writeDiskExisted = await fileExists(persistentDiskPath);
  if (!writeDiskExisted) {
    await writeFile(persistentDiskPath, "");
    await truncate(persistentDiskPath, options.persistentDiskSizeBytes);
  }

  const rootfsBefore = await sha256File(options.rootfs);
  const persistentBeforeWrite = await sha256File(persistentDiskPath);

  try {
    const write = await runQemuPhase(options, "write", options.writeInitrd, persistentDiskPath);
    write.persistentDiskState = {
      path: persistentDiskPath,
      loadSource: writeDiskExisted ? "file" : "empty",
      sizeBytes: (await stat(persistentDiskPath)).size,
    };
    const persistentAfterWrite = await sha256File(persistentDiskPath);
    const verify = await runQemuPhase(options, "verify", options.verifyInitrd, persistentDiskPath);
    verify.persistentDiskState = {
      path: persistentDiskPath,
      loadSource: "file",
      sizeBytes: (await stat(persistentDiskPath)).size,
    };
    const persistentAfterVerify = await sha256File(persistentDiskPath);
    const rootfsAfter = await sha256File(options.rootfs);
    const result = {
      format: 1,
      passed: false,
      proof: "native-qemu-persistent-disk",
      qemuSystem: options.qemuSystem,
      cpu: options.cpu,
      machine: options.machine,
      rootfsDevice: options.rootfsDevice,
      persistentDiskDevice: options.persistentDiskDevice,
      write,
      verify,
      immutableRootfs: {
        path: options.rootfs,
        sha256Before: rootfsBefore,
        sha256After: rootfsAfter,
        unchanged: rootfsBefore === rootfsAfter,
      },
      persistentDisk: {
        path: persistentDiskPath,
        sizeBytes: options.persistentDiskSizeBytes,
        sha256BeforeWrite: persistentBeforeWrite,
        sha256AfterWrite: persistentAfterWrite,
        sha256AfterVerify: persistentAfterVerify,
      },
    };
    result.passed = resultPassed(result);
    const output = JSON.stringify(result, null, 2);
    console.log(output);
    if (options.out !== null) {
      await writeFile(options.out, `${output}\n`);
    }
    if (!result.passed) {
      process.exitCode = 1;
    }
  } finally {
    if (temporaryDir) {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === THIS_FILE) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
