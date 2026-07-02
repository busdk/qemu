/* SPDX-License-Identifier: MIT */
/*
 * Experimental wasm64 TCG target.
 *
 * This first runnable slice emits the existing TCI bytecode stream as the
 * strict correctness fallback. Native WebAssembly lowering plugs into the
 * C-callable boundary in tcg/wasm64.c and must preserve this fallback.
 */

#include "../tci/tcg-target.c.inc"
