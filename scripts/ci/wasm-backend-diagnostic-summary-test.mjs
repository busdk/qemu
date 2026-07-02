#!/usr/bin/env node
/*
 * Tests for wasm-backend-diagnostic-summary.mjs.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  artifactHashes,
  diagnosticSummary,
} from "./wasm-backend-diagnostic-summary.mjs";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qemu-wasm-summary-"));
fs.writeFileSync(path.join(tempDir, "qemu-system-x86_64.js"), "js");
fs.writeFileSync(path.join(tempDir, "qemu-system-x86_64.wasm"), "wasm");
fs.writeFileSync(
  path.join(tempDir, "qemu-system-wasm-artifacts.json"),
  "{\"format\":1}\n",
);

assert.deepEqual(artifactHashes(tempDir), {
  "qemu-system-x86_64.js": sha256("js"),
  "qemu-system-x86_64.wasm": sha256("wasm"),
  "qemu-system-wasm-artifacts.json": sha256("{\"format\":1}\n"),
});

const result = {
  browserVersion: "149.0.7827.55",
  elapsedMs: 8123,
  success: false,
  marker: "QEMU_WASM_LINUX_BOOT_OK",
  markerSeen: false,
  wasm64Tcg: {
    lastSummary: {
      generated_attempts: 100,
      generated_compiled: 12,
      generated_executed: 20,
      generated_cache_hits: 4,
      generated_coverage_basis: "subset_attempts",
      generated_coverage_numerator: 24,
      generated_coverage_denominator: 100,
      generated_coverage_ppm: 240000,
      translated_tbs: 80,
      translated_ops: 900,
      translated_generated_candidate_tbs: 40,
      translated_generated_output_tbs: 30,
      translated_generated_output_unavailable_tbs: 10,
      translated_generated_output_missing_candidate_tbs: 2,
      generated_compile_module_failed: 3,
      fallback_helper: 5,
      translated_generated_first_unsupported_ops: [
        { op: 2, name: "call", count: 7 },
      ],
    },
  },
  tci: {
    wasmSubset: {
      generatedTrace: {
        entries: [
          { reason: "ffi-call-enter" },
          { reason: "ffi-call-enter" },
          { reason: "unsupported-op" },
        ],
      },
    },
  },
};

const summary = diagnosticSummary(result, {
  artifactDir: tempDir,
  resultPath: "result.json",
  minCoveragePpm: 200000,
  minCompiled: 10,
});

assert.equal(summary.source.summarySource, "wasm64Tcg.lastSummary");
assert.equal(summary.source.browserVersion, "149.0.7827.55");
assert.equal(summary.generated.compiled, 12);
assert.equal(summary.generated.coverage.numerator, 24);
assert.equal(summary.generated.coverage.denominator, 100);
assert.equal(summary.generated.coverage.ppm, 240000);
assert.equal(summary.thresholds.passed, true);
assert.deepEqual(summary.failures.compile, [
  { field: "generated_compile_module_failed", value: 3 },
]);
assert.deepEqual(summary.failures.fallback, [
  { field: "fallback_helper", value: 5 },
]);
assert.deepEqual(summary.failures.traceReasons, [
  { reason: "ffi-call-enter", count: 2 },
  { reason: "unsupported-op", count: 1 },
]);
assert.equal(
  summary.artifacts.hashes["qemu-system-x86_64.wasm"],
  sha256("wasm"),
);

const failedThreshold = diagnosticSummary(result, {
  minCoveragePpm: 300000,
  minCompiled: 10,
});
assert.equal(failedThreshold.thresholds.passed, false);

const subsetResult = {
  tci: {
    wasmSubset: {
      lastSummary: {
        generated_compiled: 1,
        generated_executed: 2,
        generated_cache_hits: 3,
        generated_coverage_numerator: 5,
        generated_coverage_denominator: 10,
      },
    },
  },
};
const subsetSummary = diagnosticSummary(subsetResult);
assert.equal(subsetSummary.source.summarySource, "tci.wasmSubset.lastSummary");
assert.equal(subsetSummary.generated.coverage.ppm, 500000);

const earlyCrashResult = {
  tci: {
    wasmSubset: {
      generatedTrace: {
        entries: [
          { reason: "compile-enter", signature: "a" },
          { reason: "compile", signature: "a" },
          { reason: "exec-enter", signature: "a" },
          { reason: "exec-dispatch", signature: "a" },
          { reason: "compile-enter", signature: "b" },
          { reason: "compile", signature: "b" },
          { reason: "exec-enter", signature: "b" },
          { reason: "exec-exit", signature: "b" },
        ],
      },
    },
  },
};
const earlyCrashSummary = diagnosticSummary(earlyCrashResult);
assert.equal(earlyCrashSummary.source.summarySource, null);
assert.equal(earlyCrashSummary.generated.attempts, 2);
assert.equal(earlyCrashSummary.generated.compiled, 2);
assert.equal(earlyCrashSummary.generated.executed, 2);
assert.equal(earlyCrashSummary.generated.coverage.basis, "generated_trace_events");
assert.equal(earlyCrashSummary.generated.coverage.ppm, 1000000);
assert.equal(earlyCrashSummary.generated.traceDerived.dispatches, 1);
assert.equal(earlyCrashSummary.generated.traceDerived.exits, 1);

fs.rmSync(tempDir, { recursive: true, force: true });

console.log("wasm-backend-diagnostic-summary-test: ok");
