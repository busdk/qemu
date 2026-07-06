#!/usr/bin/env node
/*
 * Test Playwright loader behavior for QEMU WebAssembly browser CI helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  browserExecutableEnvName,
  browserExecutablePath,
  closePlaywrightBrowser,
  installSignalCleanup,
  loadPlaywrightPackage,
  playwrightLaunchOptions,
} from "./wasm-playwright-loader.mjs";

function testLoadsPlaywrightFromNpmExecPath() {
  const root = mkdtempSync(join(tmpdir(), "qemu-wasm-playwright-loader-"));
  const nodeModules = join(root, "node_modules");
  mkdirSync(join(nodeModules, ".bin"), { recursive: true });
  mkdirSync(join(nodeModules, "playwright"), { recursive: true });
  writeFileSync(
    join(nodeModules, "playwright", "package.json"),
    JSON.stringify({ name: "playwright", version: "0.0.0-test", main: "index.js" }),
  );
  writeFileSync(
    join(nodeModules, "playwright", "index.js"),
    "module.exports = { chromium: { name: 'fake-chromium' } };\n",
  );

  const loaded = loadPlaywrightPackage(
    [join(nodeModules, ".bin"), "/usr/bin"].join(delimiter),
    { preferPath: true },
  );
  assert.equal(loaded.chromium.name, "fake-chromium");
}

function testBrowserExecutableEnvNames() {
  assert.equal(browserExecutableEnvName("chromium"), "QEMU_WASM_CHROMIUM_EXECUTABLE");
  assert.equal(browserExecutableEnvName("chrome-beta"), "QEMU_WASM_CHROME_BETA_EXECUTABLE");
}

function testBrowserExecutableSelection() {
  assert.equal(browserExecutablePath("chromium", {}), "");
  assert.equal(
    browserExecutablePath("chromium", { QEMU_WASM_BROWSER_EXECUTABLE: "/browser" }),
    "/browser",
  );
  assert.equal(
    browserExecutablePath("chromium", {
      QEMU_WASM_BROWSER_EXECUTABLE: "/browser",
      QEMU_WASM_CHROMIUM_EXECUTABLE: "/chromium",
    }),
    "/chromium",
  );
}

function testLaunchOptions() {
  assert.deepEqual(
    playwrightLaunchOptions("chromium", { QEMU_WASM_CHROMIUM_EXECUTABLE: "/chromium" }),
    {
      headless: true,
      args: ["--no-sandbox"],
      executablePath: "/chromium",
    },
  );
  assert.deepEqual(playwrightLaunchOptions("firefox", {}), {
    headless: true,
    args: [],
  });
}

async function testClosePlaywrightBrowserTerminatesBrowserProcess() {
  const signals = [];
  const child = {
    exitCode: null,
    signalCode: null,
    killed: false,
    kill(signal) {
      signals.push(signal);
      this.killed = true;
    },
  };
  let closed = false;
  const browser = {
    process() {
      return child;
    },
    async close() {
      closed = true;
    },
  };
  await closePlaywrightBrowser({ browser }, { killTimeoutMs: 10 });
  assert.equal(closed, true);
  assert.deepEqual(signals, ["SIGTERM"]);
}

function testInstallSignalCleanupCanBeUnregistered() {
  const before = process.listenerCount("SIGTERM");
  const unregister = installSignalCleanup(async () => {}, {
    signals: ["SIGTERM"],
    forceExitMs: 10,
  });
  assert.equal(process.listenerCount("SIGTERM"), before + 1);
  unregister();
  assert.equal(process.listenerCount("SIGTERM"), before);
}

testLoadsPlaywrightFromNpmExecPath();
testBrowserExecutableEnvNames();
testBrowserExecutableSelection();
testLaunchOptions();
await testClosePlaywrightBrowserTerminatesBrowserProcess();
testInstallSignalCleanupCanBeUnregistered();
console.log("wasm-playwright-loader-test: ok");
