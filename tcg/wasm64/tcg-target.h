/* SPDX-License-Identifier: MIT */
/*
 * Experimental wasm64 TCG target skeleton.
 */

#ifndef TCG_TARGET_H
#define TCG_TARGET_H

#define TCG_TARGET_INSN_UNIT_SIZE 1
#define MAX_CODE_GEN_BUFFER_SIZE  ((size_t)-1)

#define TCG_TARGET_NB_REGS 16

typedef enum {
    TCG_REG_R0 = 0,
    TCG_REG_R1,
    TCG_REG_R2,
    TCG_REG_R3,
    TCG_REG_R4,
    TCG_REG_R5,
    TCG_REG_R6,
    TCG_REG_R7,
    TCG_REG_R8,
    TCG_REG_R9,
    TCG_REG_R10,
    TCG_REG_R11,
    TCG_REG_R12,
    TCG_REG_R13,
    TCG_REG_R14,
    TCG_REG_R15,

    TCG_REG_TMP = TCG_REG_R13,
    TCG_AREG0 = TCG_REG_R14,
    TCG_REG_CALL_STACK = TCG_REG_R15,
} TCGReg;

#endif /* TCG_TARGET_H */
