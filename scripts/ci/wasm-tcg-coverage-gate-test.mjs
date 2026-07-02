#!/usr/bin/env node
/*
 * Test wasm64 TCG coverage gate helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  COVERAGE_GATE_MODEL_VERSION,
  coverageFromHotBlockSummary,
  coverageGate,
  hotBlockSummariesFromResult,
  latestHotBlockSummary,
} from "./wasm-tcg-coverage-gate.mjs";

const result = {
  hotBlocks: {
    summaries: [
      {
        reason: "interval",
        tb_execs: 1,
        tci_ops: 100,
        helper_calls: 1,
        qemu_loads: 2,
        qemu_stores: 3,
        top_tci_ops: [
          { op: "tci_movi", count: 40 },
          { op: "st", count: 20 },
          { op: "ld", count: 20 },
          { op: "brcond", count: 10 },
          { op: "mb", count: 10 },
        ],
      },
      {
        reason: "exit",
        tb_execs: 2,
        tci_ops: 200,
        helper_calls: 2,
        qemu_loads: 4,
        qemu_stores: 6,
        top_tci_ops: [
          { op: "tci_movi", count: 80 },
          { op: "add", count: 40 },
          { op: "brcond", count: 40 },
          { op: "call", count: 40 },
        ],
      },
    ],
  },
};

assert.equal(COVERAGE_GATE_MODEL_VERSION, 1);
assert.equal(hotBlockSummariesFromResult(result).length, 2);
assert.equal(latestHotBlockSummary(result).reason, "exit");
assert.deepEqual(hotBlockSummariesFromResult({
  hotBlocks: {
    lastSummary: {
      reason: "legacy",
      top_tci_ops: [],
    },
  },
}), [
  {
    reason: "legacy",
    top_tci_ops: [],
  },
]);

const deterministicCoverage = coverageFromHotBlockSummary(
  latestHotBlockSummary(result),
  new Set(["tci_movi", "add", "brcond"]),
);
assert.equal(deterministicCoverage.measuredCount, 200);
assert.equal(deterministicCoverage.supportedCount, 160);
assert.equal(deterministicCoverage.unsupportedCount, 40);
assert.equal(deterministicCoverage.supportedRatio, 0.8);
assert.deepEqual(deterministicCoverage.unsupported, [
  { op: "call", count: 40 },
]);

const deterministicGate = coverageGate(result, {
  profile: "deterministic",
  minRatio: 0.9,
});
assert.equal(deterministicGate.format, 1);
assert.equal(deterministicGate.purpose, "qemu-wasm64-tcg-coverage-gate");
assert.equal(deterministicGate.version, COVERAGE_GATE_MODEL_VERSION);
assert.equal(deterministicGate.profile, "deterministic");
assert.equal(deterministicGate.ok, false);
assert.equal(deterministicGate.coverage.unsupportedCount, 40);
assert.deepEqual(deterministicGate.coverage.unsupported, [
  { op: "call", count: 40 },
]);
assert.deepEqual(deterministicGate.summary, {
  reason: "exit",
  tbExecs: 2,
  tciOps: 200,
  helperCalls: 2,
  qemuLoads: 4,
  qemuStores: 6,
});

const plannedGate = coverageGate(result, {
  profile: "planned-hotblock",
  minRatio: 0.7,
  requiredOps: ["ld", "st", "mb", "tci_setcond32"],
});
assert.equal(plannedGate.profile, "plannedHotblock");
assert.equal(plannedGate.ok, true);
assert.deepEqual(plannedGate.requiredOps, ["ld", "st", "mb", "tci_setcond32"]);
assert.deepEqual(plannedGate.missingRequiredOps, []);
assert.equal(plannedGate.coverage.supportedRatio, 0.8);
assert.deepEqual(plannedGate.coverage.unsupported, [
  { op: "call", count: 40 },
]);

const missingRequiredGate = coverageGate(result, {
  profile: "deterministic",
  minRatio: 0.7,
  requiredOps: ["call"],
});
assert.equal(missingRequiredGate.ok, false);
assert.deepEqual(missingRequiredGate.missingRequiredOps, ["call"]);

assert.throws(
  () => coverageGate({}, { profile: "deterministic" }),
  /does not contain hotBlocks summaries/,
);
assert.throws(
  () => coverageGate(result, { profile: "missing-profile" }),
  /unknown lowering profile/,
);

console.log("wasm-tcg-coverage-gate-test: ok");
