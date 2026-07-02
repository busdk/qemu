/*
 * Tiny Code Interpreter for QEMU
 *
 * Copyright (c) 2009, 2011, 2016 Stefan Weil
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#include "qemu/osdep.h"
#include "tcg/tcg.h"
#include "tcg/hotblocks.h"
#include "tcg/helper-info.h"
#include "tcg/tcg-ldst.h"
#include "qemu/perf-attrib.h"
#include "disas/dis-asm.h"
#include "tcg-has.h"
#ifdef CONFIG_TCG_WASM64_BACKEND
#include "tcg/wasm64.h"
#endif
#include <ffi.h>

#ifdef CONFIG_EMSCRIPTEN
#include <emscripten/emscripten.h>
#endif

/*
 * Enable TCI assertions only when debugging TCG (and without NDEBUG defined).
 * Without assertions, the interpreter runs much faster.
 */
#if defined(CONFIG_DEBUG_TCG)
# define tci_assert(cond) assert(cond)
#else
# define tci_assert(cond) ((void)(cond))
#endif

__thread uintptr_t tci_tb_ptr;

#ifdef CONFIG_EMSCRIPTEN
#define TCI_WASM_ENV_FILE "/qemu-tci-env"
#define TCI_WASM_SUBSET_CACHE_SIZE 4096

static bool tci_relaxed_mb;
static bool tci_fast_gates;
static bool tci_progress;
static bool tci_wasm_subset;
static bool tci_wasm_generated_only;
static uint64_t tci_progress_interval;
static uint64_t tci_progress_next_report;
static uint64_t tci_progress_tb_entries;
static uint64_t tci_progress_dispatches;
static int64_t tci_progress_start_us;
static uint64_t tci_wasm_subset_threshold;
static uint64_t tci_wasm_subset_max_ops;
static uint64_t tci_wasm_subset_interval;

typedef struct TCIWasmSubsetEntry {
    const uint32_t *tb_ptr;
    uint64_t hits;
    uint64_t generated_signature;
    uintptr_t generated_func;
    bool validated;
    bool unsupported;
    bool generated_signature_valid;
    bool generated_unsupported;
} TCIWasmSubsetEntry;

#ifndef CONFIG_TCG_WASM64_BACKEND
typedef struct TCIWasmGeneratedContext {
    uintptr_t regs;
    uintptr_t ret;
} TCIWasmGeneratedContext;
#endif

#ifdef CONFIG_TCG_WASM64_BACKEND
#define TCI_WASM_GENERATED_CTX_REGS_OFFSET offsetof(TCGWasm64Context, regs)
#define TCI_WASM_GENERATED_CTX_RET_OFFSET offsetof(TCGWasm64Context, ret)
#else
#define TCI_WASM_GENERATED_CTX_REGS_OFFSET \
    offsetof(TCIWasmGeneratedContext, regs)
#define TCI_WASM_GENERATED_CTX_RET_OFFSET \
    offsetof(TCIWasmGeneratedContext, ret)
#endif

typedef uintptr_t (*TCIWasmGeneratedFunc)(uintptr_t ctx);

typedef enum TCIWasmSubsetStatus {
    TCI_WASM_SUBSET_UNSUPPORTED,
    TCI_WASM_SUBSET_EXIT,
    TCI_WASM_SUBSET_DISPATCH,
} TCIWasmSubsetStatus;

static TCIWasmSubsetEntry tci_wasm_subset_cache[TCI_WASM_SUBSET_CACHE_SIZE];
static uint64_t tci_wasm_subset_attempts;
static uint64_t tci_wasm_subset_executed;
static uint64_t tci_wasm_subset_fallback_cold;
static uint64_t tci_wasm_subset_fallback_unsupported;
static uint64_t tci_wasm_subset_max_ops_rejected;
static uint64_t tci_wasm_subset_next_report;
static uint64_t tci_wasm_subset_unsupported_ops[NB_OPS];
static uint64_t tci_wasm_subset_brcond_bad_target;
static uint64_t tci_wasm_subset_brcond_backward;
static uint64_t tci_wasm_subset_brcond_work_full;
static uint64_t tci_wasm_generated_attempts;
static uint64_t tci_wasm_generated_compiled;
static uint64_t tci_wasm_generated_executed;
static uint64_t tci_wasm_generated_fallback_unsupported;
static uint64_t tci_wasm_generated_compile_failed;
static uint64_t tci_wasm_generated_cache_hits;
static uint64_t tci_wasm_generated_cache_stale;
static uint64_t tci_wasm_generated_unsupported_ops[NB_OPS];

EM_JS(char *, tci_wasm_getenv, (const char *name), {
    const key = UTF8ToString(Number(name));
    const env = Module["qemuWasmTciEnv"] || globalThis.qemuWasmTciEnv || {};
    const value = env[key];

    if (!value) {
        return 0n;
    }

    const text = String(value);
    const length = lengthBytesUTF8(text) + 1;
    const pointer = _malloc(length);
    const pointerNumber = Number(pointer);

    stringToUTF8(text, pointerNumber, length);
    return BigInt(pointerNumber);
});

static char *tci_wasm_file_getenv(const char *name)
{
    g_autofree char *contents = NULL;
    const char *line;
    size_t name_len = strlen(name);

    if (!g_file_get_contents(TCI_WASM_ENV_FILE, &contents, NULL, NULL)) {
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

static const char *tci_getenv(const char *name, char **owned)
{
    const char *value = g_getenv(name);

    *owned = NULL;
    if (value == NULL) {
        *owned = tci_wasm_getenv(name);
        value = *owned;
    }
    if (value == NULL) {
        *owned = tci_wasm_file_getenv(name);
        value = *owned;
    }

    return value;
}

static bool tci_parse_bool_env(const char *raw)
{
    if (raw == NULL || raw[0] == '\0') {
        return false;
    }
    if (g_ascii_strcasecmp(raw, "0") == 0 ||
        g_ascii_strcasecmp(raw, "false") == 0 ||
        g_ascii_strcasecmp(raw, "no") == 0 ||
        g_ascii_strcasecmp(raw, "off") == 0) {
        return false;
    }
    return true;
}

static uint64_t tci_parse_u64_env(const char *name, uint64_t fallback)
{
    char *owned;
    const char *raw = tci_getenv(name, &owned);
    uint64_t value = fallback;

    if (raw != NULL && raw[0] != '\0') {
        char *endptr = NULL;
        unsigned long long parsed = g_ascii_strtoull(raw, &endptr, 10);

        if (endptr != raw && *endptr == '\0') {
            value = parsed;
        }
    }
    free(owned);

    return value;
}

static bool tci_relaxed_mb_enabled(void)
{
    static gsize initialized;

    if (unlikely(g_once_init_enter(&initialized))) {
        char *owned;
        const char *raw = tci_getenv("QEMU_TCI_RELAXED_MB", &owned);

        tci_relaxed_mb = tci_parse_bool_env(raw);
        free(owned);
        g_once_init_leave(&initialized, 1);
    }

    return tci_relaxed_mb;
}

static bool tci_fast_gates_enabled(void)
{
    static gsize initialized;

    if (unlikely(g_once_init_enter(&initialized))) {
        char *owned;
        const char *raw = tci_getenv("QEMU_TCI_FAST_GATES", &owned);

        tci_fast_gates = tci_parse_bool_env(raw);
        free(owned);
        g_once_init_leave(&initialized, 1);
    }

    return tci_fast_gates;
}

static bool tci_wasm_subset_enabled(void)
{
    static gsize initialized;

    if (unlikely(g_once_init_enter(&initialized))) {
        char *owned;
        const char *raw = tci_getenv("QEMU_TCI_WASM_SUBSET", &owned);

#ifdef CONFIG_TCG_WASM64_BACKEND
        tci_wasm_subset = raw == NULL ? true : tci_parse_bool_env(raw);
#else
        tci_wasm_subset = tci_parse_bool_env(raw);
#endif
        free(owned);
        tci_wasm_subset_threshold =
            tci_parse_u64_env("QEMU_TCI_WASM_SUBSET_THRESHOLD", 1024);
        tci_wasm_subset_max_ops =
            tci_parse_u64_env("QEMU_TCI_WASM_SUBSET_MAX_OPS", 512);
        tci_wasm_subset_interval =
            tci_parse_u64_env("QEMU_TCI_WASM_SUBSET_INTERVAL", 100000);
        tci_wasm_subset_threshold = MAX(tci_wasm_subset_threshold, 1);
        tci_wasm_subset_max_ops = MIN(MAX(tci_wasm_subset_max_ops, 1), 512);
        tci_wasm_subset_next_report = tci_wasm_subset_interval;
        g_once_init_leave(&initialized, 1);
    }

    return tci_wasm_subset;
}

static bool tci_wasm_generated_only_enabled(void)
{
    static gsize initialized;

    if (unlikely(g_once_init_enter(&initialized))) {
        char *owned;
        const char *raw = tci_getenv("QEMU_TCI_WASM_GENERATED_ONLY", &owned);

        tci_wasm_generated_only = tci_parse_bool_env(raw);
        free(owned);
        g_once_init_leave(&initialized, 1);
    }

    return tci_wasm_generated_only;
}

static bool tci_progress_enabled(void)
{
    static gsize initialized;

    if (unlikely(g_once_init_enter(&initialized))) {
        char *owned;
        const char *raw = tci_getenv("QEMU_TCI_PROGRESS", &owned);

        tci_progress = tci_parse_bool_env(raw);
        free(owned);
        tci_progress_interval =
            tci_parse_u64_env("QEMU_TCI_PROGRESS_INTERVAL", 100000);
        tci_progress_interval = MAX(tci_progress_interval, 1);
        tci_progress_next_report = tci_progress_interval;
        tci_progress_start_us = g_get_monotonic_time();
        g_once_init_leave(&initialized, 1);
    }

    return tci_progress;
}

static void tci_progress_report(const char *reason, const uint32_t *tb_ptr)
{
    int64_t elapsed_ms = (g_get_monotonic_time() - tci_progress_start_us) / 1000;

    fprintf(stderr,
            "qemu-tci-progress: {\"format\":1,\"event\":\"summary\","
            "\"reason\":\"%s\",\"elapsed_ms\":%" PRId64 ","
            "\"tb_entries\":%" PRIu64 ",\"dispatches\":%" PRIu64 ","
            "\"tb_ptr\":\"0x%" PRIxPTR "\"}\n",
            reason, elapsed_ms, tci_progress_tb_entries,
            tci_progress_dispatches, (uintptr_t)tb_ptr);
}

static void tci_progress_tb_entry(const uint32_t *tb_ptr)
{
    if (unlikely(!tci_progress_enabled())) {
        return;
    }

    tci_progress_tb_entries++;
    if (tci_progress_tb_entries >= tci_progress_next_report) {
        tci_progress_report("interval", tb_ptr);
        tci_progress_next_report =
            tci_progress_tb_entries + tci_progress_interval;
    }
}

static void tci_progress_tb_entry_active(const uint32_t *tb_ptr)
{
    tci_progress_tb_entries++;
    if (tci_progress_tb_entries >= tci_progress_next_report) {
        tci_progress_report("interval", tb_ptr);
        tci_progress_next_report =
            tci_progress_tb_entries + tci_progress_interval;
    }
}

static void tci_progress_dispatch(void)
{
    if (unlikely(tci_progress_enabled())) {
        tci_progress_dispatches++;
    }
}

static void tci_progress_dispatch_active(void)
{
    tci_progress_dispatches++;
}

static inline void tci_mb(void)
{
    /*
     * System-mode barriers preserve ordering against I/O threads and devices.
     * Keep the default path strict.  The relaxed path is an Emscripten-only
     * browser proof experiment for single-vCPU TCI guests where barrier
     * overhead is being measured against a known fallback.
     */
    if (unlikely(tci_relaxed_mb_enabled())) {
        barrier();
        return;
    }
    smp_mb();
}
#else
static inline bool tci_fast_gates_enabled(void)
{
    return false;
}

static inline bool tci_progress_enabled(void)
{
    return false;
}

static inline bool tci_wasm_subset_enabled(void)
{
    return false;
}

static inline void tci_progress_tb_entry(const uint32_t *tb_ptr)
{
    (void)tb_ptr;
}

static inline void tci_progress_tb_entry_active(const uint32_t *tb_ptr)
{
    (void)tb_ptr;
}

static inline void tci_progress_dispatch(void)
{
}

static inline void tci_progress_dispatch_active(void)
{
}

static inline void tci_mb(void)
{
    smp_mb();
}
#endif

/*
 * Load sets of arguments all at once.  The naming convention is:
 *   tci_args_<arguments>
 * where arguments is a sequence of
 *
 *   b = immediate (bit position)
 *   c = condition (TCGCond)
 *   i = immediate (uint32_t)
 *   I = immediate (tcg_target_ulong)
 *   l = label or pointer
 *   m = immediate (MemOpIdx)
 *   n = immediate (call return length)
 *   r = register
 *   s = signed ldst offset
 */

static void tci_args_l(uint32_t insn, const void *tb_ptr, void **l0)
{
    int diff = sextract32(insn, 12, 20);
    *l0 = diff ? (void *)tb_ptr + diff : NULL;
}

static void tci_args_r(uint32_t insn, TCGReg *r0)
{
    *r0 = extract32(insn, 8, 4);
}

static void tci_args_nl(uint32_t insn, const void *tb_ptr,
                        uint8_t *n0, void **l1)
{
    *n0 = extract32(insn, 8, 4);
    *l1 = sextract32(insn, 12, 20) + (void *)tb_ptr;
}

static void tci_args_rl(uint32_t insn, const void *tb_ptr,
                        TCGReg *r0, void **l1)
{
    *r0 = extract32(insn, 8, 4);
    *l1 = sextract32(insn, 12, 20) + (void *)tb_ptr;
}

static void tci_args_rr(uint32_t insn, TCGReg *r0, TCGReg *r1)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
}

static void tci_args_ri(uint32_t insn, TCGReg *r0, tcg_target_ulong *i1)
{
    *r0 = extract32(insn, 8, 4);
    *i1 = sextract32(insn, 12, 20);
}

static void tci_args_rrm(uint32_t insn, TCGReg *r0,
                         TCGReg *r1, MemOpIdx *m2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *m2 = extract32(insn, 16, 16);
}

static void tci_args_rrr(uint32_t insn, TCGReg *r0, TCGReg *r1, TCGReg *r2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
}

static void tci_args_rrs(uint32_t insn, TCGReg *r0, TCGReg *r1, int32_t *i2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *i2 = sextract32(insn, 16, 16);
}

static void tci_args_rrbb(uint32_t insn, TCGReg *r0, TCGReg *r1,
                          uint8_t *i2, uint8_t *i3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *i2 = extract32(insn, 16, 6);
    *i3 = extract32(insn, 22, 6);
}

static void tci_args_rrrc(uint32_t insn,
                          TCGReg *r0, TCGReg *r1, TCGReg *r2, TCGCond *c3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *c3 = extract32(insn, 20, 4);
}

static void tci_args_rrrbb(uint32_t insn, TCGReg *r0, TCGReg *r1,
                           TCGReg *r2, uint8_t *i3, uint8_t *i4)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *i3 = extract32(insn, 20, 6);
    *i4 = extract32(insn, 26, 6);
}

static void tci_args_rrrr(uint32_t insn,
                          TCGReg *r0, TCGReg *r1, TCGReg *r2, TCGReg *r3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
}

static void tci_args_rrrrrc(uint32_t insn, TCGReg *r0, TCGReg *r1,
                            TCGReg *r2, TCGReg *r3, TCGReg *r4, TCGCond *c5)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
    *r4 = extract32(insn, 24, 4);
    *c5 = extract32(insn, 28, 4);
}

static bool tci_compare32(uint32_t u0, uint32_t u1, TCGCond condition)
{
    bool result = false;
    int32_t i0 = u0;
    int32_t i1 = u1;
    switch (condition) {
    case TCG_COND_EQ:
        result = (u0 == u1);
        break;
    case TCG_COND_NE:
        result = (u0 != u1);
        break;
    case TCG_COND_LT:
        result = (i0 < i1);
        break;
    case TCG_COND_GE:
        result = (i0 >= i1);
        break;
    case TCG_COND_LE:
        result = (i0 <= i1);
        break;
    case TCG_COND_GT:
        result = (i0 > i1);
        break;
    case TCG_COND_LTU:
        result = (u0 < u1);
        break;
    case TCG_COND_GEU:
        result = (u0 >= u1);
        break;
    case TCG_COND_LEU:
        result = (u0 <= u1);
        break;
    case TCG_COND_GTU:
        result = (u0 > u1);
        break;
    case TCG_COND_TSTEQ:
        result = (u0 & u1) == 0;
        break;
    case TCG_COND_TSTNE:
        result = (u0 & u1) != 0;
        break;
    default:
        g_assert_not_reached();
    }
    return result;
}

static bool tci_compare64(uint64_t u0, uint64_t u1, TCGCond condition)
{
    bool result = false;
    int64_t i0 = u0;
    int64_t i1 = u1;
    switch (condition) {
    case TCG_COND_EQ:
        result = (u0 == u1);
        break;
    case TCG_COND_NE:
        result = (u0 != u1);
        break;
    case TCG_COND_LT:
        result = (i0 < i1);
        break;
    case TCG_COND_GE:
        result = (i0 >= i1);
        break;
    case TCG_COND_LE:
        result = (i0 <= i1);
        break;
    case TCG_COND_GT:
        result = (i0 > i1);
        break;
    case TCG_COND_LTU:
        result = (u0 < u1);
        break;
    case TCG_COND_GEU:
        result = (u0 >= u1);
        break;
    case TCG_COND_LEU:
        result = (u0 <= u1);
        break;
    case TCG_COND_GTU:
        result = (u0 > u1);
        break;
    case TCG_COND_TSTEQ:
        result = (u0 & u1) == 0;
        break;
    case TCG_COND_TSTNE:
        result = (u0 & u1) != 0;
        break;
    default:
        g_assert_not_reached();
    }
    return result;
}

static uint64_t tci_qemu_ld(CPUArchState *env, uint64_t taddr,
                            MemOpIdx oi, const void *tb_ptr)
{
    MemOp mop = get_memop(oi);
    uintptr_t ra = (uintptr_t)tb_ptr;

    switch (mop & MO_SSIZE) {
    case MO_UB:
        return helper_ldub_mmu(env, taddr, oi, ra);
    case MO_SB:
        return helper_ldsb_mmu(env, taddr, oi, ra);
    case MO_UW:
        return helper_lduw_mmu(env, taddr, oi, ra);
    case MO_SW:
        return helper_ldsw_mmu(env, taddr, oi, ra);
    case MO_UL:
        return helper_ldul_mmu(env, taddr, oi, ra);
    case MO_SL:
        return helper_ldsl_mmu(env, taddr, oi, ra);
    case MO_UQ:
        return helper_ldq_mmu(env, taddr, oi, ra);
    default:
        g_assert_not_reached();
    }
}

static void tci_qemu_st(CPUArchState *env, uint64_t taddr, uint64_t val,
                        MemOpIdx oi, const void *tb_ptr)
{
    MemOp mop = get_memop(oi);
    uintptr_t ra = (uintptr_t)tb_ptr;

    switch (mop & MO_SIZE) {
    case MO_UB:
        helper_stb_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UW:
        helper_stw_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UL:
        helper_stl_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UQ:
        helper_stq_mmu(env, taddr, val, oi, ra);
        break;
    default:
        g_assert_not_reached();
    }
}

#ifdef CONFIG_EMSCRIPTEN
static bool tci_wasm_subset_target_ok(const uint32_t *base,
                                      const uint32_t *target)
{
    uintptr_t base_addr = (uintptr_t)base;
    uintptr_t target_addr = (uintptr_t)target;
    uintptr_t limit_addr = base_addr + tci_wasm_subset_max_ops * sizeof(*base);

    return target_addr >= base_addr && target_addr < limit_addr &&
           (target_addr - base_addr) % sizeof(*base) == 0;
}

static bool tci_wasm_subset_compare32(uint32_t lhs, uint32_t rhs,
                                      TCGCond condition)
{
    switch (condition) {
    case TCG_COND_NEVER:
        return false;
    case TCG_COND_ALWAYS:
        return true;
    default:
        return tci_compare32(lhs, rhs, condition);
    }
}

static uint64_t tci_wasm_generated_signature(const uint32_t *tb_start)
{
    uint64_t max_ops = MIN(tci_wasm_subset_max_ops, 512);
    uint64_t hash = 0xcbf29ce484222325ULL;

    for (uint64_t index = 0; index < max_ops; index++) {
        const uint32_t *insn_ptr = tb_start + index;
        const uint32_t *tb_ptr = insn_ptr + 1;
        uint32_t insn = *insn_ptr;
        TCGOpcode opc = extract32(insn, 0, 8);

        hash ^= insn;
        hash *= 0x100000001b3ULL;

        if (opc == INDEX_op_exit_tb || opc == INDEX_op_goto_tb) {
            void *ptr;

            tci_args_l(insn, tb_ptr, &ptr);
            hash ^= (uintptr_t)ptr;
            hash *= 0x100000001b3ULL;
            break;
        }
    }

    return hash;
}

static bool tci_wasm_generated_mark_unsupported(TCIWasmSubsetEntry *entry,
                                                TCGOpcode opc)
{
    entry->generated_unsupported = true;
    tci_wasm_generated_fallback_unsupported++;
    if (opc < NB_OPS) {
        tci_wasm_generated_unsupported_ops[opc]++;
    }
    return false;
}

static bool tci_wasm_generated_opcode_supported(TCGOpcode opc)
{
    switch (opc) {
    case INDEX_op_mov:
    case INDEX_op_tci_movi:
    case INDEX_op_tci_movl:
    case INDEX_op_add:
    case INDEX_op_sub:
    case INDEX_op_mul:
    case INDEX_op_and:
    case INDEX_op_or:
    case INDEX_op_xor:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
        return true;
    default:
        return false;
    }
}

static bool tci_wasm_generated_prevalidate(TCIWasmSubsetEntry *entry,
                                           const uint32_t *tb_start)
{
    uint64_t max_ops = MIN(tci_wasm_subset_max_ops, 512);

    for (uint64_t index = 0; index < max_ops; index++) {
        const uint32_t *insn_ptr = tb_start + index;
        uint32_t insn = *insn_ptr;
        TCGOpcode opc = extract32(insn, 0, 8);

        if (!tci_wasm_generated_opcode_supported(opc)) {
            return tci_wasm_generated_mark_unsupported(entry, opc);
        }
        if (opc == INDEX_op_exit_tb || opc == INDEX_op_goto_tb) {
            return true;
        }
    }

    return tci_wasm_generated_mark_unsupported(entry, NB_OPS);
}

EM_JS(uintptr_t, tci_wasm_generated_compile_js,
      (uintptr_t tb_arg, uint64_t max_ops_arg, int op_mov, int op_movi,
       int op_movl, int op_add, int op_sub, int op_mul, int op_and, int op_or,
       int op_xor, int op_exit_tb, int op_goto_tb, int ctx_regs_offset,
       int ctx_ret_offset),
{
    const tb = Number(tb_arg);
    const maxOps = Number(max_ops_arg);
    const valueI64 = 0x7e;

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

    function encodeI64(value) {
        const bytes = [];
        let current = BigInt.asIntN(64, BigInt(value));
        let more = true;

        while (more) {
            let byte = Number(current & 0x7fn);
            const sign = byte & 0x40;

            current >>= 7n;
            more = !((current === 0n && sign === 0) ||
                     (current === -1n && sign !== 0));
            if (more) {
                byte |= 0x80;
            }
            bytes.push(byte);
        }
        return bytes;
    }

    function vector(items) {
        return [...encodeU32(items.length), ...items.flat()];
    }

    function section(id, payload) {
        return [id, ...encodeU32(payload.length), ...payload];
    }

    function name(text) {
        const encoded = Array.from(new TextEncoder().encode(text));
        return [...encodeU32(encoded.length), ...encoded];
    }

    function functionType(params, results) {
        return [0x60, ...vector(params), ...vector(results)];
    }

    function functionBody(instructions, locals = []) {
        const body = [
            ...vector(locals.map((local) => [
                ...encodeU32(local.count),
                local.type,
            ])),
            ...instructions,
            0x0b,
        ];
        return [...encodeU32(body.length), ...body];
    }

    function localGet(index) {
        return [0x20, ...encodeU32(index)];
    }

    function localSet(index, expr) {
        return [...expr, 0x21, ...encodeU32(index)];
    }

    function i64Load(address, offset) {
        return [...address, 0x29, ...encodeU32(3), ...encodeU32(offset)];
    }

    function i64Store(address, value, offset) {
        return [
            ...address,
            ...value,
            0x37,
            ...encodeU32(3),
            ...encodeU32(offset),
        ];
    }

    function i64Const(value) {
        return [0x42, ...encodeI64(value)];
    }

    function bits(value, start, length) {
        return (value >>> start) & ((1 << length) - 1);
    }

    function sextract(value, start, length) {
        const mask = (1 << length) - 1;
        let extracted = (value >>> start) & mask;
        const sign = 1 << (length - 1);

        if (extracted & sign) {
            extracted |= ~mask;
        }
        return extracted;
    }

    function readU64(address) {
        return HEAPU64[Number(address) >> 3];
    }

    function regLocal(reg) {
        return 3 + Number(reg);
    }

    function compileFunction() {
        const instructions = [];
        let terminal = null;

        instructions.push(...localSet(1, i64Load(localGet(0), ctx_regs_offset)));
        instructions.push(...localSet(2, i64Load(localGet(0), ctx_ret_offset)));
        for (let reg = 0; reg < 16; reg++) {
            instructions.push(
                ...localSet(regLocal(reg), i64Load(localGet(1), reg * 8))
            );
        }

        for (let index = 0; index < maxOps; index++) {
            const insnPtr = tb + index * 4;
            const tbPtr = insnPtr + 4;
            const insn = HEAPU32[insnPtr >> 2];
            const opc = bits(insn, 0, 8);
            const r0 = bits(insn, 8, 4);
            const r1 = bits(insn, 12, 4);
            const r2 = bits(insn, 16, 4);

            if (opc === op_mov) {
                instructions.push(...localSet(regLocal(r0),
                                              localGet(regLocal(r1))));
            } else if (opc === op_movi) {
                instructions.push(...localSet(regLocal(r0),
                                              i64Const(sextract(insn, 12, 20))));
            } else if (opc === op_movl) {
                const ptr = BigInt(tbPtr + sextract(insn, 12, 20));
                instructions.push(...localSet(regLocal(r0),
                                              i64Const(readU64(ptr))));
            } else if (opc === op_add || opc === op_sub || opc === op_mul ||
                       opc === op_and || opc === op_or || opc === op_xor) {
                instructions.push(...localGet(regLocal(r1)),
                                  ...localGet(regLocal(r2)));
                if (opc === op_add) {
                    instructions.push(0x7c); /* i64.add */
                } else if (opc === op_sub) {
                    instructions.push(0x7d); /* i64.sub */
                } else if (opc === op_mul) {
                    instructions.push(0x7e); /* i64.mul */
                } else if (opc === op_and) {
                    instructions.push(0x83); /* i64.and */
                } else if (opc === op_or) {
                    instructions.push(0x84); /* i64.or */
                } else {
                    instructions.push(0x85); /* i64.xor */
                }
                instructions.push(0x21, ...encodeU32(regLocal(r0)));
            } else if (opc === op_exit_tb || opc === op_goto_tb) {
                const ptr = BigInt(tbPtr + sextract(insn, 12, 20));
                terminal = {
                    kind: opc === op_goto_tb ? "goto_tb" : "exit_tb",
                    ret: ptr,
                    status: opc === op_goto_tb ? 2n : 1n,
                };
                break;
            } else {
                return 0;
            }
        }

        if (terminal === null) {
            return 0;
        }

        for (let reg = 0; reg < 16; reg++) {
            instructions.push(
                ...i64Store(localGet(1), localGet(regLocal(reg)), reg * 8)
            );
        }
        instructions.push(...i64Store(
            localGet(2),
            terminal.kind === "goto_tb" ? i64Load(i64Const(terminal.ret), 0)
                                        : i64Const(terminal.ret),
            0
        ));
        instructions.push(...i64Const(terminal.status));

        const bytes = [
            0x00, 0x61, 0x73, 0x6d,
            0x01, 0x00, 0x00, 0x00,
            ...section(1, vector([functionType([valueI64], [valueI64])])),
            ...section(2, vector([[
                ...name("env"),
                ...name("memory"),
                0x02, 0x07, 0x00, 0x80, 0x80, 0x10,
            ]])),
            ...section(3, vector([[0x00]])),
            ...section(7, vector([[...name("run"), 0x00, ...encodeU32(0)]])),
            ...section(10, vector([functionBody(
                instructions,
                [{ count: 18, type: valueI64 }]
            )])),
        ];
        const module = new WebAssembly.Module(Uint8Array.from(bytes));
        const instance = new WebAssembly.Instance(module, {
            env: { memory: wasmMemory },
        });

        return addFunction(instance.exports.run, "ii");
    }

    try {
        if (typeof wasmMemory === "undefined" ||
            typeof addFunction !== "function") {
            return 0n;
        }
        const func = compileFunction();
        return func ? BigInt(func) : 0n;
    } catch (error) {
        return 0n;
    }
});

static void tci_wasm_subset_report(const char *reason)
{
    TCGOpcode top_ops[8] = { 0 };
    TCGOpcode top_generated_ops[8] = { 0 };
#ifdef CONFIG_TCG_WASM64_BACKEND
    TCGWasm64Counters wasm64_counters = {
        .generated_attempts = tci_wasm_generated_attempts,
        .generated_compiled = tci_wasm_generated_compiled,
        .generated_executed = tci_wasm_generated_executed,
        .generated_cache_hits = tci_wasm_generated_cache_hits,
        .fallback_unsupported = tci_wasm_generated_fallback_unsupported,
        .fallback_runtime = tci_wasm_generated_compile_failed,
    };
#endif

    for (TCGOpcode opc = 0; opc < NB_OPS; opc++) {
        uint64_t count = tci_wasm_subset_unsupported_ops[opc];

        if (count == 0) {
            continue;
        }
        for (size_t i = 0; i < ARRAY_SIZE(top_ops); i++) {
            if (tci_wasm_subset_unsupported_ops[top_ops[i]] < count) {
                memmove(&top_ops[i + 1], &top_ops[i],
                        (ARRAY_SIZE(top_ops) - i - 1) * sizeof(top_ops[0]));
                top_ops[i] = opc;
                break;
            }
        }
    }
    for (TCGOpcode opc = 0; opc < NB_OPS; opc++) {
        uint64_t count = tci_wasm_generated_unsupported_ops[opc];

        if (count == 0) {
            continue;
        }
        for (size_t i = 0; i < ARRAY_SIZE(top_generated_ops); i++) {
            if (tci_wasm_generated_unsupported_ops[top_generated_ops[i]] <
                count) {
                memmove(&top_generated_ops[i + 1], &top_generated_ops[i],
                        (ARRAY_SIZE(top_generated_ops) - i - 1) *
                        sizeof(top_generated_ops[0]));
                top_generated_ops[i] = opc;
                break;
            }
        }
    }

    fprintf(stderr,
            "qemu-tci-wasm-subset: {\"format\":1,\"event\":\"summary\","
            "\"reason\":\"%s\",\"attempts\":%" PRIu64 ","
            "\"executed\":%" PRIu64 ",\"fallback_cold\":%" PRIu64 ","
            "\"fallback_unsupported\":%" PRIu64 ","
            "\"max_ops_rejected\":%" PRIu64 ","
            "\"brcond_bad_target\":%" PRIu64 ","
            "\"brcond_backward\":%" PRIu64 ","
            "\"brcond_work_full\":%" PRIu64 ","
            "\"generated_attempts\":%" PRIu64 ","
            "\"generated_compiled\":%" PRIu64 ","
            "\"generated_executed\":%" PRIu64 ","
            "\"generated_fallback_unsupported\":%" PRIu64 ","
            "\"generated_compile_failed\":%" PRIu64 ","
            "\"generated_cache_hits\":%" PRIu64 ","
            "\"generated_cache_stale\":%" PRIu64 ","
            "\"top_unsupported_ops\":[",
            reason, tci_wasm_subset_attempts, tci_wasm_subset_executed,
            tci_wasm_subset_fallback_cold,
            tci_wasm_subset_fallback_unsupported,
            tci_wasm_subset_max_ops_rejected,
            tci_wasm_subset_brcond_bad_target,
            tci_wasm_subset_brcond_backward,
            tci_wasm_subset_brcond_work_full,
            tci_wasm_generated_attempts,
            tci_wasm_generated_compiled,
            tci_wasm_generated_executed,
            tci_wasm_generated_fallback_unsupported,
            tci_wasm_generated_compile_failed,
            tci_wasm_generated_cache_hits,
            tci_wasm_generated_cache_stale);
    for (size_t i = 0; i < ARRAY_SIZE(top_ops); i++) {
        TCGOpcode opc = top_ops[i];
        uint64_t count = tci_wasm_subset_unsupported_ops[opc];

        if (count == 0) {
            break;
        }
        fprintf(stderr, "%s{\"op\":%u,\"name\":\"%s\",\"count\":%" PRIu64 "}",
                i == 0 ? "" : ",", opc,
                opc < tcg_op_defs_max ? tcg_op_defs[opc].name : "unknown",
                count);
    }
    fprintf(stderr, "],\"top_generated_unsupported_ops\":[");
    for (size_t i = 0; i < ARRAY_SIZE(top_generated_ops); i++) {
        TCGOpcode opc = top_generated_ops[i];
        uint64_t count = tci_wasm_generated_unsupported_ops[opc];

        if (count == 0) {
            break;
        }
        fprintf(stderr, "%s{\"op\":%u,\"name\":\"%s\",\"count\":%" PRIu64 "}",
                i == 0 ? "" : ",", opc,
                opc < tcg_op_defs_max ? tcg_op_defs[opc].name : "unknown",
                count);
    }
    fprintf(stderr, "]}\n");

#ifdef CONFIG_TCG_WASM64_BACKEND
    tcg_wasm64_report_summary(reason, &wasm64_counters);
#endif
}

static TCIWasmSubsetEntry *tci_wasm_subset_entry(const uint32_t *tb_ptr)
{
    uintptr_t hash = (uintptr_t)tb_ptr >> 4;
    TCIWasmSubsetEntry *entry =
        &tci_wasm_subset_cache[hash % TCI_WASM_SUBSET_CACHE_SIZE];

    if (entry->tb_ptr != tb_ptr) {
        entry->tb_ptr = tb_ptr;
        entry->hits = 0;
        entry->generated_signature = 0;
        entry->generated_func = 0;
        entry->validated = false;
        entry->unsupported = false;
        entry->generated_signature_valid = false;
        entry->generated_unsupported = false;
    }

    return entry;
}

static bool tci_wasm_subset_unsupported(TCIWasmSubsetEntry *entry,
                                        TCGOpcode opc)
{
    entry->unsupported = true;
    tci_wasm_subset_fallback_unsupported++;
    if (opc < NB_OPS) {
        tci_wasm_subset_unsupported_ops[opc]++;
    }
    return false;
}

static bool tci_wasm_subset_opcode_supported(TCGOpcode opc)
{
    switch (opc) {
    case INDEX_op_call:
    case INDEX_op_br:
    case INDEX_op_setcond:
    case INDEX_op_movcond:
    case INDEX_op_mov:
    case INDEX_op_tci_movi:
    case INDEX_op_tci_movl:
    case INDEX_op_ld8u:
    case INDEX_op_ld8s:
    case INDEX_op_ld16u:
    case INDEX_op_ld16s:
    case INDEX_op_ld:
    case INDEX_op_st8:
    case INDEX_op_st16:
    case INDEX_op_st:
    case INDEX_op_add:
    case INDEX_op_sub:
    case INDEX_op_mul:
    case INDEX_op_and:
    case INDEX_op_or:
    case INDEX_op_xor:
    case INDEX_op_andc:
    case INDEX_op_orc:
    case INDEX_op_eqv:
    case INDEX_op_nand:
    case INDEX_op_nor:
    case INDEX_op_neg:
    case INDEX_op_not:
    case INDEX_op_ctpop:
    case INDEX_op_muls2:
    case INDEX_op_mulu2:
    case INDEX_op_tci_clz32:
    case INDEX_op_tci_ctz32:
    case INDEX_op_tci_setcond32:
    case INDEX_op_tci_movcond32:
    case INDEX_op_shl:
    case INDEX_op_shr:
    case INDEX_op_sar:
    case INDEX_op_tci_rotl32:
    case INDEX_op_tci_rotr32:
    case INDEX_op_rotl:
    case INDEX_op_rotr:
    case INDEX_op_deposit:
    case INDEX_op_extract:
    case INDEX_op_sextract:
    case INDEX_op_brcond:
    case INDEX_op_bswap16:
    case INDEX_op_bswap32:
    case INDEX_op_ld32u:
    case INDEX_op_ld32s:
    case INDEX_op_st32:
    case INDEX_op_clz:
    case INDEX_op_ctz:
    case INDEX_op_ext_i32_i64:
    case INDEX_op_extu_i32_i64:
    case INDEX_op_bswap64:
    case INDEX_op_mb:
    case INDEX_op_qemu_ld:
    case INDEX_op_tci_qemu_ld_rrr:
    case INDEX_op_qemu_st:
    case INDEX_op_tci_qemu_st_rrr:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
    case INDEX_op_goto_ptr:
        return true;
    default:
        return false;
    }
}

static bool tci_wasm_subset_validate(const uint32_t *tb_start,
                                     TCIWasmSubsetEntry *entry)
{
    uint64_t max_ops = MIN(tci_wasm_subset_max_ops, 512);
    g_autofree bool *seen = g_new0(bool, max_ops);
    g_autofree uint64_t *work = g_new(uint64_t, max_ops);
    uint64_t work_count = 0;
    bool has_exit = false;

    work[work_count++] = 0;
    while (work_count > 0) {
        uint64_t index = work[--work_count];

        while (index < max_ops) {
            const uint32_t *insn_ptr = tb_start + index;
            const uint32_t *tb_ptr = insn_ptr + 1;
            uint32_t insn = *insn_ptr;
            TCGOpcode opc = extract32(insn, 0, 8);
            void *ptr;

            if (seen[index]) {
                break;
            }
            seen[index] = true;
            if (!tci_wasm_subset_opcode_supported(opc)) {
                return tci_wasm_subset_unsupported(entry, opc);
            }
            switch (opc) {
            case INDEX_op_br:
                tci_args_l(insn, tb_ptr, &ptr);
                if (ptr == NULL ||
                    !tci_wasm_subset_target_ok(tb_start, ptr) ||
                    (const uint32_t *)ptr <= insn_ptr ||
                    (uint64_t)((const uint32_t *)ptr - tb_start) >= max_ops) {
                    return tci_wasm_subset_unsupported(entry, opc);
                }
                index = (const uint32_t *)ptr - tb_start;
                continue;
            case INDEX_op_brcond:
                {
                    TCGReg ignored;
                    uint64_t target_index;

                    tci_args_rl(insn, tb_ptr, &ignored, &ptr);
                    if (ptr == NULL ||
                        !tci_wasm_subset_target_ok(tb_start, ptr) ||
                        (uint64_t)((const uint32_t *)ptr - tb_start) >=
                        max_ops) {
                        tci_wasm_subset_brcond_bad_target++;
                        return tci_wasm_subset_unsupported(entry, opc);
                    }
                    if ((const uint32_t *)ptr <= insn_ptr) {
                        tci_wasm_subset_brcond_backward++;
                        return tci_wasm_subset_unsupported(entry, opc);
                    }
                    target_index = (const uint32_t *)ptr - tb_start;
                    if (work_count == max_ops) {
                        tci_wasm_subset_brcond_work_full++;
                        return tci_wasm_subset_unsupported(entry, opc);
                    }
                    work[work_count++] = target_index;
                    index++;
                }
                break;
            case INDEX_op_exit_tb:
                has_exit = true;
                goto next_path;
            case INDEX_op_goto_tb:
            case INDEX_op_goto_ptr:
                has_exit = true;
                goto next_path;
            default:
                index++;
                break;
            }
        }
    next_path:
        continue;
    }

    if (!has_exit) {
        tci_wasm_subset_max_ops_rejected++;
        return tci_wasm_subset_unsupported(entry, NB_OPS);
    }
    entry->validated = true;
    return true;
}

static TCIWasmSubsetStatus
tci_wasm_generated_try_exec(TCIWasmSubsetEntry *entry, const uint32_t *tb_start,
                            tcg_target_ulong *regs, uintptr_t *ret)
{
    uint64_t signature = tci_wasm_generated_signature(tb_start);
#ifdef CONFIG_TCG_WASM64_BACKEND
    TCGWasm64Counters *wasm64_counters = tcg_wasm64_active_counters();
    TCGWasm64Context ctx = {
        .tb_ptr = (void *)tb_start,
        .env = (void *)regs[TCG_AREG0],
        .regs = (uintptr_t)regs,
        .ret = (uintptr_t)ret,
        .counters = wasm64_counters,
    };
#else
    TCIWasmGeneratedContext ctx = {
        .regs = (uintptr_t)regs,
        .ret = (uintptr_t)ret,
    };
#endif
    int status;

    if (!entry->generated_signature_valid ||
        entry->generated_signature != signature) {
        if (entry->generated_signature_valid) {
            tci_wasm_generated_cache_stale++;
        }
        entry->generated_signature = signature;
        entry->generated_signature_valid = true;
        entry->generated_unsupported = false;
        entry->generated_func = 0;
    }
    if (entry->generated_unsupported) {
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }

    tci_wasm_generated_attempts++;
#ifdef CONFIG_TCG_WASM64_BACKEND
    if (wasm64_counters) {
        wasm64_counters->generated_attempts++;
    }
#endif
    if (!tci_wasm_generated_prevalidate(entry, tb_start)) {
#ifdef CONFIG_TCG_WASM64_BACKEND
        tcg_wasm64_count_fallback(wasm64_counters,
                                  TCG_WASM64_FALLBACK_UNSUPPORTED);
#endif
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }

    if (entry->generated_func == 0) {
        entry->generated_func = tci_wasm_generated_compile_js(
            (uintptr_t)tb_start, tci_wasm_subset_max_ops, INDEX_op_mov,
            INDEX_op_tci_movi, INDEX_op_tci_movl, INDEX_op_add,
            INDEX_op_sub, INDEX_op_mul, INDEX_op_and, INDEX_op_or,
            INDEX_op_xor, INDEX_op_exit_tb, INDEX_op_goto_tb,
            (int)TCI_WASM_GENERATED_CTX_REGS_OFFSET,
            (int)TCI_WASM_GENERATED_CTX_RET_OFFSET);
        if (entry->generated_func == 0) {
            entry->generated_unsupported = true;
            tci_wasm_generated_compile_failed++;
#ifdef CONFIG_TCG_WASM64_BACKEND
            tcg_wasm64_count_fallback(wasm64_counters,
                                      TCG_WASM64_FALLBACK_RUNTIME);
#endif
            return TCI_WASM_SUBSET_UNSUPPORTED;
        }
        tci_wasm_generated_compiled++;
#ifdef CONFIG_TCG_WASM64_BACKEND
        if (wasm64_counters) {
            wasm64_counters->generated_compiled++;
        }
#endif
    } else {
        tci_wasm_generated_cache_hits++;
#ifdef CONFIG_TCG_WASM64_BACKEND
        if (wasm64_counters) {
            wasm64_counters->generated_cache_hits++;
        }
#endif
    }

    status = ((TCIWasmGeneratedFunc)entry->generated_func)((uintptr_t)&ctx);

    if (status <= 0) {
        entry->generated_unsupported = true;
        tci_wasm_generated_compile_failed++;
#ifdef CONFIG_TCG_WASM64_BACKEND
        tcg_wasm64_count_fallback(wasm64_counters,
                                  TCG_WASM64_FALLBACK_RUNTIME);
#endif
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }

    switch (status) {
    case TCI_WASM_SUBSET_EXIT:
        tci_wasm_generated_executed++;
#ifdef CONFIG_TCG_WASM64_BACKEND
        if (wasm64_counters) {
            wasm64_counters->generated_executed++;
        }
#endif
        return TCI_WASM_SUBSET_EXIT;
    case TCI_WASM_SUBSET_DISPATCH:
        tci_wasm_generated_executed++;
#ifdef CONFIG_TCG_WASM64_BACKEND
        if (wasm64_counters) {
            wasm64_counters->generated_executed++;
        }
#endif
        return TCI_WASM_SUBSET_DISPATCH;
    default:
        tci_wasm_generated_compile_failed++;
#ifdef CONFIG_TCG_WASM64_BACKEND
        tcg_wasm64_count_fallback(wasm64_counters,
                                  TCG_WASM64_FALLBACK_RUNTIME);
#endif
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }
}

static TCIWasmSubsetStatus tci_wasm_subset_try_exec(const uint32_t *tb_start,
                                                    tcg_target_ulong *regs,
                                                    uintptr_t *ret)
{
    TCIWasmSubsetEntry *entry;
    tcg_target_ulong tmp[TCG_TARGET_NB_REGS];
    const uint32_t *tb_ptr = tb_start;
    uint64_t ops;

    if (unlikely(!tci_wasm_subset_enabled())) {
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }

    tci_wasm_subset_attempts++;
    if (tci_wasm_subset_interval != 0 &&
        tci_wasm_subset_attempts >= tci_wasm_subset_next_report) {
        tci_wasm_subset_report("interval");
        qemu_perf_attrib_poll();
        tci_wasm_subset_next_report =
            tci_wasm_subset_attempts + tci_wasm_subset_interval;
    }

    entry = tci_wasm_subset_entry(tb_start);
    entry->hits++;
    if (entry->hits < tci_wasm_subset_threshold) {
        tci_wasm_subset_fallback_cold++;
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }
    if (entry->unsupported) {
        tci_wasm_subset_fallback_unsupported++;
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }
    switch (tci_wasm_generated_try_exec(entry, tb_start, regs, ret)) {
    case TCI_WASM_SUBSET_EXIT:
        tci_wasm_subset_executed++;
        return TCI_WASM_SUBSET_EXIT;
    case TCI_WASM_SUBSET_DISPATCH:
        tci_wasm_subset_executed++;
        return TCI_WASM_SUBSET_DISPATCH;
    case TCI_WASM_SUBSET_UNSUPPORTED:
        break;
    }
    if (tci_wasm_generated_only_enabled()) {
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }
    if (!entry->validated &&
        !tci_wasm_subset_validate(tb_start, entry)) {
        return TCI_WASM_SUBSET_UNSUPPORTED;
    }

    memcpy(tmp, regs, sizeof(tmp));
    for (ops = 0; ops < tci_wasm_subset_max_ops; ops++) {
        uint32_t insn = *tb_ptr++;
        TCGOpcode opc = extract32(insn, 0, 8);
        TCGReg r0, r1, r2;
        TCGCond condition;
        tcg_target_ulong imm;
        uint32_t tmp32;
        uint64_t taddr;
        uint8_t pos, len;
        MemOpIdx oi;
        int32_t ofs;
        void *ptr;

        switch (opc) {
        case INDEX_op_call:
            {
                uint64_t *stack = (uint64_t *)(uintptr_t)tmp[TCG_REG_CALL_STACK];
                void *call_slots[MAX_CALL_IARGS];
                ffi_cif *cif;
                void *func;
                unsigned i, s, n;

                tci_args_nl(insn, tb_ptr, &len, &ptr);
                func = ((void **)ptr)[0];
                cif = ((void **)ptr)[1];

                n = cif->nargs;
                for (i = s = 0; i < n; ++i) {
                    ffi_type *t = cif->arg_types[i];
                    call_slots[i] = &stack[s];
                    s += DIV_ROUND_UP(t->size, 8);
                }

                tci_tb_ptr = (uintptr_t)tb_ptr;
                ffi_call(cif, func, stack, call_slots);

                switch (len) {
                case 0:
                    break;
                case 1:
                    if (sizeof(ffi_arg) == 8) {
                        tmp[TCG_REG_R0] = (uint32_t)stack[0];
                    } else {
                        tmp[TCG_REG_R0] = *(uint32_t *)stack;
                    }
                    break;
                case 2:
                    memcpy(&tmp[TCG_REG_R0], stack, 8);
                    break;
                case 3:
                    memcpy(&tmp[TCG_REG_R0], stack, 16);
                    break;
                default:
                    g_assert_not_reached();
                }
            }
            break;
        case INDEX_op_br:
            tci_args_l(insn, tb_ptr, &ptr);
            tb_ptr = ptr;
            break;
        case INDEX_op_setcond:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            tmp[r0] = tci_compare64(tmp[r1], tmp[r2], condition);
            break;
        case INDEX_op_movcond:
            {
                TCGReg r3, r4;

                tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
                tmp32 = tci_compare64(tmp[r1], tmp[r2], condition);
                tmp[r0] = tmp[tmp32 ? r3 : r4];
            }
            break;
        case INDEX_op_brcond:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if (tmp[r0]) {
                tb_ptr = ptr;
            }
            break;
        case INDEX_op_mov:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = tmp[r1];
            break;
        case INDEX_op_tci_movi:
            tci_args_ri(insn, &r0, &imm);
            tmp[r0] = imm;
            break;
        case INDEX_op_tci_movl:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            tmp[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_ld8u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(uint8_t *)ptr;
            break;
        case INDEX_op_ld8s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(int8_t *)ptr;
            break;
        case INDEX_op_ld16u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(uint16_t *)ptr;
            break;
        case INDEX_op_ld16s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(int16_t *)ptr;
            break;
        case INDEX_op_ld:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_st8:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            *(uint8_t *)ptr = tmp[r0];
            break;
        case INDEX_op_st16:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            *(uint16_t *)ptr = tmp[r0];
            break;
        case INDEX_op_st:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            *(tcg_target_ulong *)ptr = tmp[r0];
            break;
        case INDEX_op_add:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] + tmp[r2];
            break;
        case INDEX_op_sub:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] - tmp[r2];
            break;
        case INDEX_op_mul:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] * tmp[r2];
            break;
        case INDEX_op_and:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] & tmp[r2];
            break;
        case INDEX_op_or:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] | tmp[r2];
            break;
        case INDEX_op_xor:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] ^ tmp[r2];
            break;
        case INDEX_op_andc:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] & ~tmp[r2];
            break;
        case INDEX_op_orc:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] | ~tmp[r2];
            break;
        case INDEX_op_eqv:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = ~(tmp[r1] ^ tmp[r2]);
            break;
        case INDEX_op_nand:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = ~(tmp[r1] & tmp[r2]);
            break;
        case INDEX_op_nor:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = ~(tmp[r1] | tmp[r2]);
            break;
        case INDEX_op_neg:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = -tmp[r1];
            break;
        case INDEX_op_not:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = ~tmp[r1];
            break;
        case INDEX_op_ctpop:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = ctpop64(tmp[r1]);
            break;
        case INDEX_op_muls2:
            {
                TCGReg r3;

                tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
                muls64(&tmp[r0], &tmp[r1], tmp[r2], tmp[r3]);
            }
            break;
        case INDEX_op_mulu2:
            {
                TCGReg r3;

                tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
                mulu64(&tmp[r0], &tmp[r1], tmp[r2], tmp[r3]);
            }
            break;
        case INDEX_op_ext_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = (int32_t)tmp[r1];
            break;
        case INDEX_op_extu_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = (uint32_t)tmp[r1];
            break;
        case INDEX_op_ld32u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(uint32_t *)ptr;
            break;
        case INDEX_op_ld32s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            tmp[r0] = *(int32_t *)ptr;
            break;
        case INDEX_op_st32:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(tmp[r1] + ofs);
            *(uint32_t *)ptr = tmp[r0];
            break;
        case INDEX_op_tci_clz32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = tmp[r1];
            tmp[r0] = tmp32 ? clz32(tmp32) : tmp[r2];
            break;
        case INDEX_op_tci_ctz32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = tmp[r1];
            tmp[r0] = tmp32 ? ctz32(tmp32) : tmp[r2];
            break;
        case INDEX_op_tci_setcond32:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            tmp[r0] = tci_wasm_subset_compare32(tmp[r1], tmp[r2], condition);
            break;
        case INDEX_op_tci_movcond32:
            {
                TCGReg r3, r4;

                tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
                tmp32 = tci_wasm_subset_compare32(tmp[r1], tmp[r2],
                                                  condition);
                tmp[r0] = tmp[tmp32 ? r3 : r4];
            }
            break;
        case INDEX_op_shl:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] << (tmp[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_shr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] >> (tmp[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_sar:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = (tcg_target_long)tmp[r1] >>
                      (tmp[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_tci_rotl32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = rol32(tmp[r1], tmp[r2] & 31);
            break;
        case INDEX_op_tci_rotr32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = ror32(tmp[r1], tmp[r2] & 31);
            break;
        case INDEX_op_rotl:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = rol64(tmp[r1], tmp[r2] & 63);
            break;
        case INDEX_op_rotr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = ror64(tmp[r1], tmp[r2] & 63);
            break;
        case INDEX_op_deposit:
            tci_args_rrrbb(insn, &r0, &r1, &r2, &pos, &len);
            tmp[r0] = deposit64(tmp[r1], pos, len, tmp[r2]);
            break;
        case INDEX_op_extract:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            tmp[r0] = extract64(tmp[r1], pos, len);
            break;
        case INDEX_op_sextract:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            tmp[r0] = sextract64(tmp[r1], pos, len);
            break;
        case INDEX_op_bswap16:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = bswap16(tmp[r1]);
            break;
        case INDEX_op_bswap32:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = bswap32(tmp[r1]);
            break;
        case INDEX_op_bswap64:
            tci_args_rr(insn, &r0, &r1);
            tmp[r0] = bswap64(tmp[r1]);
            break;
        case INDEX_op_clz:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] ? clz64(tmp[r1]) : tmp[r2];
            break;
        case INDEX_op_ctz:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp[r0] = tmp[r1] ? ctz64(tmp[r1]) : tmp[r2];
            break;
        case INDEX_op_mb:
            tci_mb();
            break;
        case INDEX_op_qemu_ld:
            tci_args_rrm(insn, &r0, &r1, &oi);
            taddr = tmp[r1];
            tmp[r0] = tci_qemu_ld((CPUArchState *)tmp[TCG_AREG0],
                                  taddr, oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_ld_rrr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            taddr = tmp[r1];
            oi = tmp[r2];
            tmp[r0] = tci_qemu_ld((CPUArchState *)tmp[TCG_AREG0],
                                  taddr, oi, tb_ptr);
            break;
        case INDEX_op_qemu_st:
            tci_args_rrm(insn, &r0, &r1, &oi);
            taddr = tmp[r1];
            tci_qemu_st((CPUArchState *)tmp[TCG_AREG0],
                        taddr, tmp[r0], oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_st_rrr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            taddr = tmp[r1];
            oi = tmp[r2];
            tci_qemu_st((CPUArchState *)tmp[TCG_AREG0],
                        taddr, tmp[r0], oi, tb_ptr);
            break;
        case INDEX_op_exit_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            memcpy(regs, tmp, sizeof(tmp));
            *ret = (uintptr_t)ptr;
            tci_wasm_subset_executed++;
            return TCI_WASM_SUBSET_EXIT;
        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            memcpy(regs, tmp, sizeof(tmp));
            *ret = *(uintptr_t *)ptr;
            tci_wasm_subset_executed++;
            return TCI_WASM_SUBSET_DISPATCH;
        case INDEX_op_goto_ptr:
            tci_args_r(insn, &r0);
            memcpy(regs, tmp, sizeof(tmp));
            *ret = tmp[r0];
            tci_wasm_subset_executed++;
            return *ret ? TCI_WASM_SUBSET_DISPATCH : TCI_WASM_SUBSET_EXIT;
        default:
            tci_wasm_subset_unsupported(entry, opc);
            return TCI_WASM_SUBSET_UNSUPPORTED;
        }
    }

    tci_wasm_subset_max_ops_rejected++;
    tci_wasm_subset_unsupported(entry, NB_OPS);
    return TCI_WASM_SUBSET_UNSUPPORTED;
}

#else
typedef enum TCIWasmSubsetStatus {
    TCI_WASM_SUBSET_UNSUPPORTED,
    TCI_WASM_SUBSET_EXIT,
    TCI_WASM_SUBSET_DISPATCH,
} TCIWasmSubsetStatus;

static TCIWasmSubsetStatus tci_wasm_subset_try_exec(const uint32_t *tb_start,
                                                    tcg_target_ulong *regs,
                                                    uintptr_t *ret)
{
    (void)tb_start;
    (void)regs;
    (void)ret;

    return TCI_WASM_SUBSET_UNSUPPORTED;
}
#endif

/* Interpret pseudo code in tb. */
/*
 * Disable CFI checks.
 * One possible operation in the pseudo code is a call to binary code.
 * Therefore, disable CFI checks in the interpreter function
 */
#ifdef CONFIG_TCG_WASM64_BACKEND
#define TCI_QEMU_TB_EXEC tcg_tci_qemu_tb_exec
#else
#define TCI_QEMU_TB_EXEC tcg_qemu_tb_exec
#endif

uintptr_t QEMU_DISABLE_CFI TCI_QEMU_TB_EXEC(CPUArchState *env,
                                            const void *v_tb_ptr)
{
    const uint32_t *tb_ptr = v_tb_ptr;
    tcg_target_ulong regs[TCG_TARGET_NB_REGS];
    uint64_t stack[(TCG_STATIC_CALL_ARGS_SIZE + TCG_STATIC_FRAME_SIZE)
                   / sizeof(uint64_t)];
    uintptr_t subset_ret;
    bool at_tb_start = true;
    bool carry = false;
    bool fast_gates = tci_fast_gates_enabled();
    bool perf_attrib_active = qemu_perf_attrib_enabled();
    bool progress_active = fast_gates && tci_progress_enabled();
    bool wasm_subset_active = fast_gates && tci_wasm_subset_enabled();

    regs[TCG_AREG0] = (tcg_target_ulong)env;
    regs[TCG_REG_CALL_STACK] = (uintptr_t)stack;
    tci_assert(tb_ptr);

    for (;;) {
        uint32_t insn;
        TCGOpcode opc;
        TCGReg r0, r1, r2, r3, r4;
        tcg_target_ulong t1;
        TCGCond condition;
        uint8_t pos, len;
        uint32_t tmp32;
        uint64_t taddr;
        MemOpIdx oi;
        int32_t ofs;
        void *ptr;

        if (at_tb_start) {
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_tb_entry();
            }
            if (fast_gates) {
                if (progress_active) {
                    tci_progress_tb_entry_active(tb_ptr);
                }
                if (wasm_subset_active) {
                    switch (tci_wasm_subset_try_exec(tb_ptr, regs,
                                                     &subset_ret)) {
                    case TCI_WASM_SUBSET_EXIT:
                        return subset_ret;
                    case TCI_WASM_SUBSET_DISPATCH:
                        tb_ptr = (const uint32_t *)subset_ret;
                        continue;
                    case TCI_WASM_SUBSET_UNSUPPORTED:
                        break;
                    default:
                        g_assert_not_reached();
                    }
                }
                at_tb_start = false;
            } else {
                tci_progress_tb_entry(tb_ptr);
                switch (tci_wasm_subset_try_exec(tb_ptr, regs, &subset_ret)) {
                case TCI_WASM_SUBSET_EXIT:
                    return subset_ret;
                case TCI_WASM_SUBSET_DISPATCH:
                    tb_ptr = (const uint32_t *)subset_ret;
                    continue;
                case TCI_WASM_SUBSET_UNSUPPORTED:
                    at_tb_start = false;
                    break;
                default:
                    g_assert_not_reached();
                }
            }
        }

        insn = *tb_ptr++;
        opc = extract32(insn, 0, 8);
        tcg_hotblocks_maybe_tci_op(opc);

        switch (opc) {
        case INDEX_op_call:
            {
                void *call_slots[MAX_CALL_IARGS];
                ffi_cif *cif;
                void *func;
                unsigned i, s, n;

                tci_args_nl(insn, tb_ptr, &len, &ptr);
                func = ((void **)ptr)[0];
                cif = ((void **)ptr)[1];

                n = cif->nargs;
                for (i = s = 0; i < n; ++i) {
                    ffi_type *t = cif->arg_types[i];
                    call_slots[i] = &stack[s];
                    s += DIV_ROUND_UP(t->size, 8);
                }

                /* Helper functions may need to access the "return address" */
                tci_tb_ptr = (uintptr_t)tb_ptr;
                if (perf_attrib_active) {
                    qemu_perf_attrib_tci_helper_call();
                }
                ffi_call(cif, func, stack, call_slots);
            }

            switch (len) {
            case 0: /* void */
                break;
            case 1: /* uint32_t */
                /*
                 * The result winds up "left-aligned" in the stack[0] slot.
                 * Note that libffi has an odd special case in that it will
                 * always widen an integral result to ffi_arg.
                 */
                if (sizeof(ffi_arg) == 8) {
                    regs[TCG_REG_R0] = (uint32_t)stack[0];
                } else {
                    regs[TCG_REG_R0] = *(uint32_t *)stack;
                }
                break;
            case 2: /* uint64_t */
                memcpy(&regs[TCG_REG_R0], stack, 8);
                break;
            case 3: /* Int128 */
                memcpy(&regs[TCG_REG_R0], stack, 16);
                break;
            default:
                g_assert_not_reached();
            }
            break;

        case INDEX_op_br:
            tci_args_l(insn, tb_ptr, &ptr);
            tb_ptr = ptr;
            continue;
        case INDEX_op_setcond:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            regs[r0] = tci_compare64(regs[r1], regs[r2], condition);
            break;
        case INDEX_op_movcond:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            tmp32 = tci_compare64(regs[r1], regs[r2], condition);
            regs[r0] = regs[tmp32 ? r3 : r4];
            break;
        case INDEX_op_mov:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = regs[r1];
            break;
        case INDEX_op_tci_movi:
            tci_args_ri(insn, &r0, &t1);
            regs[r0] = t1;
            break;
        case INDEX_op_tci_movl:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            regs[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_tci_setcarry:
            carry = true;
            break;

            /* Load/store operations (32 bit). */

        case INDEX_op_ld8u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint8_t *)ptr;
            break;
        case INDEX_op_ld8s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int8_t *)ptr;
            break;
        case INDEX_op_ld16u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint16_t *)ptr;
            break;
        case INDEX_op_ld16s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int16_t *)ptr;
            break;
        case INDEX_op_ld:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_st8:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint8_t *)ptr = regs[r0];
            break;
        case INDEX_op_st16:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint16_t *)ptr = regs[r0];
            break;
        case INDEX_op_st:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(tcg_target_ulong *)ptr = regs[r0];
            break;

            /* Arithmetic operations (mixed 32/64 bit). */

        case INDEX_op_add:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] + regs[r2];
            break;
        case INDEX_op_sub:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] - regs[r2];
            break;
        case INDEX_op_mul:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] * regs[r2];
            break;
        case INDEX_op_and:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] & regs[r2];
            break;
        case INDEX_op_or:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] | regs[r2];
            break;
        case INDEX_op_xor:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ^ regs[r2];
            break;
        case INDEX_op_andc:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] & ~regs[r2];
            break;
        case INDEX_op_orc:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] | ~regs[r2];
            break;
        case INDEX_op_eqv:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ~(regs[r1] ^ regs[r2]);
            break;
        case INDEX_op_nand:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ~(regs[r1] & regs[r2]);
            break;
        case INDEX_op_nor:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ~(regs[r1] | regs[r2]);
            break;
        case INDEX_op_neg:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = -regs[r1];
            break;
        case INDEX_op_not:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = ~regs[r1];
            break;
        case INDEX_op_ctpop:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = ctpop64(regs[r1]);
            break;
        case INDEX_op_addco:
            tci_args_rrr(insn, &r0, &r1, &r2);
            t1 = regs[r1] + regs[r2];
            carry = t1 < regs[r1];
            regs[r0] = t1;
            break;
        case INDEX_op_addci:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] + regs[r2] + carry;
            break;
        case INDEX_op_addcio:
            tci_args_rrr(insn, &r0, &r1, &r2);
            if (carry) {
                t1 = regs[r1] + regs[r2] + 1;
                carry = t1 <= regs[r1];
            } else {
                t1 = regs[r1] + regs[r2];
                carry = t1 < regs[r1];
            }
            regs[r0] = t1;
            break;
        case INDEX_op_subbo:
            tci_args_rrr(insn, &r0, &r1, &r2);
            carry = regs[r1] < regs[r2];
            regs[r0] = regs[r1] - regs[r2];
            break;
        case INDEX_op_subbi:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] - regs[r2] - carry;
            break;
        case INDEX_op_subbio:
            tci_args_rrr(insn, &r0, &r1, &r2);
            if (carry) {
                carry = regs[r1] <= regs[r2];
                regs[r0] = regs[r1] - regs[r2] - 1;
            } else {
                carry = regs[r1] < regs[r2];
                regs[r0] = regs[r1] - regs[r2];
            }
            break;
        case INDEX_op_muls2:
            tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
            muls64(&regs[r0], &regs[r1], regs[r2], regs[r3]);
            break;
        case INDEX_op_mulu2:
            tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
            mulu64(&regs[r0], &regs[r1], regs[r2], regs[r3]);
            break;

            /* Arithmetic operations (32 bit). */

        case INDEX_op_tci_divs32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] / (int32_t)regs[r2];
            break;
        case INDEX_op_tci_divu32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] / (uint32_t)regs[r2];
            break;
        case INDEX_op_tci_rems32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] % (int32_t)regs[r2];
            break;
        case INDEX_op_tci_remu32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] % (uint32_t)regs[r2];
            break;
        case INDEX_op_tci_clz32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = regs[r1];
            regs[r0] = tmp32 ? clz32(tmp32) : regs[r2];
            break;
        case INDEX_op_tci_ctz32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = regs[r1];
            regs[r0] = tmp32 ? ctz32(tmp32) : regs[r2];
            break;
        case INDEX_op_tci_setcond32:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            regs[r0] = tci_compare32(regs[r1], regs[r2], condition);
            break;
        case INDEX_op_tci_movcond32:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            tmp32 = tci_compare32(regs[r1], regs[r2], condition);
            regs[r0] = regs[tmp32 ? r3 : r4];
            break;

            /* Shift/rotate operations. */

        case INDEX_op_shl:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] << (regs[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_shr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] >> (regs[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_sar:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ((tcg_target_long)regs[r1]
                        >> (regs[r2] % TCG_TARGET_REG_BITS));
            break;
        case INDEX_op_tci_rotl32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = rol32(regs[r1], regs[r2] & 31);
            break;
        case INDEX_op_tci_rotr32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ror32(regs[r1], regs[r2] & 31);
            break;
        case INDEX_op_deposit:
            tci_args_rrrbb(insn, &r0, &r1, &r2, &pos, &len);
            regs[r0] = deposit64(regs[r1], pos, len, regs[r2]);
            break;
        case INDEX_op_extract:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = extract64(regs[r1], pos, len);
            break;
        case INDEX_op_sextract:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = sextract64(regs[r1], pos, len);
            break;
        case INDEX_op_brcond:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if (regs[r0]) {
                tb_ptr = ptr;
            }
            break;
        case INDEX_op_bswap16:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = bswap16(regs[r1]);
            break;
        case INDEX_op_bswap32:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = bswap32(regs[r1]);
            break;

            /* Load/store operations (64 bit). */

        case INDEX_op_ld32u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint32_t *)ptr;
            break;
        case INDEX_op_ld32s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int32_t *)ptr;
            break;
        case INDEX_op_st32:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint32_t *)ptr = regs[r0];
            break;

            /* Arithmetic operations (64 bit). */

        case INDEX_op_divs:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] / (int64_t)regs[r2];
            break;
        case INDEX_op_divu:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint64_t)regs[r1] / (uint64_t)regs[r2];
            break;
        case INDEX_op_rems:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] % (int64_t)regs[r2];
            break;
        case INDEX_op_remu:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint64_t)regs[r1] % (uint64_t)regs[r2];
            break;
        case INDEX_op_clz:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ? clz64(regs[r1]) : regs[r2];
            break;
        case INDEX_op_ctz:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ? ctz64(regs[r1]) : regs[r2];
            break;

            /* Shift/rotate operations (64 bit). */

        case INDEX_op_rotl:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = rol64(regs[r1], regs[r2] & 63);
            break;
        case INDEX_op_rotr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ror64(regs[r1], regs[r2] & 63);
            break;
        case INDEX_op_ext_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (int32_t)regs[r1];
            break;
        case INDEX_op_extu_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (uint32_t)regs[r1];
            break;
        case INDEX_op_bswap64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = bswap64(regs[r1]);
            break;

            /* QEMU specific operations. */

        case INDEX_op_exit_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            return (uintptr_t)ptr;

        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            tb_ptr = *(void **)ptr;
            if (progress_active) {
                tci_progress_dispatch_active();
            } else if (!fast_gates) {
                tci_progress_dispatch();
            }
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_dispatch();
            }
            at_tb_start = true;
            break;

        case INDEX_op_goto_ptr:
            tci_args_r(insn, &r0);
            ptr = (void *)regs[r0];
            if (!ptr) {
                return 0;
            }
            tb_ptr = ptr;
            if (progress_active) {
                tci_progress_dispatch_active();
            } else if (!fast_gates) {
                tci_progress_dispatch();
            }
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_dispatch();
            }
            at_tb_start = true;
            break;

        case INDEX_op_qemu_ld:
            tci_args_rrm(insn, &r0, &r1, &oi);
            taddr = regs[r1];
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_qemu_load();
            }
            regs[r0] = tci_qemu_ld(env, taddr, oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_ld_rrr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            taddr = regs[r1];
            oi = regs[r2];
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_qemu_load();
            }
            regs[r0] = tci_qemu_ld(env, taddr, oi, tb_ptr);
            break;

        case INDEX_op_qemu_st:
            tci_args_rrm(insn, &r0, &r1, &oi);
            taddr = regs[r1];
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_qemu_store();
            }
            tci_qemu_st(env, taddr, regs[r0], oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_st_rrr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            taddr = regs[r1];
            oi = regs[r2];
            if (perf_attrib_active) {
                qemu_perf_attrib_tci_qemu_store();
            }
            tci_qemu_st(env, taddr, regs[r0], oi, tb_ptr);
            break;

        case INDEX_op_mb:
            /* Ensure ordering for all kinds */
            tci_mb();
            break;
        default:
            g_assert_not_reached();
        }
    }
}

/*
 * Disassembler that matches the interpreter
 */

static const char *str_r(TCGReg r)
{
    static const char regs[TCG_TARGET_NB_REGS][4] = {
        "r0", "r1", "r2",  "r3",  "r4",  "r5",  "r6",  "r7",
        "r8", "r9", "r10", "r11", "r12", "r13", "env", "sp"
    };

    QEMU_BUILD_BUG_ON(TCG_AREG0 != TCG_REG_R14);
    QEMU_BUILD_BUG_ON(TCG_REG_CALL_STACK != TCG_REG_R15);

    assert((unsigned)r < TCG_TARGET_NB_REGS);
    return regs[r];
}

static const char *str_c(TCGCond c)
{
    static const char cond[16][8] = {
        [TCG_COND_NEVER] = "never",
        [TCG_COND_ALWAYS] = "always",
        [TCG_COND_EQ] = "eq",
        [TCG_COND_NE] = "ne",
        [TCG_COND_LT] = "lt",
        [TCG_COND_GE] = "ge",
        [TCG_COND_LE] = "le",
        [TCG_COND_GT] = "gt",
        [TCG_COND_LTU] = "ltu",
        [TCG_COND_GEU] = "geu",
        [TCG_COND_LEU] = "leu",
        [TCG_COND_GTU] = "gtu",
        [TCG_COND_TSTEQ] = "tsteq",
        [TCG_COND_TSTNE] = "tstne",
    };

    assert((unsigned)c < ARRAY_SIZE(cond));
    assert(cond[c][0] != 0);
    return cond[c];
}

/* Disassemble TCI bytecode. */
int print_insn_tci(bfd_vma addr, disassemble_info *info)
{
    const uint32_t *tb_ptr = (const void *)(uintptr_t)addr;
    const TCGOpDef *def;
    const char *op_name;
    uint32_t insn;
    TCGOpcode op;
    TCGReg r0, r1, r2, r3, r4;
    tcg_target_ulong i1;
    int32_t s2;
    TCGCond c;
    MemOpIdx oi;
    uint8_t pos, len;
    void *ptr;

    /* TCI is always the host, so we don't need to load indirect. */
    insn = *tb_ptr++;

    info->fprintf_func(info->stream, "%08x  ", insn);

    op = extract32(insn, 0, 8);
    def = &tcg_op_defs[op];
    op_name = def->name;

    switch (op) {
    case INDEX_op_br:
    case INDEX_op_exit_tb:
    case INDEX_op_goto_tb:
        tci_args_l(insn, tb_ptr, &ptr);
        info->fprintf_func(info->stream, "%-12s  %p", op_name, ptr);
        break;

    case INDEX_op_goto_ptr:
        tci_args_r(insn, &r0);
        info->fprintf_func(info->stream, "%-12s  %s", op_name, str_r(r0));
        break;

    case INDEX_op_call:
        tci_args_nl(insn, tb_ptr, &len, &ptr);
        info->fprintf_func(info->stream, "%-12s  %d, %p", op_name, len, ptr);
        break;

    case INDEX_op_brcond:
        tci_args_rl(insn, tb_ptr, &r0, &ptr);
        info->fprintf_func(info->stream, "%-12s  %s, 0, ne, %p",
                           op_name, str_r(r0), ptr);
        break;

    case INDEX_op_setcond:
    case INDEX_op_tci_setcond32:
        tci_args_rrrc(insn, &r0, &r1, &r2, &c);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s, %s",
                           op_name, str_r(r0), str_r(r1), str_r(r2), str_c(c));
        break;

    case INDEX_op_tci_movi:
        tci_args_ri(insn, &r0, &i1);
        info->fprintf_func(info->stream, "%-12s  %s, 0x%" TCG_PRIlx,
                           op_name, str_r(r0), i1);
        break;

    case INDEX_op_tci_movl:
        tci_args_rl(insn, tb_ptr, &r0, &ptr);
        info->fprintf_func(info->stream, "%-12s  %s, %p",
                           op_name, str_r(r0), ptr);
        break;

    case INDEX_op_tci_setcarry:
        info->fprintf_func(info->stream, "%-12s", op_name);
        break;

    case INDEX_op_ld8u:
    case INDEX_op_ld8s:
    case INDEX_op_ld16u:
    case INDEX_op_ld16s:
    case INDEX_op_ld32u:
    case INDEX_op_ld:
    case INDEX_op_st8:
    case INDEX_op_st16:
    case INDEX_op_st32:
    case INDEX_op_st:
        tci_args_rrs(insn, &r0, &r1, &s2);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %d",
                           op_name, str_r(r0), str_r(r1), s2);
        break;

    case INDEX_op_bswap16:
    case INDEX_op_bswap32:
    case INDEX_op_ctpop:
    case INDEX_op_mov:
    case INDEX_op_neg:
    case INDEX_op_not:
    case INDEX_op_ext_i32_i64:
    case INDEX_op_extu_i32_i64:
    case INDEX_op_bswap64:
        tci_args_rr(insn, &r0, &r1);
        info->fprintf_func(info->stream, "%-12s  %s, %s",
                           op_name, str_r(r0), str_r(r1));
        break;

    case INDEX_op_add:
    case INDEX_op_addci:
    case INDEX_op_addcio:
    case INDEX_op_addco:
    case INDEX_op_and:
    case INDEX_op_andc:
    case INDEX_op_clz:
    case INDEX_op_ctz:
    case INDEX_op_divs:
    case INDEX_op_divu:
    case INDEX_op_eqv:
    case INDEX_op_mul:
    case INDEX_op_nand:
    case INDEX_op_nor:
    case INDEX_op_or:
    case INDEX_op_orc:
    case INDEX_op_rems:
    case INDEX_op_remu:
    case INDEX_op_rotl:
    case INDEX_op_rotr:
    case INDEX_op_sar:
    case INDEX_op_shl:
    case INDEX_op_shr:
    case INDEX_op_sub:
    case INDEX_op_subbi:
    case INDEX_op_subbio:
    case INDEX_op_subbo:
    case INDEX_op_xor:
    case INDEX_op_tci_ctz32:
    case INDEX_op_tci_clz32:
    case INDEX_op_tci_divs32:
    case INDEX_op_tci_divu32:
    case INDEX_op_tci_rems32:
    case INDEX_op_tci_remu32:
    case INDEX_op_tci_rotl32:
    case INDEX_op_tci_rotr32:
        tci_args_rrr(insn, &r0, &r1, &r2);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s",
                           op_name, str_r(r0), str_r(r1), str_r(r2));
        break;

    case INDEX_op_deposit:
        tci_args_rrrbb(insn, &r0, &r1, &r2, &pos, &len);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s, %d, %d",
                           op_name, str_r(r0), str_r(r1), str_r(r2), pos, len);
        break;

    case INDEX_op_extract:
    case INDEX_op_sextract:
        tci_args_rrbb(insn, &r0, &r1, &pos, &len);
        info->fprintf_func(info->stream, "%-12s  %s,%s,%d,%d",
                           op_name, str_r(r0), str_r(r1), pos, len);
        break;

    case INDEX_op_tci_movcond32:
    case INDEX_op_movcond:
        tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &c);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s, %s, %s, %s",
                           op_name, str_r(r0), str_r(r1), str_r(r2),
                           str_r(r3), str_r(r4), str_c(c));
        break;

    case INDEX_op_muls2:
    case INDEX_op_mulu2:
        tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s, %s",
                           op_name, str_r(r0), str_r(r1),
                           str_r(r2), str_r(r3));
        break;

    case INDEX_op_qemu_ld:
    case INDEX_op_qemu_st:
        tci_args_rrm(insn, &r0, &r1, &oi);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %x",
                           op_name, str_r(r0), str_r(r1), oi);
        break;

    case INDEX_op_tci_qemu_ld_rrr:
    case INDEX_op_tci_qemu_st_rrr:
        tci_args_rrr(insn, &r0, &r1, &r2);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s",
                           op_name, str_r(r0), str_r(r1), str_r(r2));
        break;

    case INDEX_op_qemu_ld2:
    case INDEX_op_qemu_st2:
        tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
        info->fprintf_func(info->stream, "%-12s  %s, %s, %s, %s",
                           op_name, str_r(r0), str_r(r1),
                           str_r(r2), str_r(r3));
        break;

    case 0:
        /* tcg_out_nop_fill uses zeros */
        if (insn == 0) {
            info->fprintf_func(info->stream, "align");
            break;
        }
        /* fall through */

    default:
        info->fprintf_func(info->stream, "illegal opcode %d", op);
        break;
    }

    return sizeof(insn);
}
