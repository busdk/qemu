/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Experimental wasm64 TCG backend runtime skeleton.
 *
 * The skeleton is not selected by default and is rejected during configure
 * until instruction lowering exists.  Keep the runtime boundary small and
 * conservative: generated WebAssembly TBs receive one context pointer and
 * unsupported work must continue through a correctness fallback.
 */

#include "qemu/osdep.h"
#include "tcg/wasm64.h"

bool tcg_wasm64_backend_available(void)
{
    return false;
}
