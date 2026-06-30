#!/usr/bin/env node
/*
 * Test browser WebAssembly smoke runner helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import { isTerminalPageStatus } from "./wasm-browser-smoke-runner.mjs";

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
