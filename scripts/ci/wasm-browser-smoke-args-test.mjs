#!/usr/bin/env node
/*
 * Test QEMU argument generation for the browser WebAssembly smoke harness.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  browserRuntimeSnapshot,
  displayKeyPolicy,
  installDisplayInputPolicy,
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

class FakeCanvas {
  constructor() {
    this.dataset = {};
    this.listeners = new Map();
    this.ownerDocument = { activeElement: null };
    this.title = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.dispatch("focus");
  }

  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
    this.dispatch("blur");
  }
}

function fakeKeyEvent(key, modifiers = {}) {
  return {
    key,
    altKey: Boolean(modifiers.altKey),
    ctrlKey: Boolean(modifiers.ctrlKey),
    metaKey: Boolean(modifiers.metaKey),
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function fakePasteEvent(text) {
  return {
    clipboardData: {
      getData(kind) {
        return kind === "text/plain" ? text : "";
      },
    },
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
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

assert.equal(displayKeyPolicy(fakeKeyEvent("Escape")), "release-focus");
assert.equal(displayKeyPolicy(fakeKeyEvent("l", { ctrlKey: true })), "browser-shortcut");
assert.equal(displayKeyPolicy(fakeKeyEvent("ArrowUp")), "capture-browser-key");
assert.equal(displayKeyPolicy(fakeKeyEvent("a")), "pass-through");

{
  const canvas = new FakeCanvas();
  const displayState = { focused: false };
  const policy = installDisplayInputPolicy(canvas, displayState);

  assert.equal(policy.escapeReleasesFocus, true);
  assert.equal(policy.pointerFocus, "focus-on-pointer-down");
  assert.equal(policy.pointerLock, false);
  assert.equal(canvas.dataset.inputActive, "false");
  assert.equal(canvas.title, "QEMU display. Escape releases keyboard focus.");

  canvas.dispatch("pointerdown");
  assert.equal(displayState.pointerFocusEvents, 1);
  assert.equal(displayState.focusEvents, 1);
  assert.equal(displayState.focused, true);
  assert.equal(canvas.dataset.inputActive, "true");

  const tab = fakeKeyEvent("Tab");
  canvas.dispatch("keydown", tab);
  assert.equal(tab.prevented, true);
  assert.equal(displayState.capturedBrowserKeyEvents, 1);

  const browserShortcut = fakeKeyEvent("l", { ctrlKey: true });
  canvas.dispatch("keydown", browserShortcut);
  assert.equal(browserShortcut.prevented, false);
  assert.equal(displayState.browserShortcutEvents, 1);

  const paste = fakePasteEvent("uname -a\n");
  canvas.dispatch("paste", paste);
  assert.equal(paste.prevented, true);
  assert.equal(displayState.pasteEvents, 1);
  assert.equal(displayState.lastPasteLength, "uname -a\n".length);

  const escape = fakeKeyEvent("Escape");
  canvas.dispatch("keydown", escape);
  assert.equal(escape.prevented, true);
  assert.equal(displayState.escapeReleaseEvents, 1);
  assert.equal(displayState.blurEvents, 1);
  assert.equal(displayState.focused, false);
  assert.equal(canvas.dataset.inputActive, "false");
}

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
