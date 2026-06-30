#!/usr/bin/env node
/*
 * Run the QEMU WebAssembly browser smoke harness with Playwright.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";

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
  --display MODE     Browser display mode: none or sdl (default: none)
  --expect-text TEXT  Additional output text required for success
  --focus-display    Focus the browser display surface before QEMU starts
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --guest-manifest FILE
                     JSON file with guest and runner defaults
  --host HOST         Bind address for the local smoke server
  --idle-timeout-ms MS
                     Fail when serial output is idle for this long
                     after guest output has started (default: disabled)
  --idle-after-text TEXT
                     Only apply --idle-timeout-ms while the last serial line
                     contains this text
  --initrd FILE       Smoke initramfs image
  --kernel FILE       64-bit Linux bzImage
  --kernel-append TEXT
                     Full Linux kernel arguments, replacing smoke defaults
  --machine MACHINE  QEMU machine name passed with -M
  --marker TEXT       Output text required for success
  --max-output-bytes N
                     Maximum browser page output bytes to keep
  --memory SIZE       Guest memory size passed to QEMU
  --network MODE      Network mode: none or default (default: none)
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
  --rootfs FILE       Raw root filesystem image exposed as /dev/vda
  --rootfs-device KIND
                     Rootfs block device kind: virtio-mmio or virtio-pci
  --screenshot FILE  Save a browser page screenshot to FILE
  --screenshot-full-page
                     Capture the full scrollable page instead of the viewport
  --timeout-ms MS     Timeout in milliseconds
  --help              Show this help
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
    expectText: [],
    focusDisplay: false,
    firmwareDir: "pc-bios",
    guestManifest: null,
    host: "127.0.0.1",
    idleAfterText: "",
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    initrd: null,
    kernel: null,
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    network: "none",
    out: null,
    pageTextTailBytes: DEFAULT_PAGE_TEXT_TAIL_BYTES,
    port: 8010,
    program: "qemu-system-x86_64.js",
    progressSampleIntervalMs: DEFAULT_PROGRESS_SAMPLE_INTERVAL_MS,
    progressSampleLimit: DEFAULT_PROGRESS_SAMPLE_LIMIT,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    screenshot: null,
    screenshotFullPage: false,
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
    } else if (arg === "--browser") {
      options.browser = argv[++i];
      explicit.add("browser");
    } else if (arg === "--cpu") {
      options.cpu = argv[++i];
      explicit.add("cpu");
    } else if (arg === "--display") {
      options.display = argv[++i];
      explicit.add("display");
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
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
      explicit.add("rootfs");
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
      explicit.add("rootfsDevice");
    } else if (arg === "--screenshot") {
      options.screenshot = argv[++i];
      explicit.add("screenshot");
    } else if (arg === "--screenshot-full-page") {
      options.screenshotFullPage = true;
      explicit.add("screenshotFullPage");
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
    booleanFields: ["focusDisplay", "screenshotFullPage"],
    checksumFields: ["kernel", "initrd", "rootfs"],
    integerFields: [
      "maxOutputBytes",
      "idleTimeoutMs",
      "pageTextTailBytes",
      "port",
      "progressSampleIntervalMs",
      "progressSampleLimit",
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
      "firmwareDir",
      "host",
      "idleAfterText",
      "initrd",
      "kernel",
      "kernelAppend",
      "machine",
      "marker",
      "memory",
      "network",
      "out",
      "program",
      "rootfs",
      "rootfsDevice",
      "screenshot",
    ],
    stringListFields: ["expectText", "qemuArgs"],
  });

  if (options.artifactDir === null) {
    console.error("--artifact-dir is required");
    usage(2);
  }
  if (options.kernel === null) {
    console.error("--kernel is required");
    usage(2);
  }
  if (options.initrd === null && options.rootfs === null) {
    console.error("either --initrd or --rootfs is required");
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
  if (!["virtio-mmio", "virtio-pci"].includes(options.rootfsDevice)) {
    console.error("--rootfs-device must be virtio-mmio or virtio-pci");
    usage(2);
  }
  if (!["none", "sdl"].includes(options.display)) {
    console.error("--display must be none or sdl");
    usage(2);
  }
  if (!["none", "default"].includes(options.network)) {
    console.error("--network must be none or default");
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
    const require = createRequire(import.meta.url);
    const playwright = require("playwright");
    if (!playwright[browserName]) {
      throw new Error(`unsupported Playwright browser: ${browserName}`);
    }
    return playwright[browserName];
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
    "--artifact-dir",
    options.artifactDir,
    "--firmware-dir",
    options.firmwareDir,
    "--host",
    options.host,
    "--kernel",
    options.kernel,
    "--port",
    String(options.port),
    "--program",
    options.program,
  ];
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
}

export function browserSmokeUrl(options) {
  const url = new URL(`http://${options.host}:${options.port}/`);
  url.searchParams.set("appendExtra", options.appendExtra);
  url.searchParams.set("cpu", options.cpu);
  url.searchParams.set("display", options.display);
  url.searchParams.set("focusDisplay", options.focusDisplay ? "1" : "0");
  url.searchParams.set("marker", options.marker);
  url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
  url.searchParams.set("memory", options.memory);
  url.searchParams.set("machine", options.machine);
  url.searchParams.set("network", options.network);
  url.searchParams.set("rootfsDevice", options.rootfsDevice);
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
  url.searchParams.set("timeoutMs", String(options.timeoutMs));
  return url;
}

export function initialSmokeResult(options, browserVersion) {
  return {
    format: 1,
    appendExtra: options.appendExtra,
    browser: options.browser,
    browserVersion,
    cpu: options.cpu,
    display: options.display,
    expectText: options.expectText,
    focusDisplay: options.focusDisplay,
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
    rootfs: options.rootfs,
    rootfsDevice: options.rootfsDevice,
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

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const browserType = await loadPlaywright(options.browser);
  const server = await startServer(options);
  const browser = await browserType.launch({
    headless: true,
    args: options.browser === "chromium" ? ["--no-sandbox"] : [],
  });
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
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    result.success = true;
    result.elapsedMs = Date.now() - startTime;
    await flushDiagnostics();
    await sampleSmokeProgress(page, result, startTime, "final", options.progressSampleLimit);
    await capturePageText(page, result, options.pageTextTailBytes);
    await captureScreenshot(page, options, result);
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
  run().catch(() => process.exit(1));
}
