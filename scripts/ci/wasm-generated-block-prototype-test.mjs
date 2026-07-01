#!/usr/bin/env node
/*
 * Test generated WebAssembly block prototype helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  buildGeneratedBlockModule,
  encodeS32,
  encodeS64,
  encodeU32,
  GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
  parseArgs,
  runGeneratedBlockProbe,
  validateGeneratedBlockControlFlow,
  validatePrototypeResult,
} from "./wasm-generated-block-prototype.mjs";

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(127), [127]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeU32(624485), [229, 142, 38]);
assert.deepEqual(encodeS32(0), [0]);
assert.deepEqual(encodeS32(63), [63]);
assert.deepEqual(encodeS32(64), [192, 0]);
assert.deepEqual(encodeS32(100), [228, 0]);
assert.deepEqual(encodeS32(-1), [127]);
assert.deepEqual(encodeS64(32n), [32]);

for (const value of [-1, 1.5, 0x100000000]) {
  assert.throws(() => encodeU32(value), /unsigned 32-bit/);
}
for (const value of [-0x80000001, 0x80000000, 1.5]) {
  assert.throws(() => encodeS32(value), /signed 32-bit/);
}

assert.equal(WebAssembly.validate(buildGeneratedBlockModule()), true);

assert.deepEqual(
  parseArgs(["--runtime", "node", "--iterations", "17", "--timeout-ms", "1000"]),
  {
    browser: "chromium",
    iterations: 17,
    out: null,
    runtime: "node",
    timeoutMs: 1000,
  },
);

const probe = await runGeneratedBlockProbe(8, (() => {
  let now = 0;
  return () => now++;
})());

assert.equal(probe.ok, true);
assert.equal(probe.validate, true);
assert.equal(probe.add64, "42");
assert.equal(probe.mix32, 472);
assert.equal(probe.branchExitZero, "4294967396");
assert.equal(probe.branchExitNonzero, "8589934626");
assert.equal(probe.countdownExit, "12884901898");
assert.equal(probe.helperGateFast, "17179869198");
assert.equal(probe.helperGateFallback, "425201762319");
assert.equal(probe.helperFallbacks, 1);
assert.equal(probe.iterations, 8);
assert.equal(probe.compileMs, 1);
assert.equal(probe.instantiateMs, 1);
assert.equal(probe.executeMs, 1);

assert.equal(
  validatePrototypeResult({
    format: 1,
    runtimes: [
      {
        runtime: "node",
        ok: true,
        add64: "42",
        mix32: 472,
        branchExitZero: "4294967396",
        branchExitNonzero: "8589934626",
        countdownExit: "12884901898",
        helperGateFast: "17179869198",
        helperGateFallback: "425201762319",
        helperFallbacks: 1,
        compileMs: 0,
        executeMs: 0,
      },
    ],
  }),
  true,
);

assert.throws(
  () => validatePrototypeResult({ format: 1, runtimes: [{ runtime: "node", ok: false }] }),
  /generated-block prototype failed/,
);

assert.deepEqual(
  validateGeneratedBlockControlFlow({
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    ops: [
      { kind: "label", name: "entry" },
      { kind: "op", opcode: "mov" },
      { kind: "brcond", target: "exit" },
      { kind: "op", opcode: "add" },
      { kind: "label", name: "exit" },
      { kind: "exit", boundary: "tb-dispatch" },
    ],
  }),
  {
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    labels: 2,
    ops: 6,
    terminal: "exit",
  },
);

assert.deepEqual(
  validateGeneratedBlockControlFlow({
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    ops: [
      { kind: "label", name: "entry" },
      { kind: "helper", name: "qemu_ld", fallback: "tci" },
    ],
  }),
  {
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    labels: 1,
    ops: 2,
    terminal: "helper",
  },
);

assert.throws(
  () => validateGeneratedBlockControlFlow({
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    ops: [
      { kind: "label", name: "entry" },
      { kind: "brcond", target: "missing" },
      { kind: "exit", boundary: "tb-dispatch" },
    ],
  }),
  /branch target is not a known label/,
);

assert.throws(
  () => validateGeneratedBlockControlFlow({
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    ops: [
      { kind: "label", name: "entry" },
      { kind: "return-internal-pointer", pointer: "tci-bytecode" },
    ],
  }),
  /internal TCI pointers are not generated-block exits/,
);

assert.throws(
  () => validateGeneratedBlockControlFlow({
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    ops: [
      { kind: "label", name: "entry" },
      { kind: "helper", name: "qemu_st" },
    ],
  }),
  /helper calls require explicit TCI fallback/,
);

assert.throws(
  () => validateGeneratedBlockControlFlow({
    version: GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
    ops: [
      { kind: "label", name: "entry" },
      { kind: "exit", boundary: "raw-pointer" },
    ],
  }),
  /generated blocks may exit only through TB dispatch/,
);
