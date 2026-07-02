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
#define TCG_WASM64_DIRECT_UNSUPPORTED 0
#define TCG_WASM64_DIRECT_EXIT 1
#define TCG_WASM64_DIRECT_DISPATCH 2
#define TCG_WASM64_REPORT_DEFAULT_INTERVAL 100000u

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
static __thread uint64_t direct_next_report;
static bool direct_report_enabled;
static uint64_t direct_report_interval;

#ifdef CONFIG_EMSCRIPTEN
#define TCG_WASM64_ENV_FILE "/qemu-tci-env"

static char *tcg_wasm64_file_getenv(const char *name)
{
    g_autofree char *contents = NULL;
    const char *line;
    size_t name_len = strlen(name);

    if (!g_file_get_contents(TCG_WASM64_ENV_FILE, &contents, NULL, NULL)) {
        return NULL;
    }

    line = contents;
    while (*line != '\0') {
        const char *end = strchr(line, '\n');
        size_t line_len = end ? end - line : strlen(line);

        if (line_len > name_len && line[name_len] == '=' &&
            memcmp(line, name, name_len) == 0) {
            return g_strndup(line + name_len + 1, line_len - name_len - 1);
        }
        line += line_len;
        if (*line == '\n') {
            line++;
        }
    }

    return NULL;
}
#endif

static const char *tcg_wasm64_getenv(const char *name, char **owned)
{
    const char *value = g_getenv(name);

    *owned = NULL;
#ifdef CONFIG_EMSCRIPTEN
    if (value == NULL) {
        *owned = tcg_wasm64_file_getenv(name);
        value = *owned;
    }
#endif

    return value;
}

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
    dst->direct_tb_entries += src->direct_tb_entries;
    dst->direct_generated_executed += src->direct_generated_executed;
    dst->direct_generated_dispatches += src->direct_generated_dispatches;
    dst->direct_tci_fallbacks += src->direct_tci_fallbacks;
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
    dst->exec_generated_output_lookup_tbs +=
        src->exec_generated_output_lookup_tbs;
    dst->exec_generated_output_available_tbs +=
        src->exec_generated_output_available_tbs;
    dst->exec_generated_output_unavailable_tbs +=
        src->exec_generated_output_unavailable_tbs;
    dst->exec_generated_output_missing_candidate_tbs +=
        src->exec_generated_output_missing_candidate_tbs;
    dst->exec_generated_output_incomplete_tbs +=
        src->exec_generated_output_incomplete_tbs;
    dst->fallback_unsupported += src->fallback_unsupported;
    dst->fallback_helper += src->fallback_helper;
    dst->fallback_qemu_load += src->fallback_qemu_load;
    dst->fallback_qemu_store += src->fallback_qemu_store;
    dst->fallback_runtime += src->fallback_runtime;
    dst->generated_compile_prereq_failed +=
        src->generated_compile_prereq_failed;
    dst->generated_compile_no_terminal += src->generated_compile_no_terminal;
    dst->generated_compile_lowering_failed +=
        src->generated_compile_lowering_failed;
    dst->generated_compile_module_failed +=
        src->generated_compile_module_failed;
    dst->generated_compile_table_failed +=
        src->generated_compile_table_failed;
    dst->generated_compile_instance_failed +=
        src->generated_compile_instance_failed;
    dst->generated_compile_add_function_failed +=
        src->generated_compile_add_function_failed;
    dst->generated_compile_exception_failed +=
        src->generated_compile_exception_failed;
    dst->generated_compile_unknown_failed +=
        src->generated_compile_unknown_failed;
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
    dst->exec_generated_output_lookup_tbs +=
        src->exec_generated_output_lookup_tbs;
    dst->exec_generated_output_available_tbs +=
        src->exec_generated_output_available_tbs;
    dst->exec_generated_output_unavailable_tbs +=
        src->exec_generated_output_unavailable_tbs;
    dst->exec_generated_output_missing_candidate_tbs +=
        src->exec_generated_output_missing_candidate_tbs;
    dst->exec_generated_output_incomplete_tbs +=
        src->exec_generated_output_incomplete_tbs;
}

static void tcg_wasm64_counters_add_direct(TCGWasm64Counters *dst,
                                           const TCGWasm64Counters *src)
{
    if (!dst || !src) {
        return;
    }

    dst->direct_tb_entries += src->direct_tb_entries;
    dst->direct_generated_executed += src->direct_generated_executed;
    dst->direct_generated_dispatches += src->direct_generated_dispatches;
    dst->direct_tci_fallbacks += src->direct_tci_fallbacks;
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
    case INDEX_op_deposit:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
    case INDEX_op_ld:
    case INDEX_op_ld32u:
    case INDEX_op_ld32s:
    case INDEX_op_mb:
    case INDEX_op_mov:
    case INDEX_op_movcond:
    case INDEX_op_mul:
    case INDEX_op_neg:
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
    case INDEX_op_tci_qemu_ld_rrr:
    case INDEX_op_tci_qemu_st_rrr:
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

static bool tcg_wasm64_parse_bool_env(const char *raw)
{
    if (!raw || raw[0] == '\0') {
        return false;
    }
    if (g_ascii_strcasecmp(raw, "1") == 0 ||
        g_ascii_strcasecmp(raw, "true") == 0 ||
        g_ascii_strcasecmp(raw, "yes") == 0 ||
        g_ascii_strcasecmp(raw, "on") == 0) {
        return true;
    }
    return false;
}

static uint64_t tcg_wasm64_parse_u64_env(const char *name, uint64_t fallback)
{
    char *owned;
    const char *raw = tcg_wasm64_getenv(name, &owned);
    char *end = NULL;
    uint64_t value = fallback;

    if (!raw || raw[0] == '\0') {
        goto out;
    }
    value = g_ascii_strtoull(raw, &end, 10);
    if (end == raw || *end != '\0' || value == 0) {
        value = fallback;
    }
out:
    g_free(owned);
    return value;
}

static bool tcg_wasm64_direct_report_enabled(void)
{
    static gsize initialized;

    if (unlikely(g_once_init_enter(&initialized))) {
        char *owned;
        const char *raw = tcg_wasm64_getenv("QEMU_WASM64_TCG_REPORT",
                                            &owned);

        direct_report_enabled =
            tcg_wasm64_parse_bool_env(raw);
        g_free(owned);
        direct_report_interval =
            tcg_wasm64_parse_u64_env("QEMU_WASM64_TCG_REPORT_INTERVAL",
                                     TCG_WASM64_REPORT_DEFAULT_INTERVAL);
        g_once_init_leave(&initialized, 1);
    }

    return direct_report_enabled;
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
    uint64_t direct_coverage_ppm = 0;

    if (!counters) {
        return;
    }

    merged = *counters;
    if (counters != &translated_counters) {
        tcg_wasm64_counters_add_translation(&merged, &translated_counters);
        tcg_wasm64_counters_add_direct(&merged, &translated_counters);
    }
    if (active_counters && active_counters != counters) {
        tcg_wasm64_counters_add_translation(&merged, active_counters);
        tcg_wasm64_counters_add_direct(&merged, active_counters);
    }
    counters = &merged;

    if (counters->generated_coverage_denominator != 0) {
        generated_coverage_ppm =
            ((uint64_t)((__uint128_t)counters->generated_coverage_numerator *
                        1000000u /
                        counters->generated_coverage_denominator));
    }
    if (counters->direct_tb_entries != 0) {
        direct_coverage_ppm =
            ((uint64_t)((__uint128_t)counters->direct_generated_executed *
                        1000000u / counters->direct_tb_entries));
    }

    fprintf(stderr,
            "qemu-wasm64-tcg: {\"format\":1,\"event\":\"summary\","
            "\"reason\":\"%s\","
            "\"generated_attempts\":%" PRIu64 ","
            "\"generated_compiled\":%" PRIu64 ","
            "\"generated_executed\":%" PRIu64 ","
            "\"generated_cache_hits\":%" PRIu64 ","
            "\"generated_coverage_basis\":\"generated_executed/subset_attempts\","
            "\"generated_coverage_numerator\":%" PRIu64 ","
            "\"generated_coverage_denominator\":%" PRIu64 ","
            "\"generated_coverage_ppm\":%" PRIu64 ","
            "\"direct_tb_entries\":%" PRIu64 ","
            "\"direct_generated_executed\":%" PRIu64 ","
            "\"direct_generated_dispatches\":%" PRIu64 ","
            "\"direct_tci_fallbacks\":%" PRIu64 ","
            "\"direct_coverage_basis\":\"direct_generated_executed/direct_tb_entries\","
            "\"direct_coverage_numerator\":%" PRIu64 ","
            "\"direct_coverage_denominator\":%" PRIu64 ","
            "\"direct_coverage_ppm\":%" PRIu64 ","
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
            "\"exec_generated_output_lookup_tbs\":%" PRIu64 ","
            "\"exec_generated_output_available_tbs\":%" PRIu64 ","
            "\"exec_generated_output_unavailable_tbs\":%" PRIu64 ","
            "\"exec_generated_output_missing_candidate_tbs\":%" PRIu64 ","
            "\"exec_generated_output_incomplete_tbs\":%" PRIu64 ","
            "\"fallback_unsupported\":%" PRIu64 ","
            "\"fallback_helper\":%" PRIu64 ","
            "\"fallback_qemu_load\":%" PRIu64 ","
            "\"fallback_qemu_store\":%" PRIu64 ","
            "\"fallback_runtime\":%" PRIu64 ","
            "\"generated_compile_prereq_failed\":%" PRIu64 ","
            "\"generated_compile_no_terminal\":%" PRIu64 ","
            "\"generated_compile_lowering_failed\":%" PRIu64 ","
            "\"generated_compile_module_failed\":%" PRIu64 ","
            "\"generated_compile_table_failed\":%" PRIu64 ","
            "\"generated_compile_instance_failed\":%" PRIu64 ","
            "\"generated_compile_add_function_failed\":%" PRIu64 ","
            "\"generated_compile_exception_failed\":%" PRIu64 ","
            "\"generated_compile_unknown_failed\":%" PRIu64 ","
            "\"translated_generated_first_unsupported_ops\":[",
            reason ? reason : "unknown",
            counters->generated_attempts,
            counters->generated_compiled,
            counters->generated_executed,
            counters->generated_cache_hits,
            counters->generated_coverage_numerator,
            counters->generated_coverage_denominator,
            generated_coverage_ppm,
            counters->direct_tb_entries,
            counters->direct_generated_executed,
            counters->direct_generated_dispatches,
            counters->direct_tci_fallbacks,
            counters->direct_generated_executed,
            counters->direct_tb_entries,
            direct_coverage_ppm,
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
            counters->exec_generated_output_lookup_tbs,
            counters->exec_generated_output_available_tbs,
            counters->exec_generated_output_unavailable_tbs,
            counters->exec_generated_output_missing_candidate_tbs,
            counters->exec_generated_output_incomplete_tbs,
            counters->fallback_unsupported,
            counters->fallback_helper,
            counters->fallback_qemu_load,
            counters->fallback_qemu_store,
            counters->fallback_runtime,
            counters->generated_compile_prereq_failed,
            counters->generated_compile_no_terminal,
            counters->generated_compile_lowering_failed,
            counters->generated_compile_module_failed,
            counters->generated_compile_table_failed,
            counters->generated_compile_instance_failed,
            counters->generated_compile_add_function_failed,
            counters->generated_compile_exception_failed,
            counters->generated_compile_unknown_failed);
    tcg_wasm64_print_generated_unsupported_top();
    fprintf(stderr, "]}\n");
}

static void tcg_wasm64_maybe_report_direct(const char *reason,
                                           const TCGWasm64Counters *counters)
{
    if (!counters || !tcg_wasm64_direct_report_enabled()) {
        return;
    }
    if (direct_next_report == 0) {
        direct_next_report = direct_report_interval;
    }
    if (counters->direct_tb_entries < direct_next_report) {
        return;
    }
    tcg_wasm64_report_summary(reason, counters);
    direct_next_report = counters->direct_tb_entries + direct_report_interval;
}

uintptr_t tcg_wasm64_tb_exec(CPUArchState *env, const void *tb_ptr,
                             TCGWasm64Counters *counters)
{
    TCGWasm64Counters *previous_counters = active_counters;
    const void *current_tb_ptr = tb_ptr;
    const TCGWasm64TBMetadata *metadata;
    tcg_target_ulong regs[TCG_TARGET_NB_REGS];
    uint64_t stack[(TCG_STATIC_CALL_ARGS_SIZE + TCG_STATIC_FRAME_SIZE)
                   / sizeof(uint64_t)];
    uintptr_t ret = 0;

    /*
     * Native wasm64 lowering grows behind this boundary.  Try generated TBs
     * directly from the backend when translation-time output is complete, but
     * preserve TCI as the correctness fallback for every unsupported or failed
     * shape.
     */
    memset(regs, 0, sizeof(regs));
    memset(stack, 0, sizeof(stack));
    regs[TCG_AREG0] = (tcg_target_ulong)env;
    regs[TCG_REG_CALL_STACK] = (uintptr_t)stack;
    active_counters = counters;

    for (;;) {
        metadata = tcg_wasm64_translate_lookup(current_tb_ptr);
        if (counters) {
            counters->direct_tb_entries++;
            if (metadata) {
                counters->translated_tbs++;
                counters->translated_ops += metadata->op_count;
                counters->exec_generated_output_lookup_tbs++;
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
                        counters->exec_generated_output_available_tbs++;
                        counters->translated_generated_output_tbs++;
                        counters->translated_generated_output_bytes +=
                            metadata->generated_output_size;
                        counters->translated_generated_output_ops +=
                            metadata->generated_output_op_count;
                    } else {
                        counters->exec_generated_output_unavailable_tbs++;
                        counters->translated_generated_output_unavailable_tbs++;
                        if (!(metadata->flags &
                              TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE)) {
                            counters->exec_generated_output_missing_candidate_tbs++;
                            counters->translated_generated_output_missing_candidate_tbs++;
                        } else {
                            counters->exec_generated_output_incomplete_tbs++;
                            counters->translated_generated_output_incomplete_tbs++;
                        }
                        if (metadata->first_generated_unsupported_op !=
                            UINT32_MAX) {
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

        if (tcg_wasm64_translate_generated_output_available(metadata)) {
            switch (tcg_wasm64_tci_generated_try_exec(
                        current_tb_ptr, (uintptr_t)regs, (uintptr_t)&ret)) {
            case TCG_WASM64_DIRECT_EXIT:
                if (counters) {
                    counters->direct_generated_executed++;
                }
                goto out;
            case TCG_WASM64_DIRECT_DISPATCH:
                if (ret != 0) {
                    if (counters) {
                        counters->direct_generated_executed++;
                        counters->direct_generated_dispatches++;
                    }
                    current_tb_ptr = (const void *)ret;
                    continue;
                } else {
                    ret = 0;
                    goto out;
                }
            case TCG_WASM64_DIRECT_UNSUPPORTED:
                break;
            default:
                if (counters) {
                    tcg_wasm64_count_fallback(counters,
                                              TCG_WASM64_FALLBACK_RUNTIME);
                }
                break;
            }
        }

        if (counters) {
            counters->direct_tci_fallbacks++;
        }
        {
            bool dispatched = false;

            ret = tcg_tci_qemu_tb_exec_one(env, current_tb_ptr, &dispatched);
            if (dispatched) {
                current_tb_ptr = (const void *)ret;
                continue;
            }
        }
        goto out;
    }

out:
    tcg_wasm64_counters_add_translation(&translated_counters, counters);
    tcg_wasm64_counters_add_direct(&translated_counters, counters);
    active_counters = previous_counters;
    tcg_wasm64_maybe_report_direct("direct-interval", &translated_counters);
    return ret;
}

uintptr_t QEMU_DISABLE_CFI tcg_qemu_tb_exec(CPUArchState *env,
                                            const void *tb_ptr)
{
    TCGWasm64Counters counters;

    tcg_wasm64_counters_reset(&counters);
    return tcg_wasm64_tb_exec(env, tb_ptr, &counters);
}
