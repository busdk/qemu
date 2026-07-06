#!/usr/bin/env node
/*
 * Prove that the QEMU WebAssembly browser persistent disk survives restart.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { installSignalCleanup } from "./wasm-playwright-loader.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-persistent-disk-proof.mjs [OPTIONS]

Options:
  --artifact-dir DIR  Directory containing qemu-system-*.js/.wasm artifacts
  --browser NAME      Browser engine to launch (default: chromium)
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --host HOST         Bind address for the local smoke server
  --kernel FILE       64-bit Linux bzImage
  --out FILE          Write proof JSON to FILE
  --persistent-disk-device KIND
                     Persistent disk device kind: virtio-mmio or virtio-pci
  --persistent-disk-opfs-name NAME
                     OPFS file name used by the persistent disk
  --persistent-disk-size-bytes N
                     Persistent disk size when no OPFS image exists
  --port PORT         Local smoke server port
  --rootfs FILE       Immutable raw root filesystem image exposed as /dev/vda
  --rootfs-device KIND
                     Rootfs block device kind: virtio-mmio or virtio-pci
  --timeout-ms MS     Timeout for each browser smoke run
  --user-data-dir DIR Browser profile directory reused for restart proof
  --verify-initrd FILE
                     Initramfs that verifies the persistent disk payload
  --write-initrd FILE Initramfs that writes the persistent disk payload
  --help              Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    artifactDir: null,
    browser: "chromium",
    firmwareDir: "pc-bios",
    host: "127.0.0.1",
    kernel: null,
    out: null,
    persistentDiskDevice: "virtio-mmio",
    persistentDiskOpfsName: "qemu-wasm-persistent-proof.raw",
    persistentDiskSizeBytes: 1024 * 1024,
    port: 8010,
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    timeoutMs: 180000,
    userDataDir: null,
    verifyInitrd: null,
    writeInitrd: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
    } else if (arg === "--browser") {
      options.browser = argv[++i];
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--persistent-disk-device") {
      options.persistentDiskDevice = argv[++i];
    } else if (arg === "--persistent-disk-opfs-name") {
      options.persistentDiskOpfsName = argv[++i];
    } else if (arg === "--persistent-disk-size-bytes") {
      options.persistentDiskSizeBytes = Number(argv[++i]);
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--user-data-dir") {
      options.userDataDir = argv[++i];
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
  for (const field of ["artifactDir", "kernel", "rootfs", "verifyInitrd", "writeInitrd"]) {
    if (options[field] === null || options[field] === "") {
      throw new Error(`--${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
    }
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.rootfsDevice)) {
    throw new Error("--rootfs-device must be virtio-mmio or virtio-pci");
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.persistentDiskDevice)) {
    throw new Error("--persistent-disk-device must be virtio-mmio or virtio-pci");
  }
  if (options.persistentDiskOpfsName === "" || /[\\/]/.test(options.persistentDiskOpfsName)) {
    throw new Error("--persistent-disk-opfs-name must be a non-empty file name without path separators");
  }
  if (!Number.isInteger(options.persistentDiskSizeBytes) || options.persistentDiskSizeBytes <= 0) {
    throw new Error("--persistent-disk-size-bytes must be a positive integer");
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolveDone) => {
    child.once("exit", resolveDone);
    setTimeout(resolveDone, 1000);
  });
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolveDone) => {
      child.once("exit", resolveDone);
      setTimeout(resolveDone, 1000);
    });
  }
}

async function runCommand(argv, activeChild = null) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(process.execPath, argv, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (activeChild !== null) {
      activeChild.child = child;
    }
    child.on("exit", (code, signal) => {
      if (activeChild !== null && activeChild.child === child) {
        activeChild.child = null;
      }
      if (code === 0) {
        resolveCommand();
      } else {
        rejectCommand(new Error(`${argv[0]} failed: code=${code} signal=${signal}`));
      }
    });
  });
}

function runOutputPath(baseOut, phase) {
  if (baseOut === null) {
    return join(tmpdir(), `qemu-wasm-persistent-disk-${phase}-${process.pid}.json`);
  }
  return `${baseOut}.${phase}.json`;
}

async function runSmokePhase(options, phase, initrd, userDataDir, out, activeChild = null) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const runner = resolve(scriptDir, "wasm-browser-smoke-runner.mjs");
  const expectedText = phase === "write"
    ? "QEMU_WASM_PERSISTENT_DISK_WRITE_OK"
    : "QEMU_WASM_PERSISTENT_DISK_VERIFY_OK";
  const argv = [
    runner,
    "--artifact-dir", options.artifactDir,
    "--browser", options.browser,
    "--firmware-dir", options.firmwareDir,
    "--host", options.host,
    "--kernel", options.kernel,
    "--initrd", initrd,
    "--marker", "QEMU_WASM_LINUX_BOOT_OK",
    "--out", out,
    "--persistent-disk",
    "--persistent-disk-device", options.persistentDiskDevice,
    "--persistent-disk-opfs-name", options.persistentDiskOpfsName,
    "--persistent-disk-size-bytes", String(options.persistentDiskSizeBytes),
    "--port", String(options.port),
    "--rootfs", options.rootfs,
    "--rootfs-device", options.rootfsDevice,
    "--timeout-ms", String(options.timeoutMs),
    "--user-data-dir", userDataDir,
    "--expect-text", expectedText,
  ];
  await runCommand(argv, activeChild);
  return JSON.parse(await readFile(out, "utf8"));
}

export function resultPassed(result) {
  return Boolean(
    result &&
    result.write &&
    result.write.success &&
    result.write.persistentDiskState &&
    result.write.persistentDiskState.loadSource === "empty" &&
    result.write.persistentDiskState.persisted &&
    result.verify &&
    result.verify.success &&
    result.verify.persistentDiskState &&
    result.verify.persistentDiskState.loadSource === "opfs" &&
    result.verify.persistentDiskState.persisted &&
    result.immutableRootfs &&
    result.immutableRootfs.unchanged,
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

  const temporaryUserDataDir = options.userDataDir === null;
  const userDataDir = options.userDataDir || await mkdtemp(join(tmpdir(), "qemu-wasm-persistent-disk-"));
  const writeOut = runOutputPath(options.out, "write");
  const verifyOut = runOutputPath(options.out, "verify");
  const rootfsBefore = await sha256File(options.rootfs);
  const activeChild = { child: null };
  let removedUserDataDir = false;
  const cleanup = async () => {
    await stopChild(activeChild.child);
    activeChild.child = null;
    if (temporaryUserDataDir && !removedUserDataDir) {
      removedUserDataDir = true;
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
  const uninstallSignalCleanup = installSignalCleanup(cleanup);

  try {
    const write = await runSmokePhase(options, "write", options.writeInitrd, userDataDir, writeOut, activeChild);
    const verify = await runSmokePhase(options, "verify", options.verifyInitrd, userDataDir, verifyOut, activeChild);
    const rootfsAfter = await sha256File(options.rootfs);
    const result = {
      format: 1,
      passed: false,
      userDataDir,
      write,
      verify,
      immutableRootfs: {
        path: options.rootfs,
        sha256Before: rootfsBefore,
        sha256After: rootfsAfter,
        unchanged: rootfsBefore === rootfsAfter,
      },
      persistentDisk: {
        device: options.persistentDiskDevice,
        opfsName: options.persistentDiskOpfsName,
        sizeBytes: options.persistentDiskSizeBytes,
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
    uninstallSignalCleanup();
    await cleanup();
  }
}

if (process.argv[1] === THIS_FILE) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
