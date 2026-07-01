#!/usr/bin/env node
/*
 * Test browser OPFS probe runner helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  annotateResult,
  probeUrl,
  resultPassed,
  validateOptions,
} from "./wasm-browser-opfs-probe-runner.mjs";

assert.equal(
  probeUrl({
    host: "127.0.0.1",
    port: 8012,
  }).href,
  "http://127.0.0.1:8012/",
);

for (const options of [
  { port: 0, timeoutMs: 30000, storageName: "disk.raw", payload: "x" },
  { port: 65536, timeoutMs: 30000, storageName: "disk.raw", payload: "x" },
  { port: 8012, timeoutMs: 0, storageName: "disk.raw", payload: "x" },
  { port: 8012, timeoutMs: 30000, storageName: "", payload: "x" },
  { port: 8012, timeoutMs: 30000, storageName: "dir/disk.raw", payload: "x" },
  { port: 8012, timeoutMs: 30000, storageName: "disk.raw", payload: "" },
]) {
  assert.throws(() => validateOptions(options), Error);
}

assert.equal(
  resultPassed({
    initial: { ok: true },
    reload: { ok: true },
    browserRestart: { ok: true },
  }),
  true,
);
assert.equal(
  resultPassed({
    initial: { ok: true },
    reload: { ok: false },
    browserRestart: { ok: true },
  }),
  false,
);

assert.deepEqual(
  annotateResult(
    {
      format: 1,
      initial: { ok: true },
      reload: { ok: true },
      browserRestart: { ok: true },
    },
    {
      browser: "chromium",
      payload: "abcd",
      storageName: "disk.raw",
      timeoutMs: 30000,
    },
    "HeadlessChrome/141.0.7390.37",
    "/tmp/qemu-wasm-opfs-test",
  ),
  {
    format: 1,
    initial: { ok: true },
    reload: { ok: true },
    browserRestart: { ok: true },
    passed: true,
    runner: {
      browser: "chromium",
      browserVersion: "HeadlessChrome/141.0.7390.37",
      payloadBytes: 4,
      storageName: "disk.raw",
      timeoutMs: 30000,
      userDataDir: "/tmp/qemu-wasm-opfs-test",
    },
  },
);
