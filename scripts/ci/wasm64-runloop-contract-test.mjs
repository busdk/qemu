#!/usr/bin/env node
/*
 * Test the QEMU-facing wasmjit run-loop ABI contract.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WASMJIT_RUN_CTX,
  WASMJIT_RUN_EXIT,
} from "./wasmjit-runloop-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const header = read("tcg/wasm64.h");
const runtime = read("tcg/wasm64.c");

function macroValue(name) {
  const pattern = new RegExp(`#define\\s+${name}\\s+([0-9]+)u`);
  const match = header.match(pattern);

  assert.notEqual(match, null, `missing macro ${name}`);
  return Number(match[1]);
}

assert.match(header, /typedef enum TCGWasm64RunMode/);
assert.match(header, /TCG_WASM64_RUN_MODE_COMPAT = 0/);
assert.match(header, /TCG_WASM64_RUN_MODE_PERF_PROOF = 1/);
assert.match(header, /typedef enum TCGWasm64RunExitReason/);
for (const name of [
  "TCG_WASM64_RUN_EXIT_BUDGET",
  "TCG_WASM64_RUN_EXIT_MMIO",
  "TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT",
  "TCG_WASM64_RUN_EXIT_INTERRUPT",
  "TCG_WASM64_RUN_EXIT_HELPER",
  "TCG_WASM64_RUN_EXIT_UNSUPPORTED",
  "TCG_WASM64_RUN_EXIT_HLT",
  "TCG_WASM64_RUN_EXIT_INVALIDATED",
]) {
  assert.match(header, new RegExp(name));
  assert.match(runtime, new RegExp(`case ${name}:`));
}

assert.match(header, /typedef struct TCGWasm64RunExit/);
for (const field of ["reason", "tb_id", "pc", "vaddr", "paddr", "value", "size", "flags"]) {
  assert.match(header, new RegExp(field));
}

assert.match(header, /typedef struct TCGWasm64RunCounters/);
for (const field of [
  "generated_guest_instructions",
  "fallback_guest_instructions",
  "generated_body_time_ns",
  "tci_dispatch_time_ns",
  "tb_lookup_time_ns",
  "helper_call_time_ns",
  "qemu_ld_time_ns",
  "qemu_st_time_ns",
  "compile_time_ns",
  "instantiate_time_ns",
  "generated_chain_length",
  "inline_tlb_hit_loads",
  "inline_tlb_hit_stores",
  "helper_calls",
  "qemu_ld_calls",
  "qemu_st_calls",
  "exits_budget",
  "exits_mmio",
  "exits_tlb_miss_or_fault",
  "exits_interrupt",
  "exits_helper",
  "exits_unsupported",
  "exits_hlt",
  "exits_invalidated",
]) {
  assert.match(header, new RegExp(field));
  assert.match(runtime, new RegExp(`${field} \\+= src->${field}`));
}

assert.match(header, /typedef struct TCGWasm64RunContext/);
for (const field of ["env", "guest_ram", "budget", "counters", "exit", "mode", "flags"]) {
  assert.match(header, new RegExp(field));
}
assert.equal(macroValue("TCG_WASM64_RUN_CTX_ENV_OFFSET"), WASMJIT_RUN_CTX.env);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_GUEST_RAM_OFFSET"), WASMJIT_RUN_CTX.guestRam);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_BUDGET_OFFSET"), WASMJIT_RUN_CTX.budget);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_COUNTERS_OFFSET"), WASMJIT_RUN_CTX.counters);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_EXIT_OFFSET"), WASMJIT_RUN_CTX.exit);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_MODE_OFFSET"), WASMJIT_RUN_CTX.mode);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_FLAGS_OFFSET"), WASMJIT_RUN_CTX.flags);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_SIZE"), WASMJIT_RUN_CTX.size);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_REASON_OFFSET"), WASMJIT_RUN_EXIT.reason);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_TB_ID_OFFSET"), WASMJIT_RUN_EXIT.tbId);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_PC_OFFSET"), WASMJIT_RUN_EXIT.pc);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_VADDR_OFFSET"), WASMJIT_RUN_EXIT.vaddr);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_PADDR_OFFSET"), WASMJIT_RUN_EXIT.paddr);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_VALUE_OFFSET"), WASMJIT_RUN_EXIT.value);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_SIZE_OFFSET"), WASMJIT_RUN_EXIT.sizeField);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_FLAGS_OFFSET"), WASMJIT_RUN_EXIT.flags);
assert.equal(macroValue("TCG_WASM64_RUN_EXIT_SIZE"), WASMJIT_RUN_EXIT.size);

assert.match(runtime, /void tcg_wasm64_run_counters_reset/);
assert.match(runtime, /void tcg_wasm64_run_counters_add/);
assert.match(runtime, /void tcg_wasm64_run_count_exit/);
assert.match(runtime, /const char \*tcg_wasm64_run_exit_reason_name/);
assert.match(runtime, /return "budget"/);
assert.match(runtime, /return "tlb-miss-or-fault"/);
assert.match(runtime, /return "invalidated"/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64RunContext, env\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(sizeof\(TCGWasm64RunContext\) != TCG_WASM64_RUN_CTX_SIZE\)/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(sizeof\(TCGWasm64RunExit\) != TCG_WASM64_RUN_EXIT_SIZE\)/);

console.log("wasm64 runloop contract: ok");
