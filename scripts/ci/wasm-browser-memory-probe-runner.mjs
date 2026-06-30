#!/usr/bin/env node
/*
 * Run the QEMU WebAssembly browser memory probe with Playwright.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-memory-probe-runner.mjs [OPTIONS]

Options:
  --browser NAME     Browser engine to launch (default: chromium)
  --host HOST        Bind address for the local probe server
  --memory64         Include address: "i64" probes
  --out FILE         Write probe JSON to FILE
  --pages LIST       Comma-separated WebAssembly page counts to test
  --port PORT        Local probe server port
  --timeout-ms MS    Timeout in milliseconds
  --help             Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    browser: "chromium",
    host: "127.0.0.1",
    memory64: false,
    out: null,
    pages: null,
    port: 8011,
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--browser") {
      options.browser = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--memory64") {
      options.memory64 = true;
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--pages") {
      options.pages = argv[++i];
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    console.error("--port must be an integer from 1 to 65535");
    usage(2);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    usage(2);
  }
  try {
    parsePageList(options.pages);
  } catch (error) {
    console.error(error.message);
    usage(2);
  }

  return options;
}

export function parsePageList(value) {
  if (value === null) {
    return null;
  }
  const pages = value.split(",").map((item) => Number(item.trim()));
  if (pages.length === 0 || pages.some((page) => !Number.isInteger(page) || page <= 0)) {
    throw new Error("--pages must be a comma-separated list of positive integers");
  }
  return pages;
}

export function probeUrl(options) {
  return new URL(`http://${options.host}:${options.port}/`);
}

export function annotateResult(result, options, browserVersion) {
  return {
    ...result,
    runner: {
      browser: options.browser,
      browserVersion,
      memory64: options.memory64,
      pages: options.pages,
      timeoutMs: options.timeoutMs,
    },
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
      "Playwright is required. Run with, for example: npm exec --yes --package=playwright -- node scripts/ci/wasm-browser-memory-probe-runner.mjs ...",
    );
    throw error;
  }
}

function startServer(options) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(scriptDir, "wasm-memory-probe-server.mjs");
  const args = [
    serverScript,
    "--host",
    options.host,
    "--port",
    String(options.port),
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
      if (text.includes("serving QEMU WASM memory probe")) {
        ready = true;
        resolveReady(child);
      }
    });
    child.on("exit", (code, signal) => {
      if (!ready) {
        rejectReady(new Error(`memory probe server exited before ready: code=${code} signal=${signal}`));
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

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const browserType = await loadPlaywright(options.browser);
  const server = await startServer(options);
  const browser = await browserType.launch({
    headless: true,
    args: options.browser === "chromium" ? ["--no-sandbox"] : [],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (message) => {
      console.log(`browser ${message.type()}: ${message.text()}`);
    });
    await page.goto(probeUrl(options).href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    if (options.pages !== null) {
      await page.fill("#pages", options.pages);
    }
    await page.setChecked("#memory64", options.memory64);
    await page.click("#run");
    await page.waitForFunction(
      () => {
        try {
          const text = document.querySelector("#output").textContent;
          return JSON.parse(text).format === 1;
        } catch {
          return false;
        }
      },
      null,
      { timeout: options.timeoutMs },
    );
    const resultText = await page.textContent("#output");
    const result = annotateResult(JSON.parse(resultText), options, browser.version());
    const output = JSON.stringify(result, null, 2);
    console.log(output);
    if (options.out !== null) {
      await writeFile(options.out, `${output}\n`);
    }
  } catch (error) {
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
