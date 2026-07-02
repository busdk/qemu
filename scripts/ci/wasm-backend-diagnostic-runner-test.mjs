#!/usr/bin/env node
/*
 * Tests for wasm-backend-diagnostic-runner.mjs.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import path from "node:path";

import {
  buildSmokeArgs,
  normalizeOptions,
  parseArgs,
} from "./wasm-backend-diagnostic-runner.mjs";

const options = normalizeOptions(parseArgs([
  "node",
  "wasm-backend-diagnostic-runner.mjs",
  "--artifact-dir",
  "artifacts",
  "--guest-manifest",
  "guest.json",
  "--out-dir",
  "out",
  "--timeout-ms",
  "9000",
  "--port",
  "8123",
  "--generated-trace-limit",
  "77",
  "--fw-cfg-trace-limit",
  "88",
  "--min-coverage-ppm",
  "1000",
  "--min-compiled",
  "4",
  "--smoke-arg",
  "--tci-wasm-generated-only",
]));

assert.equal(options.timeoutMs, 9000);
assert.equal(options.port, 8123);
assert.equal(options.minCoveragePpm, 1000);
assert.equal(options.minCompiled, 4);
assert.equal(options.result, path.resolve("out/wasm-browser-smoke-result.json"));
assert.equal(
  options.summary,
  path.resolve("out/wasm-backend-diagnostic-summary.json"),
);
assert.equal(options.artifactDir, path.resolve("artifacts"));
assert.equal(options.guestManifest, path.resolve("guest.json"));

const smokeArgs = buildSmokeArgs(options);
assert.ok(smokeArgs[0].endsWith("wasm-browser-smoke-runner.mjs"));
assert.ok(smokeArgs.includes("--tci-wasm-subset"));
assert.ok(smokeArgs.includes("--tci-wasm-generated-trace"));
assert.ok(smokeArgs.includes("--fw-cfg-trace"));
assert.equal(smokeArgs[smokeArgs.indexOf("--artifact-dir") + 1], path.resolve("artifacts"));
assert.equal(smokeArgs[smokeArgs.indexOf("--guest-manifest") + 1], path.resolve("guest.json"));
assert.equal(smokeArgs[smokeArgs.indexOf("--timeout-ms") + 1], "9000");
assert.equal(smokeArgs[smokeArgs.indexOf("--port") + 1], "8123");
assert.equal(smokeArgs[smokeArgs.indexOf("--tci-wasm-generated-trace-limit") + 1], "77");
assert.equal(smokeArgs[smokeArgs.indexOf("--fw-cfg-trace-limit") + 1], "88");
assert.equal(smokeArgs.at(-1), "--tci-wasm-generated-only");

assert.throws(
  () => normalizeOptions(parseArgs([
    "node",
    "wasm-backend-diagnostic-runner.mjs",
    "--artifact-dir",
    "artifacts",
    "--out-dir",
    "out",
  ])),
  /--guest-manifest is required/,
);

console.log("wasm-backend-diagnostic-runner-test: ok");
