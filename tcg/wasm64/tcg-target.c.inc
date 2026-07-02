/* SPDX-License-Identifier: MIT */
/*
 * Experimental wasm64 TCG target.
 *
 * This first runnable slice emits the existing TCI bytecode stream as the
 * strict correctness fallback. Native WebAssembly lowering plugs into the
 * C-callable boundary in tcg/wasm64.c and must preserve this fallback.
 */

#include "tcg/wasm64.h"

static void tcg_wasm64_out32(TCGContext *s, uint32_t word)
{
    tcg_wasm64_translate_note_tci_word(word);
    tcg_out32(s, word);
}

#define tcg_out32 tcg_wasm64_out32
#define tcg_out_tb_start tcg_wasm64_tci_out_tb_start
#include "../tci/tcg-target.c.inc"
#undef tcg_out_tb_start
#undef tcg_out32

static void tcg_out_tb_start(TCGContext *s)
{
    tcg_wasm64_translate_begin(tcg_splitwx_to_rx(s->code_buf));
    tcg_wasm64_tci_out_tb_start(s);
}
