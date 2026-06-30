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

const MAX_DIAGNOSTIC_ENTRIES = 50;
const MAX_PAGE_TEXT_BYTES = 8192;

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-smoke-runner.mjs --artifact-dir DIR --kernel FILE --initrd FILE [OPTIONS]

Options:
  --artifact-dir DIR  Directory containing qemu-system-*.js/.wasm artifacts
  --browser NAME      Browser engine to launch (default: chromium)
  --cpu MODEL         Guest CPU model passed to QEMU
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --host HOST         Bind address for the local smoke server
  --initrd FILE       Smoke initramfs image
  --kernel FILE       64-bit Linux bzImage
  --marker TEXT       Output text required for success
  --max-output-bytes N
                     Maximum browser page output bytes to keep
  --memory SIZE       Guest memory size passed to QEMU
  --out FILE          Write smoke result JSON to FILE
  --port PORT         Local smoke server port
  --program FILE      JavaScript launcher inside artifact dir
  --timeout-ms MS     Timeout in milliseconds
  --help              Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    artifactDir: null,
    browser: "chromium",
    cpu: "Nehalem",
    firmwareDir: "pc-bios",
    host: "127.0.0.1",
    initrd: null,
    kernel: null,
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    out: null,
    port: 8010,
    program: "qemu-system-x86_64.js",
    timeoutMs: 180000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
    } else if (arg === "--browser") {
      options.browser = argv[++i];
    } else if (arg === "--cpu") {
      options.cpu = argv[++i];
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--initrd") {
      options.initrd = argv[++i];
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
    } else if (arg === "--marker") {
      options.marker = argv[++i];
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(argv[++i]);
    } else if (arg === "--memory") {
      options.memory = argv[++i];
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--program") {
      options.program = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (options.artifactDir === null) {
    console.error("--artifact-dir is required");
    usage(2);
  }
  if (options.kernel === null) {
    console.error("--kernel is required");
    usage(2);
  }
  if (options.initrd === null) {
    console.error("--initrd is required");
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

  return options;
}

function appendBounded(list, entry) {
  list.push(entry);
  if (list.length > MAX_DIAGNOSTIC_ENTRIES) {
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
    "--initrd",
    options.initrd,
    "--kernel",
    options.kernel,
    "--port",
    String(options.port),
    "--program",
    options.program,
  ];
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

async function capturePageText(page, result) {
  if (!page) {
    return;
  }
  try {
    const text = await page.evaluate(() => document.body.textContent || "");
    result.pageTextTail = text.slice(-MAX_PAGE_TEXT_BYTES);
  } catch (error) {
    result.pageTextError = error && error.message ? error.message : String(error);
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
    browser: options.browser,
    browserVersion: browser.version(),
    cpu: options.cpu,
    maxDiagnosticEntries: MAX_DIAGNOSTIC_ENTRIES,
    marker: options.marker,
    memory: options.memory,
    timeoutMs: options.timeoutMs,
    success: false,
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
  };
  let page = null;
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
    url.searchParams.set("cpu", options.cpu);
    url.searchParams.set("marker", options.marker);
    url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
    url.searchParams.set("memory", options.memory);
    url.searchParams.set("timeoutMs", String(options.timeoutMs));
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    result.userAgent = await page.evaluate(() => navigator.userAgent);
    result.crossOriginIsolated = await page.evaluate(() => Boolean(globalThis.crossOriginIsolated));
    await page.waitForFunction(
      (marker) => document.querySelector("#status")?.textContent === `marker reached: ${marker}`,
      options.marker,
      { timeout: options.timeoutMs },
    );
    result.success = true;
    result.elapsedMs = Date.now() - startTime;
    await capturePageText(page, result);
    await writeResult(options, result);
    console.log(`wasm-browser-smoke-runner: marker reached: ${options.marker}`);
  } catch (error) {
    result.elapsedMs = Date.now() - startTime;
    result.errorName = error && error.name ? error.name : "Error";
    result.errorMessage = error && error.message ? error.message : String(error);
    await capturePageText(page, result);
    await writeResult(options, result);
    console.error(error && error.stack ? error.stack : String(error));
    throw error;
  } finally {
    await browser.close();
    await stopServer(server);
  }
}

run().catch(() => process.exit(1));
