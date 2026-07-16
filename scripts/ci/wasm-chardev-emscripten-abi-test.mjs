#!/usr/bin/env node
/*
 * Compile and execute the Emscripten-facing char-wasm cancellation ABI.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const root = process.env.QEMU_TEST_ROOT || ownRoot;
const sourcePath = join(root, "chardev/char-wasm.c");
const source = readFileSync(sourcePath, "utf8");
const required = [
  "pending_input_token",
  "pending_input_cancellable",
  "pending_input_started",
  "qemu_wasm_chardev_pending_input_token",
  "qemu_wasm_chardev_cancel_pending_input",
];
for (const symbol of required) {
  assert.ok(source.includes(symbol), `production source must provide ${symbol}`);
}

const tmp = mkdtempSync(join(tmpdir(), "qemu-wasm-chardev-abi-"));
const stub = join(tmp, "wasm-chardev-abi-stubs.h");
const harness = join(tmp, "abi.c");
const binary = join(tmp, "abi-test");
const includeSource = sourcePath.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const stubSource = String.raw`/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef WASM_CHARDEV_ABI_STUBS_H
#define WASM_CHARDEV_ABI_STUBS_H
#include <assert.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define g_autofree
#define g_malloc0(size) calloc(1, (size))
#define g_malloc(size) malloc(size)
#define g_free(ptr) free(ptr)
#define g_strdup(text) strdup(text)
#define g_new0(type, count) ((type *)calloc((count), sizeof(type)))
#define g_strcmp0(left, right) strcmp((left), (right))
#define g_steal_pointer(ptr) ({ __typeof__(*(ptr)) value = *(ptr); *(ptr) = NULL; value; })
#define g_clear_pointer(ptr, destroy) do { if (*(ptr)) { destroy(*(ptr)); *(ptr) = NULL; } } while (0)
#define MIN(a, b) ((a) < (b) ? (a) : (b))

typedef struct GList { void *data; struct GList *next; } GList;
static inline GList *g_list_prepend(GList *list, void *data) {
    GList *entry = malloc(sizeof(*entry));
    entry->data = data; entry->next = list; return entry;
}
static inline GList *g_list_remove(GList *list, void *data) {
    GList **entry = &list;
    while (*entry) {
        if ((*entry)->data == data) {
            GList *removed = *entry; *entry = removed->next; free(removed); break;
        }
        entry = &(*entry)->next;
    }
    return list;
}

typedef int QemuMutex;
typedef struct QEMUTimer { int unused; } QEMUTimer;
typedef struct Chardev { const char *label; } Chardev;
typedef struct Object { int unused; } Object;
typedef struct ObjectClass { int unused; } ObjectClass;
typedef struct Error Error;
typedef struct QemuOpts QemuOpts;
typedef struct ChardevBackend ChardevBackend;
typedef struct ChardevClass ChardevClass;
typedef struct TypeInfo TypeInfo;
typedef struct ChardevWasm {
    char *channel; bool has_max_payload; uint64_t max_payload;
} ChardevWasm;
struct ChardevBackend {
    int type; union { struct { ChardevWasm *data; } wasm; } u;
};
struct ChardevClass {
    void (*chr_parse)(QemuOpts *, ChardevBackend *, Error **);
    bool (*chr_open)(Chardev *, ChardevBackend *, Error **);
    int (*chr_write)(Chardev *, const uint8_t *, int);
    void (*chr_accept_input)(Chardev *);
};
struct TypeInfo {
    const char *name; const char *parent;
    void (*class_init)(ObjectClass *, const void *);
    size_t instance_size; void (*instance_init)(Object *);
    void (*instance_finalize)(Object *);
};
typedef enum QemuWasmChardevCancelStatus {
    QEMU_WASM_CHARDEV_CANCEL_NONE = 0,
    QEMU_WASM_CHARDEV_CANCEL_UNDELIVERED = 1,
    QEMU_WASM_CHARDEV_CANCEL_PARTIAL = 2,
} QemuWasmChardevCancelStatus;

extern int abi_can_write;
extern uint8_t abi_delivered[16384];
extern int abi_delivered_len;
static inline void qemu_mutex_init(QemuMutex *lock) { (void)lock; }
static inline void qemu_mutex_destroy(QemuMutex *lock) { (void)lock; }
static inline void qemu_mutex_lock(QemuMutex *lock) { (void)lock; }
static inline void qemu_mutex_unlock(QemuMutex *lock) { (void)lock; }
static inline QEMUTimer *timer_new_ms(int clock, void (*cb)(void *), void *opaque) {
    (void)clock; (void)cb; (void)opaque; return calloc(1, sizeof(QEMUTimer));
}
static inline void timer_free(QEMUTimer *timer) { free(timer); }
static inline void timer_mod(QEMUTimer *timer, int64_t when) { (void)timer; (void)when; }
static inline void timer_del(QEMUTimer *timer) { (void)timer; }
static inline int64_t qemu_clock_get_ms(int clock) { (void)clock; return 0; }
static inline void qemu_notify_event(void) {}
static inline int qemu_chr_be_can_write(Chardev *chr) { (void)chr; return abi_can_write; }
static inline void qemu_chr_be_write(Chardev *chr, const uint8_t *buf, int len) {
    (void)chr; memcpy(abi_delivered + abi_delivered_len, buf, len);
    abi_delivered_len += len; abi_can_write -= len;
}
static inline void qemu_chr_be_event(Chardev *chr, int event) { (void)chr; (void)event; }
static inline void qemu_chr_parse_common(QemuOpts *opts, void *base) { (void)opts; (void)base; }
static inline const char *qemu_opt_get(QemuOpts *opts, const char *name) { (void)opts; (void)name; return NULL; }
static inline uint64_t qemu_opt_get_size(QemuOpts *opts, const char *name, uint64_t value) {
    (void)opts; (void)name; return value;
}
static inline void error_setg(Error **errp, const char *format, ...) { (void)errp; (void)format; }

#define qatomic_read(ptr) (*(ptr))
#define qatomic_cmpxchg(ptr, old, value) ({ __typeof__(*(ptr)) previous = *(ptr); if (previous == (old)) { *(ptr) = (value); } previous; })
#define DECLARE_INSTANCE_CHECKER(type, name, typename) static inline type *name(void *object) { return (type *)object; }
#define CHARDEV(object) ((Chardev *)(object))
#define CHARDEV_CLASS(object) ((ChardevClass *)(object))
#define qapi_ChardevWasm_base(wasm) (wasm)
#define EM_JS(return_type, name, params, ...) return_type name params
#define EMSCRIPTEN_KEEPALIVE
#define MAIN_THREAD_EM_ASM(...) ((void)0)
#define QEMU_CLOCK_REALTIME 0
#define CHR_EVENT_OPENED 0
#define CHARDEV_BACKEND_KIND_WASM 0
#define TYPE_CHARDEV_WASM "chardev-wasm"
#define TYPE_CHARDEV "chardev"
#define type_register_static(info) ((void)(info))
#define type_init(function)
#endif
`;

const harnessSource = `#define WASM_CHARDEV_ABI_TEST\n#include "${includeSource}"\n` + String.raw`
int abi_can_write;
uint8_t abi_delivered[16384];
int abi_delivered_len;
static const char *abi_channel = "service";
static const char *abi_text = "";
static WasmChardev abi_chardev;

int wasm_chardev_pending_channel_len(void) { return strlen(abi_channel) + 1; }
void wasm_chardev_copy_pending_channel(char *buf, int len) {
    snprintf(buf, len, "%s", abi_channel);
}
int wasm_chardev_pending_data_len(void) { return strlen(abi_text); }
void wasm_chardev_copy_pending_data(uint8_t *buf, int len) { memcpy(buf, abi_text, len); }

static void reset_abi(void) {
    if (abi_chardev.pending_input) { wasm_chr_clear_pending_input(&abi_chardev); }
    if (wasm_chardevs) { wasm_chardevs = g_list_remove(wasm_chardevs, &abi_chardev); }
    timer_free(abi_chardev.flush_timer);
    free(abi_chardev.channel);
    memset(&abi_chardev, 0, sizeof(abi_chardev));
    abi_chardev.channel = strdup("service");
    abi_chardev.max_payload = 4096;
    wasm_chr_init((Object *)&abi_chardev);
    wasm_chardevs = g_list_prepend(NULL, &abi_chardev);
    wasm_chardev_next_input_token = 0;
    abi_can_write = 0;
    abi_delivered_len = 0;
}

static int write_text(const char *text) {
    abi_text = text;
    return qemu_wasm_chardev_write_pending();
}

static void expect_bytes(const uint8_t *expected, int expected_len) {
    assert(abi_delivered_len == expected_len);
    assert(memcmp(abi_delivered, expected, expected_len) == 0);
}

int main(void) {
    static const char request[] =
        "{\\\"operation\\\":\\\"health\\\",\\\"id\\\":\\\"cancel-me\\\",\\\"deadlineMs\\\":1}\\n";
    static const char next[] =
        "{\\\"operation\\\":\\\"health\\\",\\\"id\\\":\\\"next\\\",\\\"deadlineMs\\\":2}\\n";
    const int cuts[] = { 1, (int)sizeof(request) / 2, (int)sizeof(request) - 2 };

    reset_abi();
    assert(write_text("abc") == 3);
    uint64_t token = qemu_wasm_chardev_pending_input_token();
    assert(token == 1);
    assert(qemu_wasm_chardev_cancel_pending_input(token + 1) == QEMU_WASM_CHARDEV_CANCEL_NONE);
    assert(qemu_wasm_chardev_cancel_pending_input(token) == QEMU_WASM_CHARDEV_CANCEL_UNDELIVERED);
    assert(qemu_wasm_chardev_pending_input_token() == 0);
    assert(qemu_wasm_chardev_cancel_pending_input(token) == QEMU_WASM_CHARDEV_CANCEL_NONE);

    for (size_t index = 0; index < sizeof(cuts) / sizeof(cuts[0]); index++) {
        const int cut = cuts[index];
        reset_abi();
        assert(write_text(request) == (int)strlen(request));
        token = qemu_wasm_chardev_pending_input_token();
        assert(token == 1);
        abi_can_write = cut;
        wasm_chr_flush_pending_input(&abi_chardev);
        assert(abi_delivered_len == cut);
        assert(qemu_wasm_chardev_pending_input_token() == token);
        assert(qemu_wasm_chardev_cancel_pending_input(token + 1) == QEMU_WASM_CHARDEV_CANCEL_NONE);
        assert(qemu_wasm_chardev_cancel_pending_input(token) == QEMU_WASM_CHARDEV_CANCEL_PARTIAL);
        assert(qemu_wasm_chardev_pending_input_token() == 0);
        abi_can_write = 4096;
        wasm_chr_flush_pending_input(&abi_chardev);
        assert(abi_delivered_len == cut + 2);
        assert(abi_delivered[cut] == 0x18 && abi_delivered[cut + 1] == '\n');

        assert(write_text(next) == (int)strlen(next));
        wasm_chr_flush_pending_input(&abi_chardev);
        assert(abi_delivered_len == cut + 2 + (int)strlen(next));
        assert(memcmp(abi_delivered + cut + 2, next, strlen(next)) == 0);
    }

    reset_abi();
    wasm_chardev_next_input_token = UINT64_MAX;
    assert(write_text("x") == -4);
    assert(qemu_wasm_chardev_pending_input_token() == 0);

    reset_abi();
    assert(write_text(next) == (int)strlen(next));
    token = qemu_wasm_chardev_pending_input_token();
    abi_can_write = 4096;
    wasm_chr_flush_pending_input(&abi_chardev);
    assert(qemu_wasm_chardev_cancel_pending_input(token) == QEMU_WASM_CHARDEV_CANCEL_NONE);
    expect_bytes((const uint8_t *)next, strlen(next));
    puts("wasm-chardev-emscripten-abi-test: ok");
    return 0;
}
`;

try {
  writeFileSync(stub, stubSource);
  writeFileSync(harness, harnessSource);
  execFileSync(process.env.CC || "cc", [
    "-std=gnu11",
    "-I", tmp,
    harness,
    "-o", binary,
  ], { stdio: "inherit" });
  execFileSync(binary, [], { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
