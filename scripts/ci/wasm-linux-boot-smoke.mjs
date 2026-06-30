#!/usr/bin/env node
/*
 * Run the canonical 64-bit Linux boot smoke test for QEMU WebAssembly.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";

function parseArgs(argv) {
  const options = {
    appendExtra: "",
    artifactDir: ".",
    cpu: null,
    firmwareDir: "pc-bios",
    guestManifest: null,
    initrd: null,
    kernel: null,
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    program: "qemu-system-x86_64.js",
    qemuArgs: [],
    rootfs: null,
    timeoutMs: 180000,
  };
  const explicit = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--append-extra") {
      options.appendExtra = argv[++i];
      explicit.add("appendExtra");
    } else if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
      explicit.add("artifactDir");
    } else if (arg === "--cpu") {
      options.cpu = argv[++i];
      explicit.add("cpu");
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
      explicit.add("firmwareDir");
    } else if (arg === "--guest-manifest") {
      options.guestManifest = argv[++i];
    } else if (arg === "--initrd") {
      options.initrd = argv[++i];
      explicit.add("initrd");
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
      explicit.add("kernel");
    } else if (arg === "--marker") {
      options.marker = argv[++i];
      explicit.add("marker");
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(argv[++i]);
      explicit.add("maxOutputBytes");
    } else if (arg === "--memory") {
      options.memory = argv[++i];
      explicit.add("memory");
    } else if (arg === "--program") {
      options.program = argv[++i];
      explicit.add("program");
    } else if (arg === "--qemu-arg") {
      options.qemuArgs.push(argv[++i]);
      explicit.add("qemuArgs");
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
      explicit.add("rootfs");
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
      explicit.add("timeoutMs");
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  applyGuestManifest(options, explicit, {
    checksumFields: ["kernel", "initrd", "rootfs"],
    integerFields: ["maxOutputBytes", "timeoutMs"],
    pathFields: ["artifactDir", "firmwareDir", "initrd", "kernel", "rootfs"],
    stringFields: [
      "appendExtra",
      "artifactDir",
      "cpu",
      "firmwareDir",
      "initrd",
      "kernel",
      "marker",
      "memory",
      "program",
      "rootfs",
    ],
    stringListFields: ["qemuArgs"],
  });

  if (options.kernel === null) {
    console.error("--kernel is required");
    usage(2);
  }
  if (options.initrd === null && options.rootfs === null) {
    console.error("either --initrd or --rootfs is required");
    usage(2);
  }
  if (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
    console.error("--max-output-bytes must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    usage(2);
  }

  return options;
}

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-linux-boot-smoke.mjs --kernel FILE --initrd FILE [OPTIONS]

Options:
  --append-extra TEXT   Extra Linux kernel arguments appended to the default
  --artifact-dir DIR     Directory containing qemu-system-*.js/.wasm artifacts
  --cpu MODEL            Optional guest CPU model passed to QEMU
  --firmware-dir DIR     Directory containing qboot.rom and linuxboot_dma.bin
  --guest-manifest FILE  JSON file with guest input defaults
  --initrd FILE          Initramfs image that prints the expected marker
  --kernel FILE          64-bit Linux bzImage
  --marker TEXT          Output text required for success
  --max-output-bytes N   Suppress stdout/stderr after N total output bytes
  --memory SIZE          Guest memory size passed to QEMU
  --program FILE         JavaScript launcher inside artifact dir
  --qemu-arg ARG         Extra QEMU argument appended to the smoke command
  --rootfs FILE          Raw root filesystem image exposed as /dev/vda
  --timeout-ms MS        Timeout in milliseconds
  --help                 Show this help
`);
  process.exit(status);
}

function requireReadable(path, label) {
  try {
    accessSync(path, constants.R_OK);
  } catch (error) {
    console.error(`${label} is not readable: ${path}`);
    process.exit(2);
  }
}

function runSmoke(options) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const smoke = resolve(scriptDir, "wasm-node-smoke.mjs");
  const qboot = resolve(options.firmwareDir, "qboot.rom");
  const linuxboot = resolve(options.firmwareDir, "linuxboot_dma.bin");

  requireReadable(resolve(options.artifactDir, options.program), "program");
  requireReadable(resolve(options.artifactDir, "qemu-system-x86_64.wasm"), "wasm module");
  requireReadable(options.kernel, "kernel");
  if (options.initrd !== null) {
    requireReadable(options.initrd, "initrd");
  }
  if (options.rootfs !== null) {
    requireReadable(options.rootfs, "rootfs");
  }
  requireReadable(qboot, "qboot firmware");
  requireReadable(linuxboot, "linuxboot firmware");

  const args = [
    smoke,
    "--artifact-dir",
    options.artifactDir,
    "--program",
    options.program,
    "--max-output-bytes",
    String(options.maxOutputBytes),
    "--timeout-ms",
    String(options.timeoutMs),
    "--marker",
    options.marker,
    "--mount-file",
    `${options.kernel}:/kernel`,
    "--mount-file",
    `${qboot}:/firmware/qboot.rom`,
    "--mount-file",
    `${linuxboot}:/firmware/linuxboot_dma.bin`,
  ];

  const kernelAppend = [
    options.initrd !== null
      ? "console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1"
      : "console=ttyS0 earlyprintk=serial,ttyS0,115200 root=/dev/vda rw init=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1",
    options.appendExtra,
  ].filter(Boolean).join(" ");

  if (options.initrd !== null) {
    args.push("--mount-file", `${options.initrd}:/initramfs.cpio.gz`);
  }
  if (options.rootfs !== null) {
    args.push("--mount-file", `${options.rootfs}:/rootfs.raw`);
  }

  args.push("--", "-M", "microvm,acpi=off", "-m", options.memory);
  if (options.cpu !== null) {
    args.push("-cpu", options.cpu);
  }

  args.push(
    "-accel",
    "tcg,thread=single",
    "-nographic",
    "-serial",
    "mon:stdio",
    "-monitor",
    "none",
    "-kernel",
    "/kernel",
  );
  if (options.initrd !== null) {
    args.push("-initrd", "/initramfs.cpio.gz");
  }
  args.push("-append", kernelAppend);
  if (options.rootfs !== null) {
    args.push(
      "-drive",
      "file=/rootfs.raw,format=raw,if=none,id=hd0",
      "-device",
      "virtio-blk-device,drive=hd0",
    );
  }
  args.push("-L", "/firmware");
  args.push(...options.qemuArgs);

  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`wasm-linux-boot-smoke: child terminated by ${signal}`);
      process.exit(1);
    }
    process.exit(code === null ? 1 : code);
  });
}

runSmoke(parseArgs(process.argv.slice(2)));
