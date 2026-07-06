#!/usr/bin/env node
/*
 * Test QEMU argument generation for the browser WebAssembly smoke harness.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  browserKeyLinuxCode,
  browserNonInteractiveStdin,
  browserRuntimeSnapshot,
  createPowerControl,
  createServiceBridge,
  deliverDisplayKeyEvent,
  displayKeyPolicy,
  drawBrowserStatusFrame,
  emscriptenModuleCanvas,
  installBrowserDialogSuppression,
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
    persistentDisk: false,
    persistentDiskDevice: "virtio-mmio",
    persistentDiskPath: "/persistent.raw",
    qemuArgs: [],
    rootfs: "",
    rootfsDevice: "virtio-mmio",
    powerOperation: "",
    powerTimeoutMs: 30000,
    serviceBridge: null,
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

function valuesAfter(args, option) {
  const values = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === option) {
      values.push(args[i + 1]);
    }
  }
  assert.notEqual(values.length, 0, `${option} should be present`);
  return values;
}

class FakeCanvas {
  constructor(ownerDocument = null) {
    this.dataset = {};
    this.height = 0;
    this.hidden = false;
    this.id = "";
    this.listeners = new Map();
    this.ownerDocument = ownerDocument || { activeElement: null };
    this.operations = [];
    this.title = "";
    this.width = 0;
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

  setAttribute(name, value) {
    this[name] = value;
  }

  getContext(kind) {
    if (kind !== "2d") {
      return null;
    }
    return {
      fillStyle: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      fillRect: (...args) => {
        this.operations.push(["fillRect", ...args]);
      },
      fillText: (...args) => {
        this.operations.push(["fillText", ...args]);
      },
    };
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.elements = new Map();
    this.body = {
      appendChild: (element) => {
        this.elements.set(element.id, element);
      },
    };
  }

  createElement(name) {
    assert.equal(name, "canvas");
    return new FakeCanvas(this);
  }

  getElementById(id) {
    return this.elements.get(id) || null;
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

function serviceBridgeConfig(overrides = {}) {
  return {
    kind: "virtio-serial-jsonl",
    requestChannel: "org.qemu.wasm.service.request",
    responseChannel: "org.qemu.wasm.service.response",
    readinessMarker: "QEMU_WASM_SERVICE_READY",
    healthRequest: {
      operation: "health",
    },
    timeoutMs: 5000,
    maxPayloadBytes: 4096,
    interactiveOnly: false,
    ...overrides,
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
  const args = qemuArgs(baseConfig({ cpu: "", machine: "virt" }));

  assert.equal(valueAfter(args, "-M"), "virt");
  assert.equal(args.includes("-cpu"), false);
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
  const args = qemuArgs(baseConfig({ display: "wasm" }));

  assert.equal(args.includes("-nographic"), false);
  assert.equal(valueAfter(args, "-display"), "wasm");
  assert.equal(valueAfter(args, "-serial"), "mon:stdio");
  assert.equal(valueAfter(args, "-monitor"), "none");
  assert.equal(valueAfter(args, "-nic"), "none");
}

{
  const args = qemuArgs(baseConfig({
    display: "wasm",
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
  /displayDevice requires display=sdl or display=wasm/,
);

assert.equal(browserKeyLinuxCode({ code: "KeyA" }), 30);
assert.equal(browserKeyLinuxCode({ code: "Enter" }), 28);
assert.equal(browserKeyLinuxCode({ code: "ArrowUp" }), 103);
assert.equal(browserKeyLinuxCode({ code: "Unknown" }), 0);
assert.equal(browserNonInteractiveStdin(), null);

{
  const canvas = new FakeCanvas();
  assert.equal(drawBrowserStatusFrame(canvas, "Starting QEMU..."), true);
  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 400);
  assert.deepEqual(canvas.operations.at(-1), ["fillText", "Starting QEMU...", 360, 200]);
}

{
  const calls = [];
  const fakeWindow = {
    alert(message) {
      calls.push(["alert", message]);
    },
    confirm(message) {
      calls.push(["confirm", message]);
      return true;
    },
    prompt(message, fallback = "") {
      calls.push(["prompt", message, fallback]);
      return "typed";
    },
  };
  const smokeState = {};
  const restore = installBrowserDialogSuppression({ window: fakeWindow }, smokeState);

  assert.equal(fakeWindow.alert("visible alert"), undefined);
  assert.equal(fakeWindow.confirm("visible confirm"), false);
  assert.equal(fakeWindow.prompt("Input: "), null);
  assert.equal(fakeWindow.prompt("Abort/Retry/Ignore/AlwaysIgnore? [ariA] :", "i"), "i");
  assert.deepEqual(calls, []);
  assert.equal(smokeState.browserDialogs.suppressed, true);
  assert.equal(smokeState.browserDialogs.alertCount, 1);
  assert.equal(smokeState.browserDialogs.confirmCount, 1);
  assert.equal(smokeState.browserDialogs.promptCount, 2);

  restore();
  assert.equal(fakeWindow.prompt("Input: "), "typed");
  assert.deepEqual(calls, [["prompt", "Input: ", ""]]);
}

{
  const delivered = [];
  const event = { code: "KeyB" };
  assert.equal(deliverDisplayKeyEvent(event, true, (linuxKey, down) => {
    delivered.push({ linuxKey, down });
  }), true);
  assert.deepEqual(delivered, [{ linuxKey: 48, down: true }]);
  assert.equal(deliverDisplayKeyEvent({ code: "Unknown" }, true, () => {
    throw new Error("unknown keys must not be delivered");
  }), false);
}

assert.equal(displayKeyPolicy(fakeKeyEvent("Escape")), "release-focus");
assert.equal(displayKeyPolicy(fakeKeyEvent("l", { ctrlKey: true })), "browser-shortcut");
assert.equal(displayKeyPolicy(fakeKeyEvent("ArrowUp")), "capture-browser-key");
assert.equal(displayKeyPolicy(fakeKeyEvent("a")), "pass-through");

{
  const document = new FakeDocument();
  const canvas = new FakeCanvas(document);
  const workerCanvas = emscriptenModuleCanvas("wasm", canvas);

  assert.equal(emscriptenModuleCanvas("sdl", canvas), canvas);
  assert.notEqual(workerCanvas, canvas);
  assert.equal(workerCanvas.id, "qemu-wasm-worker-canvas");
  assert.equal(workerCanvas.hidden, true);
  assert.equal(workerCanvas.width, 1);
  assert.equal(workerCanvas.height, 1);
  assert.equal(emscriptenModuleCanvas("wasm", canvas), workerCanvas);
  assert.equal(emscriptenModuleCanvas("none", canvas), workerCanvas);
}

{
  const canvas = new FakeCanvas();
  const displayState = { focused: false };
  const delivered = [];
  const policy = installDisplayInputPolicy(canvas, displayState, (linuxKey, down) => {
    delivered.push({ linuxKey, down });
  });

  assert.equal(policy.escapeReleasesFocus, true);
  assert.equal(policy.pointerFocus, "focus-on-pointer-down");
  assert.equal(policy.pointerLock, false);
  assert.equal(canvas.dataset.inputActive, "false");
  assert.equal(canvas.title, "Bus Engine OS display. Escape releases keyboard focus.");

  canvas.dispatch("pointerdown");
  assert.equal(displayState.pointerFocusEvents, 1);
  assert.equal(displayState.focusEvents, 1);
  assert.equal(displayState.focused, true);
  assert.equal(canvas.dataset.inputActive, "true");

  const tab = fakeKeyEvent("Tab");
  tab.code = "Tab";
  canvas.dispatch("keydown", tab);
  assert.equal(tab.prevented, true);
  assert.equal(displayState.capturedBrowserKeyEvents, 1);
  assert.equal(displayState.deliveredKeyEvents, 1);

  const browserShortcut = fakeKeyEvent("l", { ctrlKey: true });
  browserShortcut.code = "KeyL";
  canvas.dispatch("keydown", browserShortcut);
  assert.equal(browserShortcut.prevented, false);
  assert.equal(displayState.browserShortcutEvents, 1);

  const keyA = fakeKeyEvent("a");
  keyA.code = "KeyA";
  canvas.dispatch("keydown", keyA);
  assert.equal(keyA.prevented, true);
  canvas.dispatch("keyup", keyA);
  assert.equal(displayState.deliveredKeyEvents, 3);
  assert.deepEqual(delivered, [
    { linuxKey: 15, down: true },
    { linuxKey: 30, down: true },
    { linuxKey: 30, down: false },
  ]);

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
  const args = qemuArgs(baseConfig({
    initrd: "",
    persistentDisk: true,
    persistentDiskDevice: "virtio-mmio",
    rootfs: "/guest/rootfs.raw",
    rootfsDevice: "virtio-mmio",
  }));
  const drives = valuesAfter(args, "-drive");
  const devices = valuesAfter(args, "-device");

  assert.ok(drives.includes("file=/persistent.raw,format=raw,if=none,id=persist0"));
  assert.ok(devices.includes("virtio-blk-device,drive=persist0"));
}

{
  const args = qemuArgs(baseConfig({
    initrd: "",
    persistentDisk: true,
    persistentDiskDevice: "virtio-pci",
    persistentDiskPath: "/guest/persistent.raw",
    rootfs: "/guest/rootfs.raw",
    rootfsDevice: "virtio-pci",
  }));
  const drives = valuesAfter(args, "-drive");

  assert.ok(drives.includes("file=/rootfs.raw,format=raw,if=virtio"));
  assert.ok(drives.includes("file=/guest/persistent.raw,format=raw,if=virtio"));
}

{
  const bridge = serviceBridgeConfig();
  const args = qemuArgs(baseConfig({
    serviceBridge: bridge,
  }));

  assert.deepEqual(args.filter((arg) => arg === "-chardev"), ["-chardev", "-chardev"]);
  assert.ok(args.includes(`wasm,id=qemu-wasm-service-request,channel=${bridge.requestChannel},max-payload=4096`));
  assert.ok(args.includes(`wasm,id=qemu-wasm-service-response,channel=${bridge.responseChannel},max-payload=4096`));
  assert.ok(args.includes("virtio-serial-device"));
  assert.equal(args.includes("virtio-serial-pci"), false);
  assert.ok(args.includes(`virtserialport,chardev=qemu-wasm-service-request,name=${bridge.requestChannel}`));
  assert.ok(args.includes(`virtserialport,chardev=qemu-wasm-service-response,name=${bridge.responseChannel}`));
}

{
  const bridge = serviceBridgeConfig({ kind: "serial-jsonl" });
  const args = qemuArgs(baseConfig({
    machine: "pc",
    serviceBridge: bridge,
  }));

  assert.deepEqual(args.filter((arg) => arg === "-chardev"), ["-chardev", "-chardev"]);
  assert.ok(args.includes(`wasm,id=qemu-wasm-service-request,channel=${bridge.requestChannel},max-payload=4096`));
  assert.ok(args.includes(`wasm,id=qemu-wasm-service-response,channel=${bridge.responseChannel},max-payload=4096`));
  assert.equal(args.includes("virtio-serial-pci"), false);
  assert.equal(args.includes("virtio-serial-device"), false);
  assert.ok(args.includes("chardev:qemu-wasm-service-request"));
  assert.ok(args.includes("chardev:qemu-wasm-service-response"));
}

{
  const bridge = serviceBridgeConfig();
  const args = qemuArgs(baseConfig({
    machine: "pc",
    serviceBridge: bridge,
  }));

  assert.ok(args.includes("virtio-serial-pci"));
  assert.equal(args.includes("virtio-serial-device"), false);
}

{
  const posted = [];
  const listeners = [];
  const scope = {
    location: { origin: "https://example.invalid" },
    addEventListener(type, listener) {
      if (type === "message") {
        listeners.push(listener);
      }
    },
  };
  const smokeState = {};
  const bridge = createServiceBridge(
    baseConfig({ serviceBridge: serviceBridgeConfig({ interactiveOnly: true }) }),
    smokeState,
    scope,
  );
  const written = [];
  bridge.attachModule({
    _qemu_wasm_chardev_write_pending() {
      written.push({
        channel: this.qemuWasmChardevPendingChannel,
        text: this.qemuWasmChardevPendingText,
      });
      return this.qemuWasmChardevPendingText.length;
    },
  });
  bridge.markReady("serial");
  const promise = bridge.request({ operation: "health" });
  const frame = JSON.parse(written[0].text);

  assert.equal(written[0].channel, "org.qemu.wasm.service.request");
  assert.equal(frame.operation, "health");
  assert.equal(smokeState.serviceBridge.ready, true);
  assert.equal(smokeState.serviceBridge.readySource, "serial");
  assert.equal(smokeState.serviceBridge.sent, 1);

  bridge.receive(
    "org.qemu.wasm.service.response",
    new TextEncoder().encode(`${JSON.stringify({ id: frame.id, status: "ok" })}\n`),
  );
  assert.deepEqual(await promise, { id: frame.id, status: "ok" });
  assert.equal(smokeState.serviceBridge.received, 1);
  assert.equal(smokeState.serviceBridge.resolved, 1);
  assert.equal(smokeState.serviceBridge.lastResponseStatus, "ok");

  listeners[0]({
    origin: "https://example.invalid",
    data: {
      type: "qemu-wasm-service-request",
      id: "outer-1",
      request: { id: "posted-1", operation: "health" },
    },
    source: {
      postMessage(message, origin) {
        posted.push({ message, origin });
      },
    },
  });
  const postedFrame = JSON.parse(written[1].text);
  bridge.receive(
    "org.qemu.wasm.service.response",
    new TextEncoder().encode(`${JSON.stringify({ id: postedFrame.id, status: "ok" })}\n`),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(posted[0].origin, "https://example.invalid");
  assert.equal(posted[0].message.type, "qemu-wasm-service-response");
  assert.equal(posted[0].message.id, "outer-1");
  assert.equal(posted[0].message.response.status, "ok");
}

{
  const scope = {
    location: { origin: "https://example.invalid" },
    addEventListener() {},
  };
  const smokeState = {};
  const bridge = createServiceBridge(
    baseConfig({ serviceBridge: serviceBridgeConfig() }),
    smokeState,
    scope,
  );
  const written = [];
  bridge.attachModule({
    _qemu_wasm_chardev_write_pending() {
      written.push({
        channel: this.qemuWasmChardevPendingChannel,
        text: this.qemuWasmChardevPendingText,
      });
      return this.qemuWasmChardevPendingText.length;
    },
  });

  bridge.markReady("serial");

  assert.equal(smokeState.serviceBridge.healthRequested, true);
  assert.equal(smokeState.serviceBridge.sent, 1);
  assert.equal(written.length, 1);
  assert.equal(written[0].channel, "org.qemu.wasm.service.request");
  const frame = JSON.parse(written[0].text);
  assert.equal(frame.operation, "health");

  bridge.receive(
    "org.qemu.wasm.service.response",
    new TextEncoder().encode(`${JSON.stringify({ id: frame.id, status: "ok" })}\n`),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(smokeState.serviceBridge.healthRequestId, frame.id);
  assert.equal(smokeState.serviceBridge.healthStatus, "ok");
  assert.equal(smokeState.serviceBridge.healthError, null);
  assert.equal(smokeState.serviceBridge.received, 1);
  assert.equal(smokeState.serviceBridge.resolved, 1);
}

{
  const smokeState = {};
  const powerControl = createPowerControl(
    baseConfig({ powerOperation: "guest-powerdown" }),
    smokeState,
    null,
  );
  const calls = [];
  powerControl.attachModule({
    _qemu_wasm_power_request(action) {
      calls.push(action);
      return 0;
    },
  });

  await powerControl.request();

  assert.deepEqual(calls, [1]);
  assert.equal(smokeState.powerControl.operation, "guest-powerdown");
  assert.equal(smokeState.powerControl.deliveryPath, "qemu-guest-powerdown");
  assert.equal(smokeState.powerControl.qemuAction, "guest-powerdown");
  assert.equal(smokeState.powerControl.qemuStatus, 0);
  assert.equal(smokeState.powerControl.completed, true);
}

{
  const smokeState = {};
  const requests = [];
  const bridge = {
    async request(frame, options) {
      requests.push({ frame, options });
      return { id: "power-1", status: "ok" };
    },
  };
  const powerControl = createPowerControl(
    baseConfig({ powerTimeoutMs: 1234 }),
    smokeState,
    bridge,
  );

  await powerControl.request("reboot");

  assert.deepEqual(requests, [{
    frame: { operation: "power", action: "reboot" },
    options: { timeoutMs: 1234 },
  }]);
  assert.equal(smokeState.powerControl.operation, "reboot");
  assert.equal(smokeState.powerControl.deliveryPath, "service-bridge");
  assert.equal(smokeState.powerControl.guestAcknowledged, true);
  assert.equal(smokeState.powerControl.responseStatus, "ok");
  assert.equal(smokeState.powerControl.completed, true);
}

{
  const smokeState = {};
  const powerControl = createPowerControl(baseConfig(), smokeState, null);

  await assert.rejects(
    () => powerControl.request("reboot"),
    /graceful reboot requires a configured service bridge/,
  );
  assert.equal(smokeState.powerControl.operation, "reboot");
  assert.equal(smokeState.powerControl.errors, 1);
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
  let probedDescriptor = null;
  class Memory {
    constructor(descriptor) {
      probedDescriptor = descriptor;
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
      status: "supported",
      detail: null,
    },
    userAgent: "HeadlessChrome/141.0.7390.37",
    hardwareConcurrency: 20,
    deviceMemory: 8,
    jsHeapSizeLimit: 4294705152,
  });
  assert.deepEqual(probedDescriptor, {
    initial: 1n,
    maximum: 1n,
    address: "i64",
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
      status: "unsupported",
      detail: {
        name: "TypeError",
        message: "Cannot convert a BigInt value to a number",
      },
    },
    userAgent: null,
    hardwareConcurrency: null,
    deviceMemory: null,
    jsHeapSizeLimit: null,
  });
}

assert.deepEqual(browserRuntimeSnapshot({
  navigator: {},
  performance: {},
}), {
  crossOriginIsolated: false,
  sharedArrayBuffer: false,
  webAssembly: false,
  wasmMemory64: {
    supported: false,
    status: "unavailable",
    detail: {
      name: "Error",
      message: "WebAssembly.Memory is not available",
    },
  },
  userAgent: null,
  hardwareConcurrency: null,
  deviceMemory: null,
  jsHeapSizeLimit: null,
});
