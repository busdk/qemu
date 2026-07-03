/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Experimental wasm64 TCG backend runtime boundary.
 *
 * This header defines the C-side contract for generated WebAssembly
 * translation blocks.  The backend is intentionally fail-closed until
 * instruction lowering, helper calls, memory access, and invalidation are
 * implemented and tested.
 */

#ifndef TCG_WASM64_H
#define TCG_WASM64_H

#include <stdint.h>

typedef struct CPUArchState CPUArchState;

typedef enum TCGWasm64ExitReason {
    TCG_WASM64_EXIT_BUDGET,
    TCG_WASM64_EXIT_MMIO,
    TCG_WASM64_EXIT_TLB_MISS,
    TCG_WASM64_EXIT_INTERRUPT,
    TCG_WASM64_EXIT_CSR,
    TCG_WASM64_EXIT_INVALID,
    TCG_WASM64_EXIT_INVALIDATION,
    TCG_WASM64_EXIT_UNSUPPORTED,
    TCG_WASM64_EXIT_FATAL,
    TCG_WASM64_EXIT__MAX,
} TCGWasm64ExitReason;

/*
 * Execution counters reported by the experimental backend.
 *
 * These counters are part of the fallback contract: every generated block
 * attempt must be explainable as a generated execution, a compile/cache event,
 * or a precise fallback to the existing TCI/native execution path.
 */
typedef struct TCGWasm64Counters {
    uint64_t generated_attempts;
    uint64_t generated_compiled;
    uint64_t generated_executed;
    uint64_t generated_cache_hits;
    uint64_t generated_coverage_numerator;
    uint64_t generated_coverage_denominator;
    uint64_t generated_exits[TCG_WASM64_EXIT__MAX];
    uint64_t translated_tbs;
    uint64_t translated_ops;
    uint64_t translated_fallback_markers;
    uint64_t translated_metadata_misses;
    uint64_t translated_profiled_tbs;
    uint64_t translated_lowerable_tbs;
    uint64_t translated_profile_supported_ops;
    uint64_t translated_profile_unsupported_ops;
    uint64_t translated_generated_candidate_tbs;
    uint64_t translated_generated_supported_ops;
    uint64_t translated_generated_unsupported_ops;
    uint64_t translated_generated_output_tbs;
    uint64_t translated_generated_output_unavailable_tbs;
    uint64_t translated_generated_output_missing_candidate_tbs;
    uint64_t translated_generated_output_incomplete_tbs;
    uint64_t translated_generated_output_bytes;
    uint64_t translated_generated_output_ops;
    uint64_t translated_generated_output_truncated;
    uint64_t exec_generated_output_lookup_tbs;
    uint64_t exec_generated_output_available_tbs;
    uint64_t exec_generated_output_unavailable_tbs;
    uint64_t exec_generated_output_missing_candidate_tbs;
    uint64_t exec_generated_output_incomplete_tbs;
    uint64_t fallback_unsupported;
    uint64_t fallback_helper;
    uint64_t fallback_qemu_load;
    uint64_t fallback_qemu_store;
    uint64_t fallback_runtime;
    uint64_t generated_compile_prereq_failed;
    uint64_t generated_compile_no_terminal;
    uint64_t generated_compile_lowering_failed;
    uint64_t generated_compile_module_failed;
    uint64_t generated_compile_table_failed;
    uint64_t generated_compile_instance_failed;
    uint64_t generated_compile_add_function_failed;
    uint64_t generated_compile_exception_failed;
    uint64_t generated_compile_unknown_failed;
} TCGWasm64Counters;

typedef enum TCGWasm64FallbackReason {
    TCG_WASM64_FALLBACK_UNSUPPORTED,
    TCG_WASM64_FALLBACK_HELPER,
    TCG_WASM64_FALLBACK_QEMU_LOAD,
    TCG_WASM64_FALLBACK_QEMU_STORE,
    TCG_WASM64_FALLBACK_RUNTIME,
} TCGWasm64FallbackReason;

typedef enum TCGWasm64RunMode {
    TCG_WASM64_RUN_MODE_COMPAT = 0,
    TCG_WASM64_RUN_MODE_PERF_PROOF = 1,
} TCGWasm64RunMode;

typedef enum TCGWasm64RunExitReason {
    TCG_WASM64_RUN_EXIT_BUDGET = 1,
    TCG_WASM64_RUN_EXIT_MMIO = 2,
    TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT = 3,
    TCG_WASM64_RUN_EXIT_INTERRUPT = 4,
    TCG_WASM64_RUN_EXIT_HELPER = 5,
    TCG_WASM64_RUN_EXIT_UNSUPPORTED = 6,
    TCG_WASM64_RUN_EXIT_HLT = 7,
    TCG_WASM64_RUN_EXIT_INVALIDATED = 8,
} TCGWasm64RunExitReason;

typedef struct TCGWasm64RunExit {
    uint32_t reason;
    uint32_t tb_id;
    uint64_t pc;
    uint64_t vaddr;
    uint64_t paddr;
    uint64_t value;
    uint32_t size;
    uint32_t flags;
} TCGWasm64RunExit;

typedef struct TCGWasm64RunCounters {
    uint64_t generated_guest_instructions;
    uint64_t fallback_guest_instructions;
    uint64_t generated_body_time_ns;
    uint64_t tci_dispatch_time_ns;
    uint64_t tb_lookup_time_ns;
    uint64_t helper_call_time_ns;
    uint64_t qemu_ld_time_ns;
    uint64_t qemu_st_time_ns;
    uint64_t compile_time_ns;
    uint64_t instantiate_time_ns;
    uint64_t generated_chain_length;
    uint64_t inline_tlb_hit_loads;
    uint64_t inline_tlb_hit_stores;
    uint64_t helper_calls;
    uint64_t qemu_ld_calls;
    uint64_t qemu_st_calls;
    uint64_t exits_budget;
    uint64_t exits_mmio;
    uint64_t exits_tlb_miss_or_fault;
    uint64_t exits_interrupt;
    uint64_t exits_helper;
    uint64_t exits_unsupported;
    uint64_t exits_hlt;
    uint64_t exits_invalidated;
} TCGWasm64RunCounters;

typedef struct TCGWasm64RunContext {
    CPUArchState *env;
    void *guest_ram;
    uint64_t budget;
    TCGWasm64RunCounters *counters;
    TCGWasm64RunExit *exit;
    uint32_t mode;
    uint32_t flags;
} TCGWasm64RunContext;

#define TCG_WASM64_RUN_CTX_ENV_OFFSET 0u
#define TCG_WASM64_RUN_CTX_GUEST_RAM_OFFSET 8u
#define TCG_WASM64_RUN_CTX_BUDGET_OFFSET 16u
#define TCG_WASM64_RUN_CTX_COUNTERS_OFFSET 24u
#define TCG_WASM64_RUN_CTX_EXIT_OFFSET 32u
#define TCG_WASM64_RUN_CTX_MODE_OFFSET 40u
#define TCG_WASM64_RUN_CTX_FLAGS_OFFSET 44u
#define TCG_WASM64_RUN_CTX_SIZE 48u

#define TCG_WASM64_RUN_EXIT_REASON_OFFSET 0u
#define TCG_WASM64_RUN_EXIT_TB_ID_OFFSET 4u
#define TCG_WASM64_RUN_EXIT_PC_OFFSET 8u
#define TCG_WASM64_RUN_EXIT_VADDR_OFFSET 16u
#define TCG_WASM64_RUN_EXIT_PADDR_OFFSET 24u
#define TCG_WASM64_RUN_EXIT_VALUE_OFFSET 32u
#define TCG_WASM64_RUN_EXIT_SIZE_OFFSET 40u
#define TCG_WASM64_RUN_EXIT_FLAGS_OFFSET 44u
#define TCG_WASM64_RUN_EXIT_SIZE 48u

#define TCG_WASM64_TB_METADATA_MAGIC 0x36574153u /* "SAW6" */
#define TCG_WASM64_TB_METADATA_VERSION 1u

typedef enum TCGWasm64TBMetadataFlags {
    TCG_WASM64_TB_METADATA_VALID = 1u << 0,
    TCG_WASM64_TB_METADATA_FALLBACK = 1u << 1,
    TCG_WASM64_TB_METADATA_LOWERING_PROFILE = 1u << 2,
    TCG_WASM64_TB_METADATA_PROFILE_LOWERABLE = 1u << 3,
    TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE = 1u << 4,
    TCG_WASM64_TB_METADATA_TERMINAL = 1u << 5,
    TCG_WASM64_TB_METADATA_GENERATED_OUTPUT = 1u << 6,
    TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED = 1u << 7,
} TCGWasm64TBMetadataFlags;

typedef enum TCGWasm64TranslateFallbackReason {
    TCG_WASM64_TRANSLATE_FALLBACK_NONE = 0,
    TCG_WASM64_TRANSLATE_FALLBACK_NO_WASM_EMITTER = 1,
    TCG_WASM64_TRANSLATE_FALLBACK_UNSUPPORTED_OPCODE = 2,
} TCGWasm64TranslateFallbackReason;

#define TCG_WASM64_LOWERING_PROFILE_HOTBLOCK 1u
#define TCG_WASM64_TRANSLATE_OUTPUT_MAX 4096u
#define TCG_WASM64_TRANSLATE_OUTPUT_WORDS \
    (TCG_WASM64_TRANSLATE_OUTPUT_MAX / sizeof(uint32_t))

/*
 * Side-band metadata recorded while the wasm64 target emits the fallback TCI
 * bytecode stream.  This is the bridge from the current fallback-only target
 * to a translation-time WebAssembly emitter: future lowering should attach
 * generated bytes here, while unsupported TBs keep an explicit fallback marker.
 */
typedef struct TCGWasm64TBMetadata {
    const void *tb_ptr;
    uint32_t magic;
    uint32_t version;
    uint32_t flags;
    uint32_t op_count;
    uint32_t first_op;
    uint32_t last_op;
    uint32_t first_unsupported_op;
    uint32_t fallback_reason;
    uint32_t lowering_profile;
    uint32_t supported_op_count;
    uint32_t unsupported_op_count;
    uint32_t generated_supported_op_count;
    uint32_t generated_unsupported_op_count;
    uint32_t first_generated_unsupported_op;
    uint32_t generated_output_size;
    uint32_t generated_output_op_count;
    uint32_t generated_output_checksum;
    const uint32_t *generated_output;
} TCGWasm64TBMetadata;

void tcg_wasm64_counters_reset(TCGWasm64Counters *counters);
void tcg_wasm64_counters_add(TCGWasm64Counters *dst,
                             const TCGWasm64Counters *src);
void tcg_wasm64_count_fallback(TCGWasm64Counters *counters,
                               TCGWasm64FallbackReason reason);
void tcg_wasm64_count_exit(TCGWasm64Counters *counters,
                           TCGWasm64ExitReason reason);
void tcg_wasm64_run_counters_reset(TCGWasm64RunCounters *counters);
void tcg_wasm64_run_counters_add(TCGWasm64RunCounters *dst,
                                 const TCGWasm64RunCounters *src);
void tcg_wasm64_run_count_exit(TCGWasm64RunCounters *counters,
                               TCGWasm64RunExitReason reason);
const char *tcg_wasm64_run_exit_reason_name(TCGWasm64RunExitReason reason);
void tcg_wasm64_translate_begin(const void *tb_ptr);
void tcg_wasm64_translate_note_tci_op(uint32_t op);
void tcg_wasm64_translate_note_tci_insn(uint32_t op, uint32_t insn);
const TCGWasm64TBMetadata *tcg_wasm64_translate_lookup(const void *tb_ptr);
bool tcg_wasm64_translate_generated_candidate(
    const TCGWasm64TBMetadata *metadata);
bool tcg_wasm64_translate_generated_output_available(
    const TCGWasm64TBMetadata *metadata);
bool tcg_wasm64_backend_available(void);
uintptr_t tcg_tci_qemu_tb_exec(CPUArchState *env, const void *tb_ptr);

/*
 * Context shared between QEMU and a generated WebAssembly TB function.
 *
 * The generated function receives exactly one pointer to this structure.  This
 * keeps the call ABI small enough for browser function-table calls and leaves
 * room for helper-call, stack, and dispatch state without changing the
 * generated function signature.
 */
typedef struct TCGWasm64Context {
    void *tb_ptr;
    void *next_tb_ptr;
    void *env;
    uint64_t *stack;
    void *ret128;
    TCGWasm64Counters *counters;
    uintptr_t regs;
    uintptr_t ret;
    uint32_t flags;
} TCGWasm64Context;

typedef uintptr_t (*TCGWasm64TBFunc)(TCGWasm64Context *ctx);

typedef struct TCGWasm64Instance {
    void *tb_ptr;
    TCGWasm64TBFunc func;
} TCGWasm64Instance;

/*
 * Header stored at the start of each wasm64 backend translation block.
 *
 * Cold blocks must remain runnable through the existing fallback path until a
 * generated instance has been compiled and installed for the current thread.
 */
typedef struct TCGWasm64TBHeader {
    void *fallback_ptr;
    void *wasm_ptr;
    uint32_t wasm_size;
    void *imports_ptr;
    uint32_t imports_size;
    int32_t *counters;
    TCGWasm64Instance **instances;
} TCGWasm64TBHeader;

uintptr_t tcg_wasm64_tb_exec(CPUArchState *env, const void *tb_ptr,
                             TCGWasm64Counters *counters);
TCGWasm64Counters *tcg_wasm64_active_counters(void);
void tcg_wasm64_report_summary(const char *reason,
                               const TCGWasm64Counters *counters);

#endif /* TCG_WASM64_H */
