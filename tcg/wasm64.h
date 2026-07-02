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

#endif /* TCG_WASM64_H */
