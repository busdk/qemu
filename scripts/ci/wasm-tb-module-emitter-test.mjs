#!/usr/bin/env node
/*
 * Test deterministic generated-TB WebAssembly module shape.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
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

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(127), [127]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeU32(624485), [229, 142, 38]);
assert.deepEqual(encodeS64(0n), [0]);
assert.deepEqual(encodeS64(42n), [42]);
assert.deepEqual(encodeS64(-1n), [127]);

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

const interpretedMemory = new WebAssembly.Memory({ initial: 1 });
const interpretedView = new DataView(interpretedMemory.buffer);
const interpretedHelperCalls = [];
interpretedView.setBigUint64(64, 19n, true);
interpretedView.setBigUint64(72, 23n, true);
const interpretedResult = interpretLoweringSubset(
  LOWERING_SUBSET_BLOCK,
  interpretedView,
  64,
  (opcode, value) => {
    interpretedHelperCalls.push({ opcode, value: value.toString() });
    return (6n << 32n) | (value & 0xffffffffn);
  },
);
assert.equal(interpretedResult.toString(), "25769803818");
assert.equal(interpretedView.getBigUint64(80, true).toString(), "42");
assert.equal(interpretedView.getBigUint64(88, true).toString(), "25769803818");
assert.equal(interpretedView.getBigUint64(96, true).toString(), "1");
assert.deepEqual(interpretedHelperCalls, [
  {
    opcode: 7,
    value: "42",
  },
]);

const loweringProbe = await runLoweringSubsetProbe();
assert.equal(loweringProbe.format, 1);
assert.equal(loweringProbe.purpose, "qemu-wasm64-lowering-subset");
assert.equal(loweringProbe.ok, true);
assert.equal(loweringProbe.ops, LOWERING_SUBSET_BLOCK.length);
assert.equal(loweringProbe.generatedResult, loweringProbe.interpretedResult);
assert.deepEqual(loweringProbe.generatedContext, loweringProbe.interpretedContext);
assert.deepEqual(loweringProbe.generatedHelperCalls, loweringProbe.interpretedHelperCalls);
assert.deepEqual(loweringProbe.generatedContext, {
  16: "42",
  24: "25769803818",
  32: "1",
});

console.log("wasm-tb-module-emitter-test: ok");
