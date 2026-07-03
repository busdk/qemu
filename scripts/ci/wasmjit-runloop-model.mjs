#!/usr/bin/env node
/*
 * Deterministic browser-Wasm accelerator run-loop model.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const VALUE_I32 = 0x7f;
const VALUE_I64 = 0x7e;

export const WASMJIT_RUNLOOP_MODEL_VERSION = 2;
export const WASMJIT_EXIT_BUDGET = 1;

export const WASMJIT_WORKLOAD_ALU_BRANCH = "alu-branch";
export const WASMJIT_WORKLOAD_TLB_HIT_RAM = "tlb-hit-ram";

export const WASMJIT_RUN_CTX = {
  env: 0,
  guestRam: 8,
  budget: 16,
  counters: 24,
  exit: 32,
  mode: 40,
  flags: 44,
  hotset: 48,
  size: 56,
};

export const WASMJIT_RUN_EXIT = {
  reason: 0,
  tbId: 4,
  pc: 8,
  vaddr: 16,
  paddr: 24,
  value: 32,
  sizeField: 40,
  flags: 44,
  size: 48,
};

export const WASMJIT_COUNTERS = {
  generatedGuestInstructions: 0,
  fallbackGuestInstructions: 8,
  generatedBodyTimeNs: 16,
  tciDispatchTimeNs: 24,
  tbLookupTimeNs: 32,
  helperCallTimeNs: 40,
  qemuLdTimeNs: 48,
  qemuStTimeNs: 56,
  compileTimeNs: 64,
  instantiateTimeNs: 72,
  generatedChainLength: 80,
  inlineTlbHitLoads: 88,
  inlineTlbHitStores: 96,
  helperCalls: 104,
  qemuLoadCalls: 112,
  qemuStoreCalls: 120,
  exitsBudget: 128,
  exitsMmio: 136,
  exitsTlbMissOrFault: 144,
  exitsInterrupt: 152,
  exitsHelper: 160,
  exitsUnsupported: 168,
  exitsHlt: 176,
  exitsInvalidated: 184,
  size: 192,
};

export const WASMJIT_ENV_OFFSET_INVALID = 0xffffffff;

export const WASMJIT_HOTSET_TB = {
  tbId: 0,
  nextTbId: 4,
  op: 8,
  guestInstructions: 12,
  immediate: 16,
  valueReg: 24,
  baseReg: 28,
  loadOffset: 32,
  storeOffset: 36,
  branchReg: 40,
  storeReg: 44,
  branchCond: 48,
  terminalOp: 52,
  terminalDiff: 56,
  flags: 60,
  valueEnvOffset: 64,
  baseEnvOffset: 68,
  branchEnvOffset: 72,
  storeEnvOffset: 76,
  size: 80,
};

export const WASMJIT_HOTSET = {
  tbCount: 0,
  entryTbId: 4,
  tbs: 8,
  size: 16,
};

export const WASMJIT_HOTSET_OP = {
  ramAddConst: 1,
  ramXorConst: 2,
  aluAddConst: 3,
  aluXorConst: 4,
  traceLd32uBranchStore: 5,
};

export const WASMJIT_TB_METADATA_FLAGS = {
  valid: 1 << 0,
  fallback: 1 << 1,
  loweringProfile: 1 << 2,
  profileLowerable: 1 << 3,
  generatedCandidate: 1 << 4,
  terminal: 1 << 5,
  generatedOutput: 1 << 6,
  outputTruncated: 1 << 7,
};

export const WASMJIT_TB_METADATA_MAGIC = 0x36574153;
export const WASMJIT_TB_METADATA_VERSION = 1;

export const WASMJIT_HOTSET_BUILD_STATUS = {
  ok: "ok",
  empty: "empty",
  capacity: "capacity",
  missingMetadata: "missing-metadata",
  invalidMetadata: "invalid-metadata",
  nonTerminal: "non-terminal",
  unsupportedHotTb: "unsupported-hot-tb",
  noGeneratedOutput: "no-generated-output",
  outputTruncated: "output-truncated",
};

export function encodeTciRI(op, r0, imm) {
  return ((op & 0xff) |
    ((r0 & 0xf) << 8) |
    (((imm << 12) >> 12) << 12)) >>> 0;
}

export function encodeTciRRR(op, r0, r1, r2) {
  return ((op & 0xff) |
    ((r0 & 0xf) << 8) |
    ((r1 & 0xf) << 12) |
    ((r2 & 0xf) << 16)) >>> 0;
}

export function encodeTciRRS(op, r0, r1, offset) {
  return ((op & 0xff) |
    ((r0 & 0xf) << 8) |
    ((r1 & 0xf) << 12) |
    (((offset << 16) >> 16) << 16)) >>> 0;
}

export function encodeTciP(op, diff = 0) {
  return ((op & 0xff) | (((diff << 12) >> 12) << 12)) >>> 0;
}

export function encodeTciRL(op, r0, diff = 0) {
  return ((op & 0xff) | ((r0 & 0xf) << 8) |
    (((diff << 12) >> 12) << 12)) >>> 0;
}

function signExtend(value, bits) {
  const shift = 32 - bits;
  return (value << shift) >> shift;
}

function tciOp(insn) {
  return insn & 0xff;
}

function tciR0(insn) {
  return (insn >>> 8) & 0xf;
}

function tciR1(insn) {
  return (insn >>> 12) & 0xf;
}

function tciR2(insn) {
  return (insn >>> 16) & 0xf;
}

function tciImm20(insn) {
  return signExtend(insn >>> 12, 20);
}

function tciOffset16(insn) {
  return signExtend(insn >>> 16, 16);
}

function tciCond4(insn) {
  return (insn >>> 20) & 0xf;
}

function terminalOp(opcodes, op) {
  return op === opcodes.goto_tb || op === opcodes.exit_tb;
}

function metadataEnvOffset(metadata, reg) {
  const offsets = metadata.tciRegEnvOffsets;
  if (!Array.isArray(offsets) || reg < 0 || reg >= offsets.length) {
    return WASMJIT_ENV_OFFSET_INVALID;
  }
  const offset = offsets[reg];
  return Number.isInteger(offset) && offset >= 0 && offset <= 0xffffffff
    ? offset >>> 0
    : WASMJIT_ENV_OFFSET_INVALID;
}

function decodeSemanticHotsetTB(metadata, opcodes) {
  const words = metadata.generatedOutput;
  if (!opcodes || !words || words.length < 3) {
    return null;
  }

  const terminalIndex = words.findIndex((word) =>
    terminalOp(opcodes, tciOp(word)));
  if (terminalIndex < 0) {
    return null;
  }
  const terminal = tciOp(words[terminalIndex]);
  const terminalDiff = tciImm20(words[terminalIndex]);

  if (terminalIndex === 3 &&
      words.length === 4 &&
      tciOp(words[0]) === opcodes.tci_movi &&
      (tciOp(words[1]) === opcodes.add || tciOp(words[1]) === opcodes.xor) &&
      tciOp(words[2]) === opcodes.brcond) {
    const constReg = tciR0(words[0]);
    const dstReg = tciR0(words[1]);
    if (tciR1(words[1]) !== dstReg || tciR2(words[1]) !== constReg ||
        tciR0(words[2]) !== dstReg) {
      return null;
    }
    return {
      op: tciOp(words[1]) === opcodes.add
        ? WASMJIT_HOTSET_OP.aluAddConst
        : WASMJIT_HOTSET_OP.aluXorConst,
      immediate: BigInt.asUintN(64, BigInt(tciImm20(words[0]))),
      valueReg: dstReg,
      branchReg: tciR0(words[2]),
      valueEnvOffset: metadataEnvOffset(metadata, dstReg),
      branchEnvOffset: metadataEnvOffset(metadata, tciR0(words[2])),
      terminalOp: terminal,
      terminalDiff,
    };
  }

  if (terminalIndex >= 6 &&
      words.length >= 7 &&
      tciOp(words[0]) === opcodes.ld32u &&
      tciOp(words[1]) === opcodes.tci_movi &&
      tciOp(words[2]) === opcodes.tci_setcond32 &&
      tciOp(words[3]) === opcodes.brcond) {
    const loadReg = tciR0(words[0]);
    const baseReg = tciR1(words[0]);
    const compareConstReg = tciR0(words[1]);
    const branchReg = tciR0(words[3]);

    if (tciR0(words[2]) !== branchReg ||
        tciR1(words[2]) !== loadReg ||
        tciR2(words[2]) !== compareConstReg) {
      return null;
    }

    for (let index = 4; index < terminalIndex; index++) {
      if (tciOp(words[index]) === opcodes.st8) {
        return {
          op: WASMJIT_HOTSET_OP.traceLd32uBranchStore,
          immediate: BigInt.asUintN(64, BigInt(tciImm20(words[1]))),
          valueReg: loadReg,
          baseReg,
          loadOffset: tciOffset16(words[0]),
          storeOffset: tciOffset16(words[index]),
          branchReg,
          storeReg: tciR0(words[index]),
          branchCond: tciCond4(words[2]),
          valueEnvOffset: metadataEnvOffset(metadata, loadReg),
          baseEnvOffset: metadataEnvOffset(metadata, baseReg),
          branchEnvOffset: metadataEnvOffset(metadata, branchReg),
          storeEnvOffset: metadataEnvOffset(metadata, tciR0(words[index])),
          terminalOp: terminal,
          terminalDiff,
        };
      }
    }
    return null;
  }

  if (terminalIndex === 4 &&
      words.length === 5 &&
      tciOp(words[0]) === opcodes.ld &&
      tciOp(words[1]) === opcodes.tci_movi &&
      (tciOp(words[2]) === opcodes.add || tciOp(words[2]) === opcodes.xor) &&
      tciOp(words[3]) === opcodes.st) {
    const valueReg = tciR0(words[0]);
    const baseReg = tciR1(words[0]);
    const constReg = tciR0(words[1]);
    if (tciOffset16(words[0]) !== 0 ||
        tciR0(words[2]) !== valueReg ||
        tciR1(words[2]) !== valueReg ||
        tciR2(words[2]) !== constReg ||
        tciR0(words[3]) !== valueReg ||
        tciR1(words[3]) !== baseReg ||
        tciOffset16(words[3]) !== 0) {
      return null;
    }
    return {
      op: tciOp(words[2]) === opcodes.add
        ? WASMJIT_HOTSET_OP.ramAddConst
        : WASMJIT_HOTSET_OP.ramXorConst,
      immediate: BigInt.asUintN(64, BigInt(tciImm20(words[1]))),
      valueReg,
      baseReg,
      loadOffset: tciOffset16(words[0]),
      storeOffset: tciOffset16(words[3]),
      storeReg: tciR0(words[3]),
      valueEnvOffset: metadataEnvOffset(metadata, valueReg),
      baseEnvOffset: metadataEnvOffset(metadata, baseReg),
      storeEnvOffset: metadataEnvOffset(metadata, tciR0(words[3])),
      terminalOp: terminal,
      terminalDiff,
    };
  }

  return null;
}

export function encodeU32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("encodeU32 expects an unsigned 32-bit integer");
  }
  const bytes = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

export function encodeS64(value) {
  let remaining = BigInt(value);
  const bytes = [];
  for (;;) {
    let byte = Number(remaining & 0x7fn);
    const sign = (byte & 0x40) !== 0;
    remaining >>= 7n;
    const done = (remaining === 0n && !sign) || (remaining === -1n && sign);
    if (!done) {
      byte |= 0x80;
    }
    bytes.push(byte);
    if (done) {
      return bytes;
    }
  }
}

function normalizeWorkload(workload) {
  if (workload === WASMJIT_WORKLOAD_ALU_BRANCH ||
      workload === WASMJIT_WORKLOAD_TLB_HIT_RAM) {
    return workload;
  }
  throw new Error(`unsupported wasmjit run-loop workload: ${workload}`);
}

function metadataBaseValid(metadata) {
  return metadata &&
    metadata.magic === WASMJIT_TB_METADATA_MAGIC &&
    metadata.version === WASMJIT_TB_METADATA_VERSION &&
    (metadata.flags & WASMJIT_TB_METADATA_FLAGS.valid) !== 0;
}

function generatedOutputAvailable(metadata) {
  if (!metadataBaseValid(metadata)) {
    return false;
  }
  if ((metadata.flags & WASMJIT_TB_METADATA_FLAGS.generatedCandidate) === 0 ||
      (metadata.flags & WASMJIT_TB_METADATA_FLAGS.terminal) === 0 ||
      metadata.generatedUnsupportedOpCount !== 0) {
    return false;
  }
  if ((metadata.flags & WASMJIT_TB_METADATA_FLAGS.generatedOutput) === 0 ||
      (metadata.flags & WASMJIT_TB_METADATA_FLAGS.outputTruncated) !== 0) {
    return false;
  }
  return metadata.generatedOutputSize !== 0 &&
    metadata.generatedOutputSize % 4 === 0 &&
    metadata.generatedOutputOpCount === metadata.opCount &&
    metadata.generatedOutputOpCount === metadata.generatedOutputSize / 4 &&
    Array.isArray(metadata.generatedOutput);
}

export function buildHotsetFromMetadataModel(metadata, {
  capacity = metadata.length,
  opcodes,
} = {}) {
  if (metadata.length === 0) {
    return { ok: false, status: WASMJIT_HOTSET_BUILD_STATUS.empty };
  }
  if (metadata.length > capacity || metadata.length > 0xffffffff) {
    return { ok: false, status: WASMJIT_HOTSET_BUILD_STATUS.capacity };
  }

  const tbs = [];
  for (const [index, current] of metadata.entries()) {
    if (!current) {
      return {
        ok: false,
        status: WASMJIT_HOTSET_BUILD_STATUS.missingMetadata,
      };
    }
    if (!metadataBaseValid(current)) {
      return {
        ok: false,
        status: WASMJIT_HOTSET_BUILD_STATUS.invalidMetadata,
      };
    }
    if ((current.flags & WASMJIT_TB_METADATA_FLAGS.terminal) === 0) {
      return { ok: false, status: WASMJIT_HOTSET_BUILD_STATUS.nonTerminal };
    }
    if ((current.flags & WASMJIT_TB_METADATA_FLAGS.generatedCandidate) === 0 ||
        current.generatedUnsupportedOpCount !== 0) {
      return {
        ok: false,
        status: WASMJIT_HOTSET_BUILD_STATUS.unsupportedHotTb,
      };
    }
    if ((current.flags & WASMJIT_TB_METADATA_FLAGS.outputTruncated) !== 0) {
      return {
        ok: false,
        status: WASMJIT_HOTSET_BUILD_STATUS.outputTruncated,
      };
    }
    if (!generatedOutputAvailable(current)) {
      return {
        ok: false,
        status: WASMJIT_HOTSET_BUILD_STATUS.noGeneratedOutput,
      };
    }

    const semantic = decodeSemanticHotsetTB(current, opcodes);
    if (!semantic) {
      return {
        ok: false,
        status: WASMJIT_HOTSET_BUILD_STATUS.unsupportedHotTb,
      };
    }

    const tbId = index + 1;
    tbs.push({
      tbId,
      nextTbId: index + 1 === metadata.length ? 1 : tbId + 1,
      op: semantic.op,
      guestInstructions: current.generatedOutputOpCount,
      immediate: semantic.immediate,
      valueReg: semantic.valueReg ?? 0,
      baseReg: semantic.baseReg ?? 0,
      loadOffset: semantic.loadOffset ?? 0,
      storeOffset: semantic.storeOffset ?? 0,
      branchReg: semantic.branchReg ?? 0,
      storeReg: semantic.storeReg ?? 0,
      branchCond: semantic.branchCond ?? 0,
      terminalOp: semantic.terminalOp ?? 0,
      terminalDiff: semantic.terminalDiff ?? 0,
      flags: semantic.flags ?? 0,
      valueEnvOffset: semantic.valueEnvOffset ?? WASMJIT_ENV_OFFSET_INVALID,
      baseEnvOffset: semantic.baseEnvOffset ?? WASMJIT_ENV_OFFSET_INVALID,
      branchEnvOffset: semantic.branchEnvOffset ?? WASMJIT_ENV_OFFSET_INVALID,
      storeEnvOffset: semantic.storeEnvOffset ?? WASMJIT_ENV_OFFSET_INVALID,
    });
  }

  return {
    ok: true,
    status: WASMJIT_HOTSET_BUILD_STATUS.ok,
    hotset: {
      tbCount: tbs.length,
      entryTbId: tbs[0].tbId,
      tbs,
    },
  };
}

function utf8Bytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function section(id, payload) {
  return [id, ...encodeU32(payload.length), ...payload];
}

function vector(items) {
  return [...encodeU32(items.length), ...items.flat()];
}

function name(text) {
  const bytes = utf8Bytes(text);
  return [...encodeU32(bytes.length), ...bytes];
}

function functionType(params, results) {
  return [
    0x60,
    ...vector(params.map((param) => [param])),
    ...vector(results.map((result) => [result])),
  ];
}

function functionBody(instructions, locals = []) {
  const body = [
    ...vector(locals.map(({ count, type }) => [...encodeU32(count), type])),
    ...instructions,
    0x0b,
  ];
  return [...encodeU32(body.length), ...body];
}

function memArg(align, offset) {
  return [...encodeU32(align), ...encodeU32(offset)];
}

function localGet(index) {
  return [0x20, ...encodeU32(index)];
}

function localSet(index) {
  return [0x21, ...encodeU32(index)];
}

function i32Const(value) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error("i32Const expects a signed 32-bit integer");
  }
  const bytes = [];
  let remaining = value | 0;
  for (;;) {
    let byte = remaining & 0x7f;
    const sign = (byte & 0x40) !== 0;
    remaining >>= 7;
    const done = (remaining === 0 && !sign) || (remaining === -1 && sign);
    if (!done) {
      byte |= 0x80;
    }
    bytes.push(byte);
    if (done) {
      return [0x41, ...bytes];
    }
  }
}

function i64Const(value) {
  return [0x42, ...encodeS64(value)];
}

function i32LoadAtPtr(ptrLocal, offset) {
  return [
    ...localGet(ptrLocal),
    0x28, ...memArg(2, offset),
  ];
}

function i64LoadAtPtr(ptrLocal, offset) {
  return [
    ...localGet(ptrLocal),
    0x29, ...memArg(3, offset),
  ];
}

function i32StoreAtPtr(ptrLocal, offset, valueBytes) {
  return [
    ...localGet(ptrLocal),
    ...valueBytes,
    0x36, ...memArg(2, offset),
  ];
}

function i64StoreAtPtr(ptrLocal, offset, valueBytes) {
  return [
    ...localGet(ptrLocal),
    ...valueBytes,
    0x37, ...memArg(3, offset),
  ];
}

function wasmjitRunInstructions(workload) {
  workload = normalizeWorkload(workload);

  const remaining = 2;
  const state = 3;
  const countersPtr = 4;
  const guestRamPtr = 5;
  const exitPtr = 6;
  const value = 7;
  const generatedGuestInstructions = 8;
  const generatedChainLength = 9;
  const inlineLoads = 10;
  const inlineStores = 11;
  const isRam = workload === WASMJIT_WORKLOAD_TLB_HIT_RAM;

  const tb0ValueUpdate = isRam ? [
    ...i64LoadAtPtr(guestRamPtr, 0),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(value),
    ...i64StoreAtPtr(guestRamPtr, 0, localGet(value)),
    ...localGet(inlineLoads),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(inlineLoads),
    ...localGet(inlineStores),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(inlineStores),
  ] : [
    ...localGet(value),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(value),
  ];
  const tb1ValueUpdate = isRam ? [
    ...i64LoadAtPtr(guestRamPtr, 0),
    ...i64Const(0x5a5an),
    0x85,                  /* i64.xor */
    ...localSet(value),
    ...i64StoreAtPtr(guestRamPtr, 0, localGet(value)),
    ...localGet(inlineLoads),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(inlineLoads),
    ...localGet(inlineStores),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(inlineStores),
  ] : [
    ...localGet(value),
    ...i64Const(0x5a5an),
    0x85,                  /* i64.xor */
    ...localSet(value),
  ];

  return [
    ...localGet(1),
    ...localSet(remaining),
    ...i32Const(0),
    ...localSet(state),
    ...i32LoadAtPtr(0, WASMJIT_RUN_CTX.counters),
    ...localSet(countersPtr),
    ...i32LoadAtPtr(0, WASMJIT_RUN_CTX.guestRam),
    ...localSet(guestRamPtr),
    ...i32LoadAtPtr(0, WASMJIT_RUN_CTX.exit),
    ...localSet(exitPtr),
    ...i64LoadAtPtr(countersPtr, WASMJIT_COUNTERS.generatedGuestInstructions),
    ...localSet(generatedGuestInstructions),
    ...i64LoadAtPtr(countersPtr, WASMJIT_COUNTERS.generatedChainLength),
    ...localSet(generatedChainLength),
    ...i64LoadAtPtr(countersPtr, WASMJIT_COUNTERS.inlineTlbHitLoads),
    ...localSet(inlineLoads),
    ...i64LoadAtPtr(countersPtr, WASMJIT_COUNTERS.inlineTlbHitStores),
    ...localSet(inlineStores),
    ...(isRam
      ? i64LoadAtPtr(guestRamPtr, 0)
      : i64Const(0n)),
    ...localSet(value),

    0x02, 0x40,            /* block exit */
    0x03, 0x40,            /* loop dispatch */
    ...localGet(remaining),
    0x45,                  /* i32.eqz */
    0x0d, ...encodeU32(1), /* br_if exit */

    ...localGet(remaining),
    ...i32Const(1),
    0x6b,                  /* i32.sub */
    ...localSet(remaining),

    ...localGet(state),
    0x45,                  /* i32.eqz */
    0x04, 0x40,            /* if tb0 */
    ...tb0ValueUpdate,
    ...i32Const(1),
    ...localSet(state),
    0x05,                  /* else tb1 */
    ...tb1ValueUpdate,
    ...i32Const(0),
    ...localSet(state),
    0x0b,                  /* end if */

    ...localGet(generatedGuestInstructions),
    ...i64Const(4n),
    0x7c,                  /* i64.add */
    ...localSet(generatedGuestInstructions),
    ...localGet(generatedChainLength),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(generatedChainLength),
    0x0c, ...encodeU32(0), /* br dispatch */
    0x0b,                  /* end loop */
    0x0b,                  /* end block */

    ...i64StoreAtPtr(countersPtr, WASMJIT_COUNTERS.generatedGuestInstructions,
      localGet(generatedGuestInstructions)),
    ...i64StoreAtPtr(countersPtr, WASMJIT_COUNTERS.generatedChainLength,
      localGet(generatedChainLength)),
    ...i64StoreAtPtr(countersPtr, WASMJIT_COUNTERS.inlineTlbHitLoads,
      localGet(inlineLoads)),
    ...i64StoreAtPtr(countersPtr, WASMJIT_COUNTERS.inlineTlbHitStores,
      localGet(inlineStores)),
    ...i64StoreAtPtr(exitPtr, WASMJIT_RUN_EXIT.value, localGet(value)),
    ...i32StoreAtPtr(exitPtr, WASMJIT_RUN_EXIT.reason,
      i32Const(WASMJIT_EXIT_BUDGET)),
    ...i32Const(WASMJIT_EXIT_BUDGET),
  ];
}

export function buildWasmjitRunloopModule({
  workload = WASMJIT_WORKLOAD_TLB_HIT_RAM,
} = {}) {
  const bytes = [
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([
      functionType([VALUE_I32, VALUE_I32], [VALUE_I32]),
    ])),
    ...section(2, vector([
      [...name("env"), ...name("memory"), 0x02, 0x00, ...encodeU32(1)],
    ])),
    ...section(3, vector([
      [0x00],
    ])),
    ...section(7, vector([
      [...name("wasmjit_run"), 0x00, ...encodeU32(0)],
    ])),
    ...section(10, vector([
      functionBody(wasmjitRunInstructions(workload), [
        { count: 5, type: VALUE_I32 },
        { count: 7, type: VALUE_I64 },
      ]),
    ])),
  ];

  return Uint8Array.from(bytes);
}

export function validateWasmjitRunloopContract(bytes) {
  if (!WebAssembly.validate(bytes)) {
    throw new Error("wasmjit run-loop module is not valid WebAssembly");
  }
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const nonMemoryImports = imports.filter((entry) => entry.kind !== "memory");
  const hasMemoryImport = imports.some((entry) =>
    entry.module === "env" &&
    entry.name === "memory" &&
    entry.kind === "memory");
  const hasRunExport = exports.some((entry) =>
    entry.name === "wasmjit_run" &&
    entry.kind === "function");

  if (!hasMemoryImport) {
    throw new Error("wasmjit run-loop module must import env.memory");
  }
  if (nonMemoryImports.length !== 0) {
    throw new Error("wasmjit run-loop module must not import helper functions");
  }
  if (!hasRunExport) {
    throw new Error("wasmjit run-loop module must export wasmjit_run(ctx,budget)");
  }

  return {
    imports,
    exports,
  };
}

function readU64(view, pointer, offset) {
  return view.getBigUint64(pointer + offset, true);
}

function writeU64(view, pointer, offset, value) {
  view.setBigUint64(pointer + offset, BigInt.asUintN(64, BigInt(value)), true);
}

function writeU32(view, pointer, offset, value) {
  view.setUint32(pointer + offset, value >>> 0, true);
}

export function initializeWasmjitRunloopState({
  memory,
  contextPointer = 128,
  countersPointer = 256,
  exitPointer = 384,
  ramPointer = 512,
  initialRamValue = 0n,
} = {}) {
  const view = new DataView(memory.buffer);

  for (let offset = 0; offset < WASMJIT_RUN_CTX.size; offset += 8) {
    writeU64(view, contextPointer, offset, 0n);
  }
  for (let offset = 0; offset < WASMJIT_COUNTERS.size; offset += 8) {
    writeU64(view, countersPointer, offset, 0n);
  }
  for (let offset = 0; offset < WASMJIT_RUN_EXIT.size; offset += 8) {
    writeU64(view, exitPointer, offset, 0n);
  }

  writeU32(view, contextPointer, WASMJIT_RUN_CTX.guestRam, ramPointer);
  writeU32(view, contextPointer, WASMJIT_RUN_CTX.counters, countersPointer);
  writeU32(view, contextPointer, WASMJIT_RUN_CTX.exit, exitPointer);
  writeU32(view, contextPointer, WASMJIT_RUN_CTX.mode, 1);
  writeU64(view, ramPointer, 0, initialRamValue);

  return {
    view,
    contextPointer,
    countersPointer,
    exitPointer,
    ramPointer,
    initialRamValue,
  };
}

export async function instantiateWasmjitRunloop({
  workload = WASMJIT_WORKLOAD_TLB_HIT_RAM,
} = {}) {
  const moduleBytes = buildWasmjitRunloopModule({ workload });
  const contract = validateWasmjitRunloopContract(moduleBytes);
  const compiled = await WebAssembly.compile(moduleBytes);
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      memory,
    },
  });

  return {
    moduleBytes,
    contract,
    compiled,
    memory,
    instance,
    workload: normalizeWorkload(workload),
  };
}

export function expectedRunloopValue(initial, budget) {
  let value = BigInt.asUintN(64, BigInt(initial));

  for (let index = 0; index < budget; index++) {
    if ((index & 1) === 0) {
      value = BigInt.asUintN(64, value + 1n);
    } else {
      value = BigInt.asUintN(64, value ^ 0x5a5an);
    }
  }
  return value;
}

export function runTciLikeRunloopModel({
  budget = 1_000_000,
  initial = 0n,
  workload = WASMJIT_WORKLOAD_TLB_HIT_RAM,
} = {}) {
  workload = normalizeWorkload(workload);

  let value = BigInt.asUintN(64, BigInt(initial));
  let state = 0;
  let generatedGuestInstructions = 0n;
  let generatedChainLength = 0n;
  let inlineTlbHitLoads = 0n;
  let inlineTlbHitStores = 0n;
  let tb0Executions = 0n;
  let tb1Executions = 0n;

  for (let remaining = budget; remaining > 0; remaining--) {
    if (state === 0) {
      value = BigInt.asUintN(64, value + 1n);
      tb0Executions++;
      state = 1;
    } else {
      value = BigInt.asUintN(64, value ^ 0x5a5an);
      tb1Executions++;
      state = 0;
    }
    generatedGuestInstructions += 4n;
    generatedChainLength++;
    if (workload === WASMJIT_WORKLOAD_TLB_HIT_RAM) {
      inlineTlbHitLoads++;
      inlineTlbHitStores++;
    }
  }

  return {
    exitReason: WASMJIT_EXIT_BUDGET,
    generatedGuestInstructions,
    generatedChainLength,
    inlineTlbHitLoads,
    inlineTlbHitStores,
    helperCalls: 0n,
    qemuLoadCalls: 0n,
    qemuStoreCalls: 0n,
    tb0Executions,
    tb1Executions,
    accumulator: value,
    ramValue: workload === WASMJIT_WORKLOAD_TLB_HIT_RAM ? value : BigInt(initial),
  };
}

export async function runWasmjitRunloopProbe({
  budget = 1_000_000,
  workload = WASMJIT_WORKLOAD_TLB_HIT_RAM,
} = {}) {
  workload = normalizeWorkload(workload);

  const {
    moduleBytes,
    contract,
    memory,
    instance,
  } = await instantiateWasmjitRunloop({ workload });
  const {
    view,
    contextPointer,
    countersPointer,
    exitPointer,
    ramPointer,
    initialRamValue,
  } = initializeWasmjitRunloopState({ memory });
  writeU64(view, contextPointer, WASMJIT_RUN_CTX.budget, BigInt(budget));

  const exitReason = instance.exports.wasmjit_run(contextPointer, budget);
  const generatedGuestInstructions =
    readU64(view, countersPointer, WASMJIT_COUNTERS.generatedGuestInstructions);
  const generatedChainLength =
    readU64(view, countersPointer, WASMJIT_COUNTERS.generatedChainLength);
  const storedExitReason =
    view.getUint32(exitPointer + WASMJIT_RUN_EXIT.reason, true);
  const exitValue = readU64(view, exitPointer, WASMJIT_RUN_EXIT.value);
  const inlineTlbHitLoads =
    readU64(view, countersPointer, WASMJIT_COUNTERS.inlineTlbHitLoads);
  const inlineTlbHitStores =
    readU64(view, countersPointer, WASMJIT_COUNTERS.inlineTlbHitStores);
  const helperCalls = readU64(view, countersPointer, WASMJIT_COUNTERS.helperCalls);
  const qemuLoadCalls = readU64(view, countersPointer, WASMJIT_COUNTERS.qemuLoadCalls);
  const qemuStoreCalls = readU64(view, countersPointer, WASMJIT_COUNTERS.qemuStoreCalls);
  const ramValue = readU64(view, ramPointer, 0);
  const expectedValue = expectedRunloopValue(initialRamValue, budget);
  const expectedRamValue = workload === WASMJIT_WORKLOAD_TLB_HIT_RAM
    ? expectedValue
    : initialRamValue;
  const expectedTlbHits = workload === WASMJIT_WORKLOAD_TLB_HIT_RAM
    ? BigInt(budget)
    : 0n;

  return {
    format: 1,
    purpose: "qemu-wasmjit-runloop-model",
    version: WASMJIT_RUNLOOP_MODEL_VERSION,
    workload,
    ok: exitReason === WASMJIT_EXIT_BUDGET &&
      storedExitReason === WASMJIT_EXIT_BUDGET &&
      generatedGuestInstructions === BigInt(budget) * 4n &&
      generatedChainLength === BigInt(budget) &&
      inlineTlbHitLoads === expectedTlbHits &&
      inlineTlbHitStores === expectedTlbHits &&
      helperCalls === 0n &&
      qemuLoadCalls === 0n &&
      qemuStoreCalls === 0n &&
      exitValue === expectedValue &&
      ramValue === expectedRamValue,
    moduleBytes: moduleBytes.length,
    imports: contract.imports,
    exports: contract.exports,
    contextPointer,
    countersPointer,
    exitPointer,
    ramPointer,
    budget,
    exitReason,
    storedExitReason,
    generatedGuestInstructions: generatedGuestInstructions.toString(),
    generatedChainLength: generatedChainLength.toString(),
    inlineTlbHitLoads: inlineTlbHitLoads.toString(),
    inlineTlbHitStores: inlineTlbHitStores.toString(),
    helperCalls: helperCalls.toString(),
    qemuLoadCalls: qemuLoadCalls.toString(),
    qemuStoreCalls: qemuStoreCalls.toString(),
    exitValue: exitValue.toString(),
    ramValue: ramValue.toString(),
    expectedValue: expectedValue.toString(),
  };
}

function best(values) {
  return values.reduce((lowest, value) => Math.min(lowest, value), Infinity);
}

export async function runWasmjitRunloopBenchmark({
  budget = 1_000_000,
  rounds = 5,
  workload = WASMJIT_WORKLOAD_TLB_HIT_RAM,
} = {}) {
  workload = normalizeWorkload(workload);

  const {
    memory,
    instance,
  } = await instantiateWasmjitRunloop({ workload });
  const wasmTimesMs = [];
  const tciLikeTimesMs = [];

  initializeWasmjitRunloopState({ memory });
  instance.exports.wasmjit_run(128, Math.min(budget, 1024));

  for (let round = 0; round < rounds; round++) {
    const {
      contextPointer,
      view,
    } = initializeWasmjitRunloopState({ memory });
    writeU64(view, contextPointer, WASMJIT_RUN_CTX.budget, BigInt(budget));
    const start = performance.now();
    instance.exports.wasmjit_run(contextPointer, budget);
    wasmTimesMs.push(performance.now() - start);
  }

  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    runTciLikeRunloopModel({ budget, workload });
    tciLikeTimesMs.push(performance.now() - start);
  }

  const wasmBestMs = best(wasmTimesMs);
  const tciLikeBestMs = best(tciLikeTimesMs);

  return {
    format: 1,
    purpose: "qemu-wasmjit-runloop-model-benchmark",
    version: WASMJIT_RUNLOOP_MODEL_VERSION,
    workload,
    budget,
    rounds,
    wasmTimesMs,
    tciLikeTimesMs,
    wasmBestMs,
    tciLikeBestMs,
    bestRatio: tciLikeBestMs / wasmBestMs,
  };
}
