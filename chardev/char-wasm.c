/*
 * QEMU WebAssembly browser character device
 *
 * Copyright (c) 2026 Heusala Group Ltd
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"
#include "chardev/char.h"
#include "qapi/error.h"
#include "qemu/module.h"
#include "qemu/option.h"
#include "qemu/thread.h"
#include "qom/object.h"
#include <emscripten.h>

#define WASM_CHARDEV_DEFAULT_MAX_PAYLOAD 4096
#define WASM_CHARDEV_MAX_PAYLOAD_LIMIT 1048576

typedef struct WasmChardev {
    Chardev parent;
    char *channel;
    uint64_t max_payload;
} WasmChardev;

DECLARE_INSTANCE_CHECKER(WasmChardev, WASM_CHARDEV,
                         TYPE_CHARDEV_WASM)

static QemuMutex wasm_chardevs_lock;
static GList *wasm_chardevs;

EM_JS(int, wasm_chardev_pending_channel_len, (void), {
    const text = Module["qemuWasmChardevPendingChannel"] || "";
    return new TextEncoder().encode(String(text)).length + 1;
});

EM_JS(void, wasm_chardev_copy_pending_channel, (char *buf, int len), {
    const text = Module["qemuWasmChardevPendingChannel"] || "";
    const bytes = new TextEncoder().encode(String(text));
    const n = Math.max(0, Math.min(bytes.length, Number(len) - 1));
    HEAPU8.set(bytes.subarray(0, n), Number(buf));
    HEAPU8[Number(buf) + n] = 0;
});

EM_JS(int, wasm_chardev_pending_data_len, (void), {
    const text = Module["qemuWasmChardevPendingText"] || "";
    return new TextEncoder().encode(String(text)).length;
});

EM_JS(void, wasm_chardev_copy_pending_data, (uint8_t *buf, int len), {
    const text = Module["qemuWasmChardevPendingText"] || "";
    const bytes = new TextEncoder().encode(String(text));
    HEAPU8.set(bytes.subarray(0, Number(len)), Number(buf));
});

static WasmChardev *wasm_chardev_find_locked(const char *channel)
{
    GList *entry;

    for (entry = wasm_chardevs; entry; entry = entry->next) {
        WasmChardev *s = entry->data;

        if (g_strcmp0(s->channel, channel) == 0) {
            return s;
        }
    }
    return NULL;
}

static int wasm_chr_write(Chardev *chr, const uint8_t *buf, int len)
{
    WasmChardev *s = WASM_CHARDEV(chr);

    if (!buf || len < 0 || len > s->max_payload) {
        return -1;
    }

    MAIN_THREAD_EM_ASM({
        const channel = UTF8ToString(Number($0));
        const ptr = Number($1);
        const len = Number($2);
        const bytes = new Uint8Array(HEAPU8.buffer, ptr, len);
        const copy = new Uint8Array(bytes);

        if (typeof globalThis.qemuWasmChardevReceive === "function") {
            globalThis.qemuWasmChardevReceive(channel, copy);
        }
    }, s->channel, buf, len);

    return len;
}

static bool wasm_chr_open(Chardev *chr, ChardevBackend *backend, Error **errp)
{
    ChardevWasm *opts = backend->u.wasm.data;
    WasmChardev *s = WASM_CHARDEV(chr);

    s->channel = g_strdup(opts->has_channel ? opts->channel : chr->label);
    if (opts->has_max_payload &&
        (opts->max_payload <= 0 ||
         opts->max_payload > WASM_CHARDEV_MAX_PAYLOAD_LIMIT)) {
        error_setg(errp, "wasm chardev max-payload must be from 1 to %d",
                   WASM_CHARDEV_MAX_PAYLOAD_LIMIT);
        return false;
    }

    s->max_payload = opts->has_max_payload
        ? (int)opts->max_payload
        : WASM_CHARDEV_DEFAULT_MAX_PAYLOAD;

    if (s->channel[0] == '\0') {
        error_setg(errp, "wasm chardev channel must not be empty");
        return false;
    }
    qemu_mutex_lock(&wasm_chardevs_lock);
    if (wasm_chardev_find_locked(s->channel)) {
        qemu_mutex_unlock(&wasm_chardevs_lock);
        error_setg(errp, "wasm chardev channel '%s' already exists",
                   s->channel);
        return false;
    }
    wasm_chardevs = g_list_prepend(wasm_chardevs, s);
    qemu_mutex_unlock(&wasm_chardevs_lock);

    qemu_chr_be_event(chr, CHR_EVENT_OPENED);
    return true;
}

static void wasm_chr_parse(QemuOpts *opts, ChardevBackend *backend,
                           Error **errp)
{
    const char *channel;
    uint64_t max_payload;
    ChardevWasm *wasm;

    (void)errp;

    backend->type = CHARDEV_BACKEND_KIND_WASM;
    wasm = backend->u.wasm.data = g_new0(ChardevWasm, 1);
    qemu_chr_parse_common(opts, qapi_ChardevWasm_base(wasm));

    channel = qemu_opt_get(opts, "channel");
    if (channel) {
        wasm->has_channel = true;
        wasm->channel = g_strdup(channel);
    }

    max_payload = qemu_opt_get_size(opts, "max-payload", 0);
    if (max_payload != 0) {
        wasm->has_max_payload = true;
        wasm->max_payload = max_payload;
    }
}

static void wasm_chr_finalize(Object *obj)
{
    WasmChardev *s = WASM_CHARDEV(obj);

    qemu_mutex_lock(&wasm_chardevs_lock);
    wasm_chardevs = g_list_remove(wasm_chardevs, s);
    qemu_mutex_unlock(&wasm_chardevs_lock);

    g_free(s->channel);
}

EMSCRIPTEN_KEEPALIVE
int qemu_wasm_chardev_write_pending(void)
{
    g_autofree char *channel = NULL;
    g_autofree uint8_t *data = NULL;
    WasmChardev *s;
    Chardev *chr;
    int channel_len = wasm_chardev_pending_channel_len();
    int data_len = wasm_chardev_pending_data_len();
    int can_write;

    if (channel_len <= 1 || data_len <= 0) {
        return -1;
    }

    channel = g_malloc0(channel_len);
    wasm_chardev_copy_pending_channel(channel, channel_len);

    qemu_mutex_lock(&wasm_chardevs_lock);
    s = wasm_chardev_find_locked(channel);
    qemu_mutex_unlock(&wasm_chardevs_lock);
    if (!s) {
        return -2;
    }
    if (data_len > s->max_payload) {
        return -3;
    }

    chr = CHARDEV(s);
    can_write = qemu_chr_be_can_write(chr);
    if (can_write < data_len) {
        return -4;
    }

    data = g_malloc(data_len);
    wasm_chardev_copy_pending_data(data, data_len);
    qemu_chr_be_write(chr, data, data_len);
    return data_len;
}

static void wasm_chr_accept_input(Chardev *chr)
{
    (void)chr;
}

static void char_wasm_class_init(ObjectClass *oc, const void *data)
{
    ChardevClass *cc = CHARDEV_CLASS(oc);

    cc->chr_parse = wasm_chr_parse;
    cc->chr_open = wasm_chr_open;
    cc->chr_write = wasm_chr_write;
    cc->chr_accept_input = wasm_chr_accept_input;
}

static const TypeInfo char_wasm_type_info = {
    .name = TYPE_CHARDEV_WASM,
    .parent = TYPE_CHARDEV,
    .class_init = char_wasm_class_init,
    .instance_size = sizeof(WasmChardev),
    .instance_finalize = wasm_chr_finalize,
};

static void register_types(void)
{
    qemu_mutex_init(&wasm_chardevs_lock);
    type_register_static(&char_wasm_type_info);
}

type_init(register_types);
