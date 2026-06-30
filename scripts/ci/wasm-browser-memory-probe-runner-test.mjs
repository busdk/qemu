#!/usr/bin/env node
/*
 * Test browser WebAssembly memory probe runner helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  annotateResult,
  parsePageList,
  probeUrl,
} from "./wasm-browser-memory-probe-runner.mjs";

assert.equal(parsePageList(null), null);
assert.deepEqual(parsePageList("16384,32768, 65536"), [16384, 32768, 65536]);

for (const value of ["", "0", "-1", "1.5", "abc", "16384,0"]) {
  assert.throws(
    () => parsePageList(value),
    /--pages must be a comma-separated list of positive integers/,
    `${value} should fail page-list parsing`,
  );
}

assert.equal(
  probeUrl({
    host: "127.0.0.1",
    port: 8011,
  }).href,
  "http://127.0.0.1:8011/",
);

assert.deepEqual(
  annotateResult(
    {
      format: 1,
      probes: [],
    },
    {
      browser: "chromium",
      memory64: true,
      pages: "16384,32768",
      timeoutMs: 30000,
    },
    "HeadlessChrome/141.0.7390.37",
  ),
  {
    format: 1,
    probes: [],
    runner: {
      browser: "chromium",
      browserVersion: "HeadlessChrome/141.0.7390.37",
      memory64: true,
      pages: "16384,32768",
      timeoutMs: 30000,
    },
  },
);
