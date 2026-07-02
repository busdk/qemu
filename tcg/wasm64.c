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

#ifdef CONFIG_EMSCRIPTEN
#include <emscripten/emscripten.h>
#endif

#define TCG_WASM64_TRANSLATE_CACHE_SIZE 8192u
#define TCG_WASM64_RUNLOOP_ENV_FILE "/qemu-tci-env"
#define TCG_WASM64_RUNLOOP_SMOKE_BUDGET 1000000u

QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, env) !=
                  TCG_WASM64_RUN_CTX_ENV_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, guest_ram) !=
                  TCG_WASM64_RUN_CTX_GUEST_RAM_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, budget) !=
                  TCG_WASM64_RUN_CTX_BUDGET_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, counters) !=
                  TCG_WASM64_RUN_CTX_COUNTERS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, exit) !=
                  TCG_WASM64_RUN_CTX_EXIT_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, mode) !=
                  TCG_WASM64_RUN_CTX_MODE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, flags) !=
                  TCG_WASM64_RUN_CTX_FLAGS_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(TCGWasm64RunContext) != TCG_WASM64_RUN_CTX_SIZE);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, reason) !=
                  TCG_WASM64_RUN_EXIT_REASON_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, tb_id) !=
                  TCG_WASM64_RUN_EXIT_TB_ID_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, pc) !=
                  TCG_WASM64_RUN_EXIT_PC_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, vaddr) !=
                  TCG_WASM64_RUN_EXIT_VADDR_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, paddr) !=
                  TCG_WASM64_RUN_EXIT_PADDR_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, value) !=
                  TCG_WASM64_RUN_EXIT_VALUE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, size) !=
                  TCG_WASM64_RUN_EXIT_SIZE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunExit, flags) !=
                  TCG_WASM64_RUN_EXIT_FLAGS_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(TCGWasm64RunExit) != TCG_WASM64_RUN_EXIT_SIZE);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters,
                  generated_guest_instructions) !=
                  TCG_WASM64_RUN_COUNTERS_GENERATED_GUEST_INSTRUCTIONS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters,
                  fallback_guest_instructions) !=
                  TCG_WASM64_RUN_COUNTERS_FALLBACK_GUEST_INSTRUCTIONS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, generated_body_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_GENERATED_BODY_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, tci_dispatch_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_TCI_DISPATCH_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, tb_lookup_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_TB_LOOKUP_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, helper_call_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_HELPER_CALL_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, qemu_ld_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_QEMU_LD_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, qemu_st_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_QEMU_ST_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, compile_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_COMPILE_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, instantiate_time_ns) !=
                  TCG_WASM64_RUN_COUNTERS_INSTANTIATE_TIME_NS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, generated_chain_length) !=
                  TCG_WASM64_RUN_COUNTERS_GENERATED_CHAIN_LENGTH_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, inline_tlb_hit_loads) !=
                  TCG_WASM64_RUN_COUNTERS_INLINE_TLB_HIT_LOADS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, inline_tlb_hit_stores) !=
                  TCG_WASM64_RUN_COUNTERS_INLINE_TLB_HIT_STORES_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, helper_calls) !=
                  TCG_WASM64_RUN_COUNTERS_HELPER_CALLS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, qemu_ld_calls) !=
                  TCG_WASM64_RUN_COUNTERS_QEMU_LD_CALLS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, qemu_st_calls) !=
                  TCG_WASM64_RUN_COUNTERS_QEMU_ST_CALLS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_budget) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_BUDGET_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_mmio) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_MMIO_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_tlb_miss_or_fault) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_TLB_MISS_OR_FAULT_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_interrupt) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_INTERRUPT_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_helper) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_HELPER_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_unsupported) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_UNSUPPORTED_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_hlt) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_HLT_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunCounters, exits_invalidated) !=
                  TCG_WASM64_RUN_COUNTERS_EXITS_INVALIDATED_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(TCGWasm64RunCounters) !=
                  TCG_WASM64_RUN_COUNTERS_SIZE);

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
    for (size_t i = 0; i < ARRAY_SIZE(dst->generated_exits); i++) {
        dst->generated_exits[i] += src->generated_exits[i];
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

void tcg_wasm64_count_exit(TCGWasm64Counters *counters,
                           TCGWasm64ExitReason reason)
{
    if (!counters) {
        return;
    }
    if (reason >= TCG_WASM64_EXIT__MAX) {
        counters->generated_exits[TCG_WASM64_EXIT_FATAL]++;
        return;
    }
    counters->generated_exits[reason]++;
}

void tcg_wasm64_run_counters_reset(TCGWasm64RunCounters *counters)
{
    if (counters) {
        memset(counters, 0, sizeof(*counters));
    }
}

void tcg_wasm64_run_counters_add(TCGWasm64RunCounters *dst,
                                 const TCGWasm64RunCounters *src)
{
    if (!dst || !src) {
        return;
    }

    dst->generated_guest_instructions += src->generated_guest_instructions;
    dst->fallback_guest_instructions += src->fallback_guest_instructions;
    dst->generated_body_time_ns += src->generated_body_time_ns;
    dst->tci_dispatch_time_ns += src->tci_dispatch_time_ns;
    dst->tb_lookup_time_ns += src->tb_lookup_time_ns;
    dst->helper_call_time_ns += src->helper_call_time_ns;
    dst->qemu_ld_time_ns += src->qemu_ld_time_ns;
    dst->qemu_st_time_ns += src->qemu_st_time_ns;
    dst->compile_time_ns += src->compile_time_ns;
    dst->instantiate_time_ns += src->instantiate_time_ns;
    dst->generated_chain_length += src->generated_chain_length;
    dst->inline_tlb_hit_loads += src->inline_tlb_hit_loads;
    dst->inline_tlb_hit_stores += src->inline_tlb_hit_stores;
    dst->helper_calls += src->helper_calls;
    dst->qemu_ld_calls += src->qemu_ld_calls;
    dst->qemu_st_calls += src->qemu_st_calls;
    dst->exits_budget += src->exits_budget;
    dst->exits_mmio += src->exits_mmio;
    dst->exits_tlb_miss_or_fault += src->exits_tlb_miss_or_fault;
    dst->exits_interrupt += src->exits_interrupt;
    dst->exits_helper += src->exits_helper;
    dst->exits_unsupported += src->exits_unsupported;
    dst->exits_hlt += src->exits_hlt;
    dst->exits_invalidated += src->exits_invalidated;
}

void tcg_wasm64_run_count_exit(TCGWasm64RunCounters *counters,
                               TCGWasm64RunExitReason reason)
{
    if (!counters) {
        return;
    }

    switch (reason) {
    case TCG_WASM64_RUN_EXIT_BUDGET:
        counters->exits_budget++;
        break;
    case TCG_WASM64_RUN_EXIT_MMIO:
        counters->exits_mmio++;
        break;
    case TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT:
        counters->exits_tlb_miss_or_fault++;
        break;
    case TCG_WASM64_RUN_EXIT_INTERRUPT:
        counters->exits_interrupt++;
        break;
    case TCG_WASM64_RUN_EXIT_HELPER:
        counters->exits_helper++;
        break;
    case TCG_WASM64_RUN_EXIT_UNSUPPORTED:
        counters->exits_unsupported++;
        break;
    case TCG_WASM64_RUN_EXIT_HLT:
        counters->exits_hlt++;
        break;
    case TCG_WASM64_RUN_EXIT_INVALIDATED:
        counters->exits_invalidated++;
        break;
    default:
        g_assert_not_reached();
    }
}

const char *tcg_wasm64_run_exit_reason_name(TCGWasm64RunExitReason reason)
{
    switch (reason) {
    case TCG_WASM64_RUN_EXIT_BUDGET:
        return "budget";
    case TCG_WASM64_RUN_EXIT_MMIO:
        return "mmio";
    case TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT:
        return "tlb-miss-or-fault";
    case TCG_WASM64_RUN_EXIT_INTERRUPT:
        return "interrupt";
    case TCG_WASM64_RUN_EXIT_HELPER:
        return "helper";
    case TCG_WASM64_RUN_EXIT_UNSUPPORTED:
        return "unsupported";
    case TCG_WASM64_RUN_EXIT_HLT:
        return "hlt";
    case TCG_WASM64_RUN_EXIT_INVALIDATED:
        return "invalidated";
    default:
        return "unknown";
    }
}

#ifdef CONFIG_EMSCRIPTEN
static char *tcg_wasm64_runloop_file_getenv(const char *name)
{
    g_autofree char *contents = NULL;
    const char *line;
    size_t name_len = strlen(name);

    if (!g_file_get_contents(TCG_WASM64_RUNLOOP_ENV_FILE, &contents,
                             NULL, NULL)) {
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

static bool tcg_wasm64_runloop_env_bool(const char *name)
{
#ifdef CONFIG_EMSCRIPTEN
    g_autofree char *owned = NULL;
    const char *raw = g_getenv(name);

    if (raw == NULL) {
        owned = tcg_wasm64_runloop_file_getenv(name);
        raw = owned;
    }

    return raw != NULL &&
           (g_strcmp0(raw, "1") == 0 ||
            g_ascii_strcasecmp(raw, "true") == 0 ||
            g_ascii_strcasecmp(raw, "yes") == 0 ||
            g_ascii_strcasecmp(raw, "on") == 0);
#else
    return false;
#endif
}

#ifdef CONFIG_EMSCRIPTEN
EM_JS(int, tcg_wasm64_runloop_smoke_js,
      (uintptr_t context_arg, uint64_t budget_arg), {
    if (typeof wasmMemory === "undefined" || !wasmMemory) {
        return 6;
    }

    const context = Number(context_arg);
    const budget = Number(budget_arg);
    const valueI32 = 0x7f;
    const valueI64 = 0x7e;
    const exitBudget = 1;

    function encodeU32(value) {
        const bytes = [];
        let current = Number(value) >>> 0;
        do {
            let byte = current & 0x7f;
            current >>>= 7;
            if (current !== 0) {
                byte |= 0x80;
            }
            bytes.push(byte);
        } while (current !== 0);
        return bytes;
    }

    function encodeS64(value) {
        let current = BigInt.asIntN(64, BigInt(value));
        const bytes = [];
        for (;;) {
            let byte = Number(current & 0x7fn);
            const sign = (byte & 0x40) !== 0;
            current >>= 7n;
            const done = (current === 0n && !sign) ||
                         (current === -1n && sign);
            if (!done) {
                byte |= 0x80;
            }
            bytes.push(byte);
            if (done) {
                return bytes;
            }
        }
    }

    function utf8Bytes(text) {
        return Array.from(new TextEncoder().encode(text));
    }

    function name(text) {
        const bytes = utf8Bytes(text);
        return [...encodeU32(bytes.length), ...bytes];
    }

    function vector(items) {
        return [...encodeU32(items.length), ...items.flat()];
    }

    function section(id, payload) {
        return [id, ...encodeU32(payload.length), ...payload];
    }

    function functionType(params, results) {
        return [
            0x60,
            ...vector(params.map((param) => [param])),
            ...vector(results.map((result) => [result])),
        ];
    }

    function functionBody(instructions, locals = []) {
        const body = [
            ...vector(locals.map(({ count, type }) =>
                [...encodeU32(count), type])),
            ...instructions,
            0x0b,
        ];
        return [...encodeU32(body.length), ...body];
    }

    function memArg(align, offset) {
        return [...encodeU32(align), ...encodeU32(offset)];
    }

    function localGet(index) {
        return [0x20, ...encodeU32(index)];
    }

    function localSet(index) {
        return [0x21, ...encodeU32(index)];
    }

    function i32Const(value) {
        return [0x41, ...encodeU32(value)];
    }

    function i64Const(value) {
        return [0x42, ...encodeS64(value)];
    }

    function i32LoadAtPtr(ptrLocal, offset) {
        return [...localGet(ptrLocal), 0x28, ...memArg(2, offset)];
    }

    function i64LoadAtPtr(ptrLocal, offset) {
        return [...localGet(ptrLocal), 0x29, ...memArg(3, offset)];
    }

    function i32StoreAtPtr(ptrLocal, offset, valueBytes) {
        return [...localGet(ptrLocal), ...valueBytes, 0x36, ...memArg(2, offset)];
    }

    function i64StoreAtPtr(ptrLocal, offset, valueBytes) {
        return [...localGet(ptrLocal), ...valueBytes, 0x37, ...memArg(3, offset)];
    }

    const remaining = 2;
    const state = 3;
    const countersPtr = 4;
    const guestRamPtr = 5;
    const exitPtr = 6;
    const value = 7;
    const generatedGuestInstructions = 8;
    const generatedChainLength = 9;
    const inlineLoads = 10;
    const inlineStores = 11;

    const instructions = [
        ...localGet(1),
        ...localSet(remaining),
        ...i32Const(0),
        ...localSet(state),
        ...i64LoadAtPtr(0, 24),
        ...localSet(countersPtr),
        ...i64LoadAtPtr(0, 8),
        ...localSet(guestRamPtr),
        ...i64LoadAtPtr(0, 32),
        ...localSet(exitPtr),
        ...i64LoadAtPtr(countersPtr, 0),
        ...localSet(generatedGuestInstructions),
        ...i64LoadAtPtr(countersPtr, 80),
        ...localSet(generatedChainLength),
        ...i64LoadAtPtr(countersPtr, 88),
        ...localSet(inlineLoads),
        ...i64LoadAtPtr(countersPtr, 96),
        ...localSet(inlineStores),
        ...i64LoadAtPtr(guestRamPtr, 0),
        ...localSet(value),

        0x02, 0x40,            /* block exit */
        0x03, 0x40,            /* loop dispatch */
        ...localGet(remaining),
        0x50,                  /* i64.eqz */
        0x0d, ...encodeU32(1), /* br_if exit */

        ...localGet(remaining),
        ...i64Const(1n),
        0x7d,                  /* i64.sub */
        ...localSet(remaining),

        ...localGet(state),
        0x45,                  /* i32.eqz */
        0x04, 0x40,            /* if tb0 */
        ...i64LoadAtPtr(guestRamPtr, 0),
        ...i64Const(1n),
        0x7c,                  /* i64.add */
        ...localSet(value),
        ...i64StoreAtPtr(guestRamPtr, 0, localGet(value)),
        ...i32Const(1),
        ...localSet(state),
        0x05,                  /* else tb1 */
        ...i64LoadAtPtr(guestRamPtr, 0),
        ...i64Const(0x5a5an),
        0x85,                  /* i64.xor */
        ...localSet(value),
        ...i64StoreAtPtr(guestRamPtr, 0, localGet(value)),
        ...i32Const(0),
        ...localSet(state),
        0x0b,                  /* end if */

        ...localGet(generatedGuestInstructions),
        ...i64Const(4n),
        0x7c,                  /* i64.add */
        ...localSet(generatedGuestInstructions),
        ...localGet(generatedChainLength),
        ...i64Const(1n),
        0x7c,                  /* i64.add */
        ...localSet(generatedChainLength),
        ...localGet(inlineLoads),
        ...i64Const(1n),
        0x7c,                  /* i64.add */
        ...localSet(inlineLoads),
        ...localGet(inlineStores),
        ...i64Const(1n),
        0x7c,                  /* i64.add */
        ...localSet(inlineStores),
        0x0c, ...encodeU32(0), /* br dispatch */
        0x0b,                  /* end loop */
        0x0b,                  /* end block */

        ...i64StoreAtPtr(countersPtr, 0, localGet(generatedGuestInstructions)),
        ...i64StoreAtPtr(countersPtr, 80, localGet(generatedChainLength)),
        ...i64StoreAtPtr(countersPtr, 88, localGet(inlineLoads)),
        ...i64StoreAtPtr(countersPtr, 96, localGet(inlineStores)),
        ...i32StoreAtPtr(exitPtr, 0, i32Const(exitBudget)),
        ...i32Const(exitBudget),
    ];

    const bytes = Uint8Array.from([
        0x00, 0x61, 0x73, 0x6d,
        0x01, 0x00, 0x00, 0x00,
        ...section(1, vector([
            functionType([valueI64, valueI64], [valueI32]),
        ])),
        ...section(2, vector([
            [
                ...name("env"), ...name("memory"),
                0x02, 0x07, 0x00, 0x80, 0x80, 0x10,
            ],
        ])),
        ...section(3, vector([[0x00]])),
        ...section(7, vector([
            [...name("wasmjit_run"), 0x00, ...encodeU32(0)],
        ])),
        ...section(10, vector([
            functionBody(instructions, [
                { count: 1, type: valueI64 },
                { count: 1, type: valueI32 },
                { count: 8, type: valueI64 },
            ]),
        ])),
    ]);

    try {
        const compileStart = performance.now();
        const module = new WebAssembly.Module(bytes);
        const compileNs = BigInt(Math.round((performance.now() - compileStart) * 1000000));
        const instantiateStart = performance.now();
        const instance = new WebAssembly.Instance(module, {
            env: { memory: wasmMemory },
        });
        const instantiateNs = BigInt(Math.round((performance.now() - instantiateStart) * 1000000));
        const bodyStart = performance.now();
        const exitReason = instance.exports.wasmjit_run(BigInt(context), BigInt(budget));
        const bodyNs = BigInt(Math.round((performance.now() - bodyStart) * 1000000));
        const counters = Number(HEAPU64[context / 8 + 3]);

        HEAPU64[counters / 8 + 2] = bodyNs;
        HEAPU64[counters / 8 + 8] = compileNs;
        HEAPU64[counters / 8 + 9] = instantiateNs;
        return Number(exitReason);
    } catch (error) {
        return 6;
    }
});
#endif

static void tcg_wasm64_report_runloop_smoke(const TCGWasm64RunCounters *counters,
                                            const TCGWasm64RunExit *exit,
                                            uint64_t budget, bool ok)
{
    TCGWasm64RunExitReason reason = exit && exit->reason ?
        (TCGWasm64RunExitReason)exit->reason : TCG_WASM64_RUN_EXIT_UNSUPPORTED;

    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"runtime-smoke\","
            "\"ok\":%s,"
            "\"budget\":%" PRIu64 ","
            "\"exit_reason\":\"%s\","
            "\"exit_reason_code\":%u,"
            "\"generated_guest_instructions\":%" PRIu64 ","
            "\"fallback_guest_instructions\":%" PRIu64 ","
            "\"generated_body_time_ns\":%" PRIu64 ","
            "\"tci_dispatch_time_ns\":%" PRIu64 ","
            "\"tb_lookup_time_ns\":%" PRIu64 ","
            "\"helper_call_time_ns\":%" PRIu64 ","
            "\"qemu_ld_time_ns\":%" PRIu64 ","
            "\"qemu_st_time_ns\":%" PRIu64 ","
            "\"compile_time_ns\":%" PRIu64 ","
            "\"instantiate_time_ns\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"inline_tlb_hit_loads\":%" PRIu64 ","
            "\"inline_tlb_hit_stores\":%" PRIu64 ","
            "\"helper_calls\":%" PRIu64 ","
            "\"qemu_ld_calls\":%" PRIu64 ","
            "\"qemu_st_calls\":%" PRIu64 ","
            "\"exits_budget\":%" PRIu64 ","
            "\"exits_mmio\":%" PRIu64 ","
            "\"exits_tlb_miss_or_fault\":%" PRIu64 ","
            "\"exits_interrupt\":%" PRIu64 ","
            "\"exits_helper\":%" PRIu64 ","
            "\"exits_unsupported\":%" PRIu64 ","
            "\"exits_hlt\":%" PRIu64 ","
            "\"exits_invalidated\":%" PRIu64 "}\n",
            ok ? "true" : "false",
            budget,
            tcg_wasm64_run_exit_reason_name(reason),
            exit ? exit->reason : 0,
            counters ? counters->generated_guest_instructions : 0,
            counters ? counters->fallback_guest_instructions : 0,
            counters ? counters->generated_body_time_ns : 0,
            counters ? counters->tci_dispatch_time_ns : 0,
            counters ? counters->tb_lookup_time_ns : 0,
            counters ? counters->helper_call_time_ns : 0,
            counters ? counters->qemu_ld_time_ns : 0,
            counters ? counters->qemu_st_time_ns : 0,
            counters ? counters->compile_time_ns : 0,
            counters ? counters->instantiate_time_ns : 0,
            counters ? counters->generated_chain_length : 0,
            counters ? counters->inline_tlb_hit_loads : 0,
            counters ? counters->inline_tlb_hit_stores : 0,
            counters ? counters->helper_calls : 0,
            counters ? counters->qemu_ld_calls : 0,
            counters ? counters->qemu_st_calls : 0,
            counters ? counters->exits_budget : 0,
            counters ? counters->exits_mmio : 0,
            counters ? counters->exits_tlb_miss_or_fault : 0,
            counters ? counters->exits_interrupt : 0,
            counters ? counters->exits_helper : 0,
            counters ? counters->exits_unsupported : 0,
            counters ? counters->exits_hlt : 0,
            counters ? counters->exits_invalidated : 0);
}

static void tcg_wasm64_runloop_smoke_maybe(CPUArchState *env)
{
    static bool checked;
    TCGWasm64RunCounters counters;
    TCGWasm64RunExit exit;
    uint64_t smoke_ram = 0;
    const uint64_t budget = TCG_WASM64_RUNLOOP_SMOKE_BUDGET;
    TCGWasm64RunContext context = {
        .env = env,
        .guest_ram = &smoke_ram,
        .budget = budget,
        .counters = &counters,
        .exit = &exit,
        .mode = TCG_WASM64_RUN_MODE_PERF_PROOF,
    };
    TCGWasm64RunExitReason reason = TCG_WASM64_RUN_EXIT_UNSUPPORTED;
    bool ok = false;

    if (checked) {
        return;
    }
    checked = true;
    if (!tcg_wasm64_runloop_env_bool("QEMU_WASM64_RUNLOOP_SMOKE")) {
        return;
    }

    tcg_wasm64_run_counters_reset(&counters);
    memset(&exit, 0, sizeof(exit));
#ifdef CONFIG_EMSCRIPTEN
    reason = (TCGWasm64RunExitReason)tcg_wasm64_runloop_smoke_js(
        (uintptr_t)&context, budget);
    if (exit.reason == 0) {
        exit.reason = reason;
    }
#endif
    tcg_wasm64_run_count_exit(&counters, reason);
    ok = reason == TCG_WASM64_RUN_EXIT_BUDGET &&
         counters.generated_guest_instructions == budget * 4 &&
         counters.generated_chain_length == budget &&
         counters.inline_tlb_hit_loads == budget &&
         counters.inline_tlb_hit_stores == budget &&
         counters.helper_calls == 0 &&
         counters.qemu_ld_calls == 0 &&
         counters.qemu_st_calls == 0;
    tcg_wasm64_report_runloop_smoke(&counters, &exit, budget, ok);
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
            "\"generated_exits\":{\"budget\":%" PRIu64 ","
            "\"mmio\":%" PRIu64 ",\"tlb_miss\":%" PRIu64 ","
            "\"interrupt\":%" PRIu64 ",\"csr\":%" PRIu64 ","
            "\"invalid\":%" PRIu64 ",\"invalidation\":%" PRIu64 ","
            "\"unsupported\":%" PRIu64 ",\"fatal\":%" PRIu64 "},"
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
            counters->generated_exits[TCG_WASM64_EXIT_BUDGET],
            counters->generated_exits[TCG_WASM64_EXIT_MMIO],
            counters->generated_exits[TCG_WASM64_EXIT_TLB_MISS],
            counters->generated_exits[TCG_WASM64_EXIT_INTERRUPT],
            counters->generated_exits[TCG_WASM64_EXIT_CSR],
            counters->generated_exits[TCG_WASM64_EXIT_INVALID],
            counters->generated_exits[TCG_WASM64_EXIT_INVALIDATION],
            counters->generated_exits[TCG_WASM64_EXIT_UNSUPPORTED],
            counters->generated_exits[TCG_WASM64_EXIT_FATAL],
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

    tcg_wasm64_runloop_smoke_maybe(env);

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
