/*
 * QEMU WebAssembly browser display backend
 *
 * Copyright (c) 2026 Heusala Group Ltd
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"
#include "qemu/module.h"
#include "ui/console.h"
#include "ui/input.h"
#include <emscripten.h>

typedef struct WasmDisplay {
    DisplayChangeListener dcl;
    DisplaySurface *surface;
    uint8_t *rgba;
    size_t rgba_size;
} WasmDisplay;

void qemu_wasm_display_key_event(unsigned int linux_key, int down);

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
    qemu_console_register_listener(qemu_console_lookup_default(),
                                   &wasm_display->dcl,
                                   &wasm_display_ops);
}

static void wasm_display_cleanup(void)
{
    if (!wasm_display) {
        return;
    }
    qemu_console_unregister_listener(&wasm_display->dcl);
    g_free(wasm_display->rgba);
    g_free(wasm_display);
    wasm_display = NULL;
}

EMSCRIPTEN_KEEPALIVE
void qemu_wasm_display_key_event(unsigned int linux_key, int down)
{
    qemu_input_event_send_key_linux(NULL, linux_key, down != 0);
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
