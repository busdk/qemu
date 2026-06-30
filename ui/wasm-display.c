/*
 * QEMU WebAssembly browser display backend
 *
 * Copyright (c) 2026 Heusala Group Ltd
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"
#include "qemu/atomic.h"
#include "qemu/module.h"
#include "qemu/thread.h"
#include "ui/console.h"
#include "ui/input.h"
#include "ui/kbd-state.h"
#include <emscripten.h>

#define WASM_DISPLAY_KEY_QUEUE_SIZE 128

typedef struct WasmDisplayKeyEvent {
    unsigned int linux_key;
    bool down;
} WasmDisplayKeyEvent;

typedef struct WasmDisplay {
    DisplayChangeListener dcl;
    DisplaySurface *surface;
    QKbdState *kbd;
    QemuMutex key_lock;
    WasmDisplayKeyEvent key_queue[WASM_DISPLAY_KEY_QUEUE_SIZE];
    unsigned int key_read;
    unsigned int key_write;
    unsigned int key_count;
    unsigned int key_events_received;
    unsigned int key_events_dropped;
    unsigned int key_events_drained;
    unsigned int key_events_sent;
    uint8_t *rgba;
    size_t rgba_size;
} WasmDisplay;

void qemu_wasm_display_key_event(unsigned int linux_key, int down);
unsigned int qemu_wasm_display_key_events_received(void);
unsigned int qemu_wasm_display_key_events_dropped(void);
unsigned int qemu_wasm_display_key_events_drained(void);
unsigned int qemu_wasm_display_key_events_sent(void);

static WasmDisplay *wasm_display;

static void wasm_display_present(int width, int height, const uint8_t *rgba)
{
    MAIN_THREAD_EM_ASM({
        const width = Number($0);
        const height = Number($1);
        const ptr = Number($2);
        const byteLength = width * height * 4;
        const canvas = Module["qemuWasmDisplayCanvas"] ||
            (typeof document !== "undefined" ? document.getElementById("canvas") : null);
        if (!canvas) {
            return;
        }
        if (canvas.width !== width) {
            canvas.width = width;
        }
        if (canvas.height !== height) {
            canvas.height = height;
        }
        canvas.hidden = false;
        canvas.setAttribute("aria-hidden", "false");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            return;
        }
        const src = new Uint8ClampedArray(HEAPU8.buffer, ptr, byteLength);
        const pixels = new Uint8ClampedArray(src);
        context.putImageData(new ImageData(pixels, width, height), 0, 0);
        canvas.dataset.qemuWasmDisplayFrames =
            String((Number(canvas.dataset.qemuWasmDisplayFrames) || 0) + 1);
        canvas.dataset.qemuWasmDisplayWidth = String(width);
        canvas.dataset.qemuWasmDisplayHeight = String(height);
        const state = globalThis.qemuWasmSmokeState;
        if (state && state.display) {
            state.display.backend = "wasm";
            state.display.frames = Number(canvas.dataset.qemuWasmDisplayFrames);
            state.display.canvasWidth = width;
            state.display.canvasHeight = height;
        }
    }, width, height, rgba);
}

static void wasm_display_queue_key_event(WasmDisplay *wd,
                                         unsigned int linux_key, bool down)
{
    qemu_mutex_lock(&wd->key_lock);
    if (wd->key_count == WASM_DISPLAY_KEY_QUEUE_SIZE) {
        wd->key_read = (wd->key_read + 1) % WASM_DISPLAY_KEY_QUEUE_SIZE;
        wd->key_count--;
        qatomic_inc(&wd->key_events_dropped);
    }
    wd->key_queue[wd->key_write] = (WasmDisplayKeyEvent) {
        .linux_key = linux_key,
        .down = down,
    };
    wd->key_write = (wd->key_write + 1) % WASM_DISPLAY_KEY_QUEUE_SIZE;
    wd->key_count++;
    qatomic_inc(&wd->key_events_received);
    qemu_mutex_unlock(&wd->key_lock);
}

static bool wasm_display_pop_key_event(WasmDisplay *wd,
                                       WasmDisplayKeyEvent *event)
{
    qemu_mutex_lock(&wd->key_lock);
    if (wd->key_count == 0) {
        qemu_mutex_unlock(&wd->key_lock);
        return false;
    }
    *event = wd->key_queue[wd->key_read];
    wd->key_read = (wd->key_read + 1) % WASM_DISPLAY_KEY_QUEUE_SIZE;
    wd->key_count--;
    qemu_mutex_unlock(&wd->key_lock);
    return true;
}

static void wasm_display_drain_key_events(WasmDisplay *wd)
{
    WasmDisplayKeyEvent event;

    while (wasm_display_pop_key_event(wd, &event)) {
        qatomic_inc(&wd->key_events_drained);
        if (wd->kbd) {
            qkbd_state_key_event(wd->kbd, event.linux_key, event.down);
            qatomic_inc(&wd->key_events_sent);
        }
    }
}

static void wasm_display_convert_xrgb8888(uint8_t *dst, const uint8_t *src,
                                          int width, int height, int stride)
{
    for (int y = 0; y < height; y++) {
        const uint32_t *row = (const uint32_t *)(src + y * stride);
        for (int x = 0; x < width; x++) {
            uint32_t pixel = row[x];
            *dst++ = (pixel >> 16) & 0xff;
            *dst++ = (pixel >> 8) & 0xff;
            *dst++ = pixel & 0xff;
            *dst++ = 0xff;
        }
    }
}

static void wasm_display_convert_bgrx8888(uint8_t *dst, const uint8_t *src,
                                          int width, int height, int stride)
{
    for (int y = 0; y < height; y++) {
        const uint32_t *row = (const uint32_t *)(src + y * stride);
        for (int x = 0; x < width; x++) {
            uint32_t pixel = row[x];
            *dst++ = pixel & 0xff;
            *dst++ = (pixel >> 8) & 0xff;
            *dst++ = (pixel >> 16) & 0xff;
            *dst++ = 0xff;
        }
    }
}

static void wasm_display_convert_rgb565(uint8_t *dst, const uint8_t *src,
                                        int width, int height, int stride)
{
    for (int y = 0; y < height; y++) {
        const uint16_t *row = (const uint16_t *)(src + y * stride);
        for (int x = 0; x < width; x++) {
            uint16_t pixel = row[x];
            uint8_t r = (pixel >> 11) & 0x1f;
            uint8_t g = (pixel >> 5) & 0x3f;
            uint8_t b = pixel & 0x1f;
            *dst++ = (r << 3) | (r >> 2);
            *dst++ = (g << 2) | (g >> 4);
            *dst++ = (b << 3) | (b >> 2);
            *dst++ = 0xff;
        }
    }
}

static void wasm_display_convert_xrgb1555(uint8_t *dst, const uint8_t *src,
                                          int width, int height, int stride)
{
    for (int y = 0; y < height; y++) {
        const uint16_t *row = (const uint16_t *)(src + y * stride);
        for (int x = 0; x < width; x++) {
            uint16_t pixel = row[x];
            uint8_t r = (pixel >> 10) & 0x1f;
            uint8_t g = (pixel >> 5) & 0x1f;
            uint8_t b = pixel & 0x1f;
            *dst++ = (r << 3) | (r >> 2);
            *dst++ = (g << 3) | (g >> 2);
            *dst++ = (b << 3) | (b >> 2);
            *dst++ = 0xff;
        }
    }
}

static bool wasm_display_surface_to_rgba(WasmDisplay *wd)
{
    DisplaySurface *surface = wd->surface;
    int width;
    int height;
    size_t required;

    if (!surface || surface_is_placeholder(surface)) {
        return false;
    }

    width = surface_width(surface);
    height = surface_height(surface);
    if (width <= 0 || height <= 0) {
        return false;
    }

    required = (size_t)width * (size_t)height * 4;
    if (required > wd->rgba_size) {
        wd->rgba = g_realloc(wd->rgba, required);
        wd->rgba_size = required;
    }

    switch (surface_format(surface)) {
    case PIXMAN_x8r8g8b8:
    case PIXMAN_a8r8g8b8:
        wasm_display_convert_xrgb8888(wd->rgba, surface_data(surface),
                                      width, height, surface_stride(surface));
        break;
    case PIXMAN_x8b8g8r8:
    case PIXMAN_a8b8g8r8:
    case PIXMAN_b8g8r8x8:
    case PIXMAN_b8g8r8a8:
        wasm_display_convert_bgrx8888(wd->rgba, surface_data(surface),
                                      width, height, surface_stride(surface));
        break;
    case PIXMAN_r5g6b5:
        wasm_display_convert_rgb565(wd->rgba, surface_data(surface),
                                    width, height, surface_stride(surface));
        break;
    case PIXMAN_x1r5g5b5:
        wasm_display_convert_xrgb1555(wd->rgba, surface_data(surface),
                                      width, height, surface_stride(surface));
        break;
    default:
        return false;
    }

    return true;
}

static void wasm_display_update(DisplayChangeListener *dcl,
                                int x, int y, int w, int h)
{
    WasmDisplay *wd = container_of(dcl, WasmDisplay, dcl);

    (void)x;
    (void)y;
    (void)w;
    (void)h;

    if (!wasm_display_surface_to_rgba(wd)) {
        return;
    }

    wasm_display_present(surface_width(wd->surface),
                         surface_height(wd->surface),
                         wd->rgba);
}

static void wasm_display_switch(DisplayChangeListener *dcl,
                                DisplaySurface *new_surface)
{
    WasmDisplay *wd = container_of(dcl, WasmDisplay, dcl);

    wd->surface = new_surface;
    if (new_surface && !surface_is_placeholder(new_surface)) {
        wasm_display_update(dcl, 0, 0,
                            surface_width(new_surface),
                            surface_height(new_surface));
    }
}

static void wasm_display_refresh(DisplayChangeListener *dcl)
{
    WasmDisplay *wd = container_of(dcl, WasmDisplay, dcl);

    wasm_display_drain_key_events(wd);
    qemu_console_hw_update(dcl->con);
}

static bool wasm_display_check_format(DisplayChangeListener *dcl,
                                      pixman_format_code_t format)
{
    (void)dcl;

    return format == PIXMAN_x8r8g8b8 ||
           format == PIXMAN_a8r8g8b8 ||
           format == PIXMAN_x8b8g8r8 ||
           format == PIXMAN_a8b8g8r8 ||
           format == PIXMAN_b8g8r8x8 ||
           format == PIXMAN_b8g8r8a8 ||
           format == PIXMAN_r5g6b5 ||
           format == PIXMAN_x1r5g5b5;
}

static const DisplayChangeListenerOps wasm_display_ops = {
    .dpy_name = "wasm",
    .dpy_refresh = wasm_display_refresh,
    .dpy_gfx_update = wasm_display_update,
    .dpy_gfx_switch = wasm_display_switch,
    .dpy_gfx_check_format = wasm_display_check_format,
};

static void wasm_display_init(DisplayState *ds, DisplayOptions *opts)
{
    (void)ds;
    (void)opts;

    wasm_display = g_new0(WasmDisplay, 1);
    qemu_mutex_init(&wasm_display->key_lock);
    qemu_console_register_listener(qemu_console_lookup_default(),
                                   &wasm_display->dcl,
                                   &wasm_display_ops);
    wasm_display->kbd = qkbd_state_init(wasm_display->dcl.con);
}

static void wasm_display_cleanup(void)
{
    if (!wasm_display) {
        return;
    }
    qemu_console_unregister_listener(&wasm_display->dcl);
    qkbd_state_free(wasm_display->kbd);
    qemu_mutex_destroy(&wasm_display->key_lock);
    g_free(wasm_display->rgba);
    g_free(wasm_display);
    wasm_display = NULL;
}

EMSCRIPTEN_KEEPALIVE
void qemu_wasm_display_key_event(unsigned int linux_key, int down)
{
    if (!wasm_display) {
        return;
    }
    wasm_display_queue_key_event(wasm_display, linux_key, down != 0);
}

EMSCRIPTEN_KEEPALIVE
unsigned int qemu_wasm_display_key_events_received(void)
{
    if (!wasm_display) {
        return 0;
    }
    return qatomic_read(&wasm_display->key_events_received);
}

EMSCRIPTEN_KEEPALIVE
unsigned int qemu_wasm_display_key_events_dropped(void)
{
    if (!wasm_display) {
        return 0;
    }
    return qatomic_read(&wasm_display->key_events_dropped);
}

EMSCRIPTEN_KEEPALIVE
unsigned int qemu_wasm_display_key_events_drained(void)
{
    if (!wasm_display) {
        return 0;
    }
    return qatomic_read(&wasm_display->key_events_drained);
}

EMSCRIPTEN_KEEPALIVE
unsigned int qemu_wasm_display_key_events_sent(void)
{
    if (!wasm_display) {
        return 0;
    }
    return qatomic_read(&wasm_display->key_events_sent);
}

static QemuDisplay qemu_display_wasm = {
    .type = DISPLAY_TYPE_WASM,
    .init = wasm_display_init,
    .cleanup = wasm_display_cleanup,
};

static void register_wasm_display(void)
{
    qemu_display_register(&qemu_display_wasm);
}
type_init(register_wasm_display);
