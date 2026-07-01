#!/usr/bin/env node
/*
 * Run the QEMU WebAssembly browser smoke harness with Playwright.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";
import {
  loadPlaywrightBrowser,
  playwrightLaunchOptions,
} from "./wasm-playwright-loader.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const MAX_DIAGNOSTIC_ENTRIES = 50;
const DEFAULT_PAGE_TEXT_TAIL_BYTES = 8192;
const DEFAULT_PROGRESS_SAMPLE_INTERVAL_MS = 10000;
const DEFAULT_PROGRESS_SAMPLE_LIMIT = 120;
const DEFAULT_IDLE_TIMEOUT_MS = 0;

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-smoke-runner.mjs --artifact-dir DIR --kernel FILE --initrd FILE [OPTIONS]

Options:
  --append-extra TEXT Extra Linux kernel arguments appended to the default
  --artifact-dir DIR  Directory containing qemu-system-*.js/.wasm artifacts
  --browser NAME      Browser engine to launch (default: chromium)
  --cpu MODEL         Guest CPU model passed to QEMU
  --display MODE     Browser display mode: none, sdl, or wasm (default: none)
  --display-device KIND
                     QEMU display device: default, none, stdvga,
                     virtio-vga, or virtio-gpu-pci
  --expected-resolution WIDTHxHEIGHT
                     Expected browser canvas resolution metadata
  --expect-display-hash HASH
                     Require an exact display pixel hash
  --expect-text TEXT  Additional output text required for success
  --focus-display    Focus the browser display surface before QEMU starts
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --guest-manifest FILE
                     JSON file with guest and runner defaults
  --harness-self-test
                     Run deterministic browser display/input harness proof
                     without launching QEMU
  --harness-expected-key-events N
                     Expected delivered key events in --harness-self-test
  --host HOST         Bind address for the local smoke server
  --idle-timeout-ms MS
                     Fail when serial output is idle for this long
                     after guest output has started (default: disabled)
  --idle-after-text TEXT
                     Only apply --idle-timeout-ms while the last serial line
                     contains this text
  --initrd FILE       Smoke initramfs image
  --kernel FILE       64-bit Linux bzImage
  --keyboard-after-text TEXT
                     Wait until browser-captured serial output contains TEXT
                     before typing --keyboard-text
  --keyboard-text TEXT
                     Type TEXT into the focused browser display canvas
  --pre-keyboard-wait-ms MS
                     Wait after --keyboard-after-text is observed before
                     typing --keyboard-text
  --post-keyboard-wait-ms MS
                     Wait after successful marker detection before capturing
                     final display evidence when --keyboard-text is used
  --power-operation OP
                     Request a power operation after the marker gate:
                     shutdown, reboot, guest-powerdown, force-reset, or
                     force-poweroff
  --power-timeout-ms MS
                     Timeout for guest-acknowledged power operations
  --kernel-append TEXT
                     Full Linux kernel arguments, replacing smoke defaults
  --machine MACHINE  QEMU machine name passed with -M
  --marker TEXT       Output text required for success
  --max-output-bytes N
                     Maximum browser page output bytes to keep
  --memory SIZE       Guest memory size passed to QEMU
  --network MODE      Network mode: none or default (default: none)
  --no-serial-fallback
                     Record that serial-only fallback is not acceptable for
                     this display/input proof
  --out FILE          Write smoke result JSON to FILE
  --page-text-tail-bytes N
                     Maximum page text tail bytes to keep in result JSON
  --port PORT         Local smoke server port
  --program FILE      JavaScript launcher inside artifact dir
  --progress-sample-interval-ms MS
                     Interval for smoke progress samples in result JSON
  --progress-sample-limit N
                     Maximum smoke progress samples to keep
  --qemu-arg ARG     Extra QEMU argument appended to the smoke command
  --require-display-output
                     Require non-black browser display pixels before success
  --display-min-nonblack-pixels N
                     Minimum non-black pixels for --require-display-output
  --rootfs FILE       Raw root filesystem image exposed as /dev/vda
  --rootfs-device KIND
                     Rootfs block device kind: virtio-mmio or virtio-pci
  --rootfs-opfs-name NAME
                     OPFS file name used by --rootfs-storage opfs-snapshot
  --rootfs-storage MODE
                     Rootfs browser storage mode: memfs or opfs-snapshot
                     (default: memfs)
  --screenshot FILE  Save a browser page screenshot to FILE
  --screenshot-full-page
                     Capture the full scrollable page instead of the viewport
  --timeout-ms MS     Timeout in milliseconds
  --tcg-hotblocks    Enable QEMU TCG hot-block instrumentation and collect
                     summaries in result JSON
  --tcg-hotblocks-interval N
                     TB execution interval between hotspot summaries
                     (default: 10000)
  --tcg-hotblocks-op-sample N
                     Count one TCI opcode per N interpreted opcodes
                     (default: 1, exact)
  --tcg-hotblocks-op-limit N
                     Stop opcode sampling after approximately N interpreted
                     opcodes; 0 means unlimited (default: 134217728)
  --tcg-hotblocks-top N
                     Maximum hotspot entries per summary (default: 12)
  --visual-marker TEXT
                     Expected visual marker metadata for display proofs
  --help              Show this help

Environment:
  QEMU_WASM_BROWSER_EXECUTABLE
                     Browser executable path used for Playwright launch
  QEMU_WASM_CHROMIUM_EXECUTABLE
                     Chromium-specific executable path; overrides the generic
                     executable when --browser chromium
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    appendExtra: "",
    artifactDir: null,
    browser: "chromium",
    cpu: "Nehalem",
    display: "none",
    displayDevice: "default",
    expectedResolution: "",
    expectDisplayHash: "",
    expectText: [],
    focusDisplay: false,
    firmwareDir: "pc-bios",
    guestManifest: null,
    harnessExpectedKeyEvents: 0,
    harnessSelfTest: false,
    host: "127.0.0.1",
    idleAfterText: "",
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    initrd: null,
    kernel: null,
    keyboardAfterText: "",
    keyboardText: "",
    preKeyboardWaitMs: 0,
    postKeyboardWaitMs: 0,
    powerOperation: "",
    powerTimeoutMs: 30000,
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    network: "none",
    allowSerialFallback: true,
    out: null,
    pageTextTailBytes: DEFAULT_PAGE_TEXT_TAIL_BYTES,
    port: 8010,
    program: "qemu-system-x86_64.js",
    progressSampleIntervalMs: DEFAULT_PROGRESS_SAMPLE_INTERVAL_MS,
    progressSampleLimit: DEFAULT_PROGRESS_SAMPLE_LIMIT,
    qemuArgs: [],
    requireDisplayOutput: false,
    displayMinNonblackPixels: 1,
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    rootfsOpfsName: "qemu-wasm-rootfs.raw",
    rootfsStorage: "memfs",
    screenshot: null,
    screenshotFullPage: false,
    serviceBridge: null,
    tcgHotblocks: false,
    tcgHotblocksOpLimit: 134217728,
    tcgHotblocksInterval: 10000,
    tcgHotblocksOpSample: 1,
    tcgHotblocksTop: 12,
    timeoutMs: 180000,
    visualMarker: "",
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
    } else if (arg === "--browser") {
      options.browser = argv[++i];
      explicit.add("browser");
    } else if (arg === "--cpu") {
      options.cpu = argv[++i];
      explicit.add("cpu");
    } else if (arg === "--display") {
      options.display = argv[++i];
      explicit.add("display");
    } else if (arg === "--display-device") {
      options.displayDevice = argv[++i];
      explicit.add("displayDevice");
    } else if (arg === "--expected-resolution") {
      options.expectedResolution = argv[++i];
      explicit.add("expectedResolution");
    } else if (arg === "--expect-display-hash") {
      options.expectDisplayHash = argv[++i];
      explicit.add("expectDisplayHash");
    } else if (arg === "--expect-text") {
      options.expectText.push(argv[++i]);
      explicit.add("expectText");
    } else if (arg === "--focus-display") {
      options.focusDisplay = true;
      explicit.add("focusDisplay");
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
      explicit.add("firmwareDir");
    } else if (arg === "--guest-manifest") {
      options.guestManifest = argv[++i];
    } else if (arg === "--harness-expected-key-events") {
      options.harnessExpectedKeyEvents = Number(argv[++i]);
      explicit.add("harnessExpectedKeyEvents");
    } else if (arg === "--harness-self-test") {
      options.harnessSelfTest = true;
      explicit.add("harnessSelfTest");
    } else if (arg === "--host") {
      options.host = argv[++i];
      explicit.add("host");
    } else if (arg === "--idle-timeout-ms") {
      options.idleTimeoutMs = Number(argv[++i]);
      explicit.add("idleTimeoutMs");
    } else if (arg === "--idle-after-text") {
      options.idleAfterText = argv[++i];
      explicit.add("idleAfterText");
    } else if (arg === "--initrd") {
      options.initrd = argv[++i];
      explicit.add("initrd");
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
      explicit.add("kernel");
    } else if (arg === "--keyboard-after-text") {
      options.keyboardAfterText = argv[++i];
      explicit.add("keyboardAfterText");
    } else if (arg === "--keyboard-text") {
      options.keyboardText = argv[++i];
      explicit.add("keyboardText");
    } else if (arg === "--pre-keyboard-wait-ms") {
      options.preKeyboardWaitMs = Number(argv[++i]);
      explicit.add("preKeyboardWaitMs");
    } else if (arg === "--post-keyboard-wait-ms") {
      options.postKeyboardWaitMs = Number(argv[++i]);
      explicit.add("postKeyboardWaitMs");
    } else if (arg === "--power-operation") {
      options.powerOperation = argv[++i];
      explicit.add("powerOperation");
    } else if (arg === "--power-timeout-ms") {
      options.powerTimeoutMs = Number(argv[++i]);
      explicit.add("powerTimeoutMs");
    } else if (arg === "--kernel-append") {
      options.kernelAppend = argv[++i];
      explicit.add("kernelAppend");
    } else if (arg === "--machine") {
      options.machine = argv[++i];
      explicit.add("machine");
    } else if (arg === "--marker") {
      options.marker = argv[++i];
      explicit.add("marker");
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(argv[++i]);
      explicit.add("maxOutputBytes");
    } else if (arg === "--memory") {
      options.memory = argv[++i];
      explicit.add("memory");
    } else if (arg === "--network") {
      options.network = argv[++i];
      explicit.add("network");
    } else if (arg === "--no-serial-fallback") {
      options.allowSerialFallback = false;
      explicit.add("allowSerialFallback");
    } else if (arg === "--out") {
      options.out = argv[++i];
      explicit.add("out");
    } else if (arg === "--page-text-tail-bytes") {
      options.pageTextTailBytes = Number(argv[++i]);
      explicit.add("pageTextTailBytes");
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
      explicit.add("port");
    } else if (arg === "--program") {
      options.program = argv[++i];
      explicit.add("program");
    } else if (arg === "--progress-sample-interval-ms") {
      options.progressSampleIntervalMs = Number(argv[++i]);
      explicit.add("progressSampleIntervalMs");
    } else if (arg === "--progress-sample-limit") {
      options.progressSampleLimit = Number(argv[++i]);
      explicit.add("progressSampleLimit");
    } else if (arg === "--qemu-arg") {
      options.qemuArgs.push(argv[++i]);
      explicit.add("qemuArgs");
    } else if (arg === "--require-display-output") {
      options.requireDisplayOutput = true;
      explicit.add("requireDisplayOutput");
    } else if (arg === "--display-min-nonblack-pixels") {
      options.displayMinNonblackPixels = Number(argv[++i]);
      explicit.add("displayMinNonblackPixels");
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
      explicit.add("rootfs");
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
      explicit.add("rootfsDevice");
    } else if (arg === "--rootfs-opfs-name") {
      options.rootfsOpfsName = argv[++i];
      explicit.add("rootfsOpfsName");
    } else if (arg === "--rootfs-storage") {
      options.rootfsStorage = argv[++i];
      explicit.add("rootfsStorage");
    } else if (arg === "--screenshot") {
      options.screenshot = argv[++i];
      explicit.add("screenshot");
    } else if (arg === "--screenshot-full-page") {
      options.screenshotFullPage = true;
      explicit.add("screenshotFullPage");
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
      explicit.add("timeoutMs");
    } else if (arg === "--tcg-hotblocks") {
      options.tcgHotblocks = true;
      explicit.add("tcgHotblocks");
    } else if (arg === "--tcg-hotblocks-interval") {
      options.tcgHotblocksInterval = Number(argv[++i]);
      explicit.add("tcgHotblocksInterval");
    } else if (arg === "--tcg-hotblocks-op-sample") {
      options.tcgHotblocksOpSample = Number(argv[++i]);
      explicit.add("tcgHotblocksOpSample");
    } else if (arg === "--tcg-hotblocks-op-limit") {
      options.tcgHotblocksOpLimit = Number(argv[++i]);
      explicit.add("tcgHotblocksOpLimit");
    } else if (arg === "--tcg-hotblocks-top") {
      options.tcgHotblocksTop = Number(argv[++i]);
      explicit.add("tcgHotblocksTop");
    } else if (arg === "--visual-marker") {
      options.visualMarker = argv[++i];
      explicit.add("visualMarker");
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  applyGuestManifest(options, explicit, {
    booleanFields: [
      "allowSerialFallback",
      "focusDisplay",
      "harnessSelfTest",
      "requireDisplayOutput",
      "screenshotFullPage",
      "tcgHotblocks",
    ],
    checksumFields: ["kernel", "initrd", "rootfs"],
    integerFields: [
      "maxOutputBytes",
      "displayMinNonblackPixels",
      "harnessExpectedKeyEvents",
      "idleTimeoutMs",
      "pageTextTailBytes",
      "port",
      "preKeyboardWaitMs",
      "postKeyboardWaitMs",
      "powerTimeoutMs",
      "progressSampleIntervalMs",
      "progressSampleLimit",
      "tcgHotblocksInterval",
      "tcgHotblocksOpLimit",
      "tcgHotblocksOpSample",
      "tcgHotblocksTop",
      "timeoutMs",
    ],
    pathFields: [
      "artifactDir",
      "firmwareDir",
      "initrd",
      "kernel",
      "out",
      "rootfs",
      "screenshot",
    ],
    stringFields: [
      "appendExtra",
      "artifactDir",
      "browser",
      "cpu",
      "display",
      "displayDevice",
      "expectedResolution",
      "expectDisplayHash",
      "firmwareDir",
      "host",
      "idleAfterText",
      "initrd",
      "kernel",
      "keyboardAfterText",
      "keyboardText",
      "kernelAppend",
      "machine",
      "marker",
      "memory",
      "network",
      "out",
      "powerOperation",
      "program",
      "rootfs",
      "rootfsDevice",
      "rootfsOpfsName",
      "rootfsStorage",
      "screenshot",
      "visualMarker",
    ],
    stringListFields: ["expectText", "qemuArgs"],
    serviceBridgeField: "serviceBridge",
  });

  if (options.harnessSelfTest) {
    if (!explicit.has("display")) {
      options.display = "wasm";
    }
    if (!explicit.has("focusDisplay")) {
      options.focusDisplay = true;
    }
    if (!explicit.has("marker")) {
      options.marker = "QEMU_WASM_BROWSER_HARNESS_OK";
    }
    if (!explicit.has("requireDisplayOutput")) {
      options.requireDisplayOutput = true;
    }
  }

  if (!options.harnessSelfTest && options.artifactDir === null) {
    console.error("--artifact-dir is required");
    usage(2);
  }
  if (!options.harnessSelfTest && options.kernel === null) {
    console.error("--kernel is required");
    usage(2);
  }
  if (!options.harnessSelfTest && options.initrd === null && options.rootfs === null) {
    console.error("either --initrd or --rootfs is required");
    usage(2);
  }
  if (!Number.isInteger(options.harnessExpectedKeyEvents) || options.harnessExpectedKeyEvents < 0) {
    console.error("--harness-expected-key-events must be a non-negative integer");
    usage(2);
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    console.error("--port must be an integer from 1 to 65535");
    usage(2);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.tcgHotblocksInterval) || options.tcgHotblocksInterval <= 0) {
    console.error("--tcg-hotblocks-interval must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.tcgHotblocksOpSample) || options.tcgHotblocksOpSample <= 0) {
    console.error("--tcg-hotblocks-op-sample must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.tcgHotblocksOpLimit) || options.tcgHotblocksOpLimit < 0) {
    console.error("--tcg-hotblocks-op-limit must be a non-negative integer");
    usage(2);
  }
  if (
    !Number.isInteger(options.tcgHotblocksTop) ||
    options.tcgHotblocksTop <= 0 ||
    options.tcgHotblocksTop > 64
  ) {
    console.error("--tcg-hotblocks-top must be an integer from 1 to 64");
    usage(2);
  }
  if (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
    console.error("--max-output-bytes must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.idleTimeoutMs) || options.idleTimeoutMs < 0) {
    console.error("--idle-timeout-ms must be a non-negative integer");
    usage(2);
  }
  if (!Number.isInteger(options.pageTextTailBytes) || options.pageTextTailBytes <= 0) {
    console.error("--page-text-tail-bytes must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.progressSampleIntervalMs) || options.progressSampleIntervalMs <= 0) {
    console.error("--progress-sample-interval-ms must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.progressSampleLimit) || options.progressSampleLimit <= 0) {
    console.error("--progress-sample-limit must be a positive integer");
    usage(2);
  }
  if (
    !Number.isInteger(options.displayMinNonblackPixels) ||
    options.displayMinNonblackPixels <= 0
  ) {
    console.error("--display-min-nonblack-pixels must be a positive integer");
    usage(2);
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.rootfsDevice)) {
    console.error("--rootfs-device must be virtio-mmio or virtio-pci");
    usage(2);
  }
  if (!["memfs", "opfs-snapshot"].includes(options.rootfsStorage)) {
    console.error("--rootfs-storage must be memfs or opfs-snapshot");
    usage(2);
  }
  if (options.rootfsOpfsName === "" || /[\\/]/.test(options.rootfsOpfsName)) {
    console.error("--rootfs-opfs-name must be a non-empty file name without path separators");
    usage(2);
  }
  if (options.rootfsStorage === "opfs-snapshot" && options.rootfs === null) {
    console.error("--rootfs-storage opfs-snapshot requires --rootfs");
    usage(2);
  }
  if (!["none", "sdl", "wasm"].includes(options.display)) {
    console.error("--display must be none, sdl, or wasm");
    usage(2);
  }
  if (!["default", "none", "stdvga", "virtio-vga", "virtio-gpu-pci"].includes(options.displayDevice)) {
    console.error("--display-device must be default, none, stdvga, virtio-vga, or virtio-gpu-pci");
    usage(2);
  }
  if (!["sdl", "wasm"].includes(options.display) && !["default", "none"].includes(options.displayDevice)) {
    console.error("--display-device requires --display sdl or --display wasm");
    usage(2);
  }
  if (
    options.expectedResolution !== "" &&
    /^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/.test(options.expectedResolution) === false
  ) {
    console.error("--expected-resolution must use WIDTHxHEIGHT");
    usage(2);
  }
  if (options.keyboardText !== "" && !["sdl", "wasm"].includes(options.display)) {
    console.error("--keyboard-text requires --display sdl or --display wasm");
    usage(2);
  }
  if (options.keyboardAfterText !== "" && options.keyboardText === "") {
    console.error("--keyboard-after-text requires --keyboard-text");
    usage(2);
  }
  if (!Number.isInteger(options.preKeyboardWaitMs) || options.preKeyboardWaitMs < 0) {
    console.error("--pre-keyboard-wait-ms must be a non-negative integer");
    usage(2);
  }
  if (options.preKeyboardWaitMs > 0 && options.keyboardText === "") {
    console.error("--pre-keyboard-wait-ms requires --keyboard-text");
    usage(2);
  }
  if (!Number.isInteger(options.postKeyboardWaitMs) || options.postKeyboardWaitMs < 0) {
    console.error("--post-keyboard-wait-ms must be a non-negative integer");
    usage(2);
  }
  if (options.postKeyboardWaitMs > 0 && options.keyboardText === "") {
    console.error("--post-keyboard-wait-ms requires --keyboard-text");
    usage(2);
  }
  if (options.requireDisplayOutput && !["sdl", "wasm"].includes(options.display)) {
    console.error("--require-display-output requires --display sdl or --display wasm");
    usage(2);
  }
  if (options.harnessSelfTest && !["sdl", "wasm"].includes(options.display)) {
    console.error("--harness-self-test requires --display sdl or --display wasm");
    usage(2);
  }
  if (!["none", "default"].includes(options.network)) {
    console.error("--network must be none or default");
    usage(2);
  }
  if (!["", "shutdown", "reboot", "guest-powerdown", "force-reset", "force-poweroff"].includes(options.powerOperation)) {
    console.error("--power-operation must be shutdown, reboot, guest-powerdown, force-reset, force-poweroff, or empty");
    usage(2);
  }
  if (!Number.isInteger(options.powerTimeoutMs) || options.powerTimeoutMs <= 0) {
    console.error("--power-timeout-ms must be a positive integer");
    usage(2);
  }

  return options;
}

function appendBounded(list, entry) {
  appendBoundedLimit(list, entry, MAX_DIAGNOSTIC_ENTRIES);
}

export function appendBoundedLimit(list, entry, limit) {
  list.push(entry);
  if (list.length > limit) {
    list.shift();
  }
}

export function isTerminalPageStatus(status, marker) {
  return status === `marker reached: ${marker}` ||
    status.startsWith("program exited before marker:") ||
    status.startsWith("timeout waiting for ") ||
    status === "failed";
}

export function consoleMessageDiagnostic(message, elapsedMs) {
  return {
    elapsedMs,
    type: message.type(),
    text: message.text(),
    location: message.location ? message.location() : null,
  };
}

export function pageErrorDiagnostic(error, elapsedMs, state = null) {
  return {
    elapsedMs,
    name: error && error.name ? error.name : "Error",
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null,
    state,
  };
}

export function requestFailureDiagnostic(request, elapsedMs) {
  const failure = request.failure();
  return {
    elapsedMs,
    method: request.method(),
    url: request.url(),
    failureText: failure && failure.errorText ? failure.errorText : null,
  };
}

export function progressSampleDiagnostic(result, elapsedMs, reason, state) {
  const previous = result.progressSamples.length > 0
    ? result.progressSamples[result.progressSamples.length - 1]
    : null;
  const previousState = previous ? previous.state : null;
  return {
    elapsedMs,
    reason,
    state,
    lineDelta: state && previousState ? state.lines - previousState.lines : null,
    outputByteDelta: state && previousState
      ? state.outputBytes - previousState.outputBytes
      : null,
    lastLineChanged: state && previousState
      ? state.lastLine !== previousState.lastLine
      : null,
    previousElapsedMs: previous ? previous.elapsedMs : null,
  };
}

function serialProgressSignature(sample) {
  const state = sample && sample.state ? sample.state : null;
  if (state === null || !Number.isInteger(state.outputBytes)) {
    return null;
  }
  if (state.outputBytes <= 0) {
    return null;
  }
  return {
    lines: Number.isInteger(state.lines) ? state.lines : null,
    outputBytes: state.outputBytes,
    lastLine: typeof state.lastLine === "string" ? state.lastLine : "",
  };
}

function sameSerialProgress(left, right) {
  return left !== null &&
    right !== null &&
    left.lines === right.lines &&
    left.outputBytes === right.outputBytes &&
    left.lastLine === right.lastLine;
}

export function serialIdleDiagnostic(samples, idleTimeoutMs, idleAfterText = "") {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    return null;
  }
  const current = lastEntry(samples);
  const currentSignature = serialProgressSignature(current);
  if (current === null || currentSignature === null) {
    return null;
  }
  if (
    idleAfterText !== "" &&
    !currentSignature.lastLine.includes(idleAfterText)
  ) {
    return null;
  }

  let idleSinceElapsedMs = current.elapsedMs;
  for (let index = samples.length - 2; index >= 0; index--) {
    const previous = samples[index];
    const previousSignature = serialProgressSignature(previous);
    if (!sameSerialProgress(currentSignature, previousSignature)) {
      break;
    }
    idleSinceElapsedMs = previous.elapsedMs;
  }

  const idleMs = current.elapsedMs - idleSinceElapsedMs;
  if (idleMs < idleTimeoutMs) {
    return null;
  }
  return {
    idle: true,
    idleAfterText,
    idleMs,
    idleSinceElapsedMs,
    idleTimeoutMs,
    lastLine: currentSignature.lastLine,
    outputBytes: currentSignature.outputBytes,
    outputLines: currentSignature.lines,
  };
}

async function loadPlaywright(browserName) {
  try {
    return loadPlaywrightBrowser(browserName);
  } catch (error) {
    console.error(
      "Playwright is required. Run with, for example: npm exec --yes --package=playwright -- node scripts/ci/wasm-browser-smoke-runner.mjs ...",
    );
    throw error;
  }
}

function startServer(options) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(scriptDir, "wasm-browser-smoke-server.mjs");
  const args = [
    serverScript,
    "--host",
    options.host,
    "--port",
    String(options.port),
  ];
  if (options.harnessSelfTest) {
    args.push("--harness-self-test");
  } else {
    args.push(
      "--artifact-dir",
      options.artifactDir,
      "--firmware-dir",
      options.firmwareDir,
      "--kernel",
      options.kernel,
      "--program",
      options.program,
    );
  }
  if (options.initrd !== null) {
    args.push("--initrd", options.initrd);
  }
  if (options.rootfs !== null) {
    args.push("--rootfs", options.rootfs);
  }
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (data) => process.stderr.write(data));

  return new Promise((resolveReady, rejectReady) => {
    let ready = false;
    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      if (text.includes("serving QEMU WASM browser smoke test")) {
        ready = true;
        resolveReady(child);
      }
    });
    child.on("exit", (code, signal) => {
      if (!ready) {
        rejectReady(new Error(`smoke server exited before ready: code=${code} signal=${signal}`));
      }
    });
  });
}

async function stopServer(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolveDone) => {
    child.once("exit", resolveDone);
    setTimeout(resolveDone, 1000);
  });
}

function firstEntry(entries) {
  return entries && entries.length > 0 ? entries[0] : null;
}

function lastEntry(entries) {
  return entries && entries.length > 0 ? entries[entries.length - 1] : null;
}

function compactPageError(error) {
  if (error === null) {
    return null;
  }
  return {
    elapsedMs: error.elapsedMs,
    name: error.name,
    message: error.message,
    phase: error.state && error.state.phase ? error.state.phase : null,
    lastLine: error.state && error.state.lastLine ? error.state.lastLine : null,
  };
}

function compactRequestFailure(failure) {
  if (failure === null) {
    return null;
  }
  return {
    elapsedMs: failure.elapsedMs,
    method: failure.method,
    url: failure.url,
    failureText: failure.failureText,
  };
}

function compactProgressSample(sample) {
  if (sample === null) {
    return null;
  }
  return {
    elapsedMs: sample.elapsedMs,
    reason: sample.reason,
    lineDelta: sample.lineDelta,
    outputByteDelta: sample.outputByteDelta,
    lastLineChanged: sample.lastLineChanged,
    lastLine: sample.state && sample.state.lastLine ? sample.state.lastLine : null,
  };
}

export function smokeResultSummary(result) {
  const firstPageError = compactPageError(firstEntry(result.pageErrors || []));
  const lastPageError = compactPageError(lastEntry(result.pageErrors || []));
  const firstRequestFailure = compactRequestFailure(firstEntry(result.requestFailures || []));
  const lastProgressSample = compactProgressSample(lastEntry(result.progressSamples || []));
  const primaryError = result.errorMessage
    ? {
        name: result.errorName || "Error",
        message: result.errorMessage,
      }
    : firstPageError;

  return {
    success: Boolean(result.success),
    phase: result.phase || null,
    pageStatus: result.pageStatus || null,
    markerSeen: Boolean(result.markerSeen),
    lastLine: result.lastLine || "",
    outputLines: Number.isInteger(result.outputLines) ? result.outputLines : null,
    primaryError,
    pageErrorCount: (result.pageErrors || []).length,
    firstPageError,
    lastPageError,
    requestFailureCount: (result.requestFailures || []).length,
    firstRequestFailure,
    idleTimeout: result.idleTimeout || null,
    progressSampleCount: (result.progressSamples || []).length,
    lastProgressSample,
  };
}

export function displayPixelSummary(data, width, height) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("display width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("display height must be a positive integer");
  }
  if (!data || data.length !== width * height * 4) {
    throw new Error("display pixel data length does not match dimensions");
  }

  let nonZeroPixels = 0;
  let nonTransparentPixels = 0;
  let nonBlackPixels = 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
      nonZeroPixels += 1;
    }
    if (a !== 0) {
      nonTransparentPixels += 1;
    }
    if (r !== 0 || g !== 0 || b !== 0) {
      nonBlackPixels += 1;
    }
    hash ^= r;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= g;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= b;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return {
    hash: `fnv1a32:${hash.toString(16).padStart(8, "0")}`,
    height,
    nonBlackPixels,
    nonTransparentPixels,
    nonZeroPixels,
    totalPixels: width * height,
    width,
  };
}

export function displayContextErrorEvidence(error) {
  const name = error && error.name ? error.name : "Error";
  const message = error && error.message ? error.message : String(error);
  const controlTransferredOffscreen =
    name === "InvalidStateError" &&
    /transferred.*offscreen/i.test(message);
  return {
    contextErrorName: name,
    controlTransferredOffscreen,
    pixelError: controlTransferredOffscreen
      ? "canvas control was transferred to OffscreenCanvas; main-thread pixel sampling is unavailable"
      : message,
  };
}

function displayPixelSummarySource() {
  return `(${displayPixelSummary.toString()})`;
}

function displayContextErrorEvidenceSource() {
  return `(${displayContextErrorEvidence.toString()})`;
}

async function writeResult(options, result) {
  if (options.out === null) {
    return;
  }
  result.summary = smokeResultSummary(result);
  await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`);
}

export function promoteSmokeState(result, smokeState) {
  if (smokeState === null) {
    return;
  }
  result.phase = smokeState.phase || null;
  result.failurePhase = smokeState.failurePhase || null;
  result.phases = smokeState.phases || [];
  result.qemuCommand = smokeState.qemuArgs || [];
  result.markerSeen = Boolean(smokeState.markerSeen);
  result.expectedTextSeen = smokeState.expectedTextSeen || [];
  result.programExitStatus = smokeState.programExitStatus;
  result.outputSuppressed = Boolean(smokeState.outputSuppressed);
  result.outputLines = smokeState.lines;
  result.outputBytes = smokeState.outputBytes;
  result.lastLine = smokeState.lastLine;
  result.browserRuntime = smokeState.runtime || null;
  result.displayState = smokeState.display || null;
  result.powerControlState = smokeState.powerControl || null;
  result.rootfsStorageState = smokeState.rootfsStorage || null;
  result.serviceBridgeState = smokeState.serviceBridge || null;
  result.hotBlocks = smokeState.hotBlocks || null;
}

export function browserSmokeUrl(options) {
  const url = new URL(`http://${options.host}:${options.port}/`);
  const rootfsStorage = options.rootfsStorage || "memfs";
  const rootfsOpfsName = options.rootfsOpfsName || "qemu-wasm-rootfs.raw";
  const tcgHotblocks = Boolean(options.tcgHotblocks);
  const tcgHotblocksInterval = Number.isInteger(options.tcgHotblocksInterval)
    ? options.tcgHotblocksInterval
    : 10000;
  const tcgHotblocksOpSample = Number.isInteger(options.tcgHotblocksOpSample)
    ? options.tcgHotblocksOpSample
    : 1;
  const tcgHotblocksOpLimit = Number.isInteger(options.tcgHotblocksOpLimit)
    ? options.tcgHotblocksOpLimit
    : 134217728;
  const tcgHotblocksTop = Number.isInteger(options.tcgHotblocksTop)
    ? options.tcgHotblocksTop
    : 12;
  url.searchParams.set("appendExtra", options.appendExtra);
  url.searchParams.set("allowSerialFallback", options.allowSerialFallback ? "1" : "0");
  url.searchParams.set("cpu", options.cpu);
  url.searchParams.set("display", options.display);
  url.searchParams.set("displayDevice", options.displayDevice);
  url.searchParams.set("expectedResolution", options.expectedResolution);
  url.searchParams.set("focusDisplay", options.focusDisplay ? "1" : "0");
  if (options.harnessSelfTest) {
    url.searchParams.set("harnessExpectedKeyEvents", String(options.harnessExpectedKeyEvents));
    url.searchParams.set("harnessSelfTest", "1");
  }
  url.searchParams.set("marker", options.marker);
  url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
  url.searchParams.set("memory", options.memory);
  url.searchParams.set("machine", options.machine);
  url.searchParams.set("network", options.network);
  url.searchParams.set("powerOperation", options.powerOperation);
  url.searchParams.set("powerTimeoutMs", String(options.powerTimeoutMs));
  if (tcgHotblocks) {
    url.searchParams.set("tcgHotblocks", "1");
    url.searchParams.set("tcgHotblocksInterval", String(tcgHotblocksInterval));
    url.searchParams.set("tcgHotblocksOpLimit", String(tcgHotblocksOpLimit));
    url.searchParams.set("tcgHotblocksOpSample", String(tcgHotblocksOpSample));
    url.searchParams.set("tcgHotblocksTop", String(tcgHotblocksTop));
  }
  url.searchParams.set("rootfsDevice", options.rootfsDevice);
  if (rootfsStorage !== "memfs") {
    url.searchParams.set("rootfsStorage", rootfsStorage);
    url.searchParams.set("rootfsOpfsName", rootfsOpfsName);
  }
  if (options.kernelAppend !== null) {
    url.searchParams.set("kernelAppend", options.kernelAppend);
  }
  for (const text of options.expectText) {
    url.searchParams.append("expectText", text);
  }
  if (options.initrd === null) {
    url.searchParams.set("initrd", "");
  }
  if (options.rootfs !== null) {
    url.searchParams.set("rootfs", "/guest/rootfs.raw");
  }
  for (const qemuArg of options.qemuArgs) {
    url.searchParams.append("qemuArg", qemuArg);
  }
  if (options.serviceBridge != null) {
    url.searchParams.set("serviceBridge", JSON.stringify(options.serviceBridge));
  }
  url.searchParams.set("timeoutMs", String(options.timeoutMs));
  url.searchParams.set("visualMarker", options.visualMarker);
  return url;
}

export function initialSmokeResult(options, browserVersion) {
  return {
    format: 1,
    appendExtra: options.appendExtra,
    allowSerialFallback: options.allowSerialFallback,
    browser: options.browser,
    browserVersion,
    cpu: options.cpu,
    display: options.display,
    displayDevice: options.displayDevice,
    expectedResolution: options.expectedResolution,
    expectDisplayHash: options.expectDisplayHash,
    expectText: options.expectText,
    focusDisplay: options.focusDisplay,
    harnessExpectedKeyEvents: options.harnessExpectedKeyEvents || 0,
    harnessSelfTest: Boolean(options.harnessSelfTest),
    keyboardAfterText: options.keyboardAfterText,
    keyboardTextLength: options.keyboardText.length,
    preKeyboardWaitMs: options.preKeyboardWaitMs,
    postKeyboardWaitMs: options.postKeyboardWaitMs,
    powerOperation: options.powerOperation,
    powerTimeoutMs: options.powerTimeoutMs,
    kernelAppend: options.kernelAppend,
    machine: options.machine,
    maxDiagnosticEntries: MAX_DIAGNOSTIC_ENTRIES,
    marker: options.marker,
    memory: options.memory,
    network: options.network,
    idleAfterText: options.idleAfterText,
    idleTimeoutMs: options.idleTimeoutMs,
    timeoutMs: options.timeoutMs,
    pageTextTailBytes: options.pageTextTailBytes,
    progressSampleIntervalMs: options.progressSampleIntervalMs,
    progressSampleLimit: options.progressSampleLimit,
    qemuArgs: options.qemuArgs,
    requireDisplayOutput: options.requireDisplayOutput,
    displayMinNonblackPixels: options.displayMinNonblackPixels,
    rootfs: options.rootfs,
    rootfsDevice: options.rootfsDevice,
    rootfsOpfsName: options.rootfsOpfsName,
    rootfsStorage: options.rootfsStorage,
    serviceBridge: options.serviceBridge,
    tcgHotblocks: Boolean(options.tcgHotblocks),
    tcgHotblocksInterval: Number.isInteger(options.tcgHotblocksInterval)
      ? options.tcgHotblocksInterval
      : 10000,
    tcgHotblocksOpLimit: Number.isInteger(options.tcgHotblocksOpLimit)
      ? options.tcgHotblocksOpLimit
      : 134217728,
    tcgHotblocksOpSample: Number.isInteger(options.tcgHotblocksOpSample)
      ? options.tcgHotblocksOpSample
      : 1,
    tcgHotblocksTop: Number.isInteger(options.tcgHotblocksTop)
      ? options.tcgHotblocksTop
      : 12,
    visualMarker: options.visualMarker,
    success: false,
    consoleMessages: [],
    pageErrors: [],
    progressSampleErrors: [],
    progressSamples: [],
    requestFailures: [],
  };
}

async function capturePageText(page, result, tailBytes) {
  if (!page) {
    return;
  }
  try {
    result.pageStatus = await page.evaluate(() => document.querySelector("#status")?.textContent || "");
    result.smokeState = await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
    promoteSmokeState(result, result.smokeState);
    const text = await page.evaluate(() => document.body.textContent || "");
    result.pageTextTail = text.slice(-tailBytes);
  } catch (error) {
    result.pageTextError = error && error.message ? error.message : String(error);
  }
}

async function captureScreenshot(page, options, result) {
  if (!page || options.screenshot === null) {
    return;
  }
  try {
    await page.screenshot({
      path: options.screenshot,
      fullPage: options.screenshotFullPage,
    });
    result.screenshot = options.screenshot;
    result.screenshotFullPage = options.screenshotFullPage;
  } catch (error) {
    result.screenshotError = error && error.message ? error.message : String(error);
  }
}

async function captureDisplayEvidence(page, result) {
  if (!page) {
    return;
  }
  try {
    result.displayEvidence = await page.evaluate((sources) => {
      const contextErrorEvidence = eval(sources.contextErrorEvidence);
      const summarizePixels = eval(sources.pixelSummary);
      const canvas = document.querySelector("#canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        return {
          present: false,
        };
      }
      const style = getComputedStyle(canvas);
      const visible = !canvas.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        canvas.width > 0 &&
        canvas.height > 0;
      const evidence = {
        active: canvas.dataset.inputActive === "true",
        present: true,
        focused: document.activeElement === canvas,
        height: canvas.height,
        hidden: canvas.hidden,
        visible,
        width: canvas.width,
      };
      if (!visible) {
        return evidence;
      }
      let context;
      try {
        context = canvas.getContext("2d", { willReadFrequently: true });
      } catch (error) {
        return {
          ...evidence,
          ...contextErrorEvidence(error),
        };
      }
      if (context) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          ...evidence,
          contextType: "2d",
          ...summarizePixels(pixels, canvas.width, canvas.height),
        };
      }
      let gl;
      try {
        gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true }) ||
          canvas.getContext("webgl", { preserveDrawingBuffer: true }) ||
          canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true });
      } catch (error) {
        return {
          ...evidence,
          ...contextErrorEvidence(error),
        };
      }
      if (!gl) {
        return {
          ...evidence,
          pixelError: "2D or WebGL canvas context is not available",
        };
      }
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      return {
        ...evidence,
        contextType: gl.constructor && gl.constructor.name
          ? gl.constructor.name
          : "webgl",
        ...summarizePixels(pixels, canvas.width, canvas.height),
      };
    }, {
      contextErrorEvidence: displayContextErrorEvidenceSource(),
      pixelSummary: displayPixelSummarySource(),
    });
  } catch (error) {
    result.displayEvidenceError = error && error.message ? error.message : String(error);
  }
}

function validateDisplayEvidence(options, result) {
  if (!options.requireDisplayOutput) {
    return;
  }
  const evidence = result.displayEvidence;
  if (!evidence || !evidence.present) {
    throw new Error("required display canvas was not present");
  }
  if (!evidence.visible) {
    throw new Error("required display canvas was not visible");
  }
  if (evidence.pixelError) {
    throw new Error(`required display pixels were not readable: ${evidence.pixelError}`);
  }
  const nonBlackPixels = Number.isInteger(evidence.nonBlackPixels)
    ? evidence.nonBlackPixels
    : 0;
  if (nonBlackPixels < options.displayMinNonblackPixels) {
    throw new Error(
      `required display output had ${nonBlackPixels} non-black pixels; ` +
      `expected at least ${options.displayMinNonblackPixels}`,
    );
  }
  if (options.expectDisplayHash !== "" && evidence.hash !== options.expectDisplayHash) {
    throw new Error(
      `required display hash was ${evidence.hash}; expected ${options.expectDisplayHash}`,
    );
  }
}

async function sampleSmokeProgress(page, result, startTime, reason, limit) {
  if (!page) {
    return null;
  }
  try {
    const state = await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
    const sample = progressSampleDiagnostic(
      result,
      Date.now() - startTime,
      reason,
      state,
    );
    appendBoundedLimit(
      result.progressSamples,
      sample,
      limit,
    );
    return sample;
  } catch (error) {
    appendBounded(result.progressSampleErrors, {
      elapsedMs: Date.now() - startTime,
      reason,
      message: error && error.message ? error.message : String(error),
    });
    return null;
  }
}

async function typeKeyboardText(page, options, result) {
  if (options.keyboardText === "") {
    return;
  }
  await page.waitForFunction(
    (afterText) => {
      const state = globalThis.qemuWasmSmokeState || null;
      const display = document.querySelector("#canvas");
      if (!state || !display || display.hidden) {
        return false;
      }
      if (afterText === "") {
        return ["harness-self-test", "start-qemu", "guest-boot", "success"].includes(state.phase);
      }
      const output = document.querySelector("#output")?.textContent || "";
      return output.includes(afterText);
    },
    options.keyboardAfterText,
    { timeout: options.timeoutMs },
  );
  if (options.preKeyboardWaitMs > 0) {
    await page.waitForTimeout(options.preKeyboardWaitMs);
  }
  await page.locator("#canvas").focus();
  await page.keyboard.type(options.keyboardText);
  result.keyboardInput = {
    afterText: options.keyboardAfterText,
    preKeyboardWaitMs: options.preKeyboardWaitMs,
    target: "#canvas",
    textLength: options.keyboardText.length,
  };
}

async function currentSmokeState(page) {
  if (!page) {
    return null;
  }
  try {
    return await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
  } catch {
    return null;
  }
}

export async function requestPowerOperation(page, options, result) {
  if (options.powerOperation === "") {
    return;
  }
  const state = await page.evaluate(async ({ operation, timeoutMs }) => {
    if (!globalThis.qemuWasmPowerControl ||
        typeof globalThis.qemuWasmPowerControl.request !== "function") {
      throw new Error("QEMU WebAssembly power control is not available");
    }
    await globalThis.qemuWasmPowerControl.request(operation, { timeoutMs });
    return globalThis.qemuWasmPowerControl.state;
  }, {
    operation: options.powerOperation,
    timeoutMs: options.powerTimeoutMs,
  });
  result.powerOperation = {
    operation: options.powerOperation,
    state,
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const browserType = await loadPlaywright(options.browser);
  const server = await startServer(options);
  const browser = await browserType.launch(playwrightLaunchOptions(options.browser));
  const startTime = Date.now();
  const result = initialSmokeResult(options, browser.version());
  let page = null;
  let progressTimer = null;
  let rejectIdle = null;
  const idleFailure = new Promise((resolve, reject) => {
    rejectIdle = reject;
  });
  const pendingDiagnostics = new Set();
  const trackDiagnostic = (promise) => {
    pendingDiagnostics.add(promise);
    promise.then(
      () => pendingDiagnostics.delete(promise),
      () => pendingDiagnostics.delete(promise),
    );
  };
  const flushDiagnostics = async () => {
    await Promise.allSettled([...pendingDiagnostics]);
  };
  try {
    page = await browser.newPage();
    await page.addInitScript({
      content: `${isTerminalPageStatus.toString()}\n` +
        "globalThis.qemuWasmIsTerminalPageStatus = isTerminalPageStatus;\n",
    });
    page.on("console", (message) => {
      const entry = consoleMessageDiagnostic(message, Date.now() - startTime);
      appendBounded(result.consoleMessages, entry);
      console.log(`browser ${entry.type}: ${entry.text}`);
    });
    page.on("pageerror", (error) => {
      trackDiagnostic((async () => {
        const entry = pageErrorDiagnostic(
          error,
          Date.now() - startTime,
          await currentSmokeState(page),
        );
        appendBounded(result.pageErrors, entry);
        await sampleSmokeProgress(
          page,
          result,
          startTime,
          "page-error",
          options.progressSampleLimit,
        );
      })());
    });
    page.on("requestfailed", (request) => {
      appendBounded(result.requestFailures, requestFailureDiagnostic(
        request,
        Date.now() - startTime,
      ));
    });
    const url = browserSmokeUrl(options);
    result.smokeUrl = url.href;
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    result.userAgent = await page.evaluate(() => navigator.userAgent);
    result.crossOriginIsolated = await page.evaluate(() => Boolean(globalThis.crossOriginIsolated));
    const sampleAndCheckIdle = async (reason) => {
      await sampleSmokeProgress(
        page,
        result,
        startTime,
        reason,
        options.progressSampleLimit,
      );
      const idle = serialIdleDiagnostic(
        result.progressSamples,
        options.idleTimeoutMs,
        options.idleAfterText,
      );
      if (idle !== null) {
        result.idleTimeout = idle;
        rejectIdle(new Error(
          `serial output idle for ${idle.idleMs} ms after: ${idle.lastLine}`,
        ));
      }
    };
    progressTimer = setInterval(() => {
      if (result.progressSamples.length >= options.progressSampleLimit) {
        clearInterval(progressTimer);
        progressTimer = null;
        return;
      }
      sampleAndCheckIdle("interval");
    }, options.progressSampleIntervalMs);
    await sampleAndCheckIdle("after-load");
    await typeKeyboardText(page, options, result);
    await Promise.race([
      page.waitForFunction(
        (marker) => {
          const status = document.querySelector("#status")?.textContent || "";
          return globalThis.qemuWasmIsTerminalPageStatus(status, marker);
        },
        options.marker,
        { timeout: options.timeoutMs },
      ),
      idleFailure,
    ]);
    const pageStatus = await page.evaluate(() => document.querySelector("#status")?.textContent || "");
    if (pageStatus !== `marker reached: ${options.marker}`) {
      throw new Error(pageStatus);
    }
    if (options.postKeyboardWaitMs > 0) {
      await page.waitForTimeout(options.postKeyboardWaitMs);
      await sampleSmokeProgress(
        page,
        result,
        startTime,
        "post-keyboard-wait",
        options.progressSampleLimit,
      );
    }
    await requestPowerOperation(page, options, result);
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    result.elapsedMs = Date.now() - startTime;
    await flushDiagnostics();
    await sampleSmokeProgress(page, result, startTime, "final", options.progressSampleLimit);
    await capturePageText(page, result, options.pageTextTailBytes);
    await captureDisplayEvidence(page, result);
    validateDisplayEvidence(options, result);
    await captureScreenshot(page, options, result);
    result.success = true;
    await writeResult(options, result);
    console.log(`wasm-browser-smoke-runner: marker reached: ${options.marker}`);
  } catch (error) {
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    result.elapsedMs = Date.now() - startTime;
    result.errorName = error && error.name ? error.name : "Error";
    result.errorMessage = error && error.message ? error.message : String(error);
    await flushDiagnostics();
    await sampleSmokeProgress(page, result, startTime, "final", options.progressSampleLimit);
    await capturePageText(page, result, options.pageTextTailBytes);
    await captureDisplayEvidence(page, result);
    await captureScreenshot(page, options, result);
    await writeResult(options, result);
    console.error(error && error.stack ? error.stack : String(error));
    throw error;
  } finally {
    await browser.close();
    await stopServer(server);
  }
}

if (process.argv[1] === THIS_FILE) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
