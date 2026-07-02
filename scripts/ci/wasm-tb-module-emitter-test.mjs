#!/usr/bin/env node
/*
 * Test deterministic generated-TB WebAssembly module shape.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  atomicFence,
  buildTBModule,
  buildLoweringSubsetModule,
  encodeU32,
  encodeS64,
  interpretLoweringSubset,
  LOWERING_SUBSET_BLOCK,
  runLoweringSubsetProbe,
  runTBModuleEmitterProbe,
  TB_MODULE_EMITTER_MODEL_VERSION,
  validateTBModuleContract,
} from "./wasm-tb-module-emitter.mjs";

function countSubsequence(bytes, needle) {
  let count = 0;
  for (let i = 0; i <= bytes.length - needle.length; i++) {
    if (needle.every((value, offset) => bytes[i + offset] === value)) {
      count++;
    }
  }
  return count;
}

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(127), [127]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeU32(624485), [229, 142, 38]);
assert.deepEqual(encodeS64(0n), [0]);
assert.deepEqual(encodeS64(42n), [42]);
assert.deepEqual(encodeS64(-1n), [127]);
assert.deepEqual(atomicFence(), [0xfe, 0x03, 0x00]);

const moduleBytes = buildTBModule();
assert.equal(WebAssembly.validate(moduleBytes), true);

const contract = validateTBModuleContract(moduleBytes);
assert.deepEqual(contract.imports, [
  {
    module: "h",
    name: "helper0",
    kind: "function",
  },
  {
    module: "h",
    name: "qemu_ld_i64",
    kind: "function",
  },
  {
    module: "h",
    name: "qemu_st_i64",
    kind: "function",
  },
  {
    module: "env",
    name: "memory",
    kind: "memory",
  },
]);
assert.deepEqual(contract.exports, [
  {
    name: "start",
    kind: "function",
  },
]);

assert.throws(
  () => validateTBModuleContract(Uint8Array.from([0, 1, 2, 3])),
  /not valid WebAssembly/,
);

const probe = await runTBModuleEmitterProbe();
assert.equal(probe.format, 1);
assert.equal(probe.purpose, "qemu-wasm64-tb-module-emitter");
assert.equal(probe.version, TB_MODULE_EMITTER_MODEL_VERSION);
assert.equal(probe.ok, true);
assert.equal(probe.storedSum, "42");
assert.equal(probe.result, "25769803818");
assert.equal(probe.storedHelperResult, "25769803818");
assert.equal(probe.expected, "25769803818");
assert.deepEqual(probe.helperCalls, [
  {
    opcode: 7,
    value: "42",
  },
]);

const loweringModuleBytes = buildLoweringSubsetModule();
assert.equal(WebAssembly.validate(loweringModuleBytes), true);
validateTBModuleContract(loweringModuleBytes);
assert.equal(
  countSubsequence(loweringModuleBytes, atomicFence()),
  LOWERING_SUBSET_BLOCK.filter((op) => op.op === "mb").length,
);

const interpretedMemory = new WebAssembly.Memory({ initial: 1 });
const interpretedView = new DataView(interpretedMemory.buffer);
const interpretedHelperCalls = [];
interpretedView.setBigUint64(64, 19n, true);
interpretedView.setBigUint64(72, 23n, true);
const interpretedResult = interpretLoweringSubset(
  LOWERING_SUBSET_BLOCK,
  interpretedView,
  64,
  {
    helper0(opcode, value) {
      interpretedHelperCalls.push({ opcode, value: value.toString() });
      return (6n << 32n) | (value & 0xffffffffn);
    },
    qemuLd(reg, addr, oi) {
      return BigInt.asUintN(64, addr ^ BigInt(oi));
    },
    qemuSt() {
    },
  },
);
assert.equal(interpretedResult.toString(), "25769803818");
assert.equal(interpretedView.getBigUint64(80, true).toString(), "42");
assert.equal(interpretedView.getBigUint64(88, true).toString(), "25769803818");
assert.equal(interpretedView.getBigUint64(96, true).toString(), "1");
assert.equal(interpretedView.getBigUint64(112, true).toString(), "1234605616436508552");
assert.equal(interpretedView.getBigUint64(120, true).toString(), "1");
assert.deepEqual(interpretedHelperCalls, []);

const loweringProbe = await runLoweringSubsetProbe();
assert.equal(loweringProbe.format, 1);
assert.equal(loweringProbe.purpose, "qemu-wasm64-lowering-subset");
assert.equal(loweringProbe.ok, true);
assert.equal(loweringProbe.ops, LOWERING_SUBSET_BLOCK.length);
assert.equal(loweringProbe.cases.length, 2);
assert.deepEqual(loweringProbe.counters, {
  generatedBlocks: 2,
  helperFallbacks: 1,
  qemuLoadFallbacks: 2,
  qemuStoreFallbacks: 2,
  directLoadOps: 2,
  directStoreOps: 2,
  setcond32Ops: 2,
  memoryBarrierOps: 2,
});

const branchTaken = loweringProbe.cases.find((entry) =>
  entry.name === "branch-taken-skip-helper");
assert.equal(branchTaken.ok, true);
assert.equal(branchTaken.generatedResult, branchTaken.interpretedResult);
assert.deepEqual(branchTaken.generatedContext, branchTaken.interpretedContext);
assert.deepEqual(branchTaken.generatedContext, {
  16: "42",
  24: "25769803818",
  32: "1",
  40: "4294967314",
  48: "1234605616436508552",
  56: "1",
});
assert.deepEqual(branchTaken.generatedHelperCalls, []);
assert.deepEqual(branchTaken.interpretedHelperCalls, []);
assert.deepEqual(branchTaken.generatedQemuLoadCalls, [
  {
    reg: 9,
    addr: "4294967296",
    oi: 18,
    result: "4294967314",
  },
]);
assert.deepEqual(branchTaken.generatedQemuLoadCalls, branchTaken.interpretedQemuLoadCalls);
assert.deepEqual(branchTaken.generatedQemuStoreCalls, [
  {
    reg: 9,
    addr: "4294967296",
    value: "25769803818",
    oi: 19,
  },
]);
assert.deepEqual(branchTaken.generatedQemuStoreCalls, branchTaken.interpretedQemuStoreCalls);

const branchNotTaken = loweringProbe.cases.find((entry) =>
  entry.name === "branch-not-taken-helper");
assert.equal(branchNotTaken.ok, true);
assert.equal(branchNotTaken.generatedResult, branchNotTaken.interpretedResult);
assert.deepEqual(branchNotTaken.generatedContext, branchNotTaken.interpretedContext);
assert.deepEqual(branchNotTaken.generatedContext, {
  16: "43",
  24: "25769803819",
  32: "0",
  40: "4294967314",
  48: "1234605616436508552",
  56: "1",
});
assert.deepEqual(branchNotTaken.generatedHelperCalls, [
  {
    opcode: 7,
    value: "43",
  },
]);
assert.deepEqual(branchNotTaken.generatedHelperCalls, branchNotTaken.interpretedHelperCalls);
assert.deepEqual(branchNotTaken.generatedQemuLoadCalls, [
  {
    reg: 9,
    addr: "4294967296",
    oi: 18,
    result: "4294967314",
  },
]);
assert.deepEqual(branchNotTaken.generatedQemuLoadCalls, branchNotTaken.interpretedQemuLoadCalls);
assert.deepEqual(branchNotTaken.generatedQemuStoreCalls, [
  {
    reg: 9,
    addr: "4294967296",
    value: "25769803819",
    oi: 19,
  },
]);
assert.deepEqual(branchNotTaken.generatedQemuStoreCalls, branchNotTaken.interpretedQemuStoreCalls);

console.log("wasm-tb-module-emitter-test: ok");
