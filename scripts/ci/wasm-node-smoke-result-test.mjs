#!/usr/bin/env node
/*
 * Unit tests for QEMU WebAssembly Node.js smoke result helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  describeMissingText,
  earlyProgramExitEvidence,
  programExitStatus,
  runtimeErrorEvidence,
  timeoutEvidence,
} from "./wasm-node-smoke-result.mjs";

const expectedTextSeen = [
  { text: "Bus Engine OS", seen: true },
  { text: "QEMU_WASM_LINUX_BOOT_OK", seen: false },
];

assert.equal(programExitStatus("program exited (with status: 0)"), 0);
assert.equal(programExitStatus("program exited (with status: 42)"), 42);
assert.equal(programExitStatus("not a status line"), null);

assert.deepEqual(describeMissingText(expectedTextSeen), [
  "QEMU_WASM_LINUX_BOOT_OK",
]);

assert.deepEqual(timeoutEvidence(false, expectedTextSeen), {
  timeout: true,
  markerMissing: true,
  missingExpectedText: ["QEMU_WASM_LINUX_BOOT_OK"],
});

assert.deepEqual(earlyProgramExitEvidence(0, true, expectedTextSeen), {
  earlyProgramExit: true,
  programExitStatus: 0,
  markerMissing: false,
  missingExpectedText: ["QEMU_WASM_LINUX_BOOT_OK"],
});

const error = new TypeError("failed to instantiate wasm module");
const runtimeEvidence = runtimeErrorEvidence(error, false, expectedTextSeen);
assert.equal(runtimeEvidence.errorName, "TypeError");
assert.equal(runtimeEvidence.errorMessage, "failed to instantiate wasm module");
assert.match(runtimeEvidence.errorStack, /TypeError: failed to instantiate wasm module/);
assert.equal(runtimeEvidence.markerMissing, true);
assert.deepEqual(runtimeEvidence.missingExpectedText, [
  "QEMU_WASM_LINUX_BOOT_OK",
]);
