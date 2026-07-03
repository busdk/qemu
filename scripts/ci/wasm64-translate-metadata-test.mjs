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
assert.match(header, /tcg_wasm64_translate_note_tci_op\(uint32_t op\)/);
assert.match(header, /tcg_wasm64_translate_note_tci_insn\(uint32_t op,\s*uint32_t insn\)/);
assert.match(header, /tcg_wasm64_translate_lookup\(const void \*tb_ptr\)/);
assert.match(header, /tcg_wasm64_translate_generated_candidate/);
assert.match(header, /tcg_wasm64_translate_generated_output_available/);
assert.match(header, /uintptr_t tcg_tci_qemu_tb_exec\(CPUArchState \*env,\s*const void \*tb_ptr\)/);
assert.match(header, /typedef struct TCGWasm64TLBMirror/);
assert.match(header, /TCG_WASM64_RUN_CTX_TLB_OFFSET/);
assert.match(header, /TCG_WASM64_TLB_MIRROR_FULLTLB_OFFSET/);
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
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64RunContext, tlb\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(TCGWasm64TLBMirror, fulltlb\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(CPUTLBEntry, addr_read\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(offsetof\(CPUTLBEntryFull, slow_flags\) !=/);
assert.match(runtime, /QEMU_BUILD_BUG_ON\(TLB_FLAGS_MASK != TCG_WASM64_TLB_FLAGS_MASK\)/);
assert.match(runtime, /void tcg_wasm64_tlb_mirror_reset\(TCGWasm64TLBMirror \*mirror\)/);
assert.match(runtime, /void tcg_wasm64_tlb_mirror_refresh\(TCGWasm64TLBMirror \*mirror,/);
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
assert.match(runtime, /generated_output_op_count == metadata->op_count/);
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
assert.match(runtime, /QEMU_WASM64_LIVE_TB_COVERAGE_SCAN_LIMIT/);
assert.match(runtime, /TCG_WASM64_ONE_TB_NAME "live-x86-pre-r4i-ld32u-goto-tb-13"/);
assert.match(runtime, /TCG_WASM64_LIVE_ONE_TB_NAME "live-x86-r4i-ld32u-goto-tb-11"/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_COVERAGE_NAME "live-rv64-generated-coverage"/);
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
assert.doesNotMatch(
  runtime.match(
    /EM_JS\(int, tcg_wasm64_live_one_tb_differential_js,[\s\S]*?const words = \[([\s\S]*?)\];/,
  )?.[0] || "",
  /const words = \[/,
);
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
assert.match(runtime, /tcg_wasm64_count_live_tb_coverage_denominator/);
assert.match(runtime, /tcg_wasm64_live_tb_coverage_maybe\(env, tb_ptr, metadata\)/);
assert.match(runtime, /\\"event\\":\\"live-tb-coverage\\"/);
assert.match(runtime, /\\"guest_state_commit\\":false/);
assert.match(runtime, /TCG_WASM64_LIVE_TB_COVERAGE_ENV/);
assert.match(runtime, /INDEX_op_add, INDEX_op_and, INDEX_op_exit_tb, INDEX_op_goto_tb/);
const liveTbCoverageSupportedBody = runtime.match(
  /static bool tcg_wasm64_live_tb_coverage_op_supported\(uint32_t op\)\s*\{[\s\S]*?switch \(\(TCGOpcode\)op\) \{([\s\S]*?)default:/,
)?.[1] || "";
for (const unsafeLiveCoverageOp of [
  "INDEX_op_call",
  "INDEX_op_ld",
  "INDEX_op_ld32u",
  "INDEX_op_st",
  "INDEX_op_st8",
  "INDEX_op_qemu_ld",
  "INDEX_op_qemu_st",
  "INDEX_op_tci_qemu_ld_rrr",
  "INDEX_op_tci_qemu_st_rrr",
]) {
  assert.doesNotMatch(
    liveTbCoverageSupportedBody,
    new RegExp(`case\\s+${unsafeLiveCoverageOp}:`),
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
assert.match(liveMetadataCounterBody, /tcg_wasm64_summary_maybe_report\(\)/);
const tbExecBody = runtime.match(
  /uintptr_t tcg_wasm64_tb_exec\(CPUArchState \*env,[\s\S]*?\n\}/,
)?.[0] || "";
assert.match(
  tbExecBody,
  /tcg_wasm64_count_live_translation_metadata\(metadata\)/,
);
assert.match(tbExecBody, /tcg_wasm64_summary_maybe_report\(\)/);
assert.match(tbExecBody, /tcg_wasm64_counters_reset\(counters\)/);
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
assert.match(generatedEquivalence, /r4kSoftmmuFastPath/);
assert.match(generatedEquivalence, /RV64_ENV_RELATIVE_BASE_REG/);
assert.match(generatedEquivalence, /rv64-env-relative-load-store-family/);
assert.match(generatedEquivalence, /rv64-env-relative-non-env-base-fails-closed/);
assert.match(generatedEquivalence, /rv64-env-relative-out-of-range-fails-closed/);
assert.match(generatedEquivalence, /rv64EnvRelativeFixtures/);
assert.match(generatedEquivalence, /R4K_SOFTMMU_EMITTER_NAME/);
assert.match(generatedEquivalence, /WASMJIT_TLB_MIRROR/);
assert.match(generatedEquivalence, /inlineTlbHitLoads/);
assert.match(generatedEquivalence, /qemuLdCalls/);
assert.match(generatedEquivalence, /metadata-output-tb-code-mismatch/);

console.log("wasm64 translate metadata contract: ok");
