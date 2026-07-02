/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Experimental wasm64 TCG backend runtime.
 *
 * The backend is not selected by default.  Keep the runtime boundary small
 * and conservative: generated WebAssembly TBs receive one context pointer and
 * unsupported work must continue through a correctness fallback.
 */

#include "qemu/osdep.h"
#include "tcg/tcg.h"
#include "tcg/wasm64.h"

#define TCG_WASM64_TRANSLATE_CACHE_SIZE 8192u

typedef struct TCGWasm64TranslateEntry {
    const void *tb_ptr;
    TCGWasm64TBMetadata metadata;
    uint32_t generated_output[TCG_WASM64_TRANSLATE_OUTPUT_WORDS];
} TCGWasm64TranslateEntry;

static __thread TCGWasm64Counters *active_counters;
static __thread TCGWasm64Counters translated_counters;
static __thread uint64_t translated_generated_first_unsupported_ops[NB_OPS];
static __thread TCGWasm64TranslateEntry translate_cache[
    TCG_WASM64_TRANSLATE_CACHE_SIZE];
static __thread TCGWasm64TBMetadata *active_translate_metadata;

static TCGWasm64TranslateEntry *tcg_wasm64_translate_entry(const void *tb_ptr)
{
    uintptr_t hash = (uintptr_t)tb_ptr >> 4;

    return &translate_cache[hash % TCG_WASM64_TRANSLATE_CACHE_SIZE];
}

void tcg_wasm64_counters_reset(TCGWasm64Counters *counters)
{
    if (counters) {
        memset(counters, 0, sizeof(*counters));
    }
}

void tcg_wasm64_counters_add(TCGWasm64Counters *dst,
                             const TCGWasm64Counters *src)
{
    if (!dst || !src) {
        return;
    }

    dst->generated_attempts += src->generated_attempts;
    dst->generated_compiled += src->generated_compiled;
    dst->generated_executed += src->generated_executed;
    dst->generated_cache_hits += src->generated_cache_hits;
    dst->generated_coverage_numerator += src->generated_coverage_numerator;
    dst->generated_coverage_denominator += src->generated_coverage_denominator;
    dst->translated_tbs += src->translated_tbs;
    dst->translated_ops += src->translated_ops;
    dst->translated_fallback_markers += src->translated_fallback_markers;
    dst->translated_metadata_misses += src->translated_metadata_misses;
    dst->translated_profiled_tbs += src->translated_profiled_tbs;
    dst->translated_lowerable_tbs += src->translated_lowerable_tbs;
    dst->translated_profile_supported_ops +=
        src->translated_profile_supported_ops;
    dst->translated_profile_unsupported_ops +=
        src->translated_profile_unsupported_ops;
    dst->translated_generated_candidate_tbs +=
        src->translated_generated_candidate_tbs;
    dst->translated_generated_supported_ops +=
        src->translated_generated_supported_ops;
    dst->translated_generated_unsupported_ops +=
        src->translated_generated_unsupported_ops;
    dst->translated_generated_output_tbs +=
        src->translated_generated_output_tbs;
    dst->translated_generated_output_unavailable_tbs +=
        src->translated_generated_output_unavailable_tbs;
    dst->translated_generated_output_missing_candidate_tbs +=
        src->translated_generated_output_missing_candidate_tbs;
    dst->translated_generated_output_incomplete_tbs +=
        src->translated_generated_output_incomplete_tbs;
    dst->translated_generated_output_bytes +=
        src->translated_generated_output_bytes;
    dst->translated_generated_output_ops +=
        src->translated_generated_output_ops;
    dst->translated_generated_output_truncated +=
        src->translated_generated_output_truncated;
    dst->fallback_unsupported += src->fallback_unsupported;
    dst->fallback_helper += src->fallback_helper;
    dst->fallback_qemu_load += src->fallback_qemu_load;
    dst->fallback_qemu_store += src->fallback_qemu_store;
    dst->fallback_runtime += src->fallback_runtime;
}

static void tcg_wasm64_counters_add_translation(TCGWasm64Counters *dst,
                                                const TCGWasm64Counters *src)
{
    if (!dst || !src) {
        return;
    }

    dst->translated_tbs += src->translated_tbs;
    dst->translated_ops += src->translated_ops;
    dst->translated_fallback_markers += src->translated_fallback_markers;
    dst->translated_metadata_misses += src->translated_metadata_misses;
    dst->translated_profiled_tbs += src->translated_profiled_tbs;
    dst->translated_lowerable_tbs += src->translated_lowerable_tbs;
    dst->translated_profile_supported_ops +=
        src->translated_profile_supported_ops;
    dst->translated_profile_unsupported_ops +=
        src->translated_profile_unsupported_ops;
    dst->translated_generated_candidate_tbs +=
        src->translated_generated_candidate_tbs;
    dst->translated_generated_supported_ops +=
        src->translated_generated_supported_ops;
    dst->translated_generated_unsupported_ops +=
        src->translated_generated_unsupported_ops;
    dst->translated_generated_output_tbs +=
        src->translated_generated_output_tbs;
    dst->translated_generated_output_unavailable_tbs +=
        src->translated_generated_output_unavailable_tbs;
    dst->translated_generated_output_missing_candidate_tbs +=
        src->translated_generated_output_missing_candidate_tbs;
    dst->translated_generated_output_incomplete_tbs +=
        src->translated_generated_output_incomplete_tbs;
    dst->translated_generated_output_bytes +=
        src->translated_generated_output_bytes;
    dst->translated_generated_output_ops +=
        src->translated_generated_output_ops;
    dst->translated_generated_output_truncated +=
        src->translated_generated_output_truncated;
}

void tcg_wasm64_count_fallback(TCGWasm64Counters *counters,
                               TCGWasm64FallbackReason reason)
{
    if (!counters) {
        return;
    }

    switch (reason) {
    case TCG_WASM64_FALLBACK_UNSUPPORTED:
        counters->fallback_unsupported++;
        break;
    case TCG_WASM64_FALLBACK_HELPER:
        counters->fallback_helper++;
        break;
    case TCG_WASM64_FALLBACK_QEMU_LOAD:
        counters->fallback_qemu_load++;
        break;
    case TCG_WASM64_FALLBACK_QEMU_STORE:
        counters->fallback_qemu_store++;
        break;
    case TCG_WASM64_FALLBACK_RUNTIME:
        counters->fallback_runtime++;
        break;
    default:
        g_assert_not_reached();
    }
}

static bool tcg_wasm64_translate_op_supported(uint32_t op)
{
    switch ((TCGOpcode)op) {
    case INDEX_op_add:
    case INDEX_op_and:
    case INDEX_op_brcond:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
    case INDEX_op_ld:
    case INDEX_op_ld8s:
    case INDEX_op_ld8u:
    case INDEX_op_ld16s:
    case INDEX_op_ld16u:
    case INDEX_op_ld32s:
    case INDEX_op_ld32u:
    case INDEX_op_mb:
    case INDEX_op_mov:
    case INDEX_op_or:
    case INDEX_op_qemu_ld:
    case INDEX_op_qemu_st:
    case INDEX_op_setcond:
    case INDEX_op_st:
    case INDEX_op_st8:
    case INDEX_op_st16:
    case INDEX_op_st32:
    case INDEX_op_sub:
    case INDEX_op_tci_movi:
    case INDEX_op_tci_movl:
    case INDEX_op_tci_qemu_ld_rrr:
    case INDEX_op_tci_qemu_st_rrr:
    case INDEX_op_tci_setcond32:
    case INDEX_op_xor:
        return true;
    default:
        return false;
    }
}

static bool tcg_wasm64_translate_op_generated_supported(uint32_t op)
{
    switch ((TCGOpcode)op) {
    case INDEX_op_add:
    case INDEX_op_and:
    case INDEX_op_brcond:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
    case INDEX_op_ld:
    case INDEX_op_ld32u:
    case INDEX_op_mb:
    case INDEX_op_mov:
    case INDEX_op_movcond:
    case INDEX_op_mul:
    case INDEX_op_or:
    case INDEX_op_setcond:
    case INDEX_op_shl:
    case INDEX_op_shr:
    case INDEX_op_st:
    case INDEX_op_st8:
    case INDEX_op_st32:
    case INDEX_op_sub:
    case INDEX_op_tci_movi:
    case INDEX_op_tci_movl:
    case INDEX_op_tci_setcond32:
    case INDEX_op_extract:
    case INDEX_op_sextract:
    case INDEX_op_xor:
        return true;
    default:
        return false;
    }
}

void tcg_wasm64_translate_begin(const void *tb_ptr)
{
    TCGWasm64TranslateEntry *entry;

    if (!tb_ptr) {
        active_translate_metadata = NULL;
        return;
    }

    entry = tcg_wasm64_translate_entry(tb_ptr);
    entry->tb_ptr = tb_ptr;
    memset(&entry->metadata, 0, sizeof(entry->metadata));
    memset(entry->generated_output, 0, sizeof(entry->generated_output));
    entry->metadata.tb_ptr = tb_ptr;
    entry->metadata.magic = TCG_WASM64_TB_METADATA_MAGIC;
    entry->metadata.version = TCG_WASM64_TB_METADATA_VERSION;
    entry->metadata.flags = TCG_WASM64_TB_METADATA_VALID |
                            TCG_WASM64_TB_METADATA_FALLBACK |
                            TCG_WASM64_TB_METADATA_LOWERING_PROFILE |
                            TCG_WASM64_TB_METADATA_PROFILE_LOWERABLE |
                            TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE;
    entry->metadata.first_op = UINT32_MAX;
    entry->metadata.last_op = UINT32_MAX;
    entry->metadata.first_unsupported_op = UINT32_MAX;
    entry->metadata.fallback_reason =
        TCG_WASM64_TRANSLATE_FALLBACK_NO_WASM_EMITTER;
    entry->metadata.lowering_profile = TCG_WASM64_LOWERING_PROFILE_HOTBLOCK;
    entry->metadata.first_generated_unsupported_op = UINT32_MAX;
    entry->metadata.generated_output = entry->generated_output;
    active_translate_metadata = &entry->metadata;
}

void tcg_wasm64_translate_note_tci_op(uint32_t op)
{
    TCGWasm64TBMetadata *metadata = active_translate_metadata;
    bool supported;
    bool generated_supported;

    if (!metadata) {
        return;
    }

    supported = tcg_wasm64_translate_op_supported(op);
    generated_supported = tcg_wasm64_translate_op_generated_supported(op);
    if (metadata->op_count == 0) {
        metadata->first_op = op;
    }
    metadata->last_op = op;
    metadata->op_count++;
    if (supported) {
        metadata->supported_op_count++;
    } else {
        metadata->unsupported_op_count++;
        metadata->flags &= ~TCG_WASM64_TB_METADATA_PROFILE_LOWERABLE;
        if (metadata->first_unsupported_op == UINT32_MAX) {
            metadata->first_unsupported_op = op;
            metadata->fallback_reason =
                TCG_WASM64_TRANSLATE_FALLBACK_UNSUPPORTED_OPCODE;
        }
    }
    if (generated_supported) {
        metadata->generated_supported_op_count++;
    } else {
        metadata->generated_unsupported_op_count++;
        metadata->flags &= ~TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE;
        if (metadata->first_generated_unsupported_op == UINT32_MAX) {
            metadata->first_generated_unsupported_op = op;
        }
    }
    if (op == INDEX_op_exit_tb || op == INDEX_op_goto_tb) {
        metadata->flags |= TCG_WASM64_TB_METADATA_TERMINAL;
    }
}

static uint32_t tcg_wasm64_checksum32(uint32_t checksum, uint8_t value)
{
    /*
     * FNV-1a over the translation-time output material.  The checksum is a
     * deterministic guard for tests and diagnostics; it is not a security
     * boundary.
     */
    if (checksum == 0) {
        checksum = 2166136261u;
    }
    checksum ^= value;
    checksum *= 16777619u;
    return checksum;
}

void tcg_wasm64_translate_note_tci_insn(uint32_t op, uint32_t insn)
{
    TCGWasm64TBMetadata *metadata = active_translate_metadata;
    uint32_t *output;
    uint32_t size;
    uint32_t output_index;

    if (!metadata || !tcg_wasm64_translate_op_generated_supported(op)) {
        return;
    }

    size = metadata->generated_output_size;
    if (size + sizeof(insn) > TCG_WASM64_TRANSLATE_OUTPUT_MAX) {
        metadata->flags |= TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED;
        metadata->flags &= ~TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE;
        return;
    }

    output = (uint32_t *)metadata->generated_output;
    output_index = size / sizeof(insn);
    output[output_index] = insn;
    metadata->generated_output_checksum =
        tcg_wasm64_checksum32(metadata->generated_output_checksum,
                              (uint8_t)(insn & 0xffu));
    metadata->generated_output_checksum =
        tcg_wasm64_checksum32(metadata->generated_output_checksum,
                              (uint8_t)((insn >> 8) & 0xffu));
    metadata->generated_output_checksum =
        tcg_wasm64_checksum32(metadata->generated_output_checksum,
                              (uint8_t)((insn >> 16) & 0xffu));
    metadata->generated_output_checksum =
        tcg_wasm64_checksum32(metadata->generated_output_checksum,
                              (uint8_t)((insn >> 24) & 0xffu));
    metadata->generated_output_size = size + sizeof(insn);
    metadata->generated_output_op_count++;
    metadata->flags |= TCG_WASM64_TB_METADATA_GENERATED_OUTPUT;
}

const TCGWasm64TBMetadata *tcg_wasm64_translate_lookup(const void *tb_ptr)
{
    TCGWasm64TranslateEntry *entry;
    const TCGWasm64TBMetadata *metadata;

    if (!tb_ptr) {
        return NULL;
    }

    entry = tcg_wasm64_translate_entry(tb_ptr);
    metadata = &entry->metadata;
    if (entry->tb_ptr != tb_ptr ||
        metadata->magic != TCG_WASM64_TB_METADATA_MAGIC ||
        metadata->version != TCG_WASM64_TB_METADATA_VERSION ||
        !(metadata->flags & TCG_WASM64_TB_METADATA_VALID)) {
        return NULL;
    }
    return metadata;
}

bool tcg_wasm64_translate_generated_candidate(
    const TCGWasm64TBMetadata *metadata)
{
    if (!metadata ||
        metadata->magic != TCG_WASM64_TB_METADATA_MAGIC ||
        metadata->version != TCG_WASM64_TB_METADATA_VERSION ||
        !(metadata->flags & TCG_WASM64_TB_METADATA_VALID)) {
        return false;
    }
    return (metadata->flags & TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE) &&
           (metadata->flags & TCG_WASM64_TB_METADATA_TERMINAL) &&
           metadata->generated_unsupported_op_count == 0;
}

bool tcg_wasm64_translate_generated_output_available(
    const TCGWasm64TBMetadata *metadata)
{
    if (!tcg_wasm64_translate_generated_candidate(metadata)) {
        return false;
    }
    if (!(metadata->flags & TCG_WASM64_TB_METADATA_GENERATED_OUTPUT) ||
        (metadata->flags & TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED)) {
        return false;
    }
    return metadata->generated_output_size != 0 &&
           metadata->generated_output_size % sizeof(uint32_t) == 0 &&
           metadata->generated_output_op_count == metadata->op_count &&
           metadata->generated_output_op_count ==
               metadata->generated_output_size / sizeof(uint32_t) &&
           metadata->generated_output != NULL;
}

bool tcg_wasm64_backend_available(void)
{
    return true;
}

TCGWasm64Counters *tcg_wasm64_active_counters(void)
{
    return active_counters;
}

static const char *tcg_wasm64_op_name(uint32_t op)
{
    if (op < tcg_op_defs_max) {
        return tcg_op_defs[op].name;
    }
    return "unknown";
}

static void tcg_wasm64_count_generated_first_unsupported(uint32_t op)
{
    if (op < NB_OPS) {
        translated_generated_first_unsupported_ops[op]++;
    }
}

static void tcg_wasm64_print_generated_unsupported_top(void)
{
    uint32_t top_ops[8] = { 0 };

    for (uint32_t op = 0; op < NB_OPS; op++) {
        uint64_t count = translated_generated_first_unsupported_ops[op];

        if (count == 0) {
            continue;
        }
        for (size_t i = 0; i < ARRAY_SIZE(top_ops); i++) {
            if (translated_generated_first_unsupported_ops[top_ops[i]] <
                count) {
                memmove(&top_ops[i + 1], &top_ops[i],
                        (ARRAY_SIZE(top_ops) - i - 1) *
                        sizeof(top_ops[0]));
                top_ops[i] = op;
                break;
            }
        }
    }

    for (size_t i = 0; i < ARRAY_SIZE(top_ops); i++) {
        uint32_t op = top_ops[i];
        uint64_t count = translated_generated_first_unsupported_ops[op];

        if (count == 0) {
            break;
        }
        fprintf(stderr, "%s{\"op\":%u,\"name\":\"%s\",\"count\":%" PRIu64 "}",
                i == 0 ? "" : ",", op, tcg_wasm64_op_name(op), count);
    }
}

void tcg_wasm64_report_summary(const char *reason,
                               const TCGWasm64Counters *counters)
{
    TCGWasm64Counters merged;
    uint64_t generated_coverage_ppm = 0;

    if (!counters) {
        return;
    }

    merged = *counters;
    tcg_wasm64_counters_add_translation(&merged, &translated_counters);
    if (active_counters) {
        tcg_wasm64_counters_add_translation(&merged, active_counters);
    }
    counters = &merged;

    if (counters->generated_coverage_denominator != 0) {
        generated_coverage_ppm =
            ((uint64_t)((__uint128_t)counters->generated_coverage_numerator *
                        1000000u /
                        counters->generated_coverage_denominator));
    }

    fprintf(stderr,
            "qemu-wasm64-tcg: {\"format\":1,\"event\":\"summary\","
            "\"reason\":\"%s\","
            "\"generated_attempts\":%" PRIu64 ","
            "\"generated_compiled\":%" PRIu64 ","
            "\"generated_executed\":%" PRIu64 ","
            "\"generated_cache_hits\":%" PRIu64 ","
            "\"generated_coverage_numerator\":%" PRIu64 ","
            "\"generated_coverage_denominator\":%" PRIu64 ","
            "\"generated_coverage_ppm\":%" PRIu64 ","
            "\"translated_tbs\":%" PRIu64 ","
            "\"translated_ops\":%" PRIu64 ","
            "\"translated_fallback_markers\":%" PRIu64 ","
            "\"translated_metadata_misses\":%" PRIu64 ","
            "\"translated_profiled_tbs\":%" PRIu64 ","
            "\"translated_lowerable_tbs\":%" PRIu64 ","
            "\"translated_profile_supported_ops\":%" PRIu64 ","
            "\"translated_profile_unsupported_ops\":%" PRIu64 ","
            "\"translated_generated_candidate_tbs\":%" PRIu64 ","
            "\"translated_generated_supported_ops\":%" PRIu64 ","
            "\"translated_generated_unsupported_ops\":%" PRIu64 ","
            "\"translated_generated_output_tbs\":%" PRIu64 ","
            "\"translated_generated_output_unavailable_tbs\":%" PRIu64 ","
            "\"translated_generated_output_missing_candidate_tbs\":%" PRIu64 ","
            "\"translated_generated_output_incomplete_tbs\":%" PRIu64 ","
            "\"translated_generated_output_bytes\":%" PRIu64 ","
            "\"translated_generated_output_ops\":%" PRIu64 ","
            "\"translated_generated_output_truncated\":%" PRIu64 ","
            "\"fallback_unsupported\":%" PRIu64 ","
            "\"fallback_helper\":%" PRIu64 ","
            "\"fallback_qemu_load\":%" PRIu64 ","
            "\"fallback_qemu_store\":%" PRIu64 ","
            "\"fallback_runtime\":%" PRIu64 ","
            "\"translated_generated_first_unsupported_ops\":[",
            reason ? reason : "unknown",
            counters->generated_attempts,
            counters->generated_compiled,
            counters->generated_executed,
            counters->generated_cache_hits,
            counters->generated_coverage_numerator,
            counters->generated_coverage_denominator,
            generated_coverage_ppm,
            counters->translated_tbs,
            counters->translated_ops,
            counters->translated_fallback_markers,
            counters->translated_metadata_misses,
            counters->translated_profiled_tbs,
            counters->translated_lowerable_tbs,
            counters->translated_profile_supported_ops,
            counters->translated_profile_unsupported_ops,
            counters->translated_generated_candidate_tbs,
            counters->translated_generated_supported_ops,
            counters->translated_generated_unsupported_ops,
            counters->translated_generated_output_tbs,
            counters->translated_generated_output_unavailable_tbs,
            counters->translated_generated_output_missing_candidate_tbs,
            counters->translated_generated_output_incomplete_tbs,
            counters->translated_generated_output_bytes,
            counters->translated_generated_output_ops,
            counters->translated_generated_output_truncated,
            counters->fallback_unsupported,
            counters->fallback_helper,
            counters->fallback_qemu_load,
            counters->fallback_qemu_store,
            counters->fallback_runtime);
    tcg_wasm64_print_generated_unsupported_top();
    fprintf(stderr, "]}\n");
}

uintptr_t tcg_wasm64_tb_exec(CPUArchState *env, const void *tb_ptr,
                             TCGWasm64Counters *counters)
{
    TCGWasm64Counters *previous_counters = active_counters;
    const TCGWasm64TBMetadata *metadata;
    uintptr_t ret;
    TCGWasm64Context ctx = {
        .tb_ptr = (void *)tb_ptr,
        .env = env,
        .counters = counters,
    };

    /*
     * Native wasm64 lowering grows behind this boundary.  The TCI fallback
     * owns live register state today, so it receives the active counter
     * contract and may execute generated WebAssembly blocks only after it has
     * validated the TCI bytecode shape.
     */
    (void)ctx;
    metadata = tcg_wasm64_translate_lookup(tb_ptr);
    if (counters) {
        if (metadata) {
            counters->translated_tbs++;
            counters->translated_ops += metadata->op_count;
            if (metadata->flags & TCG_WASM64_TB_METADATA_FALLBACK) {
                counters->translated_fallback_markers++;
            }
            if (metadata->flags & TCG_WASM64_TB_METADATA_LOWERING_PROFILE) {
                counters->translated_profiled_tbs++;
                counters->translated_profile_supported_ops +=
                    metadata->supported_op_count;
                counters->translated_profile_unsupported_ops +=
                    metadata->unsupported_op_count;
                if (metadata->flags &
                    TCG_WASM64_TB_METADATA_PROFILE_LOWERABLE) {
                    counters->translated_lowerable_tbs++;
                }
                counters->translated_generated_supported_ops +=
                    metadata->generated_supported_op_count;
                counters->translated_generated_unsupported_ops +=
                    metadata->generated_unsupported_op_count;
                if (tcg_wasm64_translate_generated_candidate(metadata)) {
                    counters->translated_generated_candidate_tbs++;
                }
                if (tcg_wasm64_translate_generated_output_available(
                        metadata)) {
                    counters->translated_generated_output_tbs++;
                    counters->translated_generated_output_bytes +=
                        metadata->generated_output_size;
                    counters->translated_generated_output_ops +=
                        metadata->generated_output_op_count;
                } else {
                    counters->translated_generated_output_unavailable_tbs++;
                    if (!(metadata->flags &
                          TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE)) {
                        counters->translated_generated_output_missing_candidate_tbs++;
                    } else {
                        counters->translated_generated_output_incomplete_tbs++;
                    }
                    if (metadata->first_generated_unsupported_op != UINT32_MAX) {
                        tcg_wasm64_count_generated_first_unsupported(
                            metadata->first_generated_unsupported_op);
                    }
                }
                if (metadata->flags &
                    TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED) {
                    counters->translated_generated_output_truncated++;
                }
            }
        } else {
            counters->translated_metadata_misses++;
        }
    }
    active_counters = counters;
    ret = tcg_tci_qemu_tb_exec(env, tb_ptr);
    tcg_wasm64_counters_add_translation(&translated_counters, counters);
    active_counters = previous_counters;
    return ret;
}

uintptr_t QEMU_DISABLE_CFI tcg_qemu_tb_exec(CPUArchState *env,
                                            const void *tb_ptr)
{
    TCGWasm64Counters counters;

    tcg_wasm64_counters_reset(&counters);
    return tcg_wasm64_tb_exec(env, tb_ptr, &counters);
}
