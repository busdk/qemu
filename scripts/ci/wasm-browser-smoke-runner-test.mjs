#!/usr/bin/env node
/*
 * Test browser WebAssembly smoke runner helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  isTerminalPageStatus,
  promoteSmokeState,
} from "./wasm-browser-smoke-runner.mjs";

const marker = "QEMU_WASM_LINUX_BOOT_OK";

for (const status of [
  `marker reached: ${marker}`,
  "program exited before marker: status 1",
  "timeout waiting for marker: QEMU_WASM_LINUX_BOOT_OK",
  "timeout waiting for marker or expected text: Bus Engine OS",
  "failed",
]) {
  assert.equal(isTerminalPageStatus(status, marker), true, `${status} should be terminal`);
}

for (const status of [
  "",
  "initializing smoke harness",
  "validating browser WebAssembly features",
  "loading smoke guest inputs",
  "loading QEMU WebAssembly module",
  "starting QEMU",
  "QEMU started; waiting for marker",
  "marker reached: some-other-marker",
  "program exited after marker: status 0",
]) {
  assert.equal(isTerminalPageStatus(status, marker), false, `${status} should not be terminal`);
}

{
  const result = {};
  promoteSmokeState(result, {
    expectedTextSeen: [{ text: "Bus Engine OS", seen: true }],
    failurePhase: "fetch-guest-inputs",
    lastLine: "last serial line",
    lines: 42,
    markerSeen: false,
    outputBytes: 1234,
    outputSuppressed: true,
    phase: "failed",
    phases: [
      { phase: "init", elapsedMs: 0, message: "initializing smoke harness" },
      { phase: "failed", elapsedMs: 10, failedDuring: "fetch-guest-inputs" },
    ],
    programExitStatus: null,
    qemuArgs: ["-M", "microvm,acpi=off", "-nic", "none"],
  });

  assert.equal(result.phase, "failed");
  assert.equal(result.failurePhase, "fetch-guest-inputs");
  assert.equal(result.markerSeen, false);
  assert.equal(result.programExitStatus, null);
  assert.equal(result.outputLines, 42);
  assert.equal(result.outputBytes, 1234);
  assert.equal(result.outputSuppressed, true);
  assert.equal(result.lastLine, "last serial line");
  assert.deepEqual(result.expectedTextSeen, [{ text: "Bus Engine OS", seen: true }]);
  assert.deepEqual(result.qemuCommand, ["-M", "microvm,acpi=off", "-nic", "none"]);
  assert.equal(result.phases[1].failedDuring, "fetch-guest-inputs");
}

{
  const result = { untouched: true };
  promoteSmokeState(result, null);

  assert.deepEqual(result, { untouched: true });
}
