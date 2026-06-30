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
      throw new Error("displayDevice requires display=sdl");
    }
    args.push("-nographic");
  } else if (config.display === "sdl") {
    args.push("-display", "sdl,gl=off");
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
    throw new Error("display must be none or sdl");
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

export function installDisplayInputPolicy(canvas, displayState) {
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
    timeoutMs: numberOption("timeoutMs", 180000),
    visualMarker: option("visualMarker", ""),
    wasm: option("wasm", "/artifacts/qemu-system-x86_64.wasm"),
  };
}

async function run() {
  const status = text("status");
  const output = text("output");
  const canvas = text("canvas");
  const config = buildConfig();
  if (!["none", "sdl"].includes(config.display)) {
    throw new Error("display must be none or sdl");
  }
  if (!["default", "none", "stdvga", "virtio-vga", "virtio-gpu-pci"].includes(config.displayDevice)) {
    throw new Error("displayDevice must be default, none, stdvga, virtio-vga, or virtio-gpu-pci");
  }
  if (config.display !== "sdl" && !["default", "none"].includes(config.displayDevice)) {
    throw new Error("displayDevice requires display=sdl");
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
  if (config.display === "sdl") {
    canvas.hidden = false;
    canvas.setAttribute("aria-hidden", "false");
    installDisplayInputPolicy(canvas, smokeState.display);
    if (expectedResolution !== null) {
      canvas.width = expectedResolution.width;
      canvas.height = expectedResolution.height;
    }
    if (config.focusDisplay) {
      canvas.focus();
    }
    smokeState.display.focused = document.activeElement === canvas;
    smokeState.display.canvasWidth = canvas.width;
    smokeState.display.canvasHeight = canvas.height;
  } else {
    canvas.hidden = true;
    canvas.setAttribute("aria-hidden", "true");
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
  for (const mount of mounts) {
    mount.data = mount.optional
      ? await fetchOptionalBytes(mount.url)
      : await fetchBytes(mount.url);
  }
  const availableMounts = mounts.filter((mount) => mount.data !== null);

  setPhase("import-qemu-module", "loading QEMU WebAssembly module");
  const moduleFactory = (await import(programUrl.href)).default;
  setPhase("start-qemu", "starting QEMU");
  await moduleFactory({
    arguments: generatedQemuArgs,
    canvas,
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
    print: emit,
    printErr: emit,
  });
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
