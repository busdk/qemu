/*
 * Browser harness for QEMU WebAssembly smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const DEFAULT_MARKER = "QEMU_WASM_LINUX_BOOT_OK";
const OPTIONAL_FIRMWARE_FILES = [
  "bios-256k.bin",
  "kvmvapic.bin",
  "vgabios.bin",
  "vgabios-stdvga.bin",
  "efi-virtio.rom",
];

function option(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value === "" ? fallback : value;
}

function pathOption(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null ? fallback : value;
}

function listOption(name) {
  return new URLSearchParams(window.location.search).getAll(name);
}

function numberOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeNumberOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function text(id) {
  return document.getElementById(id);
}

function boolOption(name, fallback) {
  const value = option(name, fallback ? "1" : "0").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function jsonObjectOption(name, fallback) {
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null || raw === "") {
    return fallback;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON object`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value;
}

function parseResolution(value) {
  if (value === "") {
    return null;
  }
  const match = /^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/.exec(value);
  if (match === null) {
    throw new Error("expectedResolution must use WIDTHxHEIGHT");
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function appendLine(target, line) {
  target.textContent += `${line}\n`;
  target.scrollTop = target.scrollHeight;
}

async function fetchBytes(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchOptionalBytes(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createParentPaths(module, path) {
  const parts = path.split("/").filter(Boolean).slice(0, -1);
  let current = "/";
  for (const part of parts) {
    module.FS_createPath(current, part, true, true);
    current = `${current === "/" ? "" : current}/${part}`;
  }
}

function mountFiles(module, mounts) {
  for (const mount of mounts) {
    createParentPaths(module, mount.path);
    module.FS.writeFile(mount.path, mount.data);
  }
}

function programExitStatus(line) {
  const match = /^program exited \(with status: ([0-9]+)\)/.exec(line);
  return match === null ? null : Number(match[1]);
}

function serviceBridgeResponseStatus(response) {
  if (typeof response.status === "string" && response.status !== "") {
    return response.status;
  }
  if (typeof response.error === "string" && response.error !== "") {
    return "error";
  }
  return "ok";
}

function serviceBridgeRequestId(request, sequence) {
  if (typeof request.id === "string" && request.id !== "") {
    return request.id;
  }
  return `request-${sequence}`;
}

function serviceBridgeError(state, error) {
  const message = error && error.message ? error.message : String(error);
  state.errors += 1;
  state.lastError = message;
  return message;
}

export function createServiceBridge(config, smokeState, scope = globalThis) {
  const bridgeConfig = config.serviceBridge;
  if (bridgeConfig === null) {
    return null;
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const pending = new Map();
  let module = null;
  let responseBuffer = "";
  let sequence = 0;
  const state = {
    kind: bridgeConfig.kind,
    requestChannel: bridgeConfig.requestChannel,
    responseChannel: bridgeConfig.responseChannel,
    readinessMarker: bridgeConfig.readinessMarker,
    timeoutMs: bridgeConfig.timeoutMs,
    maxPayloadBytes: bridgeConfig.maxPayloadBytes,
    interactiveOnly: bridgeConfig.interactiveOnly,
    moduleAttached: false,
    ready: false,
    readySource: null,
    sent: 0,
    received: 0,
    resolved: 0,
    timedOut: 0,
    errors: 0,
    pending: 0,
    lastRequestId: null,
    lastResponseId: null,
    lastResponseStatus: null,
    lastError: null,
  };
  smokeState.serviceBridge = state;

  const markReady = (source) => {
    state.ready = true;
    state.readySource = source;
  };

  const attachModule = (nextModule) => {
    module = nextModule;
    state.moduleAttached = Boolean(module);
  };

  const sendFrame = (frame) => {
    if (!module || typeof module._qemu_wasm_chardev_write_pending !== "function") {
      throw new Error("QEMU WebAssembly service chardev is not available");
    }
    const text = `${JSON.stringify(frame)}\n`;
    const payloadBytes = encoder.encode(text).length;
    if (payloadBytes > bridgeConfig.maxPayloadBytes) {
      throw new Error("service bridge request exceeds maxPayloadBytes");
    }
    module.qemuWasmChardevPendingChannel = bridgeConfig.requestChannel;
    module.qemuWasmChardevPendingText = text;
    const status = Number(module._qemu_wasm_chardev_write_pending());
    if (!Number.isInteger(status) || status < 0) {
      throw new Error(`service bridge write failed: ${status}`);
    }
    state.sent += 1;
    state.lastRequestId = String(frame.id);
    return status;
  };

  const request = (requestFrame, options = {}) => {
    if (requestFrame === null || typeof requestFrame !== "object" || Array.isArray(requestFrame)) {
      return Promise.reject(new Error("service bridge request must be an object"));
    }
    const id = serviceBridgeRequestId(requestFrame, ++sequence);
    const frame = { ...requestFrame, id };
    const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : bridgeConfig.timeoutMs;
    return new Promise((resolve, reject) => {
      let timeout = null;
      pending.set(id, {
        resolve,
        reject,
        timer: null,
      });
      state.pending = pending.size;
      timeout = setTimeout(() => {
        if (!pending.has(id)) {
          return;
        }
        pending.delete(id);
        state.pending = pending.size;
        state.timedOut += 1;
        reject(new Error(`service bridge request timed out: ${id}`));
      }, timeoutMs);
      pending.get(id).timer = timeout;
      try {
        sendFrame(frame);
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        state.pending = pending.size;
        reject(error);
      }
    });
  };

  const handleResponse = (response) => {
    state.received += 1;
    state.lastResponseId = typeof response.id === "string" ? response.id : null;
    state.lastResponseStatus = serviceBridgeResponseStatus(response);
    if (state.lastResponseId === null || !pending.has(state.lastResponseId)) {
      return;
    }
    const entry = pending.get(state.lastResponseId);
    pending.delete(state.lastResponseId);
    clearTimeout(entry.timer);
    state.pending = pending.size;
    state.resolved += 1;
    entry.resolve(response);
  };

  const receive = (channel, bytes) => {
    if (channel !== bridgeConfig.responseChannel) {
      return false;
    }
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    responseBuffer += decoder.decode(data, { stream: true });
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      try {
        handleResponse(JSON.parse(line));
      } catch (error) {
        serviceBridgeError(state, error);
      }
    }
    return true;
  };

  const bridge = {
    attachModule,
    markReady,
    receive,
    request,
    state,
  };

  scope.qemuWasmChardevReceive = receive;
  scope.qemuWasmServiceBridge = bridge;
  if (typeof scope.addEventListener === "function") {
    scope.addEventListener("message", (event) => {
      const sameOrigin = !scope.location || event.origin === scope.location.origin;
      if (!sameOrigin || !event.data || event.data.type !== "qemu-wasm-service-request") {
        return;
      }
      request(event.data.request || {}, event.data.options || {})
        .then((response) => {
          event.source?.postMessage({
            type: "qemu-wasm-service-response",
            id: event.data.id || null,
            response,
          }, event.origin);
        })
        .catch((error) => {
          event.source?.postMessage({
            type: "qemu-wasm-service-response",
            id: event.data.id || null,
            error: serviceBridgeError(state, error),
          }, event.origin);
        });
    });
  }

  return bridge;
}

export function qemuArgs(config) {
  const defaultKernelAppend = config.initrd
    ? "console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1"
    : "console=ttyS0 earlyprintk=serial,ttyS0,115200 root=/dev/vda rw init=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1";
  const kernelAppend = [
    config.kernelAppend === null ? defaultKernelAppend : config.kernelAppend,
    config.appendExtra,
  ].filter(Boolean).join(" ");
  const args = [
    "-M",
    config.machine,
    "-m",
    config.memory,
  ];
  if (config.cpu) {
    args.push("-cpu", config.cpu);
  }
  args.push("-accel", "tcg,thread=single");
  if (config.display === "none") {
    if (!["default", "none"].includes(config.displayDevice)) {
      throw new Error("displayDevice requires display=sdl or display=wasm");
    }
    args.push("-nographic");
  } else if (config.display === "sdl" || config.display === "wasm") {
    args.push("-display", config.display === "sdl" ? "sdl,gl=off" : "wasm");
    if (config.displayDevice === "none") {
      args.push("-vga", "none");
    } else if (config.displayDevice === "stdvga") {
      args.push("-vga", "std");
    } else if (config.displayDevice === "virtio-vga") {
      args.push("-vga", "virtio");
    } else if (config.displayDevice === "virtio-gpu-pci") {
      args.push("-vga", "none", "-device", "virtio-gpu-pci");
    } else if (config.displayDevice !== "default") {
      throw new Error("unsupported displayDevice");
    }
  } else {
    throw new Error("display must be none, sdl, or wasm");
  }
  args.push(
    "-serial", "mon:stdio",
    "-monitor", "none",
    "-kernel", "/kernel",
  );
  if (config.initrd) {
    args.push("-initrd", "/initramfs.cpio.gz");
  }
  args.push("-append", kernelAppend);
  if (config.rootfs) {
    if (config.rootfsDevice === "virtio-mmio") {
      args.push(
        "-drive",
        "file=/rootfs.raw,format=raw,if=none,id=hd0",
        "-device",
        "virtio-blk-device,drive=hd0",
      );
    } else {
      args.push("-drive", "file=/rootfs.raw,format=raw,if=virtio");
    }
  }
  if (config.serviceBridge) {
    const requestChardev = "qemu-wasm-service-request";
    const responseChardev = "qemu-wasm-service-response";
    const maxPayload = Number(config.serviceBridge.maxPayloadBytes) || 4096;
    args.push(
      "-chardev",
      `wasm,id=${requestChardev},channel=${config.serviceBridge.requestChannel},max-payload=${maxPayload}`,
      "-chardev",
      `wasm,id=${responseChardev},channel=${config.serviceBridge.responseChannel},max-payload=${maxPayload}`,
      "-device",
      "virtio-serial-pci",
      "-device",
      `virtserialport,chardev=${requestChardev},name=${config.serviceBridge.requestChannel}`,
      "-device",
      `virtserialport,chardev=${responseChardev},name=${config.serviceBridge.responseChannel}`,
    );
  }
  if (config.network === "none") {
    args.push("-nic", "none");
  }
  args.push("-L", "/firmware");
  args.push(...config.qemuArgs);
  return args;
}

export function recordHarnessFailure(state, error, elapsedMs) {
  if (!state) {
    return null;
  }
  state.failurePhase = state.phase;
  state.phase = "failed";
  state.failureName = error && error.name ? error.name : "Error";
  state.failure = error && error.message ? error.message : String(error);
  state.failureStack = error && error.stack ? error.stack : null;
  state.phases.push({
    phase: "failed",
    elapsedMs,
    failedDuring: state.failurePhase,
    message: state.failure,
    name: state.failureName,
  });
  return state;
}

function wasmMemory64Probe(wasm) {
  if (!wasm || typeof wasm.Memory !== "function") {
    return {
      supported: false,
      errorName: "Error",
      errorMessage: "WebAssembly.Memory is not available",
    };
  }
  try {
    new wasm.Memory({ initial: 1, maximum: 1, address: "i64" });
    return {
      supported: true,
      errorName: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      supported: false,
      errorName: error && error.name ? error.name : "Error",
      errorMessage: error && error.message ? error.message : String(error),
    };
  }
}

export function browserRuntimeSnapshot(scope = globalThis) {
  const nav = scope.navigator || {};
  const perf = scope.performance || {};
  const memory = perf.memory || {};
  return {
    crossOriginIsolated: Boolean(scope.crossOriginIsolated),
    sharedArrayBuffer: typeof scope.SharedArrayBuffer !== "undefined",
    webAssembly: typeof scope.WebAssembly !== "undefined",
    wasmMemory64: wasmMemory64Probe(scope.WebAssembly),
    userAgent: typeof nav.userAgent === "string" ? nav.userAgent : null,
    hardwareConcurrency: Number.isInteger(nav.hardwareConcurrency)
      ? nav.hardwareConcurrency
      : null,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    jsHeapSizeLimit: Number.isFinite(memory.jsHeapSizeLimit)
      ? memory.jsHeapSizeLimit
      : null,
  };
}

const BROWSER_SHORTCUT_KEYS = new Set([
  "l",
  "n",
  "p",
  "r",
  "t",
  "w",
]);
const CAPTURED_BROWSER_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "PageDown",
  "PageUp",
  "Tab",
]);

const BROWSER_CODE_TO_LINUX = new Map([
  ["Backquote", 41],
  ["Backslash", 43],
  ["Backspace", 14],
  ["BracketLeft", 26],
  ["BracketRight", 27],
  ["Comma", 51],
  ["ControlLeft", 29],
  ["ControlRight", 97],
  ["Digit0", 11],
  ["Digit1", 2],
  ["Digit2", 3],
  ["Digit3", 4],
  ["Digit4", 5],
  ["Digit5", 6],
  ["Digit6", 7],
  ["Digit7", 8],
  ["Digit8", 9],
  ["Digit9", 10],
  ["Enter", 28],
  ["Equal", 13],
  ["Escape", 1],
  ["F1", 59],
  ["F2", 60],
  ["F3", 61],
  ["F4", 62],
  ["F5", 63],
  ["F6", 64],
  ["F7", 65],
  ["F8", 66],
  ["F9", 67],
  ["F10", 68],
  ["F11", 87],
  ["F12", 88],
  ["Minus", 12],
  ["Period", 52],
  ["Quote", 40],
  ["Semicolon", 39],
  ["ShiftLeft", 42],
  ["ShiftRight", 54],
  ["Slash", 53],
  ["Space", 57],
  ["Tab", 15],
  ["AltLeft", 56],
  ["AltRight", 100],
  ["ArrowDown", 108],
  ["ArrowLeft", 105],
  ["ArrowRight", 106],
  ["ArrowUp", 103],
  ["Delete", 111],
  ["End", 107],
  ["Home", 102],
  ["Insert", 110],
  ["PageDown", 109],
  ["PageUp", 104],
  ["MetaLeft", 125],
  ["MetaRight", 126],
  ["KeyA", 30],
  ["KeyB", 48],
  ["KeyC", 46],
  ["KeyD", 32],
  ["KeyE", 18],
  ["KeyF", 33],
  ["KeyG", 34],
  ["KeyH", 35],
  ["KeyI", 23],
  ["KeyJ", 36],
  ["KeyK", 37],
  ["KeyL", 38],
  ["KeyM", 50],
  ["KeyN", 49],
  ["KeyO", 24],
  ["KeyP", 25],
  ["KeyQ", 16],
  ["KeyR", 19],
  ["KeyS", 31],
  ["KeyT", 20],
  ["KeyU", 22],
  ["KeyV", 47],
  ["KeyW", 17],
  ["KeyX", 45],
  ["KeyY", 21],
  ["KeyZ", 44],
]);

export function browserKeyLinuxCode(event) {
  const code = event && typeof event.code === "string" ? event.code : "";
  return BROWSER_CODE_TO_LINUX.get(code) || 0;
}

export function deliverDisplayKeyEvent(event, down, inputSink) {
  if (typeof inputSink !== "function") {
    return false;
  }
  const linuxCode = browserKeyLinuxCode(event);
  if (linuxCode === 0) {
    return false;
  }
  return inputSink(linuxCode, down) !== false;
}

export function displayKeyPolicy(event) {
  if (event.key === "Escape") {
    return "release-focus";
  }
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (event.metaKey || event.altKey || (event.ctrlKey && BROWSER_SHORTCUT_KEYS.has(key))) {
    return "browser-shortcut";
  }
  if (CAPTURED_BROWSER_KEYS.has(event.key)) {
    return "capture-browser-key";
  }
  return "pass-through";
}

export function installDisplayInputPolicy(canvas, displayState, inputSink = null) {
  if (!canvas || !displayState) {
    return null;
  }
  const policy = {
    browserShortcutsReserved: true,
    escapeReleasesFocus: true,
    paste: "capture-metadata",
    pointerFocus: "focus-on-pointer-down",
    pointerLock: false,
    capturedKeys: [...CAPTURED_BROWSER_KEYS].sort(),
  };
  displayState.inputPolicy = policy;
  displayState.focusEvents = 0;
  displayState.blurEvents = 0;
  displayState.pointerFocusEvents = 0;
  displayState.escapeReleaseEvents = 0;
  displayState.browserShortcutEvents = 0;
  displayState.capturedBrowserKeyEvents = 0;
  displayState.deliveredKeyEvents = 0;
  displayState.pasteEvents = 0;
  displayState.lastPasteLength = 0;
  canvas.dataset.inputActive = canvas.ownerDocument && canvas.ownerDocument.activeElement === canvas
    ? "true"
    : "false";
  canvas.title = "QEMU display. Escape releases keyboard focus.";
  canvas.addEventListener("focus", () => {
    displayState.focused = true;
    displayState.focusEvents += 1;
    canvas.dataset.inputActive = "true";
  });
  canvas.addEventListener("blur", () => {
    displayState.focused = false;
    displayState.blurEvents += 1;
    canvas.dataset.inputActive = "false";
  });
  canvas.addEventListener("pointerdown", () => {
    displayState.pointerFocusEvents += 1;
    canvas.focus();
  });
  canvas.addEventListener("keydown", (event) => {
    const action = displayKeyPolicy(event);
    if (action === "release-focus") {
      displayState.escapeReleaseEvents += 1;
      event.preventDefault();
      canvas.blur();
    } else if (action === "browser-shortcut") {
      displayState.browserShortcutEvents += 1;
    } else if (action === "capture-browser-key") {
      displayState.capturedBrowserKeyEvents += 1;
      event.preventDefault();
      if (deliverDisplayKeyEvent(event, true, inputSink)) {
        displayState.deliveredKeyEvents += 1;
      }
    } else if (deliverDisplayKeyEvent(event, true, inputSink)) {
      displayState.deliveredKeyEvents += 1;
      event.preventDefault();
    }
  });
  canvas.addEventListener("keyup", (event) => {
    const action = displayKeyPolicy(event);
    if (action === "release-focus" || action === "browser-shortcut") {
      return;
    }
    if (deliverDisplayKeyEvent(event, false, inputSink)) {
      displayState.deliveredKeyEvents += 1;
      event.preventDefault();
    }
  });
  canvas.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    const text = data && typeof data.getData === "function"
      ? data.getData("text/plain")
      : "";
    displayState.pasteEvents += 1;
    displayState.lastPasteLength = text.length;
    event.preventDefault();
  });
  return policy;
}

export function updateWasmDisplayKeyStats(module, displayState) {
  if (!module || !displayState) {
    return null;
  }
  const readCounter = (name) => {
    const fn = module[name];
    if (typeof fn !== "function") {
      return null;
    }
    const value = Number(fn());
    return Number.isFinite(value) ? value : null;
  };
  const stats = {
    received: readCounter("_qemu_wasm_display_key_events_received"),
    dropped: readCounter("_qemu_wasm_display_key_events_dropped"),
    drained: readCounter("_qemu_wasm_display_key_events_drained"),
    sent: readCounter("_qemu_wasm_display_key_events_sent"),
  };
  if (Object.values(stats).every((value) => value === null)) {
    return null;
  }
  displayState.wasmKeyStats = stats;
  return stats;
}

export function emscriptenModuleCanvas(display, canvas) {
  if (display === "sdl") {
    return canvas;
  }
  if (!["none", "wasm"].includes(display) || !canvas || !canvas.ownerDocument) {
    return undefined;
  }
  const document = canvas.ownerDocument;
  let workerCanvas = document.getElementById("qemu-wasm-worker-canvas");
  if (!workerCanvas) {
    workerCanvas = document.createElement("canvas");
    workerCanvas.id = "qemu-wasm-worker-canvas";
    workerCanvas.hidden = true;
    workerCanvas.width = 1;
    workerCanvas.height = 1;
    workerCanvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(workerCanvas);
  }
  return workerCanvas;
}

export function browserNonInteractiveStdin() {
  return null;
}

export function installBrowserDialogSuppression(globalObject, smokeState) {
  const windowObject = globalObject && globalObject.window
    ? globalObject.window
    : globalObject;
  if (!windowObject) {
    return null;
  }

  const original = {
    alert: windowObject.alert,
    confirm: windowObject.confirm,
    prompt: windowObject.prompt,
  };
  const dialogs = {
    alertCount: 0,
    confirmCount: 0,
    promptCount: 0,
    suppressed: true,
  };
  if (smokeState) {
    smokeState.browserDialogs = dialogs;
  }

  if (typeof original.alert === "function") {
    windowObject.alert = (message) => {
      dialogs.alertCount += 1;
      dialogs.lastAlert = String(message);
    };
  }
  if (typeof original.confirm === "function") {
    windowObject.confirm = (message) => {
      dialogs.confirmCount += 1;
      dialogs.lastConfirm = String(message);
      return false;
    };
  }
  if (typeof original.prompt === "function") {
    windowObject.prompt = (message, fallback = "") => {
      dialogs.promptCount += 1;
      dialogs.lastPrompt = String(message);
      if (fallback === "i") {
        return "i";
      }
      return null;
    };
  }

  return () => {
    if (typeof original.alert === "function") {
      windowObject.alert = original.alert;
    }
    if (typeof original.confirm === "function") {
      windowObject.confirm = original.confirm;
    }
    if (typeof original.prompt === "function") {
      windowObject.prompt = original.prompt;
    }
  };
}

function buildConfig() {
  return {
    appendExtra: option("appendExtra", ""),
    allowSerialFallback: boolOption("allowSerialFallback", true),
    cpu: option("cpu", "Nehalem"),
    display: option("display", "none"),
    displayDevice: option("displayDevice", "default"),
    expectText: listOption("expectText"),
    expectedResolution: option("expectedResolution", ""),
    focusDisplay: boolOption("focusDisplay", false),
    harnessExpectedKeyEvents: nonNegativeNumberOption("harnessExpectedKeyEvents", 0),
    harnessSelfTest: boolOption("harnessSelfTest", false),
    initrd: pathOption("initrd", "/guest/initramfs.cpio.gz"),
    kernel: option("kernel", "/guest/kernel"),
    kernelAppend: option("kernelAppend", null),
    linuxboot: option("linuxboot", "/firmware/linuxboot_dma.bin"),
    machine: option("machine", "microvm,acpi=off"),
    marker: option("marker", DEFAULT_MARKER),
    maxOutputBytes: numberOption("maxOutputBytes", 60000),
    memory: option("memory", "512M"),
    network: option("network", "none"),
    program: option("program", "/artifacts/qemu-system-x86_64.js"),
    qemuArgs: listOption("qemuArg"),
    qboot: option("qboot", "/firmware/qboot.rom"),
    rootfs: pathOption("rootfs", ""),
    rootfsDevice: option("rootfsDevice", "virtio-mmio"),
    serviceBridge: jsonObjectOption("serviceBridge", null),
    timeoutMs: numberOption("timeoutMs", 180000),
    visualMarker: option("visualMarker", ""),
    wasm: option("wasm", "/artifacts/qemu-system-x86_64.wasm"),
  };
}

function drawHarnessSelfTestFrame(canvas) {
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2D canvas context is not available for harness self-test");
  }
  context.fillStyle = "rgb(0, 0, 0)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgb(255, 0, 0)";
  context.fillRect(0, 0, 16, 16);
  context.fillStyle = "rgb(0, 255, 0)";
  context.fillRect(16, 0, 16, 16);
  context.fillStyle = "rgb(0, 0, 255)";
  context.fillRect(32, 0, 16, 16);
  context.fillStyle = "rgb(255, 255, 255)";
  context.fillRect(48, 0, 16, 16);
  context.fillStyle = "rgb(255, 255, 0)";
  context.fillRect(0, 16, 64, 4);
}

export function drawBrowserStatusFrame(canvas, message) {
  if (!canvas || canvas.hidden) {
    return false;
  }
  if (canvas.width <= 1 || canvas.height <= 1) {
    canvas.width = 720;
    canvas.height = 400;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return false;
  }
  context.fillStyle = "rgb(5, 5, 5)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgb(230, 230, 230)";
  context.font = "20px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, canvas.width / 2, canvas.height / 2);
  return true;
}

async function run() {
  const status = text("status");
  const output = text("output");
  const canvas = text("canvas");
  const config = buildConfig();
  if (!["none", "sdl", "wasm"].includes(config.display)) {
    throw new Error("display must be none, sdl, or wasm");
  }
  if (!["default", "none", "stdvga", "virtio-vga", "virtio-gpu-pci"].includes(config.displayDevice)) {
    throw new Error("displayDevice must be default, none, stdvga, virtio-vga, or virtio-gpu-pci");
  }
  if (!["sdl", "wasm"].includes(config.display) && !["default", "none"].includes(config.displayDevice)) {
    throw new Error("displayDevice requires display=sdl or display=wasm");
  }
  if (!["virtio-mmio", "virtio-pci"].includes(config.rootfsDevice)) {
    throw new Error("rootfsDevice must be virtio-mmio or virtio-pci");
  }
  if (!["none", "default"].includes(config.network)) {
    throw new Error("network must be none or default");
  }
  const programUrl = new URL(config.program, window.location.href);
  const wasmUrl = new URL(config.wasm, window.location.href);
  const generatedQemuArgs = qemuArgs(config);
  const expectedResolution = parseResolution(config.expectedResolution);
  const startTime = performance.now();
  const smokeState = {
    lines: 0,
    outputBytes: 0,
    outputSuppressed: false,
    phase: "init",
    phases: [],
    startedAtMs: startTime,
    qemuArgs: generatedQemuArgs,
    runtime: browserRuntimeSnapshot(globalThis),
    display: {
      mode: config.display,
      allowSerialFallback: config.allowSerialFallback,
      focused: false,
      canvasPresent: Boolean(canvas),
      device: config.displayDevice,
      expectedResolution,
      visualMarker: config.visualMarker,
    },
    markerSeen: false,
    expectedTextSeen: config.expectText.map((text) => ({ text, seen: false })),
    lastLine: "",
    programExitStatus: null,
  };
  globalThis.qemuWasmSmokeState = smokeState;
  installBrowserDialogSuppression(globalThis, smokeState);
  const serviceBridge = createServiceBridge(config, smokeState, globalThis);
  let qemuKeySink = null;
  let qemuModule = null;
  const setPhase = (phase, message = phase) => {
    smokeState.phase = phase;
    smokeState.phases.push({
      phase,
      elapsedMs: Math.round(performance.now() - startTime),
      message,
    });
    status.textContent = message;
  };
  setPhase("init", "initializing smoke harness");
  if (config.display === "sdl" || config.display === "wasm") {
    canvas.hidden = false;
    canvas.setAttribute("aria-hidden", "false");
    installDisplayInputPolicy(canvas, smokeState.display, (linuxKey, down) => {
      if (qemuKeySink === null) {
        return false;
      }
      return qemuKeySink(linuxKey, down) !== false;
    });
    if (expectedResolution !== null) {
      canvas.width = expectedResolution.width;
      canvas.height = expectedResolution.height;
    }
    if (config.focusDisplay) {
      canvas.focus();
    }
    drawBrowserStatusFrame(canvas, "Loading Bus Engine OS guest...");
    smokeState.display.focused = document.activeElement === canvas;
    smokeState.display.canvasWidth = canvas.width;
    smokeState.display.canvasHeight = canvas.height;
  } else {
    canvas.hidden = true;
    canvas.setAttribute("aria-hidden", "true");
  }

  if (config.harnessSelfTest) {
    if (!["sdl", "wasm"].includes(config.display)) {
      throw new Error("harnessSelfTest requires display=sdl or display=wasm");
    }
    if (config.focusDisplay) {
      canvas.focus();
      smokeState.display.focused = document.activeElement === canvas;
    }
  }

  const mounts = [
    { url: config.kernel, path: "/kernel" },
    { url: config.qboot, path: "/firmware/qboot.rom" },
    { url: config.linuxboot, path: "/firmware/linuxboot_dma.bin" },
  ];
  for (const name of OPTIONAL_FIRMWARE_FILES) {
    mounts.push({
      optional: true,
      path: `/firmware/${name}`,
      url: `/firmware/${name}`,
    });
  }
  if (config.initrd) {
    mounts.push({ url: config.initrd, path: "/initramfs.cpio.gz" });
  }
  if (config.rootfs) {
    mounts.push({ url: config.rootfs, path: "/rootfs.raw" });
  }

  setPhase("validate-browser", "validating browser WebAssembly features");
  if (!crossOriginIsolated) {
    throw new Error("cross-origin isolation is required for pthread WebAssembly");
  }
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("SharedArrayBuffer is not available");
  }

  if (config.harnessSelfTest) {
    const keyEvents = [];
    const timeout = setTimeout(() => {
      setPhase(
        "timeout",
        `timeout waiting for harness key events: ${config.harnessExpectedKeyEvents}`,
      );
    }, config.timeoutMs);
    qemuKeySink = (linuxKey, down) => {
      keyEvents.push({ linuxKey, down: Boolean(down) });
      smokeState.display.harnessKeyEvents = keyEvents;
      smokeState.display.harnessKeyEventCount = keyEvents.length;
      if (keyEvents.length >= config.harnessExpectedKeyEvents) {
        smokeState.markerSeen = true;
        clearTimeout(timeout);
        setPhase("success", `marker reached: ${config.marker}`);
      }
    };
    drawHarnessSelfTestFrame(canvas);
    smokeState.display.canvasWidth = canvas.width;
    smokeState.display.canvasHeight = canvas.height;
    smokeState.display.harnessSelfTest = true;
    smokeState.display.harnessExpectedKeyEvents = config.harnessExpectedKeyEvents;
    setPhase("harness-self-test", "browser harness self-test ready");
    if (config.harnessExpectedKeyEvents === 0) {
      smokeState.markerSeen = true;
      clearTimeout(timeout);
      setPhase("success", `marker reached: ${config.marker}`);
    }
    return;
  }

  const timeout = setTimeout(() => {
    if (!smokeState.markerSeen || !allExpectedTextSeen()) {
      const missing = smokeState.expectedTextSeen
        .filter((expected) => !expected.seen)
        .map((expected) => expected.text);
      setPhase("timeout", missing.length === 0
        ? `timeout waiting for marker: ${config.marker}`
        : `timeout waiting for marker or expected text: ${missing.join(", ")}`);
    }
  }, config.timeoutMs);

  const allExpectedTextSeen = () =>
    smokeState.expectedTextSeen.every((expected) => expected.seen);

  const maybeComplete = () => {
    if (smokeState.markerSeen && allExpectedTextSeen()) {
      clearTimeout(timeout);
      setPhase("success", `marker reached: ${config.marker}`);
    }
  };

  const emit = (line) => {
    smokeState.lines += 1;
    smokeState.lastLine = line;
    if (smokeState.outputBytes < config.maxOutputBytes) {
      const encoded = new TextEncoder().encode(`${line}\n`);
      const remaining = config.maxOutputBytes - smokeState.outputBytes;
      if (encoded.length <= remaining) {
        appendLine(output, line);
        smokeState.outputBytes += encoded.length;
      } else {
        appendLine(output, new TextDecoder().decode(encoded.slice(0, remaining)));
        smokeState.outputBytes += remaining;
      }
    }
    if (smokeState.outputBytes >= config.maxOutputBytes && !smokeState.outputSuppressed) {
      smokeState.outputSuppressed = true;
      appendLine(output, `wasm-browser-smoke: output suppressed after ${config.maxOutputBytes} bytes`);
    }
    if (line.includes(config.marker)) {
      smokeState.markerSeen = true;
    }
    if (serviceBridge && line.includes(config.serviceBridge.readinessMarker)) {
      serviceBridge.markReady("serial");
    }
    for (const expected of smokeState.expectedTextSeen) {
      if (!expected.seen && line.includes(expected.text)) {
        expected.seen = true;
      }
    }
    maybeComplete();
    const exitStatus = programExitStatus(line);
    if (
      exitStatus !== null &&
      (!smokeState.markerSeen || !allExpectedTextSeen())
    ) {
      smokeState.programExitStatus = exitStatus;
      clearTimeout(timeout);
      setPhase("program-exit", `program exited before marker: status ${exitStatus}`);
    }
  };

  setPhase("fetch-guest-inputs", "loading smoke guest inputs");
  drawBrowserStatusFrame(canvas, "Loading Bus Engine OS guest...");
  for (const mount of mounts) {
    mount.data = mount.optional
      ? await fetchOptionalBytes(mount.url)
      : await fetchBytes(mount.url);
  }
  const availableMounts = mounts.filter((mount) => mount.data !== null);

  setPhase("import-qemu-module", "loading QEMU WebAssembly module");
  drawBrowserStatusFrame(canvas, "Loading QEMU WebAssembly runtime...");
  const moduleFactory = (await import(programUrl.href)).default;
  setPhase("start-qemu", "starting QEMU");
  drawBrowserStatusFrame(canvas, "Starting QEMU...");
  const installWasmKeySink = (module) => {
    if (config.display === "wasm" && typeof module._qemu_wasm_display_key_event === "function") {
      qemuKeySink = (linuxKey, down) => {
        smokeState.display.wasmKeySinkCalls =
          (Number(smokeState.display.wasmKeySinkCalls) || 0) + 1;
        try {
          module._qemu_wasm_display_key_event(linuxKey, down ? 1 : 0);
          updateWasmDisplayKeyStats(module, smokeState.display);
          return true;
        } catch (error) {
          smokeState.display.wasmKeySinkErrors =
            (Number(smokeState.display.wasmKeySinkErrors) || 0) + 1;
          smokeState.display.lastWasmKeySinkError =
            error && error.message ? error.message : String(error);
          return false;
        }
      };
      updateWasmDisplayKeyStats(module, smokeState.display);
    }
  };
  const moduleOptions = {
    arguments: generatedQemuArgs,
    qemuWasmDisplayCanvas: canvas,
    locateFile(path) {
      if (path === "qemu-system-x86_64.wasm") {
        return wasmUrl.href;
      }
      return new URL(path, programUrl).href;
    },
    mainScriptUrlOrBlob: programUrl.href,
    preRun: [
      (module) => {
        mountFiles(module, availableMounts);
      },
    ],
    onRuntimeInitialized() {
      installWasmKeySink(moduleOptions);
    },
    print: emit,
    printErr: emit,
    stdin: browserNonInteractiveStdin,
  };
  const moduleCanvas = emscriptenModuleCanvas(config.display, canvas);
  if (moduleCanvas !== undefined) {
    moduleOptions.canvas = moduleCanvas;
  }
  qemuModule = await moduleFactory(moduleOptions);
  installWasmKeySink(qemuModule);
  if (serviceBridge) {
    serviceBridge.attachModule(qemuModule);
  }
  if (config.display === "wasm") {
    setInterval(() => {
      updateWasmDisplayKeyStats(qemuModule, smokeState.display);
    }, 250);
  }
  if (!smokeState.markerSeen || !allExpectedTextSeen()) {
    setPhase("guest-boot", "QEMU started; waiting for marker");
  }
}

if (typeof window !== "undefined") {
  run().catch((error) => {
    const state = globalThis.qemuWasmSmokeState;
    if (state) {
      recordHarnessFailure(
        state,
        error,
        typeof state.startedAtMs === "number"
          ? Math.round(performance.now() - state.startedAtMs)
          : 0,
      );
    }
    text("status").textContent = "failed";
    appendLine(text("output"), error && error.stack ? error.stack : String(error));
  });
}
