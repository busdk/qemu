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

uintptr_t tcg_tci_qemu_tb_exec(CPUArchState *env, const void *tb_ptr);

static __thread TCGWasm64Counters *active_counters;

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
    dst->fallback_unsupported += src->fallback_unsupported;
    dst->fallback_helper += src->fallback_helper;
    dst->fallback_qemu_load += src->fallback_qemu_load;
    dst->fallback_qemu_store += src->fallback_qemu_store;
    dst->fallback_runtime += src->fallback_runtime;
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

bool tcg_wasm64_backend_available(void)
{
    return true;
}

TCGWasm64Counters *tcg_wasm64_active_counters(void)
{
    return active_counters;
}

void tcg_wasm64_report_summary(const char *reason,
                               const TCGWasm64Counters *counters)
{
    uint64_t generated_coverage_ppm = 0;

    if (!counters) {
        return;
    }

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
            "\"fallback_unsupported\":%" PRIu64 ","
            "\"fallback_helper\":%" PRIu64 ","
            "\"fallback_qemu_load\":%" PRIu64 ","
            "\"fallback_qemu_store\":%" PRIu64 ","
            "\"fallback_runtime\":%" PRIu64 "}\n",
            reason ? reason : "unknown",
            counters->generated_attempts,
            counters->generated_compiled,
            counters->generated_executed,
            counters->generated_cache_hits,
            counters->generated_coverage_numerator,
            counters->generated_coverage_denominator,
            generated_coverage_ppm,
            counters->fallback_unsupported,
            counters->fallback_helper,
            counters->fallback_qemu_load,
            counters->fallback_qemu_store,
            counters->fallback_runtime);
}

uintptr_t tcg_wasm64_tb_exec(CPUArchState *env, const void *tb_ptr,
                             TCGWasm64Counters *counters)
{
    TCGWasm64Counters *previous_counters = active_counters;
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
