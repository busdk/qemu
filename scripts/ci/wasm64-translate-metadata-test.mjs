#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const target = read("tcg/wasm64/tcg-target.c.inc");
const runtime = read("tcg/wasm64.c");
const header = read("tcg/wasm64.h");
const tci = read("tcg/tci.c");
const tciTarget = read("tcg/tci/tcg-target.c.inc");
const generatedEquivalence = read("scripts/ci/wasm-generated-output-equivalence-test.mjs");

function metadataCacheIndex(tbPtr, size) {
  return Number((BigInt(tbPtr) >> 4n) % BigInt(size));
}

function insertMetadata(cache, tbPtr, probeLimit) {
  const start = metadataCacheIndex(tbPtr, cache.length);
  let firstEmpty = -1;
  for (let probe = 0; probe < probeLimit; probe++) {
    const index = (start + probe) % cache.length;
    const entry = cache[index];
    if (entry?.tbPtr === tbPtr) {
      cache[index] = { tbPtr, metadataTbPtr: tbPtr, valid: true };
      return index;
    }
    if (firstEmpty === -1 && !entry?.valid) {
      firstEmpty = index;
    }
  }
  const index = firstEmpty !== -1 ? firstEmpty : start;
  cache[index] = { tbPtr, metadataTbPtr: tbPtr, valid: true };
  return index;
}

function lookupMetadata(cache, tbPtr, probeLimit) {
  const start = metadataCacheIndex(tbPtr, cache.length);
  for (let probe = 0; probe < probeLimit; probe++) {
    const entry = cache[(start + probe) % cache.length];
    if (entry?.valid && entry.tbPtr === tbPtr && entry.metadataTbPtr === tbPtr) {
      return entry;
    }
  }
  return null;
}

{
  const cache = Array.from({ length: 4 }, () => null);
  assert.equal(insertMetadata(cache, 0x1000n, 2), 0);
  assert.equal(insertMetadata(cache, 0x1040n, 2), 1);
  assert.equal(lookupMetadata(cache, 0x1000n, 2)?.tbPtr, 0x1000n);
  assert.equal(lookupMetadata(cache, 0x1040n, 2)?.tbPtr, 0x1040n);
  cache[1].metadataTbPtr = 0x1000n;
  assert.equal(lookupMetadata(cache, 0x1040n, 2), null);
  assert.equal(insertMetadata(cache, 0x1080n, 2), 0);
  assert.equal(lookupMetadata(cache, 0x1000n, 2), null);
  assert.equal(lookupMetadata(cache, 0x1040n, 2), null);
  assert.equal(lookupMetadata(cache, 0x1080n, 2)?.tbPtr, 0x1080n);
}

assert.match(target, /#define\s+tcg_out_tci_note_op\s+tcg_wasm64_note_tci_op/);
assert.match(target, /#define\s+tcg_out32\s+tcg_wasm64_tci_out32/);
assert.match(target, /#define\s+tcg_out_tb_start\s+tcg_wasm64_tci_out_tb_start/);
assert.match(target, /tcg_wasm64_translate_begin\(tcg_splitwx_to_rx\(s->code_buf\)\)/);
assert.match(target, /tcg_wasm64_has_pending_tci_op\s*=\s*true/);
assert.match(target, /tcg_wasm64_translate_note_tci_op\(op\)/);
assert.match(target, /tcg_wasm64_translate_note_tci_insn\(tcg_wasm64_pending_tci_op,\s*insn\)/);
assert.match(target, /#undef\s+tcg_out32/);
assert.match(target, /#undef\s+tcg_out_tci_note_op/);

assert.match(tciTarget, /#ifndef\s+tcg_out_tci_note_op/);
assert.match(tciTarget, /tcg_out_tci_note_op\(s, op\);\s*\n\s*tcg_out32\(s, insn\);/);
assert.match(tciTarget, /tcg_out_tci_note_op\(s, INDEX_op_tci_movl\);/);
assert.match(tciTarget, /tcg_out_tci_note_op\(s, INDEX_op_call\);/);

assert.match(header, /typedef struct TCGWasm64TBMetadata/);
assert.match(header, /TCG_WASM64_TB_METADATA_FALLBACK/);
assert.match(header, /TCG_WASM64_TB_METADATA_LOWERING_PROFILE/);
assert.match(header, /TCG_WASM64_TB_METADATA_PROFILE_LOWERABLE/);
assert.match(header, /TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE/);
assert.match(header, /TCG_WASM64_TB_METADATA_TERMINAL/);
assert.match(header, /TCG_WASM64_TRANSLATE_FALLBACK_NO_WASM_EMITTER/);
assert.match(header, /TCG_WASM64_TRANSLATE_FALLBACK_UNSUPPORTED_OPCODE/);
assert.match(header, /TCG_WASM64_LOWERING_PROFILE_HOTBLOCK/);
assert.match(header, /generated_supported_op_count/);
assert.match(header, /generated_unsupported_op_count/);
assert.match(header, /TCG_WASM64_TB_METADATA_GENERATED_OUTPUT/);
assert.match(header, /TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED/);
assert.match(header, /TCG_WASM64_TB_METADATA_TRANSLATION_COUNTED/);
assert.match(header, /TCG_WASM64_TB_METADATA_HELPER_EXIT/);
assert.match(header, /TCG_WASM64_TRANSLATE_OUTPUT_MAX/);
assert.match(header, /translated_generated_output_tbs/);
assert.match(header, /translated_generated_output_bytes/);
assert.match(header, /translated_generated_output_ops/);
assert.match(header, /translated_generated_output_truncated/);
assert.match(header, /translated_generated_output_unavailable_tbs/);
assert.match(header, /translated_generated_output_missing_candidate_tbs/);
assert.match(header, /translated_generated_output_incomplete_tbs/);
assert.match(header, /generated_output_size/);
assert.match(header, /generated_output_op_count/);
assert.match(header, /generated_output_checksum/);
assert.match(header, /first_generated_unsupported_op/);
assert.match(header, /generated_helper_exit_op_count/);
assert.match(header, /tcg_wasm64_translate_note_tci_op\(uint32_t op\)/);
assert.match(header, /tcg_wasm64_translate_note_tci_insn\(uint32_t op,\s*uint32_t insn\)/);
assert.match(header, /tcg_wasm64_translate_lookup\(const void \*tb_ptr\)/);
assert.match(header, /tcg_wasm64_translate_generated_candidate/);
assert.match(header, /tcg_wasm64_translate_generated_output_available/);
assert.match(header, /uintptr_t tcg_tci_qemu_tb_exec\(CPUArchState \*env,\s*const void \*tb_ptr\)/);
assert.match(header, /typedef struct TCGWasm64TLBMirror/);
assert.match(header, /TCG_WASM64_RUN_CTX_TLB_OFFSET/);
assert.match(header, /TCG_WASM64_RUN_CTX_TB_GENERATION_OFFSET/);
assert.match(header, /TCG_WASM64_RUN_CTX_ADDRESS_SPACE_GENERATION_OFFSET/);
assert.match(header, /TCG_WASM64_TLB_MIRROR_FULLTLB_OFFSET/);
assert.match(header, /TCG_WASM64_TLB_MIRROR_GENERATION_OFFSET/);
assert.match(header, /TCG_WASM64_CPUTLB_ENTRY_ADDR_READ_OFFSET/);
assert.match(header, /TCG_WASM64_CPUTLB_ENTRY_FULL_SLOW_FLAGS_OFFSET/);
assert.match(header, /TCG_WASM64_TLB_FLAGS_MASK/);
assert.match(header, /tcg_wasm64_tlb_mirror_reset\(TCGWasm64TLBMirror \*mirror\)/);
assert.match(header, /tcg_wasm64_tlb_mirror_refresh\(TCGWasm64TLBMirror \*mirror,\s*\n\s*CPUArchState \*env,\s*uint32_t mmu_idx\)/);

assert.match(runtime, /TCG_WASM64_TRANSLATE_CACHE_SIZE/);
assert.match(runtime, /TCG_WASM64_TRANSLATE_CACHE_PROBE_LIMIT/);
assert.match(runtime, /static __thread TCGWasm64TranslateEntry translate_cache/);
assert.match(runtime, /tcg_wasm64_translate_cache_index/);
assert.match(runtime, /tcg_wasm64_translate_entry_for_insert/);
assert.match(runtime, /tcg_wasm64_translate_entry_for_lookup/);
assert.match(runtime, /tcg_wasm64_translate_entry_matches/);
assert.match(runtime, /entry->metadata\.tb_ptr == tb_ptr/);
assert.match(runtime, /first_empty \? first_empty : &translate_cache\[start\]/);
assert.doesNotMatch(
  runtime,
  /return &translate_cache\[hash % TCG_WASM64_TRANSLATE_CACHE_SIZE\];/,
);
assert.match(runtime, /tcg_wasm64_translate_op_supported/);
assert.match(runtime, /tcg_wasm64_translate_op_generated_supported/);
assert.match(runtime, /tcg_wasm64_translate_call_exit_supported/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64RunContext, tlb\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64RunContext, tb_generation\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64RunContext, address_space_generation\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64TLBMirror, fulltlb\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64TLBMirror, generation\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(CPUTLBEntry, addr_read\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(CPUTLBEntryFull, slow_flags\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(TLB_FLAGS_MASK != TCG_WASM64_TLB_FLAGS_MASK\)/);
assert.match(runtime, /void tcg_wasm64_tlb_mirror_reset\(TCGWasm64TLBMirror \*mirror\)/);
assert.match(runtime, /void tcg_wasm64_tlb_mirror_refresh\(TCGWasm64TLBMirror \*mirror,/);
assert.match(runtime, /uint64_t tcg_wasm64_tb_generation\(void\)/);
assert.match(runtime, /uint64_t tcg_wasm64_bump_tb_generation\(void\)/);
assert.match(runtime, /uint64_t tcg_wasm64_address_space_generation\(void\)/);
assert.match(runtime, /uint64_t tcg_wasm64_bump_address_space_generation\(void\)/);
assert.match(runtime, /uint64_t tcg_wasm64_tlb_mirror_generation\(const TCGWasm64TLBMirror \*mirror\)/);
assert.match(runtime, /uint64_t tcg_wasm64_tlb_mirror_bump_generation\(TCGWasm64TLBMirror \*mirror\)/);
assert.match(runtime, /CPUState \*cpu = env_cpu\(env\)/);
assert.match(runtime, /CPUTLBDescFast \*fast = cpu_tlb_fast\(cpu, mmu_idx\)/);
assert.match(runtime, /CPUTLBDesc \*desc = &cpu->neg\.tlb\.d\[mmu_idx\]/);
const generatedSupportedBody = runtime.match(
  /static bool tcg_wasm64_translate_op_generated_supported\(uint32_t op\)\s*\{[\s\S]*?switch \(\(TCGOpcode\)op\) \{([\s\S]*?)default:/,
)?.[1] || "";
for (const envRelativeHostMemoryOp of [
  "INDEX_op_ld",
  "INDEX_op_ld32u",
  "INDEX_op_ld32s",
  "INDEX_op_st",
  "INDEX_op_st8",
  "INDEX_op_st32",
]) {
  assert.match(
    generatedSupportedBody,
    new RegExp(`case\\s+${envRelativeHostMemoryOp}:`),
  );
}
assert.match(
  runtime,
  /operand-level\s*\n\s*\* generated-output emitter can lower only bounded env-relative forms/,
);
assert.match(generatedSupportedBody, /case INDEX_op_tci_qemu_ld_rrr:/);
assert.match(generatedSupportedBody, /case INDEX_op_tci_qemu_st_rrr:/);
assert.match(generatedSupportedBody, /case INDEX_op_call:/);
assert.match(runtime, /TCG_WASM64_TB_METADATA_HELPER_EXIT/);
assert.match(runtime, /generated_helper_exit_op_count = metadata->op_count/);
assert.match(runtime, /ret_len <= 2/);
assert.match(runtime, /case INDEX_op_mb:/);
assert.match(runtime, /case INDEX_op_tci_setcond32:/);
assert.match(runtime, /case INDEX_op_tci_qemu_ld_rrr:/);
assert.match(runtime, /void tcg_wasm64_translate_begin\(const void \*tb_ptr\)/);
assert.match(runtime, /void tcg_wasm64_translate_note_tci_op\(uint32_t op\)/);
assert.match(runtime, /void tcg_wasm64_translate_note_tci_insn\(uint32_t op,\s*uint32_t insn\)/);
assert.match(runtime, /tcg_wasm64_translate_generated_output_available/);
assert.match(runtime, /const TCGWasm64TBMetadata \*tcg_wasm64_translate_lookup/);
assert.match(runtime, /translated_fallback_markers/);
assert.match(runtime, /translated_metadata_misses/);
assert.match(runtime, /translated_profile_supported_ops/);
assert.match(runtime, /translated_profile_unsupported_ops/);
assert.match(runtime, /translated_generated_candidate_tbs/);
assert.match(runtime, /translated_generated_supported_ops/);
assert.match(runtime, /translated_generated_unsupported_ops/);
assert.match(runtime, /translated_generated_output_tbs/);
assert.match(runtime, /translated_generated_output_bytes/);
assert.match(runtime, /translated_generated_output_ops/);
assert.match(runtime, /translated_generated_output_truncated/);
assert.match(runtime, /translated_generated_output_unavailable_tbs/);
assert.match(runtime, /translated_generated_output_missing_candidate_tbs/);
assert.match(runtime, /translated_generated_output_incomplete_tbs/);
assert.match(runtime, /translated_generated_first_unsupported_ops/);
assert.match(runtime, /first_generated_unsupported_op = UINT32_MAX/);
assert.match(runtime, /tcg_wasm64_count_generated_first_unsupported/);
assert.match(header, /TCG_WASM64_TRANSLATE_OUTPUT_WORDS/);
assert.match(header, /const uint32_t \*generated_output/);
assert.match(runtime, /uint32_t generated_output\[TCG_WASM64_TRANSLATE_OUTPUT_WORDS\]/);
assert.match(runtime, /generated_output_size % sizeof\(uint32_t\) == 0/);
assert.match(runtime, /tcg_wasm64_translate_generated_output_expected_ops/);
assert.match(runtime, /generated_output_op_count == expected_ops/);
assert.match(runtime, /generated_output_op_count ==\s*\n\s*metadata->generated_output_size \/ sizeof\(uint32_t\)/);
assert.match(runtime, /TCG_WASM64_TB_METADATA_TERMINAL/);
assert.match(runtime, /tcg_wasm64_translate_generated_candidate\(metadata\)/);
assert.doesNotMatch(runtime, /uintptr_t tcg_tci_qemu_tb_exec\(CPUArchState \*env,\s*const void \*tb_ptr\);/);
assert.match(runtime, /tcg_wasm64_translate_lookup_mutable/);
assert.match(runtime, /tcg_wasm64_count_live_translation_metadata/);
assert.match(runtime, /QEMU_WASM64_TCG_SUMMARY/);
assert.match(runtime, /QEMU_WASM64_TCG_SUMMARY_INTERVAL/);
assert.match(runtime, /QEMU_WASM64_ONE_TB_DIFFERENTIAL/);
assert.match(runtime, /QEMU_WASM64_LIVE_ONE_TB_DIFFERENTIAL/);
assert.match(runtime, /QEMU_WASM64_LIVE_TB_COVERAGE/);
assert.match(runtime, /QEMU_WASM64_LIVE_GENERATED_EXEC/);
assert.match(runtime, /QEMU_WASM64_LIVE_GENERATED_EXEC_NO_FALLBACK/);
assert.match(runtime, /QEMU_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT/);
assert.match(runtime, /QEMU_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT_LIMIT/);
assert.match(runtime, /QEMU_WASM64_LIVE_TB_COVERAGE_SCAN_LIMIT/);
assert.match(runtime, /TCG_WASM64_ONE_TB_NAME "live-x86-pre-r4i-ld32u-goto-tb-13"/);
assert.match(runtime, /TCG_WASM64_LIVE_ONE_TB_NAME "live-x86-r4i-ld32u-goto-tb-11"/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_COVERAGE_NAME "live-rv64-generated-coverage"/);
assert.match(header, /uint64_t generated_guest_instructions;/);
assert.match(header, /uint64_t fallback_guest_instructions;/);
assert.match(header, /uint64_t generated_body_time_ns;/);
assert.doesNotMatch(runtime, /tcg_wasm64_live_one_tb_words\[\]/);
assert.match(runtime, /tcg_wasm64_live_one_tb_ops\[\]/);
assert.match(runtime, /INDEX_op_brcond/);
assert.match(runtime, /generatedOutputPtr = Number\(generated_output_arg\)/);
assert.match(runtime, /generatedOutputSize = Number\(generated_output_size_arg\)/);
assert.match(runtime, /readGeneratedOutputWords/);
assert.match(runtime, /generatedOutputShapeSupported/);
assert.match(runtime, /tcg_wasm64_live_one_tb_generated_output_shape_supported/);
assert.match(runtime, /tcg_wasm64_live_one_tb_selected_hot_shape/);
assert.match(runtime, /metadata->generated_output,\s*\n\s*metadata->generated_output_size/);
assert.match(runtime, /metadata missing for live TB/);
assert.match(runtime, /generated output unavailable for selected hot shape/);
assert.match(runtime, /selected hot shape unsupported by live per-TB emitter/);
assert.match(runtime, /module-emission-failed/);
assert.match(runtime, /module-validation-failed/);
assert.match(runtime, /metadata_generated_output_size/);
assert.match(runtime, /metadata_generated_output_op_count/);
assert.match(runtime, /js_status_name/);
const liveOneTbDifferentialJs = runtime.match(
  /EM_JS\(int, tcg_wasm64_live_one_tb_differential_js,[\s\S]*?\n\}\);\n\nEM_JS\(int, tcg_wasm64_live_generated_exec_js,/,
)?.[0] || "";
assert.doesNotMatch(liveOneTbDifferentialJs, /const words = \[/);
assert.match(runtime, /tcg_wasm64_one_tb_differential_js/);
assert.match(runtime, /tcg_wasm64_live_one_tb_differential_js/);
assert.match(runtime, /\.\.\.name\("wasmjit_run"\)/);
assert.match(runtime, /one-tb-differential/);
assert.match(runtime, /live-one-tb-differential/);
assert.match(runtime, /live_shape_fixture/);
assert.match(runtime, /real_live_state_capture/);
assert.match(runtime, /tcg_wasm64_live_one_tb_generated_output_shape_supported/);
assert.match(runtime, /tcg_tb_lookup\(\(uintptr_t\)tb_ptr\)/);
assert.match(runtime, /tb->icount == 0/);
assert.match(runtime, /generated_guest_instructions/);
assert.match(runtime, /reference_guest_instructions/);
assert.match(runtime, /generated_tci_op_equivalents/);
assert.match(runtime, /reference_tci_op_equivalents/);
const liveReportBody = runtime.match(
  /static void tcg_wasm64_report_live_one_tb_differential\([\s\S]*?\n\}\n\nstatic void tcg_wasm64_record_live_one_tb_generated_metrics/,
)?.[0] || "";
assert.match(liveReportBody, /inline_tlb_hit_loads/);
assert.match(liveReportBody, /inline_tlb_hit_stores/);
assert.match(liveReportBody, /run_counters->inline_tlb_hit_loads/);
assert.match(liveReportBody, /run_counters->inline_tlb_hit_stores/);
assert.doesNotMatch(liveReportBody, /host_memory_loads/);
assert.doesNotMatch(liveReportBody, /host_memory_stores/);
assert.match(runtime, /generated_dispatch_target/);
assert.match(runtime, /reference_dispatch_target/);
assert.match(runtime, /tcg_wasm64_one_tb_differential_maybe\(env\)/);
assert.match(runtime, /tcg_wasm64_live_one_tb_differential_maybe\(env, tb_ptr, metadata\)/);
assert.match(runtime, /\[\[0, 4\], \[4, 1\], \[0x110, 8\]\]/);
assert.match(runtime, /tcg_wasm64_summary_maybe_report/);
assert.match(runtime, /tcg_wasm64_report_summary\("interval",\s*&zero\)/);
assert.match(runtime, /tcg_wasm64_live_tb_coverage_js/);
assert.match(runtime, /tcg_wasm64_live_tb_coverage_shape_supported/);
assert.match(runtime, /tcg_wasm64_live_tb_coverage_op_supported/);
const liveCoverageSupportedBody = runtime.match(
  /static bool tcg_wasm64_live_tb_coverage_op_supported\(uint32_t op\)\s*\{[\s\S]*?switch \(\(TCGOpcode\)op\) \{([\s\S]*?)default:/,
)?.[1] || "";
for (const rv64GeneratedCoverageOp of [
  "INDEX_op_ld32u",
  "INDEX_op_tci_setcond32",
  "INDEX_op_brcond",
  "INDEX_op_st8",
  "INDEX_op_ld",
  "INDEX_op_st",
  "INDEX_op_call",
  "INDEX_op_tci_qemu_ld_rrr",
  "INDEX_op_tci_qemu_st_rrr",
]) {
  assert.match(
    liveCoverageSupportedBody,
    new RegExp(`case\\s+${rv64GeneratedCoverageOp}:`),
  );
}
assert.match(runtime, /HEAPU32\[tbPtr \/ 4 \+ i\]/);
assert.match(runtime, /scratchWindowBase/);
assert.match(runtime, /const runCtxTlbOffset = 48/);
assert.match(runtime, /function compileSoftmmuTlbAccess/);
assert.match(runtime, /i64LoadAtPtr\(0, runCtxTlbOffset\)/);
assert.match(runtime, /tcg_wasm64_tlb_mirror_refresh\(\s*\n\s*&tlb_mirror, env, cpu_mmu_index\(env_cpu\(env\), false\)\)/);
assert.match(runtime, /context\.tlb = &tlb_mirror/);
assert.match(runtime, /tcg_wasm64_live_tb_coverage_fallback_exit/);
assert.match(runtime, /run_counters->exits_mmio/);
assert.match(runtime, /run_counters->exits_tlb_miss_or_fault/);
assert.match(runtime, /\\"event\\":\\"live-tb-coverage/);
assert.match(runtime, /\\"inline_tlb_hit_loads\\":%" PRIu64/);
assert.match(runtime, /\\"inline_tlb_hit_stores\\":%" PRIu64/);
assert.match(runtime, /guest_state_commit\\":%s/);
assert.match(runtime, /"false",\s*\n\s*\(uintptr_t\)tb->tc\.ptr/);
assert.match(runtime, /tcg_wasm64_count_live_tb_coverage_denominator/);
assert.match(runtime, /tcg_wasm64_execute_available_generated_output_try/);
assert.match(
  runtime,
  /tcg_wasm64_execute_available_generated_output_try\(\s*\n\s*env, tb_ptr, metadata, &ret\)/,
);
assert.match(runtime, /tcg_wasm64_live_generated_exec_enabled/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_no_fallback/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_js/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_shape_supported/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_op_supported/);
assert.match(runtime, /if \(tcg_wasm64_live_generated_exec_enabled\(\)\) {\s+return false;\s+}\s+if \(!metadata/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_try\(env, tb_ptr, metadata,\s*\n\s*counters, &ret\)/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_try\(env, tb_ptr, NULL,\s*\n\s*counters, &ret\)/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_fail_closed/);
assert.match(runtime, /g_error\("qemu-wasm64-live-generated-exec: no-silent-fallback/);
assert.match(runtime, /\\"event\\":\\"live-generated-exec-summary/);
assert.match(runtime, /preflight-zero-generated-exec/);
assert.match(runtime, /live_generated_exec_reject_reasons/);
assert.doesNotMatch(runtime, /\\"attempt_index\\":/);
assert.match(runtime, /\\"compat_fallback\\":%s/);
assert.match(runtime, /\\"no_silent_fallback\\":%s/);
assert.match(runtime, /\\"generated_guest_instructions\\":%" PRIu64/);
assert.match(runtime, /\\"generated_body_time_ns\\":%" PRIu64/);
assert.match(runtime, /\\"fallback_guest_instructions\\":%" PRIu64/);
assert.match(runtime, /\\"inline_tlb_hit_loads\\":%" PRIu64/);
assert.match(runtime, /\\"inline_tlb_hit_stores\\":%" PRIu64/);
assert.match(runtime, /\\"qemu_ld_calls\\":%" PRIu64/);
assert.match(runtime, /\\"qemu_st_calls\\":%" PRIu64/);
assert.match(runtime, /\\"exits_invalidated\\":%" PRIu64/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_probe_hotset_target/);
assert.match(runtime, /tcg_wasm64_generated_terminal_parse/);
assert.match(runtime, /TCG_WASM64_LIVE_HOTSET_SLOT_BACKSCAN/);
assert.match(runtime, /\\"hotset_probe_attempts\\":%" PRIu64/);
assert.match(runtime, /\\"hotset_goto_sources\\":%" PRIu64/);
assert.match(runtime, /\\"hotset_target_slots_read\\":%" PRIu64/);
assert.match(runtime, /\\"hotset_target_slots_unsafe\\":%" PRIu64/);
assert.match(runtime, /\\"hotset_target_metadata_hits\\":%" PRIu64/);
assert.match(runtime, /\\"hotset_target_output_hits\\":%" PRIu64/);
assert.match(runtime, /\\"hotset_target_stale\\":%" PRIu64/);
assert.match(runtime, /\\"skips\\":%" PRIu64/);
assert.match(runtime, /\\"selected_body_helper_exit_skips\\":%" PRIu64/);
assert.match(runtime, /"metadata-output-tb-code-mismatch"/);
assert.match(runtime, /"metadata-missing"/);
assert.match(runtime, /"generated-output-unavailable"/);
assert.match(runtime, /"selected-body-shape-unsupported"/);
assert.match(runtime, /"selected-body-helper-exit-unsupported"/);
assert.match(runtime, /"tb-identity-missing-or-stale"/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_classify_reject/);
assert.doesNotMatch(runtime, /"generated-exec-rejected"/);
assert.match(runtime, /#include "exec\/memopidx\.h"/);
assert.match(runtime, /#include "accel\/tcg\/cpu-mmu-index\.h"/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_EXIT 0x20u/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_DISPATCH 0x21u/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_HELPER 0x22u/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_MMIO 0x23u/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_TLB_MISS_OR_FAULT 0x24u/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_UNSUPPORTED 0x25u/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_STATUS_INVALIDATED 0x26u/);
assert.match(runtime, /tcg_wasm64_live_tb_status_to_run_exit_reason/);
assert.match(runtime, /tcg_wasm64_live_tb_status_is_success/);
assert.match(runtime, /generated_exit_reason == TCG_WASM64_RUN_EXIT_MMIO/);
assert.match(
  runtime,
  /generated_exit_reason == TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT/,
);
assert.match(
  runtime,
  /generated_exit_reason == TCG_WASM64_RUN_EXIT_HELPER/,
);
assert.match(
  runtime,
  /generated_exit_reason == TCG_WASM64_RUN_EXIT_UNSUPPORTED/,
);
assert.match(
  runtime,
  /generated_exit_reason == TCG_WASM64_RUN_EXIT_INVALIDATED/,
);
assert.doesNotMatch(
  runtime,
  /exit\.reason = \(uint32_t\)result\[\s*TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_STATUS\s*\]/,
);
for (const liveGeneratedExecRejectReason of [
  "js-status-runtime-unavailable",
  "js-status-metadata-output-tb-code-mismatch",
  "js-status-module-emission-failed",
  "generated-status-helper",
  "generated-status-unexpected",
  "missing-return-target",
  "guest-instruction-mismatch",
  "tci-op-count-mismatch",
  "generated-output-words-mismatch",
  "counter-guest-instruction-mismatch",
  "chain-length-mismatch",
  "helper-counter-mismatch",
  "qemu-helper-counter-mismatch",
  "mmio-exit",
  "tlb-miss-or-fault-exit",
  "invalidated",
  "unsupported-body-state",
  "selected-body-memop-unproven",
  "selected-body-memop-unsupported-size",
  "selected-body-memop-unsupported-sign",
  "selected-body-memop-unsupported-endian",
  "selected-body-memop-unsupported-alignment",
  "selected-body-memop-unsupported-atomic",
  "selected-body-memop-unsupported-high-flags",
  "selected-body-memop-unexpected-mmu-idx",
  "selected-body-softmmu-unavailable",
  "selected-body-softmmu-tlb-mirror-unwired",
]) {
  assert.match(
    runtime,
    new RegExp(`"${liveGeneratedExecRejectReason}"`),
  );
}
assert.match(runtime, /tcg_wasm64_live_generated_exec_validate_selected_memops/);
assert.match(runtime, /get_memop\(oi\)/);
assert.match(runtime, /get_mmuidx\(oi\)/);
assert.match(runtime, /cpu_mmu_index\(env_cpu\(env\), false\)/);
assert.match(runtime, /#if defined\(CONFIG_USER_ONLY\)/);
assert.match(runtime, /!env/);
assert.match(runtime, /INDEX_op_tci_qemu_ld_rrr/);
assert.match(runtime, /INDEX_op_tci_qemu_st_rrr/);
assert.match(runtime, /MO_SIGN/);
assert.match(runtime, /MO_BSWAP/);
assert.match(runtime, /MO_AMASK \| MO_ALIGN_TLB_ONLY/);
assert.match(runtime, /MO_ATOM_MASK/);
assert.match(runtime, /TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_CACHE_HIT/);
assert.match(runtime, /tcg_wasm64_live_generated_exec_count_attempt/);
const liveGeneratedExecTryBody = runtime.match(
  /static bool tcg_wasm64_live_generated_exec_try\([\s\S]*?\n\}\n\nstatic bool tcg_wasm64_translate_op_supported/,
)?.[0] || "";
const liveGeneratedExecPrepareTbBody = runtime.match(
  /static bool tcg_wasm64_live_generated_exec_prepare_tb\([\s\S]*?\n\}\n\nstatic bool tcg_wasm64_live_generated_exec_main_loop_exit_pending/,
)?.[0] || "";
assert.match(
  liveGeneratedExecTryBody,
  /tcg_wasm64_live_generated_exec_helper_exit_shape\(metadata\)/,
);
assert.match(
  liveGeneratedExecTryBody,
  /live_generated_exec_selected_body_helper_exit_skips\+\+/,
);
assert.match(
  liveGeneratedExecTryBody,
  /"selected-body-helper-exit-unsupported"/,
);
assert.match(
  liveGeneratedExecTryBody,
  /if \(tcg_wasm64_live_generated_exec_helper_exit_shape\(metadata\)\) \{\s+if \(!no_fallback\) \{\s+live_generated_exec_selected_body_helper_exit_skips\+\+;\s+return false;\s+\}\s+tcg_wasm64_live_generated_exec_count_attempt\(\);/,
);
assert.match(
  liveGeneratedExecTryBody,
  /tcg_wasm64_live_generated_exec_prepare_tb\(\s*env,/,
);
assert.match(
  liveGeneratedExecPrepareTbBody,
  /tcg_wasm64_live_generated_exec_validate_selected_memops\(\s*env, metadata, &has_memop\)/,
);
assert.match(
  liveGeneratedExecPrepareTbBody,
  /selected_body-softmmu-tlb-mirror-unwired|SELECTED_BODY_SOFTMMU_TLB_MIRROR_UNWIRED/,
);
assert(
  liveGeneratedExecTryBody.indexOf(
    "tcg_wasm64_live_generated_exec_prepare_tb") <
  liveGeneratedExecTryBody.indexOf("tcg_wasm64_live_generated_exec_run_one"),
  "R4s5b MemOp validation must run before live JS execution",
);
assert.match(runtime, /translated_counters\.generated_executed\+\+/);
assert.match(runtime, /translated_counters\.generated_cache_hits\+\+/);
assert.match(runtime, /translated_counters\.generated_coverage_numerator \+= guest_insns/);
assert.match(runtime, /run_counters\.qemu_ld_calls == 0/);
assert.match(runtime, /run_counters\.qemu_st_calls == 0/);
assert.match(runtime, /TCG_WASM64_RUN_EXIT_INVALIDATED/);
assert.match(runtime, /TCG_WASM64_RUN_MODE_COMPAT/);
assert.match(runtime, /TCG_WASM64_RUN_MODE_PERF_PROOF/);
assert.match(runtime, /tcg_tci_qemu_tb_exec\(env, tb_ptr\)/);
assert.match(runtime, /\\"event\\":\\"live-tb-coverage\\"/);
assert.match(runtime, /\\"guest_state_commit\\":%s/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_COVERAGE_ENV/);
const liveTbCoverageSupportedBody = runtime.match(
  /static bool tcg_wasm64_live_tb_coverage_op_supported\(uint32_t op\)\s*\{[\s\S]*?switch \(\(TCGOpcode\)op\) \{([\s\S]*?)default:/,
)?.[1] || "";
for (const liveCoverageGeneratedOp of [
  "INDEX_op_call",
  "INDEX_op_ld",
  "INDEX_op_ld32u",
  "INDEX_op_st",
  "INDEX_op_st8",
  "INDEX_op_tci_qemu_ld_rrr",
  "INDEX_op_tci_qemu_st_rrr",
]) {
  assert.match(
    liveTbCoverageSupportedBody,
    new RegExp(`case\\s+${liveCoverageGeneratedOp}:`),
  );
}
for (const directQemuMemoryOp of [
  "INDEX_op_movcond",
  "INDEX_op_qemu_ld",
  "INDEX_op_qemu_st",
]) {
  assert.doesNotMatch(
    liveTbCoverageSupportedBody,
    new RegExp(`case\\s+${directQemuMemoryOp}:`),
  );
}
assert.match(liveTbCoverageSupportedBody, /case INDEX_op_tci_movi:/);
assert.match(liveTbCoverageSupportedBody, /case INDEX_op_tci_movl:/);
assert.match(liveTbCoverageSupportedBody, /case INDEX_op_goto_tb:/);
const liveOneTbMetricsBody = runtime.match(
  /static void tcg_wasm64_record_live_one_tb_generated_metrics\([\s\S]*?\n\}/,
)?.[0] || "";
assert.doesNotMatch(
  liveOneTbMetricsBody,
  /generated_coverage_denominator \+= guest_insns/,
);
const liveTbMetricsBody = runtime.match(
  /static void tcg_wasm64_record_live_tb_generated_metrics\([\s\S]*?\n\}/,
)?.[0] || "";
assert.match(liveTbMetricsBody, /generated_coverage_numerator \+= guest_insns/);
assert.doesNotMatch(
  liveTbMetricsBody,
  /generated_coverage_denominator \+= guest_insns/,
);
const liveMetadataCounterBody = runtime.match(
  /static void tcg_wasm64_count_live_translation_metadata\([\s\S]*?\n\}\n\nuintptr_t/,
)?.[0] || "";
assert.match(
  liveMetadataCounterBody,
  /TCG_WASM64_TB_METADATA_TRANSLATION_COUNTED/,
);
assert.match(
  liveMetadataCounterBody,
  /metadata->flags \|= TCG_WASM64_TB_METADATA_TRANSLATION_COUNTED/,
);
assert.match(
  liveMetadataCounterBody,
  /counters->translated_generated_output_tbs\+\+/,
);
assert.doesNotMatch(liveMetadataCounterBody, /tcg_wasm64_summary_maybe_report\(\)/);
const reportSummaryBody = runtime.match(
  /void tcg_wasm64_report_summary\([\s\S]*?\n\}/,
)?.[0] || "";
assert.match(reportSummaryBody, /tcg_wasm64_counters_add\(&merged, &translated_counters\)/);
assert.match(reportSummaryBody, /tcg_wasm64_counters_add\(&merged, active_counters\)/);
assert.doesNotMatch(runtime, /tcg_wasm64_counters_add_translation/);
const tbExecBody = runtime.match(
  /uintptr_t tcg_wasm64_tb_exec\(CPUArchState \*env,[\s\S]*?\n\}/,
)?.[0] || "";
assert.match(
  tbExecBody,
  /tcg_wasm64_count_live_translation_metadata\(metadata\)/,
);
assert.match(tbExecBody, /tcg_wasm64_summary_maybe_report\(\)/);
assert.match(tbExecBody, /tcg_wasm64_counters_reset\(counters\)/);
assert.match(
  tbExecBody,
  /tcg_wasm64_execute_available_generated_output_try\(\s*\n\s*env, tb_ptr, metadata, &ret\)/,
);
assert.match(tbExecBody, /return ret;/);
assert.match(tbExecBody, /fallback_guest_insns = tcg_wasm64_live_tb_guest_instructions\(tb_ptr\)/);
assert.match(tbExecBody, /ret = tcg_tci_qemu_tb_exec\(env, tb_ptr\)/);
assert.match(tbExecBody, /tcg_wasm64_record_tci_fallback_guest_instructions\(fallback_guest_insns\)/);
assert.match(runtime, /tcg_wasm64_record_live_tb_generated_metrics\(guest_insns\)/);
assert.match(runtime, /live_tb_coverage_checked = true/);
assert.doesNotMatch(
  tbExecBody,
  /tcg_wasm64_counters_add_translation\(&translated_counters,\s*counters\)/,
);
assert.doesNotMatch(tbExecBody, /counters->translated_generated_output_tbs\+\+/);

assert.doesNotMatch(tci, /tci_wasm_metadata_generated_candidate/);
assert.match(tci, /tci_wasm_generated_signature\(tb_start,\s*tb_start,\s*code_ops\)/);
assert.match(tci, /QEMU_TCI_WASM_GENERATED_TRACE/);
assert.match(tci, /qemu-tci-wasm-generated-trace:/);
assert.match(tci, /tci_wasm_generated_trace_tci_block\("tci-enter", tb_ptr\)/);
assert.doesNotMatch(tci, /tci_wasm_generated_compile_js/);
assert.doesNotMatch(tci, /QEMU_TCI_WASM_SUBSET/);
assert.doesNotMatch(tci, /tci_wasm_subset_try_exec/);
assert.doesNotMatch(tci, /QEMU_TCI_RELAXED_MB/);
assert.doesNotMatch(tci, /raw == NULL \? true : tci_parse_bool_env\(raw\)/);
assert.doesNotMatch(tci, /functionType\(\[valueI64\], \[valueI64\]\)/);
assert.doesNotMatch(tci, /addFunction\(instance\.exports\.run, "jj"\)/);
assert.doesNotMatch(tci, /addFunction\(instance\.exports\.run, "ii"\)/);
assert.doesNotMatch(tci, /tcg_wasm64_translate_generated_output_available\(metadata\)/);
assert.doesNotMatch(tci, /tci_wasm_generated_try_exec/);
assert.doesNotMatch(tci, /return \[0xfe, 0x03, 0x00\]; \/\* atomic\.fence \*\//);

assert.match(generatedEquivalence, /X86_CPU_STATE_CONTRACT_VERSION/);
assert.match(generatedEquivalence, /analyzeX86CpuStateContract/);
assert.match(generatedEquivalence, /CPUX86State\.regs\[\]/);
assert.match(generatedEquivalence, /CPUX86State\.eip/);
assert.match(generatedEquivalence, /CPUX86State\.cc_dst/);
assert.match(generatedEquivalence, /CPUX86State\.cc_src/);
assert.match(generatedEquivalence, /CPUX86State\.cc_src2/);
assert.match(generatedEquivalence, /CPUX86State\.cc_op/);
assert.match(generatedEquivalence, /CPUX86State\.segs\[\]/);
assert.match(generatedEquivalence, /unmodeled-rip-eip-write/);
assert.match(generatedEquivalence, /unmodeled-lazy-condition-code-state/);
assert.match(generatedEquivalence, /unmodeled-segment-state/);
assert.match(generatedEquivalence, /unmodeled-helper-sensitive-state/);
assert.match(generatedEquivalence, /runtime unsupported return/);
assert.match(generatedEquivalence, /r4iX86CpuStateContract/);
for (const fixtureName of [
  "r4k-softmmu-ld32u-tlb-hit-ram",
  "r4k-softmmu-ld-tlb-hit-ram",
  "r4k-softmmu-st8-tlb-hit-ram",
  "r4k-softmmu-st-tlb-hit-ram",
  "r4k-softmmu-tlb-miss",
  "r4k-softmmu-mmio",
  "r4k-softmmu-permission-fault",
  "r4k-softmmu-page-crossing",
  "r4k-softmmu-stale-output-mismatch",
]) {
  assert.match(generatedEquivalence, new RegExp(fixtureName));
}
for (const fixtureName of [
  "r6-rv64-softmmu-ld32u-tlb-hit-ram",
  "r6-rv64-softmmu-ld-tlb-hit-ram",
  "r6-rv64-softmmu-st8-tlb-hit-ram",
  "r6-rv64-softmmu-st32-tlb-hit-ram",
  "r6-rv64-softmmu-st-tlb-hit-ram",
  "r6-rv64-softmmu-tlb-miss",
  "r6-rv64-softmmu-mmio",
  "r6-rv64-softmmu-permission-fault",
  "r6-rv64-softmmu-page-crossing",
]) {
  assert.match(generatedEquivalence, new RegExp(fixtureName));
}
assert.match(generatedEquivalence, /r4kSoftmmuFastPath/);
assert.match(generatedEquivalence, /r6Rv64SoftmmuFastPath/);
assert.match(generatedEquivalence, /acceptedHitCounters/);
assert.match(generatedEquivalence, /helperVisibleStateMatched/);
assert.match(generatedEquivalence, /r4mLiveGeneratedExec/);
assert.match(generatedEquivalence, /r4m-disabled-keeps-tci/);
assert.match(generatedEquivalence, /r4m-supported-metadata-backed-live-tb-generated/);
assert.match(generatedEquivalence, /r4m-unsupported-no-silent-fallback-fails-closed/);
assert.match(generatedEquivalence, /r4m-stale-output-invalidates-zero-generated-work/);
assert.match(generatedEquivalence, /r4m-compat-fallback-explicit-and-counted/);
assert.match(generatedEquivalence, /r4s4-call-fronted-helper-exit-compat-skips-preflight-budget/);
assert.match(generatedEquivalence, /r4s4-call-fronted-helper-exit-no-fallback-rejects/);
assert.match(generatedEquivalence, /r7AvailableGeneratedOutputExec/);
assert.match(generatedEquivalence, /r7-available-generated-output-executes/);
assert.match(generatedEquivalence, /r7-rv64-helper-prefix-executes-and-counts-before-tci/);
assert.match(generatedEquivalence, /R7_RV64_HELPER_PREFIX_SHAPE/);
assert.match(generatedEquivalence, /r7-available-generated-output-unsupported-falls-back/);
assert.match(generatedEquivalence, /r7LongRunningGeneratedExec/);
assert.match(generatedEquivalence, /generatedGuestInstructionsPerEntry/);
assert.match(generatedEquivalence, /expectedGeneratedChainLength: 2/);
assert.match(generatedEquivalence, /r8RealGeneratedExec/);
assert.match(generatedEquivalence, /r8-rv64-real-generated-body-commits-state/);
assert.match(generatedEquivalence, /guestStateCommit: true/);
assert.match(generatedEquivalence, /RV64_ENV_RELATIVE_BASE_REG/);
assert.match(generatedEquivalence, /rv64-env-relative-load-store-family/);
assert.match(generatedEquivalence, /rv64-env-relative-non-env-base-fails-closed/);
assert.match(generatedEquivalence, /rv64-env-relative-out-of-range-fails-closed/);
assert.match(generatedEquivalence, /rv64EnvRelativeFixtures/);
assert.match(generatedEquivalence, /rv64-call-exit-prefix-family/);
assert.match(generatedEquivalence, /rv64-call-exit-at-entry-fails-closed/);
assert.match(generatedEquivalence, /rv64-call-exit-int128-return-fails-closed/);
assert.match(generatedEquivalence, /rv64HelperExitFixtures/);
assert.match(generatedEquivalence, /RUN_EXIT_REASON_HELPER/);
assert.match(generatedEquivalence, /R4K_SOFTMMU_EMITTER_NAME/);
assert.match(generatedEquivalence, /WASMJIT_TLB_MIRROR/);
assert.match(generatedEquivalence, /inlineTlbHitLoads/);
assert.match(generatedEquivalence, /qemuLdCalls/);
assert.match(generatedEquivalence, /metadata-output-tb-code-mismatch/);
assert.match(generatedEquivalence, /generatedStatusToRunExitReason/);
assert.match(generatedEquivalence, /generatedStatusForRunExitReason/);
assert.match(generatedEquivalence, /liveGeneratedStatusNamespace/);
assert.match(generatedEquivalence, /STATUS_MMIO = 0x23n/);
assert.match(generatedEquivalence, /STATUS_TLB_MISS_OR_FAULT = 0x24n/);
assert.match(generatedEquivalence, /STATUS_INVALIDATED = 0x26n/);
assert.match(generatedEquivalence, /run-exit mmio value is not a generated status/);
assert.match(generatedEquivalence, /r4s5b-valid-load-rejects-unwired-tlb-mirror/);
assert.match(generatedEquivalence, /r4s5b-valid-store-rejects-unwired-tlb-mirror/);
assert.match(generatedEquivalence, /r4s5b-unproven-oi-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-movl-oi-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-unsupported-size-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-sign-flag-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-endian-flag-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-alignment-flag-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-atomic-flag-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-high-flag-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /r4s5b-unexpected-mmu-idx-rejects-before-inline-ram/);
assert.match(generatedEquivalence, /selected-body-softmmu-tlb-mirror-unwired/);
assert.match(generatedEquivalence, /selected-body-memop-unsupported-high-flags/);

console.log("wasm64 translate metadata contract: ok");
