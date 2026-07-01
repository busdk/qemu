#!/usr/bin/env node
/*
 * Test generated WebAssembly block prototype helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  buildGeneratedBlockModule,
  encodeU32,
  parseArgs,
  runGeneratedBlockProbe,
  validatePrototypeResult,
} from "./wasm-generated-block-prototype.mjs";

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(127), [127]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeU32(624485), [229, 142, 38]);

for (const value of [-1, 1.5, 0x100000000]) {
  assert.throws(() => encodeU32(value), /unsigned 32-bit/);
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
