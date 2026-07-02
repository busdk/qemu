/* SPDX-License-Identifier: MIT */
/*
 * Define wasm64 target-specific operand constraints.
 */

REGS('r', MAKE_64BIT_MASK(0, TCG_TARGET_NB_REGS))
