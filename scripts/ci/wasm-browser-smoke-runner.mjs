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

const MAX_DIAGNOSTIC_ENTRIES = 50;
const DEFAULT_PAGE_TEXT_TAIL_BYTES = 8192;
const DEFAULT_PROGRESS_SAMPLE_INTERVAL_MS = 10000;
const DEFAULT_PROGRESS_SAMPLE_LIMIT = 120;

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-smoke-runner.mjs --artifact-dir DIR --kernel FILE --initrd FILE [OPTIONS]

Options:
  --append-extra TEXT Extra Linux kernel arguments appended to the default
  --artifact-dir DIR  Directory containing qemu-system-*.js/.wasm artifacts
  --browser NAME      Browser engine to launch (default: chromium)
  --cpu MODEL         Guest CPU model passed to QEMU
  --expect-text TEXT  Additional output text required for success
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --guest-manifest FILE
                     JSON file with guest and runner defaults
  --host HOST         Bind address for the local smoke server
  --initrd FILE       Smoke initramfs image
  --kernel FILE       64-bit Linux bzImage
  --kernel-append TEXT
                     Full Linux kernel arguments, replacing smoke defaults
  --machine MACHINE  QEMU machine name passed with -M
  --marker TEXT       Output text required for success
  --max-output-bytes N
                     Maximum browser page output bytes to keep
  --memory SIZE       Guest memory size passed to QEMU
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
    expectText: [],
    firmwareDir: "pc-bios",
    guestManifest: null,
    host: "127.0.0.1",
    initrd: null,
    kernel: null,
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
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
    } else if (arg === "--expect-text") {
      options.expectText.push(argv[++i]);
      explicit.add("expectText");
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
      explicit.add("firmwareDir");
    } else if (arg === "--guest-manifest") {
      options.guestManifest = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
      explicit.add("host");
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
    booleanFields: ["screenshotFullPage"],
    checksumFields: ["kernel", "initrd", "rootfs"],
    integerFields: [
      "maxOutputBytes",
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
      "firmwareDir",
      "host",
      "initrd",
      "kernel",
      "kernelAppend",
      "machine",
      "marker",
      "memory",
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

  return options;
}

function appendBounded(list, entry) {
  appendBoundedLimit(list, entry, MAX_DIAGNOSTIC_ENTRIES);
}

function appendBoundedLimit(list, entry, limit) {
  list.push(entry);
  if (list.length > limit) {
    list.shift();
  }
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

async function writeResult(options, result) {
  if (options.out === null) {
    return;
  }
  await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`);
}

async function capturePageText(page, result, tailBytes) {
  if (!page) {
    return;
  }
  try {
    result.pageStatus = await page.evaluate(() => document.querySelector("#status")?.textContent || "");
    result.smokeState = await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
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
    return;
  }
  try {
    const state = await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
    appendBoundedLimit(result.progressSamples, {
      elapsedMs: Date.now() - startTime,
      reason,
      state,
    }, limit);
  } catch (error) {
    appendBounded(result.progressSampleErrors, {
      elapsedMs: Date.now() - startTime,
      reason,
      message: error && error.message ? error.message : String(error),
    });
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
  const result = {
    format: 1,
    appendExtra: options.appendExtra,
    browser: options.browser,
    browserVersion: browser.version(),
    cpu: options.cpu,
    expectText: options.expectText,
    kernelAppend: options.kernelAppend,
    machine: options.machine,
    maxDiagnosticEntries: MAX_DIAGNOSTIC_ENTRIES,
    marker: options.marker,
    memory: options.memory,
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
  let page = null;
  let progressTimer = null;
  try {
    page = await browser.newPage();
    page.on("console", (message) => {
      const text = message.text();
      appendBounded(result.consoleMessages, {
        type: message.type(),
        text,
      });
      console.log(`browser ${message.type()}: ${text}`);
    });
    page.on("pageerror", (error) => {
      appendBounded(result.pageErrors, {
        name: error && error.name ? error.name : "Error",
        message: error && error.message ? error.message : String(error),
      });
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure();
      appendBounded(result.requestFailures, {
        method: request.method(),
        url: request.url(),
        failureText: failure && failure.errorText ? failure.errorText : null,
      });
    });
    const url = new URL(`http://${options.host}:${options.port}/`);
    url.searchParams.set("appendExtra", options.appendExtra);
    url.searchParams.set("cpu", options.cpu);
    url.searchParams.set("marker", options.marker);
    url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
    url.searchParams.set("memory", options.memory);
    url.searchParams.set("machine", options.machine);
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
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    result.userAgent = await page.evaluate(() => navigator.userAgent);
    result.crossOriginIsolated = await page.evaluate(() => Boolean(globalThis.crossOriginIsolated));
    progressTimer = setInterval(() => {
      if (result.progressSamples.length >= options.progressSampleLimit) {
        clearInterval(progressTimer);
        progressTimer = null;
        return;
      }
      sampleSmokeProgress(page, result, startTime, "interval", options.progressSampleLimit);
    }, options.progressSampleIntervalMs);
    await sampleSmokeProgress(page, result, startTime, "after-load", options.progressSampleLimit);
    await page.waitForFunction(
      (marker) => document.querySelector("#status")?.textContent === `marker reached: ${marker}`,
      options.marker,
      { timeout: options.timeoutMs },
    );
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    result.success = true;
    result.elapsedMs = Date.now() - startTime;
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

run().catch(() => process.exit(1));
