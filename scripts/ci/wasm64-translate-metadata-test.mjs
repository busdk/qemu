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
assert.match(header, /TCG_WASM64_TRANSLATE_OUTPUT_MAX/);
assert.match(header, /translated_generated_output_tbs/);
assert.match(header, /translated_generated_output_bytes/);
assert.match(header, /translated_generated_output_ops/);
assert.match(header, /translated_generated_output_truncated/);
assert.match(header, /generated_output_size/);
assert.match(header, /generated_output_op_count/);
assert.match(header, /generated_output_checksum/);
assert.match(header, /const uint8_t \*generated_output/);
assert.match(header, /tcg_wasm64_translate_note_tci_op\(uint32_t op\)/);
assert.match(header, /tcg_wasm64_translate_note_tci_insn\(uint32_t op,\s*uint32_t insn\)/);
assert.match(header, /tcg_wasm64_translate_lookup\(const void \*tb_ptr\)/);
assert.match(header, /tcg_wasm64_translate_generated_candidate/);
assert.match(header, /tcg_wasm64_translate_generated_output_available/);

assert.match(runtime, /TCG_WASM64_TRANSLATE_CACHE_SIZE/);
assert.match(runtime, /static __thread TCGWasm64TranslateEntry translate_cache/);
assert.match(runtime, /uint8_t generated_output\[TCG_WASM64_TRANSLATE_OUTPUT_MAX\]/);
assert.match(runtime, /tcg_wasm64_translate_op_supported/);
assert.match(runtime, /tcg_wasm64_translate_op_generated_supported/);
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
assert.match(runtime, /TCG_WASM64_TB_METADATA_TERMINAL/);
assert.match(runtime, /tcg_wasm64_translate_generated_candidate\(metadata\)/);

assert.match(tci, /tci_wasm_metadata_generated_candidate/);
assert.match(tci, /tci_wasm_generated_try_exec\(entry, tb_start, regs, ret, true\)/);
assert.match(tci, /tci_wasm_generated_try_exec\(entry, tb_start, regs, ret, false\)/);
assert.match(tci, /return \[0xfe, 0x03, 0x00\]; \/\* atomic\.fence \*\//);

console.log("wasm64 translate metadata contract: ok");
