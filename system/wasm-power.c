/*
 * QEMU WebAssembly browser power-control entry points
 *
 * Copyright (c) 2026 Heusala Group Ltd
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"
#include "system/runstate.h"
#include <emscripten.h>

enum {
    QEMU_WASM_POWER_GUEST_POWERDOWN = 1,
    QEMU_WASM_POWER_FORCE_RESET = 2,
    QEMU_WASM_POWER_FORCE_POWEROFF = 3,
};

EMSCRIPTEN_KEEPALIVE
int qemu_wasm_power_request(int action)
{
    switch (action) {
    case QEMU_WASM_POWER_GUEST_POWERDOWN:
        qemu_system_powerdown_request();
        return 0;
    case QEMU_WASM_POWER_FORCE_RESET:
        qemu_system_reset_request(SHUTDOWN_CAUSE_HOST_QMP_SYSTEM_RESET);
        return 0;
    case QEMU_WASM_POWER_FORCE_POWEROFF:
        qemu_system_shutdown_request(SHUTDOWN_CAUSE_HOST_UI);
        return 0;
    default:
        return -1;
    }
}
