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

function parseHexWords(body) {
  return [...body.matchAll(/0x[0-9a-f]+/gi)].map((match) =>
    Number.parseInt(match[0].slice(2), 16) >>> 0
  );
}

const target = read("tcg/wasm64/tcg-target.c.inc");
const runtime = read("tcg/wasm64.c");
const header = read("tcg/wasm64.h");
const tci = read("tcg/tci.c");
const tciTarget = read("tcg/tci/tcg-target.c.inc");

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

assert.match(runtime, /TCG_WASM64_TRANSLATE_CACHE_SIZE/);
assert.match(runtime, /static __thread TCGWasm64TranslateEntry translate_cache/);
assert.match(runtime, /tcg_wasm64_translate_op_supported/);
assert.match(runtime, /tcg_wasm64_translate_op_generated_supported/);
const generatedSupportedBody = runtime.match(
  /static bool tcg_wasm64_translate_op_generated_supported\(uint32_t op\)\s*\{[\s\S]*?switch \(\(TCGOpcode\)op\) \{([\s\S]*?)default:/,
)?.[1] || "";
for (const unsafeHostMemoryOp of [
  "INDEX_op_ld",
  "INDEX_op_ld32u",
  "INDEX_op_ld32s",
  "INDEX_op_st",
  "INDEX_op_st8",
  "INDEX_op_st32",
]) {
  assert.doesNotMatch(
    generatedSupportedBody,
    new RegExp(`case\\s+${unsafeHostMemoryOp}:`),
  );
}
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
assert.match(runtime, /TCG_WASM64_ONE_TB_NAME "live-x86-pre-r4i-ld32u-goto-tb-13"/);
assert.match(runtime, /TCG_WASM64_LIVE_ONE_TB_NAME "live-x86-r4i-ld32u-goto-tb-11"/);
assert.match(runtime, /tcg_wasm64_live_one_tb_words\[\]/);
assert.match(runtime, /0x00020d04/);
assert.match(runtime, /metadata->op_count < ARRAY_SIZE\(tcg_wasm64_live_one_tb_words\)/);
const liveShapeWords = parseHexWords(
  runtime.match(
    /static const uint32_t tcg_wasm64_live_one_tb_words\[\] = \{([\s\S]*?)\};/,
  )?.[1] || "",
);
const liveJsWords = parseHexWords(
  runtime.match(
    /EM_JS\(int, tcg_wasm64_live_one_tb_differential_js,[\s\S]*?const words = \[([\s\S]*?)\];/,
  )?.[1] || "",
);
assert.deepEqual(liveJsWords, liveShapeWords);
assert.deepEqual(liveShapeWords, [
  0xfff0e41c, 0x0000057d, 0x00254d88, 0x00020d04,
  0x0000147d, 0xfff4e435, 0x0100e41e, 0xfff9057d,
  0x00054407, 0x0100e438, 0xfff74049,
]);
assert.match(runtime, /tcg_wasm64_one_tb_differential_js/);
assert.match(runtime, /tcg_wasm64_live_one_tb_differential_js/);
assert.match(runtime, /\.\.\.name\("wasmjit_run"\)/);
assert.match(runtime, /one-tb-differential/);
assert.match(runtime, /live-one-tb-differential/);
assert.match(runtime, /live_shape_fixture/);
assert.match(runtime, /real_live_state_capture/);
assert.match(runtime, /tcg_wasm64_live_one_tb_shape_matches/);
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

console.log("wasm64 translate metadata contract: ok");
