#!/usr/bin/env node
/*
 * Test deterministic generated-TB WebAssembly module shape.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  buildTBModule,
  encodeU32,
  runTBModuleEmitterProbe,
  TB_MODULE_EMITTER_MODEL_VERSION,
  validateTBModuleContract,
} from "./wasm-tb-module-emitter.mjs";

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(127), [127]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeU32(624485), [229, 142, 38]);

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

console.log("wasm-tb-module-emitter-test: ok");
