/*
 * TCG hot-block instrumentation.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"
#include "tcg/hotblocks.h"

#ifdef CONFIG_EMSCRIPTEN
#include <emscripten/emscripten.h>
#endif

#define HOTBLOCK_SLOTS 4096
#define HOTBLOCK_DEFAULT_INTERVAL 10000
#define HOTBLOCK_DEFAULT_TOP 12
#define HOTBLOCK_MAX_TOP 64
#define HOTBLOCK_DEFAULT_OP_SAMPLE 1
#define HOTBLOCK_DEFAULT_OP_LIMIT (128ULL * 1024 * 1024)

typedef struct HotBlockEntry {
    bool used;
    vaddr pc;
    uint64_t cs_base;
    uint32_t flags;
    uint32_t cflags;
    uint16_t size;
    uint16_t icount;
    uint64_t execs;
    uint64_t exits[4];
} HotBlockEntry;

typedef struct HotBlockState {
    bool initialized;
    bool enabled;
    uint64_t interval;
    unsigned top_limit;
    uint64_t total_tb_execs;
    uint64_t unique_tbs;
    uint64_t dropped_tbs;
    uint64_t next_report;
    HotBlockEntry blocks[HOTBLOCK_SLOTS];
} HotBlockState;

static HotBlockState hotblocks;
bool tcg_hotblocks_active;
bool tcg_hotblocks_checked;
uint64_t tcg_hotblocks_op_counts[NB_OPS];
uint64_t tcg_hotblocks_total_ops;
uint64_t tcg_hotblocks_op_sample = HOTBLOCK_DEFAULT_OP_SAMPLE;
uint64_t tcg_hotblocks_op_sample_counter;
uint64_t tcg_hotblocks_op_limit = HOTBLOCK_DEFAULT_OP_LIMIT;
bool tcg_hotblocks_op_active;

#ifdef CONFIG_EMSCRIPTEN
#define HOTBLOCKS_WASM_ENV_FILE "/qemu-tcg-hotblocks-env"

EM_JS(char *, hotblocks_wasm_getenv, (const char *name), {
    const key = UTF8ToString(Number(name));
    const env = Module["qemuWasmHotBlocksEnv"] ||
        globalThis.qemuWasmHotBlocksEnv ||
        {};
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

static char *hotblocks_wasm_file_getenv(const char *name)
{
    g_autofree char *contents = NULL;
    const char *line;
    size_t name_len = strlen(name);

    if (!g_file_get_contents(HOTBLOCKS_WASM_ENV_FILE, &contents, NULL, NULL)) {
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

static const char *hotblocks_getenv(const char *name, char **owned)
{
    const char *value = g_getenv(name);

    *owned = NULL;
#ifdef CONFIG_EMSCRIPTEN
    if (value == NULL) {
        *owned = hotblocks_wasm_getenv(name);
        value = *owned;
    }
    if (value == NULL) {
        *owned = hotblocks_wasm_file_getenv(name);
        value = *owned;
    }
#endif
    return value;
}

static uint64_t parse_u64_env(const char *name, uint64_t fallback,
                              uint64_t min, uint64_t max)
{
    char *owned;
    const char *raw = hotblocks_getenv(name, &owned);
    uint64_t value;
    char *end = NULL;

    if (raw == NULL || raw[0] == '\0') {
        free(owned);
        return fallback;
    }
    value = g_ascii_strtoull(raw, &end, 10);
    if (end == raw || (end && *end != '\0') || value < min || value > max) {
        free(owned);
        return fallback;
    }
    free(owned);
    return value;
}

static void hotblocks_report(const char *reason);

static void hotblocks_atexit(void)
{
    if (hotblocks.initialized && hotblocks.enabled &&
        hotblocks.total_tb_execs) {
        hotblocks_report("exit");
    }
}

static void hotblocks_init(void)
{
    const char *enabled;
    char *owned;

    if (hotblocks.initialized) {
        return;
    }
    hotblocks.initialized = true;
    tcg_hotblocks_checked = true;
    enabled = hotblocks_getenv("QEMU_TCG_HOTBLOCKS", &owned);
    hotblocks.enabled = enabled != NULL &&
        (g_strcmp0(enabled, "1") == 0 ||
         g_ascii_strcasecmp(enabled, "true") == 0 ||
         g_ascii_strcasecmp(enabled, "yes") == 0 ||
         g_ascii_strcasecmp(enabled, "on") == 0);
    free(owned);
    if (!hotblocks.enabled) {
        return;
    }
    tcg_hotblocks_active = true;
    hotblocks.interval = parse_u64_env("QEMU_TCG_HOTBLOCKS_INTERVAL",
                                       HOTBLOCK_DEFAULT_INTERVAL, 1,
                                       UINT64_MAX / 2);
    hotblocks.top_limit = parse_u64_env("QEMU_TCG_HOTBLOCKS_TOP",
                                        HOTBLOCK_DEFAULT_TOP, 1,
                                        HOTBLOCK_MAX_TOP);
    tcg_hotblocks_op_sample =
        parse_u64_env("QEMU_TCG_HOTBLOCKS_OP_SAMPLE",
                      HOTBLOCK_DEFAULT_OP_SAMPLE, 1, UINT32_MAX);
    tcg_hotblocks_op_limit =
        parse_u64_env("QEMU_TCG_HOTBLOCKS_OP_LIMIT",
                      HOTBLOCK_DEFAULT_OP_LIMIT, 0, UINT64_MAX);
    tcg_hotblocks_op_active = true;
    hotblocks.next_report = hotblocks.interval;
    atexit(hotblocks_atexit);
}

bool tcg_hotblocks_enabled(void)
{
    hotblocks_init();
    return hotblocks.enabled;
}

static uint64_t hotblock_hash(const TranslationBlock *tb)
{
    uint64_t h = (uint64_t)tb->pc;

    h ^= tb->cs_base + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
    h ^= ((uint64_t)tb->flags << 32) | tb_cflags(tb);
    h ^= (uintptr_t)tb->tc.ptr >> 4;
    return h;
}

static HotBlockEntry *hotblock_lookup(const TranslationBlock *tb)
{
    uint64_t hash = hotblock_hash(tb);
    unsigned start = hash % HOTBLOCK_SLOTS;

    for (unsigned i = 0; i < HOTBLOCK_SLOTS; i++) {
        HotBlockEntry *entry = &hotblocks.blocks[(start + i) % HOTBLOCK_SLOTS];

        if (!entry->used) {
            entry->used = true;
            entry->pc = tb->pc;
            entry->cs_base = tb->cs_base;
            entry->flags = tb->flags;
            entry->cflags = tb_cflags(tb);
            entry->size = tb->size;
            entry->icount = tb->icount;
            hotblocks.unique_tbs++;
            return entry;
        }
        if (entry->pc == tb->pc &&
            entry->cs_base == tb->cs_base &&
            entry->flags == tb->flags &&
            entry->cflags == tb_cflags(tb) &&
            entry->size == tb->size &&
            entry->icount == tb->icount) {
            return entry;
        }
    }

    hotblocks.dropped_tbs++;
    return NULL;
}

static void top_insert(HotBlockEntry **top, unsigned limit,
                       HotBlockEntry *entry)
{
    unsigned pos;

    if (entry->execs == 0) {
        return;
    }
    for (pos = 0; pos < limit; pos++) {
        if (top[pos] == NULL || entry->execs > top[pos]->execs) {
            break;
        }
    }
    if (pos == limit) {
        return;
    }
    for (unsigned i = limit - 1; i > pos; i--) {
        top[i] = top[i - 1];
    }
    top[pos] = entry;
}

static void op_top_insert(TCGOpcode *ops, unsigned limit, TCGOpcode opc)
{
    unsigned pos;

    if (tcg_hotblocks_op_counts[opc] == 0) {
        return;
    }
    for (pos = 0; pos < limit; pos++) {
        if (ops[pos] == NB_OPS ||
            tcg_hotblocks_op_counts[opc] > tcg_hotblocks_op_counts[ops[pos]]) {
            break;
        }
    }
    if (pos == limit) {
        return;
    }
    for (unsigned i = limit - 1; i > pos; i--) {
        ops[i] = ops[i - 1];
    }
    ops[pos] = opc;
}

static void hotblocks_report_blocks(HotBlockEntry **top, unsigned limit)
{
    fprintf(stderr, "\"top_blocks\":[");
    for (unsigned i = 0; i < limit && top[i] != NULL; i++) {
        const HotBlockEntry *entry = top[i];

        fprintf(stderr,
                "%s{\"pc\":\"0x%016" PRIx64 "\",\"cs_base\":\"0x%016" PRIx64
                "\",\"flags\":\"0x%08x\",\"cflags\":\"0x%08x\","
                "\"size\":%u,\"icount\":%u,\"execs\":%" PRIu64
                ",\"exit0\":%" PRIu64 ",\"exit1\":%" PRIu64
                ",\"exit2\":%" PRIu64 ",\"exit3\":%" PRIu64 "}",
                i == 0 ? "" : ",",
                (uint64_t)entry->pc,
                entry->cs_base,
                entry->flags,
                entry->cflags,
                entry->size,
                entry->icount,
                entry->execs,
                entry->exits[0],
                entry->exits[1],
                entry->exits[2],
                entry->exits[3]);
    }
    fprintf(stderr, "]");
}

static void hotblocks_report_ops(TCGOpcode *ops, unsigned limit)
{
    fprintf(stderr, "\"top_tci_ops\":[");
    for (unsigned i = 0; i < limit && ops[i] != NB_OPS; i++) {
        TCGOpcode opc = ops[i];
        const char *name =
            opc < tcg_op_defs_max ? tcg_op_defs[opc].name : "unknown";

        fprintf(stderr,
                "%s{\"op\":\"%s\",\"count\":%" PRIu64 "}",
                i == 0 ? "" : ",",
                name,
                tcg_hotblocks_op_counts[opc]);
    }
    fprintf(stderr, "]");
}

static uint64_t hotblocks_op_count_by_name(const char *name)
{
    for (TCGOpcode opc = 0; opc < NB_OPS; opc++) {
        if (opc < tcg_op_defs_max &&
            g_strcmp0(tcg_op_defs[opc].name, name) == 0) {
            return tcg_hotblocks_op_counts[opc];
        }
    }
    return 0;
}

static uint64_t hotblocks_op_count_by_prefix(const char *prefix)
{
    uint64_t count = 0;

    for (TCGOpcode opc = 0; opc < NB_OPS; opc++) {
        if (opc < tcg_op_defs_max &&
            g_str_has_prefix(tcg_op_defs[opc].name, prefix)) {
            count += tcg_hotblocks_op_counts[opc];
        }
    }
    return count;
}

static void hotblocks_report(const char *reason)
{
    HotBlockEntry *top[HOTBLOCK_MAX_TOP] = { 0 };
    TCGOpcode top_ops[HOTBLOCK_MAX_TOP];
    unsigned limit = hotblocks.top_limit;
    uint64_t qemu_loads;
    uint64_t qemu_stores;

    for (unsigned i = 0; i < limit; i++) {
        top_ops[i] = NB_OPS;
    }
    for (unsigned i = 0; i < HOTBLOCK_SLOTS; i++) {
        if (hotblocks.blocks[i].used) {
            top_insert(top, limit, &hotblocks.blocks[i]);
        }
    }
    for (TCGOpcode opc = 0; opc < NB_OPS; opc++) {
        op_top_insert(top_ops, limit, opc);
    }
    qemu_loads = hotblocks_op_count_by_prefix("qemu_ld") +
        hotblocks_op_count_by_prefix("tci_qemu_ld");
    qemu_stores = hotblocks_op_count_by_prefix("qemu_st") +
        hotblocks_op_count_by_prefix("tci_qemu_st");

    fprintf(stderr,
            "qemu-tcg-hotblocks: {\"format\":1,\"event\":\"summary\","
            "\"reason\":\"%s\",\"tb_execs\":%" PRIu64
            ",\"unique_tbs\":%" PRIu64 ",\"dropped_tbs\":%" PRIu64
            ",\"tci_ops\":%" PRIu64 ",\"op_sample\":%" PRIu64
            ",\"op_limit\":%" PRIu64 ",\"op_active\":%s"
            ",\"helper_calls\":%" PRIu64
            ",\"qemu_loads\":%" PRIu64 ",\"qemu_stores\":%" PRIu64 ",",
            reason,
            hotblocks.total_tb_execs,
            hotblocks.unique_tbs,
            hotblocks.dropped_tbs,
            tcg_hotblocks_total_ops,
            tcg_hotblocks_op_sample,
            tcg_hotblocks_op_limit,
            tcg_hotblocks_op_active ? "true" : "false",
            hotblocks_op_count_by_name("call"),
            qemu_loads,
            qemu_stores);
    hotblocks_report_blocks(top, limit);
    fprintf(stderr, ",");
    hotblocks_report_ops(top_ops, limit);
    fprintf(stderr, "}\n");
}

void tcg_hotblocks_tb_exec(const TranslationBlock *tb, int tb_exit)
{
    HotBlockEntry *entry;

    if (!tcg_hotblocks_enabled()) {
        return;
    }
    hotblocks.total_tb_execs++;
    entry = hotblock_lookup(tb);
    if (entry != NULL) {
        entry->execs++;
        if (tb_exit >= 0 && tb_exit < ARRAY_SIZE(entry->exits)) {
            entry->exits[tb_exit]++;
        }
    }
    if (hotblocks.total_tb_execs >= hotblocks.next_report) {
        hotblocks_report("interval");
        hotblocks.next_report = hotblocks.total_tb_execs + hotblocks.interval;
    }
}
