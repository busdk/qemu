#!/usr/bin/env node
/*
 * Run the QEMU WebAssembly browser OPFS probe with Playwright.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  closePlaywrightBrowser,
  installSignalCleanup,
  loadPlaywrightBrowser,
  playwrightLaunchOptions,
} from "./wasm-playwright-loader.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_PAYLOAD = "QEMU_WASM_OPFS_PROBE";
const DEFAULT_STORAGE_NAME = "qemu-wasm-opfs-probe.bin";

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-opfs-probe-runner.mjs [OPTIONS]

Options:
  --browser NAME       Browser engine to launch (default: chromium)
  --host HOST          Bind address for the local probe server
  --out FILE           Write probe JSON to FILE
  --payload TEXT       Probe payload (default: ${DEFAULT_PAYLOAD})
  --port PORT          Local probe server port
  --storage-name NAME  OPFS file name (default: ${DEFAULT_STORAGE_NAME})
  --timeout-ms MS      Timeout in milliseconds
  --user-data-dir DIR  Browser profile directory to reuse for restart proof
  --help               Show this help

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
    browser: "chromium",
    host: "127.0.0.1",
    out: null,
    payload: DEFAULT_PAYLOAD,
    port: 8012,
    storageName: DEFAULT_STORAGE_NAME,
    timeoutMs: 30000,
    userDataDir: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--browser") {
      options.browser = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--payload") {
      options.payload = argv[++i];
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--storage-name") {
      options.storageName = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--user-data-dir") {
      options.userDataDir = argv[++i];
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  validateOptions(options);
  return options;
}

export function validateOptions(options) {
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  if (options.storageName === "" || /[\\/]/.test(options.storageName)) {
    throw new Error("--storage-name must be a non-empty file name without path separators");
  }
  if (options.payload === "") {
    throw new Error("--payload must not be empty");
  }
}

export function probeUrl(options) {
  return new URL(`http://${options.host}:${options.port}/`);
}

export function resultPassed(result) {
  return Boolean(
    result &&
    result.initial &&
    result.initial.ok &&
    result.reload &&
    result.reload.ok &&
    result.browserRestart &&
    result.browserRestart.ok,
  );
}

export function annotateResult(result, options, browserVersion, userDataDir) {
  return {
    ...result,
    passed: resultPassed(result),
    runner: {
      browser: options.browser,
      browserVersion,
      payloadBytes: new TextEncoder().encode(options.payload).length,
      storageName: options.storageName,
      timeoutMs: options.timeoutMs,
      userDataDir,
    },
  };
}

async function loadPlaywright(browserName) {
  try {
    return loadPlaywrightBrowser(browserName);
  } catch (error) {
    console.error(
      "Playwright is required. Run with, for example: npm exec --yes --package=playwright -- node scripts/ci/wasm-browser-opfs-probe-runner.mjs ...",
    );
    throw error;
  }
}

function startServer(options) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(scriptDir, "wasm-opfs-probe-server.mjs");
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
      if (text.includes("serving QEMU WASM OPFS probe")) {
        ready = true;
        resolveReady(child);
      }
    });
    child.on("exit", (code, signal) => {
      if (!ready) {
        rejectReady(new Error(`OPFS probe server exited before ready: code=${code} signal=${signal}`));
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

async function runPageProbe(context, options, command) {
  const page = await context.newPage();
  page.on("console", (message) => {
    console.log(`browser ${message.type()}: ${message.text()}`);
  });
  try {
    await page.goto(probeUrl(options).href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.fill("#storageName", options.storageName);
    await page.fill("#payload", options.payload);
    await page.click(command === "write-read" ? "#run" : "#verify");
    await page.waitForFunction(
      () => {
        try {
          return JSON.parse(document.querySelector("#output").textContent).format === 1;
        } catch {
          return false;
        }
      },
      null,
      { timeout: options.timeoutMs },
    );
    return JSON.parse(await page.textContent("#output"));
  } finally {
    await page.close();
  }
}

async function launchPersistentContext(browserType, options, userDataDir) {
  return browserType.launchPersistentContext(
    userDataDir,
    playwrightLaunchOptions(options.browser),
  );
}

async function run() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage(2);
  }

  const browserType = await loadPlaywright(options.browser);
  let server = null;
  let context = null;
  const temporaryUserDataDir = options.userDataDir === null;
  const userDataDir = options.userDataDir || await mkdtemp(join(tmpdir(), "qemu-wasm-opfs-"));
  let browserVersion = "unknown";
  let removedUserDataDir = false;
  const cleanup = async () => {
    await closePlaywrightBrowser({ context });
    context = null;
    await stopServer(server);
    server = null;
    if (temporaryUserDataDir && !removedUserDataDir) {
      removedUserDataDir = true;
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
  const uninstallSignalCleanup = installSignalCleanup(cleanup);

  try {
    server = await startServer(options);
    context = await launchPersistentContext(browserType, options, userDataDir);
    browserVersion = context.browser() ? context.browser().version() : browserVersion;
    const initial = await runPageProbe(context, options, "write-read");
    const reload = await runPageProbe(context, options, "read-existing");
    await context.close();
    context = null;

    context = await launchPersistentContext(browserType, options, userDataDir);
    browserVersion = context.browser() ? context.browser().version() : browserVersion;
    const browserRestart = await runPageProbe(context, options, "read-existing");
    await context.close();
    context = null;

    const result = annotateResult(
      {
        format: 1,
        initial,
        reload,
        browserRestart,
      },
      options,
      browserVersion,
      userDataDir,
    );
    const output = JSON.stringify(result, null, 2);
    console.log(output);
    if (options.out !== null) {
      await writeFile(options.out, `${output}\n`);
    }
    if (!result.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    throw error;
  } finally {
    uninstallSignalCleanup();
    await cleanup();
  }
}

if (process.argv[1] === THIS_FILE) {
  run().catch(() => process.exit(1));
}
