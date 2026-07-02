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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const header = read("tcg/wasm64.h");
const runtime = read("tcg/wasm64.c");

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

assert.match(runtime, /void tcg_wasm64_run_counters_reset/);
assert.match(runtime, /void tcg_wasm64_run_counters_add/);
assert.match(runtime, /void tcg_wasm64_run_count_exit/);
assert.match(runtime, /const char \*tcg_wasm64_run_exit_reason_name/);
assert.match(runtime, /return "budget"/);
assert.match(runtime, /return "tlb-miss-or-fault"/);
assert.match(runtime, /return "invalidated"/);

console.log("wasm64 runloop contract: ok");
