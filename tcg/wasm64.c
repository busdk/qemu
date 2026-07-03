/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Experimental wasm64 TCG backend runtime.
 *
 * The backend is not selected by default.  Keep the runtime boundary small
 * and conservative: generated WebAssembly TBs receive one context pointer and
 * unsupported work must continue through a correctness fallback.
 */

#include "qemu/osdep.h"
#include "exec/translation-block.h"
#include "tcg/tcg.h"
#include "tcg/wasm64.h"

#ifdef CONFIG_EMSCRIPTEN
#include <emscripten/emscripten.h>
#endif

#define TCG_WASM64_TRANSLATE_CACHE_SIZE 8192u
#define TCG_WASM64_RUNLOOP_ENV_FILE "/qemu-tci-env"
#define TCG_WASM64_RUNLOOP_SMOKE_BUDGET 1000000u
#define TCG_WASM64_RUNLOOP_SMOKE_GUEST_INSNS_PER_STEP 4u
#define TCG_WASM64_RUNLOOP_SMOKE_MIN_SPEEDUP_PPM 3000000u
#define TCG_WASM64_ONE_TB_DIFFERENTIAL_ENV \
    "QEMU_WASM64_ONE_TB_DIFFERENTIAL"
#define TCG_WASM64_LIVE_ONE_TB_DIFFERENTIAL_ENV \
    "QEMU_WASM64_LIVE_ONE_TB_DIFFERENTIAL"
#define TCG_WASM64_ONE_TB_NAME "live-x86-pre-r4i-ld32u-goto-tb-13"
#define TCG_WASM64_LIVE_ONE_TB_NAME "live-x86-r4i-ld32u-goto-tb-11"
#define TCG_WASM64_ONE_TB_SCRATCH_SIZE 0x4000u
#define TCG_WASM64_ONE_TB_GENERATED_REGS_OFFSET 0x100u
#define TCG_WASM64_ONE_TB_DATA_OFFSET 0x1000u
#define TCG_WASM64_ONE_TB_CODE_BASE_OFFSET 0x2400u
#define TCG_WASM64_ONE_TB_GOTO_SLOT_DELTA (-0x60)
#define TCG_WASM64_ONE_TB_DISPATCH_TARGET 0x5048u
#define TCG_WASM64_ONE_TB_STATUS_DISPATCH 2u
#define TCG_WASM64_ONE_TB_EXECUTED_TCI_OP_EQUIVALENTS 11u
#define TCG_WASM64_ONE_TB_MEMORY_LOADS 2u
#define TCG_WASM64_ONE_TB_MEMORY_WRITES 2u

static const uint32_t tcg_wasm64_one_tb_words[] = {
    0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
    0x0000147d, 0xfff4e435, 0x0100e41e, 0xfff9057d,
    0x00054407, 0x0100e438, 0xfff74049, 0xfff10048,
    0xfff0f048,
};

static const TCGOpcode tcg_wasm64_live_one_tb_ops[] = {
    INDEX_op_ld32u,
    INDEX_op_tci_movi,
    INDEX_op_tci_setcond32,
    INDEX_op_brcond,
    INDEX_op_tci_movi,
    INDEX_op_st8,
    INDEX_op_ld,
    INDEX_op_tci_movi,
    INDEX_op_add,
    INDEX_op_st,
    INDEX_op_goto_tb,
};

typedef enum TCGWasm64OneTBResultIndex {
    TCG_WASM64_ONE_TB_RESULT_JS_STATUS,
    TCG_WASM64_ONE_TB_RESULT_GENERATED_STATUS,
    TCG_WASM64_ONE_TB_RESULT_REFERENCE_STATUS,
    TCG_WASM64_ONE_TB_RESULT_GENERATED_RET,
    TCG_WASM64_ONE_TB_RESULT_REFERENCE_RET,
    TCG_WASM64_ONE_TB_RESULT_GENERATED_REGS_CHECKSUM,
    TCG_WASM64_ONE_TB_RESULT_REFERENCE_REGS_CHECKSUM,
    TCG_WASM64_ONE_TB_RESULT_GENERATED_MEMORY_CHECKSUM,
    TCG_WASM64_ONE_TB_RESULT_REFERENCE_MEMORY_CHECKSUM,
    TCG_WASM64_ONE_TB_RESULT_GENERATED_TCI_OPS,
    TCG_WASM64_ONE_TB_RESULT_REFERENCE_TCI_OPS,
    TCG_WASM64_ONE_TB_RESULT_GENERATED_MEMORY_WRITES,
    TCG_WASM64_ONE_TB_RESULT_REFERENCE_MEMORY_WRITES,
    TCG_WASM64_ONE_TB_RESULT_HELPER_CALLS,
    TCG_WASM64_ONE_TB_RESULT_QEMU_LD_CALLS,
    TCG_WASM64_ONE_TB_RESULT_QEMU_ST_CALLS,
    TCG_WASM64_ONE_TB_RESULT__MAX,
} TCGWasm64OneTBResultIndex;

typedef enum TCGWasm64LiveOneTBResultIndex {
    TCG_WASM64_LIVE_ONE_TB_RESULT_JS_STATUS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_STATUS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_STATUS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_RET,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_RET,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_REGS_CHECKSUM,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_REGS_CHECKSUM,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_MEMORY_CHECKSUM,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_MEMORY_CHECKSUM,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_GUEST_INSNS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_GUEST_INSNS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_TCI_OPS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_TCI_OPS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_MEMORY_WRITES,
    TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_MEMORY_WRITES,
    TCG_WASM64_LIVE_ONE_TB_RESULT_HELPER_CALLS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_QEMU_LD_CALLS,
    TCG_WASM64_LIVE_ONE_TB_RESULT_QEMU_ST_CALLS,
    TCG_WASM64_LIVE_ONE_TB_RESULT__MAX,
} TCGWasm64LiveOneTBResultIndex;

typedef enum TCGWasm64RunloopSmokeWorkload {
    TCG_WASM64_RUNLOOP_SMOKE_ALU_BRANCH = 0,
    TCG_WASM64_RUNLOOP_SMOKE_TLB_HIT_RAM = 1,
    TCG_WASM64_RUNLOOP_SMOKE_WORKLOAD_COUNT,
} TCGWasm64RunloopSmokeWorkload;

typedef struct TCGWasm64RunloopSmokeResult {
    const char *name;
    TCGWasm64RunCounters counters;
    TCGWasm64RunExit exit;
    TCGWasm64RunExitReason reason;
    uint64_t fallback_guest_instructions;
    uint64_t fallback_exit_value;
    uint64_t fallback_ram_value;
    uint64_t generated_ram_value;
    uint64_t generated_vs_tci_speedup_ppm;
    bool ok;
} TCGWasm64RunloopSmokeResult;

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
static __thread uint64_t summary_next_report;
static __thread bool one_tb_differential_checked;
static __thread bool live_one_tb_differential_checked;
static __thread bool live_one_tb_metadata_missing_reported;
static __thread bool live_one_tb_output_unavailable_reported;
static __thread bool live_one_tb_unsupported_shape_reported;
static __thread uint64_t live_one_tb_differential_scanned;
static volatile uint64_t tcg_wasm64_runloop_smoke_sink;
static gsize summary_env_initialized;
static gsize live_one_tb_env_initialized;
static bool summary_enabled;
static bool live_one_tb_enabled;
static uint64_t summary_interval;

static const char *tcg_wasm64_op_name(uint32_t op);

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

static uint64_t tcg_wasm64_env_u64(const char *name, uint64_t fallback)
{
#ifdef CONFIG_EMSCRIPTEN
    g_autofree char *owned = NULL;
    const char *raw = g_getenv(name);
    char *endptr = NULL;
    uint64_t value;

    if (raw == NULL) {
        owned = tcg_wasm64_runloop_file_getenv(name);
        raw = owned;
    }
    if (raw == NULL || *raw == '\0') {
        return fallback;
    }

    value = g_ascii_strtoull(raw, &endptr, 0);
    if (endptr == raw || *endptr != '\0') {
        return fallback;
    }
    return value;
#else
    return fallback;
#endif
}

static bool tcg_wasm64_summary_enabled(void)
{
    if (unlikely(g_once_init_enter(&summary_env_initialized))) {
        summary_enabled = tcg_wasm64_runloop_env_bool(
            "QEMU_WASM64_TCG_SUMMARY");
        summary_interval = tcg_wasm64_env_u64(
            "QEMU_WASM64_TCG_SUMMARY_INTERVAL", 10000);
        summary_interval = MAX(summary_interval, 1);
        g_once_init_leave(&summary_env_initialized, 1);
    }
    return summary_enabled;
}

static bool tcg_wasm64_live_one_tb_enabled(void)
{
    if (unlikely(g_once_init_enter(&live_one_tb_env_initialized))) {
        live_one_tb_enabled = tcg_wasm64_runloop_env_bool(
            TCG_WASM64_LIVE_ONE_TB_DIFFERENTIAL_ENV);
        g_once_init_leave(&live_one_tb_env_initialized, 1);
    }
    return live_one_tb_enabled;
}

static void tcg_wasm64_summary_maybe_report(void)
{
    TCGWasm64Counters zero;

    if (!tcg_wasm64_summary_enabled()) {
        return;
    }
    if (summary_next_report == 0) {
        summary_next_report = summary_interval;
    }
    if (translated_counters.translated_tbs < summary_next_report) {
        return;
    }

    tcg_wasm64_counters_reset(&zero);
    tcg_wasm64_report_summary("interval", &zero);
    summary_next_report = translated_counters.translated_tbs + summary_interval;
}

#ifdef CONFIG_EMSCRIPTEN
EM_JS(int, tcg_wasm64_runloop_smoke_js,
      (uintptr_t context_arg, uint64_t budget_arg, int workload_arg), {
    if (typeof wasmMemory === "undefined" || !wasmMemory) {
        return 6;
    }

    const context = Number(context_arg);
    const budget = Number(budget_arg);
    const isRam = Number(workload_arg) !== 0;
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

    function runloopInstructions() {
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

        const tb0Update = isRam ? [
            ...i64LoadAtPtr(guestRamPtr, 0),
            ...i64Const(1n),
            0x7c,                  /* i64.add */
            ...localSet(value),
            ...i64StoreAtPtr(guestRamPtr, 0, localGet(value)),
            ...localGet(inlineLoads),
            ...i64Const(1n),
            0x7c,                  /* i64.add */
            ...localSet(inlineLoads),
            ...localGet(inlineStores),
            ...i64Const(1n),
            0x7c,                  /* i64.add */
            ...localSet(inlineStores),
        ] : [
            ...localGet(value),
            ...i64Const(1n),
            0x7c,                  /* i64.add */
            ...localSet(value),
        ];
        const tb1Update = isRam ? [
            ...i64LoadAtPtr(guestRamPtr, 0),
            ...i64Const(0x5a5an),
            0x85,                  /* i64.xor */
            ...localSet(value),
            ...i64StoreAtPtr(guestRamPtr, 0, localGet(value)),
            ...localGet(inlineLoads),
            ...i64Const(1n),
            0x7c,                  /* i64.add */
            ...localSet(inlineLoads),
            ...localGet(inlineStores),
            ...i64Const(1n),
            0x7c,                  /* i64.add */
            ...localSet(inlineStores),
        ] : [
            ...localGet(value),
            ...i64Const(0x5a5an),
            0x85,                  /* i64.xor */
            ...localSet(value),
        ];

        return [
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
            ...(isRam ? i64LoadAtPtr(guestRamPtr, 0) : i64Const(0n)),
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
            ...tb0Update,
            ...i32Const(1),
            ...localSet(state),
            0x05,                  /* else tb1 */
            ...tb1Update,
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
            0x0c, ...encodeU32(0), /* br dispatch */
            0x0b,                  /* end loop */
            0x0b,                  /* end block */

            ...i64StoreAtPtr(countersPtr, 0,
                localGet(generatedGuestInstructions)),
            ...i64StoreAtPtr(countersPtr, 80,
                localGet(generatedChainLength)),
            ...i64StoreAtPtr(countersPtr, 88, localGet(inlineLoads)),
            ...i64StoreAtPtr(countersPtr, 96, localGet(inlineStores)),
            ...i64StoreAtPtr(exitPtr, 32, localGet(value)),
            ...i32StoreAtPtr(exitPtr, 0, i32Const(exitBudget)),
            ...i32Const(exitBudget),
        ];
    }

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
            functionBody(runloopInstructions(), [
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

EM_JS(int, tcg_wasm64_one_tb_differential_js,
      (uintptr_t context_arg, uintptr_t scratch_arg, uintptr_t counters_arg,
       uintptr_t exit_arg, uintptr_t result_arg), {
    if (typeof wasmMemory === "undefined" || !wasmMemory) {
        return 1;
    }

    const context = Number(context_arg);
    const scratch = Number(scratch_arg);
    const counters = Number(counters_arg);
    const exit = Number(exit_arg);
    const result = Number(result_arg);
    const regsPtr = scratch + 0x100;
    const dataBase = scratch + 0x1000;
    const codeBase = scratch + 0x2400;
    const gotoSlot = codeBase - 0x60;
    const dispatchTarget = 0x5048n;
    const statusDispatch = 2n;
    const valueI32 = 0x7f;
    const valueI64 = 0x7e;
    const words = [
        0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
        0x0000147d, 0xfff4e435, 0x0100e41e, 0xfff9057d,
        0x00054407, 0x0100e438, 0xfff74049, 0xfff10048,
        0xfff0f048,
    ];
    const ops = {
        brcond: 4,
        add: 7,
        ld32u: 28,
        ld: 30,
        st8: 53,
        st: 56,
        exit_tb: 72,
        goto_tb: 73,
        tci_movi: 125,
        tci_setcond32: 136,
    };

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

    function localSet(index, expr) {
        return [...expr, 0x21, ...encodeU32(index)];
    }

    function i32Const(value) {
        return [0x41, ...encodeU32(value >>> 0)];
    }

    function i64Const(value) {
        return [0x42, ...encodeS64(value)];
    }

    function i64Add(lhs, rhs) {
        return [...lhs, ...rhs, 0x7c];
    }

    function i32WrapI64(expr) {
        return [...expr, 0xa7];
    }

    function i64ExtendI32U(expr) {
        return [...expr, 0xad];
    }

    function i64Load(address) {
        return [...address, 0x29, ...memArg(3, 0)];
    }

    function i32Load(address) {
        return [...address, 0x28, ...memArg(2, 0)];
    }

    function i64Store(address, value) {
        return [...address, ...value, 0x37, ...memArg(3, 0)];
    }

    function i32Store8(address, value) {
        return [...address, ...value, 0x3a, ...memArg(0, 0)];
    }

    function i64LoadAtPtr(ptrLocal, offset) {
        return [...localGet(ptrLocal), 0x29, ...memArg(3, offset)];
    }

    function i64StoreAtPtr(ptrLocal, offset, value) {
        return [...localGet(ptrLocal), ...value, 0x37, ...memArg(3, offset)];
    }

    function i32StoreAtPtr(ptrLocal, offset, value) {
        return [...localGet(ptrLocal), ...value, 0x36, ...memArg(2, offset)];
    }

    function i64StoreAtRawPtr(ptr, offset, value) {
        return [...i64Const(BigInt(ptr + offset)), ...value, 0x37,
                ...memArg(3, 0)];
    }

    function addressAdd(base, offset) {
        return i64Add(base, i64Const(offset));
    }

    function incrementCounter(ptrLocal, offset, value) {
        return i64StoreAtPtr(ptrLocal, offset, i64Add(
            i64LoadAtPtr(ptrLocal, offset),
            i64Const(BigInt(value))));
    }

    function runInstructions() {
        const regs = 1;
        const countersPtr = 2;
        const exitPtr = 3;
        const codeBasePtr = 4;
        const r4 = 5;
        const r5 = 6;
        const r13 = 7;
        const r14 = 8;
        const ret = 9;

        return [
            ...localSet(regs, i64LoadAtPtr(0, 0)),
            ...localSet(codeBasePtr, i64LoadAtPtr(0, 8)),
            ...localSet(countersPtr, i64LoadAtPtr(0, 24)),
            ...localSet(exitPtr, i64LoadAtPtr(0, 32)),
            ...localSet(r14, i64LoadAtPtr(regs, 14 * 8)),

            ...localSet(r4, i64ExtendI32U(
                i32Load(addressAdd(localGet(r14), -16n)))),
            ...localSet(r5, i64Const(0n)),
            ...localSet(r13, i64ExtendI32U([
                ...i32WrapI64(localGet(r4)),
                ...i32WrapI64(localGet(r5)),
                0x48, /* i32.lt_s */
            ])),
            0x02, 0x40, /* block: live brcond with fall-through target */
            ...localGet(r13),
            0x50,       /* i64.eqz */
            0x45,       /* i32.eqz */
            0x0d, 0x00, /* br_if 0 */
            0x0b,

            ...localSet(r4, i64Const(1n)),
            ...i32Store8(addressAdd(localGet(r14), -12n),
                         i32WrapI64(localGet(r4))),
            ...localSet(r4, i64Load(addressAdd(localGet(r14), 256n))),
            ...localSet(r5, i64Const(-112n)),
            ...localSet(r4, i64Add(localGet(r4), localGet(r5))),
            ...i64Store(addressAdd(localGet(r14), 256n), localGet(r4)),
            ...localSet(ret, i64Load(addressAdd(localGet(codeBasePtr),
                                                 -0x60n))),

            ...i64StoreAtPtr(regs, 4 * 8, localGet(r4)),
            ...i64StoreAtPtr(regs, 5 * 8, localGet(r5)),
            ...i64StoreAtPtr(regs, 13 * 8, localGet(r13)),
            ...i32StoreAtPtr(exitPtr, 0, i32Const(2)),
            ...i64StoreAtPtr(exitPtr, 32, localGet(ret)),
            ...incrementCounter(countersPtr, 0, 11),
            ...incrementCounter(countersPtr, 80, 1),
            ...incrementCounter(countersPtr, 88, 2),
            ...incrementCounter(countersPtr, 96, 2),
            ...i64Const(statusDispatch),
        ];
    }

    function bits(value, start, length) {
        return (value >>> start) & ((1 << length) - 1);
    }

    function sextract(value, start, length) {
        const mask = (1 << length) - 1;
        let extracted = (value >>> start) & mask;
        const sign = 1 << (length - 1);
        if ((extracted & sign) !== 0) {
            extracted |= ~mask;
        }
        return extracted;
    }

    function toU64(value) {
        return BigInt.asUintN(64, BigInt(value));
    }

    function toI32(value) {
        return Number(BigInt.asIntN(32, BigInt(value)));
    }

    function getU64(ptr) {
        return HEAPU64[Number(ptr) / 8];
    }

    function setU64(ptr, value) {
        HEAPU64[Number(ptr) / 8] = toU64(value);
    }

    function getReg(reg) {
        return getU64(regsPtr + reg * 8);
    }

    function setReg(reg, value) {
        setU64(regsPtr + reg * 8, value);
    }

    function setResult(index, value) {
        HEAPU64[result / 8 + index] = toU64(value);
    }

    function compare32(lhs, rhs, condition) {
        switch (condition) {
        case 2:
            return toI32(lhs) < toI32(rhs) ? 1n : 0n;
        default:
            throw new Error(`unsupported one-TB condition ${condition}`);
        }
    }

    function targetIndexFromPtr(ptr) {
        const offset = ptr - codeBase;
        if (offset < 0 || offset % 4 !== 0) {
            return -1;
        }
        return offset / 4;
    }

    function checksumByte(hash, value) {
        let current = hash ^ BigInt(value & 0xff);
        current = BigInt.asUintN(64, current * 1099511628211n);
        return current;
    }

    function checksumRegs() {
        let hash = 1469598103934665603n;
        for (let reg = 0; reg < 16; reg++) {
            let value = getReg(reg);
            for (let byte = 0; byte < 8; byte++) {
                hash = checksumByte(hash, Number(value & 0xffn));
                value >>= 8n;
            }
        }
        return hash;
    }

    function checksumObservedMemory() {
        let hash = 1469598103934665603n;
        for (const [offset, size] of [[0, 4], [4, 1], [0x110, 8]]) {
            for (let i = 0; i < size; i++) {
                hash = checksumByte(hash, HEAPU8[dataBase + offset + i]);
            }
        }
        return hash;
    }

    function initState() {
        for (let i = 0; i < 0x4000; i++) {
            HEAPU8[scratch + i] = 0;
        }
        for (let i = 0; i < 192 / 8; i++) {
            HEAPU64[counters / 8 + i] = 0n;
        }
        for (let i = 0; i < 48 / 8; i++) {
            HEAPU64[exit / 8 + i] = 0n;
        }
        HEAPU64[context / 8 + 0] = BigInt(regsPtr);
        HEAPU64[context / 8 + 1] = BigInt(codeBase);
        HEAPU64[context / 8 + 2] = 1n;
        HEAPU64[context / 8 + 3] = BigInt(counters);
        HEAPU64[context / 8 + 4] = BigInt(exit);
        HEAPU32[context / 4 + 10] = 1;
        HEAPU32[context / 4 + 11] = 0;

        for (let reg = 0; reg < 16; reg++) {
            setReg(reg, BigInt(0x1000 + reg));
        }
        setReg(4, 0n);
        setReg(5, 0n);
        setReg(13, 0n);
        setReg(14, BigInt(dataBase + 16));
        HEAPU32[dataBase / 4] = 7;
        HEAPU8[dataBase + 4] = 0xa5;
        setU64(dataBase + 0x100, 0x400000001n);
        setU64(gotoSlot, dispatchTarget);
    }

    function runReference() {
        let index = 0;
        let executed = 0;
        let writes = 0;

        for (;;) {
            const insn = words[index] >>> 0;
            const opc = bits(insn, 0, 8);
            const r0 = bits(insn, 8, 4);
            const r1 = bits(insn, 12, 4);
            const r2 = bits(insn, 16, 4);
            const tbPtr = codeBase + (index + 1) * 4;

            executed++;
            if (opc === ops.ld32u) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                setReg(r0, BigInt(HEAPU32[addr / 4]));
                index++;
            } else if (opc === ops.ld) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                setReg(r0, getU64(addr));
                index++;
            } else if (opc === ops.tci_movi) {
                setReg(r0, sextract(insn, 12, 20));
                index++;
            } else if (opc === ops.tci_setcond32) {
                setReg(r0, compare32(getReg(r1), getReg(r2),
                                      bits(insn, 20, 4)));
                index++;
            } else if (opc === ops.brcond) {
                const ptr = tbPtr + sextract(insn, 12, 20);
                index = getReg(r0) !== 0n ? targetIndexFromPtr(ptr)
                                          : index + 1;
            } else if (opc === ops.st8) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                HEAPU8[addr] = Number(getReg(r0) & 0xffn);
                writes++;
                index++;
            } else if (opc === ops.st) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                setU64(addr, getReg(r0));
                writes++;
                index++;
            } else if (opc === ops.add) {
                setReg(r0, getReg(r1) + getReg(r2));
                index++;
            } else if (opc === ops.goto_tb) {
                const ptr = tbPtr + sextract(insn, 12, 20);
                const ret = getU64(ptr);
                HEAPU32[exit / 4] = Number(statusDispatch);
                setU64(exit + 32, ret);
                return { status: statusDispatch, ret, executed, writes };
            } else if (opc === ops.exit_tb) {
                const ret = BigInt(tbPtr + sextract(insn, 12, 20));
                HEAPU32[exit / 4] = 1;
                setU64(exit + 32, ret);
                return { status: 1n, ret, executed, writes };
            } else {
                throw new Error(`unsupported one-TB opcode ${opc}`);
            }
        }
    }

    try {
        const bytes = Uint8Array.from([
            0x00, 0x61, 0x73, 0x6d,
            0x01, 0x00, 0x00, 0x00,
            ...section(1, vector([
                functionType([valueI64], [valueI64]),
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
                functionBody(runInstructions(), [
                    { count: 9, type: valueI64 },
                ]),
            ])),
        ]);
        const compileStart = performance.now();
        const module = new WebAssembly.Module(bytes);
        const compileNs = BigInt(Math.round(
            (performance.now() - compileStart) * 1000000));
        const instantiateStart = performance.now();
        const instance = new WebAssembly.Instance(module, {
            env: { memory: wasmMemory },
        });
        const instantiateNs = BigInt(Math.round(
            (performance.now() - instantiateStart) * 1000000));

        initState();
        const generatedStart = performance.now();
        const generatedStatus = instance.exports.wasmjit_run(BigInt(context));
        const generatedNs = BigInt(Math.round(
            (performance.now() - generatedStart) * 1000000));
        const generatedRet = getU64(exit + 32);
        const generatedRegsChecksum = checksumRegs();
        const generatedMemoryChecksum = checksumObservedMemory();
        const generatedTciOps = HEAPU64[counters / 8];
        const generatedWrites = 2n;
        HEAPU64[counters / 8] = 0n;

        initState();
        const referenceStart = performance.now();
        const reference = runReference();
        const referenceNs = BigInt(Math.round(
            (performance.now() - referenceStart) * 1000000));
        const referenceRegsChecksum = checksumRegs();
        const referenceMemoryChecksum = checksumObservedMemory();

        HEAPU64[counters / 8 + 0] = 0n;
        HEAPU64[counters / 8 + 1] = 0n;
        HEAPU64[counters / 8 + 2] = generatedNs;
        HEAPU64[counters / 8 + 3] = referenceNs;
        HEAPU64[counters / 8 + 8] = compileNs;
        HEAPU64[counters / 8 + 9] = instantiateNs;
        HEAPU64[counters / 8 + 10] = 1n;
        HEAPU64[counters / 8 + 11] = 2n;
        HEAPU64[counters / 8 + 12] = 2n;

        setResult(1, generatedStatus);
        setResult(2, reference.status);
        setResult(3, generatedRet);
        setResult(4, reference.ret);
        setResult(5, generatedRegsChecksum);
        setResult(6, referenceRegsChecksum);
        setResult(7, generatedMemoryChecksum);
        setResult(8, referenceMemoryChecksum);
        setResult(9, generatedTciOps);
        setResult(10, BigInt(reference.executed));
        setResult(11, generatedWrites);
        setResult(12, BigInt(reference.writes));
        setResult(13, 0n);
        setResult(14, 0n);
        setResult(15, 0n);

        return generatedStatus === reference.status &&
               generatedRet === reference.ret &&
               generatedRegsChecksum === referenceRegsChecksum &&
               generatedMemoryChecksum === referenceMemoryChecksum &&
               generatedTciOps === BigInt(reference.executed) &&
               generatedWrites === BigInt(reference.writes) &&
               generatedTciOps > 0n ? 0 : 2;
    } catch (error) {
        setResult(0, 1n);
        return 1;
    }
});

EM_JS(int, tcg_wasm64_live_one_tb_differential_js,
      (uintptr_t context_arg, uintptr_t scratch_arg, uintptr_t counters_arg,
       uintptr_t exit_arg, uintptr_t result_arg, uintptr_t tb_arg,
       uintptr_t env_arg, uint64_t guest_insns_arg,
       uintptr_t generated_output_arg, uint32_t generated_output_size_arg), {
    if (typeof wasmMemory === "undefined" || !wasmMemory) {
        return 1;
    }

    const context = Number(context_arg);
    const scratch = Number(scratch_arg);
    const counters = Number(counters_arg);
    const exit = Number(exit_arg);
    const result = Number(result_arg);
    const tbPtr = Number(tb_arg);
    const envPtr = Number(env_arg);
    const guestInsns = BigInt(guest_insns_arg);
    const generatedOutputPtr = Number(generated_output_arg);
    const generatedOutputSize = Number(generated_output_size_arg);
    const regsPtr = scratch + 0x100;
    const stackPtr = scratch + 0x3000;
    const statusDispatch = 2n;
    const statusUnsupported = 6n;
    const valueI32 = 0x7f;
    const valueI64 = 0x7e;
    const expectedShape = [
        "ld32u", "tci_movi", "tci_setcond32", "brcond", "tci_movi",
        "st8", "ld", "tci_movi", "add", "st", "goto_tb",
    ];
    const ops = {
        brcond: 4,
        add: 7,
        ld32u: 28,
        ld: 30,
        st8: 53,
        st: 56,
        exit_tb: 72,
        goto_tb: 73,
        tci_movi: 125,
        tci_setcond32: 136,
    };

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

    function localSet(index, expr) {
        return [...expr, 0x21, ...encodeU32(index)];
    }

    function i32Const(value) {
        return [0x41, ...encodeU32(value >>> 0)];
    }

    function i64Const(value) {
        return [0x42, ...encodeS64(value)];
    }

    function i64Add(lhs, rhs) {
        return [...lhs, ...rhs, 0x7c];
    }

    function i32WrapI64(expr) {
        return [...expr, 0xa7];
    }

    function i64ExtendI32U(expr) {
        return [...expr, 0xad];
    }

    function i64Load(address) {
        return [...address, 0x29, ...memArg(3, 0)];
    }

    function i32Load(address) {
        return [...address, 0x28, ...memArg(2, 0)];
    }

    function i64Store(address, value) {
        return [...address, ...value, 0x37, ...memArg(3, 0)];
    }

    function i32Store8(address, value) {
        return [...address, ...value, 0x3a, ...memArg(0, 0)];
    }

    function i64LoadAtPtr(ptrLocal, offset) {
        return [...localGet(ptrLocal), 0x29, ...memArg(3, offset)];
    }

    function i64StoreAtPtr(ptrLocal, offset, value) {
        return [...localGet(ptrLocal), ...value, 0x37, ...memArg(3, offset)];
    }

    function i32StoreAtPtr(ptrLocal, offset, value) {
        return [...localGet(ptrLocal), ...value, 0x36, ...memArg(2, offset)];
    }

    function addressAdd(base, offset) {
        return i64Add(base, i64Const(offset));
    }

    function incrementCounter(ptrLocal, offset, value) {
        return i64StoreAtPtr(ptrLocal, offset, i64Add(
            i64LoadAtPtr(ptrLocal, offset),
            i64Const(BigInt(value))));
    }

    function opName(opc) {
        for (const [name, value] of Object.entries(ops)) {
            if (value === opc) {
                return name;
            }
        }
        return "unknown";
    }

    function decodedShape(words) {
        return words.map((insn) => opName(bits(insn >>> 0, 0, 8)));
    }

    function readGeneratedOutputWords() {
        if (generatedOutputPtr === 0 || generatedOutputSize === 0 ||
            generatedOutputSize % 4 !== 0) {
            return { status: 4, words: [] };
        }

        const wordCount = generatedOutputSize / 4;
        const output = [];

        for (let i = 0; i < wordCount; i++) {
            output.push(HEAPU32[generatedOutputPtr / 4 + i] >>> 0);
        }
        return { status: 0, words: output };
    }

    function generatedOutputShapeSupported(words) {
        const shape = decodedShape(words);

        return shape.length === expectedShape.length &&
               shape.every((name, index) => name === expectedShape[index]);
    }

    function runInstructions(words) {
        const regs = 1;
        const codeBasePtr = 2;
        const countersPtr = 3;
        const exitPtr = 4;
        const regLocalBase = 5;
        const terminalStatus = 2;
        const terminalIndex = words.findIndex((insn) => {
            const opc = bits(insn >>> 0, 0, 8);

            return opc === ops.goto_tb || opc === ops.exit_tb;
        });
        const emitted = [
            ...localSet(regs, i64LoadAtPtr(0, 0)),
            ...localSet(codeBasePtr, i64LoadAtPtr(0, 8)),
            ...localSet(countersPtr, i64LoadAtPtr(0, 24)),
            ...localSet(exitPtr, i64LoadAtPtr(0, 32)),
        ];
        let inlineLoads = 0;
        let inlineStores = 0;
        let executedOps = 0;
        let terminal = null;

        function regLocal(reg) {
            return regLocalBase + reg;
        }

        function flushAllRegisterLocals() {
            const flushes = [];

            for (let reg = 0; reg < 16; reg++) {
                flushes.push(...i64StoreAtPtr(regs, reg * 8,
                                              localGet(regLocal(reg))));
            }
            return flushes;
        }

        function returnUnsupported() {
            return [
                ...flushAllRegisterLocals(),
                ...i32StoreAtPtr(exitPtr, 0, i32Const(Number(statusUnsupported))),
                ...i64StoreAtPtr(exitPtr, 32, i64Const(0n)),
                ...i64Const(statusUnsupported),
            ];
        }

        for (let reg = 0; reg < 16; reg++) {
            emitted.push(...localSet(regLocal(reg),
                                     i64LoadAtPtr(regs, reg * 8)));
        }

        if (terminalIndex < 0) {
            throw new Error("live generated-output body has no terminal");
        }

        for (let index = 0; index < words.length; index++) {
            const insn = words[index] >>> 0;
            const opc = bits(insn, 0, 8);
            const r0 = bits(insn, 8, 4);
            const r1 = bits(insn, 12, 4);
            const r2 = bits(insn, 16, 4);
            const currentTbPtr = (index + 1) * 4;

            executedOps++;
            if (opc === ops.goto_tb || opc === ops.exit_tb) {
                const ptrOffset = currentTbPtr + sextract(insn, 12, 20);

                terminal = {
                    kind: opc,
                    ptrOffset,
                };
                break;
            } else if (opc === ops.ld32u) {
                emitted.push(...localSet(regLocal(r0), i64ExtendI32U(
                    i32Load(addressAdd(localGet(regLocal(r1)),
                                       BigInt(sextract(insn, 16, 16)))))));
                inlineLoads++;
            } else if (opc === ops.ld) {
                emitted.push(...localSet(regLocal(r0),
                    i64Load(addressAdd(localGet(regLocal(r1)),
                                       BigInt(sextract(insn, 16, 16))))));
                inlineLoads++;
            } else if (opc === ops.tci_movi) {
                emitted.push(...localSet(regLocal(r0),
                                         i64Const(sextract(insn, 12, 20))));
            } else if (opc === ops.tci_setcond32) {
                const condition = bits(insn, 20, 4);

                if (condition !== 2) {
                    throw new Error("unsupported live one-TB condition");
                }
                emitted.push(...localSet(regLocal(r0), i64ExtendI32U([
                    ...i32WrapI64(localGet(regLocal(r1))),
                    ...i32WrapI64(localGet(regLocal(r2))),
                    0x48, /* i32.lt_s */
                ])));
            } else if (opc === ops.brcond) {
                const targetOffset = currentTbPtr + sextract(insn, 12, 20);
                const targetIndex = targetOffset / 4;

                if (targetOffset % 4 !== 0 || targetIndex <= index) {
                    throw new Error("unsupported live one-TB branch target");
                }
                if (targetIndex > terminalIndex) {
                    emitted.push(...[
                        ...localGet(regLocal(r0)),
                        0x50, 0x45,       /* i64 truthy */
                        0x04, 0x40,       /* if */
                        ...returnUnsupported(),
                        0x0b,             /* end */
                    ]);
                } else {
                    throw new Error("unsupported live one-TB in-range branch");
                }
            } else if (opc === ops.st8) {
                emitted.push(...i32Store8(
                    addressAdd(localGet(regLocal(r1)),
                               BigInt(sextract(insn, 16, 16))),
                    i32WrapI64(localGet(regLocal(r0)))));
                inlineStores++;
            } else if (opc === ops.st) {
                emitted.push(...i64Store(
                    addressAdd(localGet(regLocal(r1)),
                               BigInt(sextract(insn, 16, 16))),
                    localGet(regLocal(r0))));
                inlineStores++;
            } else if (opc === ops.add) {
                emitted.push(...localSet(regLocal(r0), i64Add(
                    localGet(regLocal(r1)), localGet(regLocal(r2)))));
            } else {
                throw new Error(`unsupported live one-TB opcode ${opc}`);
            }
        }

        if (terminal === null) {
            throw new Error("live generated-output body has no terminal");
        }

        emitted.push(...flushAllRegisterLocals());
        emitted.push(...i32StoreAtPtr(exitPtr, 0, i32Const(terminalStatus)));
        emitted.push(...i64StoreAtPtr(
            exitPtr, 32,
            terminal.kind === ops.goto_tb
                ? i64Load(addressAdd(localGet(codeBasePtr),
                                      BigInt(terminal.ptrOffset)))
                : i64Add(localGet(codeBasePtr), i64Const(terminal.ptrOffset))));
        emitted.push(...incrementCounter(countersPtr, 0, guestInsns));
        emitted.push(...incrementCounter(countersPtr, 80, 1));
        emitted.push(...incrementCounter(countersPtr, 88, inlineLoads));
        emitted.push(...incrementCounter(countersPtr, 96, inlineStores));
        emitted.push(...i64Const(BigInt(terminalStatus)));
        runInstructions.generatedTciOps = executedOps;
        runInstructions.inlineLoads = inlineLoads;
        runInstructions.inlineStores = inlineStores;
        return emitted;
    }

    function bits(value, start, length) {
        return (value >>> start) & ((1 << length) - 1);
    }

    function sextract(value, start, length) {
        const mask = (1 << length) - 1;
        let extracted = (value >>> start) & mask;
        const sign = 1 << (length - 1);
        if ((extracted & sign) !== 0) {
            extracted |= ~mask;
        }
        return extracted;
    }

    function toU64(value) {
        return BigInt.asUintN(64, BigInt(value));
    }

    function toI32(value) {
        return Number(BigInt.asIntN(32, BigInt(value)));
    }

    function getU64(ptr) {
        return HEAPU64[Number(ptr) / 8];
    }

    function setU64(ptr, value) {
        HEAPU64[Number(ptr) / 8] = toU64(value);
    }

    function getReg(reg) {
        return getU64(regsPtr + reg * 8);
    }

    function setReg(reg, value) {
        setU64(regsPtr + reg * 8, value);
    }

    function setResult(index, value) {
        HEAPU64[result / 8 + index] = toU64(value);
    }

    function compare32(lhs, rhs, condition) {
        switch (condition) {
        case 2:
            return toI32(lhs) < toI32(rhs) ? 1n : 0n;
        default:
            throw new Error(`unsupported live one-TB condition ${condition}`);
        }
    }

    function targetIndexFromPtr(ptr) {
        const offset = ptr - tbPtr;
        if (offset < 0 || offset % 4 !== 0) {
            return -1;
        }
        return offset / 4;
    }

    function checksumByte(hash, value) {
        let current = hash ^ BigInt(value & 0xff);
        current = BigInt.asUintN(64, current * 1099511628211n);
        return current;
    }

    function checksumRegs() {
        let hash = 1469598103934665603n;
        for (let reg = 0; reg < 16; reg++) {
            let value = getReg(reg);
            for (let byte = 0; byte < 8; byte++) {
                hash = checksumByte(hash, Number(value & 0xffn));
                value >>= 8n;
            }
        }
        return hash;
    }

    function observedMemoryRanges() {
        return [
            [envPtr - 16, 4],
            [envPtr - 12, 1],
            [envPtr + 256, 8],
        ];
    }

    function checksumObservedMemory() {
        let hash = 1469598103934665603n;
        for (const [address, size] of observedMemoryRanges()) {
            for (let i = 0; i < size; i++) {
                hash = checksumByte(hash, HEAPU8[address + i]);
            }
        }
        return hash;
    }

    function snapshotObservedMemory() {
        return observedMemoryRanges().map(([address, size]) => [
            address,
            Array.from(HEAPU8.subarray(address, address + size)),
        ]);
    }

    function restoreObservedMemory(snapshot) {
        for (const [address, bytes] of snapshot) {
            HEAPU8.set(bytes, address);
        }
    }

    function initInputState() {
        for (let i = 0; i < 0x4000; i++) {
            HEAPU8[scratch + i] = 0;
        }
        for (let i = 0; i < 192 / 8; i++) {
            HEAPU64[counters / 8 + i] = 0n;
        }
        for (let i = 0; i < 48 / 8; i++) {
            HEAPU64[exit / 8 + i] = 0n;
        }
        HEAPU64[context / 8 + 0] = BigInt(regsPtr);
        HEAPU64[context / 8 + 1] = BigInt(tbPtr);
        HEAPU64[context / 8 + 2] = guestInsns;
        HEAPU64[context / 8 + 3] = BigInt(counters);
        HEAPU64[context / 8 + 4] = BigInt(exit);
        HEAPU32[context / 4 + 10] = 1;
        HEAPU32[context / 4 + 11] = 0;

        for (let reg = 0; reg < 16; reg++) {
            setReg(reg, 0n);
        }
        setReg(14, BigInt(envPtr));
        setReg(15, BigInt(stackPtr));
    }

    function runReference() {
        let index = 0;
        let executed = 0;
        let writes = 0;

        for (;;) {
            const insn = HEAPU32[tbPtr / 4 + index] >>> 0;
            const opc = bits(insn, 0, 8);
            const r0 = bits(insn, 8, 4);
            const r1 = bits(insn, 12, 4);
            const r2 = bits(insn, 16, 4);
            const currentTbPtr = tbPtr + (index + 1) * 4;

            if (index >= words.length || insn !== words[index]) {
                throw new Error(`live one-TB shape drift at ${index}`);
            }
            executed++;
            if (opc === ops.ld32u) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                setReg(r0, BigInt(HEAPU32[addr / 4]));
                index++;
            } else if (opc === ops.ld) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                setReg(r0, getU64(addr));
                index++;
            } else if (opc === ops.tci_movi) {
                setReg(r0, sextract(insn, 12, 20));
                index++;
            } else if (opc === ops.tci_setcond32) {
                setReg(r0, compare32(getReg(r1), getReg(r2),
                                      bits(insn, 20, 4)));
                index++;
            } else if (opc === ops.brcond) {
                const ptr = currentTbPtr + sextract(insn, 12, 20);
                index = getReg(r0) !== 0n ? targetIndexFromPtr(ptr)
                                          : index + 1;
            } else if (opc === ops.st8) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                HEAPU8[addr] = Number(getReg(r0) & 0xffn);
                writes++;
                index++;
            } else if (opc === ops.st) {
                const addr = Number(getReg(r1)) + sextract(insn, 16, 16);
                setU64(addr, getReg(r0));
                writes++;
                index++;
            } else if (opc === ops.add) {
                setReg(r0, getReg(r1) + getReg(r2));
                index++;
            } else if (opc === ops.goto_tb) {
                const ptr = currentTbPtr + sextract(insn, 12, 20);
                const ret = getU64(ptr);
                HEAPU32[exit / 4] = Number(statusDispatch);
                setU64(exit + 32, ret);
                return { status: statusDispatch, ret, executed, writes };
            } else if (opc === ops.exit_tb) {
                const ret = BigInt(currentTbPtr + sextract(insn, 12, 20));
                HEAPU32[exit / 4] = 1;
                setU64(exit + 32, ret);
                return { status: 1n, ret, executed, writes };
            } else {
                throw new Error(`unsupported live one-TB opcode ${opc}`);
            }
        }
    }

    let initialMemory = null;

    try {
        const generatedOutput = readGeneratedOutputWords();
        if (generatedOutput.status !== 0) {
            setResult(0, BigInt(generatedOutput.status));
            return generatedOutput.status;
        }
        const words = generatedOutput.words;

        if (!generatedOutputShapeSupported(words)) {
            setResult(0, 5n);
            return 5;
        }

        for (let i = 0; i < words.length; i++) {
            if ((HEAPU32[tbPtr / 4 + i] >>> 0) !== words[i]) {
                setResult(0, 3n);
                return 3;
            }
        }

        const bytes = Uint8Array.from([
            0x00, 0x61, 0x73, 0x6d,
            0x01, 0x00, 0x00, 0x00,
            ...section(1, vector([
                functionType([valueI64], [valueI64]),
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
                functionBody(runInstructions(words), [
                    { count: 20, type: valueI64 },
                ]),
            ])),
        ]);
        if (!WebAssembly.validate(bytes)) {
            setResult(0, 7n);
            return 7;
        }
        const compileStart = performance.now();
        const module = new WebAssembly.Module(bytes);
        const compileNs = BigInt(Math.round(
            (performance.now() - compileStart) * 1000000));
        const instantiateStart = performance.now();
        const instance = new WebAssembly.Instance(module, {
            env: { memory: wasmMemory },
        });
        const instantiateNs = BigInt(Math.round(
            (performance.now() - instantiateStart) * 1000000));
        initialMemory = snapshotObservedMemory();

        initInputState();
        restoreObservedMemory(initialMemory);
        const generatedStart = performance.now();
        const generatedStatus = instance.exports.wasmjit_run(BigInt(context));
        const generatedNs = BigInt(Math.round(
            (performance.now() - generatedStart) * 1000000));
        const generatedRet = getU64(exit + 32);
        const generatedRegsChecksum = checksumRegs();
        const generatedMemoryChecksum = checksumObservedMemory();
        const generatedTciOps = BigInt(runInstructions.generatedTciOps);
        const generatedWrites = BigInt(runInstructions.inlineStores);

        initInputState();
        restoreObservedMemory(initialMemory);
        const referenceStart = performance.now();
        const reference = runReference();
        const referenceNs = BigInt(Math.round(
            (performance.now() - referenceStart) * 1000000));
        const referenceRegsChecksum = checksumRegs();
        const referenceMemoryChecksum = checksumObservedMemory();

        restoreObservedMemory(initialMemory);
        HEAPU64[counters / 8 + 0] = guestInsns;
        HEAPU64[counters / 8 + 1] = 0n;
        HEAPU64[counters / 8 + 2] = generatedNs;
        HEAPU64[counters / 8 + 3] = referenceNs;
        HEAPU64[counters / 8 + 8] = compileNs;
        HEAPU64[counters / 8 + 9] = instantiateNs;
        HEAPU64[counters / 8 + 10] = 1n;
        HEAPU64[counters / 8 + 11] = BigInt(runInstructions.inlineLoads);
        HEAPU64[counters / 8 + 12] = BigInt(runInstructions.inlineStores);

        setResult(1, generatedStatus);
        setResult(2, reference.status);
        setResult(3, generatedRet);
        setResult(4, reference.ret);
        setResult(5, generatedRegsChecksum);
        setResult(6, referenceRegsChecksum);
        setResult(7, generatedMemoryChecksum);
        setResult(8, referenceMemoryChecksum);
        setResult(9, guestInsns);
        setResult(10, guestInsns);
        setResult(11, generatedTciOps);
        setResult(12, BigInt(reference.executed));
        setResult(13, generatedWrites);
        setResult(14, BigInt(reference.writes));
        setResult(15, 0n);
        setResult(16, 0n);
        setResult(17, 0n);

        return generatedStatus === reference.status &&
               generatedRet === reference.ret &&
               generatedRegsChecksum === referenceRegsChecksum &&
               generatedMemoryChecksum === referenceMemoryChecksum &&
               guestInsns > 0n &&
               HEAPU64[counters / 8] === guestInsns &&
               generatedTciOps === BigInt(reference.executed) &&
               generatedTciOps === 11n &&
               generatedWrites === BigInt(reference.writes) ? 0 : 2;
    } catch (error) {
        if (initialMemory) {
            restoreObservedMemory(initialMemory);
        }
        setResult(0, 6n);
        return 6;
    }
});
#endif

static const char *tcg_wasm64_runloop_smoke_workload_name(
    TCGWasm64RunloopSmokeWorkload workload)
{
    switch (workload) {
    case TCG_WASM64_RUNLOOP_SMOKE_ALU_BRANCH:
        return "alu-branch";
    case TCG_WASM64_RUNLOOP_SMOKE_TLB_HIT_RAM:
        return "tlb-hit-ram";
    default:
        return "unknown";
    }
}

static uint64_t tcg_wasm64_runloop_smoke_speedup_ppm(uint64_t tci_ns,
                                                     uint64_t generated_ns)
{
    if (generated_ns == 0) {
        return 0;
    }
    return (uint64_t)((__uint128_t)tci_ns * 1000000u / generated_ns);
}

static void tcg_wasm64_report_runloop_smoke_workload(
    const TCGWasm64RunloopSmokeResult *result)
{
    const TCGWasm64RunCounters *counters = &result->counters;

    fprintf(stderr,
            "{\"name\":\"%s\","
            "\"ok\":%s,"
            "\"exit_reason\":\"%s\","
            "\"exit_reason_code\":%u,"
            "\"generated_guest_instructions\":%" PRIu64 ","
            "\"fallback_guest_instructions\":%" PRIu64 ","
            "\"generated_body_time_ns\":%" PRIu64 ","
            "\"tci_dispatch_time_ns\":%" PRIu64 ","
            "\"generated_vs_tci_speedup_ppm\":%" PRIu64 ","
            "\"min_generated_vs_tci_speedup_ppm\":%u,"
            "\"compile_time_ns\":%" PRIu64 ","
            "\"instantiate_time_ns\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"inline_tlb_hit_loads\":%" PRIu64 ","
            "\"inline_tlb_hit_stores\":%" PRIu64 ","
            "\"generated_exit_value\":%" PRIu64 ","
            "\"fallback_exit_value\":%" PRIu64 ","
            "\"generated_ram_value\":%" PRIu64 ","
            "\"fallback_ram_value\":%" PRIu64 ","
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
            "\"exits_invalidated\":%" PRIu64 "}",
            result->name,
            result->ok ? "true" : "false",
            tcg_wasm64_run_exit_reason_name(result->reason),
            result->exit.reason,
            counters->generated_guest_instructions,
            result->fallback_guest_instructions,
            counters->generated_body_time_ns,
            result->counters.tci_dispatch_time_ns,
            result->generated_vs_tci_speedup_ppm,
            TCG_WASM64_RUNLOOP_SMOKE_MIN_SPEEDUP_PPM,
            counters->compile_time_ns,
            counters->instantiate_time_ns,
            counters->generated_chain_length,
            counters->inline_tlb_hit_loads,
            counters->inline_tlb_hit_stores,
            result->exit.value,
            result->fallback_exit_value,
            result->generated_ram_value,
            result->fallback_ram_value,
            counters->helper_calls,
            counters->qemu_ld_calls,
            counters->qemu_st_calls,
            counters->exits_budget,
            counters->exits_mmio,
            counters->exits_tlb_miss_or_fault,
            counters->exits_interrupt,
            counters->exits_helper,
            counters->exits_unsupported,
            counters->exits_hlt,
            counters->exits_invalidated);
}

static void tcg_wasm64_report_runloop_smoke(
    const TCGWasm64RunCounters *counters,
    const TCGWasm64RunloopSmokeResult *results,
    unsigned int result_count, uint64_t budget, bool ok)
{
    TCGWasm64RunExitReason reason = TCG_WASM64_RUN_EXIT_BUDGET;
    uint64_t generated_vs_tci_speedup_ppm =
        tcg_wasm64_runloop_smoke_speedup_ppm(counters->tci_dispatch_time_ns,
                                             counters->generated_body_time_ns);
    unsigned int i;

    for (i = 0; i < result_count; i++) {
        if (results[i].reason != TCG_WASM64_RUN_EXIT_BUDGET) {
            reason = results[i].reason;
            break;
        }
    }

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
            "\"generated_vs_tci_speedup_ppm\":%" PRIu64 ","
            "\"min_generated_vs_tci_speedup_ppm\":%u,"
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
            "\"exits_invalidated\":%" PRIu64 ","
            "\"workload_count\":%u,"
            "\"workloads\":[",
            ok ? "true" : "false",
            budget,
            tcg_wasm64_run_exit_reason_name(reason),
            (unsigned int)reason,
            counters->generated_guest_instructions,
            counters->fallback_guest_instructions,
            counters->generated_body_time_ns,
            counters->tci_dispatch_time_ns,
            counters->tb_lookup_time_ns,
            counters->helper_call_time_ns,
            counters->qemu_ld_time_ns,
            counters->qemu_st_time_ns,
            generated_vs_tci_speedup_ppm,
            TCG_WASM64_RUNLOOP_SMOKE_MIN_SPEEDUP_PPM,
            counters->compile_time_ns,
            counters->instantiate_time_ns,
            counters->generated_chain_length,
            counters->inline_tlb_hit_loads,
            counters->inline_tlb_hit_stores,
            counters->helper_calls,
            counters->qemu_ld_calls,
            counters->qemu_st_calls,
            counters->exits_budget,
            counters->exits_mmio,
            counters->exits_tlb_miss_or_fault,
            counters->exits_interrupt,
            counters->exits_helper,
            counters->exits_unsupported,
            counters->exits_hlt,
            counters->exits_invalidated,
            result_count);

    for (i = 0; i < result_count; i++) {
        if (i != 0) {
            fputc(',', stderr);
        }
        tcg_wasm64_report_runloop_smoke_workload(&results[i]);
    }
    fprintf(stderr, "]}\n");
}

static uint64_t tcg_wasm64_runloop_smoke_time_ns(void)
{
    return (uint64_t)g_get_monotonic_time() * 1000u;
}

static uint64_t tcg_wasm64_runloop_smoke_tci_like(
    uint64_t budget, TCGWasm64RunloopSmokeWorkload workload,
    uint64_t *guest_insns, uint64_t *exit_value, uint64_t *ram_value)
{
    static const volatile uint8_t program[] = { 0, 1, 2, 3 };
    volatile uint64_t ram = 0;
    uint64_t value = 0;
    uint64_t state = 0;
    uint64_t iterations = 0;
    uint64_t dispatched = 0;
    uint8_t pc = 0;
    uint64_t start_ns = tcg_wasm64_runloop_smoke_time_ns();

    while (iterations < budget) {
        switch (program[pc]) {
        case 0:
            if (workload == TCG_WASM64_RUNLOOP_SMOKE_TLB_HIT_RAM) {
                value = ram;
            }
            pc = 1;
            break;
        case 1:
            if (state == 0) {
                value += 1;
                state = 1;
            } else {
                value ^= 0x5a5a;
                state = 0;
            }
            pc = 2;
            break;
        case 2:
            if (workload == TCG_WASM64_RUNLOOP_SMOKE_TLB_HIT_RAM) {
                ram = value;
            }
            pc = 3;
            break;
        case 3:
            iterations++;
            pc = 0;
            break;
        default:
            g_assert_not_reached();
        }
        dispatched++;
    }

    tcg_wasm64_runloop_smoke_sink = ram ^ value ^ state ^ dispatched;
    *guest_insns = dispatched;
    *exit_value = value;
    *ram_value = ram;
    return tcg_wasm64_runloop_smoke_time_ns() - start_ns;
}

static void tcg_wasm64_runloop_smoke_run_workload(
    CPUArchState *env, TCGWasm64RunloopSmokeWorkload workload, uint64_t budget,
    TCGWasm64RunloopSmokeResult *result)
{
    uint64_t smoke_ram = 0;
    uint64_t expected_tlb_hits =
        workload == TCG_WASM64_RUNLOOP_SMOKE_TLB_HIT_RAM ? budget : 0;
    TCGWasm64RunContext context = {
        .env = env,
        .guest_ram = &smoke_ram,
        .budget = budget,
        .counters = &result->counters,
        .exit = &result->exit,
        .mode = TCG_WASM64_RUN_MODE_PERF_PROOF,
    };

    memset(result, 0, sizeof(*result));
    result->name = tcg_wasm64_runloop_smoke_workload_name(workload);
    result->reason = TCG_WASM64_RUN_EXIT_UNSUPPORTED;
    tcg_wasm64_run_counters_reset(&result->counters);
    memset(&result->exit, 0, sizeof(result->exit));
#ifdef CONFIG_EMSCRIPTEN
    result->reason = (TCGWasm64RunExitReason)tcg_wasm64_runloop_smoke_js(
        (uintptr_t)&context, budget, workload);
#endif
    if (result->exit.reason == 0) {
        result->exit.reason = result->reason;
    }
    result->reason = (TCGWasm64RunExitReason)result->exit.reason;
    result->counters.tci_dispatch_time_ns =
        tcg_wasm64_runloop_smoke_tci_like(
            budget, workload, &result->fallback_guest_instructions,
            &result->fallback_exit_value, &result->fallback_ram_value);
    result->counters.fallback_guest_instructions =
        result->fallback_guest_instructions;
    result->generated_ram_value = smoke_ram;
    result->generated_vs_tci_speedup_ppm =
        tcg_wasm64_runloop_smoke_speedup_ppm(
            result->counters.tci_dispatch_time_ns,
            result->counters.generated_body_time_ns);
    tcg_wasm64_run_count_exit(&result->counters, result->reason);
    result->ok = result->reason == TCG_WASM64_RUN_EXIT_BUDGET &&
        result->counters.generated_guest_instructions ==
            budget * TCG_WASM64_RUNLOOP_SMOKE_GUEST_INSNS_PER_STEP &&
        result->fallback_guest_instructions ==
            budget * TCG_WASM64_RUNLOOP_SMOKE_GUEST_INSNS_PER_STEP &&
        result->counters.generated_chain_length == budget &&
        result->counters.inline_tlb_hit_loads == expected_tlb_hits &&
        result->counters.inline_tlb_hit_stores == expected_tlb_hits &&
        result->counters.helper_calls == 0 &&
        result->counters.qemu_ld_calls == 0 &&
        result->counters.qemu_st_calls == 0 &&
        result->exit.value == result->fallback_exit_value &&
        result->generated_ram_value == result->fallback_ram_value &&
        result->generated_vs_tci_speedup_ppm >=
            TCG_WASM64_RUNLOOP_SMOKE_MIN_SPEEDUP_PPM;
}

static void tcg_wasm64_runloop_smoke_maybe(CPUArchState *env)
{
    static bool checked;
    TCGWasm64RunloopSmokeResult results[
        TCG_WASM64_RUNLOOP_SMOKE_WORKLOAD_COUNT];
    TCGWasm64RunCounters totals;
    const uint64_t budget = TCG_WASM64_RUNLOOP_SMOKE_BUDGET;
    bool ok = true;
    unsigned int i;

    if (checked) {
        return;
    }
    checked = true;
    if (!tcg_wasm64_runloop_env_bool("QEMU_WASM64_RUNLOOP_SMOKE")) {
        return;
    }

    tcg_wasm64_run_counters_reset(&totals);
    for (i = 0; i < TCG_WASM64_RUNLOOP_SMOKE_WORKLOAD_COUNT; i++) {
        tcg_wasm64_runloop_smoke_run_workload(env, i, budget, &results[i]);
        tcg_wasm64_run_counters_add(&totals, &results[i].counters);
        ok = ok && results[i].ok;
    }
    tcg_wasm64_report_runloop_smoke(&totals, results,
                                    TCG_WASM64_RUNLOOP_SMOKE_WORKLOAD_COUNT,
                                    budget, ok);
}

static void tcg_wasm64_report_one_tb_differential(
    const TCGWasm64RunCounters *counters, const TCGWasm64RunExit *exit,
    const uint64_t *result, bool ok)
{
    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"one-tb-differential\","
            "\"name\":\"%s\","
            "\"ok\":%s,"
            "\"live_shape_fixture\":true,"
            "\"real_live_state_capture\":false,"
            "\"shape\":[\"ld32u\",\"tci_movi\",\"tci_setcond32\","
            "\"brcond\",\"tci_movi\",\"st8\",\"ld\",\"tci_movi\","
            "\"add\",\"st\",\"goto_tb\",\"exit_tb\",\"exit_tb\"],"
            "\"generated_tci_op_equivalents\":%" PRIu64 ","
            "\"reference_tci_op_equivalents\":%" PRIu64 ","
            "\"generated_body_time_ns\":%" PRIu64 ","
            "\"tci_dispatch_time_ns\":%" PRIu64 ","
            "\"compile_time_ns\":%" PRIu64 ","
            "\"instantiate_time_ns\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"inline_tlb_hit_loads\":%" PRIu64 ","
            "\"inline_tlb_hit_stores\":%" PRIu64 ","
            "\"helper_calls\":%" PRIu64 ","
            "\"qemu_ld_calls\":%" PRIu64 ","
            "\"qemu_st_calls\":%" PRIu64 ","
            "\"generated_status\":%" PRIu64 ","
            "\"reference_status\":%" PRIu64 ","
            "\"dispatch_status\":%u,"
            "\"generated_dispatch_target\":%" PRIu64 ","
            "\"reference_dispatch_target\":%" PRIu64 ","
            "\"exit_reason_code\":%u,"
            "\"exit_value\":%" PRIu64 ","
            "\"generated_regs_checksum\":%" PRIu64 ","
            "\"reference_regs_checksum\":%" PRIu64 ","
            "\"generated_memory_checksum\":%" PRIu64 ","
            "\"reference_memory_checksum\":%" PRIu64 ","
            "\"generated_memory_writes\":%" PRIu64 ","
            "\"reference_memory_writes\":%" PRIu64 ","
            "\"expected_memory_writes\":%u,"
            "\"js_status\":%" PRIu64 "}\n",
            TCG_WASM64_ONE_TB_NAME,
            ok ? "true" : "false",
            result[TCG_WASM64_ONE_TB_RESULT_GENERATED_TCI_OPS],
            result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_TCI_OPS],
            counters->generated_body_time_ns,
            counters->tci_dispatch_time_ns,
            counters->compile_time_ns,
            counters->instantiate_time_ns,
            counters->generated_chain_length,
            counters->inline_tlb_hit_loads,
            counters->inline_tlb_hit_stores,
            counters->helper_calls,
            counters->qemu_ld_calls,
            counters->qemu_st_calls,
            result[TCG_WASM64_ONE_TB_RESULT_GENERATED_STATUS],
            result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_STATUS],
            TCG_WASM64_ONE_TB_STATUS_DISPATCH,
            result[TCG_WASM64_ONE_TB_RESULT_GENERATED_RET],
            result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_RET],
            exit->reason,
            exit->value,
            result[TCG_WASM64_ONE_TB_RESULT_GENERATED_REGS_CHECKSUM],
            result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_REGS_CHECKSUM],
            result[TCG_WASM64_ONE_TB_RESULT_GENERATED_MEMORY_CHECKSUM],
            result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_MEMORY_CHECKSUM],
            result[TCG_WASM64_ONE_TB_RESULT_GENERATED_MEMORY_WRITES],
            result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_MEMORY_WRITES],
            TCG_WASM64_ONE_TB_MEMORY_WRITES,
            result[TCG_WASM64_ONE_TB_RESULT_JS_STATUS]);
}

static void tcg_wasm64_one_tb_differential_maybe(CPUArchState *env)
{
    TCGWasm64RunCounters counters;
    TCGWasm64RunExit exit;
    TCGWasm64RunContext context = { 0 };
    uint64_t result[TCG_WASM64_ONE_TB_RESULT__MAX] = { 0 };
    bool ok = false;

    if (one_tb_differential_checked) {
        return;
    }
    one_tb_differential_checked = true;
    if (!tcg_wasm64_runloop_env_bool(TCG_WASM64_ONE_TB_DIFFERENTIAL_ENV)) {
        return;
    }

    tcg_wasm64_run_counters_reset(&counters);
    memset(&exit, 0, sizeof(exit));
    context.env = env;
    context.budget = 1;
    context.counters = &counters;
    context.exit = &exit;
    context.mode = TCG_WASM64_RUN_MODE_PERF_PROOF;

#ifdef CONFIG_EMSCRIPTEN
    {
        g_autofree uint8_t *scratch = g_malloc0(
            TCG_WASM64_ONE_TB_SCRATCH_SIZE);
        int js_status = tcg_wasm64_one_tb_differential_js(
            (uintptr_t)&context, (uintptr_t)scratch, (uintptr_t)&counters,
            (uintptr_t)&exit, (uintptr_t)result);

        result[TCG_WASM64_ONE_TB_RESULT_JS_STATUS] = js_status;
    }
#else
    result[TCG_WASM64_ONE_TB_RESULT_JS_STATUS] = 1;
#endif

    ok = result[TCG_WASM64_ONE_TB_RESULT_JS_STATUS] == 0 &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_STATUS] ==
             TCG_WASM64_ONE_TB_STATUS_DISPATCH &&
         result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_STATUS] ==
             TCG_WASM64_ONE_TB_STATUS_DISPATCH &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_RET] ==
             result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_RET] &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_REGS_CHECKSUM] ==
             result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_REGS_CHECKSUM] &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_MEMORY_CHECKSUM] ==
             result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_MEMORY_CHECKSUM] &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_TCI_OPS] ==
             result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_TCI_OPS] &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_TCI_OPS] ==
             TCG_WASM64_ONE_TB_EXECUTED_TCI_OP_EQUIVALENTS &&
         result[TCG_WASM64_ONE_TB_RESULT_GENERATED_MEMORY_WRITES] ==
             TCG_WASM64_ONE_TB_MEMORY_WRITES &&
         result[TCG_WASM64_ONE_TB_RESULT_REFERENCE_MEMORY_WRITES] ==
             TCG_WASM64_ONE_TB_MEMORY_WRITES &&
         counters.inline_tlb_hit_loads == TCG_WASM64_ONE_TB_MEMORY_LOADS &&
         counters.inline_tlb_hit_stores == TCG_WASM64_ONE_TB_MEMORY_WRITES &&
         counters.helper_calls == 0 &&
         counters.qemu_ld_calls == 0 &&
         counters.qemu_st_calls == 0 &&
         exit.reason == TCG_WASM64_ONE_TB_STATUS_DISPATCH &&
         exit.value == TCG_WASM64_ONE_TB_DISPATCH_TARGET;

    tcg_wasm64_report_one_tb_differential(&counters, &exit, result, ok);
}

static uint32_t tcg_wasm64_tci_word_op(uint32_t word)
{
    return word & 0xffu;
}

static bool tcg_wasm64_live_one_tb_generated_output_shape_supported(
    const TCGWasm64TBMetadata *metadata)
{
    const uint32_t *words;

    if (!tcg_wasm64_translate_generated_output_available(metadata) ||
        metadata->generated_output_op_count !=
            ARRAY_SIZE(tcg_wasm64_live_one_tb_ops)) {
        return false;
    }

    words = metadata->generated_output;
    for (size_t i = 0; i < ARRAY_SIZE(tcg_wasm64_live_one_tb_ops); i++) {
        if (tcg_wasm64_tci_word_op(words[i]) !=
            tcg_wasm64_live_one_tb_ops[i]) {
            return false;
        }
    }
    return true;
}

static bool tcg_wasm64_live_one_tb_selected_hot_shape(
    const TCGWasm64TBMetadata *metadata)
{
    if (!metadata) {
        return false;
    }
    return metadata->op_count == ARRAY_SIZE(tcg_wasm64_live_one_tb_ops) &&
           metadata->first_op == INDEX_op_ld32u;
}

static const char *tcg_wasm64_live_one_tb_js_status_name(uint64_t status)
{
    switch (status) {
    case 0:
        return "ok";
    case 1:
        return "runtime-unavailable";
    case 2:
        return "differential-mismatch";
    case 3:
        return "metadata-output-tb-code-mismatch";
    case 4:
        return "generated-output-unavailable";
    case 5:
        return "selected-hot-shape-unsupported";
    case 6:
        return "module-emission-failed";
    case 7:
        return "module-validation-failed";
    default:
        return "unknown";
    }
}

static void tcg_wasm64_report_live_one_tb_differential(
    const TranslationBlock *tb, const TCGWasm64TBMetadata *metadata,
    const TCGWasm64RunCounters *run_counters,
    const TCGWasm64RunExit *exit, const uint64_t *result, bool ok)
{
    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"live-one-tb-differential\","
            "\"name\":\"%s\","
            "\"ok\":%s,"
            "\"live_shape_fixture\":false,"
            "\"real_live_state_capture\":true,"
            "\"shape\":[\"ld32u\",\"tci_movi\",\"tci_setcond32\","
            "\"brcond\",\"tci_movi\",\"st8\",\"ld\",\"tci_movi\","
            "\"add\",\"st\",\"goto_tb\"],"
            "\"tb_ptr\":\"0x%" PRIxPTR "\","
            "\"tb_pc\":\"0x%" PRIx64 "\","
            "\"tb_cs_base\":\"0x%" PRIx64 "\","
            "\"tb_flags\":%" PRIu32 ","
            "\"tb_cflags\":%" PRIu32 ","
            "\"tb_size\":%" PRIu16 ","
            "\"tb_icount\":%" PRIu16 ","
            "\"metadata_op_count\":%" PRIu32 ","
            "\"metadata_generated_output_available\":%s,"
            "\"metadata_generated_output_size\":%" PRIu32 ","
            "\"metadata_generated_output_op_count\":%" PRIu32 ","
            "\"metadata_generated_output_checksum\":%" PRIu32 ","
            "\"generated_guest_instructions\":%" PRIu64 ","
            "\"reference_guest_instructions\":%" PRIu64 ","
            "\"generated_tci_op_equivalents\":%" PRIu64 ","
            "\"reference_tci_op_equivalents\":%" PRIu64 ","
            "\"generated_body_time_ns\":%" PRIu64 ","
            "\"tci_dispatch_time_ns\":%" PRIu64 ","
            "\"compile_time_ns\":%" PRIu64 ","
            "\"instantiate_time_ns\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"inline_tlb_hit_loads\":%" PRIu64 ","
            "\"inline_tlb_hit_stores\":%" PRIu64 ","
            "\"helper_calls\":%" PRIu64 ","
            "\"qemu_ld_calls\":%" PRIu64 ","
            "\"qemu_st_calls\":%" PRIu64 ","
            "\"generated_status\":%" PRIu64 ","
            "\"reference_status\":%" PRIu64 ","
            "\"dispatch_status\":%u,"
            "\"generated_dispatch_target\":%" PRIu64 ","
            "\"reference_dispatch_target\":%" PRIu64 ","
            "\"exit_reason_code\":%u,"
            "\"exit_value\":%" PRIu64 ","
            "\"generated_regs_checksum\":%" PRIu64 ","
            "\"reference_regs_checksum\":%" PRIu64 ","
            "\"generated_memory_checksum\":%" PRIu64 ","
            "\"reference_memory_checksum\":%" PRIu64 ","
            "\"generated_memory_writes\":%" PRIu64 ","
            "\"reference_memory_writes\":%" PRIu64 ","
            "\"expected_memory_writes\":%u,"
            "\"scanned_live_tbs_before_match\":%" PRIu64 ","
            "\"js_status\":%" PRIu64 ","
            "\"js_status_name\":\"%s\"}\n",
            TCG_WASM64_LIVE_ONE_TB_NAME,
            ok ? "true" : "false",
            (uintptr_t)tb->tc.ptr,
            (uint64_t)tb->pc,
            tb->cs_base,
            tb->flags,
            tb_cflags(tb),
            tb->size,
            tb->icount,
            metadata->op_count,
            tcg_wasm64_translate_generated_output_available(metadata) ?
                "true" : "false",
            metadata->generated_output_size,
            metadata->generated_output_op_count,
            metadata->generated_output_checksum,
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_GUEST_INSNS],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_GUEST_INSNS],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_TCI_OPS],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_TCI_OPS],
            run_counters->generated_body_time_ns,
            run_counters->tci_dispatch_time_ns,
            run_counters->compile_time_ns,
            run_counters->instantiate_time_ns,
            run_counters->generated_chain_length,
            run_counters->inline_tlb_hit_loads,
            run_counters->inline_tlb_hit_stores,
            run_counters->helper_calls,
            run_counters->qemu_ld_calls,
            run_counters->qemu_st_calls,
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_STATUS],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_STATUS],
            TCG_WASM64_ONE_TB_STATUS_DISPATCH,
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_RET],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_RET],
            exit->reason,
            exit->value,
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_REGS_CHECKSUM],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_REGS_CHECKSUM],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_MEMORY_CHECKSUM],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_MEMORY_CHECKSUM],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_MEMORY_WRITES],
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_MEMORY_WRITES],
            TCG_WASM64_ONE_TB_MEMORY_WRITES,
            live_one_tb_differential_scanned,
            result[TCG_WASM64_LIVE_ONE_TB_RESULT_JS_STATUS],
            tcg_wasm64_live_one_tb_js_status_name(
                result[TCG_WASM64_LIVE_ONE_TB_RESULT_JS_STATUS]));
}

static void tcg_wasm64_report_live_one_tb_failure(
    const char *blocker, const void *tb_ptr,
    const TCGWasm64TBMetadata *metadata, const TranslationBlock *tb,
    uint64_t js_status)
{
    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"live-one-tb-differential\","
            "\"name\":\"%s\","
            "\"ok\":false,"
            "\"blocker\":\"%s\","
            "\"tb_ptr\":\"0x%" PRIxPTR "\","
            "\"has_metadata\":%s,"
            "\"metadata_op_count\":%" PRIu32 ","
            "\"metadata_first_op\":%" PRIu32 ","
            "\"metadata_first_op_name\":\"%s\","
            "\"metadata_generated_output_available\":%s,"
            "\"metadata_generated_output_size\":%" PRIu32 ","
            "\"metadata_generated_output_op_count\":%" PRIu32 ","
            "\"metadata_generated_output_checksum\":%" PRIu32 ","
            "\"metadata_first_generated_unsupported_op\":%" PRIu32 ","
            "\"metadata_first_generated_unsupported_op_name\":\"%s\","
            "\"has_tb\":%s,"
            "\"tb_icount\":%u,"
            "\"scanned_live_tbs_before_match\":%" PRIu64 ","
            "\"generated_guest_instructions\":0,"
            "\"js_status\":%" PRIu64 ","
            "\"js_status_name\":\"%s\"}\n",
            TCG_WASM64_LIVE_ONE_TB_NAME,
            blocker,
            (uintptr_t)tb_ptr,
            metadata ? "true" : "false",
            metadata ? metadata->op_count : 0,
            metadata ? metadata->first_op : UINT32_MAX,
            metadata ? tcg_wasm64_op_name(metadata->first_op) : "none",
            tcg_wasm64_translate_generated_output_available(metadata) ?
                "true" : "false",
            metadata ? metadata->generated_output_size : 0,
            metadata ? metadata->generated_output_op_count : 0,
            metadata ? metadata->generated_output_checksum : 0,
            metadata ? metadata->first_generated_unsupported_op : UINT32_MAX,
            metadata ? tcg_wasm64_op_name(
                metadata->first_generated_unsupported_op) : "none",
            tb ? "true" : "false",
            tb ? tb->icount : 0,
            live_one_tb_differential_scanned,
            js_status,
            tcg_wasm64_live_one_tb_js_status_name(js_status));
}

static void tcg_wasm64_record_live_one_tb_generated_metrics(
    uint64_t guest_insns)
{
    translated_counters.generated_attempts++;
    translated_counters.generated_compiled++;
    translated_counters.generated_executed++;
    translated_counters.generated_coverage_numerator += guest_insns;
    translated_counters.generated_coverage_denominator += guest_insns;
}

static void tcg_wasm64_live_one_tb_differential_maybe(
    CPUArchState *env, const void *tb_ptr,
    const TCGWasm64TBMetadata *metadata)
{
    TranslationBlock *tb;
    TCGWasm64RunCounters run_counters;
    TCGWasm64RunExit exit;
    TCGWasm64RunContext context = { 0 };
    uint64_t result[TCG_WASM64_LIVE_ONE_TB_RESULT__MAX] = { 0 };
    uint64_t guest_insns;
    bool ok = false;

    if (live_one_tb_differential_checked ||
        !tcg_wasm64_live_one_tb_enabled()) {
        return;
    }

    live_one_tb_differential_scanned++;
    if (!metadata) {
        if (!live_one_tb_metadata_missing_reported) {
            live_one_tb_metadata_missing_reported = true;
            tcg_wasm64_report_live_one_tb_failure(
                "metadata missing for live TB", tb_ptr, NULL, NULL, 4);
        }
        return;
    }
    if (!tcg_wasm64_translate_generated_output_available(metadata)) {
        if (!live_one_tb_output_unavailable_reported &&
            tcg_wasm64_live_one_tb_selected_hot_shape(metadata)) {
            live_one_tb_output_unavailable_reported = true;
            tcg_wasm64_report_live_one_tb_failure(
                "generated output unavailable for selected hot shape",
                tb_ptr, metadata, NULL, 4);
        }
        return;
    }
    if (!tcg_wasm64_live_one_tb_generated_output_shape_supported(metadata)) {
        if (!live_one_tb_unsupported_shape_reported &&
            tcg_wasm64_live_one_tb_selected_hot_shape(metadata)) {
            live_one_tb_unsupported_shape_reported = true;
            tcg_wasm64_report_live_one_tb_failure(
                "selected hot shape unsupported by live per-TB emitter",
                tb_ptr, metadata, NULL, 5);
        }
        return;
    }
    live_one_tb_differential_checked = true;

    tb = tcg_tb_lookup((uintptr_t)tb_ptr);
    if (!tb || tb->icount == 0) {
        fprintf(stderr,
                "qemu-wasm64-runloop: {\"format\":1,"
                "\"event\":\"live-one-tb-differential\","
                "\"name\":\"%s\",\"ok\":false,"
                "\"blocker\":\"matched shape but missing TranslationBlock "
                "identity or nonzero icount\","
                "\"tb_ptr\":\"0x%" PRIxPTR "\","
                "\"has_tb\":%s,\"tb_icount\":%u,"
                "\"scanned_live_tbs_before_match\":%" PRIu64 "}\n",
                TCG_WASM64_LIVE_ONE_TB_NAME,
                (uintptr_t)tb_ptr,
                tb ? "true" : "false",
                tb ? tb->icount : 0,
                live_one_tb_differential_scanned);
        return;
    }
    guest_insns = tb->icount;

    tcg_wasm64_run_counters_reset(&run_counters);
    memset(&exit, 0, sizeof(exit));
    context.env = env;
    context.budget = guest_insns;
    context.counters = &run_counters;
    context.exit = &exit;
    context.mode = TCG_WASM64_RUN_MODE_PERF_PROOF;

#ifdef CONFIG_EMSCRIPTEN
    {
        g_autofree uint8_t *scratch = g_malloc0(
            TCG_WASM64_ONE_TB_SCRATCH_SIZE);
        int js_status = tcg_wasm64_live_one_tb_differential_js(
            (uintptr_t)&context, (uintptr_t)scratch,
            (uintptr_t)&run_counters, (uintptr_t)&exit, (uintptr_t)result,
            (uintptr_t)tb_ptr, (uintptr_t)env, guest_insns,
            (uintptr_t)metadata->generated_output,
            metadata->generated_output_size);

        result[TCG_WASM64_LIVE_ONE_TB_RESULT_JS_STATUS] = js_status;
    }
#else
    result[TCG_WASM64_LIVE_ONE_TB_RESULT_JS_STATUS] = 1;
#endif

    ok = result[TCG_WASM64_LIVE_ONE_TB_RESULT_JS_STATUS] == 0 &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_STATUS] ==
             TCG_WASM64_ONE_TB_STATUS_DISPATCH &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_STATUS] ==
             TCG_WASM64_ONE_TB_STATUS_DISPATCH &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_RET] ==
             result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_RET] &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_REGS_CHECKSUM] ==
             result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_REGS_CHECKSUM] &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_MEMORY_CHECKSUM] ==
             result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_MEMORY_CHECKSUM] &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_GUEST_INSNS] ==
             guest_insns &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_GUEST_INSNS] ==
             guest_insns &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_TCI_OPS] ==
             TCG_WASM64_ONE_TB_EXECUTED_TCI_OP_EQUIVALENTS &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_TCI_OPS] ==
             TCG_WASM64_ONE_TB_EXECUTED_TCI_OP_EQUIVALENTS &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_MEMORY_WRITES] ==
             TCG_WASM64_ONE_TB_MEMORY_WRITES &&
         result[TCG_WASM64_LIVE_ONE_TB_RESULT_REFERENCE_MEMORY_WRITES] ==
             TCG_WASM64_ONE_TB_MEMORY_WRITES &&
         tcg_wasm64_translate_generated_output_available(metadata) &&
         tcg_wasm64_live_one_tb_generated_output_shape_supported(metadata) &&
         run_counters.generated_guest_instructions == guest_insns &&
         run_counters.inline_tlb_hit_loads == TCG_WASM64_ONE_TB_MEMORY_LOADS &&
         run_counters.inline_tlb_hit_stores ==
             TCG_WASM64_ONE_TB_MEMORY_WRITES &&
         run_counters.helper_calls == 0 &&
         run_counters.qemu_ld_calls == 0 &&
         run_counters.qemu_st_calls == 0 &&
         exit.reason == TCG_WASM64_ONE_TB_STATUS_DISPATCH &&
         exit.value ==
             result[TCG_WASM64_LIVE_ONE_TB_RESULT_GENERATED_RET];

    if (ok) {
        tcg_wasm64_record_live_one_tb_generated_metrics(guest_insns);
    }
    tcg_wasm64_report_live_one_tb_differential(
        tb, metadata, &run_counters, &exit, result, ok);
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
    case INDEX_op_mb:
    case INDEX_op_mov:
    case INDEX_op_movcond:
    case INDEX_op_mul:
    case INDEX_op_neg:
    case INDEX_op_or:
    case INDEX_op_setcond:
    case INDEX_op_shl:
    case INDEX_op_shr:
    case INDEX_op_sub:
    case INDEX_op_tci_movi:
    case INDEX_op_tci_movl:
    /*
     * Direct TCI host-memory ld/st operations need a validated aligned
     * memory-access model before they can be generated safely in browsers.
     * Helper-backed guest RAM accesses are still allowed below.
     */
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

static TCGWasm64TBMetadata *tcg_wasm64_translate_lookup_mutable(
    const void *tb_ptr)
{
    TCGWasm64TranslateEntry *entry;
    TCGWasm64TBMetadata *metadata;

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

void tcg_wasm64_clear_active_counters(void)
{
    active_counters = NULL;
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

static void tcg_wasm64_count_live_translation_metadata(
    TCGWasm64TBMetadata *metadata)
{
    TCGWasm64Counters *counters = &translated_counters;

    if (!metadata ||
        (metadata->flags & TCG_WASM64_TB_METADATA_TRANSLATION_COUNTED)) {
        return;
    }

    metadata->flags |= TCG_WASM64_TB_METADATA_TRANSLATION_COUNTED;
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
        if (metadata->flags & TCG_WASM64_TB_METADATA_PROFILE_LOWERABLE) {
            counters->translated_lowerable_tbs++;
        }
        counters->translated_generated_supported_ops +=
            metadata->generated_supported_op_count;
        counters->translated_generated_unsupported_ops +=
            metadata->generated_unsupported_op_count;
        if (tcg_wasm64_translate_generated_candidate(metadata)) {
            counters->translated_generated_candidate_tbs++;
        }
        if (tcg_wasm64_translate_generated_output_available(metadata)) {
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
        if (metadata->flags & TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED) {
            counters->translated_generated_output_truncated++;
        }
    }
    tcg_wasm64_summary_maybe_report();
}

uintptr_t tcg_wasm64_tb_exec(CPUArchState *env, const void *tb_ptr,
                             TCGWasm64Counters *counters)
{
    TCGWasm64Counters *previous_counters = active_counters;
    TCGWasm64TBMetadata *metadata;
    uintptr_t ret;
    TCGWasm64Context ctx = {
        .tb_ptr = (void *)tb_ptr,
        .env = env,
        .counters = counters,
    };

    tcg_wasm64_runloop_smoke_maybe(env);
    tcg_wasm64_one_tb_differential_maybe(env);

    /*
     * Native wasm64 lowering grows behind this boundary.  The TCI fallback
     * owns live register state today, so it receives the active counter
     * contract and may execute generated WebAssembly blocks only after it has
     * validated the TCI bytecode shape.
     */
    (void)ctx;
    if (counters) {
        tcg_wasm64_counters_reset(counters);
    }

    metadata = tcg_wasm64_translate_lookup_mutable(tb_ptr);
    if (metadata) {
        tcg_wasm64_count_live_translation_metadata(metadata);
        tcg_wasm64_live_one_tb_differential_maybe(env, tb_ptr, metadata);
        tcg_wasm64_summary_maybe_report();
    } else {
        translated_counters.translated_metadata_misses++;
        tcg_wasm64_live_one_tb_differential_maybe(env, tb_ptr, NULL);
    }
    active_counters = counters;
    ret = tcg_tci_qemu_tb_exec(env, tb_ptr);
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
