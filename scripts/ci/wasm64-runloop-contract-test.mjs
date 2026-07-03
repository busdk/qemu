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
  WASMJIT_COUNTERS,
  WASMJIT_ENV_OFFSET_INVALID,
  WASMJIT_HOTSET,
  WASMJIT_HOTSET_TB,
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
  const pattern = new RegExp(`#define\\s+${name}\\s+(0x[0-9a-fA-F]+|[0-9]+)u`);
  const match = header.match(pattern);

  assert.notEqual(match, null, `missing macro ${name}`);
  return Number.parseInt(match[1], 0);
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
for (const field of ["env", "guest_ram", "budget", "counters", "exit", "mode", "flags", "hotset"]) {
  assert.match(header, new RegExp(field));
}
assert.equal(macroValue("TCG_WASM64_RUN_CTX_ENV_OFFSET"), WASMJIT_RUN_CTX.env);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_GUEST_RAM_OFFSET"), WASMJIT_RUN_CTX.guestRam);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_BUDGET_OFFSET"), WASMJIT_RUN_CTX.budget);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_COUNTERS_OFFSET"), WASMJIT_RUN_CTX.counters);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_EXIT_OFFSET"), WASMJIT_RUN_CTX.exit);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_MODE_OFFSET"), WASMJIT_RUN_CTX.mode);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_FLAGS_OFFSET"), WASMJIT_RUN_CTX.flags);
assert.equal(macroValue("TCG_WASM64_RUN_CTX_HOTSET_OFFSET"), WASMJIT_RUN_CTX.hotset);
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
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_GENERATED_GUEST_INSTRUCTIONS_OFFSET"),
  WASMJIT_COUNTERS.generatedGuestInstructions,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_FALLBACK_GUEST_INSTRUCTIONS_OFFSET"),
  WASMJIT_COUNTERS.fallbackGuestInstructions,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_GENERATED_BODY_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.generatedBodyTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_TCI_DISPATCH_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.tciDispatchTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_TB_LOOKUP_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.tbLookupTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_HELPER_CALL_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.helperCallTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_QEMU_LD_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.qemuLdTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_QEMU_ST_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.qemuStTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_COMPILE_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.compileTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_INSTANTIATE_TIME_NS_OFFSET"),
  WASMJIT_COUNTERS.instantiateTimeNs,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_GENERATED_CHAIN_LENGTH_OFFSET"),
  WASMJIT_COUNTERS.generatedChainLength,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_INLINE_TLB_HIT_LOADS_OFFSET"),
  WASMJIT_COUNTERS.inlineTlbHitLoads,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_INLINE_TLB_HIT_STORES_OFFSET"),
  WASMJIT_COUNTERS.inlineTlbHitStores,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_HELPER_CALLS_OFFSET"),
  WASMJIT_COUNTERS.helperCalls,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_QEMU_LD_CALLS_OFFSET"),
  WASMJIT_COUNTERS.qemuLoadCalls,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_QEMU_ST_CALLS_OFFSET"),
  WASMJIT_COUNTERS.qemuStoreCalls,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_BUDGET_OFFSET"),
  WASMJIT_COUNTERS.exitsBudget,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_MMIO_OFFSET"),
  WASMJIT_COUNTERS.exitsMmio,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_TLB_MISS_OR_FAULT_OFFSET"),
  WASMJIT_COUNTERS.exitsTlbMissOrFault,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_INTERRUPT_OFFSET"),
  WASMJIT_COUNTERS.exitsInterrupt,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_HELPER_OFFSET"),
  WASMJIT_COUNTERS.exitsHelper,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_UNSUPPORTED_OFFSET"),
  WASMJIT_COUNTERS.exitsUnsupported,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_HLT_OFFSET"),
  WASMJIT_COUNTERS.exitsHlt,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_COUNTERS_EXITS_INVALIDATED_OFFSET"),
  WASMJIT_COUNTERS.exitsInvalidated,
);
assert.equal(macroValue("TCG_WASM64_RUN_COUNTERS_SIZE"), WASMJIT_COUNTERS.size);

assert.doesNotMatch(header, /TARGET_RISCV64/);
assert.doesNotMatch(runtime, /TARGET_RISCV64/);
assert.doesNotMatch(runtime, /offsetof\(CPUArchState, gpr/);
assert.match(runtime, /tcg_wasm64_metadata_env_offset/);
assert.match(runtime, /tb->value_env_offset =\s*\n\s*tcg_wasm64_metadata_env_offset\(metadata, tb->value_reg\)/);
assert.match(runtime, /tb->store_env_offset =\s*\n\s*tcg_wasm64_metadata_env_offset\(metadata, tb->store_reg\)/);
assert.equal(
  macroValue("TCG_WASM64_RUN_ENV_OFFSET_INVALID"),
  WASMJIT_ENV_OFFSET_INVALID,
);

assert.match(header, /typedef enum TCGWasm64RunHotsetOp/);
assert.match(header, /TCG_WASM64_RUN_HOTSET_OP_RAM_ADD_CONST = 1/);
assert.match(header, /TCG_WASM64_RUN_HOTSET_OP_RAM_XOR_CONST = 2/);
assert.match(header, /TCG_WASM64_RUN_HOTSET_OP_ALU_ADD_CONST = 3/);
assert.match(header, /TCG_WASM64_RUN_HOTSET_OP_ALU_XOR_CONST = 4/);
assert.match(header, /TCG_WASM64_RUN_HOTSET_OP_TRACE_LD32U_BRANCH_STORE = 5/);
assert.match(header, /typedef struct TCGWasm64RunHotsetTB/);
for (const field of [
  "tb_id",
  "next_tb_id",
  "op",
  "guest_instructions",
  "immediate",
  "value_reg",
  "base_reg",
  "load_offset",
  "store_offset",
  "branch_reg",
  "store_reg",
  "branch_cond",
  "terminal_op",
  "terminal_diff",
  "flags",
  "value_env_offset",
  "base_env_offset",
  "branch_env_offset",
  "store_env_offset",
]) {
  assert.match(header, new RegExp(field));
}
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_ID_OFFSET"),
  WASMJIT_HOTSET_TB.tbId,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_NEXT_TB_ID_OFFSET"),
  WASMJIT_HOTSET_TB.nextTbId,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_OP_OFFSET"),
  WASMJIT_HOTSET_TB.op,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_GUEST_INSTRUCTIONS_OFFSET"),
  WASMJIT_HOTSET_TB.guestInstructions,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_IMMEDIATE_OFFSET"),
  WASMJIT_HOTSET_TB.immediate,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_VALUE_REG_OFFSET"),
  WASMJIT_HOTSET_TB.valueReg,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_BASE_REG_OFFSET"),
  WASMJIT_HOTSET_TB.baseReg,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_LOAD_OFFSET_OFFSET"),
  WASMJIT_HOTSET_TB.loadOffset,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_STORE_OFFSET_OFFSET"),
  WASMJIT_HOTSET_TB.storeOffset,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_BRANCH_REG_OFFSET"),
  WASMJIT_HOTSET_TB.branchReg,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_STORE_REG_OFFSET"),
  WASMJIT_HOTSET_TB.storeReg,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_BRANCH_COND_OFFSET"),
  WASMJIT_HOTSET_TB.branchCond,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_TERMINAL_OP_OFFSET"),
  WASMJIT_HOTSET_TB.terminalOp,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_TERMINAL_DIFF_OFFSET"),
  WASMJIT_HOTSET_TB.terminalDiff,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_FLAGS_OFFSET"),
  WASMJIT_HOTSET_TB.flags,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_VALUE_ENV_OFFSET_OFFSET"),
  WASMJIT_HOTSET_TB.valueEnvOffset,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_BASE_ENV_OFFSET_OFFSET"),
  WASMJIT_HOTSET_TB.baseEnvOffset,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_BRANCH_ENV_OFFSET_OFFSET"),
  WASMJIT_HOTSET_TB.branchEnvOffset,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_STORE_ENV_OFFSET_OFFSET"),
  WASMJIT_HOTSET_TB.storeEnvOffset,
);
assert.equal(macroValue("TCG_WASM64_RUN_HOTSET_TB_SIZE"), WASMJIT_HOTSET_TB.size);
assert.match(header, /typedef struct TCGWasm64RunHotset/);
assert.match(header, /typedef enum TCGWasm64RunHotsetBuildStatus/);
for (const name of [
  "TCG_WASM64_RUN_HOTSET_BUILD_OK",
  "TCG_WASM64_RUN_HOTSET_BUILD_EMPTY",
  "TCG_WASM64_RUN_HOTSET_BUILD_CAPACITY",
  "TCG_WASM64_RUN_HOTSET_BUILD_MISSING_METADATA",
  "TCG_WASM64_RUN_HOTSET_BUILD_INVALID_METADATA",
  "TCG_WASM64_RUN_HOTSET_BUILD_NON_TERMINAL",
  "TCG_WASM64_RUN_HOTSET_BUILD_UNSUPPORTED_HOT_TB",
  "TCG_WASM64_RUN_HOTSET_BUILD_NO_GENERATED_OUTPUT",
  "TCG_WASM64_RUN_HOTSET_BUILD_OUTPUT_TRUNCATED",
]) {
  assert.match(header, new RegExp(name));
  assert.match(runtime, new RegExp(name));
}
assert.match(header, /tcg_wasm64_run_hotset_build_from_metadata/);
assert.match(header, /tcg_wasm64_run_hotset_build_status_name/);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_TB_COUNT_OFFSET"),
  WASMJIT_HOTSET.tbCount,
);
assert.equal(
  macroValue("TCG_WASM64_RUN_HOTSET_ENTRY_TB_ID_OFFSET"),
  WASMJIT_HOTSET.entryTbId,
);
assert.equal(macroValue("TCG_WASM64_RUN_HOTSET_TBS_OFFSET"), WASMJIT_HOTSET.tbs);
assert.equal(macroValue("TCG_WASM64_RUN_HOTSET_SIZE"), WASMJIT_HOTSET.size);

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
assert.match(runtime, /QEMU_BUILD_BUG_ON\(sizeof\(TCGWasm64RunCounters\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(sizeof\(TCGWasm64RunHotsetTB\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(sizeof\(TCGWasm64RunHotset\) !=/);
assert.match(runtime, /QEMU_WASM64_RUNLOOP_SMOKE/);
assert.match(runtime, /QEMU_WASM64_RUNLOOP_ATTACH_PROBE/);
assert.match(runtime, /qemu-wasm64-runloop: /);
assert.match(runtime, /tcg_wasm64_runloop_smoke_js/);
assert.match(runtime, /runCtxHotsetOffset = 48/);
assert.match(runtime, /runExitValueOffset = 32/);
assert.match(runtime, /hotsetTbSize = 80/);
assert.match(runtime, /hotsetOpRamAddConst = 1/);
assert.match(runtime, /hotsetOpRamXorConst = 2/);
assert.match(runtime, /hotsetOpAluAddConst = 3/);
assert.match(runtime, /hotsetOpAluXorConst = 4/);
assert.match(runtime, /smoke_hotset/);
assert.match(runtime, /tcg_wasm64_runloop_hotset_expected_value/);
assert.match(runtime, /tcg_wasm64_run_hotset_build_from_metadata/);
assert.match(runtime, /tcg_wasm64_translate_generated_output_available/);
assert.match(runtime, /tcg_wasm64_run_hotset_decode_semantic/);
assert.match(runtime, /tcg_wasm64_runloop_generated_hotset/);
assert.match(runtime, /tcg_wasm64_runloop_interpret_metadata_hotset/);
assert.match(runtime, /tcg_wasm64_report_runloop_benchmark/);
assert.match(runtime, /tcg_wasm64_runloop_benchmark_hotset/);
assert.match(runtime, /tcg_wasm64_runloop_attach_probe/);
assert.match(runtime, /runloop_attach_probe_unsupported_generated_ops/);
assert.match(runtime, /runloop_attach_probe_unsupported_semantic_shape/);
assert.match(runtime, /runloop_attach_probe_unsupported_other/);
assert.match(runtime, /runloop_attach_probe_semantic_first_ops/);
assert.match(runtime, /tcg_wasm64_tci_encode_rrs\(INDEX_op_ld/);
assert.match(runtime, /tcg_wasm64_tci_encode_ri\(INDEX_op_tci_movi/);
assert.match(runtime, /tcg_wasm64_tci_encode_rrr\(INDEX_op_add/);
assert.match(runtime, /tcg_wasm64_tci_encode_rl\(INDEX_op_brcond/);
assert.match(runtime, /tcg_wasm64_tci_op\(words\[2\]\) == INDEX_op_brcond/);
assert.match(runtime, /TCG_WASM64_RUN_HOTSET_OP_TRACE_LD32U_BRANCH_STORE/);
assert.match(runtime, /tcg_wasm64_tci_op\(words\[0\]\) == INDEX_op_ld32u/);
assert.match(runtime, /tcg_wasm64_tci_cond4\(words\[2\]\)/);
assert.match(runtime, /tcg_wasm64_tci_terminal_op\(tcg_wasm64_tci_op\(words\[index\]\)\)/);
assert.match(runtime, /TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE/);
assert.match(runtime, /TCG_WASM64_TB_METADATA_TERMINAL/);
assert.match(runtime, /TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED/);
assert.match(runtime, /generated_unsupported_op_count != 0/);
assert.match(runtime, /\\"source\\":\\"%s\\"/);
assert.match(runtime, /hotset_build_status/);
assert.match(runtime, /metadata-hotset/);
assert.match(runtime, /runtime-benchmark/);
assert.match(runtime, /tlb-hit-ram/);
assert.match(runtime, /alu-branch/);
assert.match(runtime, /ratio_ppm/);
assert.match(runtime, /0x02,\s*0x07,\s*0x00,\s*0x80,\s*0x80,\s*0x10/);
assert.match(runtime, /generated_guest_instructions == budget \* 5/);
assert.match(runtime, /inline_tlb_hit_loads == budget/);
assert.match(runtime, /exit.value == expected_smoke_ram/);
assert.match(runtime, /smoke_ram == expected_smoke_ram/);

console.log("wasm64 runloop contract: ok");
