#!/usr/bin/env node
/*
 * Deterministic equivalence tests for trace-shaped generated TCI output.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import fs from "node:fs";

import {
  encodeS32,
  encodeS64,
  encodeU32,
} from "./wasm-generated-block-prototype.mjs";
import {
  WASMJIT_COUNTERS,
  WASMJIT_RUN_CTX,
  WASMJIT_RUN_EXIT,
  WASMJIT_TLB_CONSTANTS,
  WASMJIT_TLB_ENTRY,
  WASMJIT_TLB_ENTRY_FULL,
  WASMJIT_TLB_MIRROR,
  WASMJIT_TLB_MIRROR_VALID,
} from "./wasmjit-runloop-model.mjs";

const VALUE_I32 = 0x7f;
const VALUE_I64 = 0x7e;

const OPS = {
  call: 2,
  brcond: 4,
  mb: 5,
  mov: 6,
  add: 7,
  and: 8,
  deposit: 16,
  extract: 22,
  ld32u: 28,
  ld32s: 29,
  ld: 30,
  mul: 32,
  neg: 38,
  or: 42,
  sextract: 50,
  shl: 51,
  shr: 52,
  setcond: 49,
  st8: 53,
  st32: 55,
  st: 56,
  sub: 57,
  xor: 58,
  exit_tb: 72,
  goto_tb: 73,
  tci_movi: 125,
  tci_movl: 126,
  tci_setcond32: 136,
  tci_qemu_ld_rrr: 138,
  tci_qemu_st_rrr: 139,
};
const OP_NAMES = Object.fromEntries(Object.entries(OPS).map(([name, op]) => [op, name]));
const PRE_R4I_LIVE_X86_SHAPE = [
  "ld32u",
  "tci_movi",
  "tci_setcond32",
  "brcond",
  "tci_movi",
  "st8",
  "ld",
  "tci_movi",
  "add",
  "st",
  "goto_tb",
  "exit_tb",
  "exit_tb",
];
const R4I_LIVE_X86_SHAPE = [
  "ld32u",
  "tci_movi",
  "tci_setcond32",
  "brcond",
  "tci_movi",
  "st8",
  "ld",
  "tci_movi",
  "add",
  "st",
  "goto_tb",
];
const R7_AVAILABLE_GENERATED_OUTPUT_SHAPE = [
  "tci_movi",
  "mov",
  "add",
  "xor",
  "goto_tb",
];
const R7_RV64_HELPER_PREFIX_SHAPE = [
  "ld32u",
  "tci_movi",
  "tci_setcond32",
  "brcond",
  "tci_movi",
  "st8",
  "ld",
  "tci_movi",
  "add",
  "st",
  "tci_movi",
  "mov",
  "xor",
  "and",
  "or",
  "sub",
  "mul",
  "neg",
  "extract",
  "sextract",
  "deposit",
  "tci_qemu_ld_rrr",
  "tci_qemu_st_rrr",
  "ld32s",
  "st32",
  "setcond",
  "mb",
  "tci_movi",
  "mov",
  "add",
  "xor",
  "and",
  "or",
  "sub",
  "mul",
  "neg",
  "extract",
  "sextract",
  "deposit",
  "tci_movi",
  "mov",
  "call",
];

const STATUS_EXIT = 0x20n;
const STATUS_DISPATCH = 0x21n;
const STATUS_HELPER = 0x22n;
const STATUS_MMIO = 0x23n;
const STATUS_TLB_MISS_OR_FAULT = 0x24n;
const STATUS_UNSUPPORTED = 0x25n;
const STATUS_INVALIDATED = 0x26n;
const STATUS_BUDGET = 0x27n;
const RUN_EXIT_REASON_NONE = 0;
const RUN_EXIT_REASON_BUDGET = 1;
const RUN_EXIT_REASON_MMIO = 2;
const RUN_EXIT_REASON_TLB_MISS_OR_FAULT = 3;
const RUN_EXIT_REASON_HELPER = 5;
const RUN_EXIT_REASON_UNSUPPORTED = 6;
const RUN_EXIT_REASON_INVALIDATED = 8;
const RUN_EXIT_FLAG_PAGE_CROSSING =
  WASMJIT_TLB_CONSTANTS.runExitFlagPageCrossing;
const PER_TB_EMITTER_NAME = "r4k-per-tb-function-body-emitter";
const TWO_TB_HOTSET_EMITTER_NAME = "r4k-two-tb-hotset-dispatch-fixture";
const TWO_TB_HOTSET_BODY_TIME_NS_PER_TB = 1000n;
const X86_CPU_STATE_CONTRACT_VERSION = 1;
const R4K_SOFTMMU_EMITTER_NAME = "r4k-softmmu-tlb-fastpath-fixture";
const R6_RV64_SOFTMMU_EMITTER_NAME =
  "r6-rv64-softmmu-tlb-fastpath-fixture";
const R4K_SOFTMMU_MMU_IDX = 2;
const R4K_SOFTMMU_PAGE_BITS = WASMJIT_TLB_CONSTANTS.targetPageBits;
const R4K_SOFTMMU_PAGE_MASK = WASMJIT_TLB_CONSTANTS.targetPageMask;
const R4K_SOFTMMU_TLB_ENTRY_BITS = WASMJIT_TLB_ENTRY.bits;
const R4K_INVALIDATION_TB_GENERATION = 7n;
const R4K_INVALIDATION_ADDRESS_SPACE_GENERATION = 11n;
const R4K_INVALIDATION_TLB_MIRROR_GENERATION = 13n;
const RV64_ENV_RELATIVE_BASE_REG = 14;
const RV64_ENV_RELATIVE_MIN_OFFSET = -16;
const RV64_ENV_RELATIVE_MAX_EXCLUSIVE = 0x120;
const MO_8 = 0;
const MO_16 = 1;
const MO_32 = 2;
const MO_64 = 3;
const MO_SIZE = 0x07;
const MO_SIGN = 0x08;
const MO_BSWAP = 0x10;
const MO_AMASK = 0x7 << 5;
const MO_ALIGN_4 = 2 << 5;
const MO_ALIGN_TLB_ONLY = 1 << 8;
const MO_ATOM_SHIFT = 9;
const MO_ATOM_IFALIGN_PAIR = 1 << MO_ATOM_SHIFT;
const MO_ATOM_WITHIN16 = 2 << MO_ATOM_SHIFT;
const MO_ATOM_SUBALIGN = 4 << MO_ATOM_SHIFT;
const MO_ATOM_NONE = 5 << MO_ATOM_SHIFT;
const MO_ATOM_MASK = 7 << MO_ATOM_SHIFT;
const MO_UNSUPPORTED_HIGH_FLAG = 1 << 12;
const X86_REG_ENUMS = [
  "R_EAX", "R_ECX", "R_EDX", "R_EBX", "R_ESP", "R_EBP", "R_ESI", "R_EDI",
  "R_R8", "R_R9", "R_R10", "R_R11", "R_R12", "R_R13", "R_R14", "R_R15",
];

const wasm64Header = fs.readFileSync(
  new URL("../../tcg/wasm64.h", import.meta.url),
  "utf8",
);

function headerDefine(name) {
  const match = wasm64Header.match(
    new RegExp(`^#define\\s+${name}\\s+\\(?(-?0x[0-9a-fA-F]+|-?\\d+)u?\\)?`, "m"),
  );

  assert.ok(match, `missing ${name} in tcg/wasm64.h`);
  return Number.parseInt(match[1], 0);
}

function assertHeaderObject(objectName, actual, expectedPrefix, fields) {
  for (const [field, suffix] of Object.entries(fields)) {
    assert.equal(
      actual[field],
      headerDefine(`${expectedPrefix}_${suffix}`),
      `${objectName}.${field} must match tcg/wasm64.h ${expectedPrefix}_${suffix}`,
    );
  }
}

assertHeaderObject("WASMJIT_RUN_CTX", WASMJIT_RUN_CTX, "TCG_WASM64_RUN_CTX", {
  env: "ENV_OFFSET",
  guestRam: "GUEST_RAM_OFFSET",
  budget: "BUDGET_OFFSET",
  counters: "COUNTERS_OFFSET",
  exit: "EXIT_OFFSET",
  mode: "MODE_OFFSET",
  flags: "FLAGS_OFFSET",
  tlb: "TLB_OFFSET",
  tbGeneration: "TB_GENERATION_OFFSET",
  addressSpaceGeneration: "ADDRESS_SPACE_GENERATION_OFFSET",
  size: "SIZE",
});
assertHeaderObject(
  "WASMJIT_TLB_MIRROR",
  WASMJIT_TLB_MIRROR,
  "TCG_WASM64_TLB_MIRROR",
  {
    mask: "MASK_OFFSET",
    table: "TABLE_OFFSET",
    fulltlb: "FULLTLB_OFFSET",
    generation: "GENERATION_OFFSET",
    mmuIdx: "MMU_IDX_OFFSET",
    targetPageBits: "TARGET_PAGE_BITS_OFFSET",
    cpuTlbEntryBits: "CPU_TLB_ENTRY_BITS_OFFSET",
    tlbEntrySize: "TLB_ENTRY_SIZE_OFFSET",
    tlbFlagsMask: "TLB_FLAGS_MASK_OFFSET",
    tlbSlowFlagsMask: "TLB_SLOW_FLAGS_MASK_OFFSET",
    flags: "FLAGS_OFFSET",
    size: "SIZE",
  },
);
assertHeaderObject(
  "WASMJIT_TLB_ENTRY",
  WASMJIT_TLB_ENTRY,
  "TCG_WASM64_CPUTLB_ENTRY",
  {
    addrRead: "ADDR_READ_OFFSET",
    addrWrite: "ADDR_WRITE_OFFSET",
    addrCode: "ADDR_CODE_OFFSET",
    addend: "ADDEND_OFFSET",
    size: "SIZE",
    bits: "BITS",
  },
);
assertHeaderObject(
  "WASMJIT_TLB_ENTRY_FULL",
  WASMJIT_TLB_ENTRY_FULL,
  "TCG_WASM64_CPUTLB_ENTRY_FULL",
  {
    slowFlags: "SLOW_FLAGS_OFFSET",
    size: "SIZE",
  },
);
assertHeaderObject("WASMJIT_RUN_EXIT", WASMJIT_RUN_EXIT, "TCG_WASM64_RUN_EXIT", {
  reason: "REASON_OFFSET",
  tbId: "TB_ID_OFFSET",
  pc: "PC_OFFSET",
  vaddr: "VADDR_OFFSET",
  paddr: "PADDR_OFFSET",
  value: "VALUE_OFFSET",
  sizeField: "SIZE_OFFSET",
  flags: "FLAGS_OFFSET",
  size: "SIZE",
});
assertHeaderObject(
  "WASMJIT_COUNTERS",
  WASMJIT_COUNTERS,
  "TCG_WASM64_RUN_COUNTERS",
  {
    generatedGuestInstructions: "GENERATED_GUEST_INSTRUCTIONS_OFFSET",
    fallbackGuestInstructions: "FALLBACK_GUEST_INSTRUCTIONS_OFFSET",
    generatedBodyTimeNs: "GENERATED_BODY_TIME_NS_OFFSET",
    tciDispatchTimeNs: "TCI_DISPATCH_TIME_NS_OFFSET",
    tbLookupTimeNs: "TB_LOOKUP_TIME_NS_OFFSET",
    helperCallTimeNs: "HELPER_CALL_TIME_NS_OFFSET",
    qemuLdTimeNs: "QEMU_LD_TIME_NS_OFFSET",
    qemuStTimeNs: "QEMU_ST_TIME_NS_OFFSET",
    compileTimeNs: "COMPILE_TIME_NS_OFFSET",
    instantiateTimeNs: "INSTANTIATE_TIME_NS_OFFSET",
    generatedChainLength: "GENERATED_CHAIN_LENGTH_OFFSET",
    inlineTlbHitLoads: "INLINE_TLB_HIT_LOADS_OFFSET",
    inlineTlbHitStores: "INLINE_TLB_HIT_STORES_OFFSET",
    helperCalls: "HELPER_CALLS_OFFSET",
    qemuLoadCalls: "QEMU_LD_CALLS_OFFSET",
    qemuStoreCalls: "QEMU_ST_CALLS_OFFSET",
    exitsBudget: "EXITS_BUDGET_OFFSET",
    exitsMmio: "EXITS_MMIO_OFFSET",
    exitsTlbMissOrFault: "EXITS_TLB_MISS_OR_FAULT_OFFSET",
    exitsInterrupt: "EXITS_INTERRUPT_OFFSET",
    exitsHelper: "EXITS_HELPER_OFFSET",
    exitsUnsupported: "EXITS_UNSUPPORTED_OFFSET",
    exitsHlt: "EXITS_HLT_OFFSET",
    exitsInvalidated: "EXITS_INVALIDATED_OFFSET",
    size: "SIZE",
  },
);
assert.equal(WASMJIT_TLB_MIRROR_VALID,
             headerDefine("TCG_WASM64_TLB_MIRROR_VALID"));
assert.equal(WASMJIT_TLB_CONSTANTS.targetPageBits,
             headerDefine("TCG_WASM64_TARGET_PAGE_BITS"));
assert.equal(
  WASMJIT_TLB_CONSTANTS.targetPageMask,
  BigInt.asIntN(64, -1n << BigInt(headerDefine("TCG_WASM64_TARGET_PAGE_BITS"))),
);
assert.equal(WASMJIT_TLB_CONSTANTS.invalidMask,
             BigInt(headerDefine("TCG_WASM64_TLB_INVALID_MASK")));
assert.equal(WASMJIT_TLB_CONSTANTS.forceSlow,
             BigInt(headerDefine("TCG_WASM64_TLB_FORCE_SLOW")));
assert.equal(WASMJIT_TLB_CONSTANTS.flagsMask,
             BigInt(headerDefine("TCG_WASM64_TLB_FLAGS_MASK")));
assert.equal(WASMJIT_TLB_CONSTANTS.mmio,
             headerDefine("TCG_WASM64_TLB_MMIO"));
assert.equal(WASMJIT_TLB_CONSTANTS.slowFlagsMask,
             headerDefine("TCG_WASM64_TLB_SLOW_FLAGS_MASK"));
assert.equal(WASMJIT_TLB_CONSTANTS.mmuDataLoad,
             headerDefine("TCG_WASM64_MMU_DATA_LOAD"));
assert.equal(WASMJIT_TLB_CONSTANTS.mmuDataStore,
             headerDefine("TCG_WASM64_MMU_DATA_STORE"));
assert.equal(WASMJIT_TLB_CONSTANTS.runExitFlagPageCrossing,
             headerDefine("TCG_WASM64_RUN_EXIT_FLAG_PAGE_CROSSING"));
assert.equal(MO_8, headerDefine("TCG_WASM64_MEMOP_8"));
assert.equal(MO_16, headerDefine("TCG_WASM64_MEMOP_16"));
assert.equal(MO_32, headerDefine("TCG_WASM64_MEMOP_32"));
assert.equal(MO_64, headerDefine("TCG_WASM64_MEMOP_64"));
assert.equal(MO_SIZE, headerDefine("TCG_WASM64_MEMOP_SIZE"));
assert.equal(MO_SIGN, headerDefine("TCG_WASM64_MEMOP_SIGN"));
assert.equal(MO_BSWAP, headerDefine("TCG_WASM64_MEMOP_BSWAP"));
assert.equal(MO_AMASK, headerDefine("TCG_WASM64_MEMOP_AMASK"));
assert.equal(MO_ALIGN_TLB_ONLY,
             headerDefine("TCG_WASM64_MEMOP_ALIGN_TLB_ONLY"));
assert.equal(MO_ATOM_NONE, headerDefine("TCG_WASM64_MEMOP_ATOM_NONE"));
assert.equal(MO_ATOM_MASK, headerDefine("TCG_WASM64_MEMOP_ATOM_MASK"));
const TCG_WASM64_MEMOPIDX_SHIFT =
  headerDefine("TCG_WASM64_MEMOPIDX_SHIFT");
const TCG_WASM64_MEMOPIDX_MMU_MASK =
  headerDefine("TCG_WASM64_MEMOPIDX_MMU_MASK");

function opReg(op, r0, r1 = 0, r2 = 0) {
  return (op | (r0 << 8) | (r1 << 12) | (r2 << 16)) >>> 0;
}

function opImm20(op, r0, imm) {
  return (op | (r0 << 8) | (((imm & 0xfffff) << 12) >>> 0)) >>> 0;
}

function opBranch(reg, imm) {
  return (OPS.brcond | (reg << 8) | (((imm & 0xfffff) << 12) >>> 0)) >>> 0;
}

function opCall(retLen, imm = 0) {
  return (OPS.call | (retLen << 8) | (((imm & 0xfffff) << 12) >>> 0)) >>> 0;
}

function opSetcond(op, r0, r1, r2, condition) {
  return (op | (r0 << 8) | (r1 << 12) | (r2 << 16) |
          (condition << 20)) >>> 0;
}

function opMem(op, r0, r1, offset) {
  return (op | (r0 << 8) | (r1 << 12) |
          (((offset & 0xffff) << 16) >>> 0)) >>> 0;
}

const R7_AVAILABLE_GENERATED_OUTPUT_WORDS = [
  opImm20(OPS.tci_movi, 1, 7),
  opReg(OPS.mov, 2, 1),
  opReg(OPS.add, 3, 1, 2),
  opReg(OPS.xor, 4, 3, 2),
  opImm20(OPS.goto_tb, 0, -8),
];
const R7_RV64_HELPER_PREFIX_WORDS = [
  opMem(OPS.ld32u, 1, 14, 0),
  opImm20(OPS.tci_movi, 2, 7),
  opSetcond(OPS.tci_setcond32, 3, 1, 2, 10),
  opBranch(3, 8),
  opImm20(OPS.tci_movi, 4, 11),
  opMem(OPS.st8, 4, 14, 8),
  opMem(OPS.ld, 5, 14, 16),
  opImm20(OPS.tci_movi, 6, 3),
  opReg(OPS.add, 7, 5, 6),
  opMem(OPS.st, 7, 14, 24),
  opImm20(OPS.tci_movi, 8, 31),
  opReg(OPS.mov, 9, 8),
  opReg(OPS.xor, 10, 9, 6),
  opReg(OPS.and, 11, 10, 8),
  opReg(OPS.or, 12, 11, 6),
  opReg(OPS.sub, 13, 12, 6),
  opReg(OPS.mul, 1, 13, 6),
  opReg(OPS.neg, 2, 1),
  opSetcond(OPS.extract, 3, 2, 0, 8),
  opSetcond(OPS.sextract, 4, 2, 0, 8),
  opSetcond(OPS.deposit, 5, 3, 4, 8),
  opReg(OPS.tci_qemu_ld_rrr, 6, 5, 8),
  opReg(OPS.tci_qemu_st_rrr, 6, 5, 8),
  opMem(OPS.ld32s, 7, 14, 32),
  opMem(OPS.st32, 7, 14, 40),
  opSetcond(OPS.setcond, 8, 6, 7, 9),
  opReg(OPS.mb, 0),
  opImm20(OPS.tci_movi, 9, 5),
  opReg(OPS.mov, 10, 9),
  opReg(OPS.add, 11, 10, 8),
  opReg(OPS.xor, 12, 11, 7),
  opReg(OPS.and, 13, 12, 6),
  opReg(OPS.or, 1, 13, 5),
  opReg(OPS.sub, 2, 1, 9),
  opReg(OPS.mul, 3, 2, 9),
  opReg(OPS.neg, 4, 3),
  opSetcond(OPS.extract, 5, 4, 0, 16),
  opSetcond(OPS.sextract, 6, 4, 0, 16),
  opSetcond(OPS.deposit, 7, 5, 6, 16),
  opImm20(OPS.tci_movi, 8, 13),
  opReg(OPS.mov, 9, 8),
  opCall(1),
];
const R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS = [
  opCall(0, 0),
];

function vector(items) {
  return [...encodeU32(items.length), ...items.flat()];
}

function section(id, payload) {
  return [id, ...encodeU32(payload.length), ...payload];
}

function name(text) {
  return [...encodeU32(text.length), ...Array.from(new TextEncoder().encode(text))];
}

function functionType(params, results) {
  return [0x60, ...vector(params.map((param) => [param])), ...vector(results.map((result) => [result]))];
}

function functionBody(instructions, locals = []) {
  const body = [
    ...vector(locals.map((local) => [
      ...encodeU32(local.count),
      local.type,
    ])),
    ...instructions,
    0x0b,
  ];
  return [...encodeU32(body.length), ...body];
}

function localGet(index) {
  return [0x20, ...encodeU32(index)];
}

function localSet(index, expr) {
  return [...expr, 0x21, ...encodeU32(index)];
}

function i32Const(value) {
  return [0x41, ...encodeS32(value)];
}

function i64Const(value) {
  return [0x42, ...encodeS64(BigInt.asIntN(64, BigInt(value)))];
}

function i32WrapI64(expr) {
  return [...expr, 0xa7];
}

function i64ExtendI32U(expr) {
  return [...expr, 0xad];
}

function i64ExtendI32S(expr) {
  return [...expr, 0xac];
}

function i64Load(address, offset = 0) {
  return [...address, 0x29, ...encodeU32(3), ...encodeU32(offset)];
}

function i32Load(address, offset = 0) {
  return [...address, 0x28, ...encodeU32(2), ...encodeU32(offset)];
}

function i32Load8U(address, offset = 0) {
  return [...address, 0x2d, ...encodeU32(0), ...encodeU32(offset)];
}

function i64Store(address, value, offset = 0) {
  return [...address, ...value, 0x37, ...encodeU32(3), ...encodeU32(offset)];
}

function i32Store(address, value, offset = 0) {
  return [...address, ...value, 0x36, ...encodeU32(2), ...encodeU32(offset)];
}

function i32Store8(address, value, offset = 0) {
  return [...address, ...value, 0x3a, ...encodeU32(0), ...encodeU32(offset)];
}

function block(body) {
  return [0x02, 0x40, ...body, 0x0b];
}

function callFunc(index, args) {
  return [...args.flat(), 0x10, ...encodeU32(index)];
}

function brIf(depth, condition) {
  return [...condition, 0x0d, ...encodeU32(depth)];
}

function returnExpr(expr) {
  return [...expr, 0x0f];
}

function ifBlock(condition, body) {
  return [...condition, 0x04, 0x40, ...body, 0x0b];
}

function i64Truthy(expr) {
  return [...expr, 0x50, 0x45];
}

function i32Eqz(expr) {
  return [...expr, 0x45];
}

function i32Eq(lhs, rhs) {
  return [...lhs, ...rhs, 0x46];
}

function i32Ne(lhs, rhs) {
  return [...lhs, ...rhs, 0x47];
}

function i32And(lhs, rhs) {
  return [...lhs, ...rhs, 0x71];
}

function i64AddExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x7c];
}

function i64SubExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x7d];
}

function i64MulExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x7e];
}

function i64AndExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x83];
}

function i64XorExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x85];
}

function i64ShlExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x86];
}

function i64ShrUExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x88];
}

function i64EqExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x51];
}

function i64NeExpr(lhs, rhs) {
  return [...lhs, ...rhs, 0x52];
}

function bits(value, start, length) {
  return (value >>> start) & ((1 << length) - 1);
}

function sextract(value, start, length) {
  const mask = (1 << length) - 1;
  let extracted = (value >>> start) & mask;
  const sign = 1 << (length - 1);

  if (extracted & sign) {
    extracted |= ~mask;
  }
  return extracted;
}

function decodedShape(words) {
  return words.map((insn) => OP_NAMES[bits(insn >>> 0, 0, 8)] || "unknown");
}

function toU64(value) {
  return BigInt.asUintN(64, BigInt(value));
}

function toI32(value) {
  return Number(BigInt.asIntN(32, BigInt(value)));
}

function toU32(value) {
  return Number(BigInt.asUintN(32, BigInt(value)));
}

function compare32(lhs, rhs, condition) {
  const lhsSigned = toI32(lhs);
  const rhsSigned = toI32(rhs);
  const lhsUnsigned = toU32(lhs);
  const rhsUnsigned = toU32(rhs);

  switch (condition) {
  case 0:
    return 0n;
  case 1:
    return 1n;
  case 8:
    return lhsUnsigned === rhsUnsigned ? 1n : 0n;
  case 9:
    return lhsUnsigned !== rhsUnsigned ? 1n : 0n;
  case 12:
    return (lhsUnsigned & rhsUnsigned) === 0 ? 1n : 0n;
  case 13:
    return (lhsUnsigned & rhsUnsigned) !== 0 ? 1n : 0n;
  case 2:
    return lhsSigned < rhsSigned ? 1n : 0n;
  case 3:
    return lhsSigned >= rhsSigned ? 1n : 0n;
  case 6:
    return lhsSigned > rhsSigned ? 1n : 0n;
  case 7:
    return lhsSigned <= rhsSigned ? 1n : 0n;
  case 10:
    return lhsUnsigned < rhsUnsigned ? 1n : 0n;
  case 11:
    return lhsUnsigned >= rhsUnsigned ? 1n : 0n;
  case 14:
    return lhsUnsigned > rhsUnsigned ? 1n : 0n;
  case 15:
    return lhsUnsigned <= rhsUnsigned ? 1n : 0n;
  default:
    throw new Error(`unsupported TCGCond in fixture: ${condition}`);
  }
}

function compare64(lhs, rhs, condition) {
  const lhsSigned = BigInt.asIntN(64, BigInt(lhs));
  const rhsSigned = BigInt.asIntN(64, BigInt(rhs));
  const lhsUnsigned = BigInt.asUintN(64, BigInt(lhs));
  const rhsUnsigned = BigInt.asUintN(64, BigInt(rhs));

  switch (condition) {
  case 0:
    return 0n;
  case 1:
    return 1n;
  case 8:
    return lhsUnsigned === rhsUnsigned ? 1n : 0n;
  case 9:
    return lhsUnsigned !== rhsUnsigned ? 1n : 0n;
  case 12:
    return (lhsUnsigned & rhsUnsigned) === 0n ? 1n : 0n;
  case 13:
    return (lhsUnsigned & rhsUnsigned) !== 0n ? 1n : 0n;
  case 2:
    return lhsSigned < rhsSigned ? 1n : 0n;
  case 3:
    return lhsSigned >= rhsSigned ? 1n : 0n;
  case 6:
    return lhsSigned > rhsSigned ? 1n : 0n;
  case 7:
    return lhsSigned <= rhsSigned ? 1n : 0n;
  case 10:
    return lhsUnsigned < rhsUnsigned ? 1n : 0n;
  case 11:
    return lhsUnsigned >= rhsUnsigned ? 1n : 0n;
  case 14:
    return lhsUnsigned > rhsUnsigned ? 1n : 0n;
  case 15:
    return lhsUnsigned <= rhsUnsigned ? 1n : 0n;
  default:
    throw new Error(`unsupported TCGCond in fixture: ${condition}`);
  }
}

function compare64Expr(lhs, rhs, condition) {
  switch (condition) {
  case 0:
    return [0x41, 0x00];
  case 1:
    return [0x41, 0x01];
  case 8:
    return [...lhs, ...rhs, 0x51];
  case 9:
    return [...lhs, ...rhs, 0x52];
  case 12:
    return [...lhs, ...rhs, 0x83, 0x50];
  case 13:
    return [...lhs, ...rhs, 0x83, 0x50, 0x45];
  case 2:
    return [...lhs, ...rhs, 0x53];
  case 3:
    return [...lhs, ...rhs, 0x59];
  case 6:
    return [...lhs, ...rhs, 0x55];
  case 7:
    return [...lhs, ...rhs, 0x57];
  case 10:
    return [...lhs, ...rhs, 0x54];
  case 11:
    return [...lhs, ...rhs, 0x5a];
  case 14:
    return [...lhs, ...rhs, 0x56];
  case 15:
    return [...lhs, ...rhs, 0x58];
  default:
    return null;
  }
}

function compare32Expr(lhs, rhs, condition) {
  switch (condition) {
  case 0:
    return [0x41, 0x00];
  case 1:
    return [0x41, 0x01];
  case 8:
    return [...lhs, ...rhs, 0x46];
  case 9:
    return [...lhs, ...rhs, 0x47];
  case 12:
    return [...lhs, ...rhs, 0x71, 0x45];
  case 13:
    return [...lhs, ...rhs, 0x71, 0x45, 0x45];
  case 2:
    return [...lhs, ...rhs, 0x48];
  case 3:
    return [...lhs, ...rhs, 0x4e];
  case 6:
    return [...lhs, ...rhs, 0x4a];
  case 7:
    return [...lhs, ...rhs, 0x4c];
  case 10:
    return [...lhs, ...rhs, 0x49];
  case 11:
    return [...lhs, ...rhs, 0x4f];
  case 14:
    return [...lhs, ...rhs, 0x4b];
  case 15:
    return [...lhs, ...rhs, 0x4d];
  default:
    return null;
  }
}

function regLocal(reg) {
  return 3 + reg;
}

function x86RegField(reg) {
  return `CPUX86State.regs[${X86_REG_ENUMS[reg]}]`;
}

function memoryAddress(regExpr, ofs) {
  return i32WrapI64([...regExpr, ...i64Const(ofs), 0x7c]);
}

function envRelativeAccessSupported(op, size) {
  const offset = sextract(op.insn, 16, 16);

  return op.r1 === RV64_ENV_RELATIVE_BASE_REG &&
         offset >= RV64_ENV_RELATIVE_MIN_OFFSET &&
         offset + size <= RV64_ENV_RELATIVE_MAX_EXCLUSIVE;
}

function envRelativeMemoryAddress(op, size) {
  return envRelativeAccessSupported(op, size)
    ? memoryAddress(localGet(regLocal(op.r1)), sextract(op.insn, 16, 16))
    : null;
}

function targetIndexFromPtr(ptr, relativeBase) {
  const offset = ptr - relativeBase;

  if (offset < 0 || offset % 4 !== 0) {
    return -1;
  }
  return offset / 4;
}

function splitGeneratedOutput(words, relativeBase) {
  const ops = [];
  let terminal = null;

  for (let index = 0; index < words.length; index++) {
    const insn = words[index] >>> 0;
    const opc = bits(insn, 0, 8);
    const r0 = bits(insn, 8, 4);
    const r1 = bits(insn, 12, 4);
    const r2 = bits(insn, 16, 4);
    const tbPtr = relativeBase + (index + 1) * 4;

    if (opc === OPS.call) {
      const retLen = bits(insn, 8, 4);

      if (index === 0 || retLen > 2) {
        throw new Error("fixture contains unsupported generated-output shape");
      }
      terminal = {
        kind: "helper",
        ret: relativeBase + index * 4,
        status: STATUS_HELPER,
        callReturnLength: retLen,
      };
      break;
    }
    if (opc === OPS.exit_tb || opc === OPS.goto_tb) {
      const ptr = tbPtr + sextract(insn, 12, 20);

      terminal = {
        kind: opc === OPS.goto_tb ? "goto_tb" : "exit_tb",
        ret: ptr,
        status: opc === OPS.goto_tb ? STATUS_DISPATCH : STATUS_EXIT,
      };
      break;
    }
    ops.push({ index, insn, opc, r0, r1, r2, tbPtr });
  }

  if (terminal === null) {
    throw new Error("fixture must terminate with exit_tb or goto_tb");
  }
  return { ops, terminal };
}

function flushGeneratedRegisterLocals() {
  return Array.from({ length: 16 }, (_, reg) =>
    i64Store(localGet(1), localGet(regLocal(reg)), reg * 8)).flat();
}

const SHARED_SOFTMMU_LOWERING_NAME = "generic-softmmu-tlb-contract-lowering";
const SHARED_SOFTMMU_LOCAL_COUNTERS_PTR = 22;
const SHARED_SOFTMMU_LOCAL_TLB_PTR = 23;
const SHARED_SOFTMMU_LOCAL_SLOW_FLAGS = 24;
const SHARED_SOFTMMU_LOCAL_ACCESS_SIZE = 25;
const SHARED_SOFTMMU_LOCAL_TADDR = 32;
const SHARED_SOFTMMU_LOCAL_OI = 33;
const SHARED_SOFTMMU_LOCAL_MEMOP = 34;
const SHARED_SOFTMMU_LOCAL_VALUE = 35;
const SHARED_SOFTMMU_LOCAL_MASK = 36;
const SHARED_SOFTMMU_LOCAL_TABLE_PTR = 37;
const SHARED_SOFTMMU_LOCAL_FULLTLB_PTR = 38;
const SHARED_SOFTMMU_LOCAL_INDEX = 39;
const SHARED_SOFTMMU_LOCAL_ENTRY_PTR = 40;
const SHARED_SOFTMMU_LOCAL_FULL_PTR = 41;
const SHARED_SOFTMMU_LOCAL_COMPARATOR = 42;
const SHARED_SOFTMMU_LOCAL_ADDEND = 43;
const SHARED_SOFTMMU_LOCAL_HOST_ADDR = 44;

function i64ConstFromContract(value) {
  return i64Const(BigInt.asIntN(64, BigInt(value)));
}

function sharedIncrementCounter(offset) {
  return i64Store(localGet(SHARED_SOFTMMU_LOCAL_COUNTERS_PTR), [
    ...i64Load(localGet(SHARED_SOFTMMU_LOCAL_COUNTERS_PTR), offset),
    ...i64Const(1n),
    0x7c,
  ], offset);
}

function sharedSoftmmuStoreExit(reason, sizeExpr, flags) {
  return [
    ...i32Store(localGet(2), i32Const(reason), WASMJIT_RUN_EXIT.reason),
    ...i64Store(localGet(2), localGet(SHARED_SOFTMMU_LOCAL_TADDR),
                WASMJIT_RUN_EXIT.vaddr),
    ...i64Store(localGet(2), i64Const(0n), WASMJIT_RUN_EXIT.paddr),
    ...i32Store(localGet(2), sizeExpr, WASMJIT_RUN_EXIT.sizeField),
    ...i32Store(localGet(2), i32Const(flags), WASMJIT_RUN_EXIT.flags),
  ];
}

function sharedSoftmmuFailureReturn({
  status,
  reason,
  sizeExpr,
  counterOffset,
  flags = 0,
}) {
  return [
    ...sharedSoftmmuStoreExit(reason, sizeExpr, flags),
    ...sharedIncrementCounter(counterOffset),
    ...returnExpr(i64Const(status)),
  ];
}

function compileSharedSoftmmuAccessOp(op, diagnostics = null) {
  const { opc, r0, r1, r2 } = op;
  const isLoad = opc === OPS.tci_qemu_ld_rrr;
  const isStore = opc === OPS.tci_qemu_st_rrr;
  const supportedMemopFlags =
    MO_SIZE | MO_SIGN | MO_BSWAP | MO_AMASK |
    MO_ALIGN_TLB_ONLY | MO_ATOM_MASK;
  const unsupportedReturn = sharedSoftmmuFailureReturn({
    status: STATUS_UNSUPPORTED,
    reason: RUN_EXIT_REASON_UNSUPPORTED,
    sizeExpr: localGet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE),
    counterOffset: WASMJIT_COUNTERS.exitsUnsupported,
  });
  const tlbMissReturn = sharedSoftmmuFailureReturn({
    status: STATUS_TLB_MISS_OR_FAULT,
    reason: RUN_EXIT_REASON_TLB_MISS_OR_FAULT,
    sizeExpr: localGet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE),
    counterOffset: WASMJIT_COUNTERS.exitsTlbMissOrFault,
  });
  const pageCrossingReturn = sharedSoftmmuFailureReturn({
    status: STATUS_TLB_MISS_OR_FAULT,
    reason: RUN_EXIT_REASON_TLB_MISS_OR_FAULT,
    sizeExpr: localGet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE),
    counterOffset: WASMJIT_COUNTERS.exitsTlbMissOrFault,
    flags: RUN_EXIT_FLAG_PAGE_CROSSING,
  });
  const mmioReturn = sharedSoftmmuFailureReturn({
    status: STATUS_MMIO,
    reason: RUN_EXIT_REASON_MMIO,
    sizeExpr: localGet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE),
    counterOffset: WASMJIT_COUNTERS.exitsMmio,
  });
  const code = [];

  if (!isLoad && !isStore) {
    return null;
  }
  if (diagnostics) {
    diagnostics.softmmuLowering = SHARED_SOFTMMU_LOWERING_NAME;
    diagnostics.softmmuLoweredOps =
      (diagnostics.softmmuLoweredOps || 0) + 1;
  }

  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_COUNTERS_PTR,
    i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.counters))));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_TLB_PTR,
    i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.tlb))));
  code.push(...localSet(SHARED_SOFTMMU_LOCAL_TADDR, localGet(regLocal(r1))));
  code.push(...localSet(SHARED_SOFTMMU_LOCAL_OI, localGet(regLocal(r2))));
  code.push(...localSet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE, i32Const(0)));
  if (isStore) {
    code.push(...localSet(SHARED_SOFTMMU_LOCAL_VALUE,
                          localGet(regLocal(r0))));
  }

  code.push(...ifBlock(i32Eqz(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR)),
                       unsupportedReturn));
  code.push(...ifBlock(
    i32Eqz(i32And(
      i32Load(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR),
              WASMJIT_TLB_MIRROR.flags),
      i32Const(WASMJIT_TLB_MIRROR_VALID))),
    unsupportedReturn,
  ));
  for (const [field, expected] of [
    [WASMJIT_TLB_MIRROR.targetPageBits,
     WASMJIT_TLB_CONSTANTS.targetPageBits],
    [WASMJIT_TLB_MIRROR.cpuTlbEntryBits, WASMJIT_TLB_ENTRY.bits],
    [WASMJIT_TLB_MIRROR.tlbEntrySize, WASMJIT_TLB_ENTRY.size],
    [WASMJIT_TLB_MIRROR.tlbFlagsMask,
     Number(WASMJIT_TLB_CONSTANTS.flagsMask)],
    [WASMJIT_TLB_MIRROR.tlbSlowFlagsMask,
     WASMJIT_TLB_CONSTANTS.slowFlagsMask],
  ]) {
    code.push(...ifBlock(
      i32Ne(i32Load(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR), field),
            i32Const(expected)),
      unsupportedReturn,
    ));
  }
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_MASK,
    i64Load(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR),
            WASMJIT_TLB_MIRROR.mask)));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_TABLE_PTR,
    i64Load(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR),
            WASMJIT_TLB_MIRROR.table)));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_FULLTLB_PTR,
    i64Load(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR),
            WASMJIT_TLB_MIRROR.fulltlb)));
  code.push(...ifBlock(i64EqExpr(localGet(SHARED_SOFTMMU_LOCAL_TABLE_PTR),
                                 i64Const(0n)), unsupportedReturn));
  code.push(...ifBlock(i64EqExpr(localGet(SHARED_SOFTMMU_LOCAL_FULLTLB_PTR),
                                 i64Const(0n)), unsupportedReturn));
  code.push(...ifBlock(
    i32Ne(
      i32WrapI64(i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_OI),
                            i64Const(BigInt(TCG_WASM64_MEMOPIDX_MMU_MASK)))),
      i32Load(localGet(SHARED_SOFTMMU_LOCAL_TLB_PTR),
              WASMJIT_TLB_MIRROR.mmuIdx)),
    unsupportedReturn,
  ));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_MEMOP,
    i64ShrUExpr(localGet(SHARED_SOFTMMU_LOCAL_OI),
                i64Const(BigInt(TCG_WASM64_MEMOPIDX_SHIFT)))));
  code.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                 i64Const(BigInt(~supportedMemopFlags >>> 0))),
      i64Const(0n)),
    unsupportedReturn,
  ));
  for (const flag of [MO_SIGN, MO_BSWAP, MO_AMASK, MO_ALIGN_TLB_ONLY]) {
    code.push(...ifBlock(
      i64NeExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(flag))),
        i64Const(0n)),
      unsupportedReturn,
    ));
  }
  code.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                 i64Const(BigInt(MO_ATOM_MASK))),
      i64Const(BigInt(MO_ATOM_NONE))),
    unsupportedReturn,
  ));
  for (const [memop, size] of [[MO_8, 1], [MO_32, 4], [MO_64, 8]]) {
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(memop))),
      localSet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE, i32Const(size)),
    ));
  }
  code.push(...ifBlock(i32Eqz(localGet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE)),
                       unsupportedReturn));
  code.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(
        i64XorExpr(
          localGet(SHARED_SOFTMMU_LOCAL_TADDR),
          i64AddExpr(
            localGet(SHARED_SOFTMMU_LOCAL_TADDR),
            i64SubExpr(
              i64ExtendI32U(localGet(SHARED_SOFTMMU_LOCAL_ACCESS_SIZE)),
              i64Const(1n)))),
        i64ConstFromContract(WASMJIT_TLB_CONSTANTS.targetPageMask)),
      i64Const(0n)),
    pageCrossingReturn,
  ));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_INDEX,
    i64AndExpr(
      i64ShrUExpr(localGet(SHARED_SOFTMMU_LOCAL_TADDR),
                  i64Const(BigInt(WASMJIT_TLB_CONSTANTS.targetPageBits))),
      i64ShrUExpr(localGet(SHARED_SOFTMMU_LOCAL_MASK),
                  i64Const(BigInt(WASMJIT_TLB_ENTRY.bits))))));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_ENTRY_PTR,
    i64AddExpr(
      localGet(SHARED_SOFTMMU_LOCAL_TABLE_PTR),
      i64ShlExpr(localGet(SHARED_SOFTMMU_LOCAL_INDEX),
                 i64Const(BigInt(WASMJIT_TLB_ENTRY.bits))))));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_FULL_PTR,
    i64AddExpr(
      localGet(SHARED_SOFTMMU_LOCAL_FULLTLB_PTR),
      i64MulExpr(localGet(SHARED_SOFTMMU_LOCAL_INDEX),
                 i64Const(BigInt(WASMJIT_TLB_ENTRY_FULL.size))))));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_COMPARATOR,
    i64Load(i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_ENTRY_PTR)),
            isStore ? WASMJIT_TLB_ENTRY.addrWrite :
                      WASMJIT_TLB_ENTRY.addrRead)));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_ADDEND,
    i64Load(i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_ENTRY_PTR)),
            WASMJIT_TLB_ENTRY.addend)));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_SLOW_FLAGS,
    i32Load8U(
      i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_FULL_PTR)),
      WASMJIT_TLB_ENTRY_FULL.slowFlags +
        (isStore ? WASMJIT_TLB_CONSTANTS.mmuDataStore :
                   WASMJIT_TLB_CONSTANTS.mmuDataLoad))));
  code.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_COMPARATOR),
                 i64ConstFromContract(WASMJIT_TLB_CONSTANTS.targetPageMask)),
      i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_TADDR),
                 i64ConstFromContract(WASMJIT_TLB_CONSTANTS.targetPageMask))),
    tlbMissReturn,
  ));
  code.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_COMPARATOR),
                 i64ConstFromContract(WASMJIT_TLB_CONSTANTS.invalidMask)),
      i64Const(0n)),
    tlbMissReturn,
  ));
  code.push(...ifBlock(
    i32Ne(i32And(localGet(SHARED_SOFTMMU_LOCAL_SLOW_FLAGS),
                 i32Const(WASMJIT_TLB_CONSTANTS.mmio)),
          i32Const(0)),
    mmioReturn,
  ));
  code.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_COMPARATOR),
                 i64ConstFromContract(WASMJIT_TLB_CONSTANTS.flagsMask)),
      i64Const(0n)),
    unsupportedReturn,
  ));
  code.push(...ifBlock(
    i32Ne(i32And(localGet(SHARED_SOFTMMU_LOCAL_SLOW_FLAGS),
                 i32Const(WASMJIT_TLB_CONSTANTS.slowFlagsMask)),
          i32Const(0)),
    unsupportedReturn,
  ));
  code.push(...localSet(
    SHARED_SOFTMMU_LOCAL_HOST_ADDR,
    i64AddExpr(localGet(SHARED_SOFTMMU_LOCAL_TADDR),
               localGet(SHARED_SOFTMMU_LOCAL_ADDEND))));

  if (isLoad) {
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(MO_8))),
      localSet(regLocal(r0), i64ExtendI32U(i32Load8U(
        i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_HOST_ADDR))))),
    ));
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(MO_32))),
      localSet(regLocal(r0), i64ExtendI32U(i32Load(
        i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_HOST_ADDR))))),
    ));
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(MO_64))),
      localSet(regLocal(r0), i64Load(
        i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_HOST_ADDR)))),
    ));
    code.push(...sharedIncrementCounter(WASMJIT_COUNTERS.inlineTlbHitLoads));
  } else {
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(MO_8))),
      i32Store8(i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_HOST_ADDR)),
                i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_VALUE))),
    ));
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(MO_32))),
      i32Store(i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_HOST_ADDR)),
               i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_VALUE))),
    ));
    code.push(...ifBlock(
      i64EqExpr(
        i64AndExpr(localGet(SHARED_SOFTMMU_LOCAL_MEMOP),
                   i64Const(BigInt(MO_SIZE))),
        i64Const(BigInt(MO_64))),
      i64Store(i32WrapI64(localGet(SHARED_SOFTMMU_LOCAL_HOST_ADDR)),
               localGet(SHARED_SOFTMMU_LOCAL_VALUE)),
    ));
    code.push(...sharedIncrementCounter(WASMJIT_COUNTERS.inlineTlbHitStores));
  }
  return code;
}

function compileSharedGeneratedOutputOp(op, diagnostics = null) {
  const { insn, opc, r0, r1, r2 } = op;

  if (opc === OPS.tci_movi) {
    return localSet(regLocal(r0), i64Const(sextract(insn, 12, 20)));
  }
  if (opc === OPS.tci_movl) {
    const ptr = op.tbPtr + sextract(insn, 12, 20);
    return localSet(regLocal(r0), i64Load(i32Const(ptr), 0));
  }
  if (opc === OPS.ld32u || opc === OPS.ld32s) {
    const address = envRelativeMemoryAddress(op, 4);

    if (address === null) {
      return null;
    }
    const loaded = i32Load(address);

    return localSet(regLocal(r0),
                    opc === OPS.ld32u ? i64ExtendI32U(loaded)
                                      : i64ExtendI32S(loaded));
  }
  if (opc === OPS.ld) {
    const address = envRelativeMemoryAddress(op, 8);

    return address === null ? null : localSet(regLocal(r0), i64Load(address));
  }
  if (opc === OPS.st8) {
    const address = envRelativeMemoryAddress(op, 1);

    return address === null ? null
      : i32Store8(address, i32WrapI64(localGet(regLocal(r0))));
  }
  if (opc === OPS.st32) {
    const address = envRelativeMemoryAddress(op, 4);

    return address === null ? null
      : i32Store(address, i32WrapI64(localGet(regLocal(r0))));
  }
  if (opc === OPS.st) {
    const address = envRelativeMemoryAddress(op, 8);

    return address === null ? null
      : i64Store(address, localGet(regLocal(r0)));
  }
  if (opc === OPS.mb) {
    return [];
  }
  if (opc === OPS.mov) {
    return localSet(regLocal(r0), localGet(regLocal(r1)));
  }
  if (opc === OPS.add || opc === OPS.sub || opc === OPS.mul ||
      opc === OPS.and || opc === OPS.or || opc === OPS.xor) {
    const opByte = opc === OPS.add ? 0x7c :
      opc === OPS.sub ? 0x7d :
      opc === OPS.mul ? 0x7e :
      opc === OPS.and ? 0x83 :
      opc === OPS.or ? 0x84 : 0x85;

    return localSet(regLocal(r0), [
      ...localGet(regLocal(r1)),
      ...localGet(regLocal(r2)),
      opByte,
    ]);
  }
  if (opc === OPS.neg) {
    return localSet(regLocal(r0), [
      ...i64Const(0),
      ...localGet(regLocal(r1)),
      0x7d,
    ]);
  }
  if (opc === OPS.shl || opc === OPS.shr) {
    return localSet(regLocal(r0), [
      ...localGet(regLocal(r1)),
      ...localGet(regLocal(r2)),
      opc === OPS.shl ? 0x86 : 0x88,
    ]);
  }
  if (opc === OPS.extract || opc === OPS.sextract) {
    const pos = bits(insn, 16, 6);
    const len = bits(insn, 22, 6);

    if (len === 0 || pos + len > 64) {
      return null;
    }
    if (opc === OPS.extract) {
      const mask = len === 64 ? -1n : ((1n << BigInt(len)) - 1n);

      return localSet(regLocal(r0), [
        ...localGet(regLocal(r1)),
        ...i64Const(pos),
        0x88,
        ...i64Const(mask),
        0x83,
      ]);
    }
    const shift = 64 - pos - len;

    return localSet(regLocal(r0), [
      ...localGet(regLocal(r1)),
      ...i64Const(shift),
      0x86,
      ...i64Const(shift),
      0x87,
    ]);
  }
  if (opc === OPS.deposit) {
    const pos = bits(insn, 20, 6);
    const len = bits(insn, 26, 6);

    if (len === 0 || pos + len > 64) {
      return null;
    }
    const mask = len === 64 ? -1n : ((1n << BigInt(len)) - 1n);
    const clearMask = BigInt.asUintN(
      64, ~(BigInt.asUintN(64, mask) << BigInt(pos)));

    return localSet(regLocal(r0), [
      ...localGet(regLocal(r1)),
      ...i64Const(clearMask),
      0x83,
      ...localGet(regLocal(r2)),
      ...i64Const(mask),
      0x83,
      ...i64Const(pos),
      0x86,
      0x84,
    ]);
  }
  if (opc === OPS.tci_setcond32) {
    const condition = bits(insn, 20, 4);
    const comparison = compare32Expr(i32WrapI64(localGet(regLocal(r1))),
                                     i32WrapI64(localGet(regLocal(r2))),
                                     condition);

    return comparison === null ? null
      : localSet(regLocal(r0), i64ExtendI32U(comparison));
  }
  if (opc === OPS.setcond) {
    const condition = bits(insn, 20, 4);
    const comparison = compare64Expr(localGet(regLocal(r1)),
                                     localGet(regLocal(r2)),
                                     condition);

    return comparison === null ? null
      : localSet(regLocal(r0), i64ExtendI32U(comparison));
  }
  if (opc === OPS.tci_qemu_ld_rrr) {
    return compileSharedSoftmmuAccessOp(op, diagnostics);
  }
  if (opc === OPS.tci_qemu_st_rrr) {
    return compileSharedSoftmmuAccessOp(op, diagnostics);
  }
  return null;
}

function compileSharedGeneratedOutputBody(words, relativeBase, diagnostics = null) {
  const { ops, terminal } = splitGeneratedOutput(words, relativeBase);
  const softmmuOps = ops.filter((op) =>
    op.opc === OPS.tci_qemu_ld_rrr || op.opc === OPS.tci_qemu_st_rrr);

  if (softmmuOps.length > 1) {
    if (diagnostics) {
      diagnostics.runtimeUnsupportedGuards.push({
        index: softmmuOps[1].index,
        op: OP_NAMES[softmmuOps[1].opc] ||
          `opcode-${softmmuOps[1].opc}`,
        reason: "softmmu-multiple-memops-unsupported",
        count: softmmuOps.length,
      });
    }
    throw new Error("fixture contains unsupported generated-output shape");
  }

  function compileRange(start, end) {
    const code = [];

    for (let index = start; index < end;) {
      const op = ops[index];

      if (op === undefined || op.index !== index) {
        return null;
      }
      if (op.opc === OPS.brcond) {
        const targetPtr = op.tbPtr + sextract(op.insn, 12, 20);
        const targetIndex = targetIndexFromPtr(targetPtr, relativeBase);

        if (targetIndex <= index) {
          return null;
        }
        if (targetIndex > end) {
          if (diagnostics) {
            diagnostics.runtimeUnsupportedGuards.push({
              index,
              op: "brcond",
              reason: "branch-target-outside-recorded-words",
              targetIndex,
            });
          }
          code.push(...ifBlock(
            i64Truthy(localGet(regLocal(op.r0))),
            [
              ...flushGeneratedRegisterLocals(),
              ...returnExpr(i64Const(STATUS_UNSUPPORTED)),
            ],
          ));
          index++;
          continue;
        }
        const body = compileRange(index + 1, targetIndex);

        if (body === null) {
          return null;
        }
        code.push(...block([
          ...brIf(0, i64Truthy(localGet(regLocal(op.r0)))),
          ...body,
        ]));
        index = targetIndex;
        continue;
      }
      const compiled = compileSharedGeneratedOutputOp(op, diagnostics);

      if (compiled === null) {
        return null;
      }
      code.push(...compiled);
      index++;
    }
    return code;
  }

  const body = compileRange(0, ops.length);

  if (body === null) {
    throw new Error("fixture contains unsupported generated-output shape");
  }
  return { body, terminal, ops };
}

function compileGeneratedOutputModule(words, relativeBase, diagnostics = null) {
  const instructions = [];

  if (diagnostics) {
    diagnostics.emitter = PER_TB_EMITTER_NAME;
    diagnostics.runtimeUnsupportedGuards = [];
    diagnostics.softmmuLowering = null;
    diagnostics.softmmuLoweredOps = 0;
  }
  instructions.push(...localSet(
    1, i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.env))));
  instructions.push(...localSet(
    2, i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.exit))));

  for (let reg = 0; reg < 16; reg++) {
    instructions.push(...localSet(regLocal(reg), i64Load(localGet(1), reg * 8)));
  }

  const compiled = compileSharedGeneratedOutputBody(
    words, relativeBase, diagnostics);

  instructions.push(...compiled.body);
  instructions.push(...flushGeneratedRegisterLocals());
  instructions.push(...i64Store(
    localGet(2),
    compiled.terminal.kind === "goto_tb"
      ? i64Load(i32Const(compiled.terminal.ret), 0)
      : i64Const(compiled.terminal.ret),
    WASMJIT_RUN_EXIT.value,
  ));
  instructions.push(...i32Store(
    localGet(2), i32Const(RUN_EXIT_REASON_NONE), WASMJIT_RUN_EXIT.reason));
  instructions.push(...i64Const(compiled.terminal.status));

  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([
      functionType([VALUE_I32], [VALUE_I64]),
    ])),
    ...section(2, vector([
      [...name("env"), ...name("memory"), 0x02, 0x00, 0x01],
    ])),
    ...section(3, vector([[0x00]])),
    ...section(7, vector([[...name("run"), 0x00, ...encodeU32(0)]])),
    ...section(10, vector([functionBody(
      instructions,
      [
        { count: 2, type: VALUE_I32 },
        { count: 16, type: VALUE_I64 },
        { count: 7, type: VALUE_I32 },
        { count: 19, type: VALUE_I64 },
      ],
    )])),
  ]);
}

function uniqueNumbers(values) {
  return [...new Set(values)].sort((lhs, rhs) => lhs - rhs);
}

function analyzeX86CpuStateContract(words, relativeBase) {
  const readRegs = [];
  const writtenRegs = [];
  const conditionInputs = [];
  const branchInputs = [];
  let terminal = null;

  for (let index = 0; index < words.length; index++) {
    const insn = words[index] >>> 0;
    const opc = bits(insn, 0, 8);
    const r0 = bits(insn, 8, 4);
    const r1 = bits(insn, 12, 4);
    const r2 = bits(insn, 16, 4);
    const tbPtr = relativeBase + (index + 1) * 4;

    if (opc === OPS.exit_tb || opc === OPS.goto_tb) {
      terminal = {
        op: OP_NAMES[opc],
        index,
        dispatchTargetSource: opc === OPS.goto_tb
          ? "recorded goto_tb slot"
          : "exit_tb immediate return",
        ripEipAction: "not read or written by generated body",
      };
      break;
    }
    if (opc === OPS.ld32u || opc === OPS.ld32s || opc === OPS.ld) {
      readRegs.push(r1);
      writtenRegs.push(r0);
    } else if (opc === OPS.st8 || opc === OPS.st32 || opc === OPS.st) {
      readRegs.push(r0, r1);
    } else if (opc === OPS.add || opc === OPS.and) {
      readRegs.push(r1, r2);
      writtenRegs.push(r0);
    } else if (opc === OPS.neg || opc === OPS.shl || opc === OPS.shr ||
               opc === OPS.extract || opc === OPS.sextract ||
               opc === OPS.deposit) {
      readRegs.push(r1);
      if (opc === OPS.shl || opc === OPS.shr || opc === OPS.deposit) {
        readRegs.push(r2);
      }
      writtenRegs.push(r0);
    } else if (opc === OPS.tci_movi || opc === OPS.tci_movl) {
      writtenRegs.push(r0);
    } else if (opc === OPS.tci_setcond32) {
      readRegs.push(r1, r2);
      writtenRegs.push(r0);
      conditionInputs.push({
        op: "tci_setcond32",
        index,
        condition: bits(insn, 20, 4),
        lhs: x86RegField(r1),
        rhs: x86RegField(r2),
        result: x86RegField(r0),
        lazyCcFields: [],
      });
    } else if (opc === OPS.setcond) {
      readRegs.push(r1, r2);
      writtenRegs.push(r0);
      conditionInputs.push({
        op: "setcond",
        index,
        condition: bits(insn, 20, 4),
        lhs: x86RegField(r1),
        rhs: x86RegField(r2),
        result: x86RegField(r0),
        lazyCcFields: [],
      });
    } else if (opc === OPS.brcond) {
      readRegs.push(r0);
      branchInputs.push({
        op: "brcond",
        index,
        conditionRegister: x86RegField(r0),
        targetIndex: targetIndexFromPtr(
          tbPtr + sextract(insn, 12, 20), relativeBase),
      });
    } else if (opc === OPS.tci_qemu_ld_rrr) {
      readRegs.push(r1, r2);
      writtenRegs.push(r0);
    } else if (opc === OPS.tci_qemu_st_rrr) {
      readRegs.push(r0, r1, r2);
    } else if (opc === OPS.call) {
      return {
        ok: false,
        reason: "unmodeled-helper-sensitive-state",
        op: OP_NAMES[opc],
        index,
      };
    } else {
      return {
        ok: false,
        reason: "unmodeled-x86-tcg-op-state",
        op: OP_NAMES[opc] || `opcode-${opc}`,
        index,
      };
    }
  }

  if (terminal === null) {
    return { ok: false, reason: "missing-terminal" };
  }

  const inputRegs = uniqueNumbers(readRegs.filter((reg) =>
    !writtenRegs.includes(reg)));
  const dirtyRegs = uniqueNumbers(writtenRegs);

  return {
    ok: true,
    version: X86_CPU_STATE_CONTRACT_VERSION,
    target: "x86_64-softmmu",
    emitter: PER_TB_EMITTER_NAME,
    source: "recorded TCI words plus target/i386 TCG globals",
    generalRegisters: {
      qemuGlobal: "target/i386 cpu_regs[]",
      cpuStateStorage: "CPUX86State.regs[]",
      loadedInputRegisters: inputRegs.map(x86RegField),
      dirtyRegisters: dirtyRegs.map(x86RegField),
      flushedRegisterLocals: "all 16 CPUX86State.regs[] slots before terminal return",
      requiredDirtyFlushRegisters: dirtyRegs.map(x86RegField),
    },
    ripEip: {
      field: "CPUX86State.eip",
      qemuGlobal: "target/i386 cpu_eip",
      bodyAccess: terminal.ripEipAction,
      dispatchTarget: terminal.dispatchTargetSource,
      failClosedReasons: [
        "unmodeled-rip-eip-read",
        "unmodeled-rip-eip-write",
      ],
    },
    lazyConditionCodes: {
      fields: [
        "CPUX86State.cc_dst",
        "CPUX86State.cc_src",
        "CPUX86State.cc_src2",
        "CPUX86State.cc_op",
      ],
      bodyAccess: "not read or written by the R4i generated body",
      modeledInputs: conditionInputs,
      failClosedReason: "unmodeled-lazy-condition-code-state",
    },
    branchInputs,
    flushPoints: [
      {
        before: "goto_tb dispatch or exit_tb return",
        required: "flush dirty CPUX86State.regs[] locals before publishing return target/status",
      },
      {
        before: "runtime unsupported return",
        required: "flush CPUX86State.regs[] locals before returning STATUS_UNSUPPORTED",
      },
    ],
    unmodeledFailClosedFields: [
      "CPUX86State.eflags",
      "CPUX86State.segs[]",
      "CPUX86State.hflags writes",
      "CPUX86State.cc_* lazy flag state",
      "helper-visible architectural side effects",
    ],
  };
}

function x86StateRequirementSupported(requirement) {
  if (requirement.field === "CPUX86State.regs[]" &&
      ["read", "write", "flush"].includes(requirement.access)) {
    return { ok: true };
  }
  if (requirement.field === "CPUX86State.eip" &&
      requirement.access === "dispatch-target") {
    return { ok: true };
  }
  if (requirement.field === "CPUX86State.eip") {
    return { ok: false, reason: `unmodeled-rip-eip-${requirement.access}` };
  }
  if (requirement.field.startsWith("CPUX86State.cc_")) {
    return { ok: false, reason: "unmodeled-lazy-condition-code-state" };
  }
  if (requirement.field.startsWith("CPUX86State.segs")) {
    return { ok: false, reason: "unmodeled-segment-state" };
  }
  if (requirement.field === "helper-visible-state") {
    return { ok: false, reason: "unmodeled-helper-sensitive-state" };
  }
  return { ok: false, reason: "unmodeled-x86-cpu-state" };
}

function failClosedReason(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/must terminate/.test(message)) {
    return "missing-terminal";
  }
  if (/unsupported generated-output shape/.test(message)) {
    return "unsupported-shape";
  }
  return "module-emission-failed";
}

function emitPerTBFunctionBody(words, relativeBase) {
  const diagnostics = {};
  const stateContract = analyzeX86CpuStateContract(words, relativeBase);

  try {
    const moduleBytes = compileGeneratedOutputModule(words, relativeBase,
                                                     diagnostics);
    const moduleValid = WebAssembly.validate(moduleBytes);

    if (!moduleValid) {
      return {
        ok: false,
        emitter: PER_TB_EMITTER_NAME,
        reason: "module-validation-failed",
        shape: decodedShape(words),
        moduleBytes,
        moduleValid,
        runtimeUnsupportedGuards: diagnostics.runtimeUnsupportedGuards,
        softmmuLowering: diagnostics.softmmuLowering,
        softmmuLoweredOps: diagnostics.softmmuLoweredOps,
        x86CpuStateContract: stateContract,
      };
    }
    return {
      ok: true,
      emitter: PER_TB_EMITTER_NAME,
      reason: null,
      shape: decodedShape(words),
      moduleBytes,
      moduleValid,
      moduleByteLength: moduleBytes.length,
      runtimeUnsupportedGuards: diagnostics.runtimeUnsupportedGuards,
      softmmuLowering: diagnostics.softmmuLowering,
      softmmuLoweredOps: diagnostics.softmmuLoweredOps,
      x86CpuStateContract: stateContract,
    };
  } catch (error) {
    return {
      ok: false,
      emitter: PER_TB_EMITTER_NAME,
      reason: failClosedReason(error),
      error: error instanceof Error ? error.message : String(error),
      shape: decodedShape(words),
      moduleValid: false,
      runtimeUnsupportedGuards: diagnostics.runtimeUnsupportedGuards || [],
      softmmuLowering: diagnostics.softmmuLowering || null,
      softmmuLoweredOps: diagnostics.softmmuLoweredOps || 0,
      x86CpuStateContract: stateContract,
    };
  }
}

function routeLiveGeneratedOutput(metadata) {
  if (!metadata) {
    return {
      ok: false,
      reason: "metadata-missing",
      jsStatusName: "generated-output-unavailable",
      generatedGuestInstructions: 0,
    };
  }
  if (!metadata.generatedOutputAvailable || metadata.generatedOutputSize === 0 ||
      metadata.generatedOutputSize % 4 !== 0) {
    return {
      ok: false,
      reason: "generated-output-unavailable",
      jsStatusName: "generated-output-unavailable",
      generatedGuestInstructions: 0,
    };
  }
  const shape = decodedShape(metadata.words);
  const supportedOps = new Set([
    "add",
    "and",
    "brcond",
    "deposit",
    "exit_tb",
    "extract",
    "goto_tb",
    "ld",
    "ld32s",
    "ld32u",
    "mb",
    "mov",
    "mul",
    "neg",
    "or",
    "setcond",
    "sextract",
    "shl",
    "shr",
    "st",
    "st8",
    "st32",
    "sub",
    "tci_movi",
    "tci_movl",
    "tci_qemu_ld_rrr",
    "tci_qemu_st_rrr",
    "tci_setcond32",
    "xor",
  ]);
  const terminal = shape.find((op) => op === "goto_tb" || op === "exit_tb");

  if (!terminal || !shape.every((op) => supportedOps.has(op))) {
    return {
      ok: false,
      reason: "selected-body-shape-unsupported",
      jsStatusName: "selected-body-shape-unsupported",
      generatedGuestInstructions: 0,
      shape,
    };
  }
  if (metadata.tbWords &&
      (metadata.tbWords.length !== metadata.words.length ||
       metadata.tbWords.some((word, index) =>
         (word >>> 0) !== (metadata.words[index] >>> 0)))) {
    return {
      ok: false,
      reason: "metadata-output-tb-code-mismatch",
      jsStatusName: "metadata-output-tb-code-mismatch",
      generatedGuestInstructions: 0,
      generatedChainLength: 0,
      generatedBodyTimeNs: 0,
      inlineTlbHitLoads: 0,
      inlineTlbHitStores: 0,
      helperCalls: 0,
      qemuLdCalls: 0,
      qemuStCalls: 0,
      runExitReason: "invalidated",
      exitsInvalidated: 1,
      shape,
    };
  }

  const emission = emitPerTBFunctionBody(metadata.words, metadata.relativeBase);

  if (!emission.ok) {
    return {
      ok: false,
      reason: emission.reason,
      jsStatusName: emission.reason === "module-validation-failed"
        ? "module-validation-failed"
        : "module-emission-failed",
      generatedGuestInstructions: 0,
      shape,
    };
  }
  return {
    ok: true,
    reason: null,
    jsStatusName: "ok",
    generatedGuestInstructions: metadata.guestInstructions,
    shape,
    moduleValid: emission.moduleValid,
    moduleByteLength: emission.moduleByteLength,
    softmmuLowering: emission.softmmuLowering,
    softmmuLoweredOps: emission.softmmuLoweredOps,
    inlineTlbHitLoads: shape.filter((op) => op === "tci_qemu_ld_rrr").length,
    inlineTlbHitStores: shape.filter((op) => op === "tci_qemu_st_rrr").length,
  };
}

function routeAvailableGeneratedOutput(metadata) {
  if (!metadata) {
    return {
      ok: false,
      reason: "metadata-missing",
      generatedGuestInstructions: 0,
      generatedCoverageNumerator: 0,
    };
  }
  if (!metadata.generatedOutputAvailable || metadata.generatedOutputSize === 0 ||
      metadata.generatedOutputSize % 4 !== 0) {
    return {
      ok: false,
      reason: "generated-output-unavailable",
      generatedGuestInstructions: 0,
      generatedCoverageNumerator: 0,
    };
  }

  const shape = decodedShape(metadata.words);
  const supportedOps = new Set([
    "add",
    "and",
    "brcond",
    "call",
    "deposit",
    "exit_tb",
    "extract",
    "goto_tb",
    "ld",
    "ld32s",
    "ld32u",
    "mb",
    "mov",
    "mul",
    "neg",
    "or",
    "setcond",
    "sextract",
    "shl",
    "shr",
    "st",
    "st8",
    "st32",
    "sub",
    "tci_movi",
    "tci_movl",
    "tci_qemu_ld_rrr",
    "tci_qemu_st_rrr",
    "tci_setcond32",
    "xor",
  ]);
  const terminal = shape.find((op) =>
    op === "goto_tb" || op === "exit_tb" || op === "call");

  if (!terminal || !shape.every((op) => supportedOps.has(op))) {
    return {
      ok: false,
      reason: "generated-output-shape-unsupported",
      generatedGuestInstructions: 0,
      generatedCoverageNumerator: 0,
      shape,
    };
  }
  if (metadata.tbWords &&
      (metadata.tbWords.length !== metadata.words.length ||
       metadata.tbWords.some((word, index) =>
         (word >>> 0) !== (metadata.words[index] >>> 0)))) {
    return {
      ok: false,
      reason: "metadata-output-tb-code-mismatch",
      runExitReason: "invalidated",
      generatedGuestInstructions: 0,
      generatedCoverageNumerator: 0,
      shape,
    };
  }

  return {
    ok: true,
    reason: null,
    shape,
    terminal,
    generatedGuestInstructions: metadata.guestInstructions,
    generatedCoverageNumerator: metadata.guestInstructions,
    generatedChainLength: 1,
    generatedExecuted: 1,
    guestStateCommit: false,
    tciCorrectnessFallback: true,
    returnedDispatchTarget: false,
    terminal,
  };
}

function routeR8RealGeneratedOutput(metadata) {
  if (!metadata) {
    return {
      ok: false,
      path: "tci-fallback",
      reason: "metadata-missing",
      generatedGuestInstructions: 0,
      fallbackGuestInstructions: 0,
      generatedBodyTimeNs: 0,
      guestStateCommit: false,
      tciCorrectnessFallback: true,
    };
  }
  if (!metadata.generatedOutputAvailable || metadata.generatedOutputSize === 0 ||
      metadata.generatedOutputSize % 4 !== 0) {
    return {
      ok: false,
      path: "tci-fallback",
      reason: "generated-output-unavailable",
      generatedGuestInstructions: 0,
      fallbackGuestInstructions: metadata.guestInstructions || 0,
      generatedBodyTimeNs: 0,
      guestStateCommit: false,
      tciCorrectnessFallback: true,
    };
  }

  const shape = decodedShape(metadata.words);
  const unsupportedOps = new Set(["call", "tci_qemu_ld_rrr", "tci_qemu_st_rrr"]);
  const terminal = shape.find((op) => op === "goto_tb" || op === "exit_tb");
  const terminalIndex = terminal ? shape.indexOf(terminal) : -1;

  if (!terminal ||
      shape.slice(0, terminalIndex + 1).some((op) => unsupportedOps.has(op))) {
    return {
      ok: false,
      path: "tci-fallback",
      reason: "selected-body-shape-unsupported",
      shape,
      generatedGuestInstructions: 0,
      fallbackGuestInstructions: metadata.guestInstructions || 0,
      generatedBodyTimeNs: 0,
      guestStateCommit: false,
      tciCorrectnessFallback: true,
    };
  }
  if (metadata.tbWords &&
      (metadata.tbWords.length !== metadata.words.length ||
       metadata.tbWords.some((word, index) =>
         (word >>> 0) !== (metadata.words[index] >>> 0)))) {
    return {
      ok: false,
      path: "tci-fallback",
      reason: "metadata-output-tb-code-mismatch",
      runExitReason: "invalidated",
      shape,
      generatedGuestInstructions: 0,
      fallbackGuestInstructions: metadata.guestInstructions || 0,
      generatedBodyTimeNs: 0,
      guestStateCommit: false,
      tciCorrectnessFallback: true,
    };
  }

  const emission = emitPerTBFunctionBody(metadata.words, metadata.relativeBase);
  if (!emission.ok) {
    return {
      ok: false,
      path: "tci-fallback",
      reason: emission.reason,
      shape,
      generatedGuestInstructions: 0,
      fallbackGuestInstructions: metadata.guestInstructions || 0,
      generatedBodyTimeNs: 0,
      guestStateCommit: false,
      tciCorrectnessFallback: true,
    };
  }

  return {
    ok: true,
    path: "generated",
    reason: null,
    shape,
    terminal,
    generatedGuestInstructions: metadata.guestInstructions,
    fallbackGuestInstructions: 0,
    generatedBodyTimeNs: 1000,
    generatedCoverageNumerator: metadata.guestInstructions,
    generatedExecuted: 1,
    generatedChainLength: 1,
    guestStateCommit: true,
    tciCorrectnessFallback: false,
    returnedDispatchTarget: terminal === "goto_tb",
    moduleValid: emission.moduleValid,
    moduleByteLength: emission.moduleByteLength,
  };
}

function interpretGeneratedOutput(words, state, relativeBase) {
  const regs = state.regs.slice();
  const view = state.view;
  let index = 0;
  let executed = 0;
  let memoryLoads = 0;
  let memoryWrites = 0;

  for (;;) {
    const insn = words[index] >>> 0;
    const opc = bits(insn, 0, 8);
    const r0 = bits(insn, 8, 4);
    const r1 = bits(insn, 12, 4);
    const r2 = bits(insn, 16, 4);
    const tbPtr = relativeBase + (index + 1) * 4;

    executed++;
    if (opc === OPS.ld32u) {
      const ofs = sextract(insn, 16, 16);
      regs[r0] = BigInt(view.getUint32(Number(regs[r1]) + ofs, true));
      memoryLoads++;
      index++;
    } else if (opc === OPS.ld32s) {
      const ofs = sextract(insn, 16, 16);
      regs[r0] = toU64(BigInt(view.getInt32(Number(regs[r1]) + ofs, true)));
      memoryLoads++;
      index++;
    } else if (opc === OPS.ld) {
      const ofs = sextract(insn, 16, 16);
      regs[r0] = view.getBigUint64(Number(regs[r1]) + ofs, true);
      memoryLoads++;
      index++;
    } else if (opc === OPS.tci_movi) {
      regs[r0] = toU64(sextract(insn, 12, 20));
      index++;
    } else if (opc === OPS.tci_movl) {
      const ptr = tbPtr + sextract(insn, 12, 20);
      regs[r0] = view.getBigUint64(ptr, true);
      index++;
    } else if (opc === OPS.tci_setcond32) {
      const condition = bits(insn, 20, 4);
      regs[r0] = compare32(regs[r1], regs[r2], condition);
      index++;
    } else if (opc === OPS.setcond) {
      const condition = bits(insn, 20, 4);
      regs[r0] = compare64(regs[r1], regs[r2], condition);
      index++;
    } else if (opc === OPS.tci_qemu_ld_rrr) {
      const taddr = regs[r1];
      const oi = regs[r2];
      const memop = Number(oi >> BigInt(TCG_WASM64_MEMOPIDX_SHIFT));
      const address = Number(taddr);

      if ((memop & MO_SIZE) === MO_8) {
        regs[r0] = BigInt(view.getUint8(address));
      } else if ((memop & MO_SIZE) === MO_32) {
        regs[r0] = BigInt(view.getUint32(address, true));
      } else if ((memop & MO_SIZE) === MO_64) {
        regs[r0] = view.getBigUint64(address, true);
      } else {
        throw new Error(`unsupported fixture qemu_ld memop ${memop}`);
      }
      memoryLoads++;
      index++;
    } else if (opc === OPS.tci_qemu_st_rrr) {
      const taddr = regs[r1];
      const oi = regs[r2];
      const memop = Number(oi >> BigInt(TCG_WASM64_MEMOPIDX_SHIFT));
      const address = Number(taddr);

      if ((memop & MO_SIZE) === MO_8) {
        view.setUint8(address, Number(regs[r0] & 0xffn));
      } else if ((memop & MO_SIZE) === MO_32) {
        view.setUint32(address, Number(regs[r0] & 0xffffffffn), true);
      } else if ((memop & MO_SIZE) === MO_64) {
        view.setBigUint64(address, regs[r0], true);
      } else {
        throw new Error(`unsupported fixture qemu_st memop ${memop}`);
      }
      memoryWrites++;
      index++;
    } else if (opc === OPS.brcond) {
      const ptr = tbPtr + sextract(insn, 12, 20);
      index = regs[r0] !== 0n ? targetIndexFromPtr(ptr, relativeBase)
                              : index + 1;
      assert.ok(index >= 0 && index <= words.length);
    } else if (opc === OPS.st8) {
      const ofs = sextract(insn, 16, 16);
      view.setUint8(Number(regs[r1]) + ofs, Number(regs[r0] & 0xffn));
      memoryWrites++;
      index++;
    } else if (opc === OPS.st32) {
      const ofs = sextract(insn, 16, 16);
      view.setUint32(Number(regs[r1]) + ofs, Number(regs[r0] & 0xffffffffn), true);
      memoryWrites++;
      index++;
    } else if (opc === OPS.st) {
      const ofs = sextract(insn, 16, 16);
      view.setBigUint64(Number(regs[r1]) + ofs, regs[r0], true);
      memoryWrites++;
      index++;
    } else if (opc === OPS.add) {
      regs[r0] = toU64(regs[r1] + regs[r2]);
      index++;
    } else if (opc === OPS.and) {
      regs[r0] = toU64(regs[r1] & regs[r2]);
      index++;
    } else if (opc === OPS.or) {
      regs[r0] = toU64(regs[r1] | regs[r2]);
      index++;
    } else if (opc === OPS.xor) {
      regs[r0] = toU64(regs[r1] ^ regs[r2]);
      index++;
    } else if (opc === OPS.sub) {
      regs[r0] = toU64(regs[r1] - regs[r2]);
      index++;
    } else if (opc === OPS.mul) {
      regs[r0] = toU64(regs[r1] * regs[r2]);
      index++;
    } else if (opc === OPS.mov) {
      regs[r0] = regs[r1];
      index++;
    } else if (opc === OPS.mb) {
      index++;
    } else if (opc === OPS.neg) {
      regs[r0] = toU64(-regs[r1]);
      index++;
    } else if (opc === OPS.shl) {
      regs[r0] = toU64(regs[r1] << (regs[r2] & 63n));
      index++;
    } else if (opc === OPS.shr) {
      regs[r0] = toU64(regs[r1] >> (regs[r2] & 63n));
      index++;
    } else if (opc === OPS.extract) {
      const pos = bits(insn, 16, 6);
      const len = bits(insn, 22, 6);
      const mask = len === 64 ? -1n : ((1n << BigInt(len)) - 1n);

      regs[r0] = toU64((regs[r1] >> BigInt(pos)) & mask);
      index++;
    } else if (opc === OPS.sextract) {
      const pos = bits(insn, 16, 6);
      const len = bits(insn, 22, 6);
      const shifted = BigInt.asIntN(64, regs[r1] << BigInt(64 - pos - len));

      regs[r0] = toU64(shifted >> BigInt(64 - len));
      index++;
    } else if (opc === OPS.deposit) {
      const pos = bits(insn, 20, 6);
      const len = bits(insn, 26, 6);
      const mask = len === 64 ? -1n : ((1n << BigInt(len)) - 1n);
      const clearMask = BigInt.asUintN(
        64, ~(BigInt.asUintN(64, mask) << BigInt(pos)));

      regs[r0] = toU64((regs[r1] & clearMask) |
                       ((regs[r2] & mask) << BigInt(pos)));
      index++;
    } else if (opc === OPS.call) {
      const retLen = bits(insn, 8, 4);

      if (index === 0 || retLen > 2) {
        throw new Error(`unsupported fixture opcode ${opc} at index ${index}`);
      }
      return {
        status: STATUS_HELPER,
        ret: BigInt(relativeBase + index * 4),
        regs,
        executed,
        memoryLoads,
        memoryWrites,
        callReturnLength: retLen,
      };
    } else if (opc === OPS.exit_tb) {
      const ptr = BigInt(tbPtr + sextract(insn, 12, 20));
      return {
        status: STATUS_EXIT, ret: ptr, regs, executed,
        memoryLoads, memoryWrites,
      };
    } else if (opc === OPS.goto_tb) {
      const ptr = tbPtr + sextract(insn, 12, 20);
      return {
        status: STATUS_DISPATCH,
        ret: view.getBigUint64(ptr, true),
        regs,
        executed,
        memoryLoads,
        memoryWrites,
      };
    } else {
      throw new Error(`unsupported fixture opcode ${opc} at index ${index}`);
    }
  }
}

function createHelpers(view) {
  const calls = [];

  return {
    calls,
    qemuLd(env, taddr, oi, tbPtr) {
      const address = Number(taddr);
      const value = view.getBigUint64(address, true);
      const result = toU64(value ^ env ^ (oi << 8n) ^ tbPtr);

      calls.push({
        kind: "ld",
        env: env.toString(),
        taddr: taddr.toString(),
        oi: oi.toString(),
        tbPtr: tbPtr.toString(),
        result: result.toString(),
      });
      return result;
    },
    qemuSt(env, taddr, val, oi, tbPtr) {
      const address = Number(taddr);
      const stored = toU64(val ^ env ^ (oi << 8n) ^ tbPtr);

      view.setBigUint64(address, stored, true);
      calls.push({
        kind: "st",
        env: env.toString(),
        taddr: taddr.toString(),
        val: val.toString(),
        oi: oi.toString(),
        tbPtr: tbPtr.toString(),
        stored: stored.toString(),
      });
    },
  };
}

function createState(relativeBase, words, seed) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  const ctxPtr = 64;
  const regsPtr = 128;
  const retPtr = 512;
  const countersPtr = 0x700;
  const mirrorPtr = 0x1800;
  const tablePtr = 0x2000;
  const fulltlbPtr = 0x2800;
  const dataBase = 0x3000 + seed * 0x100;
  const regs = Array.from({ length: 16 }, (_, index) =>
    BigInt(0x1000 + seed * 0x40 + index));
  const qemuTaddr = BigInt(dataBase + 0x10);
  const qemuPage = qemuTaddr & WASMJIT_TLB_CONSTANTS.targetPageMask;
  const qemuMask = (4 - 1) << WASMJIT_TLB_ENTRY.bits;
  const qemuIndex = Number(
    (qemuTaddr >> BigInt(WASMJIT_TLB_CONSTANTS.targetPageBits)) &
    (BigInt(qemuMask) >> BigInt(WASMJIT_TLB_ENTRY.bits)));
  const qemuEntryPtr = tablePtr + qemuIndex * WASMJIT_TLB_ENTRY.size;
  const qemuFullPtr = fulltlbPtr + qemuIndex * WASMJIT_TLB_ENTRY_FULL.size;

  regs[4] = 0n;
  regs[5] = 0n;
  regs[13] = BigInt(((MO_64 | MO_ATOM_NONE) <<
                     TCG_WASM64_MEMOPIDX_SHIFT) |
                    R4K_SOFTMMU_MMU_IDX);
  regs[14] = BigInt(dataBase + 16);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.env, BigInt(regsPtr), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.guestRam, 0n, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.budget, 1n, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.counters,
                    BigInt(countersPtr), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.exit, BigInt(retPtr), true);
  view.setUint32(ctxPtr + WASMJIT_RUN_CTX.mode, 1, true);
  view.setUint32(ctxPtr + WASMJIT_RUN_CTX.flags, 0, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.tlb, BigInt(mirrorPtr), true);
  view.setBigUint64(mirrorPtr + WASMJIT_TLB_MIRROR.mask,
                    BigInt(qemuMask), true);
  view.setBigUint64(mirrorPtr + WASMJIT_TLB_MIRROR.table,
                    BigInt(tablePtr), true);
  view.setBigUint64(mirrorPtr + WASMJIT_TLB_MIRROR.fulltlb,
                    BigInt(fulltlbPtr), true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.mmuIdx,
                 R4K_SOFTMMU_MMU_IDX, true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.targetPageBits,
                 WASMJIT_TLB_CONSTANTS.targetPageBits, true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.cpuTlbEntryBits,
                 WASMJIT_TLB_ENTRY.bits, true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.tlbEntrySize,
                 WASMJIT_TLB_ENTRY.size, true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.tlbFlagsMask,
                 Number(WASMJIT_TLB_CONSTANTS.flagsMask), true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.tlbSlowFlagsMask,
                 WASMJIT_TLB_CONSTANTS.slowFlagsMask, true);
  view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.flags,
                 WASMJIT_TLB_MIRROR_VALID, true);
  view.setBigUint64(qemuEntryPtr + WASMJIT_TLB_ENTRY.addrRead,
                    qemuPage, true);
  view.setBigUint64(qemuEntryPtr + WASMJIT_TLB_ENTRY.addrWrite,
                    qemuPage, true);
  view.setBigUint64(qemuEntryPtr + WASMJIT_TLB_ENTRY.addend, 0n, true);
  view.setUint8(
    qemuFullPtr + WASMJIT_TLB_ENTRY_FULL.slowFlags +
      WASMJIT_TLB_CONSTANTS.mmuDataLoad,
    0,
  );
  view.setUint8(
    qemuFullPtr + WASMJIT_TLB_ENTRY_FULL.slowFlags +
      WASMJIT_TLB_CONSTANTS.mmuDataStore,
    0,
  );
  view.setUint32(dataBase, seed % 2 === 0 ? 0xffffffff : 7, true);
  view.setBigUint64(dataBase + 0x10, BigInt(0x400000000 + seed), true);
  view.setBigUint64(dataBase + 0x100, BigInt(0x100000000 + seed), true);
  view.setBigUint64(dataBase + 0x110, BigInt(0x200000000 + seed), true);
  view.setBigUint64(dataBase + 0x118, BigInt(0x300000000 + seed), true);
  for (let index = 0; index < words.length; index++) {
    const insn = words[index] >>> 0;
    const opc = bits(insn, 0, 8);

    if (opc === OPS.goto_tb) {
      const slot = relativeBase + (index + 1) * 4 + sextract(insn, 12, 20);
      view.setBigUint64(slot, BigInt(0x5000 + seed * 0x80 + index), true);
    }
  }
  for (let reg = 0; reg < regs.length; reg++) {
    view.setBigUint64(regsPtr + reg * 8, regs[reg], true);
  }

  return {
    memory,
    view,
    ctxPtr,
    regsPtr,
    retPtr,
    countersPtr,
    mirrorPtr,
    dataBase,
    regs,
    helpers: createHelpers(view),
  };
}

function captureState(view, regsPtr, retPtr, dataBase, helpers) {
  return {
    regs: Array.from({ length: 16 }, (_, reg) =>
      view.getBigUint64(regsPtr + reg * 8, true).toString()),
    ret: view.getBigUint64(retPtr + WASMJIT_RUN_EXIT.value, true).toString(),
    data: [
      view.getUint32(dataBase, true),
      view.getUint8(dataBase + 4),
      view.getBigUint64(dataBase + 0x10, true).toString(),
      view.getBigUint64(dataBase + 0x100, true).toString(),
      view.getBigUint64(dataBase + 0x110, true).toString(),
      view.getBigUint64(dataBase + 0x118, true).toString(),
    ],
    helpers: {
      calls: helpers.calls,
      loads: helpers.calls.filter((call) => call.kind === "ld").length,
      stores: helpers.calls.filter((call) => call.kind === "st").length,
    },
  };
}

function captureInterpreterState(state) {
  return {
    regs: state.regs.map((value) => value.toString()),
    data: [
      state.view.getUint32(state.dataBase, true),
      state.view.getUint8(state.dataBase + 4),
      state.view.getBigUint64(state.dataBase + 0x10, true).toString(),
      state.view.getBigUint64(state.dataBase + 0x100, true).toString(),
      state.view.getBigUint64(state.dataBase + 0x110, true).toString(),
      state.view.getBigUint64(state.dataBase + 0x118, true).toString(),
    ],
    helpers: {
      loads: state.helpers.calls.filter((call) => call.kind === "ld").length,
      stores: state.helpers.calls.filter((call) => call.kind === "st").length,
    },
  };
}

function createChainedState(sourceFixture, targetTbPtr, seed) {
  const state = createState(sourceFixture.relativeBase, sourceFixture.words, seed);
  const terminal = splitGeneratedOutput(
    sourceFixture.words, sourceFixture.relativeBase).terminal;

  assert.equal(terminal.kind, "goto_tb");
  state.view.setBigUint64(terminal.ret, BigInt(targetTbPtr), true);
  return state;
}

function runInterpreterTB(state, fixture) {
  const result = interpretGeneratedOutput(
    fixture.words, state, fixture.relativeBase);

  state.regs = result.regs.slice();
  return result;
}

function simulateR7LongRunningGeneratedExec({
  sourceFixture,
  targetFixture,
  targetTbPtr,
  sourceGuestInstructions,
  targetGuestInstructions,
  budget,
  seed,
}) {
  const generated = createChainedState(sourceFixture, targetTbPtr, seed);
  const reference = createChainedState(sourceFixture, targetTbPtr, seed);
  const generatedSource = runInterpreterTB(generated, sourceFixture);
  const referenceSource = runInterpreterTB(reference, sourceFixture);

  assert.equal(generatedSource.status, STATUS_DISPATCH);
  assert.equal(referenceSource.status, STATUS_DISPATCH);
  assert.equal(generatedSource.ret, BigInt(targetTbPtr));
  assert.equal(referenceSource.ret, BigInt(targetTbPtr));

  let generatedTarget = null;
  let referenceTarget = null;
  let generatedChainLength = 1;
  let generatedGuestInstructions = sourceGuestInstructions;
  let stopReason = null;
  let path = "generated-chain";

  if (budget < sourceGuestInstructions + targetGuestInstructions) {
    stopReason = "chain-budget";
    path = "generated-then-main-loop";
  } else if (!targetFixture) {
    stopReason = "chain-target-unsupported";
    path = "generated-then-tci-fallback";
  } else {
    generatedTarget = runInterpreterTB(generated, targetFixture);
    referenceTarget = runInterpreterTB(reference, targetFixture);
    generatedChainLength++;
    generatedGuestInstructions += targetGuestInstructions;
  }

  const generatedState = captureInterpreterState(generated);
  const referenceState = captureInterpreterState(reference);

  return {
    path,
    stopReason,
    generatedRunEntries: 1,
    generatedChainLength,
    generatedGuestInstructions,
    generatedGuestInstructionsPerEntry: generatedGuestInstructions,
    generatedCoverageNumerator: generatedGuestInstructions,
    generatedExecuted: generatedChainLength,
    sourceStatus: generatedSource.status.toString(),
    targetStatus: generatedTarget ? generatedTarget.status.toString() : null,
    finalStatus: generatedTarget ? generatedTarget.status.toString()
                                 : generatedSource.status.toString(),
    finalRet: generatedTarget ? generatedTarget.ret.toString()
                              : generatedSource.ret.toString(),
    guestStateCommit: true,
    tciCorrectnessFallback: stopReason === "chain-target-unsupported",
    registerStateMatched:
      JSON.stringify(generatedState.regs) ===
      JSON.stringify(referenceState.regs),
    memoryStateMatched:
      JSON.stringify(generatedState.data) ===
      JSON.stringify(referenceState.data),
    helperCalls: generatedState.helpers.loads + generatedState.helpers.stores,
  };
}

async function runFixture(fixture, seed) {
  const relativeBase = fixture.relativeBase;
  const reference = createState(relativeBase, fixture.words, seed);
  const expected = interpretGeneratedOutput(fixture.words, reference, relativeBase);
  const generated = createState(relativeBase, fixture.words, seed);
  const emission = emitPerTBFunctionBody(fixture.words, relativeBase);

  assert.equal(emission.ok, true, `${fixture.name} emitter failed closed`);
  assert.equal(emission.emitter, PER_TB_EMITTER_NAME);
  assert.equal(emission.moduleValid, true,
               `${fixture.name} emitted invalid module bytes`);
  const compiled = await WebAssembly.compile(emission.moduleBytes);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      memory: generated.memory,
      qemu_ld_rrr: generated.helpers.qemuLd,
      qemu_st_rrr: generated.helpers.qemuSt,
    },
  });
  const status = instance.exports.run(generated.ctxPtr);
  const generatedState = captureState(generated.view, generated.regsPtr,
                                      generated.retPtr, generated.dataBase,
                                      generated.helpers);

  for (let reg = 0; reg < expected.regs.length; reg++) {
    reference.view.setBigUint64(reference.regsPtr + reg * 8,
                                expected.regs[reg], true);
  }
  reference.view.setBigUint64(
    reference.retPtr + WASMJIT_RUN_EXIT.value, expected.ret, true);
  const referenceState = captureState(reference.view, reference.regsPtr,
                                      reference.retPtr, reference.dataBase,
                                      reference.helpers);

  assert.equal(status, expected.status, `${fixture.name} status mismatch`);
  assert.deepEqual(generatedState, referenceState,
                   `${fixture.name} generated state mismatch`);
  return {
    name: fixture.name,
    terminal: fixture.terminal,
    seed,
    status: status.toString(),
    ret: generatedState.ret,
    registerStateMatched: true,
    memoryStateMatched: true,
    generatedGuestInstructions: fixture.guestInstructions || 0,
    generatedTciOpEquivalents: expected.executed,
    inlineTlbHitLoads: expected.memoryLoads,
    inlineTlbHitStores: expected.memoryWrites,
    memoryWrites: expected.memoryWrites,
    emitter: emission.emitter,
    moduleValid: emission.moduleValid,
    moduleByteLength: emission.moduleByteLength,
    runtimeUnsupportedGuards: emission.runtimeUnsupportedGuards,
    x86CpuStateContract: emission.x86CpuStateContract,
    helpers: generatedState.helpers,
  };
}

async function runRuntimeUnsupportedGuardFixture(fixture, seed) {
  const generated = createState(fixture.relativeBase, fixture.words, seed);
  const emission = emitPerTBFunctionBody(fixture.words, fixture.relativeBase);

  assert.equal(emission.ok, true, `${fixture.name} emitter failed closed`);
  assert.deepEqual(
    emission.runtimeUnsupportedGuards.map((guard) => guard.reason),
    ["branch-target-outside-recorded-words"],
  );

  const compiled = await WebAssembly.compile(emission.moduleBytes);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      memory: generated.memory,
      qemu_ld_rrr: generated.helpers.qemuLd,
      qemu_st_rrr: generated.helpers.qemuSt,
    },
  });
  const status = instance.exports.run(generated.ctxPtr);

  return {
    status: status.toString(),
    flushedRegs: {
      [x86RegField(4)]:
        generated.view.getBigUint64(generated.regsPtr + 4 * 8, true).toString(),
      [x86RegField(5)]:
        generated.view.getBigUint64(generated.regsPtr + 5 * 8, true).toString(),
      [x86RegField(13)]:
        generated.view.getBigUint64(generated.regsPtr + 13 * 8, true).toString(),
    },
  };
}

function runExitReasonName(reason) {
  if (reason === RUN_EXIT_REASON_NONE) {
    return "none";
  }
  if (reason === RUN_EXIT_REASON_BUDGET) {
    return "budget";
  }
  if (reason === RUN_EXIT_REASON_MMIO) {
    return "mmio";
  }
  if (reason === RUN_EXIT_REASON_TLB_MISS_OR_FAULT) {
    return "tlb-miss-or-fault";
  }
  if (reason === RUN_EXIT_REASON_HELPER) {
    return "helper";
  }
  if (reason === RUN_EXIT_REASON_UNSUPPORTED) {
    return "unsupported";
  }
  if (reason === RUN_EXIT_REASON_INVALIDATED) {
    return "invalidated";
  }
  return `unknown-${reason}`;
}

function generatedStatusToRunExitReason(status) {
  if (status === STATUS_EXIT || status === STATUS_DISPATCH) {
    return RUN_EXIT_REASON_NONE;
  }
  if (status === STATUS_BUDGET) {
    return RUN_EXIT_REASON_BUDGET;
  }
  if (status === STATUS_MMIO) {
    return RUN_EXIT_REASON_MMIO;
  }
  if (status === STATUS_TLB_MISS_OR_FAULT) {
    return RUN_EXIT_REASON_TLB_MISS_OR_FAULT;
  }
  if (status === STATUS_HELPER) {
    return RUN_EXIT_REASON_HELPER;
  }
  if (status === STATUS_UNSUPPORTED) {
    return RUN_EXIT_REASON_UNSUPPORTED;
  }
  if (status === STATUS_INVALIDATED) {
    return RUN_EXIT_REASON_INVALIDATED;
  }
  return null;
}

function generatedStatusForRunExitReason(reason) {
  if (reason === RUN_EXIT_REASON_BUDGET) {
    return STATUS_BUDGET;
  }
  if (reason === RUN_EXIT_REASON_MMIO) {
    return STATUS_MMIO;
  }
  if (reason === RUN_EXIT_REASON_TLB_MISS_OR_FAULT) {
    return STATUS_TLB_MISS_OR_FAULT;
  }
  if (reason === RUN_EXIT_REASON_HELPER) {
    return STATUS_HELPER;
  }
  if (reason === RUN_EXIT_REASON_UNSUPPORTED) {
    return STATUS_UNSUPPORTED;
  }
  if (reason === RUN_EXIT_REASON_INVALIDATED) {
    return STATUS_INVALIDATED;
  }
  throw new Error(`no failure generated status for run-exit reason ${reason}`);
}

function liveGeneratedExecJsStatusReason(status) {
  if (status === 1n) {
    return "js-status-runtime-unavailable";
  }
  if (status === 2n) {
    return "js-status-differential-mismatch";
  }
  if (status === 3n) {
    return "js-status-metadata-output-tb-code-mismatch";
  }
  if (status === 4n) {
    return "js-status-generated-output-unavailable";
  }
  if (status === 5n) {
    return "js-status-selected-body-shape-unsupported";
  }
  if (status === 6n) {
    return "js-status-module-emission-failed";
  }
  if (status === 7n) {
    return "js-status-module-validation-failed";
  }
  return "js-status-unknown";
}

function classifyLiveGeneratedExecReject({
  jsStatus = 0n,
  generatedStatus = STATUS_DISPATCH,
  generatedRet = 0x1000n,
  generatedGuestInsns = 4n,
  generatedTciOps = 1n,
  generatedOutputWords = 1n,
  metadataGeneratedOutputOpCount = 1n,
  guestInsns = 4n,
  counters = {},
} = {}) {
  const runCounters = {
    generatedGuestInstructions: guestInsns,
    generatedChainLength: 1n,
    helperCalls: 0n,
    qemuLdCalls: 0n,
    qemuStCalls: 0n,
    exitsMmio: 0n,
    exitsTlbMissOrFault: 0n,
    exitsHelper: 0n,
    exitsUnsupported: 0n,
    exitsInvalidated: 0n,
    ...counters,
  };
  const generatedExitReason = generatedStatusToRunExitReason(generatedStatus);

  function rejected(reason, exitReason = RUN_EXIT_REASON_UNSUPPORTED) {
    return { reason, exitReason: runExitReasonName(exitReason) };
  }

  if (jsStatus !== 0n) {
    return rejected(
      liveGeneratedExecJsStatusReason(jsStatus),
      jsStatus === 3n ?
        RUN_EXIT_REASON_INVALIDATED : RUN_EXIT_REASON_UNSUPPORTED,
    );
  }
  if (runCounters.exitsMmio !== 0n ||
      generatedExitReason === RUN_EXIT_REASON_MMIO) {
    return rejected("mmio-exit", RUN_EXIT_REASON_MMIO);
  }
  if (runCounters.exitsTlbMissOrFault !== 0n ||
      generatedExitReason === RUN_EXIT_REASON_TLB_MISS_OR_FAULT) {
    return rejected(
      "tlb-miss-or-fault-exit",
      RUN_EXIT_REASON_TLB_MISS_OR_FAULT,
    );
  }
  if (runCounters.exitsInvalidated !== 0n ||
      generatedExitReason === RUN_EXIT_REASON_INVALIDATED) {
    return rejected("invalidated", RUN_EXIT_REASON_INVALIDATED);
  }
  if (runCounters.exitsUnsupported !== 0n ||
      generatedExitReason === RUN_EXIT_REASON_UNSUPPORTED) {
    return rejected("unsupported-body-state");
  }
  if (runCounters.exitsHelper !== 0n ||
      generatedExitReason === RUN_EXIT_REASON_HELPER) {
    return rejected("generated-status-helper", RUN_EXIT_REASON_HELPER);
  }
  if (generatedExitReason !== RUN_EXIT_REASON_NONE) {
    return rejected("generated-status-unexpected");
  }
  if (generatedRet === 0n) {
    return rejected("missing-return-target");
  }
  if (generatedGuestInsns !== guestInsns) {
    return rejected("guest-instruction-mismatch");
  }
  if (generatedTciOps === 0n) {
    return rejected("tci-op-count-mismatch");
  }
  if (generatedOutputWords !== metadataGeneratedOutputOpCount) {
    return rejected("generated-output-words-mismatch");
  }
  if (runCounters.generatedGuestInstructions !== guestInsns) {
    return rejected("counter-guest-instruction-mismatch");
  }
  if (runCounters.generatedChainLength !== 1n) {
    return rejected("chain-length-mismatch");
  }
  if (runCounters.helperCalls !== 0n) {
    return rejected("helper-counter-mismatch", RUN_EXIT_REASON_HELPER);
  }
  if (runCounters.qemuLdCalls !== 0n ||
      runCounters.qemuStCalls !== 0n) {
    return rejected("qemu-helper-counter-mismatch");
  }
  return rejected("unsupported-body-state");
}

const liveGeneratedExecRejectClassificationCases = [
  {
    name: "js status",
    input: { jsStatus: 6n },
    expected: {
      reason: "js-status-module-emission-failed",
      exitReason: "unsupported",
    },
  },
  {
    name: "js status invalidation",
    input: { jsStatus: 3n },
    expected: {
      reason: "js-status-metadata-output-tb-code-mismatch",
      exitReason: "invalidated",
    },
  },
  {
    name: "generated status helper",
    input: { generatedStatus: STATUS_HELPER },
    expected: { reason: "generated-status-helper", exitReason: "helper" },
  },
  {
    name: "generated status mmio",
    input: { generatedStatus: STATUS_MMIO },
    expected: { reason: "mmio-exit", exitReason: "mmio" },
  },
  {
    name: "generated status tlb miss or fault",
    input: { generatedStatus: STATUS_TLB_MISS_OR_FAULT },
    expected: {
      reason: "tlb-miss-or-fault-exit",
      exitReason: "tlb-miss-or-fault",
    },
  },
  {
    name: "generated status unexpected",
    input: { generatedStatus: 99n },
    expected: {
      reason: "generated-status-unexpected",
      exitReason: "unsupported",
    },
  },
  {
    name: "missing return target",
    input: { generatedRet: 0n },
    expected: {
      reason: "missing-return-target",
      exitReason: "unsupported",
    },
  },
  {
    name: "guest instruction mismatch",
    input: { generatedGuestInsns: 3n },
    expected: {
      reason: "guest-instruction-mismatch",
      exitReason: "unsupported",
    },
  },
  {
    name: "chain length mismatch",
    input: { counters: { generatedChainLength: 2n } },
    expected: {
      reason: "chain-length-mismatch",
      exitReason: "unsupported",
    },
  },
  {
    name: "helper counter mismatch",
    input: { counters: { helperCalls: 1n } },
    expected: { reason: "helper-counter-mismatch", exitReason: "helper" },
  },
  {
    name: "qemu load helper counter mismatch",
    input: { counters: { qemuLdCalls: 1n } },
    expected: {
      reason: "qemu-helper-counter-mismatch",
      exitReason: "unsupported",
    },
  },
  {
    name: "qemu store helper counter mismatch",
    input: { counters: { qemuStCalls: 1n } },
    expected: {
      reason: "qemu-helper-counter-mismatch",
      exitReason: "unsupported",
    },
  },
  {
    name: "mmio exit",
    input: { counters: { exitsMmio: 1n }, generatedRet: 0n },
    expected: { reason: "mmio-exit", exitReason: "mmio" },
  },
  {
    name: "tlb exit",
    input: {
      counters: { exitsTlbMissOrFault: 1n },
      generatedRet: 0n,
    },
    expected: {
      reason: "tlb-miss-or-fault-exit",
      exitReason: "tlb-miss-or-fault",
    },
  },
  {
    name: "invalidation",
    input: { counters: { exitsInvalidated: 1n } },
    expected: { reason: "invalidated", exitReason: "invalidated" },
  },
  {
    name: "generated status invalidated",
    input: { generatedStatus: STATUS_INVALIDATED },
    expected: { reason: "invalidated", exitReason: "invalidated" },
  },
  {
    name: "unsupported body state",
    input: { generatedStatus: STATUS_UNSUPPORTED },
    expected: {
      reason: "unsupported-body-state",
      exitReason: "unsupported",
    },
  },
  {
    name: "run-exit mmio value is not a generated status",
    input: { generatedStatus: BigInt(RUN_EXIT_REASON_MMIO) },
    expected: {
      reason: "generated-status-unexpected",
      exitReason: "unsupported",
    },
  },
  {
    name: "run-exit invalidated value is not a generated status",
    input: { generatedStatus: BigInt(RUN_EXIT_REASON_INVALIDATED) },
    expected: {
      reason: "generated-status-unexpected",
      exitReason: "unsupported",
    },
  },
  {
    name: "tci op count mismatch",
    input: { generatedTciOps: 0n },
    expected: {
      reason: "tci-op-count-mismatch",
      exitReason: "unsupported",
    },
  },
  {
    name: "generated output words mismatch",
    input: { generatedOutputWords: 2n },
    expected: {
      reason: "generated-output-words-mismatch",
      exitReason: "unsupported",
    },
  },
  {
    name: "counter guest instruction mismatch",
    input: { counters: { generatedGuestInstructions: 3n } },
    expected: {
      reason: "counter-guest-instruction-mismatch",
      exitReason: "unsupported",
    },
  },
];

for (const testCase of liveGeneratedExecRejectClassificationCases) {
  assert.deepEqual(
    classifyLiveGeneratedExecReject(testCase.input),
    testCase.expected,
    testCase.name,
  );
}

const liveGeneratedStatusNamespace = [
  STATUS_EXIT,
  STATUS_DISPATCH,
  STATUS_HELPER,
  STATUS_MMIO,
  STATUS_TLB_MISS_OR_FAULT,
  STATUS_UNSUPPORTED,
  STATUS_INVALIDATED,
  STATUS_BUDGET,
];
assert.equal(
  new Set(liveGeneratedStatusNamespace.map((status) => status.toString())).size,
  liveGeneratedStatusNamespace.length,
  "live generated statuses must be distinct",
);
for (const generatedStatus of liveGeneratedStatusNamespace) {
  for (const runExitReason of [
    RUN_EXIT_REASON_BUDGET,
    RUN_EXIT_REASON_MMIO,
    RUN_EXIT_REASON_TLB_MISS_OR_FAULT,
    RUN_EXIT_REASON_HELPER,
    RUN_EXIT_REASON_UNSUPPORTED,
    RUN_EXIT_REASON_INVALIDATED,
  ]) {
    assert.notEqual(
      generatedStatus,
      BigInt(runExitReason),
      "live generated status must not alias a run-exit reason",
    );
  }
}
assert.deepEqual(
  liveGeneratedStatusNamespace.map((status) =>
    runExitReasonName(generatedStatusToRunExitReason(status))),
  [
    "none",
    "none",
    "helper",
    "mmio",
    "tlb-miss-or-fault",
    "unsupported",
    "invalidated",
    "budget",
  ],
  "live generated status mapper must cover every generated status",
);

const HOTSET_LOCAL_COUNTERS_PTR = 19;
const HOTSET_LOCAL_BUDGET = 20;
const HOTSET_LOCAL_CHAIN_TARGET = 21;

function storeRunExit(reason, tbId, valueExpr) {
  return [
    ...i32Store(localGet(2), i32Const(reason), WASMJIT_RUN_EXIT.reason),
    ...i32Store(localGet(2), i32Const(tbId), WASMJIT_RUN_EXIT.tbId),
    ...i64Store(localGet(2), valueExpr, WASMJIT_RUN_EXIT.value),
  ];
}

function incrementRunCounter(offset) {
  return i64Store(localGet(HOTSET_LOCAL_COUNTERS_PTR), [
    ...i64Load(localGet(HOTSET_LOCAL_COUNTERS_PTR), offset),
    ...i64Const(1n),
    0x7c,
  ], offset);
}

function hotsetFailureReturn({ status, reason, tbId, value, counterOffset }) {
  return [
    ...flushGeneratedRegisterLocals(),
    ...storeRunExit(reason, tbId, value),
    ...incrementRunCounter(counterOffset),
    ...returnExpr(i64Const(status)),
  ];
}

function hotsetInvalidatedReturn(tbId, value = i64Const(0n)) {
  return hotsetFailureReturn({
    status: STATUS_INVALIDATED,
    reason: RUN_EXIT_REASON_INVALIDATED,
    tbId,
    value,
    counterOffset: WASMJIT_COUNTERS.exitsInvalidated,
  });
}

function hotsetGenerationGuard({ actual, expected, tbId, value }) {
  return ifBlock(
    i64NeExpr(actual, i64Const(expected)),
    hotsetInvalidatedReturn(tbId, value),
  );
}

function hotsetTlbMirrorGenerationGuard(expected, tbId) {
  const tlbPtr = i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.tlb));

  return [
    ...ifBlock(
      i32Eqz(tlbPtr),
      hotsetInvalidatedReturn(tbId),
    ),
    ...hotsetGenerationGuard({
      actual: i64Load(tlbPtr, WASMJIT_TLB_MIRROR.generation),
      expected,
      tbId,
    }),
  ];
}

function storeRunCounter(offset, value) {
  return i64Store(localGet(HOTSET_LOCAL_COUNTERS_PTR), i64Const(value), offset);
}

function emitTwoTBHotsetModule(fixture) {
  const diagnostics = {
    emitter: TWO_TB_HOTSET_EMITTER_NAME,
    runtimeUnsupportedGuards: [],
  };

  try {
    const sourceEmission = emitPerTBFunctionBody(
      fixture.source.words, fixture.source.relativeBase);
    const source = compileSharedGeneratedOutputBody(
      fixture.source.words, fixture.source.relativeBase, diagnostics);
    const targetEmission = emitPerTBFunctionBody(
      fixture.target.words, fixture.target.relativeBase);
    const targetSupported = targetEmission.ok;
    const target = targetSupported
      ? compileSharedGeneratedOutputBody(
        fixture.target.words, fixture.target.relativeBase, diagnostics)
      : null;

    if (!sourceEmission.ok) {
      throw new Error(`two-TB hotset source unsupported: ${sourceEmission.reason}`);
    }
    if (source.terminal.kind !== "goto_tb") {
      throw new Error("two-TB hotset source must terminate with goto_tb");
    }
    if (targetSupported && target.terminal.kind !== "exit_tb") {
      throw new Error("two-TB hotset target fixture must terminate with exit_tb");
    }

    const generatedGuestInstructions =
      BigInt(fixture.source.guestInstructions + fixture.target.guestInstructions);
    const generatedBodyTimeNs =
      BigInt(fixture.expectedChainLength) * TWO_TB_HOTSET_BODY_TIME_NS_PER_TB;
    const instructions = [];

    instructions.push(...localSet(
      1, i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.env))));
    instructions.push(...localSet(
      2, i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.exit))));
    instructions.push(...localSet(
      HOTSET_LOCAL_COUNTERS_PTR,
      i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.counters))));
    instructions.push(...localSet(
      HOTSET_LOCAL_BUDGET,
      i64Load(localGet(0), WASMJIT_RUN_CTX.budget)));

    for (let reg = 0; reg < 16; reg++) {
      instructions.push(...localSet(regLocal(reg), i64Load(localGet(1), reg * 8)));
    }

    if (fixture.source.expectedGeneration !== undefined) {
      instructions.push(...hotsetGenerationGuard({
        actual: i64Load(localGet(0), WASMJIT_RUN_CTX.tbGeneration),
        expected: fixture.source.expectedGeneration,
        tbId: fixture.source.id,
      }));
    }
    if (fixture.expectedAddressSpaceGeneration !== undefined) {
      instructions.push(...hotsetGenerationGuard({
        actual: i64Load(localGet(0), WASMJIT_RUN_CTX.addressSpaceGeneration),
        expected: fixture.expectedAddressSpaceGeneration,
        tbId: fixture.source.id,
      }));
    }
    if (fixture.expectedTlbMirrorGeneration !== undefined) {
      instructions.push(...hotsetTlbMirrorGenerationGuard(
        fixture.expectedTlbMirrorGeneration, fixture.source.id));
    }

    instructions.push(...source.body);
    instructions.push(...localSet(
      HOTSET_LOCAL_CHAIN_TARGET, i64Load(i32Const(source.terminal.ret), 0)));
    instructions.push(...ifBlock(
      [...localGet(HOTSET_LOCAL_CHAIN_TARGET),
       ...i64Const(fixture.target.dispatchTarget), 0x52],
      hotsetFailureReturn({
        status: STATUS_UNSUPPORTED,
        reason: RUN_EXIT_REASON_UNSUPPORTED,
        tbId: fixture.source.id,
        value: localGet(HOTSET_LOCAL_CHAIN_TARGET),
        counterOffset: WASMJIT_COUNTERS.exitsUnsupported,
      }),
    ));
    instructions.push(...ifBlock(
      [...localGet(HOTSET_LOCAL_BUDGET), ...i64Const(2n), 0x54],
      hotsetFailureReturn({
        status: STATUS_BUDGET,
        reason: RUN_EXIT_REASON_BUDGET,
        tbId: fixture.target.id,
        value: localGet(HOTSET_LOCAL_CHAIN_TARGET),
        counterOffset: WASMJIT_COUNTERS.exitsBudget,
      }),
    ));
    if (fixture.target.expectedGeneration !== undefined) {
      instructions.push(...hotsetGenerationGuard({
        actual: i64Load(localGet(0), WASMJIT_RUN_CTX.tbGeneration),
        expected: fixture.target.expectedGeneration,
        tbId: fixture.target.id,
        value: localGet(HOTSET_LOCAL_CHAIN_TARGET),
      }));
    }

    if (!targetSupported) {
      instructions.push(...hotsetFailureReturn({
        status: STATUS_UNSUPPORTED,
        reason: RUN_EXIT_REASON_UNSUPPORTED,
        tbId: fixture.target.id,
        value: localGet(HOTSET_LOCAL_CHAIN_TARGET),
        counterOffset: WASMJIT_COUNTERS.exitsUnsupported,
      }));
    } else {
      instructions.push(...target.body);
      instructions.push(...flushGeneratedRegisterLocals());
      instructions.push(...storeRunExit(
        RUN_EXIT_REASON_NONE, fixture.target.id, i64Const(target.terminal.ret)));
      instructions.push(...storeRunCounter(
        WASMJIT_COUNTERS.generatedGuestInstructions, generatedGuestInstructions));
      instructions.push(...storeRunCounter(
        WASMJIT_COUNTERS.generatedBodyTimeNs, generatedBodyTimeNs));
      instructions.push(...storeRunCounter(
        WASMJIT_COUNTERS.generatedChainLength,
        BigInt(fixture.expectedChainLength)));
      instructions.push(...storeRunCounter(
        WASMJIT_COUNTERS.inlineTlbHitLoads, BigInt(fixture.expectedInlineLoads)));
      instructions.push(...storeRunCounter(
        WASMJIT_COUNTERS.inlineTlbHitStores,
        BigInt(fixture.expectedInlineStores)));
      instructions.push(...i64Const(STATUS_EXIT));
    }

    const moduleBytes = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d,
      0x01, 0x00, 0x00, 0x00,
      ...section(1, vector([
        functionType([VALUE_I32], [VALUE_I64]),
        functionType([VALUE_I64, VALUE_I64, VALUE_I64, VALUE_I64],
                     [VALUE_I64]),
        functionType([VALUE_I64, VALUE_I64, VALUE_I64, VALUE_I64, VALUE_I64],
                     []),
      ])),
      ...section(2, vector([
        [...name("env"), ...name("memory"), 0x02, 0x00, 0x01],
        [...name("env"), ...name("qemu_ld_rrr"), 0x00, ...encodeU32(1)],
        [...name("env"), ...name("qemu_st_rrr"), 0x00, ...encodeU32(2)],
      ])),
      ...section(3, vector([[0x00]])),
      ...section(7, vector([[...name("wasmjit_run"), 0x00, ...encodeU32(2)]])),
      ...section(10, vector([functionBody(
        instructions,
        [
          { count: 2, type: VALUE_I32 },
          { count: 16, type: VALUE_I64 },
          { count: 1, type: VALUE_I32 },
          { count: 2, type: VALUE_I64 },
        ],
      )])),
    ]);

    return {
      ok: WebAssembly.validate(moduleBytes),
      emitter: TWO_TB_HOTSET_EMITTER_NAME,
      reason: null,
      moduleBytes,
      moduleByteLength: moduleBytes.length,
      moduleValid: WebAssembly.validate(moduleBytes),
      targetShapeSupported: targetSupported,
      targetUnsupportedReason: targetSupported ? null : targetEmission.reason,
      runtimeUnsupportedGuards: diagnostics.runtimeUnsupportedGuards,
    };
  } catch (error) {
    return {
      ok: false,
      emitter: TWO_TB_HOTSET_EMITTER_NAME,
      reason: failClosedReason(error),
      error: error instanceof Error ? error.message : String(error),
      moduleValid: false,
      targetShapeSupported: false,
    };
  }
}

function createHotsetState(fixture, seed) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  const ctxPtr = 64;
  const regsPtr = 256;
  const countersPtr = 1024;
  const exitPtr = 1408;
  const dataBase = 0x3000 + seed * 0x100;
  const regs = Array.from({ length: 16 }, (_, index) =>
    BigInt(0x1000 + seed * 0x40 + index));
  const sourceTerminal = splitGeneratedOutput(
    fixture.source.words, fixture.source.relativeBase).terminal;

  regs[4] = 0n;
  regs[5] = 0n;
  regs[13] = 0n;
  regs[14] = BigInt(dataBase + 16);

  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.env, BigInt(regsPtr), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.guestRam, 0n, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.budget, BigInt(fixture.budget), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.counters, BigInt(countersPtr), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.exit, BigInt(exitPtr), true);
  view.setUint32(ctxPtr + WASMJIT_RUN_CTX.mode, 1, true);
  view.setUint32(ctxPtr + WASMJIT_RUN_CTX.flags, 0, true);
  view.setUint32(dataBase, 7, true);
  view.setBigUint64(dataBase + 0x10, BigInt(0x400000000 + seed), true);
  view.setBigUint64(dataBase + 0x100, BigInt(0x100000000 + seed), true);
  view.setBigUint64(dataBase + 0x110, BigInt(0x200000000 + seed), true);
  view.setBigUint64(dataBase + 0x118, BigInt(0x300000000 + seed), true);
  view.setBigUint64(sourceTerminal.ret, fixture.slotTarget, true);
  view.setBigUint64(
    ctxPtr + WASMJIT_RUN_CTX.tbGeneration,
    fixture.currentTbGeneration ?? fixture.source.expectedGeneration ?? 0n,
    true,
  );
  view.setBigUint64(
    ctxPtr + WASMJIT_RUN_CTX.addressSpaceGeneration,
    fixture.currentAddressSpaceGeneration ?? 0n,
    true,
  );
  if (fixture.currentTlbMirrorGeneration !== undefined) {
    const mirrorPtr = 0x1800;

    view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.tlb, BigInt(mirrorPtr), true);
    view.setBigUint64(
      mirrorPtr + WASMJIT_TLB_MIRROR.generation,
      fixture.currentTlbMirrorGeneration,
      true,
    );
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.flags,
                   WASMJIT_TLB_MIRROR_VALID, true);
  }

  for (let reg = 0; reg < regs.length; reg++) {
    view.setBigUint64(regsPtr + reg * 8, regs[reg], true);
  }

  return {
    memory,
    view,
    ctxPtr,
    regsPtr,
    countersPtr,
    exitPtr,
    dataBase,
    regs,
    helpers: createHelpers(view),
  };
}

function readHotsetCounters(view, countersPtr) {
  function counter(offset) {
    return view.getBigUint64(countersPtr + offset, true).toString();
  }

  return {
    generatedGuestInstructions:
      counter(WASMJIT_COUNTERS.generatedGuestInstructions),
    generatedBodyTimeNs: counter(WASMJIT_COUNTERS.generatedBodyTimeNs),
    generatedChainLength: counter(WASMJIT_COUNTERS.generatedChainLength),
    inlineTlbHitLoads: counter(WASMJIT_COUNTERS.inlineTlbHitLoads),
    inlineTlbHitStores: counter(WASMJIT_COUNTERS.inlineTlbHitStores),
    helperCalls: counter(WASMJIT_COUNTERS.helperCalls),
    qemuLoadCalls: counter(WASMJIT_COUNTERS.qemuLoadCalls),
    qemuStoreCalls: counter(WASMJIT_COUNTERS.qemuStoreCalls),
    exitsBudget: counter(WASMJIT_COUNTERS.exitsBudget),
    exitsUnsupported: counter(WASMJIT_COUNTERS.exitsUnsupported),
    exitsInvalidated: counter(WASMJIT_COUNTERS.exitsInvalidated),
  };
}

const SOFTMMU_LOCAL_ENV_PTR = 1;
const SOFTMMU_LOCAL_EXIT_PTR = 2;
const SOFTMMU_LOCAL_COUNTERS_PTR = 3;
const SOFTMMU_LOCAL_TLB_PTR = 4;
const SOFTMMU_LOCAL_SLOW_FLAGS = 5;
const SOFTMMU_LOCAL_TADDR = 6;
const SOFTMMU_LOCAL_OI = 7;
const SOFTMMU_LOCAL_MEMOP = 8;
const SOFTMMU_LOCAL_VALUE = 9;
const SOFTMMU_LOCAL_MASK = 10;
const SOFTMMU_LOCAL_TABLE_PTR = 11;
const SOFTMMU_LOCAL_FULLTLB_PTR = 12;
const SOFTMMU_LOCAL_INDEX = 13;
const SOFTMMU_LOCAL_ENTRY_PTR = 14;
const SOFTMMU_LOCAL_FULL_PTR = 15;
const SOFTMMU_LOCAL_COMPARATOR = 16;
const SOFTMMU_LOCAL_ADDEND = 17;
const SOFTMMU_LOCAL_HOST_ADDR = 18;

function softmmuMemOpIdx(memop, mmuIdx = R4K_SOFTMMU_MMU_IDX) {
  return BigInt(
    (memop << TCG_WASM64_MEMOPIDX_SHIFT) |
    (mmuIdx & TCG_WASM64_MEMOPIDX_MMU_MASK),
  );
}

function softmmuAccessSize(memop) {
  const size = memop & MO_SIZE;

  if (size === MO_8) {
    return 1;
  }
  if (size === MO_32) {
    return 4;
  }
  if (size === MO_64) {
    return 8;
  }
  throw new Error(`unsupported fixture memop ${memop}`);
}

function softmmuAccessType(access) {
  return access === "store"
    ? WASMJIT_TLB_CONSTANTS.mmuDataStore
    : WASMJIT_TLB_CONSTANTS.mmuDataLoad;
}

function softmmuComparatorOffset(access) {
  return access === "store"
    ? WASMJIT_TLB_ENTRY.addrWrite
    : WASMJIT_TLB_ENTRY.addrRead;
}

function softmmuCounterSnapshot(view, countersPtr) {
  function counter(offset) {
    return view.getBigUint64(countersPtr + offset, true);
  }

  return {
    generatedGuestInstructions:
      counter(WASMJIT_COUNTERS.generatedGuestInstructions),
    inlineTlbHitLoads: counter(WASMJIT_COUNTERS.inlineTlbHitLoads),
    inlineTlbHitStores: counter(WASMJIT_COUNTERS.inlineTlbHitStores),
    helperCalls: counter(WASMJIT_COUNTERS.helperCalls),
    qemuLdCalls: counter(WASMJIT_COUNTERS.qemuLoadCalls),
    qemuStCalls: counter(WASMJIT_COUNTERS.qemuStoreCalls),
    exitsMmio: counter(WASMJIT_COUNTERS.exitsMmio),
    exitsTlbMissOrFault: counter(WASMJIT_COUNTERS.exitsTlbMissOrFault),
    exitsUnsupported: counter(WASMJIT_COUNTERS.exitsUnsupported),
  };
}

function softmmuIncrementCounter(offset) {
  return i64Store(localGet(SOFTMMU_LOCAL_COUNTERS_PTR), [
    ...i64Load(localGet(SOFTMMU_LOCAL_COUNTERS_PTR), offset),
    ...i64Const(1n),
    0x7c,
  ], offset);
}

function softmmuStoreExit(reason, size, flags) {
  return [
    ...i32Store(localGet(SOFTMMU_LOCAL_EXIT_PTR), i32Const(reason),
                WASMJIT_RUN_EXIT.reason),
    ...i64Store(localGet(SOFTMMU_LOCAL_EXIT_PTR),
                localGet(SOFTMMU_LOCAL_TADDR), WASMJIT_RUN_EXIT.vaddr),
    ...i64Store(localGet(SOFTMMU_LOCAL_EXIT_PTR), i64Const(0n),
                WASMJIT_RUN_EXIT.paddr),
    ...i32Store(localGet(SOFTMMU_LOCAL_EXIT_PTR), i32Const(size),
                WASMJIT_RUN_EXIT.sizeField),
    ...i32Store(localGet(SOFTMMU_LOCAL_EXIT_PTR), i32Const(flags),
                WASMJIT_RUN_EXIT.flags),
  ];
}

function softmmuFailureReturn({ reason, counterOffset, size, flags = 0 }) {
  return [
    ...softmmuStoreExit(reason, size, flags),
    ...softmmuIncrementCounter(counterOffset),
    ...returnExpr(i64Const(generatedStatusForRunExitReason(reason))),
  ];
}

function emitSoftmmuFastPathModule(fixture) {
  const insn = fixture.words[0] >>> 0;
  const opc = bits(insn, 0, 8);
  const r0 = bits(insn, 8, 4);
  const r1 = bits(insn, 12, 4);
  const r2 = bits(insn, 16, 4);
  const access = fixture.access;
  const generatedMemop = fixture.generatedMemop;
  const size = softmmuAccessSize(generatedMemop);
  const accessType = softmmuAccessType(access);
  const unsupportedReturn = softmmuFailureReturn({
    reason: RUN_EXIT_REASON_UNSUPPORTED,
    counterOffset: WASMJIT_COUNTERS.exitsUnsupported,
    size,
  });
  const tlbMissReturn = softmmuFailureReturn({
    reason: RUN_EXIT_REASON_TLB_MISS_OR_FAULT,
    counterOffset: WASMJIT_COUNTERS.exitsTlbMissOrFault,
    size,
  });
  const pageCrossingReturn = softmmuFailureReturn({
    reason: RUN_EXIT_REASON_TLB_MISS_OR_FAULT,
    counterOffset: WASMJIT_COUNTERS.exitsTlbMissOrFault,
    size,
    flags: RUN_EXIT_FLAG_PAGE_CROSSING,
  });
  const mmioReturn = softmmuFailureReturn({
    reason: RUN_EXIT_REASON_MMIO,
    counterOffset: WASMJIT_COUNTERS.exitsMmio,
    size,
  });
  const instructions = [];

  if (access === "load" && opc !== OPS.tci_qemu_ld_rrr) {
    throw new Error(`${fixture.name} must start with tci_qemu_ld_rrr`);
  }
  if (access === "store" && opc !== OPS.tci_qemu_st_rrr) {
    throw new Error(`${fixture.name} must start with tci_qemu_st_rrr`);
  }

  instructions.push(...localSet(
    SOFTMMU_LOCAL_ENV_PTR,
    i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.env))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_EXIT_PTR,
    i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.exit))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_COUNTERS_PTR,
    i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.counters))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_TLB_PTR,
    i32WrapI64(i64Load(localGet(0), WASMJIT_RUN_CTX.tlb))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_TADDR,
    i64Load(localGet(SOFTMMU_LOCAL_ENV_PTR), r1 * 8)));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_OI,
    i64Load(localGet(SOFTMMU_LOCAL_ENV_PTR), r2 * 8)));
  if (access === "store") {
    instructions.push(...localSet(
      SOFTMMU_LOCAL_VALUE,
      i64Load(localGet(SOFTMMU_LOCAL_ENV_PTR), r0 * 8)));
  }
  instructions.push(...ifBlock(
    i32Eqz(localGet(SOFTMMU_LOCAL_TLB_PTR)),
    unsupportedReturn,
  ));
  instructions.push(...ifBlock(
    i32Eqz(i32And(
      i32Load(localGet(SOFTMMU_LOCAL_TLB_PTR),
              WASMJIT_TLB_MIRROR.flags),
      i32Const(WASMJIT_TLB_MIRROR_VALID))),
    unsupportedReturn,
  ));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_MASK,
    i64Load(localGet(SOFTMMU_LOCAL_TLB_PTR), WASMJIT_TLB_MIRROR.mask)));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_TABLE_PTR,
    i64Load(localGet(SOFTMMU_LOCAL_TLB_PTR), WASMJIT_TLB_MIRROR.table)));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_FULLTLB_PTR,
    i64Load(localGet(SOFTMMU_LOCAL_TLB_PTR), WASMJIT_TLB_MIRROR.fulltlb)));
  instructions.push(...ifBlock(
    i64EqExpr(localGet(SOFTMMU_LOCAL_TABLE_PTR), i64Const(0n)),
    unsupportedReturn,
  ));
  instructions.push(...ifBlock(
    i64EqExpr(localGet(SOFTMMU_LOCAL_FULLTLB_PTR), i64Const(0n)),
    unsupportedReturn,
  ));
  instructions.push(...ifBlock(
    i32Ne(
      i32WrapI64(i64AndExpr(
        localGet(SOFTMMU_LOCAL_OI),
        i64Const(BigInt(TCG_WASM64_MEMOPIDX_MMU_MASK)),
      )),
      i32Load(localGet(SOFTMMU_LOCAL_TLB_PTR),
              WASMJIT_TLB_MIRROR.mmuIdx)),
    unsupportedReturn,
  ));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_MEMOP,
    i64ShrUExpr(
      localGet(SOFTMMU_LOCAL_OI),
      i64Const(BigInt(TCG_WASM64_MEMOPIDX_SHIFT)),
    )));
  instructions.push(...ifBlock(
    i64NeExpr(localGet(SOFTMMU_LOCAL_MEMOP), i64Const(BigInt(generatedMemop))),
    unsupportedReturn,
  ));
  instructions.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(
        i64XorExpr(
          localGet(SOFTMMU_LOCAL_TADDR),
          i64AddExpr(localGet(SOFTMMU_LOCAL_TADDR),
                     i64Const(BigInt(size - 1)))),
        i64Const(R4K_SOFTMMU_PAGE_MASK)),
      i64Const(0n)),
    pageCrossingReturn,
  ));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_INDEX,
    i64AndExpr(
      i64ShrUExpr(localGet(SOFTMMU_LOCAL_TADDR),
                  i64Const(BigInt(R4K_SOFTMMU_PAGE_BITS))),
      i64ShrUExpr(localGet(SOFTMMU_LOCAL_MASK),
                  i64Const(BigInt(R4K_SOFTMMU_TLB_ENTRY_BITS))))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_ENTRY_PTR,
    i64AddExpr(
      localGet(SOFTMMU_LOCAL_TABLE_PTR),
      i64ShlExpr(localGet(SOFTMMU_LOCAL_INDEX),
                 i64Const(BigInt(R4K_SOFTMMU_TLB_ENTRY_BITS))))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_FULL_PTR,
    i64AddExpr(
      localGet(SOFTMMU_LOCAL_FULLTLB_PTR),
      i64MulExpr(localGet(SOFTMMU_LOCAL_INDEX),
                 i64Const(BigInt(WASMJIT_TLB_ENTRY_FULL.size))))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_COMPARATOR,
    i64Load(i32WrapI64(localGet(SOFTMMU_LOCAL_ENTRY_PTR)),
            softmmuComparatorOffset(access))));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_ADDEND,
    i64Load(i32WrapI64(localGet(SOFTMMU_LOCAL_ENTRY_PTR)),
            WASMJIT_TLB_ENTRY.addend)));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_SLOW_FLAGS,
    i32Load8U(
      i32WrapI64(localGet(SOFTMMU_LOCAL_FULL_PTR)),
      WASMJIT_TLB_ENTRY_FULL.slowFlags + accessType)));
  instructions.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SOFTMMU_LOCAL_COMPARATOR),
                 i64Const(R4K_SOFTMMU_PAGE_MASK)),
      i64AndExpr(localGet(SOFTMMU_LOCAL_TADDR),
                 i64Const(R4K_SOFTMMU_PAGE_MASK))),
    tlbMissReturn,
  ));
  instructions.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SOFTMMU_LOCAL_COMPARATOR),
                 i64Const(WASMJIT_TLB_CONSTANTS.invalidMask)),
      i64Const(0n)),
    tlbMissReturn,
  ));
  instructions.push(...ifBlock(
    i32Ne(
      i32And(localGet(SOFTMMU_LOCAL_SLOW_FLAGS),
             i32Const(WASMJIT_TLB_CONSTANTS.mmio)),
      i32Const(0)),
    mmioReturn,
  ));
  instructions.push(...ifBlock(
    i64NeExpr(
      i64AndExpr(localGet(SOFTMMU_LOCAL_COMPARATOR),
                 i64Const(WASMJIT_TLB_CONSTANTS.flagsMask)),
      i64Const(0n)),
    unsupportedReturn,
  ));
  instructions.push(...ifBlock(
    i32Ne(
      i32And(localGet(SOFTMMU_LOCAL_SLOW_FLAGS),
             i32Const(WASMJIT_TLB_CONSTANTS.slowFlagsMask)),
      i32Const(0)),
    unsupportedReturn,
  ));
  instructions.push(...localSet(
    SOFTMMU_LOCAL_HOST_ADDR,
    i64AddExpr(localGet(SOFTMMU_LOCAL_TADDR),
               localGet(SOFTMMU_LOCAL_ADDEND))));

  if (access === "load") {
    const generatedSize = generatedMemop & MO_SIZE;
    const loaded = generatedSize === MO_32
      ? i64ExtendI32U(i32Load(i32WrapI64(localGet(SOFTMMU_LOCAL_HOST_ADDR))))
      : i64Load(i32WrapI64(localGet(SOFTMMU_LOCAL_HOST_ADDR)));

    instructions.push(...i64Store(
      localGet(SOFTMMU_LOCAL_ENV_PTR), loaded, r0 * 8));
    instructions.push(...softmmuIncrementCounter(
      WASMJIT_COUNTERS.inlineTlbHitLoads));
  } else {
    const generatedSize = generatedMemop & MO_SIZE;

    if (generatedSize === MO_8) {
      instructions.push(...i32Store8(
        i32WrapI64(localGet(SOFTMMU_LOCAL_HOST_ADDR)),
        i32WrapI64(localGet(SOFTMMU_LOCAL_VALUE))));
    } else if (generatedSize === MO_32) {
      instructions.push(...i32Store(
        i32WrapI64(localGet(SOFTMMU_LOCAL_HOST_ADDR)),
        i32WrapI64(localGet(SOFTMMU_LOCAL_VALUE))));
    } else {
      instructions.push(...i64Store(
        i32WrapI64(localGet(SOFTMMU_LOCAL_HOST_ADDR)),
        localGet(SOFTMMU_LOCAL_VALUE)));
    }
    instructions.push(...softmmuIncrementCounter(
      WASMJIT_COUNTERS.inlineTlbHitStores));
  }

  instructions.push(...softmmuIncrementCounter(
    WASMJIT_COUNTERS.generatedGuestInstructions));
  instructions.push(...i32Store(localGet(SOFTMMU_LOCAL_EXIT_PTR),
                                i32Const(RUN_EXIT_REASON_NONE),
                                WASMJIT_RUN_EXIT.reason));
  instructions.push(...i64Const(STATUS_EXIT));

  const moduleBytes = Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([
      functionType([VALUE_I32], [VALUE_I64]),
    ])),
    ...section(2, vector([
      [...name("env"), ...name("memory"), 0x02, 0x00, 0x01],
    ])),
    ...section(3, vector([[0x00]])),
    ...section(7, vector([[...name("wasmjit_run"), 0x00, ...encodeU32(0)]])),
    ...section(10, vector([functionBody(
      instructions,
      [
        { count: 5, type: VALUE_I32 },
        { count: 13, type: VALUE_I64 },
      ],
    )])),
  ]);

  return {
    ok: WebAssembly.validate(moduleBytes),
    emitter: fixture.emitterName || R4K_SOFTMMU_EMITTER_NAME,
    moduleBytes,
    moduleByteLength: moduleBytes.length,
    moduleValid: WebAssembly.validate(moduleBytes),
    access,
    generatedMemop,
  };
}

function createSoftmmuState(fixture) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  const ctxPtr = 64;
  const regsPtr = 0x400;
  const countersPtr = 0x800;
  const exitPtr = 0xa00;
  const mirrorPtr = 0x1800;
  const tablePtr = 0x2000;
  const fulltlbPtr = 0x2800;
  const hostPage = 0x5000n;
  const taddr = fixture.taddr || 0x1238n;
  const page = taddr & R4K_SOFTMMU_PAGE_MASK;
  const addend = hostPage - page;
  const hostAddr = Number(taddr + addend);
  const mask = fixture.mask ?? ((4 - 1) << R4K_SOFTMMU_TLB_ENTRY_BITS);
  const index = Number(
    (taddr >> BigInt(R4K_SOFTMMU_PAGE_BITS)) &
    (BigInt(mask) >> BigInt(R4K_SOFTMMU_TLB_ENTRY_BITS)));
  const entryPtr = tablePtr + index * WASMJIT_TLB_ENTRY.size;
  const fullPtr = fulltlbPtr + index * WASMJIT_TLB_ENTRY_FULL.size;
  const access = fixture.access;
  const comparatorOffset = softmmuComparatorOffset(access);
  const comparator = fixture.comparator ??
    (page | BigInt(fixture.comparatorFlags || 0));
  const slowFlags = fixture.slowFlags || 0;
  const oiMemop = fixture.oiMemop ?? fixture.generatedMemop;
  const oiMmuIdx = fixture.oiMmuIdx ?? R4K_SOFTMMU_MMU_IDX;
  const oi = softmmuMemOpIdx(oiMemop, oiMmuIdx);
  const regs = Array.from({ length: 16 }, (_, reg) =>
    BigInt(0x100 + reg));

  regs[0] = fixture.storeValue ?? 0x1122334455667788n;
  regs[1] = taddr;
  regs[2] = oi;
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.env, BigInt(regsPtr), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.guestRam, 0n, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.budget, 1n, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.counters,
                    BigInt(countersPtr), true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.exit, BigInt(exitPtr), true);
  view.setUint32(ctxPtr + WASMJIT_RUN_CTX.mode, 1, true);
  view.setUint32(ctxPtr + WASMJIT_RUN_CTX.flags, 0, true);
  view.setBigUint64(ctxPtr + WASMJIT_RUN_CTX.tlb,
                    fixture.tlbPointer === 0 ? 0n : BigInt(mirrorPtr), true);

  if (fixture.tlbPointer !== 0) {
    view.setBigUint64(mirrorPtr + WASMJIT_TLB_MIRROR.mask,
                      BigInt(mask), true);
    view.setBigUint64(mirrorPtr + WASMJIT_TLB_MIRROR.table,
                      BigInt(fixture.tablePointer === 0 ? 0 : tablePtr), true);
    view.setBigUint64(mirrorPtr + WASMJIT_TLB_MIRROR.fulltlb,
                      BigInt(fixture.fulltlbPointer === 0 ? 0 : fulltlbPtr),
                      true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.mmuIdx,
                   fixture.mirrorMmuIdx ?? R4K_SOFTMMU_MMU_IDX, true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.targetPageBits,
                   fixture.mirrorTargetPageBits ?? R4K_SOFTMMU_PAGE_BITS,
                   true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.cpuTlbEntryBits,
                   fixture.mirrorCpuTlbEntryBits ??
                     R4K_SOFTMMU_TLB_ENTRY_BITS,
                   true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.tlbEntrySize,
                   fixture.mirrorTlbEntrySize ?? WASMJIT_TLB_ENTRY.size, true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.tlbFlagsMask,
                   fixture.mirrorTlbFlagsMask ??
                     Number(WASMJIT_TLB_CONSTANTS.flagsMask),
                   true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.tlbSlowFlagsMask,
                   fixture.mirrorTlbSlowFlagsMask ??
                     WASMJIT_TLB_CONSTANTS.slowFlagsMask,
                   true);
    view.setUint32(mirrorPtr + WASMJIT_TLB_MIRROR.flags,
                   fixture.mirrorFlags ?? WASMJIT_TLB_MIRROR_VALID, true);
  }
  view.setBigUint64(entryPtr + WASMJIT_TLB_ENTRY.addrRead, page, true);
  view.setBigUint64(entryPtr + WASMJIT_TLB_ENTRY.addrWrite, page, true);
  view.setBigUint64(entryPtr + comparatorOffset, comparator, true);
  view.setBigUint64(entryPtr + WASMJIT_TLB_ENTRY.addend, addend, true);
  view.setUint8(fullPtr + WASMJIT_TLB_ENTRY_FULL.slowFlags +
                softmmuAccessType(access), slowFlags);
  if (fixture.initialRam64 !== undefined) {
    view.setBigUint64(hostAddr, fixture.initialRam64, true);
  } else {
    view.setBigUint64(hostAddr, 0x8877665544332211n, true);
  }
  if (fixture.initialRam32 !== undefined) {
    view.setUint32(hostAddr, fixture.initialRam32, true);
  }
  for (let reg = 0; reg < regs.length; reg++) {
    view.setBigUint64(regsPtr + reg * 8, regs[reg], true);
  }

  return {
    memory,
    view,
    ctxPtr,
    regsPtr,
    countersPtr,
    exitPtr,
    hostAddr,
    taddr,
    size: softmmuAccessSize(fixture.generatedMemop),
  };
}

function readSoftmmuExit(view, exitPtr) {
  const reason = view.getUint32(exitPtr + WASMJIT_RUN_EXIT.reason, true);

  return {
    reason,
    reasonName: runExitReasonName(reason),
    vaddr: view.getBigUint64(exitPtr + WASMJIT_RUN_EXIT.vaddr, true),
    size: view.getUint32(exitPtr + WASMJIT_RUN_EXIT.sizeField, true),
    flags: view.getUint32(exitPtr + WASMJIT_RUN_EXIT.flags, true),
  };
}

function applySoftmmuReferenceRamAccess(state, fixture) {
  const value = state.view.getBigUint64(state.regsPtr, true);
  const generatedSize = fixture.generatedMemop & MO_SIZE;

  if (fixture.access === "load") {
    if (generatedSize === MO_8) {
      state.view.setBigUint64(
        state.regsPtr, BigInt(state.view.getUint8(state.hostAddr)), true);
    } else if (generatedSize === MO_32) {
      state.view.setBigUint64(
        state.regsPtr, BigInt(state.view.getUint32(state.hostAddr, true)),
        true);
    } else if (generatedSize === MO_64) {
      state.view.setBigUint64(
        state.regsPtr, state.view.getBigUint64(state.hostAddr, true), true);
    } else {
      throw new Error(`unsupported reference load memop ${fixture.generatedMemop}`);
    }
    return;
  }

  if (generatedSize === MO_8) {
    state.view.setUint8(state.hostAddr, Number(value & 0xffn));
  } else if (generatedSize === MO_32) {
    state.view.setUint32(
      state.hostAddr, Number(value & 0xffffffffn), true);
  } else if (generatedSize === MO_64) {
    state.view.setBigUint64(state.hostAddr, value, true);
  } else {
    throw new Error(`unsupported reference store memop ${fixture.generatedMemop}`);
  }
}

async function runSoftmmuFixture(fixture) {
  const relativeBase = fixture.relativeBase ?? 0x7000;
  const fixtureEmitter = fixture.emitterName || R4K_SOFTMMU_EMITTER_NAME;
  const useGenericSoftmmuLowering =
    fixtureEmitter === R4K_SOFTMMU_EMITTER_NAME;
  const emission = useGenericSoftmmuLowering
    ? emitPerTBFunctionBody(fixture.words, relativeBase)
    : emitSoftmmuFastPathModule(fixture);

  assert.equal(emission.ok, true, `${fixture.name} softmmu emitter failed`);
  if (useGenericSoftmmuLowering) {
    assert.equal(emission.emitter, PER_TB_EMITTER_NAME);
    assert.equal(emission.softmmuLowering, SHARED_SOFTMMU_LOWERING_NAME);
    assert.equal(emission.softmmuLoweredOps, 1);
  } else {
    assert.equal(emission.emitter, fixtureEmitter);
  }
  assert.equal(emission.moduleValid, true,
               `${fixture.name} emitted invalid softmmu module`);
  const state = createSoftmmuState(fixture);
  const reference = createSoftmmuState(fixture);
  const beforeRam64 = state.view.getBigUint64(state.hostAddr, true);
  const beforeReg0 = state.view.getBigUint64(state.regsPtr, true);
  const compiled = await WebAssembly.compile(emission.moduleBytes);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      memory: state.memory,
    },
  });
  const status = useGenericSoftmmuLowering
    ? instance.exports.run(state.ctxPtr)
    : instance.exports.wasmjit_run(state.ctxPtr);
  const counters = softmmuCounterSnapshot(state.view, state.countersPtr);
  const exit = readSoftmmuExit(state.view, state.exitPtr);
  const afterRam64 = state.view.getBigUint64(state.hostAddr, true);
  const afterReg0 = state.view.getBigUint64(state.regsPtr, true);
  let helperVisibleStateMatched = null;

  assert.equal(status, fixture.expectedStatus,
               `${fixture.name} status mismatch`);
  assert.equal(exit.reasonName, fixture.expectedRunExitReason,
               `${fixture.name} run exit reason mismatch`);
  assert.equal(counters.inlineTlbHitLoads,
               BigInt(fixture.expectedInlineLoads || 0),
               `${fixture.name} inline load count mismatch`);
  assert.equal(counters.inlineTlbHitStores,
               BigInt(fixture.expectedInlineStores || 0),
               `${fixture.name} inline store count mismatch`);
  assert.equal(counters.helperCalls, 0n);
  assert.equal(counters.qemuLdCalls, 0n);
  assert.equal(counters.qemuStCalls, 0n);
  assert.equal(counters.exitsMmio, BigInt(fixture.expectedExitsMmio || 0));
  assert.equal(counters.exitsTlbMissOrFault,
               BigInt(fixture.expectedExitsTlbMissOrFault || 0));
  assert.equal(counters.exitsUnsupported,
               BigInt(fixture.expectedExitsUnsupported || 0));
  assert.equal(exit.flags, fixture.expectedExitFlags || 0);
  if (fixture.expectedReg0 !== undefined) {
    assert.equal(afterReg0, fixture.expectedReg0,
                 `${fixture.name} loaded register mismatch`);
  } else if (!fixture.expectedSuccess) {
    assert.equal(afterReg0, beforeReg0,
                 `${fixture.name} failed path must not modify reg0`);
  }
  if (fixture.expectedRam64 !== undefined) {
    assert.equal(afterRam64, fixture.expectedRam64,
                 `${fixture.name} RAM value mismatch`);
  } else if (!fixture.expectedSuccess) {
    assert.equal(afterRam64, beforeRam64,
                 `${fixture.name} failed path must not touch RAM`);
  }
  if (fixture.expectedSuccess) {
    applySoftmmuReferenceRamAccess(reference, fixture);
    helperVisibleStateMatched =
      state.view.getBigUint64(state.regsPtr, true) ===
        reference.view.getBigUint64(reference.regsPtr, true) &&
      state.view.getBigUint64(state.hostAddr, true) ===
        reference.view.getBigUint64(reference.hostAddr, true);
    assert.equal(helperVisibleStateMatched, true,
                 `${fixture.name} inline path diverged from helper RAM path`);
  }

  return {
    name: fixture.name,
    emitter: emission.emitter,
    softmmuLowering: emission.softmmuLowering,
    softmmuLoweredOps: emission.softmmuLoweredOps,
    moduleValid: emission.moduleValid,
    moduleByteLength: emission.moduleByteLength,
    access: fixture.access,
    generatedMemop: fixture.generatedMemop,
    status: status.toString(),
    runExitReason: exit.reasonName,
    fallbackReason: fixture.fallbackReason,
    exitFlags: exit.flags,
    expectedSuccess: fixture.expectedSuccess,
    helperVisibleStateMatched,
    inlineTlbHitLoads: counters.inlineTlbHitLoads.toString(),
    inlineTlbHitStores: counters.inlineTlbHitStores.toString(),
    helperCalls: counters.helperCalls.toString(),
    qemuLdCalls: counters.qemuLdCalls.toString(),
    qemuStCalls: counters.qemuStCalls.toString(),
    exits: {
      mmio: counters.exitsMmio.toString(),
      tlbMissOrFault: counters.exitsTlbMissOrFault.toString(),
      unsupported: counters.exitsUnsupported.toString(),
    },
    failClosedBeforeRamAccess: !fixture.expectedSuccess
      ? afterRam64 === beforeRam64
      : null,
  };
}

function captureHotsetState(state) {
  const exitReason = state.view.getUint32(
    state.exitPtr + WASMJIT_RUN_EXIT.reason, true);

  return {
    regs: Array.from({ length: 16 }, (_, reg) =>
      state.view.getBigUint64(state.regsPtr + reg * 8, true).toString()),
    data: [
      state.view.getUint32(state.dataBase, true),
      state.view.getBigUint64(state.dataBase + 0x10, true).toString(),
      state.view.getBigUint64(state.dataBase + 0x100, true).toString(),
      state.view.getBigUint64(state.dataBase + 0x110, true).toString(),
      state.view.getBigUint64(state.dataBase + 0x118, true).toString(),
    ],
    exit: {
      reason: exitReason,
      reasonName: runExitReasonName(exitReason),
      tbId: state.view.getUint32(state.exitPtr + WASMJIT_RUN_EXIT.tbId, true),
      value: state.view.getBigUint64(
        state.exitPtr + WASMJIT_RUN_EXIT.value, true).toString(),
    },
    counters: readHotsetCounters(state.view, state.countersPtr),
    helpers: {
      calls: state.helpers.calls,
      loads: state.helpers.calls.filter((call) => call.kind === "ld").length,
      stores: state.helpers.calls.filter((call) => call.kind === "st").length,
    },
  };
}

function writeReferenceRegs(state, regs) {
  for (let reg = 0; reg < regs.length; reg++) {
    state.view.setBigUint64(state.regsPtr + reg * 8, regs[reg], true);
  }
}

async function runTwoTBHotsetFixture(fixture, seed) {
  const emission = emitTwoTBHotsetModule(fixture);

  assert.equal(emission.ok, true, `${fixture.name} hotset emitter failed`);
  assert.equal(emission.moduleValid, true,
               `${fixture.name} emitted invalid hotset module`);
  const generated = createHotsetState(fixture, seed);
  const sourceProbe = createHotsetState(fixture, seed);
  const sourceExpected = interpretGeneratedOutput(
    fixture.source.words, sourceProbe, fixture.source.relativeBase);
  let reference = fixture.expectedState === "initial"
    ? createHotsetState(fixture, seed)
    : sourceProbe;
  let finalExpected = fixture.expectedState === "initial"
    ? { regs: reference.regs.slice() }
    : sourceExpected;
  let expectedState = fixture.expectedState || "after-source-tb";

  assert.equal(sourceExpected.status, STATUS_DISPATCH,
               `${fixture.name} source TB should dispatch`);
  if (fixture.expectedSuccess) {
    assert.equal(sourceExpected.ret, fixture.target.dispatchTarget,
                 `${fixture.name} source dispatch target mismatch`);
    reference.regs = sourceExpected.regs.slice();
    finalExpected = interpretGeneratedOutput(
      fixture.target.words, reference, fixture.target.relativeBase);
    expectedState = "after-chained-target";
  }
  writeReferenceRegs(reference, finalExpected.regs);

  const compiled = await WebAssembly.compile(emission.moduleBytes);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      memory: generated.memory,
      qemu_ld_rrr: generated.helpers.qemuLd,
      qemu_st_rrr: generated.helpers.qemuSt,
    },
  });
  const status = instance.exports.wasmjit_run(generated.ctxPtr);
  const generatedState = captureHotsetState(generated);
  const referenceState = captureHotsetState(reference);

  assert.equal(status, fixture.expectedStatus,
               `${fixture.name} generated status mismatch`);
  assert.deepEqual(
    { regs: generatedState.regs, data: generatedState.data },
    { regs: referenceState.regs, data: referenceState.data },
    `${fixture.name} generated state mismatch`,
  );
  assert.equal(generatedState.counters.generatedGuestInstructions,
               fixture.expectedGeneratedGuestInstructions.toString());
  assert.equal(generatedState.counters.generatedChainLength,
               fixture.expectedGeneratedChainLength.toString());
  assert.equal(generatedState.counters.generatedBodyTimeNs,
               fixture.expectedGeneratedBodyTimeNs.toString());
  assert.equal(generatedState.counters.helperCalls, "0");
  assert.equal(generatedState.counters.qemuLoadCalls, "0");
  assert.equal(generatedState.counters.qemuStoreCalls, "0");
  assert.equal(generatedState.helpers.loads, 0);
  assert.equal(generatedState.helpers.stores, 0);
  assert.equal(generatedState.exit.reasonName, fixture.expectedRunExitReason);
  assert.equal(emission.targetShapeSupported, fixture.expectedTargetShapeSupported);

  return {
    name: fixture.name,
    seed,
    success: fixture.expectedSuccess,
    expectedState,
    generatedModuleCalls: 1,
    status: status.toString(),
    runExitReason: generatedState.exit.reasonName,
    fallbackReason: fixture.expectedFallbackReason,
    sourceDispatchTarget: sourceExpected.ret.toString(),
    targetDispatchTarget: fixture.target.dispatchTarget.toString(),
    registerStateMatched: true,
    memoryStateMatched: true,
    targetShapeSupported: emission.targetShapeSupported,
    targetUnsupportedReason: emission.targetUnsupportedReason,
    moduleValid: emission.moduleValid,
    moduleByteLength: emission.moduleByteLength,
    generatedGuestInstructions:
      generatedState.counters.generatedGuestInstructions,
    generatedChainLength: generatedState.counters.generatedChainLength,
    generatedBodyTimeNs: generatedState.counters.generatedBodyTimeNs,
    deterministicBodyTime: "one-thousand-ns-per-generated-TB-stand-in",
    inlineTlbHitLoads: generatedState.counters.inlineTlbHitLoads,
    inlineTlbHitStores: generatedState.counters.inlineTlbHitStores,
    helperCalls: generatedState.counters.helperCalls,
    qemuLdCalls: generatedState.counters.qemuLoadCalls,
    qemuStCalls: generatedState.counters.qemuStoreCalls,
    exits: {
      budget: generatedState.counters.exitsBudget,
      unsupported: generatedState.counters.exitsUnsupported,
      invalidated: generatedState.counters.exitsInvalidated,
    },
  };
}

const fixtures = [
  {
    name: "live-x86-pre-r4i-ld32u-goto-tb-13",
    terminal: "goto_tb",
    relativeBase: 0x4000,
    words: [
      0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
      0x0000147d, 0xfff4e435, 0x0100e41e, 0xfff9057d,
      0x00054407, 0x0100e438, 0xfff74049, 0xfff10048,
      0xfff0f048,
    ],
  },
  {
    name: "live-x86-r4i-ld32u-goto-tb-11",
    terminal: "goto_tb",
    relativeBase: 0x4400,
    seeds: [1],
    guestInstructions: 1,
    words: [
      0xfff0e41c, 0x0000057d, 0x00254d88, 0x00020d04,
      0x0000147d, 0xfff4e435, 0x0100e41e, 0xfff9057d,
      0x00054407, 0x0100e438, 0xfff74049,
    ],
  },
  {
    name: "trace-goto-16",
    terminal: "goto_tb",
    relativeBase: 0x4800,
    words: [
      0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
      0xfff4e535, 0x0000047d, 0x0000e438, 0x0000147d,
      0xfff4e435, 0x0100e41e, 0x0000a57d, 0x00054407,
      0x0100e438, 0xfff68049, 0xfff04048, 0xfff03048,
    ],
  },
  {
    name: "trace-exit-terminal",
    terminal: "exit_tb",
    relativeBase: 0x5000,
    words: [
      0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
      0x0000147d, 0xfff4e435, 0xfff10048,
    ],
  },
  {
    name: "shift-and-extract-validate",
    terminal: "exit_tb",
    relativeBase: 0x5600,
    words: [
      OPS.tci_movi | (1 << 8) | (3 << 12),
      OPS.shl | (2 << 8) | (4 << 12) | (1 << 16),
      OPS.shr | (3 << 8) | (2 << 12) | (1 << 16),
      OPS.extract | (4 << 8) | (3 << 12) | (4 << 16) | (16 << 22),
      OPS.sextract | (5 << 8) | (3 << 12) | (4 << 16) | (16 << 22),
      OPS.exit_tb,
    ],
  },
  {
    name: "simple-gap-ops-validate",
    terminal: "exit_tb",
    relativeBase: 0x5700,
    words: [
      OPS.ld32s | (6 << 8) | (14 << 12) | (0xfff0 << 16),
      OPS.deposit | (7 << 8) | (6 << 12) | (5 << 16) |
        (8 << 20) | (16 << 26),
      OPS.neg | (8 << 8) | (7 << 12),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-boot-move-logic-family",
    terminal: "goto_tb",
    relativeBase: 0x5900,
    guestInstructions: 5,
    words: [
      opImm20(OPS.tci_movi, 1, 0x123),
      opImm20(OPS.tci_movl, 9, 0),
      opImm20(OPS.tci_movi, 2, 0x55),
      opReg(OPS.mov, 3, 1),
      opReg(OPS.or, 4, 3, 2),
      opReg(OPS.xor, 5, 4, 2),
      opReg(OPS.and, 6, 4, 2),
      opReg(OPS.sub, 7, 5, 6),
      opReg(OPS.mul, 8, 7, 2),
      OPS.mb,
      opImm20(OPS.goto_tb, 0, -36),
    ],
  },
  {
    name: "rv64-boot-setcond-branch-family",
    terminal: "exit_tb",
    relativeBase: 0x5a00,
    words: [
      opImm20(OPS.tci_movi, 1, 3),
      opImm20(OPS.tci_movi, 2, 9),
      opSetcond(OPS.setcond, 3, 1, 2, 10),
      opBranch(3, 4),
      opImm20(OPS.tci_movi, 4, 99),
      opImm20(OPS.tci_movi, 4, 7),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-env-relative-load-store-family",
    terminal: "exit_tb",
    relativeBase: 0x5b00,
    words: [
      opMem(OPS.ld32u, 1, RV64_ENV_RELATIVE_BASE_REG, -16),
      opMem(OPS.ld32s, 2, RV64_ENV_RELATIVE_BASE_REG, -16),
      opMem(OPS.ld, 3, RV64_ENV_RELATIVE_BASE_REG, 0),
      opImm20(OPS.tci_movi, 4, 0x55),
      opMem(OPS.st8, 4, RV64_ENV_RELATIVE_BASE_REG, -12),
      opMem(OPS.st32, 1, RV64_ENV_RELATIVE_BASE_REG, 0x100),
      opMem(OPS.st, 3, RV64_ENV_RELATIVE_BASE_REG, 0x108),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-call-exit-prefix-family",
    terminal: "helper",
    relativeBase: 0x5e00,
    words: [
      opImm20(OPS.tci_movi, 1, 0x21),
      opImm20(OPS.tci_movi, 2, 0x22),
      opReg(OPS.add, 3, 1, 2),
      opCall(0),
      OPS.deposit,
      OPS.exit_tb,
    ],
  },
];

const liveX86Fixture = fixtures.find((fixture) =>
  fixture.name === "live-x86-pre-r4i-ld32u-goto-tb-13");
assert.deepEqual(
  decodedShape(liveX86Fixture.words),
  PRE_R4I_LIVE_X86_SHAPE,
  "pre-R4i live x86 fixture shape drifted",
);
const r4iLiveX86Fixture = fixtures.find((fixture) =>
  fixture.name === "live-x86-r4i-ld32u-goto-tb-11");
assert.deepEqual(
  decodedShape(r4iLiveX86Fixture.words),
  R4I_LIVE_X86_SHAPE,
  "R4i live x86 fixture shape drifted",
);

const R4K_TWO_TB_HOTSET_DISPATCH_TARGET = 0x7200n;
const r4kTwoTBHotsetSource = {
  id: 1,
  name: "r4k-two-tb-source-r4i-goto",
  relativeBase: 0x6000,
  words: r4iLiveX86Fixture.words,
  expectedGeneration: R4K_INVALIDATION_TB_GENERATION,
  guestInstructions: 1,
};

function r4kTwoTBHotsetTarget(overrides = {}) {
  return {
    id: 2,
    name: "r4k-two-tb-target-add-exit",
    relativeBase: 0x6400,
    dispatchTarget: R4K_TWO_TB_HOTSET_DISPATCH_TARGET,
    expectedGeneration: R4K_INVALIDATION_TB_GENERATION,
    guestInstructions: 1,
    words: [
      OPS.tci_movi | (6 << 8) | (2 << 12),
      OPS.add | (4 << 8) | (4 << 12) | (6 << 16),
      OPS.exit_tb,
    ],
    ...overrides,
  };
}

const R4K_TWO_TB_HOTSET_BODY_TIME_NS =
  2n * TWO_TB_HOTSET_BODY_TIME_NS_PER_TB;
const r4kTwoTBHotsetFixtures = [
  {
    name: "r4k-two-tb-chained-hit",
    source: r4kTwoTBHotsetSource,
    target: r4kTwoTBHotsetTarget(),
    slotTarget: R4K_TWO_TB_HOTSET_DISPATCH_TARGET,
    budget: 2,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedFallbackReason: null,
    expectedTargetShapeSupported: true,
    expectedChainLength: 2,
    expectedInlineLoads: 2,
    expectedInlineStores: 2,
    expectedGeneratedGuestInstructions: 2,
    expectedGeneratedChainLength: 2,
    expectedGeneratedBodyTimeNs: R4K_TWO_TB_HOTSET_BODY_TIME_NS,
  },
  {
    name: "r4k-two-tb-missing-chained-target",
    source: r4kTwoTBHotsetSource,
    target: r4kTwoTBHotsetTarget(),
    slotTarget: 0x7777n,
    budget: 2,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedFallbackReason: "missing-chain-target",
    expectedTargetShapeSupported: true,
    expectedChainLength: 2,
    expectedInlineLoads: 2,
    expectedInlineStores: 2,
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  },
  {
    name: "r4k-two-tb-unsupported-chained-target-shape",
    source: r4kTwoTBHotsetSource,
    target: r4kTwoTBHotsetTarget({
      name: "r4k-two-tb-target-helper-unsupported",
      words: [
        OPS.call,
        OPS.exit_tb,
      ],
    }),
    slotTarget: R4K_TWO_TB_HOTSET_DISPATCH_TARGET,
    budget: 2,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedFallbackReason: "unsupported-chain-target-shape",
    expectedTargetShapeSupported: false,
    expectedChainLength: 2,
    expectedInlineLoads: 2,
    expectedInlineStores: 2,
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  },
  {
    name: "r4k-two-tb-budget-before-second-tb",
    source: r4kTwoTBHotsetSource,
    target: r4kTwoTBHotsetTarget(),
    slotTarget: R4K_TWO_TB_HOTSET_DISPATCH_TARGET,
    budget: 1,
    expectedSuccess: false,
    expectedStatus: STATUS_BUDGET,
    expectedRunExitReason: "budget",
    expectedFallbackReason: "budget-before-second-tb",
    expectedTargetShapeSupported: true,
    expectedChainLength: 2,
    expectedInlineLoads: 2,
    expectedInlineStores: 2,
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  },
  {
    name: "r4k-two-tb-invalidated-chained-target",
    source: r4kTwoTBHotsetSource,
    target: r4kTwoTBHotsetTarget({
      expectedGeneration: R4K_INVALIDATION_TB_GENERATION + 1n,
    }),
    slotTarget: R4K_TWO_TB_HOTSET_DISPATCH_TARGET,
    budget: 2,
    expectedSuccess: false,
    expectedStatus: STATUS_INVALIDATED,
    expectedRunExitReason: "invalidated",
    expectedFallbackReason: "invalidated-chain-target",
    expectedTargetShapeSupported: true,
    expectedChainLength: 2,
    expectedInlineLoads: 2,
    expectedInlineStores: 2,
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  },
];

function r4kInvalidationFixture(overrides = {}) {
  return {
    name: "r4k-invalidation-valid-unchanged-tb-executes",
    source: r4kTwoTBHotsetSource,
    target: r4kTwoTBHotsetTarget(),
    slotTarget: R4K_TWO_TB_HOTSET_DISPATCH_TARGET,
    budget: 2,
    currentTbGeneration: R4K_INVALIDATION_TB_GENERATION,
    expectedAddressSpaceGeneration:
      R4K_INVALIDATION_ADDRESS_SPACE_GENERATION,
    currentAddressSpaceGeneration:
      R4K_INVALIDATION_ADDRESS_SPACE_GENERATION,
    expectedTlbMirrorGeneration:
      R4K_INVALIDATION_TLB_MIRROR_GENERATION,
    currentTlbMirrorGeneration:
      R4K_INVALIDATION_TLB_MIRROR_GENERATION,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedFallbackReason: null,
    expectedTargetShapeSupported: true,
    expectedChainLength: 2,
    expectedInlineLoads: 2,
    expectedInlineStores: 2,
    expectedGeneratedGuestInstructions: 2,
    expectedGeneratedChainLength: 2,
    expectedGeneratedBodyTimeNs: R4K_TWO_TB_HOTSET_BODY_TIME_NS,
    ...overrides,
  };
}

const r4kInvalidationFixtures = [
  r4kInvalidationFixture(),
  r4kInvalidationFixture({
    name: "r4k-invalidation-tb-generation-mismatch",
    currentTbGeneration: R4K_INVALIDATION_TB_GENERATION + 1n,
    expectedSuccess: false,
    expectedStatus: STATUS_INVALIDATED,
    expectedRunExitReason: "invalidated",
    expectedFallbackReason: "tb-generation-mismatch",
    expectedState: "initial",
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  }),
  r4kInvalidationFixture({
    name: "r4k-invalidation-address-space-generation-mismatch",
    currentAddressSpaceGeneration:
      R4K_INVALIDATION_ADDRESS_SPACE_GENERATION + 1n,
    expectedSuccess: false,
    expectedStatus: STATUS_INVALIDATED,
    expectedRunExitReason: "invalidated",
    expectedFallbackReason: "address-space-generation-mismatch",
    expectedState: "initial",
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  }),
  r4kInvalidationFixture({
    name: "r4k-invalidation-tlb-mirror-generation-mismatch",
    currentTlbMirrorGeneration:
      R4K_INVALIDATION_TLB_MIRROR_GENERATION + 1n,
    expectedSuccess: false,
    expectedStatus: STATUS_INVALIDATED,
    expectedRunExitReason: "invalidated",
    expectedFallbackReason: "tlb-mirror-generation-mismatch",
    expectedState: "initial",
    expectedGeneratedGuestInstructions: 0,
    expectedGeneratedChainLength: 0,
    expectedGeneratedBodyTimeNs: 0,
  }),
];

const r4kSoftmmuFixtures = [
  {
    name: "r4k-softmmu-ld32u-tlb-hit-ram",
    access: "load",
    fallbackReason: null,
    generatedMemop: MO_32 | MO_ATOM_NONE,
    initialRam32: 0x89abcdef,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 1,
    expectedInlineStores: 0,
    expectedReg0: 0x89abcdefn,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-ld-tlb-hit-ram",
    access: "load",
    fallbackReason: null,
    generatedMemop: MO_64 | MO_ATOM_NONE,
    initialRam64: 0x0123456789abcdefn,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 1,
    expectedInlineStores: 0,
    expectedReg0: 0x0123456789abcdefn,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-st8-tlb-hit-ram",
    access: "store",
    fallbackReason: null,
    generatedMemop: MO_8 | MO_ATOM_NONE,
    storeValue: 0xaan,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 0,
    expectedInlineStores: 1,
    expectedRam64: 0x88776655443322aan,
    words: [
      OPS.tci_qemu_st_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-st-tlb-hit-ram",
    access: "store",
    fallbackReason: null,
    generatedMemop: MO_64 | MO_ATOM_NONE,
    storeValue: 0x0102030405060708n,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 0,
    expectedInlineStores: 1,
    expectedRam64: 0x0102030405060708n,
    words: [
      OPS.tci_qemu_st_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-tlb-miss",
    access: "load",
    fallbackReason: "tlb-miss",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    comparator: 0x3000n,
    expectedSuccess: false,
    expectedStatus: STATUS_TLB_MISS_OR_FAULT,
    expectedRunExitReason: "tlb-miss-or-fault",
    expectedExitsTlbMissOrFault: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-mmio",
    access: "load",
    fallbackReason: "mmio",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    comparatorFlags: Number(WASMJIT_TLB_CONSTANTS.forceSlow),
    slowFlags: WASMJIT_TLB_CONSTANTS.mmio,
    expectedSuccess: false,
    expectedStatus: STATUS_MMIO,
    expectedRunExitReason: "mmio",
    expectedExitsMmio: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-permission-fault",
    access: "load",
    fallbackReason: "permission-fault",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    comparatorFlags: Number(WASMJIT_TLB_CONSTANTS.invalidMask),
    expectedSuccess: false,
    expectedStatus: STATUS_TLB_MISS_OR_FAULT,
    expectedRunExitReason: "tlb-miss-or-fault",
    expectedExitsTlbMissOrFault: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-page-crossing",
    access: "load",
    fallbackReason: "page-crossing",
    generatedMemop: MO_64 | MO_ATOM_NONE,
    taddr: 0xffcn,
    expectedSuccess: false,
    expectedStatus: STATUS_TLB_MISS_OR_FAULT,
    expectedRunExitReason: "tlb-miss-or-fault",
    expectedExitFlags: RUN_EXIT_FLAG_PAGE_CROSSING,
    expectedExitsTlbMissOrFault: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-unsupported-memop",
    access: "load",
    fallbackReason: "unsupported-memop",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    oiMemop: MO_16 | MO_ATOM_NONE,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-slow-flags",
    access: "store",
    fallbackReason: "slow-flags",
    generatedMemop: MO_64 | MO_ATOM_NONE,
    comparatorFlags: Number(WASMJIT_TLB_CONSTANTS.forceSlow),
    slowFlags: WASMJIT_TLB_CONSTANTS.watchpoint,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_st_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-unmirrored-state",
    access: "load",
    fallbackReason: "unmirrored-state",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    mirrorFlags: 0,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-null-mirror",
    access: "load",
    fallbackReason: "null-mirror",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    tlbPointer: 0,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-missing-table",
    access: "load",
    fallbackReason: "missing-table",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    tablePointer: 0,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-stale-mmu-mirror",
    access: "load",
    fallbackReason: "stale-mmu-mirror",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    mirrorMmuIdx: R4K_SOFTMMU_MMU_IDX + 1,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "r4k-softmmu-layout-constant-mismatch",
    access: "load",
    fallbackReason: "layout-constant-mismatch",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    mirrorTargetPageBits: R4K_SOFTMMU_PAGE_BITS + 1,
    expectedSuccess: false,
    expectedStatus: STATUS_UNSUPPORTED,
    expectedRunExitReason: "unsupported",
    expectedExitsUnsupported: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  },
];

function r6Rv64SoftmmuFixture(name, overrides) {
  return {
    name: `r6-rv64-softmmu-${name}`,
    emitterName: R6_RV64_SOFTMMU_EMITTER_NAME,
    ...overrides,
  };
}

const r6Rv64SoftmmuFixtures = [
  r6Rv64SoftmmuFixture("ld32u-tlb-hit-ram", {
    access: "load",
    fallbackReason: null,
    generatedMemop: MO_32 | MO_ATOM_NONE,
    initialRam32: 0x10203040,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 1,
    expectedInlineStores: 0,
    expectedReg0: 0x10203040n,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("ld-tlb-hit-ram", {
    access: "load",
    fallbackReason: null,
    generatedMemop: MO_64 | MO_ATOM_NONE,
    initialRam64: 0x0fedcba987654321n,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 1,
    expectedInlineStores: 0,
    expectedReg0: 0x0fedcba987654321n,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("st8-tlb-hit-ram", {
    access: "store",
    fallbackReason: null,
    generatedMemop: MO_8 | MO_ATOM_NONE,
    storeValue: 0x5an,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 0,
    expectedInlineStores: 1,
    expectedRam64: 0x887766554433225an,
    words: [
      OPS.tci_qemu_st_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("st32-tlb-hit-ram", {
    access: "store",
    fallbackReason: null,
    generatedMemop: MO_32 | MO_ATOM_NONE,
    storeValue: 0x01020304n,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 0,
    expectedInlineStores: 1,
    expectedRam64: 0x8877665501020304n,
    words: [
      OPS.tci_qemu_st_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("st-tlb-hit-ram", {
    access: "store",
    fallbackReason: null,
    generatedMemop: MO_64 | MO_ATOM_NONE,
    storeValue: 0xaabbccddeeff0011n,
    expectedSuccess: true,
    expectedStatus: STATUS_EXIT,
    expectedRunExitReason: "none",
    expectedInlineLoads: 0,
    expectedInlineStores: 1,
    expectedRam64: 0xaabbccddeeff0011n,
    words: [
      OPS.tci_qemu_st_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("tlb-miss", {
    access: "load",
    fallbackReason: "tlb-miss",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    comparator: 0x3000n,
    expectedSuccess: false,
    expectedStatus: STATUS_TLB_MISS_OR_FAULT,
    expectedRunExitReason: "tlb-miss-or-fault",
    expectedExitsTlbMissOrFault: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("mmio", {
    access: "load",
    fallbackReason: "mmio",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    comparatorFlags: Number(WASMJIT_TLB_CONSTANTS.forceSlow),
    slowFlags: WASMJIT_TLB_CONSTANTS.mmio,
    expectedSuccess: false,
    expectedStatus: STATUS_MMIO,
    expectedRunExitReason: "mmio",
    expectedExitsMmio: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("permission-fault", {
    access: "load",
    fallbackReason: "permission-fault",
    generatedMemop: MO_32 | MO_ATOM_NONE,
    comparatorFlags: Number(WASMJIT_TLB_CONSTANTS.invalidMask),
    expectedSuccess: false,
    expectedStatus: STATUS_TLB_MISS_OR_FAULT,
    expectedRunExitReason: "tlb-miss-or-fault",
    expectedExitsTlbMissOrFault: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
  r6Rv64SoftmmuFixture("page-crossing", {
    access: "load",
    fallbackReason: "page-crossing",
    generatedMemop: MO_64 | MO_ATOM_NONE,
    taddr: 0xffcn,
    expectedSuccess: false,
    expectedStatus: STATUS_TLB_MISS_OR_FAULT,
    expectedRunExitReason: "tlb-miss-or-fault",
    expectedExitFlags: RUN_EXIT_FLAG_PAGE_CROSSING,
    expectedExitsTlbMissOrFault: 1,
    words: [
      OPS.tci_qemu_ld_rrr | (0 << 8) | (1 << 12) | (2 << 16),
      OPS.exit_tb,
    ],
  }),
];

const unsupportedFixtures = [
  {
    name: "qemu-ld-st-multiple-memops-fails-closed",
    relativeBase: 0x5400,
    expectedRuntimeUnsupportedGuards: [
      "softmmu-multiple-memops-unsupported",
    ],
    words: [
      OPS.tci_qemu_ld_rrr | (3 << 8) | (14 << 12) | (13 << 16),
      OPS.add | (3 << 8) | (3 << 12) | (5 << 16),
      OPS.tci_qemu_st_rrr | (3 << 8) | (14 << 12) | (13 << 16),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-call-exit-at-entry-fails-closed",
    relativeBase: 0x5800,
    words: [
      opCall(0),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-call-exit-int128-return-fails-closed",
    relativeBase: 0x5f00,
    words: [
      opImm20(OPS.tci_movi, 1, 0x21),
      opCall(3),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-env-relative-non-env-base-fails-closed",
    relativeBase: 0x5c00,
    words: [
      opMem(OPS.ld32u, 1, 3, 0),
      OPS.exit_tb,
    ],
  },
  {
    name: "rv64-env-relative-out-of-range-fails-closed",
    relativeBase: 0x5d00,
    words: [
      opMem(OPS.st, 1, RV64_ENV_RELATIVE_BASE_REG,
            RV64_ENV_RELATIVE_MAX_EXCLUSIVE - 7),
      OPS.exit_tb,
    ],
  },
];

const unsupportedX86StateFixtures = [
  {
    name: "x86-rip-eip-write-fails-closed",
    requirement: { field: "CPUX86State.eip", access: "write" },
    reason: "unmodeled-rip-eip-write",
  },
  {
    name: "x86-lazy-cc-state-fails-closed",
    requirement: { field: "CPUX86State.cc_op", access: "read" },
    reason: "unmodeled-lazy-condition-code-state",
  },
  {
    name: "x86-segment-state-fails-closed",
    requirement: { field: "CPUX86State.segs[R_FS].base", access: "read" },
    reason: "unmodeled-segment-state",
  },
  {
    name: "x86-helper-sensitive-state-fails-closed",
    requirement: { field: "helper-visible-state", access: "read" },
    reason: "unmodeled-helper-sensitive-state",
  },
];

const results = [];
const unsupportedResults = [];
const unsupportedX86StateResults = [];
const r4kTwoTBHotsetResults = [];
const r4kInvalidationResults = [];
const r4kSoftmmuResults = [];
const r6Rv64SoftmmuResults = [];

for (const fixture of fixtures) {
  for (const seed of fixture.seeds || [1, 2]) {
    results.push(await runFixture(fixture, seed));
  }
}

for (const fixture of unsupportedFixtures) {
  const emission = emitPerTBFunctionBody(fixture.words, fixture.relativeBase);

  assert.equal(emission.ok, false, `${fixture.name} should fail closed`);
  assert.equal(emission.emitter, PER_TB_EMITTER_NAME);
  assert.equal(emission.reason, "unsupported-shape");
  assert.deepEqual(
    emission.runtimeUnsupportedGuards.map((guard) => guard.reason),
    fixture.expectedRuntimeUnsupportedGuards || [],
  );
  unsupportedResults.push(fixture.name);
}

for (const fixture of unsupportedX86StateFixtures) {
  const support = x86StateRequirementSupported(fixture.requirement);

  assert.equal(support.ok, false, `${fixture.name} should fail closed`);
  assert.equal(support.reason, fixture.reason);
  unsupportedX86StateResults.push({
    name: fixture.name,
    reason: support.reason,
  });
}

for (const fixture of r4kTwoTBHotsetFixtures) {
  r4kTwoTBHotsetResults.push(await runTwoTBHotsetFixture(fixture, 1));
}

for (const fixture of r4kInvalidationFixtures) {
  r4kInvalidationResults.push(await runTwoTBHotsetFixture(fixture, 1));
}

for (const fixture of r4kSoftmmuFixtures) {
  r4kSoftmmuResults.push(await runSoftmmuFixture(fixture));
}

for (const fixture of r6Rv64SoftmmuFixtures) {
  r6Rv64SoftmmuResults.push(await runSoftmmuFixture(fixture));
}

assert.equal(results.length, 19);
assert.equal(results.filter((entry) => entry.terminal === "goto_tb").length, 7);
assert.equal(results.filter((entry) => entry.terminal === "exit_tb").length, 10);
assert.equal(results.filter((entry) => entry.terminal === "helper").length, 2);
const helperBoundaryResults = results.filter((entry) =>
  entry.helpers.loads > 0 || entry.helpers.stores > 0);
const simpleGapResults = results.filter((entry) =>
  entry.name === "simple-gap-ops-validate");
const rv64BootPathResults = results.filter((entry) =>
  entry.name.startsWith("rv64-boot-"));
const rv64EnvRelativeResults = results.filter((entry) =>
  entry.name.startsWith("rv64-env-relative-"));
const rv64HelperExitResults = results.filter((entry) =>
  entry.name.startsWith("rv64-call-exit-"));
const liveX86Results = results.filter((entry) =>
  entry.name === "live-x86-pre-r4i-ld32u-goto-tb-13");
const r4iEmitterResults = results.filter((entry) =>
  entry.name === "live-x86-r4i-ld32u-goto-tb-11");
assert.equal(liveX86Results.length, 2);
assert.equal(
  liveX86Results.filter((entry) =>
    entry.generatedTciOpEquivalents === 11 &&
    entry.memoryWrites === 2 &&
    entry.terminal === "goto_tb").length,
  2,
);
assert.equal(r4iEmitterResults.length, 1);
assert.equal(r4iEmitterResults[0].emitter, PER_TB_EMITTER_NAME);
assert.equal(r4iEmitterResults[0].moduleValid, true);
assert.equal(r4iEmitterResults[0].generatedGuestInstructions, 1);
assert.equal(r4iEmitterResults[0].generatedTciOpEquivalents, 11);
assert.equal(r4iEmitterResults[0].inlineTlbHitLoads, 2);
assert.equal(r4iEmitterResults[0].inlineTlbHitStores, 2);
assert.equal(r4iEmitterResults[0].memoryWrites, 2);
assert.equal(r4iEmitterResults[0].helpers.loads, 0);
assert.equal(r4iEmitterResults[0].helpers.stores, 0);
assert.equal(r4iEmitterResults[0].x86CpuStateContract.ok, true);
assert.equal(rv64BootPathResults.length, 4);
assert.deepEqual(
  [...new Set(rv64BootPathResults.map((entry) => entry.name))],
  [
    "rv64-boot-move-logic-family",
    "rv64-boot-setcond-branch-family",
  ],
);
assert.deepEqual(
  [...new Set(rv64BootPathResults.map((entry) => entry.emitter))],
  [PER_TB_EMITTER_NAME],
);
assert.equal(
  rv64BootPathResults.every((entry) =>
    entry.moduleValid &&
    entry.registerStateMatched &&
    entry.memoryStateMatched &&
    entry.helpers.loads === 0 &&
    entry.helpers.stores === 0),
  true,
);
assert.deepEqual(
  rv64BootPathResults.map((entry) => entry.generatedTciOpEquivalents),
  [11, 11, 6, 6],
);
assert.equal(rv64EnvRelativeResults.length, 2);
assert.deepEqual(
  [...new Set(rv64EnvRelativeResults.map((entry) => entry.name))],
  ["rv64-env-relative-load-store-family"],
);
assert.deepEqual(
  rv64EnvRelativeResults.map((entry) => [
    entry.generatedTciOpEquivalents,
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helpers.loads,
    entry.helpers.stores,
  ]),
  [
    [8, 3, 3, 0, 0],
    [8, 3, 3, 0, 0],
  ],
);
assert.equal(rv64HelperExitResults.length, 2);
assert.deepEqual(
  [...new Set(rv64HelperExitResults.map((entry) => entry.name))],
  ["rv64-call-exit-prefix-family"],
);
assert.equal(
  rv64HelperExitResults.every((entry) =>
    entry.status === STATUS_HELPER.toString() &&
    entry.terminal === "helper" &&
    entry.ret === BigInt(0x5e00 + 3 * 4).toString() &&
    entry.registerStateMatched &&
    entry.memoryStateMatched &&
    entry.helpers.loads === 0 &&
    entry.helpers.stores === 0),
  true,
);
assert.deepEqual(
  rv64HelperExitResults.map((entry) => entry.generatedTciOpEquivalents),
  [4, 4],
);
assert.deepEqual(
  r4iEmitterResults[0].x86CpuStateContract.generalRegisters.loadedInputRegisters,
  [x86RegField(14)],
);
assert.deepEqual(
  r4iEmitterResults[0].x86CpuStateContract.generalRegisters.requiredDirtyFlushRegisters,
  [x86RegField(4), x86RegField(5), x86RegField(13)],
);
assert.equal(
  r4iEmitterResults[0].x86CpuStateContract.ripEip.bodyAccess,
  "not read or written by generated body",
);
assert.equal(
  r4iEmitterResults[0].x86CpuStateContract.ripEip.dispatchTarget,
  "recorded goto_tb slot",
);
assert.deepEqual(
  r4iEmitterResults[0].x86CpuStateContract.lazyConditionCodes.modeledInputs,
  [{
    op: "tci_setcond32",
    index: 2,
    condition: 2,
    lhs: x86RegField(4),
    rhs: x86RegField(5),
    result: x86RegField(13),
    lazyCcFields: [],
  }],
);
assert.deepEqual(
  r4iEmitterResults[0].x86CpuStateContract.lazyConditionCodes.fields,
  [
    "CPUX86State.cc_dst",
    "CPUX86State.cc_src",
    "CPUX86State.cc_src2",
    "CPUX86State.cc_op",
  ],
);
assert.equal(
  r4iEmitterResults[0].x86CpuStateContract.lazyConditionCodes.bodyAccess,
  "not read or written by the R4i generated body",
);
assert.deepEqual(
  r4iEmitterResults[0].runtimeUnsupportedGuards.map((guard) => guard.reason),
  ["branch-target-outside-recorded-words"],
);
const r4iRuntimeUnsupported = await runRuntimeUnsupportedGuardFixture(
  r4iLiveX86Fixture, 2);
assert.equal(r4iRuntimeUnsupported.status, STATUS_UNSUPPORTED.toString());
assert.deepEqual(r4iRuntimeUnsupported.flushedRegs, {
  [x86RegField(4)]: "4294967295",
  [x86RegField(5)]: "0",
  [x86RegField(13)]: "1",
});
assert.equal(r4kTwoTBHotsetResults.length, 5);
const r4kTwoTBHotsetHit = r4kTwoTBHotsetResults.find((entry) =>
  entry.name === "r4k-two-tb-chained-hit");
const r4kTwoTBHotsetFailures = r4kTwoTBHotsetResults.filter((entry) =>
  !entry.success);
assert.equal(r4kTwoTBHotsetHit.success, true);
assert.equal(r4kTwoTBHotsetHit.generatedModuleCalls, 1);
assert.equal(r4kTwoTBHotsetHit.status, STATUS_EXIT.toString());
assert.equal(r4kTwoTBHotsetHit.runExitReason, "none");
assert.equal(r4kTwoTBHotsetHit.fallbackReason, null);
assert.equal(r4kTwoTBHotsetHit.generatedGuestInstructions, "2");
assert.equal(r4kTwoTBHotsetHit.generatedChainLength, "2");
assert.equal(r4kTwoTBHotsetHit.generatedBodyTimeNs,
             R4K_TWO_TB_HOTSET_BODY_TIME_NS.toString());
assert.equal(r4kTwoTBHotsetHit.helperCalls, "0");
assert.equal(r4kTwoTBHotsetHit.qemuLdCalls, "0");
assert.equal(r4kTwoTBHotsetHit.qemuStCalls, "0");
assert.equal(r4kTwoTBHotsetHit.moduleValid, true);
assert.equal(r4kTwoTBHotsetHit.targetShapeSupported, true);
assert.deepEqual(
  r4kTwoTBHotsetFailures.map((entry) => entry.fallbackReason),
  [
    "missing-chain-target",
    "unsupported-chain-target-shape",
    "budget-before-second-tb",
    "invalidated-chain-target",
  ],
);
assert.deepEqual(
  r4kTwoTBHotsetFailures.map((entry) => entry.generatedGuestInstructions),
  ["0", "0", "0", "0"],
);
assert.deepEqual(
  r4kTwoTBHotsetFailures.map((entry) => entry.generatedChainLength),
  ["0", "0", "0", "0"],
);
assert.deepEqual(
  r4kTwoTBHotsetFailures.map((entry) => entry.generatedBodyTimeNs),
  ["0", "0", "0", "0"],
);
assert.deepEqual(
  r4kTwoTBHotsetFailures.map((entry) => entry.expectedState),
  ["after-source-tb", "after-source-tb", "after-source-tb", "after-source-tb"],
);
assert.equal(
  r4kTwoTBHotsetFailures.find((entry) =>
    entry.fallbackReason === "missing-chain-target").exits.unsupported,
  "1",
);
assert.equal(
  r4kTwoTBHotsetFailures.find((entry) =>
    entry.fallbackReason === "unsupported-chain-target-shape")
    .targetUnsupportedReason,
  "unsupported-shape",
);
assert.equal(
  r4kTwoTBHotsetFailures.find((entry) =>
    entry.fallbackReason === "unsupported-chain-target-shape")
    .exits.unsupported,
  "1",
);
assert.equal(
  r4kTwoTBHotsetFailures.find((entry) =>
    entry.fallbackReason === "budget-before-second-tb").exits.budget,
  "1",
);
assert.equal(
  r4kTwoTBHotsetFailures.find((entry) =>
    entry.fallbackReason === "invalidated-chain-target").exits.invalidated,
  "1",
);
assert.equal(r4kInvalidationResults.length, 4);
const r4kInvalidationValid = r4kInvalidationResults.find((entry) =>
  entry.name === "r4k-invalidation-valid-unchanged-tb-executes");
const r4kInvalidationFailures = r4kInvalidationResults.filter((entry) =>
  !entry.success);
assert.equal(r4kInvalidationValid.success, true);
assert.equal(r4kInvalidationValid.runExitReason, "none");
assert.equal(r4kInvalidationValid.generatedGuestInstructions, "2");
assert.equal(r4kInvalidationValid.generatedChainLength, "2");
assert.equal(r4kInvalidationValid.generatedBodyTimeNs,
             R4K_TWO_TB_HOTSET_BODY_TIME_NS.toString());
assert.equal(r4kInvalidationValid.inlineTlbHitLoads, "2");
assert.equal(r4kInvalidationValid.inlineTlbHitStores, "2");
assert.equal(r4kInvalidationValid.helperCalls, "0");
assert.equal(r4kInvalidationValid.qemuLdCalls, "0");
assert.equal(r4kInvalidationValid.qemuStCalls, "0");
assert.equal(r4kInvalidationValid.exits.invalidated, "0");
assert.deepEqual(
  r4kInvalidationFailures.map((entry) => entry.fallbackReason),
  [
    "tb-generation-mismatch",
    "address-space-generation-mismatch",
    "tlb-mirror-generation-mismatch",
  ],
);
assert.deepEqual(
  r4kInvalidationFailures.map((entry) => entry.expectedState),
  ["initial", "initial", "initial"],
);
assert.deepEqual(
  r4kInvalidationFailures.map((entry) => [
    entry.runExitReason,
    entry.generatedGuestInstructions,
    entry.generatedChainLength,
    entry.generatedBodyTimeNs,
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helperCalls,
    entry.qemuLdCalls,
    entry.qemuStCalls,
    entry.exits.invalidated,
  ]),
  r4kInvalidationFailures.map(() => [
    "invalidated", "0", "0", "0", "0", "0", "0", "0", "0", "1",
  ]),
);
const r4kLiveRoutingCases = [
  routeLiveGeneratedOutput(null),
  routeLiveGeneratedOutput({
    opCount: R4I_LIVE_X86_SHAPE.length,
    generatedOutputAvailable: false,
    generatedOutputSize: 0,
    words: [],
    relativeBase: r4iLiveX86Fixture.relativeBase,
    guestInstructions: 1,
  }),
  routeLiveGeneratedOutput({
    opCount: R4I_LIVE_X86_SHAPE.length,
    generatedOutputAvailable: true,
    generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
    words: [
      0xff,
      ...r4iLiveX86Fixture.words.slice(1),
    ],
    relativeBase: r4iLiveX86Fixture.relativeBase,
    guestInstructions: 1,
  }),
  routeLiveGeneratedOutput({
    opCount: R4I_LIVE_X86_SHAPE.length,
    generatedOutputAvailable: true,
    generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
    words: r4iLiveX86Fixture.words.map((word, index) =>
      index === 2
        ? OPS.tci_setcond32 | (13 << 8) | (4 << 12) |
          (5 << 16) | (4 << 20)
        : word),
    relativeBase: r4iLiveX86Fixture.relativeBase,
    guestInstructions: 1,
  }),
  routeLiveGeneratedOutput({
    opCount: R4I_LIVE_X86_SHAPE.length,
    generatedOutputAvailable: true,
    generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
    words: r4iLiveX86Fixture.words,
    tbWords: r4iLiveX86Fixture.words.map((word, index) =>
      index === 1 ? (word ^ 0x10) >>> 0 : word),
    relativeBase: r4iLiveX86Fixture.relativeBase,
    guestInstructions: 1,
  }),
  routeLiveGeneratedOutput({
    opCount: R4I_LIVE_X86_SHAPE.length,
    generatedOutputAvailable: true,
    generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
    words: r4iLiveX86Fixture.words,
    relativeBase: r4iLiveX86Fixture.relativeBase,
    guestInstructions: 1,
  }),
];
assert.deepEqual(
  r4kLiveRoutingCases.map((entry) => entry.reason),
  [
    "metadata-missing",
    "generated-output-unavailable",
    "selected-body-shape-unsupported",
    "unsupported-shape",
    "metadata-output-tb-code-mismatch",
    null,
  ],
);
assert.deepEqual(
  r4kLiveRoutingCases.map((entry) => entry.generatedGuestInstructions),
  [0, 0, 0, 0, 0, 1],
);
assert.equal(r4kLiveRoutingCases.at(-1).moduleValid, true);
const r4kSoftmmuStaleOutputMismatch = r4kLiveRoutingCases.find((entry) =>
  entry.reason === "metadata-output-tb-code-mismatch");
assert.equal(r4kSoftmmuStaleOutputMismatch.generatedGuestInstructions, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.generatedChainLength, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.generatedBodyTimeNs, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.inlineTlbHitLoads, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.inlineTlbHitStores, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.helperCalls, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.qemuLdCalls, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.qemuStCalls, 0);
assert.equal(r4kSoftmmuStaleOutputMismatch.runExitReason, "invalidated");
assert.equal(r4kSoftmmuStaleOutputMismatch.exitsInvalidated, 1);

function r4s5bOpWritesR0(op) {
  return ![
    OPS.brcond,
    OPS.exit_tb,
    OPS.goto_tb,
    OPS.mb,
    OPS.tci_qemu_st_rrr,
  ].includes(op);
}

function r4s5bValidateMemop(memop) {
  const supportedFlags =
    MO_SIZE | MO_SIGN | MO_BSWAP | MO_AMASK |
    MO_ALIGN_TLB_ONLY | MO_ATOM_MASK;

  if ((memop & ~supportedFlags) !== 0) {
    return "selected-body-memop-unsupported-high-flags";
  }
  if (![MO_8, MO_32, MO_64].includes(memop & MO_SIZE)) {
    return "selected-body-memop-unsupported-size";
  }
  if ((memop & MO_SIGN) !== 0) {
    return "selected-body-memop-unsupported-sign";
  }
  if ((memop & MO_BSWAP) !== 0) {
    return "selected-body-memop-unsupported-endian";
  }
  if ((memop & (MO_AMASK | MO_ALIGN_TLB_ONLY)) !== 0) {
    return "selected-body-memop-unsupported-alignment";
  }
  if ((memop & MO_ATOM_MASK) !== MO_ATOM_NONE) {
    return "selected-body-memop-unsupported-atomic";
  }
  return null;
}

function r4s5bValidateSelectedMemops(metadata, currentMmuIdx = R4K_SOFTMMU_MMU_IDX) {
  const known = new Array(16).fill(false);
  const values = new Array(16).fill(0);
  let hasMemop = false;
  let memopCount = 0;
  let qemuLdOps = 0;
  let qemuStOps = 0;

  function markUnknown(reg) {
    if (reg < known.length) {
      known[reg] = false;
      values[reg] = 0;
    }
  }

  function markKnown(reg, value) {
    if (reg < known.length) {
      known[reg] = true;
      values[reg] = value >>> 0;
    }
  }

  function copyReg(dest, source) {
    if (source < known.length && known[source]) {
      markKnown(dest, values[source]);
    } else {
      markUnknown(dest);
    }
  }

  for (const word of metadata?.words || []) {
    const op = word & 0xff;
    const r0 = bits(word, 8, 4);
    const r1 = bits(word, 12, 4);
    const r2 = bits(word, 16, 4);

    if (op === OPS.tci_movi) {
      markKnown(r0, sextract(word, 12, 20));
      continue;
    }
    if (op === OPS.tci_movl) {
      markUnknown(r0);
      continue;
    }
    if (op === OPS.mov) {
      copyReg(r0, r1);
      continue;
    }
    if (op === OPS.tci_qemu_ld_rrr || op === OPS.tci_qemu_st_rrr) {
      hasMemop = true;
      memopCount++;
      if (memopCount > 1) {
        return {
          reason: "selected-body-softmmu-multi-access-unsupported",
          hasMemop,
        };
      }
      if (r2 >= known.length || !known[r2]) {
        return { reason: "selected-body-memop-unproven", hasMemop };
      }
      const oi = values[r2];
      const memop = oi >>> TCG_WASM64_MEMOPIDX_SHIFT;
      const mmuIdx = oi & TCG_WASM64_MEMOPIDX_MMU_MASK;
      const memopReason = r4s5bValidateMemop(memop);
      if (memopReason !== null) {
        return { reason: memopReason, hasMemop, memop };
      }
      if (mmuIdx !== currentMmuIdx) {
        return {
          reason: "selected-body-memop-unexpected-mmu-idx",
          hasMemop,
        };
      }
      if (op === OPS.tci_qemu_ld_rrr) {
        qemuLdOps++;
        markUnknown(r0);
      } else {
        qemuStOps++;
      }
      continue;
    }
    if (r4s5bOpWritesR0(op)) {
      markUnknown(r0);
    }
  }

  return {
    reason: null,
    hasMemop,
    qemuLdOps,
    qemuStOps,
    tlbMirrorRefreshed: hasMemop,
    tlbMirrorValidated: hasMemop,
  };
}

function simulateR4mLiveGeneratedExec({
  name,
  enabled,
  noFallback = false,
  metadata,
}) {
  if (!enabled) {
    return {
      name,
      enabled,
      ok: true,
      path: "tci",
      generatedGuestInstructions: 0,
      generatedBodyTimeNs: 0,
      generatedChainLength: 0,
      inlineTlbHitLoads: 0,
      inlineTlbHitStores: 0,
      helperCalls: 0,
      qemuLdCalls: 0,
      qemuStCalls: 0,
      compatFallback: false,
      noSilentFallback: noFallback,
      failedClosed: false,
      attempts: 0,
      rejects: 0,
      skips: 0,
      exits: { unsupported: 0, invalidated: 0 },
    };
  }

  const helperExitGeneratedOutput =
    metadata?.generatedHelperExitOpCount > 0 &&
    metadata?.generatedOutputAvailable &&
    metadata?.generatedOutputSize > 0 &&
    metadata.generatedOutputSize % 4 === 0;
  if (helperExitGeneratedOutput) {
    return {
      name,
      enabled,
      ok: false,
      path: noFallback ? "fail-closed" : "tci-fallback",
      reason: noFallback
        ? "selected-body-helper-exit-unsupported"
        : "selected-body-helper-exit-skipped",
      generatedGuestInstructions: 0,
      generatedBodyTimeNs: 0,
      generatedChainLength: 0,
      inlineTlbHitLoads: 0,
      inlineTlbHitStores: 0,
      helperCalls: 0,
      qemuLdCalls: 0,
      qemuStCalls: 0,
      compatFallback: !noFallback,
      noSilentFallback: noFallback,
      failedClosed: noFallback,
      attempts: noFallback ? 1 : 0,
      rejects: noFallback ? 1 : 0,
      skips: noFallback ? 0 : 1,
      exits: {
        unsupported: noFallback ? 1 : 0,
        invalidated: 0,
      },
    };
  }

  const memopValidation = r4s5bValidateSelectedMemops(metadata);
  if (memopValidation.reason !== null) {
    return {
      name,
      enabled,
      ok: false,
      path: noFallback ? "fail-closed" : "tci-fallback",
      reason: memopValidation.reason,
      rejectedMemop: memopValidation.memop,
      generatedGuestInstructions: 0,
      generatedBodyTimeNs: 0,
      generatedChainLength: 0,
      inlineTlbHitLoads: 0,
      inlineTlbHitStores: 0,
      helperCalls: 0,
      qemuLdCalls: 0,
      qemuStCalls: 0,
      compatFallback: !noFallback,
      noSilentFallback: noFallback,
      failedClosed: noFallback,
      attempts: 1,
      rejects: 1,
      skips: 0,
      exits: {
        unsupported: 1,
        invalidated: 0,
      },
    };
  }

  const route = routeLiveGeneratedOutput(metadata);
  if (!route.ok) {
    const invalidated = route.runExitReason === "invalidated";
    return {
      name,
      enabled,
      ok: false,
      path: noFallback ? "fail-closed" : "tci-fallback",
      reason: route.reason,
      generatedGuestInstructions: 0,
      generatedBodyTimeNs: 0,
      generatedChainLength: 0,
      inlineTlbHitLoads: 0,
      inlineTlbHitStores: 0,
      helperCalls: 0,
      qemuLdCalls: 0,
      qemuStCalls: 0,
      compatFallback: !noFallback,
      noSilentFallback: noFallback,
      failedClosed: noFallback,
      attempts: 1,
      rejects: 1,
      skips: 0,
      exits: {
        unsupported: invalidated ? 0 : 1,
        invalidated: invalidated ? 1 : 0,
      },
    };
  }

  return {
    name,
    enabled,
    ok: true,
    path: "generated",
    reason: null,
    generatedGuestInstructions: route.generatedGuestInstructions,
    generatedBodyTimeNs: 1000,
    generatedChainLength: 1,
    inlineTlbHitLoads: route.inlineTlbHitLoads || 0,
    inlineTlbHitStores: route.inlineTlbHitStores || 0,
    helperCalls: 0,
    qemuLdCalls: 0,
    qemuStCalls: 0,
    compatFallback: false,
    noSilentFallback: noFallback,
    failedClosed: false,
    attempts: 1,
    rejects: 0,
    skips: 0,
    exits: { unsupported: 0, invalidated: 0 },
    softmmuLowering: route.softmmuLowering || null,
    softmmuLoweredOps: route.softmmuLoweredOps || 0,
    tlbMirrorRefreshed: memopValidation.tlbMirrorRefreshed || false,
    tlbMirrorValidated: memopValidation.tlbMirrorValidated || false,
  };
}

const r4mLiveGeneratedExecCases = [
  simulateR4mLiveGeneratedExec({
    name: "r4m-disabled-keeps-tci",
    enabled: false,
    metadata: null,
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4m-supported-metadata-backed-live-tb-generated",
    enabled: true,
    metadata: {
      opCount: R4I_LIVE_X86_SHAPE.length,
      generatedOutputAvailable: true,
      generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
      words: r4iLiveX86Fixture.words,
      relativeBase: r4iLiveX86Fixture.relativeBase,
      guestInstructions: 1,
    },
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4m-unsupported-no-silent-fallback-fails-closed",
    enabled: true,
    noFallback: true,
    metadata: {
      opCount: R4I_LIVE_X86_SHAPE.length,
      generatedOutputAvailable: true,
      generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
      words: [
        0xff,
        ...r4iLiveX86Fixture.words.slice(1),
      ],
      relativeBase: r4iLiveX86Fixture.relativeBase,
      guestInstructions: 1,
    },
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4m-metadata-missing-no-silent-fallback-fails-closed",
    enabled: true,
    noFallback: true,
    metadata: null,
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4m-stale-output-invalidates-zero-generated-work",
    enabled: true,
    metadata: {
      opCount: R4I_LIVE_X86_SHAPE.length,
      generatedOutputAvailable: true,
      generatedOutputSize: r4iLiveX86Fixture.words.length * 4,
      words: r4iLiveX86Fixture.words,
      tbWords: r4iLiveX86Fixture.words.map((word, index) =>
        index === 1 ? (word ^ 0x10) >>> 0 : word),
      relativeBase: r4iLiveX86Fixture.relativeBase,
      guestInstructions: 1,
    },
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4m-compat-fallback-explicit-and-counted",
    enabled: true,
    metadata: {
      opCount: R4I_LIVE_X86_SHAPE.length,
      generatedOutputAvailable: false,
      generatedOutputSize: 0,
      words: [],
      relativeBase: r4iLiveX86Fixture.relativeBase,
      guestInstructions: 1,
    },
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4s4-call-fronted-helper-exit-compat-skips-preflight-budget",
    enabled: true,
    metadata: {
      opCount: R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS.length,
      generatedOutputAvailable: true,
      generatedOutputSize: R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS.length * 4,
      generatedHelperExitOpCount: 1,
      words: R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS,
      relativeBase: 0x1000,
      guestInstructions: 1,
    },
  }),
  simulateR4mLiveGeneratedExec({
    name: "r4s4-call-fronted-helper-exit-no-fallback-rejects",
    enabled: true,
    noFallback: true,
    metadata: {
      opCount: R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS.length,
      generatedOutputAvailable: true,
      generatedOutputSize: R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS.length * 4,
      generatedHelperExitOpCount: 1,
      words: R4S4_X86_CALL_FRONTED_HELPER_EXIT_WORDS,
      relativeBase: 0x1000,
      guestInstructions: 1,
    },
  }),
];
assert.deepEqual(
  r4mLiveGeneratedExecCases.map((entry) => entry.path),
  [
    "tci",
    "generated",
    "fail-closed",
    "fail-closed",
    "tci-fallback",
    "tci-fallback",
    "tci-fallback",
    "fail-closed",
  ],
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-supported-metadata-backed-live-tb-generated")
    .generatedGuestInstructions,
  1,
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-supported-metadata-backed-live-tb-generated")
    .qemuLdCalls,
  0,
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-unsupported-no-silent-fallback-fails-closed")
    .failedClosed,
  true,
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-metadata-missing-no-silent-fallback-fails-closed")
    .reason,
  "metadata-missing",
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-metadata-missing-no-silent-fallback-fails-closed")
    .failedClosed,
  true,
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-stale-output-invalidates-zero-generated-work")
    .exits.invalidated,
  1,
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-stale-output-invalidates-zero-generated-work")
    .generatedGuestInstructions,
  0,
);
assert.equal(
  r4mLiveGeneratedExecCases.find((entry) =>
    entry.name === "r4m-compat-fallback-explicit-and-counted")
    .compatFallback,
  true,
);
const r4s4CompatHelperExitSkip = r4mLiveGeneratedExecCases.find((entry) =>
  entry.name ===
    "r4s4-call-fronted-helper-exit-compat-skips-preflight-budget");
assert.equal(r4s4CompatHelperExitSkip.reason,
  "selected-body-helper-exit-skipped");
assert.equal(r4s4CompatHelperExitSkip.attempts, 0);
assert.equal(r4s4CompatHelperExitSkip.rejects, 0);
assert.equal(r4s4CompatHelperExitSkip.skips, 1);
assert.equal(r4s4CompatHelperExitSkip.generatedGuestInstructions, 0);
assert.equal(r4s4CompatHelperExitSkip.exits.unsupported, 0);
assert.equal(r4s4CompatHelperExitSkip.failedClosed, false);
const r4s4NoFallbackHelperExitReject = r4mLiveGeneratedExecCases.find((entry) =>
  entry.name === "r4s4-call-fronted-helper-exit-no-fallback-rejects");
assert.equal(r4s4NoFallbackHelperExitReject.reason,
  "selected-body-helper-exit-unsupported");
assert.equal(r4s4NoFallbackHelperExitReject.attempts, 1);
assert.equal(r4s4NoFallbackHelperExitReject.rejects, 1);
assert.equal(r4s4NoFallbackHelperExitReject.skips, 0);
assert.equal(r4s4NoFallbackHelperExitReject.generatedGuestInstructions, 0);
assert.equal(r4s4NoFallbackHelperExitReject.exits.unsupported, 1);
assert.equal(r4s4NoFallbackHelperExitReject.failedClosed, true);

function r4s5bMemoryWords({
  memop = MO_32 | MO_ATOM_NONE,
  mmuIdx = R4K_SOFTMMU_MMU_IDX,
  op = OPS.tci_qemu_ld_rrr,
  oiReg = 2,
  proveOi = true,
  useMovl = false,
} = {}) {
  const words = [];
  if (proveOi) {
    const oi = ((memop << TCG_WASM64_MEMOPIDX_SHIFT) |
                (mmuIdx & TCG_WASM64_MEMOPIDX_MMU_MASK)) >>> 0;
    words.push(useMovl ? opReg(OPS.tci_movl, oiReg) :
      opImm20(OPS.tci_movi, oiReg, oi));
  }
  words.push(opReg(op, 0, 1, oiReg), OPS.exit_tb);
  return words;
}

function r4s5bMemoryMetadata(overrides = {}) {
  const words = r4s5bMemoryWords(overrides);
  return {
    opCount: words.length,
    generatedOutputAvailable: true,
    generatedOutputSize: words.length * 4,
    words,
    relativeBase: 0x1000,
    guestInstructions: 1,
  };
}

function r4s5bMultipleMemoryMetadata() {
  const oi = (((MO_32 | MO_ATOM_NONE) << TCG_WASM64_MEMOPIDX_SHIFT) |
              R4K_SOFTMMU_MMU_IDX) >>> 0;
  const words = [
    opImm20(OPS.tci_movi, 2, oi),
    opReg(OPS.tci_qemu_st_rrr, 0, 1, 2),
    opReg(OPS.tci_qemu_ld_rrr, 3, 1, 2),
    OPS.exit_tb,
  ];

  return {
    opCount: words.length,
    generatedOutputAvailable: true,
    generatedOutputSize: words.length * 4,
    words,
    relativeBase: 0x1000,
    guestInstructions: 1,
  };
}

const r4s5bCases = [
  {
    name: "r4s5c-valid-load-enters-generic-softmmu-lowering",
    expectedReason: null,
    expectedPath: "generated",
    expectedInlineTlbHitLoads: 1,
    expectedInlineTlbHitStores: 0,
    metadata: r4s5bMemoryMetadata(),
  },
  {
    name: "r4s5c-valid-store-enters-generic-softmmu-lowering",
    expectedReason: null,
    expectedPath: "generated",
    expectedInlineTlbHitLoads: 0,
    expectedInlineTlbHitStores: 1,
    metadata: r4s5bMemoryMetadata({ op: OPS.tci_qemu_st_rrr }),
  },
  {
    name: "r4s7-atom-none-load-admitted-ram-hit",
    expectedReason: null,
    expectedPath: "generated",
    expectedInlineTlbHitLoads: 1,
    expectedInlineTlbHitStores: 0,
    metadata: r4s5bMemoryMetadata({ memop: MO_32 | MO_ATOM_NONE }),
  },
  {
    name: "r4s7-atom-none-store-admitted-ram-hit",
    expectedReason: null,
    expectedPath: "generated",
    expectedInlineTlbHitLoads: 0,
    expectedInlineTlbHitStores: 1,
    metadata: r4s5bMemoryMetadata({
      memop: MO_32 | MO_ATOM_NONE,
      op: OPS.tci_qemu_st_rrr,
    }),
  },
  {
    name: "r4s5c-multiple-memops-reject-before-partial-store",
    expectedReason: "selected-body-softmmu-multi-access-unsupported",
    metadata: r4s5bMultipleMemoryMetadata(),
  },
  {
    name: "r4s5b-unproven-oi-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unproven",
    metadata: r4s5bMemoryMetadata({ proveOi: false }),
  },
  {
    name: "r4s5b-movl-oi-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unproven",
    metadata: r4s5bMemoryMetadata({ useMovl: true }),
  },
  {
    name: "r4s5b-unsupported-size-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-size",
    metadata: r4s5bMemoryMetadata({ memop: MO_16 | MO_ATOM_NONE }),
  },
  {
    name: "r4s5b-sign-flag-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-sign",
    metadata: r4s5bMemoryMetadata({ memop: MO_32 | MO_SIGN | MO_ATOM_NONE }),
  },
  {
    name: "r4s5b-endian-flag-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-endian",
    metadata: r4s5bMemoryMetadata({ memop: MO_32 | MO_BSWAP | MO_ATOM_NONE }),
  },
  {
    name: "r4s5b-alignment-flag-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-alignment",
    metadata: r4s5bMemoryMetadata({
      memop: MO_32 | MO_ALIGN_4 | MO_ATOM_NONE,
    }),
  },
  {
    name: "r4s7-default-atomic-mode-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-atomic",
    metadata: r4s5bMemoryMetadata({ memop: MO_32 }),
  },
  {
    name: "r4s7-ifalign-pair-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-atomic",
    metadata: r4s5bMemoryMetadata({ memop: MO_32 | MO_ATOM_IFALIGN_PAIR }),
  },
  {
    name: "r4s7-within16-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-atomic",
    metadata: r4s5bMemoryMetadata({ memop: MO_32 | MO_ATOM_WITHIN16 }),
  },
  {
    name: "r4s7-subalign-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-atomic",
    metadata: r4s5bMemoryMetadata({ memop: MO_32 | MO_ATOM_SUBALIGN }),
  },
  {
    name: "r4s5b-high-flag-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unsupported-high-flags",
    metadata: r4s5bMemoryMetadata({
      memop: MO_32 | MO_ATOM_NONE | MO_UNSUPPORTED_HIGH_FLAG,
    }),
  },
  {
    name: "r4s5b-unexpected-mmu-idx-rejects-before-inline-ram",
    expectedReason: "selected-body-memop-unexpected-mmu-idx",
    metadata: r4s5bMemoryMetadata({ mmuIdx: R4K_SOFTMMU_MMU_IDX + 1 }),
  },
].map((testCase) => ({
  ...testCase,
  result: simulateR4mLiveGeneratedExec({
    name: testCase.name,
    enabled: true,
    metadata: testCase.metadata,
  }),
  noFallbackResult: simulateR4mLiveGeneratedExec({
    name: `${testCase.name}-no-fallback`,
    enabled: true,
    noFallback: true,
    metadata: testCase.metadata,
  }),
}));

for (const testCase of r4s5bCases) {
  assert.equal(testCase.result.reason, testCase.expectedReason);
  assert.equal(testCase.result.path, testCase.expectedPath || "tci-fallback");
  assert.equal(testCase.result.qemuLdCalls, 0);
  assert.equal(testCase.result.qemuStCalls, 0);
  assert.equal(testCase.result.attempts, 1);
  if (testCase.expectedReason === null) {
    assert.equal(testCase.result.generatedGuestInstructions, 1);
    assert.equal(testCase.result.softmmuLowering,
                 SHARED_SOFTMMU_LOWERING_NAME);
    assert.equal(testCase.result.softmmuLoweredOps, 1);
    assert.equal(testCase.result.tlbMirrorRefreshed, true);
    assert.equal(testCase.result.tlbMirrorValidated, true);
    assert.equal(testCase.result.inlineTlbHitLoads,
                 testCase.expectedInlineTlbHitLoads);
    assert.equal(testCase.result.inlineTlbHitStores,
                 testCase.expectedInlineTlbHitStores);
    assert.equal(testCase.result.rejects, 0);
    assert.equal(testCase.result.exits.unsupported, 0);
    assert.equal(testCase.noFallbackResult.path, "generated");
    assert.equal(testCase.noFallbackResult.reason, null);
    assert.equal(testCase.noFallbackResult.failedClosed, false);
    assert.equal(testCase.noFallbackResult.generatedGuestInstructions, 1);
    continue;
  }
  assert.equal(testCase.result.generatedGuestInstructions, 0);
  assert.equal(testCase.result.inlineTlbHitLoads, 0);
  assert.equal(testCase.result.inlineTlbHitStores, 0);
  assert.equal(testCase.result.rejects, 1);
  assert.equal(testCase.result.exits.unsupported, 1);
  assert.equal(testCase.noFallbackResult.reason, testCase.expectedReason);
  assert.equal(testCase.noFallbackResult.path, "fail-closed");
  assert.equal(testCase.noFallbackResult.failedClosed, true);
}
const r4s7MemopRejectAttributionReasons = new Set([
  "selected-body-memop-unsupported-size",
  "selected-body-memop-unsupported-alignment",
  "selected-body-memop-unsupported-atomic",
]);
const r4s7MemopRejectAttribution = r4s5bCases
  .filter((entry) => r4s7MemopRejectAttributionReasons.has(
    entry.expectedReason))
  .map((entry) => ({
    name: entry.name,
    reason: entry.result.reason,
    memop: entry.result.rejectedMemop,
    memopHex: `0x${entry.result.rejectedMemop.toString(16)}`,
  }));
assert.deepEqual(r4s7MemopRejectAttribution, [
  {
    name: "r4s5b-unsupported-size-rejects-before-inline-ram",
    reason: "selected-body-memop-unsupported-size",
    memop: MO_16 | MO_ATOM_NONE,
    memopHex: `0x${(MO_16 | MO_ATOM_NONE).toString(16)}`,
  },
  {
    name: "r4s5b-alignment-flag-rejects-before-inline-ram",
    reason: "selected-body-memop-unsupported-alignment",
    memop: MO_32 | MO_ALIGN_4 | MO_ATOM_NONE,
    memopHex: `0x${(MO_32 | MO_ALIGN_4 | MO_ATOM_NONE).toString(16)}`,
  },
  {
    name: "r4s7-default-atomic-mode-rejects-before-inline-ram",
    reason: "selected-body-memop-unsupported-atomic",
    memop: MO_32,
    memopHex: `0x${MO_32.toString(16)}`,
  },
  {
    name: "r4s7-ifalign-pair-rejects-before-inline-ram",
    reason: "selected-body-memop-unsupported-atomic",
    memop: MO_32 | MO_ATOM_IFALIGN_PAIR,
    memopHex: `0x${(MO_32 | MO_ATOM_IFALIGN_PAIR).toString(16)}`,
  },
  {
    name: "r4s7-within16-rejects-before-inline-ram",
    reason: "selected-body-memop-unsupported-atomic",
    memop: MO_32 | MO_ATOM_WITHIN16,
    memopHex: `0x${(MO_32 | MO_ATOM_WITHIN16).toString(16)}`,
  },
  {
    name: "r4s7-subalign-rejects-before-inline-ram",
    reason: "selected-body-memop-unsupported-atomic",
    memop: MO_32 | MO_ATOM_SUBALIGN,
    memopHex: `0x${(MO_32 | MO_ATOM_SUBALIGN).toString(16)}`,
  },
]);

function simulateR7AvailableGeneratedOutputExec({
  name,
  liveCoverageEnabled,
  metadata,
}) {
  if (!liveCoverageEnabled) {
    return {
      name,
      liveCoverageEnabled,
      ok: true,
      path: "tci",
      generatedGuestInstructions: 0,
      generatedCoverageNumerator: 0,
      generatedExecuted: 0,
      compatFallback: false,
    };
  }

  const route = routeAvailableGeneratedOutput(metadata);
  if (!route.ok) {
    return {
      name,
      liveCoverageEnabled,
      ok: false,
      path: "tci-fallback",
      reason: route.reason,
      generatedGuestInstructions: 0,
      generatedCoverageNumerator: 0,
      generatedExecuted: 0,
      compatFallback: true,
    };
  }

  return {
    name,
    liveCoverageEnabled,
    ok: true,
    path: "generated-probe-tci",
    reason: null,
    shape: route.shape,
    terminal: route.terminal,
    generatedGuestInstructions: route.generatedGuestInstructions,
    generatedCoverageNumerator: route.generatedCoverageNumerator,
    generatedExecuted: route.generatedExecuted,
    generatedChainLength: route.generatedChainLength,
    returnedDispatchTarget: route.returnedDispatchTarget,
    guestStateCommit: route.guestStateCommit,
    tciCorrectnessFallback: route.tciCorrectnessFallback,
    compatFallback: true,
  };
}

const r7AvailableGeneratedOutputExecCases = [
  simulateR7AvailableGeneratedOutputExec({
    name: "r7-live-coverage-disabled-keeps-tci",
    liveCoverageEnabled: false,
    metadata: null,
  }),
  simulateR7AvailableGeneratedOutputExec({
    name: "r7-available-generated-output-executes",
    liveCoverageEnabled: true,
    metadata: {
      opCount: R7_AVAILABLE_GENERATED_OUTPUT_SHAPE.length,
      generatedOutputAvailable: true,
      generatedOutputSize: R7_AVAILABLE_GENERATED_OUTPUT_WORDS.length * 4,
      words: R7_AVAILABLE_GENERATED_OUTPUT_WORDS,
      tbWords: R7_AVAILABLE_GENERATED_OUTPUT_WORDS,
      guestInstructions: 23,
    },
  }),
  simulateR7AvailableGeneratedOutputExec({
    name: "r7-rv64-helper-prefix-executes-and-counts-before-tci",
    liveCoverageEnabled: true,
    metadata: {
      opCount: R7_RV64_HELPER_PREFIX_WORDS.length + 2,
      generatedOutputAvailable: true,
      generatedOutputSize: R7_RV64_HELPER_PREFIX_WORDS.length * 4,
      words: R7_RV64_HELPER_PREFIX_WORDS,
      tbWords: R7_RV64_HELPER_PREFIX_WORDS,
      guestInstructions: 19,
    },
  }),
  simulateR7AvailableGeneratedOutputExec({
    name: "r7-available-generated-output-unsupported-falls-back",
    liveCoverageEnabled: true,
    metadata: {
      opCount: R7_AVAILABLE_GENERATED_OUTPUT_SHAPE.length,
      generatedOutputAvailable: true,
      generatedOutputSize: R7_AVAILABLE_GENERATED_OUTPUT_WORDS.length * 4,
      words: [
        ...R7_AVAILABLE_GENERATED_OUTPUT_WORDS.slice(0, -1),
        0xff,
      ],
      guestInstructions: 23,
    },
  }),
  simulateR7AvailableGeneratedOutputExec({
    name: "r7-generated-output-unavailable-falls-back",
    liveCoverageEnabled: true,
    metadata: {
      opCount: R7_AVAILABLE_GENERATED_OUTPUT_SHAPE.length,
      generatedOutputAvailable: false,
      generatedOutputSize: 0,
      words: [],
      guestInstructions: 23,
    },
  }),
];
assert.deepEqual(
  r7AvailableGeneratedOutputExecCases.map((entry) => entry.path),
  ["tci", "generated-probe-tci", "generated-probe-tci",
   "tci-fallback", "tci-fallback"],
);
assert.deepEqual(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-available-generated-output-executes").shape,
  R7_AVAILABLE_GENERATED_OUTPUT_SHAPE,
);
assert.deepEqual(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-rv64-helper-prefix-executes-and-counts-before-tci")
    .shape,
  R7_RV64_HELPER_PREFIX_SHAPE,
);
assert.equal(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-available-generated-output-executes")
    .generatedGuestInstructions,
  23,
);
assert.equal(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-available-generated-output-executes")
    .generatedCoverageNumerator,
  23,
);
assert.equal(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-rv64-helper-prefix-executes-and-counts-before-tci")
    .generatedExecuted,
  1,
);
assert.equal(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-rv64-helper-prefix-executes-and-counts-before-tci")
    .guestStateCommit,
  false,
);
assert.equal(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-rv64-helper-prefix-executes-and-counts-before-tci")
    .tciCorrectnessFallback,
  true,
);
assert.equal(
  r7AvailableGeneratedOutputExecCases.find((entry) =>
    entry.name === "r7-available-generated-output-unsupported-falls-back")
    .compatFallback,
  true,
);

const r8Rv64RealExecFixture = fixtures.find((fixture) =>
  fixture.name === "rv64-boot-move-logic-family");
const r8Rv64RealExecState = results.find((entry) =>
  entry.name === r8Rv64RealExecFixture.name && entry.seed === 1);
const r8RealGeneratedExecCases = [
  {
    name: "r8-rv64-real-generated-body-commits-state",
    ...routeR8RealGeneratedOutput({
      opCount: r8Rv64RealExecFixture.words.length,
      generatedOutputAvailable: true,
      generatedOutputSize: r8Rv64RealExecFixture.words.length * 4,
      words: r8Rv64RealExecFixture.words,
      tbWords: r8Rv64RealExecFixture.words,
      relativeBase: r8Rv64RealExecFixture.relativeBase,
      guestInstructions: r8Rv64RealExecFixture.guestInstructions,
    }),
    differential: {
      registerStateMatched: r8Rv64RealExecState.registerStateMatched,
      memoryStateMatched: r8Rv64RealExecState.memoryStateMatched,
      generatedTciOpEquivalents:
        r8Rv64RealExecState.generatedTciOpEquivalents,
    },
  },
  {
    name: "r8-rv64-helper-prefix-stays-fallback-until-continuation",
    ...routeR8RealGeneratedOutput({
      opCount: R7_RV64_HELPER_PREFIX_WORDS.length + 2,
      generatedOutputAvailable: true,
      generatedOutputSize: R7_RV64_HELPER_PREFIX_WORDS.length * 4,
      words: R7_RV64_HELPER_PREFIX_WORDS,
      tbWords: R7_RV64_HELPER_PREFIX_WORDS,
      relativeBase: 0x6c00,
      guestInstructions: 19,
    }),
  },
];
const r8GeneratedCommit = r8RealGeneratedExecCases.find((entry) =>
  entry.name === "r8-rv64-real-generated-body-commits-state");
assert.equal(r8GeneratedCommit.path, "generated");
assert.equal(r8GeneratedCommit.guestStateCommit, true);
assert.equal(r8GeneratedCommit.tciCorrectnessFallback, false);
assert.equal(r8GeneratedCommit.generatedGuestInstructions, 5);
assert.equal(r8GeneratedCommit.generatedExecuted, 1);
assert.equal(r8GeneratedCommit.moduleValid, true);
assert.equal(r8GeneratedCommit.differential.registerStateMatched, true);
assert.equal(r8GeneratedCommit.differential.memoryStateMatched, true);
assert.ok(r8GeneratedCommit.differential.generatedTciOpEquivalents > 0);
const r8HelperFallback = r8RealGeneratedExecCases.find((entry) =>
  entry.name === "r8-rv64-helper-prefix-stays-fallback-until-continuation");
assert.equal(r8HelperFallback.path, "tci-fallback");
assert.equal(r8HelperFallback.reason, "selected-body-shape-unsupported");
assert.equal(r8HelperFallback.guestStateCommit, false);
assert.equal(r8HelperFallback.tciCorrectnessFallback, true);
assert.equal(r8HelperFallback.fallbackGuestInstructions, 19);
const r9NormalBootGeneratedRetirement = {
  generatedGuestInstructions: r8RealGeneratedExecCases.reduce((count, entry) =>
    count + entry.generatedGuestInstructions, 0),
  fallbackGuestInstructions: r8RealGeneratedExecCases.reduce((count, entry) =>
    count + entry.fallbackGuestInstructions, 0),
  generatedBodyTimeNs: r8RealGeneratedExecCases.reduce((count, entry) =>
    count + entry.generatedBodyTimeNs, 0),
};
assert.deepEqual(r9NormalBootGeneratedRetirement, {
  generatedGuestInstructions: 5,
  fallbackGuestInstructions: 19,
  generatedBodyTimeNs: 1000,
});

const r7LongRunSourceFixture = fixtures.find((fixture) =>
  fixture.name === "rv64-boot-move-logic-family");
const r7LongRunTargetFixture = fixtures.find((fixture) =>
  fixture.name === "rv64-boot-setcond-branch-family");
const r7LongRunningGeneratedExec = simulateR7LongRunningGeneratedExec({
  sourceFixture: r7LongRunSourceFixture,
  targetFixture: r7LongRunTargetFixture,
  targetTbPtr: r7LongRunTargetFixture.relativeBase,
  sourceGuestInstructions: r7LongRunSourceFixture.guestInstructions,
  targetGuestInstructions: 6,
  budget: 64,
  seed: 1,
});
assert.equal(r7LongRunningGeneratedExec.path, "generated-chain");
assert.equal(r7LongRunningGeneratedExec.generatedRunEntries, 1);
assert.equal(r7LongRunningGeneratedExec.generatedChainLength, 2);
assert.equal(
  r7LongRunningGeneratedExec.generatedGuestInstructions,
  r7LongRunSourceFixture.guestInstructions + 6,
);
assert.equal(
  r7LongRunningGeneratedExec.generatedGuestInstructionsPerEntry,
  r7LongRunningGeneratedExec.generatedGuestInstructions,
);
assert.equal(r7LongRunningGeneratedExec.sourceStatus, STATUS_DISPATCH.toString());
assert.equal(r7LongRunningGeneratedExec.targetStatus, STATUS_EXIT.toString());
assert.equal(r7LongRunningGeneratedExec.registerStateMatched, true);
assert.equal(r7LongRunningGeneratedExec.memoryStateMatched, true);
assert.equal(r7LongRunningGeneratedExec.tciCorrectnessFallback, false);
assert.equal(r7LongRunningGeneratedExec.helperCalls, 0);

r4kInvalidationResults.push({
  name: "r4k-invalidation-generated-output-mismatch",
  success: false,
  expectedState: "before-generated-body-call",
  fallbackReason: r4kSoftmmuStaleOutputMismatch.reason,
  runExitReason: r4kSoftmmuStaleOutputMismatch.runExitReason,
  generatedGuestInstructions:
    r4kSoftmmuStaleOutputMismatch.generatedGuestInstructions.toString(),
  generatedChainLength:
    r4kSoftmmuStaleOutputMismatch.generatedChainLength.toString(),
  generatedBodyTimeNs:
    r4kSoftmmuStaleOutputMismatch.generatedBodyTimeNs.toString(),
  inlineTlbHitLoads:
    r4kSoftmmuStaleOutputMismatch.inlineTlbHitLoads.toString(),
  inlineTlbHitStores:
    r4kSoftmmuStaleOutputMismatch.inlineTlbHitStores.toString(),
  helperCalls: r4kSoftmmuStaleOutputMismatch.helperCalls.toString(),
  qemuLdCalls: r4kSoftmmuStaleOutputMismatch.qemuLdCalls.toString(),
  qemuStCalls: r4kSoftmmuStaleOutputMismatch.qemuStCalls.toString(),
  exits: {
    invalidated: r4kSoftmmuStaleOutputMismatch.exitsInvalidated.toString(),
  },
});
r4kSoftmmuResults.push({
  name: "r4k-softmmu-stale-output-mismatch",
  emitter: PER_TB_EMITTER_NAME,
  moduleValid: false,
  status: "metadata-output-tb-code-mismatch",
  runExitReason: "invalidated",
  fallbackReason: "metadata-output-tb-code-mismatch",
  expectedSuccess: false,
  inlineTlbHitLoads: "0",
  inlineTlbHitStores: "0",
  helperCalls: "0",
  qemuLdCalls: "0",
  qemuStCalls: "0",
  exits: {
    mmio: "0",
    tlbMissOrFault: "0",
    unsupported: "0",
    invalidated: "1",
  },
});
assert.equal(r4kInvalidationResults.length, 5);
assert.deepEqual(
  r4kInvalidationResults.map((entry) => entry.name),
  [
    "r4k-invalidation-valid-unchanged-tb-executes",
    "r4k-invalidation-tb-generation-mismatch",
    "r4k-invalidation-address-space-generation-mismatch",
    "r4k-invalidation-tlb-mirror-generation-mismatch",
    "r4k-invalidation-generated-output-mismatch",
  ],
);
assert.deepEqual(
  r4kInvalidationResults.filter((entry) => !entry.success).map((entry) => [
    entry.runExitReason,
    entry.generatedGuestInstructions,
    entry.generatedChainLength,
    entry.generatedBodyTimeNs,
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helperCalls,
    entry.qemuLdCalls,
    entry.qemuStCalls,
    entry.exits.invalidated,
  ]),
  r4kInvalidationResults.filter((entry) => !entry.success).map(() => [
    "invalidated", "0", "0", "0", "0", "0", "0", "0", "0", "1",
  ]),
);
const r4kSoftmmuNames = r4kSoftmmuResults.map((entry) => entry.name);
assert.deepEqual(
  r4kSoftmmuNames,
  [
    "r4k-softmmu-ld32u-tlb-hit-ram",
    "r4k-softmmu-ld-tlb-hit-ram",
    "r4k-softmmu-st8-tlb-hit-ram",
    "r4k-softmmu-st-tlb-hit-ram",
    "r4k-softmmu-tlb-miss",
    "r4k-softmmu-mmio",
    "r4k-softmmu-permission-fault",
    "r4k-softmmu-page-crossing",
    "r4k-softmmu-unsupported-memop",
    "r4k-softmmu-slow-flags",
    "r4k-softmmu-unmirrored-state",
    "r4k-softmmu-null-mirror",
    "r4k-softmmu-missing-table",
    "r4k-softmmu-stale-mmu-mirror",
    "r4k-softmmu-layout-constant-mismatch",
    "r4k-softmmu-stale-output-mismatch",
  ],
);
assert.deepEqual(
  r4kSoftmmuResults.filter((entry) =>
    entry.name !== "r4k-softmmu-stale-output-mismatch")
    .map((entry) => [entry.emitter, entry.softmmuLowering,
                     entry.softmmuLoweredOps]),
  r4kSoftmmuResults.filter((entry) =>
    entry.name !== "r4k-softmmu-stale-output-mismatch")
    .map(() => [PER_TB_EMITTER_NAME, SHARED_SOFTMMU_LOWERING_NAME, 1]),
);
const r4kSoftmmuRamHits = r4kSoftmmuResults.filter((entry) =>
  entry.name.endsWith("tlb-hit-ram"));
assert.equal(r4kSoftmmuRamHits.length, 4);
assert.deepEqual(
  r4kSoftmmuRamHits.map((entry) => entry.runExitReason),
  ["none", "none", "none", "none"],
);
assert.deepEqual(
  r4kSoftmmuRamHits.map((entry) => [
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helperCalls,
    entry.qemuLdCalls,
    entry.qemuStCalls,
  ]),
  [
    ["1", "0", "0", "0", "0"],
    ["1", "0", "0", "0", "0"],
    ["0", "1", "0", "0", "0"],
    ["0", "1", "0", "0", "0"],
  ],
);
const r4kSoftmmuFailClosed = r4kSoftmmuResults.filter((entry) =>
  !entry.expectedSuccess);
assert.deepEqual(
  r4kSoftmmuFailClosed.map((entry) => entry.fallbackReason),
  [
    "tlb-miss",
    "mmio",
    "permission-fault",
    "page-crossing",
    "unsupported-memop",
    "slow-flags",
    "unmirrored-state",
    "null-mirror",
    "missing-table",
    "stale-mmu-mirror",
    "layout-constant-mismatch",
    "metadata-output-tb-code-mismatch",
  ],
);
assert.deepEqual(
  r4kSoftmmuFailClosed.map((entry) => [
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helperCalls,
    entry.qemuLdCalls,
    entry.qemuStCalls,
  ]),
  r4kSoftmmuFailClosed.map(() => ["0", "0", "0", "0", "0"]),
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-mmio").exits.mmio,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-tlb-miss").exits.tlbMissOrFault,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-permission-fault").exits.tlbMissOrFault,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-page-crossing").exits.tlbMissOrFault,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-page-crossing").exitFlags,
  RUN_EXIT_FLAG_PAGE_CROSSING,
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-unsupported-memop").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-slow-flags").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-unmirrored-state").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-null-mirror").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-missing-table").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-stale-mmu-mirror").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-layout-constant-mismatch").exits.unsupported,
  "1",
);
assert.equal(
  r4kSoftmmuResults.find((entry) =>
    entry.name === "r4k-softmmu-stale-output-mismatch").exits.invalidated,
  "1",
);

assert.deepEqual(
  r6Rv64SoftmmuResults.map((entry) => entry.name),
  [
    "r6-rv64-softmmu-ld32u-tlb-hit-ram",
    "r6-rv64-softmmu-ld-tlb-hit-ram",
    "r6-rv64-softmmu-st8-tlb-hit-ram",
    "r6-rv64-softmmu-st32-tlb-hit-ram",
    "r6-rv64-softmmu-st-tlb-hit-ram",
    "r6-rv64-softmmu-tlb-miss",
    "r6-rv64-softmmu-mmio",
    "r6-rv64-softmmu-permission-fault",
    "r6-rv64-softmmu-page-crossing",
  ],
);
assert.equal(
  r6Rv64SoftmmuResults.every((entry) =>
    entry.emitter === R6_RV64_SOFTMMU_EMITTER_NAME && entry.moduleValid),
  true,
);
const r6Rv64SoftmmuRamHits = r6Rv64SoftmmuResults.filter((entry) =>
  entry.name.endsWith("tlb-hit-ram"));
const r6Rv64SoftmmuFailClosed = r6Rv64SoftmmuResults.filter((entry) =>
  !entry.expectedSuccess);
assert.deepEqual(
  r6Rv64SoftmmuRamHits.map((entry) => [
    entry.runExitReason,
    entry.helperVisibleStateMatched,
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helperCalls,
    entry.qemuLdCalls,
    entry.qemuStCalls,
  ]),
  [
    ["none", true, "1", "0", "0", "0", "0"],
    ["none", true, "1", "0", "0", "0", "0"],
    ["none", true, "0", "1", "0", "0", "0"],
    ["none", true, "0", "1", "0", "0", "0"],
    ["none", true, "0", "1", "0", "0", "0"],
  ],
);
assert.deepEqual(
  r6Rv64SoftmmuFailClosed.map((entry) => [
    entry.fallbackReason,
    entry.runExitReason,
    entry.inlineTlbHitLoads,
    entry.inlineTlbHitStores,
    entry.helperCalls,
    entry.qemuLdCalls,
    entry.qemuStCalls,
    entry.failClosedBeforeRamAccess,
  ]),
  [
    ["tlb-miss", "tlb-miss-or-fault", "0", "0", "0", "0", "0", true],
    ["mmio", "mmio", "0", "0", "0", "0", "0", true],
    [
      "permission-fault",
      "tlb-miss-or-fault",
      "0",
      "0",
      "0",
      "0",
      "0",
      true,
    ],
    [
      "page-crossing",
      "tlb-miss-or-fault",
      "0",
      "0",
      "0",
      "0",
      "0",
      true,
    ],
  ],
);
assert.equal(
  r6Rv64SoftmmuResults.find((entry) =>
    entry.name === "r6-rv64-softmmu-mmio").exits.mmio,
  "1",
);
assert.equal(
  r6Rv64SoftmmuResults.find((entry) =>
    entry.name === "r6-rv64-softmmu-tlb-miss").exits.tlbMissOrFault,
  "1",
);
assert.equal(
  r6Rv64SoftmmuResults.find((entry) =>
    entry.name === "r6-rv64-softmmu-permission-fault").exits.tlbMissOrFault,
  "1",
);
assert.equal(
  r6Rv64SoftmmuResults.find((entry) =>
    entry.name === "r6-rv64-softmmu-page-crossing").exitFlags,
  RUN_EXIT_FLAG_PAGE_CROSSING,
);
console.log(JSON.stringify({
  format: 1,
  event: "generated-output-equivalence",
  fixtures: results.length,
  unsupportedFixtures: unsupportedResults.length,
  emitter: PER_TB_EMITTER_NAME,
  emittedModuleFixtures: results.filter((entry) =>
    entry.emitter === PER_TB_EMITTER_NAME && entry.moduleValid).length,
  liveX86PreR4iFixtures: liveX86Results.length,
  liveX86PreR4iShape: PRE_R4I_LIVE_X86_SHAPE,
  liveX86PreR4iGeneratedTciOpEquivalents:
    liveX86Results.reduce((count, entry) =>
      count + entry.generatedTciOpEquivalents, 0),
  liveX86PreR4iMemoryWrites:
    liveX86Results.reduce((count, entry) => count + entry.memoryWrites, 0),
  r4iPerTBEmitterFixtures: r4iEmitterResults.length,
  r4iPerTBEmitterShape: R4I_LIVE_X86_SHAPE,
  r4iPerTBEmitterRegisterStateMatched:
    r4iEmitterResults.every((entry) => entry.registerStateMatched),
  r4iPerTBEmitterMemoryStateMatched:
    r4iEmitterResults.every((entry) => entry.memoryStateMatched),
  r4iPerTBEmitterDispatchTargets:
    r4iEmitterResults.map((entry) => entry.ret),
  r4iPerTBEmitterGeneratedGuestInstructions:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.generatedGuestInstructions, 0),
  r4iPerTBEmitterGeneratedTciOpEquivalents:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.generatedTciOpEquivalents, 0),
  r4iPerTBEmitterInlineTlbHitLoads:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.inlineTlbHitLoads, 0),
  r4iPerTBEmitterInlineTlbHitStores:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.inlineTlbHitStores, 0),
  r4iPerTBEmitterMemoryWrites:
    r4iEmitterResults.reduce((count, entry) => count + entry.memoryWrites, 0),
  r4iPerTBEmitterHelperCalls:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.helpers.loads + entry.helpers.stores, 0),
  r4iPerTBEmitterQemuLdCalls:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.helpers.loads, 0),
  r4iPerTBEmitterQemuStCalls:
    r4iEmitterResults.reduce((count, entry) =>
      count + entry.helpers.stores, 0),
  r4iPerTBEmitterRuntimeUnsupportedGuards:
    r4iEmitterResults.flatMap((entry) => entry.runtimeUnsupportedGuards),
  r4iX86CpuStateContract:
    r4iEmitterResults[0].x86CpuStateContract,
  r4iRuntimeUnsupportedFlush: r4iRuntimeUnsupported,
  r4kTwoTBHotset: {
    emitter: TWO_TB_HOTSET_EMITTER_NAME,
    fixtureCount: r4kTwoTBHotsetResults.length,
    chainedHit: r4kTwoTBHotsetHit,
    failClosedCases: r4kTwoTBHotsetFailures,
    unsupportedCases: r4kTwoTBHotsetFailures.map((entry) => ({
      name: entry.name,
      fallbackReason: entry.fallbackReason,
      runExitReason: entry.runExitReason,
      generatedGuestInstructions: entry.generatedGuestInstructions,
      generatedChainLength: entry.generatedChainLength,
      generatedBodyTimeNs: entry.generatedBodyTimeNs,
    })),
  },
  r4kInvalidationRejection: {
    fixtureCount: r4kInvalidationResults.length,
    tbGenerationToken: R4K_INVALIDATION_TB_GENERATION.toString(),
    addressSpaceGenerationToken:
      R4K_INVALIDATION_ADDRESS_SPACE_GENERATION.toString(),
    tlbMirrorGenerationToken:
      R4K_INVALIDATION_TLB_MIRROR_GENERATION.toString(),
    validUnchanged: r4kInvalidationValid,
    failClosedCases: r4kInvalidationResults.filter((entry) =>
      !entry.success),
  },
  r4kSoftmmuFastPath: {
    emitter: PER_TB_EMITTER_NAME,
    lowering: SHARED_SOFTMMU_LOWERING_NAME,
    legacyFixtureEmitter: R4K_SOFTMMU_EMITTER_NAME,
    fixtureCount: r4kSoftmmuResults.length,
    fixtures: r4kSoftmmuResults,
    ramHits: r4kSoftmmuRamHits,
    failClosedCases: r4kSoftmmuFailClosed,
  },
  r6Rv64SoftmmuFastPath: {
    emitter: R6_RV64_SOFTMMU_EMITTER_NAME,
    fixtureCount: r6Rv64SoftmmuResults.length,
    fixtures: r6Rv64SoftmmuResults,
    ramHits: r6Rv64SoftmmuRamHits,
    failClosedCases: r6Rv64SoftmmuFailClosed,
    acceptedHitCounters: {
      inlineTlbHitLoads: r6Rv64SoftmmuRamHits.reduce(
        (count, entry) => count + BigInt(entry.inlineTlbHitLoads), 0n)
        .toString(),
      inlineTlbHitStores: r6Rv64SoftmmuRamHits.reduce(
        (count, entry) => count + BigInt(entry.inlineTlbHitStores), 0n)
        .toString(),
      qemuLdCalls: r6Rv64SoftmmuRamHits.reduce(
        (count, entry) => count + BigInt(entry.qemuLdCalls), 0n).toString(),
      qemuStCalls: r6Rv64SoftmmuRamHits.reduce(
        (count, entry) => count + BigInt(entry.qemuStCalls), 0n).toString(),
    },
  },
  r4mLiveGeneratedExec: {
    fixtureCount: r4mLiveGeneratedExecCases.length,
    fixtures: r4mLiveGeneratedExecCases,
    memopRejectAttribution: r4s7MemopRejectAttribution,
    generatedFixtures: r4mLiveGeneratedExecCases.filter((entry) =>
      entry.path === "generated").length,
    failClosedFixtures: r4mLiveGeneratedExecCases.filter((entry) =>
      entry.failedClosed).length,
    compatFallbackFixtures: r4mLiveGeneratedExecCases.filter((entry) =>
      entry.compatFallback).length,
  },
  r7AvailableGeneratedOutputExec: {
    fixtureCount: r7AvailableGeneratedOutputExecCases.length,
    fixtures: r7AvailableGeneratedOutputExecCases,
    generatedFixtures: r7AvailableGeneratedOutputExecCases.filter((entry) =>
      entry.generatedExecuted > 0).length,
    compatFallbackFixtures: r7AvailableGeneratedOutputExecCases.filter(
      (entry) => entry.compatFallback).length,
  },
  r7LongRunningGeneratedExec: {
    fixtureCount: 1,
    fixture: r7LongRunningGeneratedExec,
    expectedGeneratedChainLength: 2,
    expectedGeneratedRunEntries: 1,
  },
  r8RealGeneratedExec: {
    fixtureCount: r8RealGeneratedExecCases.length,
    fixtures: r8RealGeneratedExecCases,
    normalBootRetirementCounters: r9NormalBootGeneratedRetirement,
    generatedFixtures: r8RealGeneratedExecCases.filter((entry) =>
      entry.path === "generated").length,
    committedFixtures: r8RealGeneratedExecCases.filter((entry) =>
      entry.guestStateCommit).length,
  },
  r4kLiveMetadataRouting: r4kLiveRoutingCases,
  unsupportedX86StateFixtures: unsupportedX86StateResults,
  helperBoundaryFixtures: helperBoundaryResults.length,
  simpleGapFixtures: simpleGapResults.length,
  rv64EnvRelativeFixtures: {
    fixtureExecutions: rv64EnvRelativeResults.length,
    fixtureNames: [...new Set(rv64EnvRelativeResults.map((entry) =>
      entry.name))],
    baseRegister: `tcg-temp-${RV64_ENV_RELATIVE_BASE_REG}`,
    minOffset: RV64_ENV_RELATIVE_MIN_OFFSET,
    maxExclusiveOffset: RV64_ENV_RELATIVE_MAX_EXCLUSIVE,
    generatedTciOpEquivalents: rv64EnvRelativeResults.reduce((count, entry) =>
      count + entry.generatedTciOpEquivalents, 0),
    inlineTlbHitLoads: rv64EnvRelativeResults.reduce((count, entry) =>
      count + entry.inlineTlbHitLoads, 0),
    inlineTlbHitStores: rv64EnvRelativeResults.reduce((count, entry) =>
      count + entry.inlineTlbHitStores, 0),
    helperCalls: rv64EnvRelativeResults.reduce((count, entry) =>
      count + entry.helpers.loads + entry.helpers.stores, 0),
    opFamilies: [
      "ld32u-env-relative",
      "ld32s-env-relative",
      "ld-env-relative",
      "st8-env-relative",
      "st32-env-relative",
      "st-env-relative",
      "non-env-base-fail-closed",
      "out-of-range-fail-closed",
    ],
  },
  rv64HelperExitFixtures: {
    fixtureExecutions: rv64HelperExitResults.length,
    fixtureNames: [...new Set(rv64HelperExitResults.map((entry) =>
      entry.name))],
    generatedTciOpEquivalents: rv64HelperExitResults.reduce((count, entry) =>
      count + entry.generatedTciOpEquivalents, 0),
    helperExitStatus: STATUS_HELPER.toString(),
    helperExitReason: "helper",
    helperCalls: rv64HelperExitResults.reduce((count, entry) =>
      count + entry.helpers.loads + entry.helpers.stores, 0),
    opFamilies: [
      "helper-exit-at-call",
      "call-at-entry-fail-closed",
      "int128-helper-return-fail-closed",
    ],
  },
  rv64BootPathFixtures: {
    fixtureExecutions: rv64BootPathResults.length,
    fixtureNames: [...new Set(rv64BootPathResults.map((entry) => entry.name))],
    generatedTciOpEquivalents: rv64BootPathResults.reduce((count, entry) =>
      count + entry.generatedTciOpEquivalents, 0),
    helperCalls: rv64BootPathResults.reduce((count, entry) =>
      count + entry.helpers.loads + entry.helpers.stores, 0),
    opFamilies: [
      "move-immediate-literal",
      "barrier-noop",
      "add-sub-mul",
      "and-or-xor",
      "setcond-brcond",
      "goto-exit-terminal",
    ],
  },
  helperCalls: {
    loads: helperBoundaryResults.reduce((count, entry) =>
      count + entry.helpers.loads, 0),
    stores: helperBoundaryResults.reduce((count, entry) =>
      count + entry.helpers.stores, 0),
  },
  terminals: {
    goto_tb: results.filter((entry) => entry.terminal === "goto_tb").length,
    exit_tb: results.filter((entry) => entry.terminal === "exit_tb").length,
    helper: results.filter((entry) => entry.terminal === "helper").length,
  },
}, null, 2));
