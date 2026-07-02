/* SPDX-License-Identifier: MIT */
/*
 * Experimental wasm64 TCG target-private opcodes.
 *
 * The first selectable wasm64 backend emits the existing TCI bytecode stream
 * as its strict correctness fallback, so it uses the same target-private
 * opcodes as the TCI target until native WebAssembly lowering replaces them.
 */

#include "../tci/tcg-target-opc.h.inc"
