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
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
} from "./wasmjit-runloop-model.mjs";

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeS64(0n), [0]);
assert.deepEqual(encodeS64(-1n), [127]);
assert.equal(expectedRunloopValue(0n, 0), 0n);
assert.equal(expectedRunloopValue(0n, 1), 1n);
assert.equal(expectedRunloopValue(0n, 2), 0x5a5bn);

for (const workload of [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
]) {
  const moduleBytes = buildWasmjitRunloopModule({ workload });
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
}

assert.throws(
  () => validateWasmjitRunloopContract(Uint8Array.from([0, 1, 2, 3])),
  /not valid WebAssembly/,
);

const aluSmallProbe = await runWasmjitRunloopProbe({
  budget: 32,
  workload: WASMJIT_WORKLOAD_ALU_BRANCH,
});
assert.equal(aluSmallProbe.format, 1);
assert.equal(aluSmallProbe.purpose, "qemu-wasmjit-runloop-model");
assert.equal(aluSmallProbe.version, WASMJIT_RUNLOOP_MODEL_VERSION);
assert.equal(aluSmallProbe.workload, WASMJIT_WORKLOAD_ALU_BRANCH);
assert.equal(aluSmallProbe.ok, true);
assert.equal(aluSmallProbe.exitReason, WASMJIT_EXIT_BUDGET);
assert.equal(aluSmallProbe.generatedGuestInstructions, "128");
assert.equal(aluSmallProbe.generatedChainLength, "32");
assert.equal(aluSmallProbe.inlineTlbHitLoads, "0");
assert.equal(aluSmallProbe.inlineTlbHitStores, "0");
assert.equal(aluSmallProbe.helperCalls, "0");
assert.equal(aluSmallProbe.qemuLoadCalls, "0");
assert.equal(aluSmallProbe.qemuStoreCalls, "0");
assert.equal(aluSmallProbe.exitValue, aluSmallProbe.expectedValue);
assert.equal(aluSmallProbe.ramValue, "0");

const ramSmallProbe = await runWasmjitRunloopProbe({
  budget: 32,
  workload: WASMJIT_WORKLOAD_TLB_HIT_RAM,
});
assert.equal(ramSmallProbe.workload, WASMJIT_WORKLOAD_TLB_HIT_RAM);
assert.equal(ramSmallProbe.ok, true);
assert.equal(ramSmallProbe.generatedGuestInstructions, "128");
assert.equal(ramSmallProbe.generatedChainLength, "32");
assert.equal(ramSmallProbe.inlineTlbHitLoads, "32");
assert.equal(ramSmallProbe.inlineTlbHitStores, "32");
assert.equal(ramSmallProbe.helperCalls, "0");
assert.equal(ramSmallProbe.qemuLoadCalls, "0");
assert.equal(ramSmallProbe.qemuStoreCalls, "0");
assert.equal(ramSmallProbe.exitValue, ramSmallProbe.expectedValue);
assert.equal(ramSmallProbe.ramValue, ramSmallProbe.expectedValue);

for (const workload of [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
]) {
  const budgetProbe = await runWasmjitRunloopProbe({
    budget: 1_000_000,
    workload,
  });
  assert.equal(budgetProbe.ok, true);
  assert.equal(budgetProbe.exitReason, WASMJIT_EXIT_BUDGET);
  assert.equal(budgetProbe.generatedGuestInstructions, "4000000");
  assert.equal(budgetProbe.generatedChainLength, "1000000");
  assert.equal(budgetProbe.helperCalls, "0");
  assert.equal(budgetProbe.qemuLoadCalls, "0");
  assert.equal(budgetProbe.qemuStoreCalls, "0");
  assert.equal(budgetProbe.exitValue, budgetProbe.expectedValue);
  if (workload === WASMJIT_WORKLOAD_TLB_HIT_RAM) {
    assert.equal(budgetProbe.inlineTlbHitLoads, "1000000");
    assert.equal(budgetProbe.inlineTlbHitStores, "1000000");
    assert.equal(budgetProbe.ramValue, budgetProbe.expectedValue);
  } else {
    assert.equal(budgetProbe.inlineTlbHitLoads, "0");
    assert.equal(budgetProbe.inlineTlbHitStores, "0");
    assert.equal(budgetProbe.ramValue, "0");
  }

  const tciLike = runTciLikeRunloopModel({
    budget: 1_000_000,
    workload,
  });
  assert.equal(tciLike.exitReason, WASMJIT_EXIT_BUDGET);
  assert.equal(tciLike.generatedGuestInstructions, 4000000n);
  assert.equal(tciLike.generatedChainLength, 1000000n);
  assert.equal(tciLike.helperCalls, 0n);
  assert.equal(tciLike.qemuLoadCalls, 0n);
  assert.equal(tciLike.qemuStoreCalls, 0n);
  assert.equal(tciLike.tb0Executions, 500000n);
  assert.equal(tciLike.tb1Executions, 500000n);
  assert.equal(tciLike.accumulator.toString(), budgetProbe.expectedValue);
}

for (const workload of [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
]) {
  const benchmark = await runWasmjitRunloopBenchmark({
    budget: 1_000_000,
    rounds: 3,
    workload,
  });
  assert.equal(benchmark.format, 1);
  assert.equal(benchmark.purpose, "qemu-wasmjit-runloop-model-benchmark");
  assert.equal(benchmark.version, WASMJIT_RUNLOOP_MODEL_VERSION);
  assert.equal(benchmark.workload, workload);
  assert.equal(benchmark.wasmTimesMs.length, 3);
  assert.equal(benchmark.tciLikeTimesMs.length, 3);
  assert.equal(benchmark.wasmBestMs > 0, true);
  assert.equal(benchmark.tciLikeBestMs > 0, true);
  assert.equal(benchmark.bestRatio > 1, true);
}

console.log("wasmjit runloop model: ok");
