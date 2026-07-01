#!/usr/bin/env node
/*
 * Test generated WebAssembly block prototype helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  buildGeneratedBlockModule,
  createGeneratedBlockCache,
  encodeS32,
  encodeS64,
  encodeU32,
  GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION,
  interpretContextBlock,
  interpretGeneratedSubset,
  packDispatchResult,
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
assert.equal(packDispatchResult(1, 100), "4294967396");
assert.equal(packDispatchResult(2, 82), "8589934674");
assert.equal(interpretGeneratedSubset(1, 2), "8589934678");
assert.equal(interpretGeneratedSubset(-1, 1), "4294967396");
assert.deepEqual(interpretContextBlock(19n, 23n), {
  sum: "42",
  dispatch: "21474836522",
});

const generatedCache = createGeneratedBlockCache({ maxEntries: 2 });
let cacheCompiles = 0;
assert.equal(
  generatedCache.getOrCompile("tb:1", "sig:a", () => `compiled:${++cacheCompiles}`),
  "compiled:1",
);
assert.equal(
  generatedCache.getOrCompile("tb:1", "sig:a", () => `compiled:${++cacheCompiles}`),
  "compiled:1",
);
assert.equal(
  generatedCache.getOrCompile("tb:1", "sig:b", () => `compiled:${++cacheCompiles}`),
  "compiled:2",
);
assert.equal(
  generatedCache.getOrCompile("tb:2", "sig:c", () => `compiled:${++cacheCompiles}`),
  "compiled:3",
);
assert.equal(
  generatedCache.getOrCompile("tb:3", "sig:d", () => `compiled:${++cacheCompiles}`),
  "compiled:4",
);
assert.equal(generatedCache.size, 2);
assert.deepEqual(generatedCache.stats(), {
  hits: 1,
  misses: 3,
  stale: 1,
  evictions: 1,
});

for (const value of [-1, 1.5, 0x100000000]) {
  assert.throws(() => encodeU32(value), /unsigned 32-bit/);
}
for (const value of [-0x80000001, 0x80000000, 1.5]) {
  assert.throws(() => encodeS32(value), /signed 32-bit/);
}
assert.throws(() => createGeneratedBlockCache({ maxEntries: 0 }), /positive/);
assert.throws(
  () => generatedCache.getOrCompile("", "sig", () => undefined),
  /non-empty/,
);
assert.throws(
  () => generatedCache.getOrCompile("tb", "", () => undefined),
  /non-empty/,
);
assert.throws(
  () => generatedCache.getOrCompile("tb", "sig"),
  /compile callback/,
);

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
assert.equal(probe.subsetDifferentialMismatches, 0);
assert.equal(probe.contextBlockResult, "21474836522");
assert.equal(probe.contextBlockStored, "42");
assert.equal(probe.subsetDifferentialCases.length, 5);
for (const entry of probe.subsetDifferentialCases) {
  assert.equal(entry.generated, entry.expected);
  assert.equal(entry.ok, true);
}
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
        subsetDifferentialCases: [
          {
            generated: "8589934678",
            expected: "8589934678",
            ok: true,
          },
          {
            generated: "4294967396",
            expected: "4294967396",
            ok: true,
          },
          {
            generated: "8589934677",
            expected: "8589934677",
            ok: true,
          },
          {
            generated: "8589934637",
            expected: "8589934637",
            ok: true,
          },
          {
            generated: "8589934677",
            expected: "8589934677",
            ok: true,
          },
        ],
        subsetDifferentialMismatches: 0,
        contextBlockResult: "21474836522",
        contextBlockStored: "42",
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
