#!/usr/bin/env node
/*
 * Test QEMU WebAssembly smoke guest manifest helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";

class ProcessExit extends Error {
  constructor(status) {
    super(`process.exit(${status})`);
    this.status = status;
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function manifestSchema() {
  return {
    stringFields: [
      "display",
      "displayDevice",
      "expectedResolution",
      "initrd",
      "kernel",
      "keyboardAfterText",
      "keyboardText",
      "marker",
      "powerOperation",
      "screenshot",
      "visualMarker",
    ],
    integerFields: ["displayMinNonblackPixels", "powerTimeoutMs", "timeoutMs"],
    booleanFields: [
      "allowSerialFallback",
      "focusDisplay",
      "memory64",
      "requireDisplayOutput",
      "screenshotFullPage",
    ],
    stringListFields: ["expectText", "qemuArgs"],
    pathFields: ["kernel", "initrd", "screenshot"],
    checksumFields: ["kernel", "initrd"],
    serviceBridgeField: "serviceBridge",
  };
}

function browserHostedSchema() {
  return {
    stringFields: [
      "artifactDir",
      "cpu",
      "display",
      "displayDevice",
      "firmwareDir",
      "initrd",
      "kernel",
      "kernelAppend",
      "machine",
      "marker",
      "memory",
      "persistentDiskDevice",
      "persistentDiskOpfsName",
      "persistentDiskPath",
      "persistentDiskStorage",
      "program",
      "rootfs",
      "rootfsDevice",
      "targetArch",
      "wasm",
    ],
    integerFields: ["maxOutputBytes", "persistentDiskSizeBytes"],
    booleanFields: ["allowSerialFallback", "focusDisplay", "persistentDisk"],
    pathFields: ["artifactDir", "firmwareDir", "kernel", "rootfs"],
  };
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-guest-manifest-"));
  const kernelData = Buffer.from("kernel\n");
  const initrdData = Buffer.from("initrd\n");
  writeFileSync(join(dir, "kernel.bin"), kernelData);
  writeFileSync(join(dir, "initrd.cpio.gz"), initrdData);
  const manifestPath = join(dir, "guest.json");
  writeJson(manifestPath, {
    kernel: "kernel.bin",
    initrd: "initrd.cpio.gz",
    allowSerialFallback: false,
    display: "sdl",
    displayDevice: "stdvga",
    displayMinNonblackPixels: 64,
    expectedResolution: "800x600",
    focusDisplay: true,
    keyboardAfterText: "login:",
    keyboardText: "uname -a\n",
    marker: "manifest-marker",
    powerOperation: "shutdown",
    powerTimeoutMs: 15000,
    requireDisplayOutput: true,
    screenshot: "display.png",
    screenshotFullPage: true,
    timeoutMs: 120000,
    visualMarker: "login",
    memory64: true,
    serviceBridge: {
      kind: "serial-jsonl",
      requestChannel: "org.qemu.wasm.service.request",
      responseChannel: "org.qemu.wasm.service.response",
      readinessMarker: "QEMU_WASM_SERVICE_READY",
      healthRequest: {
        id: "health-1",
        operation: "health",
      },
      timeoutMs: 5000,
      maxPayloadBytes: 4096,
      interactiveOnly: false,
    },
    expectText: ["manifest text"],
    qemuArgs: ["-name", "manifest-smoke"],
    sha256: {
      kernel: `sha256:${sha256(kernelData).toUpperCase()}`,
      initrd: sha256(initrdData),
    },
  });

  const options = {
    guestManifest: manifestPath,
    kernel: null,
    initrd: null,
    allowSerialFallback: true,
    display: "none",
    displayDevice: "default",
    displayMinNonblackPixels: 1,
    expectedResolution: "",
    focusDisplay: false,
    keyboardAfterText: "",
    keyboardText: "",
    marker: "cli-marker",
    powerOperation: "",
    powerTimeoutMs: 30000,
    requireDisplayOutput: false,
    screenshot: null,
    screenshotFullPage: false,
    timeoutMs: null,
    visualMarker: "",
    memory64: false,
    serviceBridge: null,
    expectText: [],
    qemuArgs: ["-trace", "wasm"],
  };
  const explicit = new Set(["marker", "qemuArgs"]);
  applyGuestManifest(options, explicit, manifestSchema());

  assert.equal(options.kernel, join(dir, "kernel.bin"));
  assert.equal(options.initrd, join(dir, "initrd.cpio.gz"));
  assert.equal(options.allowSerialFallback, false);
  assert.equal(options.display, "sdl");
  assert.equal(options.displayDevice, "stdvga");
  assert.equal(options.displayMinNonblackPixels, 64);
  assert.equal(options.expectedResolution, "800x600");
  assert.equal(options.focusDisplay, true);
  assert.equal(options.keyboardAfterText, "login:");
  assert.equal(options.keyboardText, "uname -a\n");
  assert.equal(options.marker, "cli-marker");
  assert.equal(options.powerOperation, "shutdown");
  assert.equal(options.powerTimeoutMs, 15000);
  assert.equal(options.requireDisplayOutput, true);
  assert.equal(options.screenshot, join(dir, "display.png"));
  assert.equal(options.screenshotFullPage, true);
  assert.equal(options.timeoutMs, 120000);
  assert.equal(options.visualMarker, "login");
  assert.equal(options.memory64, true);
  assert.deepEqual(options.serviceBridge, {
    kind: "serial-jsonl",
    requestChannel: "org.qemu.wasm.service.request",
    responseChannel: "org.qemu.wasm.service.response",
    readinessMarker: "QEMU_WASM_SERVICE_READY",
    healthRequest: {
      id: "health-1",
      operation: "health",
    },
    timeoutMs: 5000,
    maxPayloadBytes: 4096,
    interactiveOnly: false,
  });
  assert.deepEqual(options.expectText, ["manifest text"]);
  assert.deepEqual(options.qemuArgs, ["-name", "manifest-smoke", "-trace", "wasm"]);
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-browser-hosted-manifest-"));
  const manifestPath = join(dir, "browser-hosted-manifest.json");
  writeJson(manifestPath, {
    format: "bus-engine-os-browser-hosted-bundle-v1",
    target_arch: "riscv64",
    default_parameters: {
      allowSerialFallback: "1",
      cpu: "",
      display: "wasm",
      displayDevice: "virtio-gpu-pci",
      focusDisplay: "true",
      initrd: "",
      kernel: "guest/kernel",
      kernelAppend: "console=tty0 console=ttyS0 root=/dev/vda rw",
      machine: "virt",
      marker: "Bus Engine OS",
      maxOutputBytes: "4000000",
      memory: "512M",
      persistentDisk: "1",
      persistentDiskDevice: "virtio-pci",
      persistentDiskOpfsName: "beo-g3-riscv64-virtual-server.raw",
      persistentDiskPath: "/persistent.raw",
      persistentDiskSizeBytes: "268435456",
      persistentDiskStorage: "opfs",
      program: "artifacts/qemu-system-riscv64.js",
      qboot: "firmware/qboot.rom",
      rootfs: "guest/rootfs.raw",
      rootfsDevice: "virtio-pci",
      wasm: "artifacts/qemu-system-riscv64.wasm",
    },
  });

  const options = {
    guestManifest: manifestPath,
    allowSerialFallback: false,
    artifactDir: null,
    cpu: "Nehalem",
    display: "none",
    displayDevice: "default",
    firmwareDir: "pc-bios",
    focusDisplay: false,
    initrd: null,
    kernel: null,
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    persistentDisk: false,
    persistentDiskDevice: "virtio-mmio",
    persistentDiskOpfsName: "qemu-wasm-persistent.raw",
    persistentDiskPath: "/persistent.raw",
    persistentDiskSizeBytes: 1048576,
    persistentDiskStorage: "opfs",
    program: "qemu-system-x86_64.js",
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    targetArch: "x86_64",
    wasm: null,
  };
  applyGuestManifest(options, new Set(), browserHostedSchema());

  assert.equal(options.allowSerialFallback, true);
  assert.equal(options.artifactDir, join(dir, "artifacts"));
  assert.equal(options.cpu, "");
  assert.equal(options.display, "wasm");
  assert.equal(options.displayDevice, "virtio-gpu-pci");
  assert.equal(options.firmwareDir, join(dir, "firmware"));
  assert.equal(options.focusDisplay, true);
  assert.equal(options.initrd, "");
  assert.equal(options.kernel, join(dir, "guest/kernel"));
  assert.equal(options.kernelAppend, "console=tty0 console=ttyS0 root=/dev/vda rw");
  assert.equal(options.machine, "virt");
  assert.equal(options.marker, "Bus Engine OS");
  assert.equal(options.maxOutputBytes, 4000000);
  assert.equal(options.persistentDisk, true);
  assert.equal(options.persistentDiskDevice, "virtio-pci");
  assert.equal(options.persistentDiskOpfsName, "beo-g3-riscv64-virtual-server.raw");
  assert.equal(options.persistentDiskPath, "/persistent.raw");
  assert.equal(options.persistentDiskSizeBytes, 268435456);
  assert.equal(options.program, "artifacts/qemu-system-riscv64.js");
  assert.equal(options.rootfs, join(dir, "guest/rootfs.raw"));
  assert.equal(options.rootfsDevice, "virtio-pci");
  assert.equal(options.targetArch, "riscv64");
  assert.equal(options.wasm, "artifacts/qemu-system-riscv64.wasm");
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-guest-manifest-bad-"));
  writeFileSync(join(dir, "kernel.bin"), "kernel\n");
  const manifestPath = join(dir, "guest.json");
  writeJson(manifestPath, {
    kernel: "kernel.bin",
    sha256: {
      kernel: "0".repeat(64),
    },
  });

  const originalExit = process.exit;
  const originalError = console.error;
  const errors = [];
  process.exit = (status) => {
    throw new ProcessExit(status);
  };
  console.error = (message) => {
    errors.push(String(message));
  };
  try {
    assert.throws(
      () => applyGuestManifest(
        {
          guestManifest: manifestPath,
          kernel: null,
        },
        new Set(),
        {
          stringFields: ["kernel"],
          pathFields: ["kernel"],
          checksumFields: ["kernel"],
        },
      ),
      (error) => error instanceof ProcessExit && error.status === 2,
    );
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  assert.match(errors.join("\n"), /guest manifest checksum mismatch for kernel/);
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-guest-manifest-bridge-bad-"));
  const manifestPath = join(dir, "guest.json");
  writeJson(manifestPath, {
    serviceBridge: {
      kind: "serial-console",
      requestChannel: "org.qemu.wasm.service.request",
      responseChannel: "org.qemu.wasm.service.response",
      readinessMarker: "QEMU_WASM_SERVICE_READY",
      healthRequest: {
        operation: "health",
      },
      timeoutMs: 5000,
      maxPayloadBytes: 4096,
      interactiveOnly: false,
    },
  });

  const originalExit = process.exit;
  const originalError = console.error;
  const errors = [];
  process.exit = (status) => {
    throw new ProcessExit(status);
  };
  console.error = (message) => {
    errors.push(String(message));
  };
  try {
    assert.throws(
      () => applyGuestManifest(
        {
          guestManifest: manifestPath,
          serviceBridge: null,
        },
        new Set(),
        {
          serviceBridgeField: "serviceBridge",
        },
      ),
      (error) => error instanceof ProcessExit && error.status === 2,
    );
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  assert.match(errors.join("\n"), /serviceBridge.kind must be serial-jsonl, virtio-console-jsonl, or virtio-serial-jsonl/);
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-guest-manifest-power-bad-"));
  const manifestPath = join(dir, "guest.json");
  writeJson(manifestPath, {
    powerOperation: "hibernate",
  });

  const originalExit = process.exit;
  const originalError = console.error;
  const errors = [];
  process.exit = (status) => {
    throw new ProcessExit(status);
  };
  console.error = (message) => {
    errors.push(String(message));
  };
  try {
    assert.throws(
      () => applyGuestManifest(
        {
          guestManifest: manifestPath,
          powerOperation: "",
        },
        new Set(),
        {
          stringFields: ["powerOperation"],
        },
      ),
      (error) => error instanceof ProcessExit && error.status === 2,
    );
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  assert.match(errors.join("\n"), /powerOperation must be shutdown, reboot, guest-powerdown, force-reset, force-poweroff, or empty/);
}
