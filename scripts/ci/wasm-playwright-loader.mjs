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
