/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Experimental wasm64 TCG backend runtime.
 *
 * The backend is not selected by default.  Keep the runtime boundary small
 * and conservative: generated WebAssembly TBs receive one context pointer and
 * unsupported work must continue through a correctness fallback.
 */

#include "qemu/osdep.h"
#if !defined(CONFIG_USER_ONLY)
#include "accel/tcg/cpu-mmu-index.h"
#endif
#include "exec/cpu-common.h"
#include "exec/mmu-access-type.h"
#include "exec/memopidx.h"
#include "exec/target_page.h"
#include "exec/tlb-common.h"
#include "exec/tlb-flags.h"
#include "exec/translation-block.h"
#include "accel/tcg/cpu-mmu-index.h"
#include "tcg/tcg.h"
#include "tcg/wasm64.h"

#ifdef CONFIG_EMSCRIPTEN
#include <emscripten/emscripten.h>
#endif

#define TCG_WASM64_TRANSLATE_OUTPUT_INITIAL_WORDS 16u
#define TCG_WASM64_RUNLOOP_ENV_FILE "/qemu-tci-env"
#define TCG_WASM64_RUNLOOP_SMOKE_BUDGET 1000000u
#define TCG_WASM64_RUNLOOP_SMOKE_GUEST_INSNS_PER_STEP 4u
#define TCG_WASM64_RUNLOOP_SMOKE_MIN_SPEEDUP_PPM 3000000u
#define TCG_WASM64_ONE_TB_DIFFERENTIAL_ENV \
    "QEMU_WASM64_ONE_TB_DIFFERENTIAL"
#define TCG_WASM64_LIVE_ONE_TB_DIFFERENTIAL_ENV \
    "QEMU_WASM64_LIVE_ONE_TB_DIFFERENTIAL"
#define TCG_WASM64_LIVE_TB_COVERAGE_ENV \
    "QEMU_WASM64_LIVE_TB_COVERAGE"
#define TCG_WASM64_LIVE_GENERATED_EXEC_ENV \
    "QEMU_WASM64_LIVE_GENERATED_EXEC"
#define TCG_WASM64_LIVE_GENERATED_EXEC_NO_FALLBACK_ENV \
    "QEMU_WASM64_LIVE_GENERATED_EXEC_NO_FALLBACK"
#define TCG_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT_ENV \
    "QEMU_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT"
#define TCG_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT_LIMIT_ENV \
    "QEMU_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT_LIMIT"
#define TCG_WASM64_LIVE_GENERATED_EXEC_CHAIN_BUDGET_ENV \
    "QEMU_WASM64_LIVE_GENERATED_EXEC_CHAIN_BUDGET"
#define TCG_WASM64_LIVE_TB_COVERAGE_SCAN_LIMIT_ENV \
    "QEMU_WASM64_LIVE_TB_COVERAGE_SCAN_LIMIT"
#define TCG_WASM64_ONE_TB_NAME "live-x86-pre-r4i-ld32u-goto-tb-13"
#define TCG_WASM64_LIVE_ONE_TB_NAME "live-x86-r4i-ld32u-goto-tb-11"
#define TCG_WASM64_LIVE_TB_COVERAGE_NAME "live-rv64-generated-coverage"
#define TCG_WASM64_ONE_TB_SCRATCH_SIZE 0x4000u
#define TCG_WASM64_ONE_TB_GENERATED_REGS_OFFSET 0x100u
#define TCG_WASM64_ONE_TB_DATA_OFFSET 0x1000u
#define TCG_WASM64_ONE_TB_CODE_BASE_OFFSET 0x2400u
#define TCG_WASM64_ONE_TB_GOTO_SLOT_DELTA (-0x60)
#define TCG_WASM64_ONE_TB_DISPATCH_TARGET 0x5048u
#define TCG_WASM64_ONE_TB_STATUS_DISPATCH 2u
#define TCG_WASM64_LIVE_TB_STATUS_EXIT 0x20u
#define TCG_WASM64_LIVE_TB_STATUS_DISPATCH 0x21u
#define TCG_WASM64_LIVE_TB_STATUS_HELPER 0x22u
#define TCG_WASM64_LIVE_TB_STATUS_MMIO 0x23u
#define TCG_WASM64_LIVE_TB_STATUS_TLB_MISS_OR_FAULT 0x24u
#define TCG_WASM64_LIVE_TB_STATUS_UNSUPPORTED 0x25u
#define TCG_WASM64_LIVE_TB_STATUS_INVALIDATED 0x26u
#define TCG_WASM64_ONE_TB_EXECUTED_TCI_OP_EQUIVALENTS 11u
#define TCG_WASM64_ONE_TB_MEMORY_LOADS 2u
#define TCG_WASM64_ONE_TB_MEMORY_WRITES 2u
#define TCG_WASM64_LIVE_TB_COVERAGE_DEFAULT_SCAN_LIMIT 50000u
#define TCG_WASM64_LIVE_GENERATED_EXEC_DEFAULT_PREFLIGHT_LIMIT 10000u
#define TCG_WASM64_LIVE_GENERATED_EXEC_DEFAULT_CHAIN_BUDGET 4096u
#define TCG_WASM64_LIVE_HOTSET_SLOT_BACKSCAN 256u

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

typedef enum TCGWasm64LiveGeneratedExecResultIndex {
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_STATUS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_RET,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_GUEST_INSNS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_TCI_OPS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_OUTPUT_WORDS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_CACHE_HIT,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_INDEX,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_OP,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_METADATA_WORD,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_LIVE_WORD,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_PHASE,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_STATUS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_KIND,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_FLAGS,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_INITIAL,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_MAXIMUM,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_HAS_MAXIMUM,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_SHARED,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY64,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_SHAPE_OP_COUNT,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_FIRST_OP,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_TERMINAL_OP,
    TCG_WASM64_LIVE_GENERATED_EXEC_RESULT__MAX,
} TCGWasm64LiveGeneratedExecResultIndex;

typedef enum TCGWasm64LiveGeneratedExecRejectReason {
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_METADATA_MISSING,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_OUTPUT_UNAVAILABLE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SHAPE_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_HELPER_EXIT_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TB_IDENTITY_MISSING_OR_STALE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_RUNTIME_UNAVAILABLE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_DIFFERENTIAL_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_BRANCH_LABEL_RELOCATION,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_POOL_RELOCATION,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_STALE_TB_CODE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_UNKNOWN_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_OUTPUT_UNAVAILABLE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_SHAPE_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_EMISSION_FAILED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_VALIDATION_FAILED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_UNKNOWN,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_STATUS_HELPER,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_STATUS_UNEXPECTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_MISSING_RETURN_TARGET,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GUEST_INSTRUCTION_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TCI_OP_COUNT_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_OUTPUT_WORDS_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_COUNTER_GUEST_INSN_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_LENGTH_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_HELPER_COUNTER_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_QEMU_HELPER_COUNTER_MISMATCH,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_MMIO_EXIT,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TLB_MISS_OR_FAULT_EXIT,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_INVALIDATED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_UNSUPPORTED_BODY_STATE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNPROVEN,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIZE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIGN,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ENDIAN,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ALIGNMENT,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ATOMIC,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_HIGH_FLAGS,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNEXPECTED_MMU_IDX,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_DIRECT_MEMORY_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_CONTROL_FLOW_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_UNAVAILABLE,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_MULTI_ACCESS_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_TLB_MIRROR_INVALID,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_BUDGET,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_TARGET_UNSUPPORTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_INTERRUPTED,
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX,
} TCGWasm64LiveGeneratedExecRejectReason;

#define TCG_WASM64_LIVE_MEMOP_REJECT_SLOTS 8
#define TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES 4
#define TCG_WASM64_LIVE_MULTI_ACCESS_REJECT_SLOTS 8
#define TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_SLOTS 8

typedef struct TCGWasm64LiveMemOpRejectStat {
    MemOp memop;
    uint64_t count;
} TCGWasm64LiveMemOpRejectStat;

typedef struct TCGWasm64MetadataOutputMismatch {
    bool seen;
    TCGWasm64LiveGeneratedExecRejectReason reason;
    uint32_t index;
    uint32_t op;
    uint32_t metadata_word;
    uint32_t live_word;
} TCGWasm64MetadataOutputMismatch;

#define TCG_WASM64_LIVE_MODULE_FAILURE_SHAPE_SLOTS 16
#define TCG_WASM64_LIVE_MODULE_FAILURE_NO_MAX UINT64_MAX

typedef struct TCGWasm64ModuleFailure {
    bool seen;
    TCGWasm64LiveGeneratedExecRejectReason reason;
    uint64_t phase;
    uint64_t status;
    uint32_t shape_op_count;
    uint32_t first_op;
    uint32_t terminal_op;
    uint32_t shape[
        TCG_WASM64_LIVE_MODULE_FAILURE_SHAPE_SLOTS];
    uint32_t memory_kind;
    uint32_t memory_flags;
    uint64_t memory_initial;
    uint64_t memory_maximum;
    bool memory_has_maximum;
    bool memory_shared;
    bool memory64;
} TCGWasm64ModuleFailure;

typedef struct TCGWasm64LiveMultiAccessRejectStat {
    uint32_t access_count;
    uint32_t load_count;
    uint32_t store_count;
    char order[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES + 1];
    MemOp memops[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES];
    bool store_before_later_guard;
    uint64_t count;
} TCGWasm64LiveMultiAccessRejectStat;

typedef enum TCGWasm64LiveDirectMemoryRejectRoute {
    TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_IMMEDIATE_UNSUPPORTED,
    TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_MULTI_ACCESS_ALIAS,
} TCGWasm64LiveDirectMemoryRejectRoute;

typedef struct TCGWasm64LiveDirectMemoryRejectStat {
    TCGWasm64LiveDirectMemoryRejectRoute route;
    TCGOpcode op;
    uint32_t base_reg;
    int32_t offset;
    int32_t size;
    bool env_relative_supported;
    uint32_t softmmu_access_count;
    char softmmu_order[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES + 1];
    uint64_t count;
} TCGWasm64LiveDirectMemoryRejectStat;

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
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, tlb) !=
                  TCG_WASM64_RUN_CTX_TLB_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, tb_generation) !=
                  TCG_WASM64_RUN_CTX_TB_GENERATION_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64RunContext, address_space_generation) !=
                  TCG_WASM64_RUN_CTX_ADDRESS_SPACE_GENERATION_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(TCGWasm64RunContext) != TCG_WASM64_RUN_CTX_SIZE);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, mask) !=
                  TCG_WASM64_TLB_MIRROR_MASK_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, table) !=
                  TCG_WASM64_TLB_MIRROR_TABLE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, fulltlb) !=
                  TCG_WASM64_TLB_MIRROR_FULLTLB_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, generation) !=
                  TCG_WASM64_TLB_MIRROR_GENERATION_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, mmu_idx) !=
                  TCG_WASM64_TLB_MIRROR_MMU_IDX_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, target_page_bits) !=
                  TCG_WASM64_TLB_MIRROR_TARGET_PAGE_BITS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, cpu_tlb_entry_bits) !=
                  TCG_WASM64_TLB_MIRROR_CPU_TLB_ENTRY_BITS_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, tlb_entry_size) !=
                  TCG_WASM64_TLB_MIRROR_TLB_ENTRY_SIZE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, tlb_flags_mask) !=
                  TCG_WASM64_TLB_MIRROR_TLB_FLAGS_MASK_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, tlb_slow_flags_mask) !=
                  TCG_WASM64_TLB_MIRROR_TLB_SLOW_FLAGS_MASK_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(TCGWasm64TLBMirror, flags) !=
                  TCG_WASM64_TLB_MIRROR_FLAGS_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(TCGWasm64TLBMirror) !=
                  TCG_WASM64_TLB_MIRROR_SIZE);
QEMU_BUILD_BUG_ON(CPU_TLB_ENTRY_BITS != TCG_WASM64_CPUTLB_ENTRY_BITS);
QEMU_BUILD_BUG_ON(offsetof(CPUTLBEntry, addr_read) !=
                  TCG_WASM64_CPUTLB_ENTRY_ADDR_READ_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(CPUTLBEntry, addr_write) !=
                  TCG_WASM64_CPUTLB_ENTRY_ADDR_WRITE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(CPUTLBEntry, addr_code) !=
                  TCG_WASM64_CPUTLB_ENTRY_ADDR_CODE_OFFSET);
QEMU_BUILD_BUG_ON(offsetof(CPUTLBEntry, addend) !=
                  TCG_WASM64_CPUTLB_ENTRY_ADDEND_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(CPUTLBEntry) != TCG_WASM64_CPUTLB_ENTRY_SIZE);
QEMU_BUILD_BUG_ON(offsetof(CPUTLBEntryFull, slow_flags) !=
                  TCG_WASM64_CPUTLB_ENTRY_FULL_SLOW_FLAGS_OFFSET);
QEMU_BUILD_BUG_ON(sizeof(CPUTLBEntryFull) !=
                  TCG_WASM64_CPUTLB_ENTRY_FULL_SIZE);
QEMU_BUILD_BUG_ON(MMU_DATA_LOAD != TCG_WASM64_MMU_DATA_LOAD);
QEMU_BUILD_BUG_ON(MMU_DATA_STORE != TCG_WASM64_MMU_DATA_STORE);
/*
 * TARGET_PAGE_BITS is a runtime target_page.bits value when this file is
 * compiled as generic system code.  The TLB mirror stores the actual runtime
 * value, and generated SoftMMU paths fail closed unless it matches the
 * WebAssembly lowering contract.
 */
QEMU_BUILD_BUG_ON(MO_8 != TCG_WASM64_MEMOP_8);
QEMU_BUILD_BUG_ON(MO_16 != TCG_WASM64_MEMOP_16);
QEMU_BUILD_BUG_ON(MO_32 != TCG_WASM64_MEMOP_32);
QEMU_BUILD_BUG_ON(MO_64 != TCG_WASM64_MEMOP_64);
QEMU_BUILD_BUG_ON(MO_SIZE != TCG_WASM64_MEMOP_SIZE);
QEMU_BUILD_BUG_ON(MO_SIGN != TCG_WASM64_MEMOP_SIGN);
QEMU_BUILD_BUG_ON(MO_BSWAP != TCG_WASM64_MEMOP_BSWAP);
QEMU_BUILD_BUG_ON(MO_AMASK != TCG_WASM64_MEMOP_AMASK);
QEMU_BUILD_BUG_ON(MO_ALIGN_TLB_ONLY !=
                  TCG_WASM64_MEMOP_ALIGN_TLB_ONLY);
QEMU_BUILD_BUG_ON(MO_ATOM_NONE != TCG_WASM64_MEMOP_ATOM_NONE);
QEMU_BUILD_BUG_ON(MO_ATOM_MASK != TCG_WASM64_MEMOP_ATOM_MASK);
#ifndef CONFIG_USER_ONLY
QEMU_BUILD_BUG_ON(TLB_BSWAP != TCG_WASM64_TLB_BSWAP);
QEMU_BUILD_BUG_ON(TLB_WATCHPOINT != TCG_WASM64_TLB_WATCHPOINT);
QEMU_BUILD_BUG_ON(TLB_CHECK_ALIGNED != TCG_WASM64_TLB_CHECK_ALIGNED);
QEMU_BUILD_BUG_ON(TLB_DISCARD_WRITE != TCG_WASM64_TLB_DISCARD_WRITE);
QEMU_BUILD_BUG_ON(TLB_MMIO != TCG_WASM64_TLB_MMIO);
QEMU_BUILD_BUG_ON(TLB_INVALID_MASK != TCG_WASM64_TLB_INVALID_MASK);
QEMU_BUILD_BUG_ON(TLB_NOTDIRTY != TCG_WASM64_TLB_NOTDIRTY);
QEMU_BUILD_BUG_ON(TLB_FORCE_SLOW != TCG_WASM64_TLB_FORCE_SLOW);
QEMU_BUILD_BUG_ON(TLB_FLAGS_MASK != TCG_WASM64_TLB_FLAGS_MASK);
QEMU_BUILD_BUG_ON(TLB_SLOW_FLAGS_MASK != TCG_WASM64_TLB_SLOW_FLAGS_MASK);
#endif
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
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_EXIT ==
                  TCG_WASM64_RUN_EXIT_BUDGET);
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_DISPATCH ==
                  TCG_WASM64_RUN_EXIT_MMIO);
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_HELPER ==
                  TCG_WASM64_RUN_EXIT_HELPER);
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_MMIO ==
                  TCG_WASM64_RUN_EXIT_MMIO);
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_TLB_MISS_OR_FAULT ==
                  TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT);
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_UNSUPPORTED ==
                  TCG_WASM64_RUN_EXIT_UNSUPPORTED);
QEMU_BUILD_BUG_ON(TCG_WASM64_LIVE_TB_STATUS_INVALIDATED ==
                  TCG_WASM64_RUN_EXIT_INVALIDATED);
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
    uint32_t *generated_output;
    uint32_t generated_output_capacity;
} TCGWasm64TranslateEntry;

static __thread TCGWasm64Counters *active_counters;
static __thread TCGWasm64Counters translated_counters;
static __thread TCGWasm64RunCounters live_generated_exec_run_counters;
static __thread uint64_t translated_generated_first_unsupported_ops[NB_OPS];
static __thread GHashTable *translate_cache;
static __thread TCGWasm64TranslateEntry *active_translate_entry;
static __thread TCGWasm64TBMetadata *active_translate_metadata;
static __thread uint64_t summary_next_report;
static __thread bool one_tb_differential_checked;
static __thread bool live_one_tb_differential_checked;
static __thread bool live_one_tb_metadata_missing_reported;
static __thread bool live_one_tb_output_unavailable_reported;
static __thread bool live_one_tb_unsupported_shape_reported;
static __thread uint64_t live_one_tb_differential_scanned;
static __thread uint64_t live_generated_exec_attempted;
static __thread uint64_t live_generated_exec_successes;
static __thread uint64_t live_generated_exec_summary_reported_attempts;
static __thread uint64_t live_generated_exec_summary_reported_skips;
static __thread uint64_t live_generated_exec_hotset_probe_attempts;
static __thread uint64_t live_generated_exec_hotset_goto_sources;
static __thread uint64_t live_generated_exec_hotset_target_slots_read;
static __thread uint64_t live_generated_exec_hotset_target_slots_unsafe;
static __thread uint64_t live_generated_exec_hotset_target_metadata_hits;
static __thread uint64_t live_generated_exec_hotset_target_output_hits;
static __thread uint64_t live_generated_exec_hotset_target_stale;
static __thread uint64_t live_generated_exec_selected_body_unsupported_ops[
    NB_OPS];
static __thread uint64_t live_generated_exec_selected_body_helper_exit_skips;
static __thread uint64_t live_generated_exec_selected_body_no_terminal;
static __thread uint64_t live_generated_exec_reject_reasons[
    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX];
static __thread TCGWasm64LiveMemOpRejectStat
    live_generated_exec_reject_memops[
        TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX]
        [TCG_WASM64_LIVE_MEMOP_REJECT_SLOTS];
static __thread TCGWasm64MetadataOutputMismatch
    live_generated_exec_first_metadata_output_mismatch;
static __thread TCGWasm64ModuleFailure
    live_generated_exec_first_module_failure;
static __thread TCGWasm64LiveMultiAccessRejectStat
    live_generated_exec_reject_multi_accesses[
        TCG_WASM64_LIVE_MULTI_ACCESS_REJECT_SLOTS];
static __thread TCGWasm64LiveDirectMemoryRejectStat
    live_generated_exec_reject_direct_memory[
        TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_SLOTS];
static __thread bool live_tb_coverage_checked;
static __thread bool live_tb_coverage_no_shape_reported;
static __thread uint64_t live_tb_coverage_scanned;
static volatile uint64_t tcg_wasm64_runloop_smoke_sink;
static gsize summary_env_initialized;
static gsize live_one_tb_env_initialized;
static gsize live_tb_coverage_env_initialized;
static gsize live_generated_exec_env_initialized;
static bool summary_enabled;
static bool live_one_tb_enabled;
static bool live_tb_coverage_enabled;
static bool live_generated_exec_enabled;
static bool live_generated_exec_no_fallback;
static bool live_generated_exec_preflight;
static uint64_t summary_interval;
static uint64_t live_tb_coverage_scan_limit;
static uint64_t live_generated_exec_preflight_limit;
static uint64_t live_generated_exec_chain_budget;
static uint64_t tcg_wasm64_current_tb_generation = 1;
static uint64_t tcg_wasm64_current_address_space_generation = 1;

static const char *tcg_wasm64_op_name(uint32_t op);
static void tcg_wasm64_report_live_generated_exec_summary(const char *reason);
static const char *
tcg_wasm64_live_generated_exec_js_status_reject_reason(uint64_t status);
static const char *
tcg_wasm64_live_generated_exec_module_failure_phase_name(uint64_t phase);
static TCGWasm64TBMetadata *tcg_wasm64_translate_lookup_mutable(
    const void *tb_ptr);
static void tcg_wasm64_count_live_translation_metadata(
    TCGWasm64TBMetadata *metadata);

static void tcg_wasm64_translate_entry_free(gpointer opaque)
{
    TCGWasm64TranslateEntry *entry = opaque;

    if (!entry) {
        return;
    }
    g_free(entry->generated_output);
    g_free(entry);
}

static GHashTable *tcg_wasm64_translate_cache_table(void)
{
    if (!translate_cache) {
        translate_cache = g_hash_table_new_full(
            g_direct_hash, g_direct_equal, NULL,
            tcg_wasm64_translate_entry_free);
    }
    return translate_cache;
}

static bool tcg_wasm64_translate_entry_valid(
    const TCGWasm64TranslateEntry *entry)
{
    const TCGWasm64TBMetadata *metadata;

    if (!entry) {
        return false;
    }
    metadata = &entry->metadata;
    return entry->tb_ptr &&
           metadata->magic == TCG_WASM64_TB_METADATA_MAGIC &&
           metadata->version == TCG_WASM64_TB_METADATA_VERSION &&
           (metadata->flags & TCG_WASM64_TB_METADATA_VALID);
}

static bool tcg_wasm64_translate_entry_matches(
    const TCGWasm64TranslateEntry *entry, const void *tb_ptr)
{
    return tcg_wasm64_translate_entry_valid(entry) &&
           entry->tb_ptr == tb_ptr &&
           entry->metadata.tb_ptr == tb_ptr;
}

static bool tcg_wasm64_translate_entry_ensure_generated_output(
    TCGWasm64TranslateEntry *entry, uint32_t needed_words)
{
    uint32_t old_capacity;
    uint32_t new_capacity;

    if (needed_words > TCG_WASM64_TRANSLATE_OUTPUT_WORDS) {
        return false;
    }
    if (entry->generated_output_capacity >= needed_words) {
        return true;
    }

    old_capacity = entry->generated_output_capacity;
    new_capacity = old_capacity ? old_capacity :
        TCG_WASM64_TRANSLATE_OUTPUT_INITIAL_WORDS;
    while (new_capacity < needed_words) {
        new_capacity *= 2;
        if (new_capacity > TCG_WASM64_TRANSLATE_OUTPUT_WORDS) {
            new_capacity = TCG_WASM64_TRANSLATE_OUTPUT_WORDS;
            break;
        }
    }

    entry->generated_output = g_renew(uint32_t, entry->generated_output,
                                      new_capacity);
    memset(entry->generated_output + old_capacity, 0,
           (new_capacity - old_capacity) * sizeof(*entry->generated_output));
    entry->generated_output_capacity = new_capacity;
    entry->metadata.generated_output = entry->generated_output;
    return true;
}

static TCGWasm64TranslateEntry *tcg_wasm64_translate_entry_for_insert(
    const void *tb_ptr)
{
    GHashTable *cache = tcg_wasm64_translate_cache_table();
    TCGWasm64TranslateEntry *entry = g_hash_table_lookup(cache, tb_ptr);

    if (!entry) {
        entry = g_new0(TCGWasm64TranslateEntry, 1);
        g_hash_table_insert(cache, (gpointer)tb_ptr, entry);
    }
    return entry;
}

static TCGWasm64TranslateEntry *tcg_wasm64_translate_entry_for_lookup(
    const void *tb_ptr)
{
    TCGWasm64TranslateEntry *entry;

    if (!translate_cache) {
        return NULL;
    }
    entry = g_hash_table_lookup(translate_cache, tb_ptr);
    return tcg_wasm64_translate_entry_matches(entry, tb_ptr) ? entry : NULL;
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
    dst->generated_guest_instructions += src->generated_guest_instructions;
    dst->fallback_guest_instructions += src->fallback_guest_instructions;
    dst->generated_body_time_ns += src->generated_body_time_ns;
    dst->generated_run_entries += src->generated_run_entries;
    dst->generated_chain_length += src->generated_chain_length;
    for (size_t i = 0; i < ARRAY_SIZE(dst->generated_exits); i++) {
        dst->generated_exits[i] += src->generated_exits[i];
    }
    dst->translated_tbs += src->translated_tbs;
    dst->translated_ops += src->translated_ops;
    dst->translated_fallback_markers += src->translated_fallback_markers;
    dst->translated_metadata_lookups += src->translated_metadata_lookups;
    dst->translated_metadata_hits += src->translated_metadata_hits;
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

static bool tcg_wasm64_live_tb_status_to_run_exit_reason(
    uint64_t status, uint32_t *reason)
{
    switch (status) {
    case TCG_WASM64_LIVE_TB_STATUS_EXIT:
    case TCG_WASM64_LIVE_TB_STATUS_DISPATCH:
        *reason = 0;
        return true;
    case TCG_WASM64_LIVE_TB_STATUS_HELPER:
        *reason = TCG_WASM64_RUN_EXIT_HELPER;
        return true;
    case TCG_WASM64_LIVE_TB_STATUS_MMIO:
        *reason = TCG_WASM64_RUN_EXIT_MMIO;
        return true;
    case TCG_WASM64_LIVE_TB_STATUS_TLB_MISS_OR_FAULT:
        *reason = TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT;
        return true;
    case TCG_WASM64_LIVE_TB_STATUS_UNSUPPORTED:
        *reason = TCG_WASM64_RUN_EXIT_UNSUPPORTED;
        return true;
    case TCG_WASM64_LIVE_TB_STATUS_INVALIDATED:
        *reason = TCG_WASM64_RUN_EXIT_INVALIDATED;
        return true;
    default:
        return false;
    }
}

static bool tcg_wasm64_live_tb_status_is_success(uint64_t status)
{
    uint32_t reason;

    return tcg_wasm64_live_tb_status_to_run_exit_reason(status, &reason) &&
           reason == 0;
}

static uint64_t tcg_wasm64_next_generation(uint64_t generation)
{
    generation++;
    return generation == 0 ? 1 : generation;
}

uint64_t tcg_wasm64_tb_generation(void)
{
    return tcg_wasm64_current_tb_generation;
}

uint64_t tcg_wasm64_bump_tb_generation(void)
{
    tcg_wasm64_current_tb_generation =
        tcg_wasm64_next_generation(tcg_wasm64_current_tb_generation);
    return tcg_wasm64_current_tb_generation;
}

uint64_t tcg_wasm64_address_space_generation(void)
{
    return tcg_wasm64_current_address_space_generation;
}

uint64_t tcg_wasm64_bump_address_space_generation(void)
{
    tcg_wasm64_current_address_space_generation =
        tcg_wasm64_next_generation(
            tcg_wasm64_current_address_space_generation);
    return tcg_wasm64_current_address_space_generation;
}

uint64_t tcg_wasm64_tlb_mirror_generation(const TCGWasm64TLBMirror *mirror)
{
    return mirror ? mirror->generation : 0;
}

uint64_t tcg_wasm64_tlb_mirror_bump_generation(TCGWasm64TLBMirror *mirror)
{
    if (!mirror) {
        return 0;
    }
    mirror->generation = tcg_wasm64_next_generation(mirror->generation);
    return mirror->generation;
}

void tcg_wasm64_tlb_mirror_reset(TCGWasm64TLBMirror *mirror)
{
    if (mirror) {
        memset(mirror, 0, sizeof(*mirror));
    }
}

void tcg_wasm64_tlb_mirror_refresh(TCGWasm64TLBMirror *mirror,
                                   CPUArchState *env, uint32_t mmu_idx)
{
    uint64_t generation;

    if (!mirror) {
        return;
    }
    generation = tcg_wasm64_next_generation(mirror->generation);
    tcg_wasm64_tlb_mirror_reset(mirror);
    mirror->generation = generation;

#if defined(CONFIG_TCG) && !defined(CONFIG_USER_ONLY)
    if (!env || mmu_idx >= NB_MMU_MODES) {
        return;
    }

    CPUState *cpu = env_cpu(env);
    CPUTLBDescFast *fast = cpu_tlb_fast(cpu, mmu_idx);
    CPUTLBDesc *desc = &cpu->neg.tlb.d[mmu_idx];

    mirror->mask = fast->mask;
    mirror->table = (uintptr_t)fast->table;
    mirror->fulltlb = (uintptr_t)desc->fulltlb;
    mirror->mmu_idx = mmu_idx;
    mirror->target_page_bits = TARGET_PAGE_BITS;
    mirror->cpu_tlb_entry_bits = CPU_TLB_ENTRY_BITS;
    mirror->tlb_entry_size = sizeof(CPUTLBEntry);
    mirror->tlb_flags_mask = TLB_FLAGS_MASK;
    mirror->tlb_slow_flags_mask = TLB_SLOW_FLAGS_MASK;
    mirror->flags = TCG_WASM64_TLB_MIRROR_VALID;
#endif
}

static bool tcg_wasm64_tlb_mirror_valid(const TCGWasm64TLBMirror *mirror,
                                        uint32_t mmu_idx)
{
    if (!mirror || !(mirror->flags & TCG_WASM64_TLB_MIRROR_VALID)) {
        return false;
    }
    if (mirror->mmu_idx != mmu_idx ||
        mirror->table == 0 ||
        mirror->fulltlb == 0 ||
        mirror->target_page_bits != TARGET_PAGE_BITS ||
        mirror->cpu_tlb_entry_bits != CPU_TLB_ENTRY_BITS ||
        mirror->tlb_entry_size != sizeof(CPUTLBEntry)) {
        return false;
    }
#if defined(CONFIG_TCG) && !defined(CONFIG_USER_ONLY)
    if (mirror->tlb_flags_mask != TLB_FLAGS_MASK ||
        mirror->tlb_slow_flags_mask != TLB_SLOW_FLAGS_MASK) {
        return false;
    }
#endif
    return true;
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

static bool tcg_wasm64_live_tb_coverage_enabled(void)
{
    if (unlikely(g_once_init_enter(&live_tb_coverage_env_initialized))) {
        live_tb_coverage_enabled = tcg_wasm64_runloop_env_bool(
            TCG_WASM64_LIVE_TB_COVERAGE_ENV);
        live_tb_coverage_scan_limit = tcg_wasm64_env_u64(
            TCG_WASM64_LIVE_TB_COVERAGE_SCAN_LIMIT_ENV,
            TCG_WASM64_LIVE_TB_COVERAGE_DEFAULT_SCAN_LIMIT);
        live_tb_coverage_scan_limit = MAX(live_tb_coverage_scan_limit, 1);
        g_once_init_leave(&live_tb_coverage_env_initialized, 1);
    }
    return live_tb_coverage_enabled;
}

static bool tcg_wasm64_live_generated_exec_enabled(void)
{
    if (unlikely(g_once_init_enter(&live_generated_exec_env_initialized))) {
        live_generated_exec_enabled = tcg_wasm64_runloop_env_bool(
            TCG_WASM64_LIVE_GENERATED_EXEC_ENV);
        live_generated_exec_no_fallback = tcg_wasm64_runloop_env_bool(
            TCG_WASM64_LIVE_GENERATED_EXEC_NO_FALLBACK_ENV);
        live_generated_exec_preflight = tcg_wasm64_runloop_env_bool(
            TCG_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT_ENV);
        live_generated_exec_preflight_limit = tcg_wasm64_env_u64(
            TCG_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT_LIMIT_ENV,
            TCG_WASM64_LIVE_GENERATED_EXEC_DEFAULT_PREFLIGHT_LIMIT);
        live_generated_exec_preflight_limit = MAX(
            live_generated_exec_preflight_limit, 1);
        live_generated_exec_chain_budget = tcg_wasm64_env_u64(
            TCG_WASM64_LIVE_GENERATED_EXEC_CHAIN_BUDGET_ENV,
            TCG_WASM64_LIVE_GENERATED_EXEC_DEFAULT_CHAIN_BUDGET);
        live_generated_exec_chain_budget = MAX(
            live_generated_exec_chain_budget, 1);
        g_once_init_leave(&live_generated_exec_env_initialized, 1);
    }
    return live_generated_exec_enabled;
}

static bool tcg_wasm64_live_generated_exec_no_fallback(void)
{
    (void)tcg_wasm64_live_generated_exec_enabled();
    return live_generated_exec_no_fallback;
}

static bool tcg_wasm64_live_generated_exec_preflight(void)
{
    (void)tcg_wasm64_live_generated_exec_enabled();
    return live_generated_exec_preflight;
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
    tcg_wasm64_report_live_generated_exec_summary("interval");
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
    const envRelativeBaseReg = 14;
    const envRelativeMinOffset = -16;
    const envRelativeMaxExclusive = 0x120;
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

    function envRelativeOffset(insn, r1, size) {
        const offset = sextract(insn, 16, 16);
        if (r1 !== envRelativeBaseReg ||
            offset < envRelativeMinOffset ||
            offset + size > envRelativeMaxExclusive) {
            throw new Error("unsupported live one-TB env-relative memory");
        }
        return BigInt(offset);
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
                                       envRelativeOffset(insn, r1, 4))))));
                inlineLoads++;
            } else if (opc === ops.ld) {
                emitted.push(...localSet(regLocal(r0),
                    i64Load(addressAdd(localGet(regLocal(r1)),
                                       envRelativeOffset(insn, r1, 8)))));
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
                               envRelativeOffset(insn, r1, 1)),
                    i32WrapI64(localGet(regLocal(r0)))));
                inlineStores++;
            } else if (opc === ops.st) {
                emitted.push(...i64Store(
                    addressAdd(localGet(regLocal(r1)),
                               envRelativeOffset(insn, r1, 8)),
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

EM_JS(int, tcg_wasm64_live_generated_exec_js,
      (uintptr_t context_arg, uintptr_t scratch_arg, uintptr_t counters_arg,
       uintptr_t exit_arg, uintptr_t result_arg, uintptr_t tb_arg,
       uintptr_t env_arg, uint64_t guest_insns_arg,
       uintptr_t generated_output_arg, uint32_t generated_output_size_arg,
       uint32_t tb_code_size_arg), {
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
    const tbCodeSize = Number(tb_code_size_arg);
    const stackPtr = scratch + 0x3000;
    const statusExit = 0x20n;
    const statusDispatch = 0x21n;
    const statusMmio = 0x23n;
    const statusTlbMissOrFault = 0x24n;
    const statusUnsupported = 0x25n;
    const resultMismatchIndex = 7;
    const resultMismatchOp = 8;
    const resultMismatchMetadataWord = 9;
    const resultMismatchLiveWord = 10;
    const runExitNone = 0;
    const runExitMmio = 2;
    const runExitTlbMissOrFault = 3;
    const runExitUnsupported = 6;
    const runExitFlagPageCrossing = 1;
    const runCtxTlbOffset = 48;
    const valueI32 = 0x7f;
    const valueI64 = 0x7e;
    const liveMemoryImportMemory64 = true;
    const envRelativeBaseReg = 14;
    const envRelativeMinOffset = -16;
    const envRelativeMaxExclusive = 0x120;
    const tlbMirror = {
        mask: 0,
        table: 8,
        fulltlb: 16,
        mmuIdx: 32,
        targetPageBits: 36,
        cpuTlbEntryBits: 40,
        tlbEntrySize: 44,
        tlbFlagsMask: 48,
        tlbSlowFlagsMask: 52,
        flags: 56,
    };
    const tlbMirrorValid = 1;
    const tlbEntry = {
        addrRead: 0,
        addrWrite: 8,
        addend: 24,
        size: 32,
        bits: 5,
    };
    const tlbEntryFull = {
        slowFlags: 35,
        size: 48,
    };
    const tlbConstants = {
        targetPageBits: 12,
        targetPageMask: -4096n,
        invalidMask: 64n,
        flagsMask: 448n,
        slowFlagsMask: 31,
        mmio: 16,
        mmuDataLoad: 0,
        mmuDataStore: 1,
    };
    const memOp = {
        sizeMask: 7n,
        byte: 0n,
        word: 2n,
        quad: 3n,
        atomNone: 2560n,
        atomMask: 3584n,
    };
    const memOpIdxShift = 5n;
    const memOpIdxMmuMask = 31n;
    const runExit = {
        reason: 0,
        vaddr: 16,
        paddr: 24,
        value: 32,
        size: 40,
        flags: 44,
    };
    const runCounters = {
        generatedGuestInstructions: 0,
        generatedChainLength: 80,
        inlineTlbHitLoads: 88,
        inlineTlbHitStores: 96,
        exitsMmio: 136,
        exitsTlbMissOrFault: 144,
        exitsUnsupported: 168,
    };
    const ops = {
        brcond: 4,
        mb: 5,
        mov: 6,
        add: 7,
        and: 8,
        deposit: 16,
        extract: 22,
        ld32u: 28,
        ld32s: 29,
        ld: 30,
        mul: 32,
        neg: 38,
        or: 42,
        setcond: 49,
        sextract: 50,
        shl: 51,
        shr: 52,
        st8: 53,
        st32: 55,
        st: 56,
        sub: 57,
        xor: 58,
        exit_tb: 72,
        goto_tb: 73,
        tci_movi: 125,
        tci_movl: 126,
        tci_qemu_ld_rrr: 138,
        tci_qemu_st_rrr: 139,
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

    function name(text) {
        const bytes = Array.from(new TextEncoder().encode(text));
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
            ...vector(results.map((value) => [value])),
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

    function i64ExtendI32S(expr) {
        return [...expr, 0xac];
    }

    function i64ExtendI32U(expr) {
        return [...expr, 0xad];
    }

    function memoryAddress(expr) {
        return liveMemoryImportMemory64 ? expr : i32WrapI64(expr);
    }

    function i64Load(address, offset = 0) {
        return [...memoryAddress(address), 0x29, ...memArg(3, offset)];
    }

    function i32Load(address, offset = 0) {
        return [...memoryAddress(address), 0x28, ...memArg(2, offset)];
    }

    function i32Load8U(address, offset = 0) {
        return [...memoryAddress(address), 0x2d, ...memArg(0, offset)];
    }

    function i64Store(address, value) {
        return [...memoryAddress(address), ...value, 0x37, ...memArg(3, 0)];
    }

    function i32Store8(address, value) {
        return [...memoryAddress(address), ...value, 0x3a, ...memArg(0, 0)];
    }

    function i32Store(address, value) {
        return [...memoryAddress(address), ...value, 0x36, ...memArg(2, 0)];
    }

    function i64LoadAtPtr(ptrLocal, offset) {
        return i64Load(localGet(ptrLocal), offset);
    }

    function i64StoreAtPtr(ptrLocal, offset, value) {
        return [...memoryAddress(localGet(ptrLocal)), ...value,
                0x37, ...memArg(3, offset)];
    }

    function i32StoreAtPtr(ptrLocal, offset, value) {
        return [...memoryAddress(localGet(ptrLocal)), ...value,
                0x36, ...memArg(2, offset)];
    }

    function addressAdd(base, offset) {
        return i64Add(base, i64Const(offset));
    }

    function i64Mul(lhs, rhs) {
        return [...lhs, ...rhs, 0x7e];
    }

    function i64And(lhs, rhs) {
        return [...lhs, ...rhs, 0x83];
    }

    function i64Xor(lhs, rhs) {
        return [...lhs, ...rhs, 0x85];
    }

    function i64Shl(lhs, rhs) {
        return [...lhs, ...rhs, 0x86];
    }

    function i64ShrU(lhs, rhs) {
        return [...lhs, ...rhs, 0x88];
    }

    function i64Eq(lhs, rhs) {
        return [...lhs, ...rhs, 0x51];
    }

    function i64Ne(lhs, rhs) {
        return [...lhs, ...rhs, 0x52];
    }

    function i32And(lhs, rhs) {
        return [...lhs, ...rhs, 0x71];
    }

    function i32Ne(lhs, rhs) {
        return [...lhs, ...rhs, 0x47];
    }

    function incrementCounter(ptrLocal, offset, value) {
        return i64StoreAtPtr(ptrLocal, offset, i64Add(
            i64LoadAtPtr(ptrLocal, offset), i64Const(BigInt(value))));
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

    function opName(opc) {
        for (const [name, value] of Object.entries(ops)) {
            if (value === opc) {
                return name;
            }
        }
        return "unknown";
    }

    function readGeneratedOutputWords() {
        if (generatedOutputPtr === 0 || generatedOutputSize === 0 ||
            generatedOutputSize % 4 !== 0) {
            return null;
        }
        const wordCount = generatedOutputSize / 4;
        const words = [];
        for (let i = 0; i < wordCount; i++) {
            words.push(HEAPU32[generatedOutputPtr / 4 + i] >>> 0);
        }
        return words;
    }

    function brcondLabelRelocation(metadataWord, liveWord) {
        const metadataOp = bits(metadataWord >>> 0, 0, 8);
        const liveOp = bits(liveWord >>> 0, 0, 8);

        return metadataOp === ops.brcond &&
               liveOp === ops.brcond &&
               ((metadataWord ^ liveWord) & 0xfff) === 0;
    }

    function tciMovlPoolRelocation(metadataWord, liveWord) {
        const metadata = metadataWord >>> 0;
        const live = liveWord >>> 0;

        return bits(metadata, 0, 8) === ops.tci_movl &&
               bits(live, 0, 8) === ops.tci_movl &&
               ((metadata ^ live) & 0xfff) === 0 &&
               metadata !== live;
    }

    function tciMovlPoolTargetInTb(index, word) {
        const offset = (index + 1) * 4 + sextract(word >>> 0, 12, 20);

        return Number.isInteger(tbCodeSize) &&
               offset >= 0 &&
               offset + 8 <= tbCodeSize;
    }

    function normalizeGeneratedOutputWords(words) {
        const normalized = words.slice();

        for (let i = 0; i < normalized.length; i++) {
            const metadataWord = normalized[i] >>> 0;
            const liveWord = HEAPU32[tbPtr / 4 + i] >>> 0;

            if (metadataWord === liveWord) {
                if (bits(metadataWord, 0, 8) === ops.tci_movl &&
                    !tciMovlPoolTargetInTb(i, liveWord)) {
                    recordMetadataOutputMismatch(i, metadataWord, liveWord);
                    return null;
                }
                continue;
            }
            if (brcondLabelRelocation(metadataWord, liveWord)) {
                normalized[i] = liveWord;
                continue;
            }
            if (tciMovlPoolRelocation(metadataWord, liveWord) &&
                tciMovlPoolTargetInTb(i, liveWord)) {
                normalized[i] = liveWord;
                continue;
            }
            recordMetadataOutputMismatch(i, metadataWord, liveWord);
            return null;
        }
        return normalized;
    }

    function generatedOutputShapeSupported(words) {
        let terminalSeen = false;

        for (const insn of words) {
            const opc = bits(insn >>> 0, 0, 8);

            if (terminalSeen) {
                continue;
            }
            if (!Object.values(ops).includes(opc)) {
                return false;
            }
            if (opc === ops.goto_tb || opc === ops.exit_tb) {
                terminalSeen = true;
            }
        }
        return terminalSeen;
    }

    function generatedOutputChecksum(words) {
        let hash = 2166136261 >>> 0;

        for (const word of words) {
            for (let byte = 0; byte < 4; byte++) {
                hash ^= (word >>> (byte * 8)) & 0xff;
                hash = Math.imul(hash, 16777619) >>> 0;
            }
        }
        return hash >>> 0;
    }

    function envRelativeOffset(insn, r1, size) {
        const offset = sextract(insn, 16, 16);
        if (r1 !== envRelativeBaseReg ||
            offset < envRelativeMinOffset ||
            offset + size > envRelativeMaxExclusive) {
            throw new Error("unsupported live generated env-relative memory");
        }
        return BigInt(offset);
    }

    function compare32Expr(lhs, rhs, condition) {
        switch (condition) {
        case 0: return [0x41, 0x00];
        case 1: return [0x41, 0x01];
        case 8: return [...lhs, ...rhs, 0x46];
        case 9: return [...lhs, ...rhs, 0x47];
        case 12: return [...lhs, ...rhs, 0x71, 0x45];
        case 13: return [...lhs, ...rhs, 0x71, 0x45, 0x45];
        case 2: return [...lhs, ...rhs, 0x48];
        case 3: return [...lhs, ...rhs, 0x4e];
        case 6: return [...lhs, ...rhs, 0x4a];
        case 7: return [...lhs, ...rhs, 0x4c];
        case 10: return [...lhs, ...rhs, 0x49];
        case 11: return [...lhs, ...rhs, 0x4f];
        case 14: return [...lhs, ...rhs, 0x4b];
        case 15: return [...lhs, ...rhs, 0x4d];
        default: return null;
        }
    }

    function compare64Expr(lhs, rhs, condition) {
        switch (condition) {
        case 0: return [0x41, 0x00];
        case 1: return [0x41, 0x01];
        case 8: return [...lhs, ...rhs, 0x51];
        case 9: return [...lhs, ...rhs, 0x52];
        case 12: return [...lhs, ...rhs, 0x83, 0x50];
        case 13: return [...lhs, ...rhs, 0x83, 0x50, 0x45];
        case 2: return [...lhs, ...rhs, 0x53];
        case 3: return [...lhs, ...rhs, 0x59];
        case 6: return [...lhs, ...rhs, 0x55];
        case 7: return [...lhs, ...rhs, 0x57];
        case 10: return [...lhs, ...rhs, 0x54];
        case 11: return [...lhs, ...rhs, 0x5a];
        case 14: return [...lhs, ...rhs, 0x56];
        case 15: return [...lhs, ...rhs, 0x58];
        default: return null;
        }
    }

    function buildGeneratedInstructions(words) {
        const countersPtr = 1;
        const exitPtr = 2;
        const regLocalBase = 3;
        const emitted = [
            ...localSet(countersPtr, i64LoadAtPtr(0, 24)),
            ...localSet(exitPtr, i64LoadAtPtr(0, 32)),
        ];
        let inlineLoads = 0;
        let inlineStores = 0;
        let executedOps = 0;
        let terminal = null;
        const softTlbPtr = 19;
        const softSlowFlags = 20;
        const softTaddr = 21;
        const softOi = 22;
        const softMemop = 23;
        const softSize = 24;
        const softValue = 25;
        const softMask = 26;
        const softTablePtr = 27;
        const softFulltlbPtr = 28;
        const softIndex = 29;
        const softEntryPtr = 30;
        const softFullPtr = 31;
        const softComparator = 32;
        const softAddend = 33;
        const softHostAddr = 34;
        const softMaxDeferredAccesses = 4;
        const softAccessLocalBase = 35;
        const directMemoryMaxDeferredStores = 4;
        const directMemoryStoreValueLocalBase =
            softAccessLocalBase + softMaxDeferredAccesses * 4;
        const directMemoryStoreAddressLocalBase =
            directMemoryStoreValueLocalBase + directMemoryMaxDeferredStores;
        const terminalIndex = words.findIndex((insn) => {
            const opc = bits(insn >>> 0, 0, 8);

            return opc === ops.goto_tb || opc === ops.exit_tb;
        });
        const bodyWords = terminalIndex < 0 ?
            words : words.slice(0, terminalIndex);
        const softmmuAccessCount = bodyWords.filter((insn) => {
            const opc = bits(insn >>> 0, 0, 8);

            return opc === ops.tci_qemu_ld_rrr ||
                   opc === ops.tci_qemu_st_rrr;
        }).length;
        const allOrNothingSoftmmu = softmmuAccessCount > 1;
        const deferredSoftmmuCommits = [];
        let nextSoftmmuAccessIndex = 0;
        let nextDirectStoreIndex = 0;
        let softLoadAfterStore = false;
        let sawSoftStore = false;

        for (const insn of bodyWords) {
            const opc = bits(insn >>> 0, 0, 8);

            if (opc === ops.tci_qemu_st_rrr) {
                sawSoftStore = true;
            } else if (opc === ops.tci_qemu_ld_rrr && sawSoftStore) {
                softLoadAfterStore = true;
                break;
            }
        }

        function regLocal(reg) {
            return regLocalBase + reg;
        }

        function ifBlock(condition, thenBody) {
            return [...condition, 0x04, 0x40, ...thenBody, 0x0b];
        }

        function softAccessLocal(index, field) {
            return softAccessLocalBase + index * 4 + field;
        }

        function directMemoryStoreValueLocal(index) {
            return directMemoryStoreValueLocalBase + index;
        }

        function directMemoryStoreAddressLocal(index) {
            return directMemoryStoreAddressLocalBase + index;
        }

        function directMemorySize(opc) {
            if (opc === ops.st8) {
                return 1;
            }
            if (opc === ops.ld32u || opc === ops.ld32s ||
                opc === ops.st32) {
                return 4;
            }
            if (opc === ops.ld || opc === ops.st) {
                return 8;
            }
            return null;
        }

        function directMemoryIsStore(opc) {
            return opc === ops.st8 || opc === ops.st32 || opc === ops.st;
        }

        function directMemoryRange(insn) {
            const opc = bits(insn >>> 0, 0, 8);
            const size = directMemorySize(opc);

            return size === null ? null : {
                offset: sextract(insn >>> 0, 16, 16),
                size,
            };
        }

        function directMemoryRangesOverlap(lhs, rhs) {
            return lhs.offset < rhs.offset + rhs.size &&
                   rhs.offset < lhs.offset + lhs.size;
        }

        function directMemorySupported(insn) {
            const range = directMemoryRange(insn);
            const r1 = bits(insn >>> 0, 12, 4);

            return range === null ||
                   (r1 === envRelativeBaseReg &&
                    range.offset >= envRelativeMinOffset &&
                    range.offset + range.size <= envRelativeMaxExclusive);
        }

        function incrementRunCounter(offset) {
            return incrementCounter(countersPtr, offset, 1);
        }

        function returnUnsupported() {
            return [
                ...i32StoreAtPtr(exitPtr, runExit.reason,
                                 i32Const(runExitUnsupported)),
                ...i64StoreAtPtr(exitPtr, runExit.value, i64Const(0n)),
                ...incrementRunCounter(runCounters.exitsUnsupported),
                ...i64Const(statusUnsupported),
                0x0f,
            ];
        }

        function softmmuStoreExit(reason, sizeExpr, flags) {
            return [
                ...i32StoreAtPtr(exitPtr, runExit.reason,
                                 i32Const(reason)),
                ...i64StoreAtPtr(exitPtr, runExit.vaddr,
                                 localGet(softTaddr)),
                ...i64StoreAtPtr(exitPtr, runExit.paddr,
                                 i64Const(0n)),
                ...i32StoreAtPtr(exitPtr, runExit.size, sizeExpr),
                ...i32StoreAtPtr(exitPtr, runExit.flags,
                                 i32Const(flags)),
            ];
        }

        function softmmuFailureReturn({
            status,
            reason,
            sizeExpr = i32Const(0),
            flags = 0,
        }) {
            return [
                ...softmmuStoreExit(reason, sizeExpr, flags),
                ...i64Const(status),
                0x0f,
            ];
        }

        function softmmuAccessType(access) {
            return access === "store" ? tlbConstants.mmuDataStore :
                                        tlbConstants.mmuDataLoad;
        }

        function softmmuComparatorOffset(access) {
            return access === "store" ? tlbEntry.addrWrite :
                                        tlbEntry.addrRead;
        }

        function compileSoftmmuTlbAccess({
            access,
            dst,
            addrReg,
            valueReg,
            oiReg,
            accessIndex = 0,
        }) {
            const accessType = softmmuAccessType(access);
            const comparatorOffset = softmmuComparatorOffset(access);
            const inlineCounterOffset = access === "store" ?
                runCounters.inlineTlbHitStores :
                runCounters.inlineTlbHitLoads;
            const hostLocal = softAccessLocal(accessIndex, 0);
            const valueLocal = softAccessLocal(accessIndex, 1);
            const memopLocal = softAccessLocal(accessIndex, 2);
            const unsupportedReturn = softmmuFailureReturn({
                status: statusUnsupported,
                reason: runExitUnsupported,
            });
            const tlbMissReturn = softmmuFailureReturn({
                status: statusTlbMissOrFault,
                reason: runExitTlbMissOrFault,
                sizeExpr: i32WrapI64(localGet(softSize)),
            });
            const pageCrossingReturn = softmmuFailureReturn({
                status: statusTlbMissOrFault,
                reason: runExitTlbMissOrFault,
                sizeExpr: i32WrapI64(localGet(softSize)),
                flags: runExitFlagPageCrossing,
            });
            const mmioReturn = softmmuFailureReturn({
                status: statusMmio,
                reason: runExitMmio,
                sizeExpr: i32WrapI64(localGet(softSize)),
            });
            const loadByte = i64ExtendI32U(i32Load8U(
                localGet(softHostAddr)));
            const loadWord = i64ExtendI32U(i32Load(
                localGet(softHostAddr)));
            const loadQuad = i64Load(localGet(softHostAddr));
            const storeByte = i32Store8(
                localGet(hostLocal),
                i32WrapI64(localGet(valueLocal)));
            const storeWord = i32Store(
                localGet(hostLocal),
                i32WrapI64(localGet(valueLocal)));
            const storeQuad = i64Store(
                localGet(hostLocal),
                localGet(valueLocal));

            const guard = [
                ...localSet(softTaddr, localGet(addrReg)),
                ...localSet(softOi, localGet(oiReg)),
                ...(access === "store"
                    ? localSet(softValue, localGet(valueReg)) : []),
                ...localSet(softSize, i64Const(0n)),
                ...localSet(softTlbPtr,
                    i64LoadAtPtr(0, runCtxTlbOffset)),
                ...ifBlock(i64Eq(localGet(softTlbPtr), i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32And(
                        i32Load(localGet(softTlbPtr), tlbMirror.flags),
                        i32Const(tlbMirrorValid)),
                    i32Const(tlbMirrorValid)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32Load(localGet(softTlbPtr),
                            tlbMirror.targetPageBits),
                    i32Const(tlbConstants.targetPageBits)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32Load(localGet(softTlbPtr),
                            tlbMirror.cpuTlbEntryBits),
                    i32Const(tlbEntry.bits)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32Load(localGet(softTlbPtr), tlbMirror.tlbEntrySize),
                    i32Const(tlbEntry.size)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32Load(localGet(softTlbPtr),
                            tlbMirror.tlbFlagsMask),
                    i32Const(Number(tlbConstants.flagsMask))),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32Load(localGet(softTlbPtr),
                            tlbMirror.tlbSlowFlagsMask),
                    i32Const(tlbConstants.slowFlagsMask)),
                    unsupportedReturn),
                ...localSet(softMemop,
                    i64ShrU(localGet(softOi), i64Const(memOpIdxShift))),
                ...ifBlock(i64Ne(
                    i64And(localGet(softMemop),
                           i64Const(~(memOp.sizeMask | memOp.atomMask))),
                    i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softMemop), i64Const(memOp.atomMask)),
                    i64Const(memOp.atomNone)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32WrapI64(i64And(localGet(softOi),
                                      i64Const(memOpIdxMmuMask))),
                    i32Load(localGet(softTlbPtr), tlbMirror.mmuIdx)),
                    unsupportedReturn),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.byte)),
                    localSet(softSize, i64Const(1n))),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.word)),
                    localSet(softSize, i64Const(4n))),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.quad)),
                    localSet(softSize, i64Const(8n))),
                ...ifBlock(i64Eq(localGet(softSize), i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Ne(
                    i64And(
                        i64Xor(localGet(softTaddr),
                               i64Add(localGet(softTaddr),
                                      i64Add(localGet(softSize),
                                             i64Const(-1n)))),
                        i64Const(tlbConstants.targetPageMask)),
                    i64Const(0n)),
                    pageCrossingReturn),
                ...localSet(softMask,
                    i64Load(localGet(softTlbPtr), tlbMirror.mask)),
                ...localSet(softTablePtr,
                    i64Load(localGet(softTlbPtr), tlbMirror.table)),
                ...localSet(softFulltlbPtr,
                    i64Load(localGet(softTlbPtr), tlbMirror.fulltlb)),
                ...ifBlock(i64Eq(localGet(softTablePtr), i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Eq(localGet(softFulltlbPtr), i64Const(0n)),
                    unsupportedReturn),
                ...localSet(softIndex,
                    i64And(
                        i64ShrU(localGet(softTaddr),
                                i64Const(BigInt(
                                    tlbConstants.targetPageBits))),
                        i64ShrU(localGet(softMask),
                                i64Const(BigInt(tlbEntry.bits))))),
                ...localSet(softEntryPtr,
                    i64Add(localGet(softTablePtr),
                           i64Shl(localGet(softIndex),
                                  i64Const(BigInt(tlbEntry.bits))))),
                ...localSet(softFullPtr,
                    i64Add(localGet(softFulltlbPtr),
                           i64Mul(localGet(softIndex),
                                  i64Const(BigInt(tlbEntryFull.size))))),
                ...localSet(softComparator,
                    i64Load(localGet(softEntryPtr), comparatorOffset)),
                ...localSet(softAddend,
                    i64Load(localGet(softEntryPtr), tlbEntry.addend)),
                ...localSet(softSlowFlags,
                    i64ExtendI32U(i32Load8U(
                        localGet(softFullPtr),
                        tlbEntryFull.slowFlags + accessType))),
                ...ifBlock(i64Ne(
                    i64And(localGet(softComparator),
                           i64Const(tlbConstants.targetPageMask)),
                    i64And(localGet(softTaddr),
                           i64Const(tlbConstants.targetPageMask))),
                    tlbMissReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softComparator),
                           i64Const(tlbConstants.invalidMask)),
                    i64Const(0n)),
                    tlbMissReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softSlowFlags),
                           i64Const(BigInt(tlbConstants.mmio))),
                    i64Const(0n)),
                    mmioReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softComparator),
                           i64Const(tlbConstants.flagsMask)),
                    i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softSlowFlags),
                           i64Const(BigInt(
                               tlbConstants.slowFlagsMask))),
                    i64Const(0n)),
                    unsupportedReturn),
                ...localSet(softHostAddr,
                    i64Add(localGet(softTaddr), localGet(softAddend))),
                ...localSet(hostLocal, localGet(softHostAddr)),
                ...localSet(memopLocal, localGet(softMemop)),
                ...(access === "store" ? [
                    ...localSet(valueLocal, localGet(softValue)),
                ] : [
                    ...ifBlock(i64Eq(
                        i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                        i64Const(memOp.byte)),
                        localSet(dst, loadByte)),
                    ...ifBlock(i64Eq(
                        i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                        i64Const(memOp.word)),
                        localSet(dst, loadWord)),
                    ...ifBlock(i64Eq(
                        i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                        i64Const(memOp.quad)),
                        localSet(dst, loadQuad)),
                ]),
            ];
            const commit = access === "store" ? [
                ...ifBlock(i64Eq(
                    i64And(localGet(memopLocal), i64Const(memOp.sizeMask)),
                    i64Const(memOp.byte)),
                    storeByte),
                ...ifBlock(i64Eq(
                    i64And(localGet(memopLocal), i64Const(memOp.sizeMask)),
                    i64Const(memOp.word)),
                    storeWord),
                ...ifBlock(i64Eq(
                    i64And(localGet(memopLocal), i64Const(memOp.sizeMask)),
                    i64Const(memOp.quad)),
                    storeQuad),
                ...incrementRunCounter(inlineCounterOffset),
            ] : [
                ...incrementRunCounter(inlineCounterOffset),
            ];

            return { guard, commit };
        }

        function compileOp(index, insn) {
            const opc = bits(insn, 0, 8);
            const r0 = bits(insn, 8, 4);
            const r1 = bits(insn, 12, 4);
            const r2 = bits(insn, 16, 4);
            const dst = regLocal(r0);
            const src1 = regLocal(r1);
            const src2 = regLocal(r2);
            let address;
            let addressLocal;
            let valueLocal;

            if (opc === ops.tci_movi) {
                return localSet(dst, i64Const(sextract(insn, 12, 20)));
            }
            if (opc === ops.tci_movl) {
                const currentTbPtr = (index + 1) * 4;
                return localSet(dst, i64Load(i64Const(
                    BigInt(tbPtr + currentTbPtr + sextract(insn, 12, 20)))));
            }
            if (opc === ops.ld32u || opc === ops.ld32s) {
                address = addressAdd(localGet(src1),
                                     envRelativeOffset(insn, r1, 4));
                inlineLoads++;
                return localSet(dst, opc === ops.ld32u ?
                    i64ExtendI32U(i32Load(address)) :
                    i64ExtendI32S(i32Load(address)));
            }
            if (opc === ops.ld) {
                address = addressAdd(localGet(src1),
                                     envRelativeOffset(insn, r1, 8));
                inlineLoads++;
                return localSet(dst, i64Load(address));
            }
            if (opc === ops.st8) {
                address = addressAdd(localGet(src1),
                                     envRelativeOffset(insn, r1, 1));
                inlineStores++;
                if (!allOrNothingSoftmmu) {
                    return i32Store8(address, i32WrapI64(localGet(dst)));
                }
                addressLocal =
                    directMemoryStoreAddressLocal(nextDirectStoreIndex);
                valueLocal = directMemoryStoreValueLocal(nextDirectStoreIndex++);
                return {
                    guard: [
                        ...localSet(addressLocal, address),
                        ...localSet(valueLocal, localGet(dst)),
                    ],
                    commit: i32Store8(localGet(addressLocal),
                                      i32WrapI64(localGet(valueLocal))),
                };
            }
            if (opc === ops.st32) {
                address = addressAdd(localGet(src1),
                                     envRelativeOffset(insn, r1, 4));
                inlineStores++;
                if (!allOrNothingSoftmmu) {
                    return i32Store(address, i32WrapI64(localGet(dst)));
                }
                addressLocal =
                    directMemoryStoreAddressLocal(nextDirectStoreIndex);
                valueLocal = directMemoryStoreValueLocal(nextDirectStoreIndex++);
                return {
                    guard: [
                        ...localSet(addressLocal, address),
                        ...localSet(valueLocal, localGet(dst)),
                    ],
                    commit: i32Store(localGet(addressLocal),
                                     i32WrapI64(localGet(valueLocal))),
                };
            }
            if (opc === ops.st) {
                address = addressAdd(localGet(src1),
                                     envRelativeOffset(insn, r1, 8));
                inlineStores++;
                if (!allOrNothingSoftmmu) {
                    return i64Store(address, localGet(dst));
                }
                addressLocal =
                    directMemoryStoreAddressLocal(nextDirectStoreIndex);
                valueLocal = directMemoryStoreValueLocal(nextDirectStoreIndex++);
                return {
                    guard: [
                        ...localSet(addressLocal, address),
                        ...localSet(valueLocal, localGet(dst)),
                    ],
                    commit: i64Store(localGet(addressLocal),
                                     localGet(valueLocal)),
                };
            }
            if (opc === ops.mov) {
                return localSet(dst, localGet(src1));
            }
            if (opc === ops.add || opc === ops.sub || opc === ops.mul ||
                opc === ops.and || opc === ops.or || opc === ops.xor ||
                opc === ops.shl || opc === ops.shr) {
                const opByte = opc === ops.add ? 0x7c :
                               opc === ops.sub ? 0x7d :
                               opc === ops.mul ? 0x7e :
                               opc === ops.and ? 0x83 :
                               opc === ops.or ? 0x84 :
                               opc === ops.xor ? 0x85 :
                               opc === ops.shl ? 0x86 : 0x88;
                return localSet(dst, [
                    ...localGet(src1),
                    ...localGet(src2),
                    opByte,
                ]);
            }
            if (opc === ops.neg) {
                return localSet(dst, [
                    ...i64Const(0n),
                    ...localGet(src1),
                    0x7d,
                ]);
            }
            if (opc === ops.extract || opc === ops.sextract) {
                const pos = bits(insn, 16, 6);
                const len = bits(insn, 22, 6);

                if (len === 0 || pos + len > 64) {
                    return null;
                }
                if (opc === ops.extract) {
                    const mask = len === 64 ? -1n :
                        ((1n << BigInt(len)) - 1n);
                    return localSet(dst, [
                        ...localGet(src1),
                        ...i64Const(pos),
                        0x88,
                        ...i64Const(mask),
                        0x83,
                    ]);
                }
                const shift = 64 - pos - len;
                return localSet(dst, [
                    ...localGet(src1),
                    ...i64Const(shift),
                    0x86,
                    ...i64Const(shift),
                    0x87,
                ]);
            }
            if (opc === ops.deposit) {
                const pos = bits(insn, 20, 6);
                const len = bits(insn, 26, 6);

                if (len === 0 || pos + len > 64) {
                    return null;
                }
                const mask = len === 64 ? -1n :
                    ((1n << BigInt(len)) - 1n);
                const clearMask = BigInt.asUintN(
                    64, ~(BigInt.asUintN(64, mask) << BigInt(pos)));
                return localSet(dst, [
                    ...localGet(src1),
                    ...i64Const(clearMask),
                    0x83,
                    ...localGet(src2),
                    ...i64Const(mask),
                    0x83,
                    ...i64Const(pos),
                    0x86,
                    0x84,
                ]);
            }
            if (opc === ops.tci_setcond32) {
                const value = compare32Expr(
                    i32WrapI64(localGet(src1)),
                    i32WrapI64(localGet(src2)),
                    bits(insn, 20, 4));
                return value ? localSet(dst, i64ExtendI32U(value)) : null;
            }
            if (opc === ops.setcond) {
                const value = compare64Expr(
                    localGet(src1), localGet(src2), bits(insn, 20, 4));
                return value ? localSet(dst, i64ExtendI32U(value)) : null;
            }
            if (opc === ops.tci_qemu_ld_rrr) {
                return compileSoftmmuTlbAccess({
                    access: "load",
                    dst,
                    addrReg: src1,
                    oiReg: src2,
                    accessIndex: allOrNothingSoftmmu ?
                        nextSoftmmuAccessIndex++ : 0,
                });
            }
            if (opc === ops.tci_qemu_st_rrr) {
                return compileSoftmmuTlbAccess({
                    access: "store",
                    dst,
                    addrReg: src1,
                    valueReg: dst,
                    oiReg: src2,
                    accessIndex: allOrNothingSoftmmu ?
                        nextSoftmmuAccessIndex++ : 0,
                });
            }
            if (opc === ops.mb) {
                return [];
            }
            return null;
        }

        function truthy(expr) {
            return [...expr, 0x50, 0x45];
        }

        function block(body) {
            return [0x02, 0x40, ...body, 0x0b];
        }

        function brIf(depth, condition) {
            return [...condition, 0x0d, ...encodeU32(depth)];
        }

        function compileRange(start, end) {
            const code = [];

            for (let index = start; index < end;) {
                const insn = words[index] >>> 0;
                const opc = bits(insn, 0, 8);

                executedOps++;
                if (opc === ops.brcond) {
                    const targetOffset = (index + 1) * 4 +
                                         sextract(insn, 12, 20);
                    const targetIndex = targetOffset / 4;
                    if (targetOffset % 4 !== 0 ||
                        targetIndex <= index) {
                        return null;
                    }
                    if (targetIndex > end) {
                        code.push(...ifBlock(
                            truthy(localGet(regLocal(bits(insn, 8, 4)))),
                            returnUnsupported()));
                        index++;
                        continue;
                    }
                    const body = compileRange(index + 1, targetIndex);
                    if (body === null) {
                        return null;
                    }
                    code.push(...block([
                        ...brIf(0, truthy(
                            localGet(regLocal(bits(insn, 8, 4))))),
                        ...body,
                    ]));
                    index = targetIndex;
                    continue;
                }

                const compiled = compileOp(index, insn);
                if (compiled === null) {
                    return null;
                }
                if (Array.isArray(compiled)) {
                    code.push(...compiled);
                } else if (allOrNothingSoftmmu) {
                    code.push(...compiled.guard);
                    deferredSoftmmuCommits.push(...compiled.commit);
                } else {
                    code.push(...compiled.guard, ...compiled.commit);
                }
                index++;
            }
            return code;
        }

        for (let reg = 0; reg < 16; reg++) {
            emitted.push(...localSet(regLocal(reg), i64Const(0n)));
        }
        emitted.push(...localSet(regLocal(14), i64Const(BigInt(envPtr))));
        emitted.push(...localSet(regLocal(15), i64Const(BigInt(stackPtr))));

        if (terminalIndex < 0) {
            throw new Error("live generated-output body has no terminal");
        }
        const directStoreRanges = [];
        let directStoreCount = 0;
        let directMemoryUnsupported = false;
        let directMemoryStoreLoadAlias = false;

        for (const insn of bodyWords) {
            const opc = bits(insn >>> 0, 0, 8);
            const range = directMemoryRange(insn);

            if (range === null) {
                continue;
            }
            if (!directMemorySupported(insn)) {
                directMemoryUnsupported = true;
                break;
            }
            if (directMemoryIsStore(opc)) {
                directStoreCount++;
                directStoreRanges.push(range);
                continue;
            }
            if (directStoreRanges.some((store) =>
                    directMemoryRangesOverlap(store, range))) {
                directMemoryStoreLoadAlias = true;
                break;
            }
        }
        if (softmmuAccessCount > softMaxDeferredAccesses ||
            (allOrNothingSoftmmu && softLoadAfterStore) ||
            (allOrNothingSoftmmu && bodyWords.some((insn) => {
                const opc = bits(insn >>> 0, 0, 8);

                return opc === ops.brcond;
            })) ||
            (allOrNothingSoftmmu && directMemoryUnsupported) ||
            (allOrNothingSoftmmu && directMemoryStoreLoadAlias) ||
            (allOrNothingSoftmmu &&
             directStoreCount > directMemoryMaxDeferredStores)) {
            throw new Error("unsupported live generated-output multi-access shape");
        }
        {
            const insn = words[terminalIndex] >>> 0;
            terminal = {
                kind: bits(insn, 0, 8),
                ptrOffset: (terminalIndex + 1) * 4 +
                           sextract(insn, 12, 20),
            };
        }
        {
            const body = compileRange(0, terminalIndex);
            if (body === null) {
                throw new Error("unsupported live generated-output shape");
            }
            emitted.push(...body);
            if (allOrNothingSoftmmu) {
                emitted.push(...deferredSoftmmuCommits);
            }
        }
        executedOps++;

        emitted.push(...i32StoreAtPtr(exitPtr, 0, i32Const(runExitNone)));
        emitted.push(...i64StoreAtPtr(
            exitPtr, 32,
            terminal.kind === ops.goto_tb
                ? i64Const(BigInt(tbPtr))
                : i64Const(BigInt(tbPtr + terminal.ptrOffset))));
        emitted.push(...incrementCounter(countersPtr, 0, guestInsns));
        emitted.push(...incrementCounter(countersPtr, 80, 1));
        emitted.push(...incrementCounter(countersPtr, 88, inlineLoads));
        emitted.push(...incrementCounter(countersPtr, 96, inlineStores));
        emitted.push(...i64Const(terminal.kind === ops.goto_tb
            ? statusDispatch : statusExit));
        buildGeneratedInstructions.generatedTciOps = executedOps;
        buildGeneratedInstructions.inlineLoads = inlineLoads;
        buildGeneratedInstructions.inlineStores = inlineStores;
        return emitted;
    }

    function setResult(index, value) {
        HEAPU64[result / 8 + index] = BigInt.asUintN(64, BigInt(value));
    }

    function recordMetadataOutputMismatch(index, metadataWord, liveWord) {
        setResult(resultMismatchIndex, BigInt(index));
        setResult(resultMismatchOp, BigInt(bits(metadataWord, 0, 8)));
        setResult(resultMismatchMetadataWord, BigInt(metadataWord >>> 0));
        setResult(resultMismatchLiveWord, BigInt(liveWord >>> 0));
    }

    const resultModuleFailurePhase = 11;
    const resultModuleFailureStatus = 12;
    const resultModuleFailureMemoryKind = 13;
    const resultModuleFailureMemoryFlags = 14;
    const resultModuleFailureMemoryInitial = 15;
    const resultModuleFailureMemoryMaximum = 16;
    const resultModuleFailureMemoryHasMaximum = 17;
    const resultModuleFailureMemoryShared = 18;
    const resultModuleFailureMemory64 = 19;
    const resultModuleFailureShapeOpCount = 20;
    const resultModuleFailureFirstOp = 21;
    const resultModuleFailureTerminalOp = 22;
    const moduleFailurePhaseBuild = 1n;
    const moduleFailurePhaseValidate = 2n;
    const moduleFailurePhaseCompile = 3n;
    const moduleFailurePhaseInstantiate = 4n;
    const noMemoryMaximum = 0xffffffffffffffffn;
    const liveMemoryImport = {
        kind: 0x02n,
        flags: 0x07n,
        initial: 0n,
        maximum: 0x40000n,
        hasMaximum: 1n,
        shared: 1n,
        memory64: 1n,
    };

    function recordModuleFailure(phase, status, words) {
        const shape = words || [];
        const terminalOp = shape.find((word) => {
            const op = bits(word >>> 0, 0, 8);
            return op === ops.goto_tb || op === ops.exit_tb ||
                   op === ops.call;
        });

        setResult(resultModuleFailurePhase, phase);
        setResult(resultModuleFailureStatus, status);
        setResult(resultModuleFailureMemoryKind, liveMemoryImport.kind);
        setResult(resultModuleFailureMemoryFlags, liveMemoryImport.flags);
        setResult(resultModuleFailureMemoryInitial, liveMemoryImport.initial);
        setResult(resultModuleFailureMemoryMaximum, liveMemoryImport.maximum);
        setResult(resultModuleFailureMemoryHasMaximum,
                  liveMemoryImport.hasMaximum);
        setResult(resultModuleFailureMemoryShared, liveMemoryImport.shared);
        setResult(resultModuleFailureMemory64, liveMemoryImport.memory64);
        setResult(resultModuleFailureShapeOpCount, BigInt(shape.length));
        setResult(resultModuleFailureFirstOp,
                  BigInt(shape.length ? bits(shape[0] >>> 0, 0, 8) :
                         0xffffffff));
        setResult(resultModuleFailureTerminalOp,
                  BigInt(terminalOp === undefined ? 0xffffffff :
                         bits(terminalOp >>> 0, 0, 8)));
    }

    try {
        const metadataWords = readGeneratedOutputWords();
        if (!metadataWords || metadataWords.length === 0) {
            setResult(0, 4n);
            return 4;
        }
        const words = normalizeGeneratedOutputWords(metadataWords);
        if (!words) {
            HEAPU32[exit / 4] = 8;
            setResult(0, 3n);
            return 3;
        }
        if (!generatedOutputShapeSupported(words)) {
            setResult(0, 5n);
            return 5;
        }

        const checksum = generatedOutputChecksum(words);
        const cacheKey = `${tbPtr}:${envPtr}:${generatedOutputSize}:` +
                         `${checksum}`;
        const cache = globalThis.qemuWasm64LiveGeneratedExecCache ||
            (globalThis.qemuWasm64LiveGeneratedExecCache = new Map());
        let cached = cache.get(cacheKey);
        let cacheHit = false;
        let compileNs = 0n;
        let instantiateNs = 0n;
        let instance;
        let generatedTciOps;

        if (cached && cached.words.length === words.length &&
            cached.words.every((word, index) => word === words[index])) {
            cacheHit = true;
            instance = cached.instance;
            generatedTciOps = BigInt(cached.generatedTciOps);
        } else {
            recordModuleFailure(moduleFailurePhaseBuild, 6n, words);
            const instructions = buildGeneratedInstructions(words);
            generatedTciOps = BigInt(buildGeneratedInstructions.generatedTciOps);
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
                    functionBody(instructions, [
                        { count: 59, type: valueI64 },
                    ]),
                ])),
            ]);
            recordModuleFailure(moduleFailurePhaseValidate, 7n, words);
            let moduleValid = false;
            try {
                moduleValid = WebAssembly.validate(bytes);
            } catch (validateError) {
                setResult(0, 7n);
                return 7;
            }
            if (!moduleValid) {
                setResult(0, 7n);
                return 7;
            }

            const compileStart = performance.now();
            recordModuleFailure(moduleFailurePhaseCompile, 6n, words);
            const module = new WebAssembly.Module(bytes);
            compileNs = BigInt(Math.round(
                (performance.now() - compileStart) * 1000000));
            const instantiateStart = performance.now();
            recordModuleFailure(moduleFailurePhaseInstantiate, 6n, words);
            instance = new WebAssembly.Instance(module, {
                env: { memory: wasmMemory },
            });
            instantiateNs = BigInt(Math.round(
                (performance.now() - instantiateStart) * 1000000));
            cache.set(cacheKey, {
                words: words.slice(),
                instance,
                generatedTciOps: Number(generatedTciOps),
            });
        }

        for (let i = 0; i < 192 / 8; i++) {
            HEAPU64[counters / 8 + i] = 0n;
        }
        for (let i = 0; i < 48 / 8; i++) {
            HEAPU64[exit / 8 + i] = 0n;
        }
        HEAPU64[context / 8 + 0] = BigInt(envPtr);
        HEAPU64[context / 8 + 2] = guestInsns;
        HEAPU64[context / 8 + 3] = BigInt(counters);
        HEAPU64[context / 8 + 4] = BigInt(exit);

        const generatedStart = performance.now();
        const generatedStatus = instance.exports.wasmjit_run(BigInt(context));
        const generatedNs = BigInt(Math.round(
            (performance.now() - generatedStart) * 1000000));

        HEAPU64[counters / 8 + 2] = generatedNs;
        HEAPU64[counters / 8 + 8] = compileNs;
        HEAPU64[counters / 8 + 9] = instantiateNs;
        setResult(0, 0n);
        setResult(resultModuleFailurePhase, 0n);
        setResult(resultModuleFailureStatus, 0n);
        setResult(1, generatedStatus);
        setResult(2, HEAPU64[exit / 8 + 4]);
        setResult(3, HEAPU64[counters / 8 + 0]);
        setResult(4, generatedTciOps);
        setResult(5, BigInt(words.length));
        setResult(6, cacheHit ? 1n : 0n);
        return 0;
    } catch (error) {
        setResult(0, 6n);
        return 6;
    }
});

EM_JS(int, tcg_wasm64_live_tb_coverage_js,
      (uintptr_t context_arg, uintptr_t scratch_arg,
       uintptr_t counters_arg, uintptr_t exit_arg,
       uintptr_t result_arg, uintptr_t tb_arg, uint64_t guest_insns_arg,
       uintptr_t generated_output_arg, uint32_t generated_output_size_arg,
       int op_add_arg, int op_and_arg, int op_brcond_arg, int op_call_arg,
       int op_deposit_arg, int op_exit_tb_arg, int op_extract_arg,
       int op_goto_tb_arg, int op_ld_arg, int op_ld32s_arg,
       int op_ld32u_arg, int op_mb_arg, int op_mov_arg, int op_mul_arg,
       int op_neg_arg, int op_or_arg, int op_setcond_arg, int op_sextract_arg,
       int op_shl_arg, int op_shr_arg, int op_st_arg, int op_st8_arg,
       int op_st32_arg, int op_sub_arg, int op_tci_movi_arg,
       int op_tci_movl_arg, int op_tci_qemu_ld_rrr_arg,
       int op_tci_qemu_st_rrr_arg, int op_tci_setcond32_arg,
       int op_xor_arg), {
    if (typeof wasmMemory === "undefined" || !wasmMemory) {
        return 1;
    }

    const context = Number(context_arg);
    const scratch = Number(scratch_arg);
    const counters = Number(counters_arg);
    const exit = Number(exit_arg);
    const result = Number(result_arg);
    const tbPtr = Number(tb_arg);
    const guestInsns = BigInt(guest_insns_arg);
    const generatedOutputPtr = Number(generated_output_arg);
    const generatedOutputSize = Number(generated_output_size_arg);
    const statusExit = 0x20n;
    const statusDispatch = 0x21n;
    const statusHelper = 0x22n;
    const statusMmio = 0x23n;
    const statusTlbMissOrFault = 0x24n;
    const statusUnsupported = 0x25n;
    const statusInvalidated = 0x26n;
    const runExitNone = 0;
    const runExitMmio = 2;
    const runExitTlbMissOrFault = 3;
    const runExitHelper = 5;
    const runExitUnsupported = 6;
    const runExitInvalidated = 8;
    const valueI32 = 0x7f;
    const valueI64 = 0x7e;
    const liveMemoryImportMemory64 = true;
    const envRelativeBaseReg = 14;
    const envRelativeMinOffset = -16;
    const envRelativeMaxExclusive = 0x120;
    const scratchEnvBase = scratch + 0x100;
    const scratchWindowBase = scratchEnvBase + envRelativeMinOffset;
    const scratchWindowSize = envRelativeMaxExclusive - envRelativeMinOffset;
    const scratchStackBase = scratch + 0x1000;
    const runExitReasonMmio = 2;
    const runExitReasonTlbMissOrFault = 3;
    const runExitReasonUnsupported = 6;
    const runExitFlagPageCrossing = 1;
    const runCtxTlbOffset = 48;
    const tlbMirror = {
        mask: 0,
        table: 8,
        fulltlb: 16,
        mmuIdx: 32,
        flags: 56,
    };
    const tlbMirrorValid = 1;
    const tlbEntry = {
        addrRead: 0,
        addrWrite: 8,
        addend: 24,
        size: 32,
        bits: 5,
    };
    const tlbEntryFull = {
        slowFlags: 35,
        size: 48,
    };
    const tlbConstants = {
        targetPageBits: 12,
        targetPageMask: -4096n,
        invalidMask: 64n,
        flagsMask: 448n,
        slowFlagsMask: 31,
        mmio: 16,
        mmuDataLoad: 0,
        mmuDataStore: 1,
    };
    const memOp = {
        sizeMask: 7n,
        byte: 0n,
        word: 2n,
        quad: 3n,
        atomNone: 2560n,
        atomMask: 3584n,
    };
    const memOpIdxShift = 5n;
    const memOpIdxMmuMask = 31n;
    const ops = {
        add: Number(op_add_arg),
        and: Number(op_and_arg),
        brcond: Number(op_brcond_arg),
        call: Number(op_call_arg),
        deposit: Number(op_deposit_arg),
        exit_tb: Number(op_exit_tb_arg),
        extract: Number(op_extract_arg),
        goto_tb: Number(op_goto_tb_arg),
        ld: Number(op_ld_arg),
        ld32s: Number(op_ld32s_arg),
        ld32u: Number(op_ld32u_arg),
        mb: Number(op_mb_arg),
        mov: Number(op_mov_arg),
        mul: Number(op_mul_arg),
        neg: Number(op_neg_arg),
        or: Number(op_or_arg),
        setcond: Number(op_setcond_arg),
        sextract: Number(op_sextract_arg),
        shl: Number(op_shl_arg),
        shr: Number(op_shr_arg),
        st: Number(op_st_arg),
        st8: Number(op_st8_arg),
        st32: Number(op_st32_arg),
        sub: Number(op_sub_arg),
        tci_movi: Number(op_tci_movi_arg),
        tci_movl: Number(op_tci_movl_arg),
        tci_qemu_ld_rrr: Number(op_tci_qemu_ld_rrr_arg),
        tci_qemu_st_rrr: Number(op_tci_qemu_st_rrr_arg),
        tci_setcond32: Number(op_tci_setcond32_arg),
        xor: Number(op_xor_arg),
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

    function i64ExtendI32S(expr) {
        return [...expr, 0xac];
    }

    function i64ExtendI32U(expr) {
        return [...expr, 0xad];
    }

    function memoryAddress(expr) {
        return liveMemoryImportMemory64 ? expr : i32WrapI64(expr);
    }

    function i64Load(address) {
        return [...memoryAddress(address), 0x29, ...memArg(3, 0)];
    }

    function i32Load(address) {
        return [...memoryAddress(address), 0x28, ...memArg(2, 0)];
    }

    function i64Store(address, value) {
        return [...memoryAddress(address), ...value, 0x37, ...memArg(3, 0)];
    }

    function i32Store(address, value) {
        return [...memoryAddress(address), ...value, 0x36, ...memArg(2, 0)];
    }

    function i32Store8(address, value) {
        return [...memoryAddress(address), ...value, 0x3a, ...memArg(0, 0)];
    }

    function i64LoadAtPtr(ptrLocal, offset) {
        return [...memoryAddress(localGet(ptrLocal)),
                0x29, ...memArg(3, offset)];
    }

    function i32StoreAtPtr(ptrLocal, offset, value) {
        return [...memoryAddress(localGet(ptrLocal)), ...value,
                0x36, ...memArg(2, offset)];
    }

    function i64StoreAtPtr(ptrLocal, offset, value) {
        return [...memoryAddress(localGet(ptrLocal)), ...value,
                0x37, ...memArg(3, offset)];
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

    function toU32(value) {
        return Number(BigInt.asUintN(32, BigInt(value)));
    }

    function checksum(values) {
        let hash = 1469598103934665603n;
        for (const item of values) {
            hash ^= toU64(item);
            hash = BigInt.asUintN(64, hash * 1099511628211n);
        }
        return hash;
    }

    function setResult(index, value) {
        HEAPU64[result / 8 + index] = toU64(value);
    }

    function readGeneratedOutputWords() {
        if (generatedOutputPtr === 0 || generatedOutputSize === 0 ||
            generatedOutputSize % 4 !== 0) {
            return null;
        }
        const wordCount = generatedOutputSize / 4;
        const output = [];

        for (let i = 0; i < wordCount; i++) {
            output.push(HEAPU32[generatedOutputPtr / 4 + i] >>> 0);
        }
        return output;
    }

    function shapeOpSupported(opc) {
        return opc === ops.add || opc === ops.and ||
               opc === ops.brcond || opc === ops.call ||
               opc === ops.deposit || opc === ops.exit_tb ||
               opc === ops.extract || opc === ops.goto_tb ||
               opc === ops.ld || opc === ops.ld32s || opc === ops.ld32u ||
               opc === ops.mb || opc === ops.mov || opc === ops.mul ||
               opc === ops.neg || opc === ops.or ||
               opc === ops.setcond || opc === ops.sextract ||
               opc === ops.shl || opc === ops.shr ||
               opc === ops.st || opc === ops.st8 || opc === ops.st32 ||
               opc === ops.sub ||
               opc === ops.tci_movi || opc === ops.tci_movl ||
               opc === ops.tci_qemu_ld_rrr ||
               opc === ops.tci_qemu_st_rrr ||
               opc === ops.tci_setcond32 ||
               opc === ops.xor;
    }

    function terminalStatus(opc) {
        if (opc === ops.goto_tb) {
            return statusDispatch;
        }
        if (opc === ops.exit_tb) {
            return statusExit;
        }
        if (opc === ops.call) {
            return statusHelper;
        }
        return statusUnsupported;
    }

    function terminalRunExitReason(opc) {
        if (opc === ops.call) {
            return runExitHelper;
        }
        return runExitNone;
    }

    function readTerminalValue(opc, ptrOffset, index) {
        if (opc === ops.goto_tb) {
            const address = tbPtr + ptrOffset;
            if (address < 0 || address % 8 !== 0) {
                return 0n;
            }
            return HEAPU64[address / 8];
        }
        if (opc === ops.call) {
            return BigInt(tbPtr + index * 4);
        }
        return BigInt(tbPtr + ptrOffset);
    }

    function compare32(lhs, rhs, condition) {
        const lhsSigned = toI32(lhs);
        const rhsSigned = toI32(rhs);
        const lhsUnsigned = toU32(lhs);
        const rhsUnsigned = toU32(rhs);

        switch (condition) {
        case 0: return 0n;
        case 1: return 1n;
        case 8: return lhsUnsigned === rhsUnsigned ? 1n : 0n;
        case 9: return lhsUnsigned !== rhsUnsigned ? 1n : 0n;
        case 12: return (lhsUnsigned & rhsUnsigned) === 0 ? 1n : 0n;
        case 13: return (lhsUnsigned & rhsUnsigned) !== 0 ? 1n : 0n;
        case 2: return lhsSigned < rhsSigned ? 1n : 0n;
        case 3: return lhsSigned >= rhsSigned ? 1n : 0n;
        case 6: return lhsSigned > rhsSigned ? 1n : 0n;
        case 7: return lhsSigned <= rhsSigned ? 1n : 0n;
        case 10: return lhsUnsigned < rhsUnsigned ? 1n : 0n;
        case 11: return lhsUnsigned >= rhsUnsigned ? 1n : 0n;
        case 14: return lhsUnsigned > rhsUnsigned ? 1n : 0n;
        case 15: return lhsUnsigned <= rhsUnsigned ? 1n : 0n;
        default:
            throw new Error(`unsupported live coverage condition ${condition}`);
        }
    }

    function compare64(lhs, rhs, condition) {
        const lhsSigned = BigInt.asIntN(64, BigInt(lhs));
        const rhsSigned = BigInt.asIntN(64, BigInt(rhs));
        const lhsUnsigned = BigInt.asUintN(64, BigInt(lhs));
        const rhsUnsigned = BigInt.asUintN(64, BigInt(rhs));

        switch (condition) {
        case 0: return 0n;
        case 1: return 1n;
        case 8: return lhsUnsigned === rhsUnsigned ? 1n : 0n;
        case 9: return lhsUnsigned !== rhsUnsigned ? 1n : 0n;
        case 12: return (lhsUnsigned & rhsUnsigned) === 0n ? 1n : 0n;
        case 13: return (lhsUnsigned & rhsUnsigned) !== 0n ? 1n : 0n;
        case 2: return lhsSigned < rhsSigned ? 1n : 0n;
        case 3: return lhsSigned >= rhsSigned ? 1n : 0n;
        case 6: return lhsSigned > rhsSigned ? 1n : 0n;
        case 7: return lhsSigned <= rhsSigned ? 1n : 0n;
        case 10: return lhsUnsigned < rhsUnsigned ? 1n : 0n;
        case 11: return lhsUnsigned >= rhsUnsigned ? 1n : 0n;
        case 14: return lhsUnsigned > rhsUnsigned ? 1n : 0n;
        case 15: return lhsUnsigned <= rhsUnsigned ? 1n : 0n;
        default:
            throw new Error(`unsupported live coverage condition ${condition}`);
        }
    }

    function compare32Expr(lhs, rhs, condition) {
        switch (condition) {
        case 0: return [0x41, 0x00];
        case 1: return [0x41, 0x01];
        case 8: return [...lhs, ...rhs, 0x46];
        case 9: return [...lhs, ...rhs, 0x47];
        case 12: return [...lhs, ...rhs, 0x71, 0x45];
        case 13: return [...lhs, ...rhs, 0x71, 0x45, 0x45];
        case 2: return [...lhs, ...rhs, 0x48];
        case 3: return [...lhs, ...rhs, 0x4e];
        case 6: return [...lhs, ...rhs, 0x4a];
        case 7: return [...lhs, ...rhs, 0x4c];
        case 10: return [...lhs, ...rhs, 0x49];
        case 11: return [...lhs, ...rhs, 0x4f];
        case 14: return [...lhs, ...rhs, 0x4b];
        case 15: return [...lhs, ...rhs, 0x4d];
        default: return null;
        }
    }

    function compare64Expr(lhs, rhs, condition) {
        switch (condition) {
        case 0: return [0x41, 0x00];
        case 1: return [0x41, 0x01];
        case 8: return [...lhs, ...rhs, 0x51];
        case 9: return [...lhs, ...rhs, 0x52];
        case 12: return [...lhs, ...rhs, 0x83, 0x50];
        case 13: return [...lhs, ...rhs, 0x83, 0x50, 0x45];
        case 2: return [...lhs, ...rhs, 0x53];
        case 3: return [...lhs, ...rhs, 0x59];
        case 6: return [...lhs, ...rhs, 0x55];
        case 7: return [...lhs, ...rhs, 0x57];
        case 10: return [...lhs, ...rhs, 0x54];
        case 11: return [...lhs, ...rhs, 0x5a];
        case 14: return [...lhs, ...rhs, 0x56];
        case 15: return [...lhs, ...rhs, 0x58];
        default: return null;
        }
    }

    function i64Mul(lhs, rhs) {
        return [...lhs, ...rhs, 0x7e];
    }

    function i64And(lhs, rhs) {
        return [...lhs, ...rhs, 0x83];
    }

    function i64Xor(lhs, rhs) {
        return [...lhs, ...rhs, 0x85];
    }

    function i64Shl(lhs, rhs) {
        return [...lhs, ...rhs, 0x86];
    }

    function i64ShrU(lhs, rhs) {
        return [...lhs, ...rhs, 0x88];
    }

    function i64Eq(lhs, rhs) {
        return [...lhs, ...rhs, 0x51];
    }

    function i64Ne(lhs, rhs) {
        return [...lhs, ...rhs, 0x52];
    }

    function i32And(lhs, rhs) {
        return [...lhs, ...rhs, 0x71];
    }

    function i32Ne(lhs, rhs) {
        return [...lhs, ...rhs, 0x47];
    }

    function i64Load(address, offset = 0) {
        return [...address, 0x29, ...memArg(3, offset)];
    }

    function i32Load(address, offset = 0) {
        return [...address, 0x28, ...memArg(2, offset)];
    }

    function i32Load8U(address, offset = 0) {
        return [...address, 0x2d, ...memArg(0, offset)];
    }

    function referenceMemoryAddress(regs, insn, r1, size) {
        const offset = sextract(insn, 16, 16);

        if (r1 !== envRelativeBaseReg ||
            offset < envRelativeMinOffset ||
            offset + size > envRelativeMaxExclusive) {
            throw new Error("unsupported live coverage env-relative memory");
        }
        return Number(regs[r1] + BigInt(offset));
    }

    function helperMemoryAddress(taddr) {
        return Number(BigInt.asUintN(64, BigInt(taddr)) & 0xffn);
    }

    function applyOp(regs, view, insn, index) {
        const opc = bits(insn, 0, 8);
        const r0 = bits(insn, 8, 4);
        const r1 = bits(insn, 12, 4);
        const r2 = bits(insn, 16, 4);
        const currentTbPtr = (index + 1) * 4;

        if (opc === ops.tci_movi) {
            regs[r0] = BigInt(sextract(insn, 12, 20));
        } else if (opc === ops.tci_movl) {
            regs[r0] = new DataView(wasmMemory.buffer).getBigUint64(
                tbPtr + currentTbPtr + sextract(insn, 12, 20), true);
        } else if (opc === ops.ld32u) {
            regs[r0] = BigInt(view.getUint32(
                referenceMemoryAddress(regs, insn, r1, 4), true));
        } else if (opc === ops.ld32s) {
            regs[r0] = toU64(BigInt(view.getInt32(
                referenceMemoryAddress(regs, insn, r1, 4), true)));
        } else if (opc === ops.ld) {
            regs[r0] = view.getBigUint64(
                referenceMemoryAddress(regs, insn, r1, 8), true);
        } else if (opc === ops.st8) {
            view.setUint8(referenceMemoryAddress(regs, insn, r1, 1),
                          Number(regs[r0] & 0xffn));
        } else if (opc === ops.st32) {
            view.setUint32(referenceMemoryAddress(regs, insn, r1, 4),
                           Number(regs[r0] & 0xffffffffn), true);
        } else if (opc === ops.st) {
            view.setBigUint64(referenceMemoryAddress(regs, insn, r1, 8),
                              regs[r0], true);
        } else if (opc === ops.mov) {
            regs[r0] = regs[r1];
        } else if (opc === ops.add) {
            regs[r0] = toU64(regs[r1] + regs[r2]);
        } else if (opc === ops.sub) {
            regs[r0] = toU64(regs[r1] - regs[r2]);
        } else if (opc === ops.and) {
            regs[r0] = toU64(regs[r1] & regs[r2]);
        } else if (opc === ops.or) {
            regs[r0] = toU64(regs[r1] | regs[r2]);
        } else if (opc === ops.xor) {
            regs[r0] = toU64(regs[r1] ^ regs[r2]);
        } else if (opc === ops.mul) {
            regs[r0] = toU64(regs[r1] * regs[r2]);
        } else if (opc === ops.neg) {
            regs[r0] = toU64(-regs[r1]);
        } else if (opc === ops.shl) {
            regs[r0] = toU64(regs[r1] << (regs[r2] & 63n));
        } else if (opc === ops.shr) {
            regs[r0] = toU64(regs[r1] >> (regs[r2] & 63n));
        } else if (opc === ops.extract || opc === ops.sextract) {
            const pos = bits(insn, 16, 6);
            const len = bits(insn, 22, 6);

            if (len === 0 || pos + len > 64) {
                throw new Error("unsupported live coverage extract");
            }
            if (opc === ops.extract) {
                const mask = len === 64 ? -1n : ((1n << BigInt(len)) - 1n);
                regs[r0] = toU64((regs[r1] >> BigInt(pos)) & mask);
            } else {
                const shifted = BigInt.asIntN(
                    64, regs[r1] << BigInt(64 - pos - len));
                regs[r0] = toU64(shifted >> BigInt(64 - len));
            }
        } else if (opc === ops.deposit) {
            const pos = bits(insn, 20, 6);
            const len = bits(insn, 26, 6);

            if (len === 0 || pos + len > 64) {
                throw new Error("unsupported live coverage deposit");
            }
            const mask = len === 64 ? -1n : ((1n << BigInt(len)) - 1n);
            const clearMask = BigInt.asUintN(
                64, ~(BigInt.asUintN(64, mask) << BigInt(pos)));
            regs[r0] = toU64((regs[r1] & clearMask) |
                             ((regs[r2] & mask) << BigInt(pos)));
        } else if (opc === ops.tci_setcond32) {
            regs[r0] = compare32(regs[r1], regs[r2], bits(insn, 20, 4));
        } else if (opc === ops.setcond) {
            regs[r0] = compare64(regs[r1], regs[r2], bits(insn, 20, 4));
        } else if (opc === ops.tci_qemu_ld_rrr) {
            regs[r0] = view.getBigUint64(helperMemoryAddress(regs[r1]), true);
        } else if (opc === ops.tci_qemu_st_rrr) {
            view.setBigUint64(helperMemoryAddress(regs[r1]), regs[r0], true);
        } else if (opc === ops.brcond) {
            const ptrOffset = currentTbPtr + sextract(insn, 12, 20);
            const targetIndex = ptrOffset / 4;

            if (ptrOffset % 4 !== 0 || targetIndex <= index) {
                throw new Error("unsupported live coverage branch target");
            }
            if (regs[r0] !== 0n) {
                return { nextIndex: targetIndex };
            }
        } else if (opc === ops.mb) {
            return null;
        } else if (opc === ops.goto_tb || opc === ops.exit_tb ||
                   opc === ops.call) {
            const retLen = bits(insn, 8, 4);
            const ptrOffset = currentTbPtr + sextract(insn, 12, 20);

            if (opc === ops.call && (index === 0 || retLen > 2)) {
                throw new Error("unsupported live coverage helper call");
            }
            return {
                status: terminalStatus(opc),
                value: readTerminalValue(opc, ptrOffset, index),
                executed: BigInt(index + 1),
            };
        } else {
            throw new Error(`unsupported live coverage opcode ${opc}`);
        }
        return null;
    }

    function referenceRun(words) {
        const regs = [];
        const buffer = new ArrayBuffer(scratchWindowSize);
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = (i * 13 + 17) & 0xff;
        }
        for (let reg = 0; reg < 16; reg++) {
            regs.push(BigInt(0x1000 + reg));
        }
        regs[14] = BigInt(-envRelativeMinOffset);
        regs[15] = BigInt(scratchStackBase - scratchWindowBase);
        for (let index = 0; index < words.length;) {
            const step = applyOp(regs, view, words[index] >>> 0, index);
            if (step && step.status !== undefined) {
                return {
                    ...step,
                    checksum: checksum(regs),
                };
            }
            index = step && step.nextIndex !== undefined
                ? step.nextIndex : index + 1;
        }
        throw new Error("live coverage generated output has no terminal");
    }

    function buildGeneratedInstructions(words) {
        const emitted = [
            ...localSet(1, i64LoadAtPtr(0, 24)),
            ...localSet(2, i64LoadAtPtr(0, 32)),
        ];
        let terminal = null;
        const softTlbPtr = 20;
        const softSlowFlags = 21;
        const softTaddr = 22;
        const softOi = 23;
        const softMemop = 24;
        const softSize = 25;
        const softValue = 26;
        const softMask = 27;
        const softTablePtr = 28;
        const softFulltlbPtr = 29;
        const softIndex = 30;
        const softEntryPtr = 31;
        const softFullPtr = 32;
        const softComparator = 33;
        const softAddend = 34;
        const softHostAddr = 35;

        function regLocal(reg) {
            return 3 + reg;
        }

        function memoryAddress(expr, offset) {
            return i64Add(expr, i64Const(offset));
        }

        function envRelativeMemoryAddress(insn, r1, size) {
            const offset = sextract(insn, 16, 16);

            if (r1 !== envRelativeBaseReg ||
                offset < envRelativeMinOffset ||
                offset + size > envRelativeMaxExclusive) {
                return null;
            }
            return memoryAddress(localGet(regLocal(r1)), offset);
        }

        function returnUnsupported() {
            return [
                ...i32StoreAtPtr(2, 0, i32Const(runExitUnsupported)),
                ...i32StoreAtPtr(2, 4, i32Const(Number(statusUnsupported))),
                ...i64StoreAtPtr(2, 32, i64Const(0n)),
                ...i64Const(0n),
                0x0f,
            ];
        }

        function incrementRunCounter(offset) {
            return i64StoreAtPtr(1, offset, i64Add(
                i64LoadAtPtr(1, offset), i64Const(1n)));
        }

        function softmmuStoreExit(reason, sizeExpr, flags) {
            return [
                ...i32StoreAtPtr(2, 0, i32Const(reason)),
                ...i64StoreAtPtr(2, 16, localGet(softTaddr)),
                ...i64StoreAtPtr(2, 24, i64Const(0n)),
                ...i32StoreAtPtr(2, 40, sizeExpr),
                ...i32StoreAtPtr(2, 44, i32Const(flags)),
            ];
        }

        function softmmuFailureReturn({
            reason,
            counterOffset,
            sizeExpr = i32Const(0),
            flags = 0,
        }) {
            return [
                ...softmmuStoreExit(reason, sizeExpr, flags),
                ...incrementRunCounter(counterOffset),
                ...i64Const(BigInt(reason)),
                0x0f,
            ];
        }

        function softmmuAccessType(access) {
            return access === "store" ? tlbConstants.mmuDataStore :
                                        tlbConstants.mmuDataLoad;
        }

        function softmmuComparatorOffset(access) {
            return access === "store" ? tlbEntry.addrWrite :
                                        tlbEntry.addrRead;
        }

        function compileSoftmmuTlbAccess({
            access,
            dst,
            addrReg,
            valueReg,
            oiReg,
        }) {
            const accessType = softmmuAccessType(access);
            const unsupportedReturn = softmmuFailureReturn({
                reason: runExitReasonUnsupported,
                counterOffset: 168,
            });
            const tlbMissReturn = softmmuFailureReturn({
                reason: runExitReasonTlbMissOrFault,
                counterOffset: 144,
                sizeExpr: i32WrapI64(localGet(softSize)),
            });
            const pageCrossingReturn = softmmuFailureReturn({
                reason: runExitReasonTlbMissOrFault,
                counterOffset: 144,
                sizeExpr: i32WrapI64(localGet(softSize)),
                flags: runExitFlagPageCrossing,
            });
            const mmioReturn = softmmuFailureReturn({
                reason: runExitReasonMmio,
                counterOffset: 136,
                sizeExpr: i32WrapI64(localGet(softSize)),
            });
            const comparatorOffset = softmmuComparatorOffset(access);
            const inlineCounterOffset = access === "store" ? 96 : 88;
            const loadByte = i64ExtendI32U(i32Load8U(
                localGet(softHostAddr)));
            const loadWord = i64ExtendI32U(i32Load(
                localGet(softHostAddr)));
            const loadQuad = i64Load(localGet(softHostAddr));
            const storeByte = i32Store8(
                localGet(softHostAddr),
                i32WrapI64(localGet(softValue)));
            const storeWord = i32Store(
                localGet(softHostAddr),
                i32WrapI64(localGet(softValue)));
            const storeQuad = i64Store(
                localGet(softHostAddr),
                localGet(softValue));
            const commitLoad = [
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.byte)),
                    localSet(dst, loadByte)),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.word)),
                    localSet(dst, loadWord)),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.quad)),
                    localSet(dst, loadQuad)),
            ];
            const commitStore = [
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.byte)),
                    storeByte),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.word)),
                    storeWord),
                ...ifBlock(i64Eq(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.quad)),
                    storeQuad),
            ];

            return [
                ...localSet(softTaddr, localGet(addrReg)),
                ...localSet(softOi, localGet(oiReg)),
                ...(access === "store"
                    ? localSet(softValue, localGet(valueReg)) : []),
                ...localSet(softTlbPtr,
                    i64LoadAtPtr(0, runCtxTlbOffset)),
                ...ifBlock(i64Eq(localGet(softTlbPtr), i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32And(
                        i32Load(localGet(softTlbPtr),
                                tlbMirror.flags),
                        i32Const(tlbMirrorValid)),
                    i32Const(tlbMirrorValid)),
                    unsupportedReturn),
                ...localSet(softMemop,
                    i64ShrU(localGet(softOi), i64Const(memOpIdxShift))),
                ...ifBlock(i64Ne(
                    i64And(localGet(softMemop),
                           i64Const(~(memOp.sizeMask | memOp.atomMask))),
                    i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softMemop), i64Const(memOp.atomMask)),
                    i64Const(memOp.atomNone)),
                    unsupportedReturn),
                ...ifBlock(i32Ne(
                    i32WrapI64(i64And(localGet(softOi),
                                      i64Const(memOpIdxMmuMask))),
                    i32Load(localGet(softTlbPtr),
                            tlbMirror.mmuIdx)),
                    unsupportedReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    i64Const(memOp.byte)),
                    [
                        ...ifBlock(i64Ne(
                            i64And(localGet(softMemop),
                                   i64Const(memOp.sizeMask)),
                            i64Const(memOp.word)),
                            [
                                ...ifBlock(i64Ne(
                                    i64And(localGet(softMemop),
                                           i64Const(memOp.sizeMask)),
                                    i64Const(memOp.quad)),
                                    unsupportedReturn),
                            ]),
                    ]),
                ...localSet(softSize, [
                    ...i64Const(8n),
                    ...i64Const(4n),
                    ...i64Const(1n),
                    ...i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    ...i64Const(memOp.word),
                    0x51,
                    0x1b,
                    ...i64And(localGet(softMemop), i64Const(memOp.sizeMask)),
                    ...i64Const(memOp.quad),
                    0x51,
                    0x1b,
                ]),
                ...ifBlock(i64Ne(
                    i64And(
                        i64Xor(localGet(softTaddr),
                               i64Add(localGet(softTaddr),
                                      i64Add(localGet(softSize),
                                             i64Const(-1n)))),
                        i64Const(tlbConstants.targetPageMask)),
                    i64Const(0n)),
                    pageCrossingReturn),
                ...localSet(softMask,
                    i64Load(localGet(softTlbPtr),
                            tlbMirror.mask)),
                ...localSet(softTablePtr,
                    i64Load(localGet(softTlbPtr),
                            tlbMirror.table)),
                ...localSet(softFulltlbPtr,
                    i64Load(localGet(softTlbPtr),
                            tlbMirror.fulltlb)),
                ...ifBlock(i64Eq(localGet(softTablePtr), i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Eq(localGet(softFulltlbPtr), i64Const(0n)),
                    unsupportedReturn),
                ...localSet(softIndex,
                    i64And(
                        i64ShrU(localGet(softTaddr),
                                i64Const(BigInt(tlbConstants.targetPageBits))),
                        i64ShrU(localGet(softMask),
                                i64Const(BigInt(tlbEntry.bits))))),
                ...localSet(softEntryPtr,
                    i64Add(localGet(softTablePtr),
                           i64Shl(localGet(softIndex),
                                  i64Const(BigInt(tlbEntry.bits))))),
                ...localSet(softFullPtr,
                    i64Add(localGet(softFulltlbPtr),
                           i64Mul(localGet(softIndex),
                                  i64Const(BigInt(tlbEntryFull.size))))),
                ...localSet(softComparator,
                    i64Load(localGet(softEntryPtr),
                            comparatorOffset)),
                ...localSet(softAddend,
                    i64Load(localGet(softEntryPtr),
                            tlbEntry.addend)),
                ...localSet(softSlowFlags,
                    i64ExtendI32U(i32Load8U(
                        localGet(softFullPtr),
                        tlbEntryFull.slowFlags + accessType))),
                ...ifBlock(i64Ne(
                    i64And(localGet(softComparator),
                           i64Const(tlbConstants.targetPageMask)),
                    i64And(localGet(softTaddr),
                           i64Const(tlbConstants.targetPageMask))),
                    tlbMissReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softComparator),
                           i64Const(tlbConstants.invalidMask)),
                    i64Const(0n)),
                    tlbMissReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softSlowFlags),
                           i64Const(BigInt(tlbConstants.mmio))),
                    i64Const(0n)),
                    mmioReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softComparator),
                           i64Const(tlbConstants.flagsMask)),
                    i64Const(0n)),
                    unsupportedReturn),
                ...ifBlock(i64Ne(
                    i64And(localGet(softSlowFlags),
                           i64Const(BigInt(tlbConstants.slowFlagsMask))),
                    i64Const(0n)),
                    unsupportedReturn),
                ...localSet(softHostAddr,
                    i64Add(localGet(softTaddr), localGet(softAddend))),
                ...(access === "store" ? commitStore : commitLoad),
                ...incrementRunCounter(inlineCounterOffset),
            ];
        }

        function truthy(expr) {
            return [...expr, 0x50, 0x45];
        }

        function block(body) {
            return [0x02, 0x40, ...body, 0x0b];
        }

        function ifBlock(condition, thenBody) {
            return [...condition, 0x04, 0x40, ...thenBody, 0x0b];
        }

        function brIf(depth, condition) {
            return [...condition, 0x0d, ...encodeU32(depth)];
        }

        function compareAndExtend32(insn, r1, r2) {
            const comparison = compare32Expr(
                i32WrapI64(localGet(regLocal(r1))),
                i32WrapI64(localGet(regLocal(r2))),
                bits(insn, 20, 4));

            return comparison ? i64ExtendI32U(comparison) : null;
        }

        function compareAndExtend64(insn, r1, r2) {
            const comparison = compare64Expr(
                localGet(regLocal(r1)),
                localGet(regLocal(r2)),
                bits(insn, 20, 4));

            return comparison ? i64ExtendI32U(comparison) : null;
        }

        function compileOp(index, insn) {
            const opc = bits(insn, 0, 8);
            const r0 = bits(insn, 8, 4);
            const r1 = bits(insn, 12, 4);
            const r2 = bits(insn, 16, 4);
            const dst = regLocal(r0);
            const src1 = regLocal(r1);
            const src2 = regLocal(r2);
            let address;

            if (!shapeOpSupported(opc)) {
                return null;
            }
            if (opc === ops.tci_movi) {
                return localSet(dst, i64Const(sextract(insn, 12, 20)));
            }
            if (opc === ops.tci_movl) {
                const currentTbPtr = (index + 1) * 4;
                return localSet(dst, i64Load(i64Const(
                    BigInt(tbPtr + currentTbPtr + sextract(insn, 12, 20)))));
            }
            if (opc === ops.ld32u || opc === ops.ld32s) {
                address = envRelativeMemoryAddress(insn, r1, 4);
                if (address === null) {
                    return null;
                }
                return localSet(dst, opc === ops.ld32u ?
                    i64ExtendI32U(i32Load(address)) :
                    i64ExtendI32S(i32Load(address)));
            }
            if (opc === ops.ld) {
                address = envRelativeMemoryAddress(insn, r1, 8);
                return address === null ? null :
                    localSet(dst, i64Load(address));
            }
            if (opc === ops.st8) {
                address = envRelativeMemoryAddress(insn, r1, 1);
                return address === null ? null :
                    i32Store8(address, i32WrapI64(localGet(dst)));
            }
            if (opc === ops.st32) {
                address = envRelativeMemoryAddress(insn, r1, 4);
                return address === null ? null :
                    i32Store(address, i32WrapI64(localGet(dst)));
            }
            if (opc === ops.st) {
                address = envRelativeMemoryAddress(insn, r1, 8);
                return address === null ? null :
                    i64Store(address, localGet(dst));
            }
            if (opc === ops.mov) {
                return localSet(dst, localGet(src1));
            }
            if (opc === ops.add || opc === ops.sub || opc === ops.mul ||
                opc === ops.and || opc === ops.or || opc === ops.xor ||
                opc === ops.shl || opc === ops.shr) {
                const opByte = opc === ops.add ? 0x7c :
                               opc === ops.sub ? 0x7d :
                               opc === ops.mul ? 0x7e :
                               opc === ops.and ? 0x83 :
                               opc === ops.or ? 0x84 :
                               opc === ops.xor ? 0x85 :
                               opc === ops.shl ? 0x86 : 0x88;
                return localSet(dst, [
                    ...localGet(src1),
                    ...localGet(src2),
                    opByte,
                ]);
            }
            if (opc === ops.neg) {
                return localSet(dst, [
                    ...i64Const(0n),
                    ...localGet(src1),
                    0x7d,
                ]);
            }
            if (opc === ops.extract || opc === ops.sextract) {
                const pos = bits(insn, 16, 6);
                const len = bits(insn, 22, 6);

                if (len === 0 || pos + len > 64) {
                    return null;
                }
                if (opc === ops.extract) {
                    const mask = len === 64 ? -1n :
                        ((1n << BigInt(len)) - 1n);
                    return localSet(dst, [
                        ...localGet(src1),
                        ...i64Const(pos),
                        0x88,
                        ...i64Const(mask),
                        0x83,
                    ]);
                }
                const shift = 64 - pos - len;
                return localSet(dst, [
                    ...localGet(src1),
                    ...i64Const(shift),
                    0x86,
                    ...i64Const(shift),
                    0x87,
                ]);
            }
            if (opc === ops.deposit) {
                const pos = bits(insn, 20, 6);
                const len = bits(insn, 26, 6);

                if (len === 0 || pos + len > 64) {
                    return null;
                }
                const mask = len === 64 ? -1n :
                    ((1n << BigInt(len)) - 1n);
                const clearMask = BigInt.asUintN(
                    64, ~(BigInt.asUintN(64, mask) << BigInt(pos)));
                return localSet(dst, [
                    ...localGet(src1),
                    ...i64Const(clearMask),
                    0x83,
                    ...localGet(src2),
                    ...i64Const(mask),
                    0x83,
                    ...i64Const(pos),
                    0x86,
                    0x84,
                ]);
            }
            if (opc === ops.tci_setcond32) {
                const value = compareAndExtend32(insn, r1, r2);
                return value ? localSet(dst, value) : null;
            }
            if (opc === ops.setcond) {
                const value = compareAndExtend64(insn, r1, r2);
                return value ? localSet(dst, value) : null;
            }
            if (opc === ops.tci_qemu_ld_rrr) {
                return compileSoftmmuTlbAccess({
                    access: "load",
                    dst,
                    addrReg: src1,
                    oiReg: src2,
                });
            }
            if (opc === ops.tci_qemu_st_rrr) {
                return compileSoftmmuTlbAccess({
                    access: "store",
                    dst,
                    addrReg: src1,
                    valueReg: dst,
                    oiReg: src2,
                });
            }
            if (opc === ops.mb) {
                return [];
            }
            return null;
        }

        function compileRange(start, end) {
            const code = [];

            for (let index = start; index < end;) {
                const insn = words[index] >>> 0;
                const opc = bits(insn, 0, 8);

                if (opc === ops.brcond) {
                    const ptrOffset = (index + 1) * 4 +
                                      sextract(insn, 12, 20);
                    const targetIndex = ptrOffset / 4;
                    if (ptrOffset % 4 !== 0 || targetIndex <= index) {
                        return null;
                    }
                    if (targetIndex > end) {
                        code.push(...ifBlock(
                            truthy(localGet(regLocal(bits(insn, 8, 4)))),
                            returnUnsupported()));
                        index++;
                        continue;
                    }
                    const body = compileRange(index + 1, targetIndex);
                    if (body === null) {
                        return null;
                    }
                    code.push(...block([
                        ...brIf(0, truthy(
                            localGet(regLocal(bits(insn, 8, 4))))),
                        ...body,
                    ]));
                    index = targetIndex;
                    continue;
                }
                const compiled = compileOp(index, insn);
                if (compiled === null) {
                    return null;
                }
                code.push(...compiled);
                index++;
            }
            return code;
        }

        for (let reg = 0; reg < 16; reg++) {
            emitted.push(...localSet(3 + reg, i64Const(BigInt(0x1000 + reg))));
        }
        emitted.push(...localSet(regLocal(14), i64Const(BigInt(scratchEnvBase))));
        emitted.push(...localSet(regLocal(15), i64Const(BigInt(scratchStackBase))));

        for (let index = 0; index < words.length; index++) {
            const insn = words[index] >>> 0;
            const opc = bits(insn, 0, 8);
            const currentTbPtr = (index + 1) * 4;

            if (!shapeOpSupported(opc)) {
                throw new Error(`unsupported live coverage opcode ${opc}`);
            }
            if (opc === ops.goto_tb || opc === ops.exit_tb ||
                opc === ops.call) {
                const retLen = bits(insn, 8, 4);
                const ptrOffset = currentTbPtr + sextract(insn, 12, 20);
                if (opc === ops.call && (index === 0 || retLen > 2)) {
                    throw new Error("unsupported live coverage helper call");
                }
                terminal = {
                    opc,
                    ptrOffset: opc === ops.call ? index * 4 : ptrOffset,
                    executed: index + 1,
                };
                break;
            }
        }

        if (!terminal) {
            throw new Error("live coverage generated output has no terminal");
        }
        {
            const body = compileRange(0, terminal.executed - 1);
            if (body === null) {
                throw new Error("unsupported live coverage generated-output shape");
            }
            emitted.push(...body);
        }

        let checksumExpr = i64Const(1469598103934665603n);
        for (let reg = 0; reg < 16; reg++) {
            checksumExpr = [
                ...checksumExpr,
                ...localGet(3 + reg),
                0x85,
                ...i64Const(1099511628211n),
                0x7e,
            ];
        }

        emitted.push(...localSet(19, checksumExpr));
        emitted.push(...i64StoreAtPtr(1, 0, guestInsns === 0n
            ? i64Const(0n) : i64Const(guestInsns)));
        emitted.push(...i64StoreAtPtr(1, 80, i64Const(1n)));
        emitted.push(...i32StoreAtPtr(
            2, 0, i32Const(terminalRunExitReason(terminal.opc))));
        emitted.push(...i32StoreAtPtr(
            2, 4, i32Const(Number(terminalStatus(terminal.opc)))));
        emitted.push(...i64StoreAtPtr(
            2, 32,
            terminal.opc === ops.goto_tb
                ? [
                    ...i64Const(BigInt(tbPtr + terminal.ptrOffset)),
                    0x29, ...memArg(3, 0),
                  ]
                : terminal.opc === ops.call
                ? i64Const(BigInt(tbPtr + terminal.ptrOffset))
                : i64Const(BigInt(tbPtr + terminal.ptrOffset))));
        emitted.push(...i64StoreAtPtr(2, 40, i64Const(BigInt(terminal.executed))));
        emitted.push(...localGet(19));
        return emitted;
    }

    try {
        const words = readGeneratedOutputWords();
        if (!words || words.length === 0) {
            setResult(0, 4n);
            return 4;
        }
        for (const word of words) {
            if (!shapeOpSupported(bits(word >>> 0, 0, 8))) {
                setResult(0, statusUnsupported);
                return Number(statusUnsupported);
            }
        }
        for (let i = 0; i < words.length; i++) {
            if ((HEAPU32[tbPtr / 4 + i] >>> 0) !== words[i]) {
                HEAPU32[exit / 4] = 8;
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
                functionBody(buildGeneratedInstructions(words), [
                    { count: 35, type: valueI64 },
                ]),
            ])),
        ]);
        if (!WebAssembly.validate(bytes)) {
            setResult(0, 7n);
            return 7;
        }

        for (let i = 0; i < 192 / 8; i++) {
            HEAPU64[counters / 8 + i] = 0n;
        }
        for (let i = 0; i < 48 / 8; i++) {
            HEAPU64[exit / 8 + i] = 0n;
        }
        for (let i = 0; i < scratchWindowSize; i++) {
            HEAPU8[scratchWindowBase + i] = (i * 13 + 17) & 0xff;
        }
        HEAPU64[context / 8 + 2] = guestInsns;
        HEAPU64[context / 8 + 3] = BigInt(counters);
        HEAPU64[context / 8 + 4] = BigInt(exit);

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
        const generatedStart = performance.now();
        const generatedChecksum = BigInt(instance.exports.wasmjit_run(
            BigInt(context)));
        const generatedNs = BigInt(Math.round(
            (performance.now() - generatedStart) * 1000000));
        const reference = referenceRun(words);

        HEAPU64[counters / 8 + 2] = generatedNs;
        HEAPU64[counters / 8 + 8] = compileNs;
        HEAPU64[counters / 8 + 9] = instantiateNs;
        setResult(0, 0n);
        setResult(1, HEAPU32[exit / 4 + 1]);
        setResult(2, reference.status);
        setResult(3, HEAPU64[exit / 8 + 4]);
        setResult(4, reference.value);
        setResult(5, generatedChecksum);
        setResult(6, reference.checksum);
        setResult(7, HEAPU64[exit / 8 + 5]);
        setResult(8, reference.executed);
        setResult(9, guestInsns);
        setResult(10, words.length);

        return HEAPU32[exit / 4 + 1] === Number(reference.status) &&
               HEAPU64[exit / 8 + 4] === reference.value &&
               generatedChecksum === reference.checksum &&
               HEAPU64[exit / 8 + 5] === reference.executed &&
               guestInsns > 0n ? 0 : 2;
    } catch (error) {
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

static bool tcg_wasm64_live_generated_exec_op_supported(uint32_t op)
{
    switch ((TCGOpcode)op) {
    case INDEX_op_add:
    case INDEX_op_and:
    case INDEX_op_brcond:
    case INDEX_op_deposit:
    case INDEX_op_exit_tb:
    case INDEX_op_extract:
    case INDEX_op_goto_tb:
    case INDEX_op_ld:
    case INDEX_op_ld32s:
    case INDEX_op_ld32u:
    case INDEX_op_mb:
    case INDEX_op_mov:
    case INDEX_op_mul:
    case INDEX_op_neg:
    case INDEX_op_or:
    case INDEX_op_setcond:
    case INDEX_op_sextract:
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
    case INDEX_op_xor:
        return true;
    default:
        return false;
    }
}

static void tcg_wasm64_live_generated_exec_count_selected_unsupported_op(
    uint32_t op)
{
    if (op < NB_OPS) {
        live_generated_exec_selected_body_unsupported_ops[op]++;
    }
}

static bool tcg_wasm64_live_generated_exec_shape_supported_record(
    const TCGWasm64TBMetadata *metadata, bool record)
{
    const uint32_t *words;

    if (!tcg_wasm64_translate_generated_output_available(metadata)) {
        return false;
    }

    words = metadata->generated_output;
    for (uint32_t i = 0; i < metadata->generated_output_op_count; i++) {
        TCGOpcode op = (TCGOpcode)tcg_wasm64_tci_word_op(words[i]);

        if (!tcg_wasm64_live_generated_exec_op_supported(op)) {
            if (record) {
                tcg_wasm64_live_generated_exec_count_selected_unsupported_op(
                    op);
            }
            return false;
        }
        if (op == INDEX_op_goto_tb || op == INDEX_op_exit_tb) {
            return true;
        }
    }
    if (record) {
        live_generated_exec_selected_body_no_terminal++;
    }
    return false;
}

typedef struct TCGWasm64GeneratedTerminal {
    bool found;
    TCGOpcode op;
    intptr_t slot_offset;
} TCGWasm64GeneratedTerminal;

static bool tcg_wasm64_generated_terminal_parse(
    const TCGWasm64TBMetadata *metadata, TCGWasm64GeneratedTerminal *terminal)
{
    const uint32_t *words;

    memset(terminal, 0, sizeof(*terminal));
    if (!metadata || !tcg_wasm64_translate_generated_output_available(metadata)) {
        return false;
    }

    words = metadata->generated_output;
    for (uint32_t i = 0; i < metadata->generated_output_op_count; i++) {
        uint32_t insn = words[i];
        TCGOpcode op = (TCGOpcode)extract32(insn, 0, 8);

        if (op == INDEX_op_goto_tb || op == INDEX_op_exit_tb) {
            /*
             * Keep this in lock-step with the accepted R4k generated-output
             * model.  TCI records branch slots as compact word offsets; the
             * generated wasm body uses the current word position plus the
             * encoded signed displacement to reach the slot.
             */
            terminal->found = true;
            terminal->op = op;
            terminal->slot_offset =
                (intptr_t)((i + 1) * sizeof(uint32_t)) +
                (intptr_t)sextract32(insn, 12, 20);
            return true;
        }
    }
    return false;
}

static bool tcg_wasm64_generated_terminal_slot_addr(
    const void *tb_ptr, const TranslationBlock *tb,
    const TCGWasm64GeneratedTerminal *terminal, uintptr_t *slot_addr)
{
    intptr_t min_offset = -(intptr_t)TCG_WASM64_LIVE_HOTSET_SLOT_BACKSCAN;
    intptr_t max_offset;

    *slot_addr = 0;
    if (!terminal->found || terminal->op != INDEX_op_goto_tb) {
        return false;
    }
    if (!tb || tb->tc.ptr != tb_ptr ||
        tb->tc.size < sizeof(uintptr_t)) {
        return false;
    }

    max_offset = (intptr_t)tb->tc.size - (intptr_t)sizeof(uintptr_t);
    if (terminal->slot_offset < min_offset ||
        terminal->slot_offset > max_offset) {
        return false;
    }

    *slot_addr = (uintptr_t)((const uint8_t *)tb_ptr +
                             terminal->slot_offset);
    return true;
}

static bool tcg_wasm64_generated_terminal_exit_index(
    const TranslationBlock *tb, uintptr_t slot_addr, unsigned *exit_index)
{
    for (unsigned i = 0; i <= TB_EXIT_IDXMAX; i++) {
        uintptr_t expected =
            (uintptr_t)tcg_splitwx_to_rx(
                (void *)&tb->jmp_target_addr[i]);

        if (slot_addr == expected) {
            *exit_index = i;
            return true;
        }
    }

    return false;
}

static bool tcg_wasm64_live_generated_exec_read_dispatch(
    const void *tb_ptr, const TCGWasm64TBMetadata *metadata,
    const TranslationBlock *tb, uintptr_t *target, uintptr_t *source_exit)
{
    TCGWasm64GeneratedTerminal terminal;
    uintptr_t slot_addr;
    unsigned exit_index;

    *target = 0;
    *source_exit = 0;
    if (!tcg_wasm64_generated_terminal_parse(metadata, &terminal) ||
        !tcg_wasm64_generated_terminal_slot_addr(tb_ptr, tb, &terminal,
                                                 &slot_addr) ||
        !tcg_wasm64_generated_terminal_exit_index(tb, slot_addr,
                                                  &exit_index)) {
        return false;
    }

    memcpy(target, (const void *)slot_addr, sizeof(*target));
    *source_exit = (uintptr_t)tcg_splitwx_to_rx((void *)tb) + exit_index;
    return *target != 0;
}

static void tcg_wasm64_live_generated_exec_probe_hotset_target(
    const void *tb_ptr, const TCGWasm64TBMetadata *metadata,
    const TranslationBlock *tb)
{
    TCGWasm64GeneratedTerminal terminal;
    uintptr_t slot_addr;
    uintptr_t target = 0;
    const TCGWasm64TBMetadata *target_metadata;

    live_generated_exec_hotset_probe_attempts++;
    if (!tcg_wasm64_generated_terminal_parse(metadata, &terminal)) {
        return;
    }
    if (terminal.op != INDEX_op_goto_tb) {
        return;
    }

    live_generated_exec_hotset_goto_sources++;
    if (!tcg_wasm64_generated_terminal_slot_addr(tb_ptr, tb, &terminal,
                                                 &slot_addr)) {
        live_generated_exec_hotset_target_slots_unsafe++;
        return;
    }

    memcpy(&target, (const void *)slot_addr, sizeof(target));
    if (target == 0) {
        live_generated_exec_hotset_target_stale++;
        return;
    }

    live_generated_exec_hotset_target_slots_read++;
    target_metadata = tcg_wasm64_translate_lookup((const void *)target);
    if (!target_metadata) {
        live_generated_exec_hotset_target_stale++;
        return;
    }

    live_generated_exec_hotset_target_metadata_hits++;
    if (tcg_wasm64_translate_generated_output_available(target_metadata)) {
        live_generated_exec_hotset_target_output_hits++;
    }
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

static bool tcg_wasm64_live_tb_coverage_op_supported(uint32_t op)
{
    switch ((TCGOpcode)op) {
    case INDEX_op_add:
    case INDEX_op_and:
    case INDEX_op_brcond:
    case INDEX_op_call:
    case INDEX_op_deposit:
    case INDEX_op_exit_tb:
    case INDEX_op_extract:
    case INDEX_op_goto_tb:
    case INDEX_op_ld:
    case INDEX_op_ld32s:
    case INDEX_op_ld32u:
    case INDEX_op_mb:
    case INDEX_op_mov:
    case INDEX_op_mul:
    case INDEX_op_neg:
    case INDEX_op_or:
    case INDEX_op_setcond:
    case INDEX_op_sextract:
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
    case INDEX_op_xor:
        return true;
    default:
        return false;
    }
}

static bool tcg_wasm64_live_tb_coverage_shape_supported(
    const TCGWasm64TBMetadata *metadata)
{
    const uint32_t *words;

    if (!tcg_wasm64_translate_generated_output_available(metadata)) {
        return false;
    }
    words = metadata->generated_output;
    for (uint32_t i = 0; i < metadata->generated_output_op_count; i++) {
        if (!tcg_wasm64_live_tb_coverage_op_supported(
                tcg_wasm64_tci_word_op(words[i]))) {
            return false;
        }
    }
    return true;
}

static void tcg_wasm64_report_live_tb_coverage(
    const TranslationBlock *tb, const TCGWasm64TBMetadata *metadata,
    const TCGWasm64RunCounters *run_counters,
    const TCGWasm64RunExit *exit, const uint64_t *result, bool ok)
{
    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"live-tb-coverage\","
            "\"name\":\"%s\","
            "\"ok\":%s,"
            "\"real_live_tb\":true,"
            "\"guest_state_commit\":%s,"
            "\"tb_ptr\":\"0x%" PRIxPTR "\","
            "\"tb_pc\":\"0x%" PRIx64 "\","
            "\"tb_cs_base\":\"0x%" PRIx64 "\","
            "\"tb_flags\":%" PRIu32 ","
            "\"tb_cflags\":%" PRIu32 ","
            "\"tb_size\":%" PRIu16 ","
            "\"tb_icount\":%" PRIu16 ","
            "\"metadata_op_count\":%" PRIu32 ","
            "\"metadata_generated_output_size\":%" PRIu32 ","
            "\"metadata_generated_output_op_count\":%" PRIu32 ","
            "\"metadata_generated_output_checksum\":%" PRIu32 ","
            "\"generated_guest_instructions\":%" PRIu64 ","
            "\"generated_body_time_ns\":%" PRIu64 ","
            "\"compile_time_ns\":%" PRIu64 ","
            "\"instantiate_time_ns\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"inline_tlb_hit_loads\":%" PRIu64 ","
            "\"inline_tlb_hit_stores\":%" PRIu64 ","
            "\"helper_calls\":%" PRIu64 ","
            "\"qemu_ld_calls\":%" PRIu64 ","
            "\"qemu_st_calls\":%" PRIu64 ","
            "\"exits_mmio\":%" PRIu64 ","
            "\"exits_tlb_miss_or_fault\":%" PRIu64 ","
            "\"exits_unsupported\":%" PRIu64 ","
            "\"generated_status\":%" PRIu64 ","
            "\"reference_status\":%" PRIu64 ","
            "\"generated_exit_value\":%" PRIu64 ","
            "\"reference_exit_value\":%" PRIu64 ","
            "\"generated_regs_checksum\":%" PRIu64 ","
            "\"reference_regs_checksum\":%" PRIu64 ","
            "\"generated_tci_op_equivalents\":%" PRIu64 ","
            "\"reference_tci_op_equivalents\":%" PRIu64 ","
            "\"generated_output_words\":%" PRIu64 ","
            "\"exit_reason_code\":%u,"
            "\"exit_value\":%" PRIu64 ","
            "\"scanned_live_tbs_before_match\":%" PRIu64 ","
            "\"js_status\":%" PRIu64 "}\n",
            TCG_WASM64_LIVE_TB_COVERAGE_NAME,
            ok ? "true" : "false",
            "false",
            (uintptr_t)tb->tc.ptr,
            (uint64_t)tb->pc,
            tb->cs_base,
            tb->flags,
            tb_cflags(tb),
            tb->size,
            tb->icount,
            metadata->op_count,
            metadata->generated_output_size,
            metadata->generated_output_op_count,
            metadata->generated_output_checksum,
            run_counters->generated_guest_instructions,
            run_counters->generated_body_time_ns,
            run_counters->compile_time_ns,
            run_counters->instantiate_time_ns,
            run_counters->generated_chain_length,
            run_counters->inline_tlb_hit_loads,
            run_counters->inline_tlb_hit_stores,
            run_counters->helper_calls,
            run_counters->qemu_ld_calls,
            run_counters->qemu_st_calls,
            run_counters->exits_mmio,
            run_counters->exits_tlb_miss_or_fault,
            run_counters->exits_unsupported,
            result[1],
            result[2],
            result[3],
            result[4],
            result[5],
            result[6],
            result[7],
            result[8],
            result[10],
            exit->reason,
            exit->value,
            live_tb_coverage_scanned,
            result[0]);
}

static void tcg_wasm64_report_live_tb_coverage_skip(
    const char *blocker, const void *tb_ptr,
    const TCGWasm64TBMetadata *metadata)
{
    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"live-tb-coverage\","
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
            "\"metadata_first_generated_unsupported_op\":%" PRIu32 ","
            "\"metadata_first_generated_unsupported_op_name\":\"%s\","
            "\"scanned_live_tbs\":%" PRIu64 ","
            "\"scan_limit\":%" PRIu64 "}\n",
            TCG_WASM64_LIVE_TB_COVERAGE_NAME,
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
            metadata ? metadata->first_generated_unsupported_op : UINT32_MAX,
            metadata ? tcg_wasm64_op_name(
                metadata->first_generated_unsupported_op) : "none",
            live_tb_coverage_scanned,
            live_tb_coverage_scan_limit);
}

static void tcg_wasm64_record_live_tb_generated_metrics(
    uint64_t guest_insns)
{
    translated_counters.generated_attempts++;
    translated_counters.generated_compiled++;
    translated_counters.generated_executed++;
    translated_counters.generated_coverage_numerator += guest_insns;
}

static void tcg_wasm64_count_live_tb_coverage_denominator(const void *tb_ptr)
{
    TranslationBlock *tb;

    if (!tb_ptr ||
        (!tcg_wasm64_summary_enabled() &&
         !tcg_wasm64_live_one_tb_enabled() &&
         !tcg_wasm64_live_tb_coverage_enabled() &&
         !tcg_wasm64_live_generated_exec_enabled())) {
        return;
    }

    tb = tcg_tb_lookup((uintptr_t)tb_ptr);
    if (tb && tb->icount != 0) {
        translated_counters.generated_coverage_denominator += tb->icount;
    }
}

static uint64_t tcg_wasm64_live_tb_guest_instructions(const void *tb_ptr)
{
    TranslationBlock *tb;

    if (!tb_ptr) {
        return 0;
    }
    tb = tcg_tb_lookup((uintptr_t)tb_ptr);
    return tb ? tb->icount : 0;
}

static void
tcg_wasm64_record_tci_fallback_guest_instructions(uint64_t guest_insns)
{
    translated_counters.fallback_guest_instructions += guest_insns;
}

static TCGWasm64ExitReason tcg_wasm64_live_tb_coverage_fallback_exit(
    const TCGWasm64RunCounters *run_counters,
    const TCGWasm64RunExit *exit, const uint64_t *result)
{
    if (run_counters->exits_mmio != 0 ||
        (TCGWasm64RunExitReason)exit->reason ==
            TCG_WASM64_RUN_EXIT_MMIO) {
        return TCG_WASM64_EXIT_MMIO;
    }
    if (run_counters->exits_tlb_miss_or_fault != 0 ||
        (TCGWasm64RunExitReason)exit->reason ==
            TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT) {
        return TCG_WASM64_EXIT_TLB_MISS;
    }
    if (run_counters->exits_invalidated != 0 ||
        (TCGWasm64RunExitReason)exit->reason ==
            TCG_WASM64_RUN_EXIT_INVALIDATED ||
        result[0] == 3) {
        return TCG_WASM64_EXIT_INVALIDATION;
    }
    return TCG_WASM64_EXIT_UNSUPPORTED;
}

static bool tcg_wasm64_execute_available_generated_output_try(
    CPUArchState *env, const void *tb_ptr,
    const TCGWasm64TBMetadata *metadata, uintptr_t *ret)
{
    TranslationBlock *tb;
    TCGWasm64RunCounters run_counters;
    TCGWasm64RunExit exit;
    TCGWasm64TLBMirror tlb_mirror;
    TCGWasm64RunContext context = { 0 };
    uint64_t result[11] = { 0 };
    uint64_t guest_insns;
    bool ok = false;

    if (live_tb_coverage_checked ||
        !tcg_wasm64_live_tb_coverage_enabled()) {
        return false;
    }

    if (tcg_wasm64_live_generated_exec_enabled()) {
        return false;
    }

    if (!metadata ||
        !tcg_wasm64_live_tb_coverage_shape_supported(metadata)) {
        if (live_tb_coverage_scanned < live_tb_coverage_scan_limit) {
            live_tb_coverage_scanned++;
        }
        if (!live_tb_coverage_no_shape_reported) {
            if (live_tb_coverage_scanned >= live_tb_coverage_scan_limit) {
                live_tb_coverage_no_shape_reported = true;
                tcg_wasm64_report_live_tb_coverage_skip(
                    "scan limit reached before a generated live TB shape ran",
                    tb_ptr, metadata);
            }
        }
        if (metadata) {
            translated_counters.fallback_runtime++;
            tcg_wasm64_count_exit(&translated_counters,
                                  TCG_WASM64_EXIT_UNSUPPORTED);
        }
        return false;
    }

    live_tb_coverage_scanned++;
    tb = tcg_tb_lookup((uintptr_t)tb_ptr);
    if (!tb || tb->icount == 0) {
        if (!live_tb_coverage_no_shape_reported) {
            live_tb_coverage_no_shape_reported = true;
            tcg_wasm64_report_live_tb_coverage_skip(
                "generated output matched but TranslationBlock identity "
                "or icount was missing",
                tb_ptr, metadata);
        }
        return false;
    }
    guest_insns = tb->icount;

    tcg_wasm64_run_counters_reset(&run_counters);
    memset(&exit, 0, sizeof(exit));
    tcg_wasm64_tlb_mirror_reset(&tlb_mirror);
    tcg_wasm64_tlb_mirror_refresh(
        &tlb_mirror, env, cpu_mmu_index(env_cpu(env), false));
    context.env = env;
    context.budget = guest_insns;
    context.counters = &run_counters;
    context.exit = &exit;
    context.mode = TCG_WASM64_RUN_MODE_PERF_PROOF;
    context.tlb = &tlb_mirror;

#ifdef CONFIG_EMSCRIPTEN
    {
        g_autofree uint8_t *scratch = g_malloc0(
            TCG_WASM64_ONE_TB_SCRATCH_SIZE);

        result[0] = tcg_wasm64_live_tb_coverage_js(
            (uintptr_t)&context, (uintptr_t)scratch,
            (uintptr_t)&run_counters, (uintptr_t)&exit,
            (uintptr_t)result, (uintptr_t)tb_ptr, guest_insns,
            (uintptr_t)metadata->generated_output,
            metadata->generated_output_size,
            INDEX_op_add, INDEX_op_and, INDEX_op_brcond, INDEX_op_call,
            INDEX_op_deposit, INDEX_op_exit_tb, INDEX_op_extract,
            INDEX_op_goto_tb, INDEX_op_ld, INDEX_op_ld32s, INDEX_op_ld32u,
            INDEX_op_mb, INDEX_op_mov, INDEX_op_mul, INDEX_op_neg,
            INDEX_op_or, INDEX_op_setcond, INDEX_op_sextract, INDEX_op_shl,
            INDEX_op_shr, INDEX_op_st, INDEX_op_st8, INDEX_op_st32,
            INDEX_op_sub, INDEX_op_tci_movi, INDEX_op_tci_movl,
            INDEX_op_tci_qemu_ld_rrr, INDEX_op_tci_qemu_st_rrr,
            INDEX_op_tci_setcond32, INDEX_op_xor);
    }
#else
    result[0] = 1;
#endif

    ok = result[0] == 0 &&
         result[1] == result[2] &&
         result[3] == result[4] &&
         result[5] == result[6] &&
         result[7] == result[8] &&
         result[9] == guest_insns &&
         run_counters.generated_guest_instructions == guest_insns &&
         run_counters.generated_chain_length == 1 &&
         exit.reason == result[1] &&
         exit.value == result[3];

    if (ok) {
        tcg_wasm64_record_live_tb_generated_metrics(guest_insns);
        live_tb_coverage_checked = true;
        *ret = (uintptr_t)exit.value;
    } else {
        TCGWasm64ExitReason reason =
            tcg_wasm64_live_tb_coverage_fallback_exit(
                &run_counters, &exit, result);

        translated_counters.generated_attempts++;
        translated_counters.fallback_runtime++;
        tcg_wasm64_count_exit(&translated_counters, reason);
    }
    tcg_wasm64_report_live_tb_coverage(
        tb, metadata, &run_counters, &exit, result, ok);
    return false;
}

static TCGWasm64ExitReason
tcg_wasm64_live_generated_exec_summary_exit_reason(
    TCGWasm64RunExitReason reason);

static void tcg_wasm64_live_generated_exec_count_reject(
    TCGWasm64Counters *counters, TCGWasm64RunExitReason reason)
{
    if (counters) {
        tcg_wasm64_count_fallback(counters, TCG_WASM64_FALLBACK_RUNTIME);
    }
    translated_counters.fallback_runtime++;
    tcg_wasm64_count_exit(
        &translated_counters,
        tcg_wasm64_live_generated_exec_summary_exit_reason(reason));
}

static TCGWasm64ExitReason
tcg_wasm64_live_generated_exec_summary_exit_reason(
    TCGWasm64RunExitReason reason)
{
    switch (reason) {
    case TCG_WASM64_RUN_EXIT_MMIO:
        return TCG_WASM64_EXIT_MMIO;
    case TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT:
        return TCG_WASM64_EXIT_TLB_MISS;
    case TCG_WASM64_RUN_EXIT_INTERRUPT:
        return TCG_WASM64_EXIT_INTERRUPT;
    case TCG_WASM64_RUN_EXIT_BUDGET:
        return TCG_WASM64_EXIT_BUDGET;
    case TCG_WASM64_RUN_EXIT_INVALIDATED:
        return TCG_WASM64_EXIT_INVALIDATION;
    case TCG_WASM64_RUN_EXIT_UNSUPPORTED:
    default:
        return TCG_WASM64_EXIT_UNSUPPORTED;
    }
}

static void tcg_wasm64_live_generated_exec_fail_closed(
    const char *reason, bool fail_closed)
{
    if (!fail_closed) {
        return;
    }
    if (tcg_wasm64_live_generated_exec_no_fallback()) {
        g_error("qemu-wasm64-live-generated-exec: no-silent-fallback: %s",
                reason);
    }
    g_error("qemu-wasm64-live-generated-exec: fail-closed: %s", reason);
}

static void tcg_wasm64_live_generated_exec_count_attempt(void)
{
    live_generated_exec_attempted++;
    translated_counters.generated_attempts++;
}

static bool tcg_wasm64_live_generated_exec_helper_exit_shape(
    const TCGWasm64TBMetadata *metadata)
{
    return metadata && metadata->generated_helper_exit_op_count != 0;
}

static const char * const live_generated_exec_reject_reason_names[] = {
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_METADATA_MISSING] =
        "metadata-missing",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_OUTPUT_UNAVAILABLE] =
        "generated-output-unavailable",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SHAPE_UNSUPPORTED] =
        "selected-body-shape-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_HELPER_EXIT_UNSUPPORTED] =
        "selected-body-helper-exit-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TB_IDENTITY_MISSING_OR_STALE] =
        "tb-identity-missing-or-stale",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_RUNTIME_UNAVAILABLE] =
        "js-status-runtime-unavailable",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_DIFFERENTIAL_MISMATCH] =
        "js-status-differential-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_MISMATCH] =
        "js-status-metadata-output-tb-code-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_BRANCH_LABEL_RELOCATION] =
        "js-status-metadata-output-branch-label-relocation",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_POOL_RELOCATION] =
        "js-status-metadata-output-pool-relocation",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_STALE_TB_CODE] =
        "js-status-metadata-output-stale-tb-code",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_UNKNOWN_MISMATCH] =
        "js-status-metadata-output-unknown-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_OUTPUT_UNAVAILABLE] =
        "js-status-generated-output-unavailable",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_SHAPE_UNSUPPORTED] =
        "js-status-selected-body-shape-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_EMISSION_FAILED] =
        "js-status-module-emission-failed",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_VALIDATION_FAILED] =
        "js-status-module-validation-failed",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_UNKNOWN] =
        "js-status-unknown",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_STATUS_HELPER] =
        "generated-status-helper",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_STATUS_UNEXPECTED] =
        "generated-status-unexpected",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_MISSING_RETURN_TARGET] =
        "missing-return-target",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GUEST_INSTRUCTION_MISMATCH] =
        "guest-instruction-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TCI_OP_COUNT_MISMATCH] =
        "tci-op-count-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_OUTPUT_WORDS_MISMATCH] =
        "generated-output-words-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_COUNTER_GUEST_INSN_MISMATCH] =
        "counter-guest-instruction-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_LENGTH_MISMATCH] =
        "chain-length-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_HELPER_COUNTER_MISMATCH] =
        "helper-counter-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_QEMU_HELPER_COUNTER_MISMATCH] =
        "qemu-helper-counter-mismatch",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_MMIO_EXIT] =
        "mmio-exit",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TLB_MISS_OR_FAULT_EXIT] =
        "tlb-miss-or-fault-exit",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_INVALIDATED] =
        "invalidated",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_UNSUPPORTED_BODY_STATE] =
        "unsupported-body-state",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNPROVEN] =
        "selected-body-memop-unproven",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIZE] =
        "selected-body-memop-unsupported-size",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIGN] =
        "selected-body-memop-unsupported-sign",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ENDIAN] =
        "selected-body-memop-unsupported-endian",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ALIGNMENT] =
        "selected-body-memop-unsupported-alignment",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ATOMIC] =
        "selected-body-memop-unsupported-atomic",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_HIGH_FLAGS] =
        "selected-body-memop-unsupported-high-flags",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNEXPECTED_MMU_IDX] =
        "selected-body-memop-unexpected-mmu-idx",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_DIRECT_MEMORY_UNSUPPORTED] =
        "selected-body-direct-memory-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_CONTROL_FLOW_UNSUPPORTED] =
        "selected-body-control-flow-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_UNAVAILABLE] =
        "selected-body-softmmu-unavailable",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_MULTI_ACCESS_UNSUPPORTED] =
        "selected-body-softmmu-multi-access-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_TLB_MIRROR_INVALID] =
        "selected-body-softmmu-tlb-mirror-invalid",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_BUDGET] =
        "chain-budget",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_TARGET_UNSUPPORTED] =
        "chain-target-unsupported",
    [TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_INTERRUPTED] =
        "chain-interrupted",
};

QEMU_BUILD_BUG_ON(ARRAY_SIZE(live_generated_exec_reject_reason_names) !=
                  TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX);

static const char *tcg_wasm64_live_generated_exec_reject_reason_name(
    TCGWasm64LiveGeneratedExecRejectReason reason)
{
    if (reason >= TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX ||
        !live_generated_exec_reject_reason_names[reason]) {
        return "unknown";
    }
    return live_generated_exec_reject_reason_names[reason];
}

static TCGWasm64LiveGeneratedExecRejectReason
tcg_wasm64_live_generated_exec_reject_reason(const char *reason)
{
    for (size_t i = 0;
         i < ARRAY_SIZE(live_generated_exec_reject_reason_names);
         i++) {
        if (g_strcmp0(reason, live_generated_exec_reject_reason_names[i]) ==
            0) {
            return (TCGWasm64LiveGeneratedExecRejectReason)i;
        }
    }
    return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_UNSUPPORTED_BODY_STATE;
}

static uint64_t tcg_wasm64_live_generated_exec_reject_total(void)
{
    uint64_t total = 0;

    for (size_t i = 0; i < ARRAY_SIZE(live_generated_exec_reject_reasons);
         i++) {
        total += live_generated_exec_reject_reasons[i];
    }
    return total;
}

static void tcg_wasm64_live_generated_exec_count_reason(const char *reason)
{
    TCGWasm64LiveGeneratedExecRejectReason index =
        tcg_wasm64_live_generated_exec_reject_reason(reason);

    live_generated_exec_reject_reasons[index]++;
}

static bool tcg_wasm64_live_generated_exec_memop_attribution_reason(
    TCGWasm64LiveGeneratedExecRejectReason reason)
{
    switch (reason) {
    case TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIZE:
    case TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ALIGNMENT:
    case TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ATOMIC:
        return true;
    default:
        return false;
    }
}

static void tcg_wasm64_live_generated_exec_count_memop_reject(
    TCGWasm64LiveGeneratedExecRejectReason reason, MemOp memop)
{
    TCGWasm64LiveMemOpRejectStat *stats;

    if (!tcg_wasm64_live_generated_exec_memop_attribution_reason(reason)) {
        return;
    }

    stats = live_generated_exec_reject_memops[reason];
    for (size_t i = 0; i < TCG_WASM64_LIVE_MEMOP_REJECT_SLOTS; i++) {
        if (stats[i].count != 0 && stats[i].memop == memop) {
            stats[i].count++;
            return;
        }
    }
    for (size_t i = 0; i < TCG_WASM64_LIVE_MEMOP_REJECT_SLOTS; i++) {
        if (stats[i].count == 0) {
            stats[i].memop = memop;
            stats[i].count = 1;
            return;
        }
    }
    stats[TCG_WASM64_LIVE_MEMOP_REJECT_SLOTS - 1].count++;
}

static bool tcg_wasm64_live_generated_exec_multi_access_stat_matches(
    const TCGWasm64LiveMultiAccessRejectStat *stat, uint32_t access_count,
    uint32_t load_count, uint32_t store_count, const char *order,
    const MemOp *memops, bool store_before_later_guard)
{
    if (stat->count == 0 ||
        stat->access_count != access_count ||
        stat->load_count != load_count ||
        stat->store_count != store_count ||
        stat->store_before_later_guard != store_before_later_guard ||
        strncmp(stat->order, order, sizeof(stat->order)) != 0) {
        return false;
    }
    for (uint32_t i = 0; i < MIN(access_count,
                                  TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES);
         i++) {
        if (stat->memops[i] != memops[i]) {
            return false;
        }
    }
    return true;
}

static void tcg_wasm64_live_generated_exec_store_multi_access_stat(
    TCGWasm64LiveMultiAccessRejectStat *stat, uint32_t access_count,
    uint32_t load_count, uint32_t store_count, const char *order,
    const MemOp *memops, bool store_before_later_guard)
{
    stat->access_count = access_count;
    stat->load_count = load_count;
    stat->store_count = store_count;
    stat->store_before_later_guard = store_before_later_guard;
    memset(stat->order, 0, sizeof(stat->order));
    memcpy(stat->order, order, MIN(strlen(order), sizeof(stat->order) - 1));
    memset(stat->memops, 0, sizeof(stat->memops));
    for (uint32_t i = 0; i < MIN(access_count,
                                  TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES);
         i++) {
        stat->memops[i] = memops[i];
    }
    stat->count = 1;
}

static void tcg_wasm64_live_generated_exec_count_multi_access_reject(
    uint32_t access_count, uint32_t load_count, uint32_t store_count,
    const char *order, const MemOp *memops, bool store_before_later_guard)
{
    for (size_t i = 0; i < TCG_WASM64_LIVE_MULTI_ACCESS_REJECT_SLOTS; i++) {
        TCGWasm64LiveMultiAccessRejectStat *stat =
            &live_generated_exec_reject_multi_accesses[i];

        if (tcg_wasm64_live_generated_exec_multi_access_stat_matches(
                stat, access_count, load_count, store_count, order, memops,
                store_before_later_guard)) {
            stat->count++;
            return;
        }
    }
    for (size_t i = 0; i < TCG_WASM64_LIVE_MULTI_ACCESS_REJECT_SLOTS; i++) {
        TCGWasm64LiveMultiAccessRejectStat *stat =
            &live_generated_exec_reject_multi_accesses[i];

        if (stat->count == 0) {
            tcg_wasm64_live_generated_exec_store_multi_access_stat(
                stat, access_count, load_count, store_count, order, memops,
                store_before_later_guard);
            return;
        }
    }
    live_generated_exec_reject_multi_accesses[
        TCG_WASM64_LIVE_MULTI_ACCESS_REJECT_SLOTS - 1].count++;
}

static bool tcg_wasm64_live_generated_exec_direct_memory_stat_matches(
    const TCGWasm64LiveDirectMemoryRejectStat *stat,
    TCGWasm64LiveDirectMemoryRejectRoute route, TCGOpcode op,
    uint32_t base_reg, int32_t offset, int32_t size,
    bool env_relative_supported, uint32_t softmmu_access_count,
    const char *softmmu_order)
{
    return stat->count != 0 &&
           stat->route == route &&
           stat->op == op &&
           stat->base_reg == base_reg &&
           stat->offset == offset &&
           stat->size == size &&
           stat->env_relative_supported == env_relative_supported &&
           stat->softmmu_access_count == softmmu_access_count &&
           strncmp(stat->softmmu_order, softmmu_order,
                   sizeof(stat->softmmu_order)) == 0;
}

static void tcg_wasm64_live_generated_exec_store_direct_memory_stat(
    TCGWasm64LiveDirectMemoryRejectStat *stat,
    TCGWasm64LiveDirectMemoryRejectRoute route, TCGOpcode op,
    uint32_t base_reg, int32_t offset, int32_t size,
    bool env_relative_supported, uint32_t softmmu_access_count,
    const char *softmmu_order)
{
    stat->route = route;
    stat->op = op;
    stat->base_reg = base_reg;
    stat->offset = offset;
    stat->size = size;
    stat->env_relative_supported = env_relative_supported;
    stat->softmmu_access_count = softmmu_access_count;
    memset(stat->softmmu_order, 0, sizeof(stat->softmmu_order));
    memcpy(stat->softmmu_order, softmmu_order,
           MIN(strlen(softmmu_order), sizeof(stat->softmmu_order) - 1));
    stat->count = 1;
}

static void tcg_wasm64_live_generated_exec_count_direct_memory_reject(
    TCGWasm64LiveDirectMemoryRejectRoute route, TCGOpcode op,
    uint32_t base_reg, int32_t offset, int32_t size,
    bool env_relative_supported, uint32_t softmmu_access_count,
    const char *softmmu_order)
{
    for (size_t i = 0; i < TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_SLOTS; i++) {
        TCGWasm64LiveDirectMemoryRejectStat *stat =
            &live_generated_exec_reject_direct_memory[i];

        if (tcg_wasm64_live_generated_exec_direct_memory_stat_matches(
                stat, route, op, base_reg, offset, size,
                env_relative_supported, softmmu_access_count,
                softmmu_order)) {
            stat->count++;
            return;
        }
    }
    for (size_t i = 0; i < TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_SLOTS; i++) {
        TCGWasm64LiveDirectMemoryRejectStat *stat =
            &live_generated_exec_reject_direct_memory[i];

        if (stat->count == 0) {
            tcg_wasm64_live_generated_exec_store_direct_memory_stat(
                stat, route, op, base_reg, offset, size,
                env_relative_supported, softmmu_access_count,
                softmmu_order);
            return;
        }
    }
    live_generated_exec_reject_direct_memory[
        TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_SLOTS - 1].count++;
}

typedef struct TCGWasm64LiveMemOpState {
    bool known[16];
    uint32_t value[16];
} TCGWasm64LiveMemOpState;

static uint32_t tcg_wasm64_tci_word_r0(uint32_t word)
{
    return extract32(word, 8, 4);
}

static uint32_t tcg_wasm64_tci_word_r1(uint32_t word)
{
    return extract32(word, 12, 4);
}

static uint32_t tcg_wasm64_tci_word_r2(uint32_t word)
{
    return extract32(word, 16, 4);
}

static uint32_t tcg_wasm64_tci_word_i20(uint32_t word)
{
    return (uint32_t)sextract32(word, 12, 20);
}

static void tcg_wasm64_live_memop_state_unknown(
    TCGWasm64LiveMemOpState *state, uint32_t reg)
{
    if (reg < ARRAY_SIZE(state->known)) {
        state->known[reg] = false;
        state->value[reg] = 0;
    }
}

static void tcg_wasm64_live_memop_state_known(
    TCGWasm64LiveMemOpState *state, uint32_t reg, uint32_t value)
{
    if (reg < ARRAY_SIZE(state->known)) {
        state->known[reg] = true;
        state->value[reg] = value;
    }
}

static void tcg_wasm64_live_memop_state_copy(
    TCGWasm64LiveMemOpState *state, uint32_t dest, uint32_t source)
{
    if (dest >= ARRAY_SIZE(state->known)) {
        return;
    }
    if (source < ARRAY_SIZE(state->known) && state->known[source]) {
        tcg_wasm64_live_memop_state_known(state, dest, state->value[source]);
    } else {
        tcg_wasm64_live_memop_state_unknown(state, dest);
    }
}

static bool tcg_wasm64_live_generated_exec_op_writes_r0(TCGOpcode op)
{
    switch (op) {
    case INDEX_op_brcond:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
    case INDEX_op_mb:
    case INDEX_op_tci_qemu_st_rrr:
        return false;
    default:
        return true;
    }
}

static bool tcg_wasm64_live_generated_exec_direct_memory_size(TCGOpcode op,
                                                              int32_t *size)
{
    switch (op) {
    case INDEX_op_st8:
        *size = 1;
        return true;
    case INDEX_op_ld32s:
    case INDEX_op_ld32u:
    case INDEX_op_st32:
        *size = 4;
        return true;
    case INDEX_op_ld:
    case INDEX_op_st:
        *size = 8;
        return true;
    default:
        *size = 0;
        return false;
    }
}

static bool tcg_wasm64_live_generated_exec_direct_memory_is_store(TCGOpcode op)
{
    switch (op) {
    case INDEX_op_st:
    case INDEX_op_st8:
    case INDEX_op_st32:
        return true;
    default:
        return false;
    }
}

static bool tcg_wasm64_live_generated_exec_direct_memory_supported(
    uint32_t word, bool env_base_valid)
{
    int32_t size;
    int32_t offset;
    TCGOpcode op = (TCGOpcode)tcg_wasm64_tci_word_op(word);

    if (!tcg_wasm64_live_generated_exec_direct_memory_size(
            op, &size)) {
        return true;
    }
    offset = sextract32(word, 16, 16);
    return env_base_valid &&
           tcg_wasm64_tci_word_r1(word) == 14 &&
           (!tcg_wasm64_live_generated_exec_op_writes_r0(op) ||
            tcg_wasm64_tci_word_r0(word) != 14) &&
           offset >= -16 &&
           offset + size <= 0x120;
}

static bool tcg_wasm64_live_generated_exec_direct_memory_ranges_overlap(
    int32_t lhs_offset, int32_t lhs_size, int32_t rhs_offset, int32_t rhs_size)
{
    return lhs_offset < rhs_offset + rhs_size &&
           rhs_offset < lhs_offset + lhs_size;
}

static bool tcg_wasm64_live_generated_exec_control_flow_supported(
    uint32_t index, uint32_t word)
{
    int32_t target_offset;
    int32_t target_index;

    if ((TCGOpcode)tcg_wasm64_tci_word_op(word) != INDEX_op_brcond) {
        return true;
    }
    target_offset = (int32_t)((index + 1) * 4) +
                    sextract32(word, 12, 20);
    if (target_offset % 4 != 0) {
        return false;
    }
    target_index = target_offset / 4;
    return target_index > (int32_t)index;
}

static TCGWasm64LiveGeneratedExecRejectReason
tcg_wasm64_live_generated_exec_validate_memop(MemOp memop)
{
    const MemOp supported_flags = MO_SIZE | MO_SIGN | MO_BSWAP | MO_AMASK |
                                  MO_ALIGN_TLB_ONLY | MO_ATOM_MASK;

    if (memop & ~supported_flags) {
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_HIGH_FLAGS;
    }
    switch (memop & MO_SIZE) {
    case MO_8:
    case MO_32:
    case MO_64:
        break;
    default:
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIZE;
    }
    if (memop & MO_SIGN) {
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_SIGN;
    }
    if (memop & MO_BSWAP) {
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ENDIAN;
    }
    if (memop & (MO_AMASK | MO_ALIGN_TLB_ONLY)) {
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ALIGNMENT;
    }
    if ((memop & MO_ATOM_MASK) != MO_ATOM_NONE) {
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNSUPPORTED_ATOMIC;
    }
    return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX;
}

static TCGWasm64LiveGeneratedExecRejectReason
tcg_wasm64_live_generated_exec_validate_selected_memops(
    CPUArchState *env, const TCGWasm64TBMetadata *metadata, bool *has_memop,
    uint32_t *mmu_idx_out)
{
    TCGWasm64LiveMemOpState state = { 0 };
    bool have_mmu_idx = false;
    bool direct_memory_unsupported = false;
    bool control_flow_unsupported = false;
    bool env_base_valid = true;
    TCGWasm64LiveDirectMemoryRejectRoute direct_memory_reject_route =
        TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_IMMEDIATE_UNSUPPORTED;
    TCGOpcode direct_memory_reject_op = (TCGOpcode)0;
    uint32_t direct_memory_reject_base = 0;
    int32_t direct_memory_reject_offset = 0;
    int32_t direct_memory_reject_size = 0;
    bool direct_memory_reject_supported = false;
    bool saw_store_access = false;
    bool load_after_store = false;
    bool store_before_later_guard = false;
    uint32_t proven_mmu_idx = 0;
    uint32_t memop_count = 0;
    uint32_t load_count = 0;
    uint32_t store_count = 0;
    uint32_t direct_store_count = 0;
    int32_t direct_store_offsets[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES] = { 0 };
    int32_t direct_store_sizes[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES] = { 0 };
    char access_order[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES + 1] = { 0 };
    MemOp access_memops[TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES] = { 0 };

    *has_memop = false;
    *mmu_idx_out = 0;
    for (uint32_t i = 0; i < metadata->generated_output_op_count; i++) {
        uint32_t word = metadata->generated_output[i];
        TCGOpcode op = (TCGOpcode)tcg_wasm64_tci_word_op(word);
        uint32_t r0 = tcg_wasm64_tci_word_r0(word);

        switch (op) {
        case INDEX_op_exit_tb:
        case INDEX_op_goto_tb:
        case INDEX_op_call:
            i = metadata->generated_output_op_count;
            break;
        case INDEX_op_tci_movi:
            tcg_wasm64_live_memop_state_known(
                &state, r0, tcg_wasm64_tci_word_i20(word));
            if (r0 == 14) {
                env_base_valid = false;
            }
            break;
        case INDEX_op_tci_movl:
            tcg_wasm64_live_memop_state_unknown(&state, r0);
            if (r0 == 14) {
                env_base_valid = false;
            }
            break;
        case INDEX_op_mov:
            tcg_wasm64_live_memop_state_copy(
                &state, r0, tcg_wasm64_tci_word_r1(word));
            if (r0 == 14) {
                env_base_valid = false;
            }
            break;
        case INDEX_op_tci_qemu_ld_rrr:
        case INDEX_op_tci_qemu_st_rrr:
        {
            uint32_t oi_reg = tcg_wasm64_tci_word_r2(word);
            bool is_store = op == INDEX_op_tci_qemu_st_rrr;
            MemOpIdx oi;
            MemOp memop;
            unsigned mmu_idx;
            TCGWasm64LiveGeneratedExecRejectReason reason;
#if !defined(CONFIG_USER_ONLY)
            int current_mmu_idx;
#endif

            *has_memop = true;
            memop_count++;
            if (oi_reg >= ARRAY_SIZE(state.known) || !state.known[oi_reg]) {
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNPROVEN;
            }
            oi = state.value[oi_reg];
            memop = get_memop(oi);
            mmu_idx = get_mmuidx(oi);
            reason = tcg_wasm64_live_generated_exec_validate_memop(memop);
            if (reason != TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX) {
                tcg_wasm64_live_generated_exec_count_memop_reject(reason,
                                                                  memop);
                return reason;
            }
            if (is_store) {
                store_count++;
                saw_store_access = true;
            } else {
                if (saw_store_access) {
                    load_after_store = true;
                    store_before_later_guard = true;
                }
                load_count++;
            }
            if (memop_count <= TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES) {
                access_order[memop_count - 1] = is_store ? 'S' : 'L';
                access_memops[memop_count - 1] = memop;
            } else {
                tcg_wasm64_live_generated_exec_count_multi_access_reject(
                    memop_count, load_count, store_count, access_order,
                    access_memops, store_before_later_guard);
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_MULTI_ACCESS_UNSUPPORTED;
            }
#if defined(CONFIG_USER_ONLY)
            return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_UNAVAILABLE;
#else
            if (!env) {
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_UNAVAILABLE;
            }
            current_mmu_idx = cpu_mmu_index(env_cpu(env), false);
            if (mmu_idx != (unsigned)current_mmu_idx) {
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNEXPECTED_MMU_IDX;
            }
#endif
            if (!have_mmu_idx) {
                proven_mmu_idx = mmu_idx;
                have_mmu_idx = true;
            } else if (proven_mmu_idx != mmu_idx) {
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_MEMOP_UNEXPECTED_MMU_IDX;
            }
            if (op == INDEX_op_tci_qemu_ld_rrr) {
                tcg_wasm64_live_memop_state_unknown(&state, r0);
                if (r0 == 14) {
                    env_base_valid = false;
                }
            }
            break;
        }
        case INDEX_op_ld:
        case INDEX_op_ld32s:
        case INDEX_op_ld32u:
        case INDEX_op_st:
        case INDEX_op_st8:
        case INDEX_op_st32:
        {
            int32_t size;
            int32_t offset = sextract32(word, 16, 16);
            bool supported;

            tcg_wasm64_live_generated_exec_direct_memory_size(op, &size);
            supported =
                tcg_wasm64_live_generated_exec_direct_memory_supported(
                    word, env_base_valid);
            if (!supported) {
                tcg_wasm64_live_generated_exec_count_direct_memory_reject(
                    TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_IMMEDIATE_UNSUPPORTED,
                    op, tcg_wasm64_tci_word_r1(word), offset, size, false,
                    memop_count, access_order);
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_DIRECT_MEMORY_UNSUPPORTED;
            }
            if (tcg_wasm64_live_generated_exec_direct_memory_is_store(op)) {
                if (direct_store_count >=
                    TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES) {
                    direct_memory_unsupported = true;
                    direct_memory_reject_route =
                        TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_MULTI_ACCESS_ALIAS;
                    direct_memory_reject_op = op;
                    direct_memory_reject_base =
                        tcg_wasm64_tci_word_r1(word);
                    direct_memory_reject_offset = offset;
                    direct_memory_reject_size = size;
                    direct_memory_reject_supported = true;
                } else {
                    direct_store_offsets[direct_store_count] = offset;
                    direct_store_sizes[direct_store_count] = size;
                    direct_store_count++;
                }
            } else {
                for (uint32_t direct = 0; direct < direct_store_count;
                     direct++) {
                    if (tcg_wasm64_live_generated_exec_direct_memory_ranges_overlap(
                            direct_store_offsets[direct],
                            direct_store_sizes[direct], offset, size)) {
                        direct_memory_unsupported = true;
                        direct_memory_reject_route =
                            TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_MULTI_ACCESS_ALIAS;
                        direct_memory_reject_op = op;
                        direct_memory_reject_base =
                            tcg_wasm64_tci_word_r1(word);
                        direct_memory_reject_offset = offset;
                        direct_memory_reject_size = size;
                        direct_memory_reject_supported = true;
                    }
                }
            }
            if (tcg_wasm64_live_generated_exec_op_writes_r0(op)) {
                tcg_wasm64_live_memop_state_unknown(&state, r0);
                if (r0 == 14) {
                    env_base_valid = false;
                }
            }
            break;
        }
        case INDEX_op_brcond:
            control_flow_unsupported = true;
            if (!tcg_wasm64_live_generated_exec_control_flow_supported(
                    i, word)) {
                return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_CONTROL_FLOW_UNSUPPORTED;
            }
            break;
        default:
            if (tcg_wasm64_live_generated_exec_op_writes_r0(op)) {
                tcg_wasm64_live_memop_state_unknown(&state, r0);
                if (r0 == 14) {
                    env_base_valid = false;
                }
            }
            break;
        }
    }
    if (memop_count > 1 && direct_memory_unsupported) {
        tcg_wasm64_live_generated_exec_count_direct_memory_reject(
            direct_memory_reject_route, direct_memory_reject_op,
            direct_memory_reject_base, direct_memory_reject_offset,
            direct_memory_reject_size, direct_memory_reject_supported,
            memop_count, access_order);
        tcg_wasm64_live_generated_exec_count_multi_access_reject(
            memop_count, load_count, store_count, access_order,
            access_memops, store_before_later_guard);
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_DIRECT_MEMORY_UNSUPPORTED;
    }
    if (memop_count > 1 && control_flow_unsupported) {
        tcg_wasm64_live_generated_exec_count_multi_access_reject(
            memop_count, load_count, store_count, access_order,
            access_memops, store_before_later_guard);
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_CONTROL_FLOW_UNSUPPORTED;
    }
    if (memop_count > 1 && load_after_store) {
        tcg_wasm64_live_generated_exec_count_multi_access_reject(
            memop_count, load_count, store_count, access_order,
            access_memops, store_before_later_guard);
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_MULTI_ACCESS_UNSUPPORTED;
    }
    if (have_mmu_idx) {
        *mmu_idx_out = proven_mmu_idx;
    }
    return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX;
}

static void tcg_wasm64_print_live_generated_exec_reject_reasons(void)
{
    for (size_t i = 0; i < ARRAY_SIZE(live_generated_exec_reject_reasons);
         i++) {
        fprintf(stderr,
                "%s{\"reason\":\"%s\",\"count\":%" PRIu64 "}",
                i == 0 ? "" : ",",
                tcg_wasm64_live_generated_exec_reject_reason_name(i),
                live_generated_exec_reject_reasons[i]);
    }
}

static void tcg_wasm64_print_live_generated_exec_reject_memops(void)
{
    bool first = true;

    for (size_t reason = 0;
         reason < ARRAY_SIZE(live_generated_exec_reject_memops);
         reason++) {
        TCGWasm64LiveGeneratedExecRejectReason reject_reason =
            (TCGWasm64LiveGeneratedExecRejectReason)reason;

        if (!tcg_wasm64_live_generated_exec_memop_attribution_reason(
                reject_reason)) {
            continue;
        }
        for (size_t slot = 0; slot < TCG_WASM64_LIVE_MEMOP_REJECT_SLOTS;
             slot++) {
            const TCGWasm64LiveMemOpRejectStat *stat =
                &live_generated_exec_reject_memops[reason][slot];

            if (stat->count == 0) {
                continue;
            }
            fprintf(stderr,
                    "%s{\"reason\":\"%s\",\"memop\":%u,"
                    "\"memop_hex\":\"0x%x\",\"count\":%" PRIu64 "}",
                    first ? "" : ",",
                    tcg_wasm64_live_generated_exec_reject_reason_name(
                        reject_reason),
                    (unsigned)stat->memop, (unsigned)stat->memop,
                    stat->count);
            first = false;
        }
    }
}

static void tcg_wasm64_print_live_generated_exec_reject_multi_accesses(void)
{
    bool first = true;

    for (size_t slot = 0; slot < TCG_WASM64_LIVE_MULTI_ACCESS_REJECT_SLOTS;
         slot++) {
        const TCGWasm64LiveMultiAccessRejectStat *stat =
            &live_generated_exec_reject_multi_accesses[slot];

        if (stat->count == 0) {
            continue;
        }
        fprintf(stderr,
                "%s{\"reason\":\"selected-body-softmmu-multi-access-unsupported\","
                "\"access_count\":%u,\"order\":\"%s\","
                "\"loads\":%u,\"stores\":%u,"
                "\"store_before_later_guard\":%s,\"memops\":[",
                first ? "" : ",",
                stat->access_count, stat->order,
                stat->load_count, stat->store_count,
                stat->store_before_later_guard ? "true" : "false");
        for (uint32_t i = 0; i < MIN(stat->access_count,
                                     TCG_WASM64_LIVE_SOFTMMU_MAX_ACCESSES);
             i++) {
            fprintf(stderr, "%s\"0x%x\"", i == 0 ? "" : ",",
                    (unsigned)stat->memops[i]);
        }
        fprintf(stderr, "],\"count\":%" PRIu64 "}", stat->count);
        first = false;
    }
}

static const char *tcg_wasm64_live_generated_exec_direct_memory_route_name(
    TCGWasm64LiveDirectMemoryRejectRoute route)
{
    switch (route) {
    case TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_IMMEDIATE_UNSUPPORTED:
        return "immediate-unsupported";
    case TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_MULTI_ACCESS_ALIAS:
        return "multi-access-deferred-alias";
    default:
        return "unknown";
    }
}

static void tcg_wasm64_print_live_generated_exec_reject_direct_memory(void)
{
    bool first = true;

    for (size_t slot = 0;
         slot < TCG_WASM64_LIVE_DIRECT_MEMORY_REJECT_SLOTS; slot++) {
        const TCGWasm64LiveDirectMemoryRejectStat *stat =
            &live_generated_exec_reject_direct_memory[slot];

        if (stat->count == 0) {
            continue;
        }
        fprintf(stderr,
                "%s{\"route\":\"%s\",\"op\":%u,\"op_name\":\"%s\","
                "\"base_reg\":%u,\"offset\":%d,\"size\":%d,"
                "\"env_relative_supported\":%s,"
                "\"softmmu_access_count\":%u,"
                "\"softmmu_order\":\"%s\",\"count\":%" PRIu64 "}",
                first ? "" : ",",
                tcg_wasm64_live_generated_exec_direct_memory_route_name(
                    stat->route),
                (unsigned)stat->op, tcg_wasm64_op_name(stat->op),
                stat->base_reg, stat->offset, stat->size,
                stat->env_relative_supported ? "true" : "false",
                stat->softmmu_access_count, stat->softmmu_order,
                stat->count);
        first = false;
    }
}

static void tcg_wasm64_print_live_generated_exec_selected_unsupported_top(void)
{
    uint32_t top_ops[8] = { 0 };

    for (uint32_t op = 0; op < NB_OPS; op++) {
        uint64_t count =
            live_generated_exec_selected_body_unsupported_ops[op];

        if (count == 0) {
            continue;
        }
        for (size_t i = 0; i < ARRAY_SIZE(top_ops); i++) {
            if (live_generated_exec_selected_body_unsupported_ops[
                    top_ops[i]] < count) {
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
        uint64_t count =
            live_generated_exec_selected_body_unsupported_ops[op];

        if (count == 0) {
            break;
        }
        fprintf(stderr, "%s{\"op\":%u,\"name\":\"%s\",\"count\":%" PRIu64 "}",
                i == 0 ? "" : ",", op, tcg_wasm64_op_name(op), count);
    }
}

static void
tcg_wasm64_print_live_generated_exec_metadata_output_mismatch(void)
{
    const TCGWasm64MetadataOutputMismatch *mismatch =
        &live_generated_exec_first_metadata_output_mismatch;

    if (!mismatch->seen) {
        fprintf(stderr, "null");
        return;
    }

    fprintf(stderr,
            "{\"reason\":\"%s\","
            "\"index\":%" PRIu32 ","
            "\"op\":%" PRIu32 ","
            "\"op_name\":\"%s\","
            "\"metadata_word\":%" PRIu32 ","
            "\"metadata_word_hex\":\"0x%08" PRIx32 "\","
            "\"live_word\":%" PRIu32 ","
            "\"live_word_hex\":\"0x%08" PRIx32 "\"}",
            tcg_wasm64_live_generated_exec_reject_reason_name(
                mismatch->reason),
            mismatch->index,
            mismatch->op,
            tcg_wasm64_op_name(mismatch->op),
            mismatch->metadata_word,
            mismatch->metadata_word,
            mismatch->live_word,
            mismatch->live_word);
}

static void tcg_wasm64_print_live_generated_exec_module_failure(void)
{
    const TCGWasm64ModuleFailure *failure =
        &live_generated_exec_first_module_failure;
    uint32_t count;

    if (!failure->seen) {
        fprintf(stderr, "null");
        return;
    }

    fprintf(stderr,
            "{\"reason\":\"%s\","
            "\"phase\":\"%s\","
            "\"phase_code\":%" PRIu64 ","
            "\"status\":%" PRIu64 ","
            "\"status_name\":\"%s\","
            "\"shape_op_count\":%" PRIu32 ","
            "\"shape_truncated\":%s,"
            "\"first_op\":%" PRIu32 ","
            "\"first_op_name\":\"%s\","
            "\"terminal_op\":%" PRIu32 ","
            "\"terminal_op_name\":\"%s\","
            "\"shape\":[",
            tcg_wasm64_live_generated_exec_reject_reason_name(
                failure->reason),
            tcg_wasm64_live_generated_exec_module_failure_phase_name(
                failure->phase),
            failure->phase,
            failure->status,
            tcg_wasm64_live_generated_exec_js_status_reject_reason(
                failure->status),
            failure->shape_op_count,
            failure->shape_op_count > ARRAY_SIZE(failure->shape) ?
                "true" : "false",
            failure->first_op,
            tcg_wasm64_op_name(failure->first_op),
            failure->terminal_op,
            tcg_wasm64_op_name(failure->terminal_op));
    count = MIN(failure->shape_op_count,
                (uint32_t)ARRAY_SIZE(failure->shape));
    for (uint32_t i = 0; i < count; i++) {
        fprintf(stderr, "%s{\"op\":%" PRIu32 ",\"name\":\"%s\"}",
                i == 0 ? "" : ",",
                failure->shape[i],
                tcg_wasm64_op_name(failure->shape[i]));
    }
    fprintf(stderr,
            "],\"memory_import\":{"
            "\"module\":\"env\","
            "\"name\":\"memory\","
            "\"kind\":%" PRIu32 ","
            "\"limits_flags\":%" PRIu32 ","
            "\"limits_flags_hex\":\"0x%02" PRIx32 "\","
            "\"initial_pages\":%" PRIu64 ","
            "\"has_maximum\":%s,"
            "\"maximum_pages\":",
            failure->memory_kind,
            failure->memory_flags,
            failure->memory_flags,
            failure->memory_initial,
            failure->memory_has_maximum ? "true" : "false");
    if (failure->memory_maximum == TCG_WASM64_LIVE_MODULE_FAILURE_NO_MAX) {
        fprintf(stderr, "null");
    } else {
        fprintf(stderr, "%" PRIu64, failure->memory_maximum);
    }
    fprintf(stderr,
            ",\"shared\":%s,"
            "\"memory64\":%s}}",
            failure->memory_shared ? "true" : "false",
            failure->memory64 ? "true" : "false");
}

static void tcg_wasm64_report_live_generated_exec_summary(const char *reason)
{
    bool preflight = tcg_wasm64_live_generated_exec_preflight();
    uint64_t generated_guest_instructions_per_entry = 0;
    const char *chain_exit_reason = "none";

    if (!live_generated_exec_enabled || live_generated_exec_attempted == 0) {
        return;
    }
    if (g_strcmp0(reason, "interval") == 0 &&
        live_generated_exec_summary_reported_attempts ==
        live_generated_exec_attempted &&
        live_generated_exec_summary_reported_skips ==
        live_generated_exec_selected_body_helper_exit_skips) {
        return;
    }
    live_generated_exec_summary_reported_attempts =
        live_generated_exec_attempted;
    live_generated_exec_summary_reported_skips =
        live_generated_exec_selected_body_helper_exit_skips;
    if (translated_counters.generated_run_entries != 0) {
        generated_guest_instructions_per_entry =
            translated_counters.generated_guest_instructions /
            translated_counters.generated_run_entries;
    }
    if (g_strcmp0(reason, "chain-target-unsupported") == 0 ||
        g_strcmp0(reason, "chain-budget") == 0 ||
        g_strcmp0(reason, "chain-interrupted") == 0) {
        chain_exit_reason = reason;
    }

    fprintf(stderr,
            "qemu-wasm64-runloop: {\"format\":1,"
            "\"event\":\"live-generated-exec-summary\","
            "\"reason\":\"%s\","
            "\"chain_exit_reason\":\"%s\","
            "\"compat_fallback\":%s,"
            "\"preflight\":%s,"
            "\"preflight_limit\":%" PRIu64 ","
            "\"chain_budget\":%" PRIu64 ","
            "\"preflight_ready\":%s,"
            "\"no_silent_fallback\":%s,"
            "\"attempts\":%" PRIu64 ","
            "\"successes\":%" PRIu64 ","
            "\"rejects\":%" PRIu64 ","
            "\"skips\":%" PRIu64 ","
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
            "\"generated_run_entries\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"generated_guest_instructions_per_entry\":%" PRIu64 ","
            "\"generated_coverage_numerator\":%" PRIu64 ","
            "\"generated_coverage_denominator\":%" PRIu64 ","
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
            "\"hotset_probe_attempts\":%" PRIu64 ","
            "\"hotset_goto_sources\":%" PRIu64 ","
            "\"hotset_target_slots_read\":%" PRIu64 ","
            "\"hotset_target_slots_unsafe\":%" PRIu64 ","
            "\"hotset_target_metadata_hits\":%" PRIu64 ","
            "\"hotset_target_output_hits\":%" PRIu64 ","
            "\"hotset_target_stale\":%" PRIu64 ","
            "\"selected_body_helper_exit_skips\":%" PRIu64 ","
            "\"selected_body_no_terminal\":%" PRIu64 ","
            "\"metadata_output_mismatch\":",
            reason ? reason : "unknown",
            chain_exit_reason,
            ((tcg_wasm64_live_generated_exec_reject_total() != 0 ||
              live_generated_exec_selected_body_helper_exit_skips != 0) &&
             !live_generated_exec_no_fallback) ? "true" : "false",
            preflight ? "true" : "false",
            live_generated_exec_preflight_limit,
            live_generated_exec_chain_budget,
            live_generated_exec_successes != 0 ? "true" : "false",
            live_generated_exec_no_fallback ? "true" : "false",
            live_generated_exec_attempted,
            live_generated_exec_successes,
            tcg_wasm64_live_generated_exec_reject_total(),
            live_generated_exec_selected_body_helper_exit_skips,
            translated_counters.generated_guest_instructions,
            live_generated_exec_run_counters.fallback_guest_instructions,
            live_generated_exec_run_counters.generated_body_time_ns,
            live_generated_exec_run_counters.tci_dispatch_time_ns,
            live_generated_exec_run_counters.tb_lookup_time_ns,
            live_generated_exec_run_counters.helper_call_time_ns,
            live_generated_exec_run_counters.qemu_ld_time_ns,
            live_generated_exec_run_counters.qemu_st_time_ns,
            live_generated_exec_run_counters.compile_time_ns,
            live_generated_exec_run_counters.instantiate_time_ns,
            translated_counters.generated_run_entries,
            translated_counters.generated_chain_length,
            generated_guest_instructions_per_entry,
            translated_counters.generated_coverage_numerator,
            translated_counters.generated_coverage_denominator,
            live_generated_exec_run_counters.inline_tlb_hit_loads,
            live_generated_exec_run_counters.inline_tlb_hit_stores,
            live_generated_exec_run_counters.helper_calls,
            live_generated_exec_run_counters.qemu_ld_calls,
            live_generated_exec_run_counters.qemu_st_calls,
            live_generated_exec_run_counters.exits_budget,
            live_generated_exec_run_counters.exits_mmio,
            live_generated_exec_run_counters.exits_tlb_miss_or_fault,
            live_generated_exec_run_counters.exits_interrupt,
            live_generated_exec_run_counters.exits_helper,
            live_generated_exec_run_counters.exits_unsupported,
            live_generated_exec_run_counters.exits_hlt,
            live_generated_exec_run_counters.exits_invalidated,
            live_generated_exec_hotset_probe_attempts,
            live_generated_exec_hotset_goto_sources,
            live_generated_exec_hotset_target_slots_read,
            live_generated_exec_hotset_target_slots_unsafe,
            live_generated_exec_hotset_target_metadata_hits,
            live_generated_exec_hotset_target_output_hits,
            live_generated_exec_hotset_target_stale,
            live_generated_exec_selected_body_helper_exit_skips,
            live_generated_exec_selected_body_no_terminal);
    tcg_wasm64_print_live_generated_exec_metadata_output_mismatch();
    fprintf(stderr, ",\"module_failure\":");
    tcg_wasm64_print_live_generated_exec_module_failure();
    fprintf(stderr, ",\"selected_body_unsupported_ops\":[");
    tcg_wasm64_print_live_generated_exec_selected_unsupported_top();
    fprintf(stderr, "],"
            "\"reject_reasons\":[");
    tcg_wasm64_print_live_generated_exec_reject_reasons();
    fprintf(stderr, "],"
            "\"reject_memops\":[");
    tcg_wasm64_print_live_generated_exec_reject_memops();
    fprintf(stderr, "],"
            "\"reject_multi_accesses\":[");
    tcg_wasm64_print_live_generated_exec_reject_multi_accesses();
    fprintf(stderr, "],"
            "\"reject_direct_memory\":[");
    tcg_wasm64_print_live_generated_exec_reject_direct_memory();
    fprintf(stderr, "]}\n");
}

static void tcg_wasm64_live_generated_exec_preflight_maybe_fail(void)
{
    if (!tcg_wasm64_live_generated_exec_preflight() ||
        live_generated_exec_successes != 0 ||
        live_generated_exec_attempted < live_generated_exec_preflight_limit) {
        return;
    }

    tcg_wasm64_report_live_generated_exec_summary(
        "preflight-zero-generated-exec");
    g_error("qemu-wasm64-live-generated-exec: "
            "preflight-zero-generated-exec: attempts=%" PRIu64,
            live_generated_exec_attempted);
}

static TCGWasm64LiveGeneratedExecRejectReason
tcg_wasm64_live_generated_exec_metadata_output_mismatch_reason(
    const uint64_t *result)
{
    uint32_t op =
        (uint32_t)result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_OP];
    uint32_t metadata_word = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_METADATA_WORD];
    uint32_t live_word = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_LIVE_WORD];
    uint32_t live_op = tcg_wasm64_tci_word_op(live_word);

    if (op != live_op) {
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_STALE_TB_CODE;
    }

    switch ((TCGOpcode)op) {
    case INDEX_op_brcond:
        if (((metadata_word ^ live_word) & 0xfff) == 0) {
            return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_BRANCH_LABEL_RELOCATION;
        }
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_UNKNOWN_MISMATCH;
    case INDEX_op_call:
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_POOL_RELOCATION;
    case INDEX_op_tci_movl:
        if (((metadata_word ^ live_word) & 0xfff) == 0) {
            return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_POOL_RELOCATION;
        }
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_UNKNOWN_MISMATCH;
    default:
        return TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_UNKNOWN_MISMATCH;
    }
}

static void
tcg_wasm64_live_generated_exec_record_metadata_output_mismatch(
    const uint64_t *result, TCGWasm64LiveGeneratedExecRejectReason reason)
{
    TCGWasm64MetadataOutputMismatch *mismatch =
        &live_generated_exec_first_metadata_output_mismatch;

    if (mismatch->seen) {
        return;
    }

    mismatch->seen = true;
    mismatch->reason = reason;
    mismatch->index = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_INDEX];
    mismatch->op = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_OP];
    mismatch->metadata_word = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_METADATA_WORD];
    mismatch->live_word = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MISMATCH_LIVE_WORD];
}

static const char *
tcg_wasm64_live_generated_exec_module_failure_phase_name(uint64_t phase)
{
    switch (phase) {
    case 1:
        return "body-build";
    case 2:
        return "module-validate";
    case 3:
        return "module-compile";
    case 4:
        return "module-instantiate";
    default:
        return "unknown";
    }
}

static void tcg_wasm64_live_generated_exec_record_module_failure(
    const TCGWasm64TBMetadata *metadata, const uint64_t *result,
    TCGWasm64LiveGeneratedExecRejectReason reason)
{
    TCGWasm64ModuleFailure *failure =
        &live_generated_exec_first_module_failure;
    uint32_t count;

    if (failure->seen) {
        return;
    }

    failure->seen = true;
    failure->reason = reason;
    failure->phase = result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_PHASE];
    failure->status = result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_STATUS];
    failure->shape_op_count = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_SHAPE_OP_COUNT];
    failure->first_op = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_FIRST_OP];
    failure->terminal_op = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_TERMINAL_OP];
    failure->memory_kind = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_KIND];
    failure->memory_flags = (uint32_t)result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_FLAGS];
    failure->memory_initial = result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_INITIAL];
    failure->memory_maximum = result[
        TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_MAXIMUM];
    failure->memory_has_maximum =
        result[
            TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_HAS_MAXIMUM] != 0;
    failure->memory_shared =
        result[
            TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY_SHARED] != 0;
    failure->memory64 =
        result[
            TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_MODULE_FAILURE_MEMORY64] != 0;

    count = MIN(failure->shape_op_count,
                (uint32_t)ARRAY_SIZE(failure->shape));
    if (metadata && metadata->generated_output) {
        for (uint32_t i = 0; i < count; i++) {
            failure->shape[i] =
                tcg_wasm64_tci_word_op(metadata->generated_output[i]);
        }
    }
}

static const char *
tcg_wasm64_live_generated_exec_js_status_reject_reason(uint64_t status)
{
    switch (status) {
    case 1:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_RUNTIME_UNAVAILABLE);
    case 2:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_DIFFERENTIAL_MISMATCH);
    case 3:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_METADATA_OUTPUT_MISMATCH);
    case 4:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_OUTPUT_UNAVAILABLE);
    case 5:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_SHAPE_UNSUPPORTED);
    case 6:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_EMISSION_FAILED);
    case 7:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_VALIDATION_FAILED);
    default:
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_UNKNOWN);
    }
}

static const char *tcg_wasm64_live_generated_exec_classify_reject(
    const TCGWasm64TBMetadata *metadata,
    const TCGWasm64RunCounters *run_counters,
    const TCGWasm64RunExit *exit, const uint64_t *result,
    uint64_t guest_insns, TCGWasm64RunExitReason *exit_reason)
{
    uint64_t js_status =
        result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS];
    uint64_t generated_status =
        result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_STATUS];
    uint32_t generated_exit_reason = 0;
    bool generated_status_known =
        tcg_wasm64_live_tb_status_to_run_exit_reason(generated_status,
                                                     &generated_exit_reason);

    *exit_reason = TCG_WASM64_RUN_EXIT_UNSUPPORTED;

    if (js_status != 0) {
        if (js_status == 3) {
            TCGWasm64LiveGeneratedExecRejectReason mismatch_reason =
                tcg_wasm64_live_generated_exec_metadata_output_mismatch_reason(
                    result);

            *exit_reason = TCG_WASM64_RUN_EXIT_INVALIDATED;
            tcg_wasm64_live_generated_exec_record_metadata_output_mismatch(
                result, mismatch_reason);
            return tcg_wasm64_live_generated_exec_reject_reason_name(
                mismatch_reason);
        }
        if (js_status == 6 || js_status == 7) {
            TCGWasm64LiveGeneratedExecRejectReason module_reason =
                js_status == 7 ?
                    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_VALIDATION_FAILED :
                    TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_JS_STATUS_MODULE_EMISSION_FAILED;

            tcg_wasm64_live_generated_exec_record_module_failure(
                metadata, result, module_reason);
        }
        return tcg_wasm64_live_generated_exec_js_status_reject_reason(
            js_status);
    }

    if (run_counters->exits_mmio != 0 ||
        exit->reason == TCG_WASM64_RUN_EXIT_MMIO ||
        generated_exit_reason == TCG_WASM64_RUN_EXIT_MMIO) {
        *exit_reason = TCG_WASM64_RUN_EXIT_MMIO;
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_MMIO_EXIT);
    }
    if (run_counters->exits_tlb_miss_or_fault != 0 ||
        exit->reason == TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT ||
        generated_exit_reason == TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT) {
        *exit_reason = TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT;
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TLB_MISS_OR_FAULT_EXIT);
    }
    if (run_counters->exits_invalidated != 0 ||
        exit->reason == TCG_WASM64_RUN_EXIT_INVALIDATED ||
        generated_exit_reason == TCG_WASM64_RUN_EXIT_INVALIDATED) {
        *exit_reason = TCG_WASM64_RUN_EXIT_INVALIDATED;
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_INVALIDATED);
    }
    if (run_counters->exits_unsupported != 0 ||
        exit->reason == TCG_WASM64_RUN_EXIT_UNSUPPORTED ||
        generated_exit_reason == TCG_WASM64_RUN_EXIT_UNSUPPORTED) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_UNSUPPORTED_BODY_STATE);
    }
    if (run_counters->exits_helper != 0 ||
        exit->reason == TCG_WASM64_RUN_EXIT_HELPER ||
        generated_exit_reason == TCG_WASM64_RUN_EXIT_HELPER) {
        *exit_reason = TCG_WASM64_RUN_EXIT_HELPER;
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_STATUS_HELPER);
    }
    if (!generated_status_known ||
        !tcg_wasm64_live_tb_status_is_success(generated_status)) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GENERATED_STATUS_UNEXPECTED);
    }
    if (result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_RET] == 0) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_MISSING_RETURN_TARGET);
    }
    if (result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_GUEST_INSNS] !=
        guest_insns) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_GUEST_INSTRUCTION_MISMATCH);
    }
    if (result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_TCI_OPS] ==
        0) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_TCI_OP_COUNT_MISMATCH);
    }
    if (result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_OUTPUT_WORDS] !=
        metadata->generated_output_op_count) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_OUTPUT_WORDS_MISMATCH);
    }
    if (run_counters->generated_guest_instructions != guest_insns) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_COUNTER_GUEST_INSN_MISMATCH);
    }
    if (run_counters->generated_chain_length != 1) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_CHAIN_LENGTH_MISMATCH);
    }
    if (run_counters->helper_calls != 0) {
        *exit_reason = TCG_WASM64_RUN_EXIT_HELPER;
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_HELPER_COUNTER_MISMATCH);
    }
    if (run_counters->qemu_ld_calls != 0 ||
        run_counters->qemu_st_calls != 0) {
        return tcg_wasm64_live_generated_exec_reject_reason_name(
            TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_QEMU_HELPER_COUNTER_MISMATCH);
    }

    return tcg_wasm64_live_generated_exec_reject_reason_name(
        TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_UNSUPPORTED_BODY_STATE);
}

static bool tcg_wasm64_live_generated_exec_reject(
    const char *reason, const void *tb_ptr,
    const TCGWasm64TBMetadata *metadata, const TranslationBlock *tb,
    TCGWasm64RunExitReason exit_reason, TCGWasm64Counters *counters,
    bool no_fallback)
{
    TCGWasm64RunCounters run_counters;
    TCGWasm64RunExit exit = { 0 };
    uint64_t result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT__MAX] = { 0 };

    tcg_wasm64_run_counters_reset(&run_counters);
    exit.reason = exit_reason;
    tcg_wasm64_run_count_exit(&run_counters, exit_reason);
    if (exit_reason == TCG_WASM64_RUN_EXIT_INVALIDATED) {
        result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] = 3;
    } else if (exit_reason == TCG_WASM64_RUN_EXIT_UNSUPPORTED) {
        result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] = 5;
    } else {
        result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] = 6;
    }

    tcg_wasm64_live_generated_exec_count_reason(reason);
    tcg_wasm64_live_generated_exec_count_reject(counters, exit_reason);
    tcg_wasm64_live_generated_exec_preflight_maybe_fail();
    if (no_fallback) {
        tcg_wasm64_report_live_generated_exec_summary(reason);
    }
    tcg_wasm64_live_generated_exec_fail_closed(reason, no_fallback);
    (void)tb_ptr;
    return false;
}

static bool tcg_wasm64_live_generated_exec_prepare_tb(
    CPUArchState *env, const void *tb_ptr,
    const TCGWasm64TBMetadata *metadata,
    TranslationBlock **tb_out, uint64_t *guest_insns_out,
    bool *has_memop_out, uint32_t *memop_mmu_idx_out,
    const char **reject_reason_out,
    TCGWasm64RunExitReason *exit_reason_out)
{
    TranslationBlock *tb;
    TCGWasm64LiveGeneratedExecRejectReason memop_reason;
    bool has_memop;
    uint32_t memop_mmu_idx;

    *tb_out = NULL;
    *guest_insns_out = 0;
    *has_memop_out = false;
    *memop_mmu_idx_out = 0;
    *reject_reason_out = "unsupported-body-state";
    *exit_reason_out = TCG_WASM64_RUN_EXIT_UNSUPPORTED;

    if (!metadata) {
        *reject_reason_out = "metadata-missing";
        return false;
    }
    if (!tcg_wasm64_translate_generated_output_available(metadata)) {
        *reject_reason_out = "generated-output-unavailable";
        return false;
    }
    if (tcg_wasm64_live_generated_exec_helper_exit_shape(metadata)) {
        *reject_reason_out = "selected-body-helper-exit-unsupported";
        return false;
    }

    tb = tcg_tb_lookup((uintptr_t)tb_ptr);
    if (!tb || tb->tc.ptr != tb_ptr || tb->icount == 0 ||
        (tb_cflags(tb) & CF_INVALID)) {
        *tb_out = tb;
        *reject_reason_out = "tb-identity-missing-or-stale";
        *exit_reason_out = TCG_WASM64_RUN_EXIT_INVALIDATED;
        return false;
    }
    if (metadata->generated_output_size > tb->tc.size) {
        *tb_out = tb;
        *reject_reason_out = "tb-identity-missing-or-stale";
        *exit_reason_out = TCG_WASM64_RUN_EXIT_INVALIDATED;
        return false;
    }

    tcg_wasm64_live_generated_exec_probe_hotset_target(tb_ptr, metadata, tb);
    if (!tcg_wasm64_live_generated_exec_shape_supported_record(
            metadata, true)) {
        *reject_reason_out = "selected-body-shape-unsupported";
        return false;
    }
    memop_reason = tcg_wasm64_live_generated_exec_validate_selected_memops(
        env, metadata, &has_memop, &memop_mmu_idx);
    if (memop_reason != TCG_WASM64_LIVE_GENERATED_EXEC_REJECT__MAX) {
        *reject_reason_out =
            tcg_wasm64_live_generated_exec_reject_reason_name(memop_reason);
        return false;
    }

    *tb_out = tb;
    *guest_insns_out = tb->icount;
    *has_memop_out = has_memop;
    *memop_mmu_idx_out = memop_mmu_idx;
    return true;
}

static bool tcg_wasm64_live_generated_exec_main_loop_exit_pending(
    CPUArchState *env)
{
    CPUState *cpu = env_cpu(env);

    return cpu->interrupt_request != 0 ||
           cpu->exit_request ||
           cpu->exception_index >= 0;
}

static void tcg_wasm64_live_generated_exec_record_chain_exit(
    TCGWasm64RunExitReason exit_reason)
{
    tcg_wasm64_count_exit(
        &translated_counters,
        tcg_wasm64_live_generated_exec_summary_exit_reason(exit_reason));
    tcg_wasm64_run_count_exit(&live_generated_exec_run_counters,
                              exit_reason);
}

static void tcg_wasm64_live_generated_exec_commit_chain(
    const TCGWasm64RunCounters *chain_counters)
{
    translated_counters.generated_coverage_numerator +=
        chain_counters->generated_guest_instructions;
    translated_counters.generated_guest_instructions +=
        chain_counters->generated_guest_instructions;
    translated_counters.generated_body_time_ns +=
        chain_counters->generated_body_time_ns;
    translated_counters.generated_run_entries++;
    translated_counters.generated_chain_length +=
        chain_counters->generated_chain_length;
    tcg_wasm64_run_counters_add(&live_generated_exec_run_counters,
                                 chain_counters);
    live_generated_exec_successes++;
}

static bool tcg_wasm64_live_generated_exec_run_one(
    CPUArchState *env, const void *tb_ptr, const TCGWasm64TBMetadata *metadata,
    const TranslationBlock *tb, uint64_t guest_insns, bool no_fallback,
    TCGWasm64TLBMirror *tlb, TCGWasm64RunCounters *run_counters,
    TCGWasm64RunExit *exit, uint64_t *result)
{
    TCGWasm64RunContext context = { 0 };
    uint32_t tb_code_size = tb ? tb->tc.size : 0;

    tcg_wasm64_run_counters_reset(run_counters);
    memset(exit, 0, sizeof(*exit));
    memset(result, 0,
           sizeof(uint64_t) * TCG_WASM64_LIVE_GENERATED_EXEC_RESULT__MAX);
    context.env = env;
    context.budget = guest_insns;
    context.counters = run_counters;
    context.exit = exit;
    context.tlb = tlb;
    context.mode = no_fallback ? TCG_WASM64_RUN_MODE_PERF_PROOF :
                                 TCG_WASM64_RUN_MODE_COMPAT;
    context.tb_generation = tcg_wasm64_tb_generation();
    context.address_space_generation = tcg_wasm64_address_space_generation();

#ifdef CONFIG_EMSCRIPTEN
    {
        g_autofree uint8_t *scratch = g_malloc0(
            TCG_WASM64_ONE_TB_SCRATCH_SIZE);
        int js_status = tcg_wasm64_live_generated_exec_js(
            (uintptr_t)&context, (uintptr_t)scratch,
            (uintptr_t)run_counters, (uintptr_t)exit, (uintptr_t)result,
            (uintptr_t)tb_ptr, (uintptr_t)env, guest_insns,
            (uintptr_t)metadata->generated_output,
            metadata->generated_output_size, tb_code_size);

        result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] = js_status;
    }
#else
    (void)tb_code_size;
    result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] = 1;
#endif

    if (exit->reason == 0) {
        uint32_t mapped_reason = 0;

        if (tcg_wasm64_live_tb_status_to_run_exit_reason(
                result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_STATUS],
                &mapped_reason)) {
            exit->reason = mapped_reason;
        }
    }
    if (exit->reason == TCG_WASM64_RUN_EXIT_UNSUPPORTED) {
        tcg_wasm64_run_count_exit(run_counters,
                                  TCG_WASM64_RUN_EXIT_UNSUPPORTED);
    } else if (exit->reason == TCG_WASM64_RUN_EXIT_HELPER) {
        tcg_wasm64_run_count_exit(run_counters,
                                  TCG_WASM64_RUN_EXIT_HELPER);
    } else if (exit->reason == TCG_WASM64_RUN_EXIT_MMIO) {
        tcg_wasm64_run_count_exit(run_counters,
                                  TCG_WASM64_RUN_EXIT_MMIO);
    } else if (exit->reason == TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT) {
        tcg_wasm64_run_count_exit(run_counters,
                                  TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT);
    } else if (exit->reason == TCG_WASM64_RUN_EXIT_INVALIDATED ||
               result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] == 3) {
        exit->reason = TCG_WASM64_RUN_EXIT_INVALIDATED;
        tcg_wasm64_run_count_exit(run_counters,
                                  TCG_WASM64_RUN_EXIT_INVALIDATED);
    }

    return result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_JS_STATUS] == 0 &&
           tcg_wasm64_live_tb_status_is_success(
               result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_STATUS]) &&
           result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_RET] != 0 &&
           result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_GUEST_INSNS] ==
               guest_insns &&
           result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_TCI_OPS] != 0 &&
           result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_OUTPUT_WORDS] ==
               metadata->generated_output_op_count &&
           run_counters->generated_guest_instructions == guest_insns &&
           run_counters->generated_chain_length == 1 &&
           run_counters->helper_calls == 0 &&
           run_counters->qemu_ld_calls == 0 &&
           run_counters->qemu_st_calls == 0;
}

static bool tcg_wasm64_live_generated_exec_try(
    CPUArchState *env, const void *tb_ptr, TCGWasm64TBMetadata *metadata,
    TCGWasm64Counters *counters, uintptr_t *ret)
{
    const void *current_tb_ptr = tb_ptr;
    TCGWasm64TBMetadata *current_metadata = metadata;
    TranslationBlock *tb = NULL;
    TCGWasm64RunCounters chain_counters;
    TCGWasm64RunCounters step_counters;
    TCGWasm64RunExit exit = { 0 };
    uint64_t result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT__MAX] = { 0 };
    uint64_t guest_insns = 0;
    uint64_t remaining_budget;
    const char *reject_reason = NULL;
    TCGWasm64RunExitReason reject_exit =
        TCG_WASM64_RUN_EXIT_UNSUPPORTED;
    bool no_fallback;
    bool chained = false;
    bool first_tb = true;
    bool chain_exit_valid = false;
    bool fail_closed_after_commit = false;
    uintptr_t chain_stop_ret = 0;
    TCGWasm64RunExitReason chain_exit_reason =
        TCG_WASM64_RUN_EXIT_UNSUPPORTED;
    const char *summary_reason = "generated-exec-dispatch";

    if (!tcg_wasm64_live_generated_exec_enabled()) {
        return false;
    }

    no_fallback = tcg_wasm64_live_generated_exec_no_fallback();
    if (tcg_wasm64_live_generated_exec_helper_exit_shape(metadata)) {
        if (!no_fallback) {
            live_generated_exec_selected_body_helper_exit_skips++;
            return false;
        }
        tcg_wasm64_live_generated_exec_count_attempt();
        return tcg_wasm64_live_generated_exec_reject(
            "selected-body-helper-exit-unsupported", tb_ptr, metadata, NULL,
            TCG_WASM64_RUN_EXIT_UNSUPPORTED, counters, no_fallback);
    }

    live_generated_exec_attempted++;
    remaining_budget = live_generated_exec_chain_budget;
    tcg_wasm64_run_counters_reset(&chain_counters);

    for (;;) {
        translated_counters.generated_attempts++;
        bool has_memop = false;
        uint32_t memop_mmu_idx = 0;
        TCGWasm64TLBMirror tlb_mirror = { 0 };
        TCGWasm64TLBMirror *tlb = NULL;

        if (!tcg_wasm64_live_generated_exec_prepare_tb(
                env, current_tb_ptr, current_metadata, &tb, &guest_insns,
                &has_memop, &memop_mmu_idx, &reject_reason, &reject_exit)) {
            if (!chained) {
                return tcg_wasm64_live_generated_exec_reject(
                    reject_reason, current_tb_ptr, current_metadata, tb,
                    reject_exit, counters, no_fallback);
            }
            summary_reason = "chain-target-unsupported";
            chain_exit_reason = reject_exit;
            chain_exit_valid = true;
            fail_closed_after_commit = no_fallback || chain_stop_ret == 0;
            if (chain_stop_ret != 0) {
                *ret = chain_stop_ret;
            }
            break;
        }

        if (has_memop) {
            tcg_wasm64_tlb_mirror_refresh(&tlb_mirror, env, memop_mmu_idx);
            if (!tcg_wasm64_tlb_mirror_valid(&tlb_mirror, memop_mmu_idx)) {
                reject_reason =
                    tcg_wasm64_live_generated_exec_reject_reason_name(
                        TCG_WASM64_LIVE_GENERATED_EXEC_REJECT_SELECTED_BODY_SOFTMMU_TLB_MIRROR_INVALID);
                reject_exit = TCG_WASM64_RUN_EXIT_UNSUPPORTED;
                if (!chained) {
                    return tcg_wasm64_live_generated_exec_reject(
                        reject_reason, current_tb_ptr, current_metadata, tb,
                        reject_exit, counters, no_fallback);
                }
                summary_reason = "chain-target-unsupported";
                chain_exit_reason = reject_exit;
                chain_exit_valid = true;
                fail_closed_after_commit = no_fallback ||
                                           chain_stop_ret == 0;
                if (chain_stop_ret != 0) {
                    *ret = chain_stop_ret;
                }
                break;
            }
            tlb = &tlb_mirror;
        }

        if (guest_insns > remaining_budget) {
            if (!chained) {
                return tcg_wasm64_live_generated_exec_reject(
                    "chain-budget", current_tb_ptr, current_metadata, tb,
                    TCG_WASM64_RUN_EXIT_BUDGET, counters, no_fallback);
            }
            summary_reason = "chain-budget";
            chain_exit_reason = TCG_WASM64_RUN_EXIT_BUDGET;
            chain_exit_valid = true;
            fail_closed_after_commit = no_fallback || chain_stop_ret == 0;
            if (chain_stop_ret != 0) {
                *ret = chain_stop_ret;
            }
            break;
        }

        if (!first_tb) {
            tcg_wasm64_count_live_translation_metadata(current_metadata);
            tcg_wasm64_count_live_tb_coverage_denominator(current_tb_ptr);
        }

        if (!tcg_wasm64_live_generated_exec_run_one(
                env, current_tb_ptr, current_metadata, tb, guest_insns,
                no_fallback, tlb, &step_counters, &exit, result)) {
            TCGWasm64RunExitReason failed_reason;
            const char *failed_name;

            failed_name = tcg_wasm64_live_generated_exec_classify_reject(
                current_metadata, &step_counters, &exit, result,
                guest_insns, &failed_reason);

            if (!chained) {
                tcg_wasm64_live_generated_exec_count_reason(failed_name);
                tcg_wasm64_live_generated_exec_count_reject(
                    counters, failed_reason);
                tcg_wasm64_live_generated_exec_preflight_maybe_fail();
                if (no_fallback) {
                    tcg_wasm64_report_live_generated_exec_summary(failed_name);
                }
                tcg_wasm64_live_generated_exec_fail_closed(
                    failed_name, no_fallback);
                return false;
            }

            summary_reason = failed_name;
            chain_exit_reason = failed_reason;
            chain_exit_valid = true;
            fail_closed_after_commit = no_fallback || chain_stop_ret == 0;
            if (chain_stop_ret != 0) {
                *ret = chain_stop_ret;
            }
            break;
        }

        if (result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_CACHE_HIT] != 0) {
            translated_counters.generated_cache_hits++;
        } else {
            translated_counters.generated_compiled++;
        }
        translated_counters.generated_executed++;
        tcg_wasm64_run_counters_add(&chain_counters, &step_counters);
        remaining_budget -= guest_insns;
        chained = true;

        if (result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_STATUS] ==
            TCG_WASM64_LIVE_TB_STATUS_EXIT) {
            *ret = result[TCG_WASM64_LIVE_GENERATED_EXEC_RESULT_GENERATED_RET];
            summary_reason = "generated-exec-exit";
            break;
        }

        {
            uintptr_t dispatch_target = 0;
            uintptr_t source_exit = 0;

            if (!tcg_wasm64_live_generated_exec_read_dispatch(
                    current_tb_ptr, current_metadata, tb, &dispatch_target,
                    &source_exit)) {
                summary_reason = "chain-target-unsupported";
                chain_exit_reason = TCG_WASM64_RUN_EXIT_UNSUPPORTED;
                chain_exit_valid = true;
                fail_closed_after_commit = no_fallback || source_exit == 0;
                if (source_exit != 0) {
                    chain_stop_ret = source_exit;
                    *ret = chain_stop_ret;
                }
                break;
            }
            chain_stop_ret = source_exit;
            *ret = chain_stop_ret;
            current_tb_ptr = (const void *)dispatch_target;
        }

        if (remaining_budget == 0) {
            summary_reason = "chain-budget";
            chain_exit_reason = TCG_WASM64_RUN_EXIT_BUDGET;
            chain_exit_valid = true;
            fail_closed_after_commit = no_fallback || chain_stop_ret == 0;
            break;
        }
        if (tcg_wasm64_live_generated_exec_main_loop_exit_pending(env)) {
            summary_reason = "chain-interrupted";
            chain_exit_reason = TCG_WASM64_RUN_EXIT_INTERRUPT;
            chain_exit_valid = true;
            fail_closed_after_commit = no_fallback || chain_stop_ret == 0;
            break;
        }

        current_metadata = tcg_wasm64_translate_lookup_mutable(current_tb_ptr);
        first_tb = false;
    }

    tcg_wasm64_live_generated_exec_commit_chain(&chain_counters);
    if (chain_exit_valid) {
        tcg_wasm64_live_generated_exec_record_chain_exit(chain_exit_reason);
    }
    tcg_wasm64_report_live_generated_exec_summary(summary_reason);
    tcg_wasm64_live_generated_exec_fail_closed(summary_reason,
                                               fail_closed_after_commit);
    return true;
}

static bool tcg_wasm64_translate_op_supported(uint32_t op)
{
    switch ((TCGOpcode)op) {
    case INDEX_op_add:
    case INDEX_op_and:
    case INDEX_op_brcond:
    case INDEX_op_call:
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
    /*
     * Helper calls are represented as a generated prefix terminal: generated
     * code commits state and returns TCG_WASM64_RUN_EXIT_HELPER, leaving the
     * actual helper invocation and continuation to the host/TCI boundary.
     */
    case INDEX_op_call:
    case INDEX_op_deposit:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
    /*
     * Direct TCI host-memory ld/st operations are recorded so the operand-level
     * generated-output emitter can lower only bounded env-relative forms and
     * fail closed for unsafe bases or offsets.
     */
    case INDEX_op_ld:
    case INDEX_op_ld32s:
    case INDEX_op_ld32u:
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

static bool tcg_wasm64_translate_call_exit_supported(uint32_t insn)
{
    uint32_t ret_len = (insn >> 8) & 0xfu;

    /*
     * The TCI word exposes return arity but not helper flags such as
     * TCG_CALL_NO_RETURN.  Support the common void/u32/u64 helper returns and
     * fail closed for wider return state until the boundary models it.
     */
    return ret_len <= 2;
}

static void tcg_wasm64_translate_mark_generated_unsupported(
    TCGWasm64TBMetadata *metadata, uint32_t op)
{
    metadata->generated_unsupported_op_count++;
    metadata->flags &= ~TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE;
    if (metadata->first_generated_unsupported_op == UINT32_MAX) {
        metadata->first_generated_unsupported_op = op;
    }
}

void tcg_wasm64_translate_begin(const void *tb_ptr)
{
    TCGWasm64TranslateEntry *entry;

    if (!tb_ptr) {
        active_translate_entry = NULL;
        active_translate_metadata = NULL;
        return;
    }

    entry = tcg_wasm64_translate_entry_for_insert(tb_ptr);
    entry->tb_ptr = tb_ptr;
    g_clear_pointer(&entry->generated_output, g_free);
    entry->generated_output_capacity = 0;
    memset(&entry->metadata, 0, sizeof(entry->metadata));
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
    entry->metadata.generated_output = NULL;
    active_translate_entry = entry;
    active_translate_metadata = &entry->metadata;
}

void tcg_wasm64_translate_note_tci_op(uint32_t op)
{
    TCGWasm64TBMetadata *metadata = active_translate_metadata;
    bool after_helper_exit;
    bool supported;
    bool generated_supported;

    if (!metadata) {
        return;
    }

    after_helper_exit = metadata->generated_helper_exit_op_count != 0;
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
    if (!after_helper_exit) {
        if (generated_supported) {
            metadata->generated_supported_op_count++;
        } else {
            tcg_wasm64_translate_mark_generated_unsupported(metadata, op);
        }
        if (op == INDEX_op_call) {
            metadata->flags |= TCG_WASM64_TB_METADATA_HELPER_EXIT |
                               TCG_WASM64_TB_METADATA_TERMINAL;
            metadata->generated_helper_exit_op_count = metadata->op_count;
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
    TCGWasm64TranslateEntry *entry = active_translate_entry;
    TCGWasm64TBMetadata *metadata = active_translate_metadata;
    uint32_t *output;
    uint32_t size;
    uint32_t output_index;

    if (!metadata || !entry ||
        !tcg_wasm64_translate_op_generated_supported(op)) {
        return;
    }
    if (metadata->generated_helper_exit_op_count != 0 &&
        metadata->op_count > metadata->generated_helper_exit_op_count) {
        return;
    }
    if (op == INDEX_op_call &&
        !tcg_wasm64_translate_call_exit_supported(insn)) {
        if (metadata->generated_supported_op_count > 0) {
            metadata->generated_supported_op_count--;
        }
        metadata->generated_helper_exit_op_count = 0;
        metadata->flags &= ~(TCG_WASM64_TB_METADATA_HELPER_EXIT |
                             TCG_WASM64_TB_METADATA_TERMINAL);
        tcg_wasm64_translate_mark_generated_unsupported(metadata, op);
        return;
    }

    size = metadata->generated_output_size;
    if (size + sizeof(insn) > TCG_WASM64_TRANSLATE_OUTPUT_MAX) {
        metadata->flags |= TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED;
        metadata->flags &= ~TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE;
        return;
    }

    output_index = size / sizeof(insn);
    if (!tcg_wasm64_translate_entry_ensure_generated_output(
            entry, output_index + 1)) {
        metadata->flags |= TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED;
        metadata->flags &= ~TCG_WASM64_TB_METADATA_GENERATED_CANDIDATE;
        return;
    }
    output = entry->generated_output;
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

    if (!tb_ptr) {
        return NULL;
    }

    entry = tcg_wasm64_translate_entry_for_lookup(tb_ptr);
    if (!entry) {
        return NULL;
    }
    return &entry->metadata;
}

static TCGWasm64TBMetadata *tcg_wasm64_translate_lookup_mutable(
    const void *tb_ptr)
{
    TCGWasm64TranslateEntry *entry;

    if (!tb_ptr) {
        return NULL;
    }

    entry = tcg_wasm64_translate_entry_for_lookup(tb_ptr);
    if (!entry) {
        return NULL;
    }
    return &entry->metadata;
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

static uint32_t tcg_wasm64_translate_generated_output_expected_ops(
    const TCGWasm64TBMetadata *metadata)
{
    if (metadata->generated_helper_exit_op_count != 0) {
        return metadata->generated_helper_exit_op_count;
    }
    return metadata->op_count;
}

bool tcg_wasm64_translate_generated_output_available(
    const TCGWasm64TBMetadata *metadata)
{
    uint32_t expected_ops;

    if (!tcg_wasm64_translate_generated_candidate(metadata)) {
        return false;
    }
    if (!(metadata->flags & TCG_WASM64_TB_METADATA_GENERATED_OUTPUT) ||
        (metadata->flags & TCG_WASM64_TB_METADATA_OUTPUT_TRUNCATED)) {
        return false;
    }
    expected_ops = tcg_wasm64_translate_generated_output_expected_ops(metadata);
    return metadata->generated_output_size != 0 &&
           metadata->generated_output_size % sizeof(uint32_t) == 0 &&
           metadata->generated_output_op_count == expected_ops &&
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
    uint64_t generated_guest_instructions_per_entry = 0;
    uint64_t translated_metadata_hit_ppm = 0;

    if (!counters) {
        return;
    }

    merged = *counters;
    tcg_wasm64_counters_add(&merged, &translated_counters);
    if (active_counters) {
        tcg_wasm64_counters_add(&merged, active_counters);
    }
    counters = &merged;

    if (counters->generated_coverage_denominator != 0) {
        generated_coverage_ppm =
            ((uint64_t)((__uint128_t)counters->generated_coverage_numerator *
                        1000000u /
                        counters->generated_coverage_denominator));
    }
    if (counters->generated_run_entries != 0) {
        generated_guest_instructions_per_entry =
            counters->generated_guest_instructions /
            counters->generated_run_entries;
    }
    if (counters->translated_metadata_lookups != 0) {
        translated_metadata_hit_ppm =
            ((uint64_t)((__uint128_t)counters->translated_metadata_hits *
                        1000000u /
                        counters->translated_metadata_lookups));
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
            "\"generated_guest_instructions\":%" PRIu64 ","
            "\"fallback_guest_instructions\":%" PRIu64 ","
            "\"generated_body_time_ns\":%" PRIu64 ","
            "\"generated_run_entries\":%" PRIu64 ","
            "\"generated_chain_length\":%" PRIu64 ","
            "\"generated_guest_instructions_per_entry\":%" PRIu64 ","
            "\"generated_exits\":{\"budget\":%" PRIu64 ","
            "\"mmio\":%" PRIu64 ",\"tlb_miss\":%" PRIu64 ","
            "\"interrupt\":%" PRIu64 ",\"csr\":%" PRIu64 ","
            "\"invalid\":%" PRIu64 ",\"invalidation\":%" PRIu64 ","
            "\"unsupported\":%" PRIu64 ",\"fatal\":%" PRIu64 "},"
            "\"translated_tbs\":%" PRIu64 ","
            "\"translated_ops\":%" PRIu64 ","
            "\"translated_fallback_markers\":%" PRIu64 ","
            "\"translated_metadata_lookups\":%" PRIu64 ","
            "\"translated_metadata_hits\":%" PRIu64 ","
            "\"translated_metadata_misses\":%" PRIu64 ","
            "\"translated_metadata_hit_ppm\":%" PRIu64 ","
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
            counters->generated_guest_instructions,
            counters->fallback_guest_instructions,
            counters->generated_body_time_ns,
            counters->generated_run_entries,
            counters->generated_chain_length,
            generated_guest_instructions_per_entry,
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
            counters->translated_metadata_lookups,
            counters->translated_metadata_hits,
            counters->translated_metadata_misses,
            translated_metadata_hit_ppm,
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
}

uintptr_t tcg_wasm64_tb_exec(CPUArchState *env, const void *tb_ptr,
                             TCGWasm64Counters *counters)
{
    TCGWasm64Counters *previous_counters = active_counters;
    TCGWasm64TBMetadata *metadata;
    uintptr_t ret;
    uint64_t fallback_guest_insns = 0;
    uint64_t tci_dispatch_start_ns = 0;
    bool live_exec_enabled;
    TCGWasm64Context ctx = {
        .tb_ptr = (void *)tb_ptr,
        .env = env,
        .counters = counters,
    };

    tcg_wasm64_runloop_smoke_maybe(env);
    tcg_wasm64_one_tb_differential_maybe(env);

    /*
     * Native wasm64 lowering grows behind this boundary.  Metadata-backed
     * generated output gets the first chance only after the live TB identity
     * and generated-output shape are validated; the TCI fallback remains the
     * correctness path for anything the generated runner cannot execute.
     */
    (void)ctx;
    if (counters) {
        tcg_wasm64_counters_reset(counters);
    }

    metadata = tcg_wasm64_translate_lookup_mutable(tb_ptr);
    translated_counters.translated_metadata_lookups++;
    if (metadata) {
        translated_counters.translated_metadata_hits++;
        tcg_wasm64_count_live_translation_metadata(metadata);
        tcg_wasm64_count_live_tb_coverage_denominator(tb_ptr);
        if (tcg_wasm64_execute_available_generated_output_try(
                env, tb_ptr, metadata, &ret)) {
            tcg_wasm64_summary_maybe_report();
            return ret;
        }
        tcg_wasm64_live_one_tb_differential_maybe(env, tb_ptr, metadata);
        if (tcg_wasm64_live_generated_exec_try(env, tb_ptr, metadata,
                                               counters, &ret)) {
            tcg_wasm64_summary_maybe_report();
            return ret;
        }
    } else {
        translated_counters.translated_metadata_misses++;
        tcg_wasm64_count_live_tb_coverage_denominator(tb_ptr);
        (void)tcg_wasm64_execute_available_generated_output_try(
            env, tb_ptr, NULL, &ret);
        tcg_wasm64_live_one_tb_differential_maybe(env, tb_ptr, NULL);
        if (tcg_wasm64_live_generated_exec_try(env, tb_ptr, NULL,
                                               counters, &ret)) {
            tcg_wasm64_summary_maybe_report();
            return ret;
        }
    }
    live_exec_enabled = tcg_wasm64_live_generated_exec_enabled();
    if (tcg_wasm64_summary_enabled() || live_exec_enabled) {
        fallback_guest_insns = tcg_wasm64_live_tb_guest_instructions(tb_ptr);
    }
    if (live_exec_enabled) {
        live_generated_exec_run_counters.fallback_guest_instructions +=
            fallback_guest_insns;
        tci_dispatch_start_ns = tcg_wasm64_runloop_smoke_time_ns();
    }
    active_counters = counters;
    ret = tcg_tci_qemu_tb_exec(env, tb_ptr);
    active_counters = previous_counters;
    if (live_exec_enabled) {
        live_generated_exec_run_counters.tci_dispatch_time_ns +=
            tcg_wasm64_runloop_smoke_time_ns() - tci_dispatch_start_ns;
    }
    tcg_wasm64_record_tci_fallback_guest_instructions(fallback_guest_insns);
    tcg_wasm64_summary_maybe_report();
    return ret;
}

uintptr_t QEMU_DISABLE_CFI tcg_qemu_tb_exec(CPUArchState *env,
                                            const void *tb_ptr)
{
    TCGWasm64Counters counters;

    tcg_wasm64_counters_reset(&counters);
    return tcg_wasm64_tb_exec(env, tb_ptr, &counters);
}
