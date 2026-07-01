/*
 * TCG hot-block instrumentation.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef TCG_HOTBLOCKS_H
#define TCG_HOTBLOCKS_H

#include "exec/translation-block.h"
#include "tcg/tcg.h"

extern bool tcg_hotblocks_active;
extern bool tcg_hotblocks_checked;

bool tcg_hotblocks_enabled(void);
void tcg_hotblocks_tb_exec(const TranslationBlock *tb, int tb_exit);
void tcg_hotblocks_tci_op(TCGOpcode opc);

static inline void tcg_hotblocks_maybe_tb_exec(const TranslationBlock *tb,
                                               int tb_exit)
{
    if (unlikely(tcg_hotblocks_active || !tcg_hotblocks_checked)) {
        tcg_hotblocks_tb_exec(tb, tb_exit);
    }
}

static inline void tcg_hotblocks_maybe_tci_op(TCGOpcode opc)
{
    if (unlikely(tcg_hotblocks_active)) {
        tcg_hotblocks_tci_op(opc);
    }
}

#endif /* TCG_HOTBLOCKS_H */
