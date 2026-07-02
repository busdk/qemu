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
    uint64_t fallback_unsupported;
    uint64_t fallback_helper;
    uint64_t fallback_qemu_load;
    uint64_t fallback_qemu_store;
    uint64_t fallback_runtime;
} TCGWasm64Counters;

typedef enum TCGWasm64FallbackReason {
    TCG_WASM64_FALLBACK_UNSUPPORTED,
    TCG_WASM64_FALLBACK_HELPER,
    TCG_WASM64_FALLBACK_QEMU_LOAD,
    TCG_WASM64_FALLBACK_QEMU_STORE,
    TCG_WASM64_FALLBACK_RUNTIME,
} TCGWasm64FallbackReason;

void tcg_wasm64_counters_reset(TCGWasm64Counters *counters);
void tcg_wasm64_counters_add(TCGWasm64Counters *dst,
                             const TCGWasm64Counters *src);
void tcg_wasm64_count_fallback(TCGWasm64Counters *counters,
                               TCGWasm64FallbackReason reason);

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

#endif /* TCG_WASM64_H */
