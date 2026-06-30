#!/usr/bin/env node
/*
 * Test QEMU argument generation for the browser WebAssembly smoke harness.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  browserRuntimeSnapshot,
  qemuArgs,
  recordHarnessFailure,
} from "./wasm-browser-smoke.mjs";

function baseConfig(overrides = {}) {
  return {
    appendExtra: "",
    allowSerialFallback: true,
    cpu: "Nehalem",
    display: "none",
    displayDevice: "default",
    expectedResolution: "",
    focusDisplay: false,
    initrd: "/guest/initramfs.cpio.gz",
    kernelAppend: null,
    machine: "microvm,acpi=off",
    memory: "512M",
    network: "none",
    qemuArgs: [],
    rootfs: "",
    rootfsDevice: "virtio-mmio",
    visualMarker: "",
    ...overrides,
  };
}

function valueAfter(args, option) {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `${option} should be present`);
  assert.ok(index + 1 < args.length, `${option} should have a value`);
  return args[index + 1];
}

{
  const args = qemuArgs(baseConfig());

  assert.equal(valueAfter(args, "-M"), "microvm,acpi=off");
  assert.equal(valueAfter(args, "-m"), "512M");
  assert.equal(valueAfter(args, "-cpu"), "Nehalem");
  assert.equal(valueAfter(args, "-serial"), "mon:stdio");
  assert.equal(valueAfter(args, "-initrd"), "/initramfs.cpio.gz");
  assert.equal(valueAfter(args, "-L"), "/firmware");
  assert.equal(valueAfter(args, "-nic"), "none");
  assert.equal(args.includes("-nographic"), true);
  assert.equal(args.includes("-display"), false);
  assert.ok(valueAfter(args, "-append").includes("rdinit=/init"));
  assert.equal(args.includes("-drive"), false);
}

{
  const args = qemuArgs(baseConfig({ display: "sdl" }));

  assert.equal(args.includes("-nographic"), false);
  assert.equal(valueAfter(args, "-display"), "sdl,gl=off");
  assert.equal(valueAfter(args, "-serial"), "mon:stdio");
  assert.equal(valueAfter(args, "-monitor"), "none");
  assert.equal(valueAfter(args, "-nic"), "none");
}

{
  const args = qemuArgs(baseConfig({
    display: "sdl",
    displayDevice: "stdvga",
  }));

  assert.equal(valueAfter(args, "-vga"), "std");
}

{
  const args = qemuArgs(baseConfig({
    display: "sdl",
    displayDevice: "virtio-vga",
  }));

  assert.equal(valueAfter(args, "-vga"), "virtio");
}

{
  const args = qemuArgs(baseConfig({
    display: "sdl",
    displayDevice: "virtio-gpu-pci",
  }));

  assert.equal(valueAfter(args, "-vga"), "none");
  assert.equal(valueAfter(args, "-device"), "virtio-gpu-pci");
}

assert.throws(
  () => qemuArgs(baseConfig({ displayDevice: "stdvga" })),
  /displayDevice requires display=sdl/,
);

{
  const args = qemuArgs(baseConfig({ network: "default" }));

  assert.equal(args.includes("-nic"), false);
}

{
  const args = qemuArgs(baseConfig({
    initrd: "",
    rootfs: "/guest/rootfs.raw",
    rootfsDevice: "virtio-mmio",
  }));

  assert.equal(valueAfter(args, "-drive"), "file=/rootfs.raw,format=raw,if=none,id=hd0");
  assert.equal(valueAfter(args, "-device"), "virtio-blk-device,drive=hd0");
  assert.ok(valueAfter(args, "-append").includes("root=/dev/vda"));
}

{
  const args = qemuArgs(baseConfig({
    appendExtra: "ignore_loglevel",
    initrd: "",
    qemuArgs: ["-name", "wasm-smoke"],
    rootfs: "/guest/rootfs.raw",
    rootfsDevice: "virtio-pci",
  }));

  assert.equal(valueAfter(args, "-drive"), "file=/rootfs.raw,format=raw,if=virtio");
  assert.ok(valueAfter(args, "-append").endsWith("ignore_loglevel"));
  assert.deepEqual(args.slice(-2), ["-name", "wasm-smoke"]);
}

{
  const state = {
    phase: "import-qemu-module",
    phases: [],
  };
  const error = new Error("failed to load QEMU module");
  error.name = "TypeError";
  error.stack = "TypeError: failed to load QEMU module\n    at import-qemu-module";

  assert.equal(recordHarnessFailure(state, error, 42), state);
  assert.deepEqual(state, {
    phase: "failed",
    phases: [
      {
        phase: "failed",
        elapsedMs: 42,
        failedDuring: "import-qemu-module",
        message: "failed to load QEMU module",
        name: "TypeError",
      },
    ],
    failurePhase: "import-qemu-module",
    failureName: "TypeError",
    failure: "failed to load QEMU module",
    failureStack: "TypeError: failed to load QEMU module\n    at import-qemu-module",
  });
}

assert.equal(recordHarnessFailure(null, new Error("ignored"), 1), null);

{
  class Memory {
    constructor(descriptor) {
      this.descriptor = descriptor;
    }
  }
  assert.deepEqual(browserRuntimeSnapshot({
    crossOriginIsolated: true,
    SharedArrayBuffer: class SharedArrayBuffer {},
    WebAssembly: { Memory },
    navigator: {
      userAgent: "HeadlessChrome/141.0.7390.37",
      hardwareConcurrency: 20,
      deviceMemory: 8,
    },
    performance: {
      memory: {
        jsHeapSizeLimit: 4294705152,
      },
    },
  }), {
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    webAssembly: true,
    wasmMemory64: {
      supported: true,
      errorName: null,
      errorMessage: null,
    },
    userAgent: "HeadlessChrome/141.0.7390.37",
    hardwareConcurrency: 20,
    deviceMemory: 8,
    jsHeapSizeLimit: 4294705152,
  });
}

{
  class Memory {
    constructor() {
      throw new TypeError("Cannot convert a BigInt value to a number");
    }
  }
  assert.deepEqual(browserRuntimeSnapshot({
    crossOriginIsolated: false,
    WebAssembly: { Memory },
    navigator: {},
    performance: {},
  }), {
    crossOriginIsolated: false,
    sharedArrayBuffer: false,
    webAssembly: true,
    wasmMemory64: {
      supported: false,
      errorName: "TypeError",
      errorMessage: "Cannot convert a BigInt value to a number",
    },
    userAgent: null,
    hardwareConcurrency: null,
    deviceMemory: null,
    jsHeapSizeLimit: null,
  });
}
