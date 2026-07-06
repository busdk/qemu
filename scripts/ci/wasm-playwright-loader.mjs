/*
 * Load Playwright for QEMU WebAssembly browser CI helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

function loadPlaywrightFromPath(pathValue) {
  for (const entry of pathValue.split(delimiter)) {
    if (!entry.endsWith(`${sep}node_modules${sep}.bin`)) {
      continue;
    }
    const nodeModules = dirname(entry);
    const packageJSON = join(nodeModules, "playwright", "package.json");
    if (!existsSync(packageJSON)) {
      continue;
    }
    const require = createRequire(packageJSON);
    return require("playwright");
  }
  return null;
}

export function loadPlaywrightPackage(pathValue = process.env.PATH || "", options = {}) {
  if (!options.preferPath) {
    try {
      const require = createRequire(THIS_FILE);
      return require("playwright");
    } catch (error) {
      const fromPath = loadPlaywrightFromPath(pathValue);
      if (fromPath) {
        return fromPath;
      }
      throw error;
    }
  }

  const fromPath = loadPlaywrightFromPath(pathValue);
  if (fromPath) {
    return fromPath;
  }

  const require = createRequire(THIS_FILE);
  return require("playwright");
}

export function loadPlaywrightBrowser(browserName) {
  const playwright = loadPlaywrightPackage();
  if (!playwright[browserName]) {
    throw new Error(`unsupported Playwright browser: ${browserName}`);
  }
  return playwright[browserName];
}

export function browserExecutableEnvName(browserName) {
  return `QEMU_WASM_${browserName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_EXECUTABLE`;
}

export function browserExecutablePath(browserName, env = process.env) {
  return env[browserExecutableEnvName(browserName)] || env.QEMU_WASM_BROWSER_EXECUTABLE || "";
}

export function playwrightLaunchOptions(browserName, env = process.env) {
  const options = {
    headless: true,
    args: browserName === "chromium" ? ["--no-sandbox"] : [],
  };
  const executablePath = browserExecutablePath(browserName, env);
  if (executablePath) {
    options.executablePath = executablePath;
  }
  return options;
}

function signalExitCode(signal) {
  switch (signal) {
  case "SIGHUP":
    return 129;
  case "SIGINT":
    return 130;
  case "SIGTERM":
    return 143;
  default:
    return 1;
  }
}

async function runWithTimeout(label, fn, timeoutMs) {
  let timer = null;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    console.error(`qemu-wasm-playwright: ${label}: ${error && error.message ? error.message : String(error)}`);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function browserProcess(browser) {
  try {
    return browser && typeof browser.process === "function" ? browser.process() : null;
  } catch {
    return null;
  }
}

export async function closePlaywrightBrowser({ browser = null, context = null } = {}, options = {}) {
  const closeTimeoutMs = options.closeTimeoutMs ?? 5000;
  const browserForProcess = browser || (context && typeof context.browser === "function"
    ? context.browser()
    : null);
  const child = browserProcess(browserForProcess);
  if (context !== null) {
    await runWithTimeout("browser context cleanup", () => context.close(), closeTimeoutMs);
  } else if (browser !== null) {
    await runWithTimeout("browser cleanup", () => browser.close(), closeTimeoutMs);
  }
  if (child !== null && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const hardKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, options.killTimeoutMs ?? 2000);
    hardKill.unref?.();
  }
}

export function installSignalCleanup(cleanup, options = {}) {
  const signals = options.signals || ["SIGHUP", "SIGINT", "SIGTERM"];
  const forceExitMs = options.forceExitMs ?? 10000;
  let cleaning = false;
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => {
      if (cleaning) {
        return;
      }
      cleaning = true;
      const forceExit = setTimeout(() => {
        process.exit(signalExitCode(signal));
      }, forceExitMs);
      forceExit.unref?.();
      Promise.resolve()
        .then(() => cleanup(signal))
        .catch((error) => {
          console.error(`qemu-wasm-playwright: cleanup after ${signal} failed: ${error && error.stack ? error.stack : String(error)}`);
        })
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(signalExitCode(signal));
        });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}
