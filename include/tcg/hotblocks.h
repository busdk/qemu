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
extern uint64_t tcg_hotblocks_op_counts[NB_OPS];
extern uint64_t tcg_hotblocks_total_ops;
extern uint64_t tcg_hotblocks_op_sample;
extern uint64_t tcg_hotblocks_op_sample_counter;
extern uint64_t tcg_hotblocks_op_limit;
extern bool tcg_hotblocks_op_active;

bool tcg_hotblocks_enabled(void);
void tcg_hotblocks_tb_exec(const TranslationBlock *tb, int tb_exit);

static inline void tcg_hotblocks_maybe_start(void)
{
    if (unlikely(!tcg_hotblocks_checked)) {
        tcg_hotblocks_enabled();
    }
}

static inline void tcg_hotblocks_maybe_tb_exec(const TranslationBlock *tb,
                                               int tb_exit)
{
    if (unlikely(tcg_hotblocks_active || !tcg_hotblocks_checked)) {
        tcg_hotblocks_tb_exec(tb, tb_exit);
    }
}

static inline void tcg_hotblocks_maybe_tci_op(TCGOpcode opc)
{
    if (unlikely(tcg_hotblocks_active && tcg_hotblocks_op_active) &&
        opc < NB_OPS) {
        tcg_hotblocks_op_sample_counter++;
        if (tcg_hotblocks_op_sample_counter >= tcg_hotblocks_op_sample) {
            tcg_hotblocks_op_counts[opc] += tcg_hotblocks_op_sample;
            tcg_hotblocks_total_ops += tcg_hotblocks_op_sample;
            tcg_hotblocks_op_sample_counter = 0;
            if (tcg_hotblocks_op_limit != 0 &&
                tcg_hotblocks_total_ops >= tcg_hotblocks_op_limit) {
                tcg_hotblocks_op_active = false;
            }
        }
    }
}

#endif /* TCG_HOTBLOCKS_H */
