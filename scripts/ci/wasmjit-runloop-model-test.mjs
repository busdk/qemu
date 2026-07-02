#!/usr/bin/env node
/*
 * Test deterministic browser-Wasm accelerator run-loop model.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  buildWasmjitRunloopModule,
  encodeS64,
  encodeU32,
  expectedRunloopValue,
  runTciLikeRunloopModel,
  runWasmjitRunloopBenchmark,
  runWasmjitRunloopProbe,
  validateWasmjitRunloopContract,
  WASMJIT_EXIT_BUDGET,
  WASMJIT_RUNLOOP_MODEL_VERSION,
} from "./wasmjit-runloop-model.mjs";

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeS64(0n), [0]);
assert.deepEqual(encodeS64(-1n), [127]);
assert.equal(expectedRunloopValue(0n, 0), 0n);
assert.equal(expectedRunloopValue(0n, 1), 1n);
assert.equal(expectedRunloopValue(0n, 2), 0x5a5bn);

const moduleBytes = buildWasmjitRunloopModule();
assert.equal(WebAssembly.validate(moduleBytes), true);

const contract = validateWasmjitRunloopContract(moduleBytes);
assert.deepEqual(contract.imports, [
  {
    module: "env",
    name: "memory",
    kind: "memory",
  },
]);
assert.deepEqual(contract.exports, [
  {
    name: "wasmjit_run",
    kind: "function",
  },
]);
assert.throws(
  () => validateWasmjitRunloopContract(Uint8Array.from([0, 1, 2, 3])),
  /not valid WebAssembly/,
);

const smallProbe = await runWasmjitRunloopProbe({ budget: 32 });
assert.equal(smallProbe.format, 1);
assert.equal(smallProbe.purpose, "qemu-wasmjit-runloop-model");
assert.equal(smallProbe.version, WASMJIT_RUNLOOP_MODEL_VERSION);
assert.equal(smallProbe.ok, true);
assert.equal(smallProbe.exitReason, WASMJIT_EXIT_BUDGET);
assert.equal(smallProbe.generatedGuestInstructions, "128");
assert.equal(smallProbe.generatedChainLength, "32");
assert.equal(smallProbe.tlbHitAccesses, "64");
assert.equal(smallProbe.helperCalls, "0");
assert.equal(smallProbe.qemuLoadCalls, "0");
assert.equal(smallProbe.qemuStoreCalls, "0");
assert.equal(smallProbe.tb0Executions, "16");
assert.equal(smallProbe.tb1Executions, "16");
assert.equal(smallProbe.accumulator, smallProbe.expectedValue);

const budgetProbe = await runWasmjitRunloopProbe({ budget: 1_000_000 });
assert.equal(budgetProbe.ok, true);
assert.equal(budgetProbe.exitReason, WASMJIT_EXIT_BUDGET);
assert.equal(budgetProbe.generatedGuestInstructions, "4000000");
assert.equal(budgetProbe.generatedChainLength, "1000000");
assert.equal(budgetProbe.tlbHitAccesses, "2000000");
assert.equal(budgetProbe.helperCalls, "0");
assert.equal(budgetProbe.qemuLoadCalls, "0");
assert.equal(budgetProbe.qemuStoreCalls, "0");
assert.equal(budgetProbe.tb0Executions, "500000");
assert.equal(budgetProbe.tb1Executions, "500000");
assert.equal(budgetProbe.accumulator, budgetProbe.expectedValue);
assert.equal(budgetProbe.ramValue, budgetProbe.expectedValue);

const tciLike = runTciLikeRunloopModel({ budget: 1_000_000 });
assert.equal(tciLike.exitReason, WASMJIT_EXIT_BUDGET);
assert.equal(tciLike.generatedGuestInstructions, 4000000n);
assert.equal(tciLike.generatedChainLength, 1000000n);
assert.equal(tciLike.tlbHitAccesses, 2000000n);
assert.equal(tciLike.helperCalls, 0n);
assert.equal(tciLike.qemuLoadCalls, 0n);
assert.equal(tciLike.qemuStoreCalls, 0n);
assert.equal(tciLike.tb0Executions, 500000n);
assert.equal(tciLike.tb1Executions, 500000n);
assert.equal(tciLike.accumulator.toString(), budgetProbe.expectedValue);

const benchmark = await runWasmjitRunloopBenchmark({
  budget: 1_000_000,
  rounds: 3,
});
assert.equal(benchmark.format, 1);
assert.equal(benchmark.purpose, "qemu-wasmjit-runloop-model-benchmark");
assert.equal(benchmark.version, WASMJIT_RUNLOOP_MODEL_VERSION);
assert.equal(benchmark.wasmTimesMs.length, 3);
assert.equal(benchmark.tciLikeTimesMs.length, 3);
assert.equal(benchmark.wasmBestMs > 0, true);
assert.equal(benchmark.tciLikeBestMs > 0, true);
assert.equal(benchmark.bestRatio > 1, true);

console.log("wasmjit runloop model: ok");
