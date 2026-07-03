#!/usr/bin/env node
/*
 * Deterministic equivalence tests for trace-shaped generated TCI output.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  encodeS32,
  encodeS64,
  encodeU32,
} from "./wasm-generated-block-prototype.mjs";

const VALUE_I32 = 0x7f;
const VALUE_I64 = 0x7e;

const OPS = {
  call: 2,
  brcond: 4,
  add: 7,
  and: 8,
  deposit: 16,
  extract: 22,
  ld32u: 28,
  ld32s: 29,
  ld: 30,
  neg: 38,
  sextract: 50,
  shl: 51,
  shr: 52,
  setcond: 49,
  st8: 53,
  st32: 55,
  st: 56,
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

const STATUS_EXIT = 1n;
const STATUS_DISPATCH = 2n;

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

function i64Truthy(expr) {
  return [...expr, 0x50, 0x45];
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

function memoryAddress(regExpr, ofs) {
  return i32WrapI64([...regExpr, ...i64Const(ofs), 0x7c]);
}

function targetIndexFromPtr(ptr, relativeBase) {
  const offset = ptr - relativeBase;

  if (offset < 0 || offset % 4 !== 0) {
    return -1;
  }
  return offset / 4;
}

function compileGeneratedOutputModule(words, relativeBase) {
  const instructions = [];
  const ops = [];
  let terminal = null;

  instructions.push(...localSet(1, i32WrapI64(i64Load(localGet(0), 0))));
  instructions.push(...localSet(2, i32WrapI64(i64Load(localGet(0), 8))));
  for (let reg = 0; reg < 16; reg++) {
    instructions.push(...localSet(regLocal(reg), i64Load(localGet(1), reg * 8)));
  }

  for (let index = 0; index < words.length; index++) {
    const insn = words[index] >>> 0;
    const opc = bits(insn, 0, 8);
    const r0 = bits(insn, 8, 4);
    const r1 = bits(insn, 12, 4);
    const r2 = bits(insn, 16, 4);
    const tbPtr = relativeBase + (index + 1) * 4;

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

  function compileOp(op) {
    const { insn, opc, r0, r1, r2 } = op;

    if (opc === OPS.tci_movi) {
      return localSet(regLocal(r0), i64Const(sextract(insn, 12, 20)));
    }
    if (opc === OPS.tci_movl) {
      const ptr = op.tbPtr + sextract(insn, 12, 20);
      return localSet(regLocal(r0), i64Load(i32Const(ptr), 0));
    }
    if (opc === OPS.ld32u || opc === OPS.ld32s) {
      const ofs = sextract(insn, 16, 16);

      const loaded = i32Load(memoryAddress(localGet(regLocal(r1)), ofs));

      return localSet(regLocal(r0),
                      opc === OPS.ld32u ? i64ExtendI32U(loaded)
                                        : i64ExtendI32S(loaded));
    }
    if (opc === OPS.ld) {
      const ofs = sextract(insn, 16, 16);

      return localSet(regLocal(r0),
                      i64Load(memoryAddress(localGet(regLocal(r1)), ofs)));
    }
    if (opc === OPS.st8) {
      const ofs = sextract(insn, 16, 16);

      return i32Store8(memoryAddress(localGet(regLocal(r1)), ofs),
                       i32WrapI64(localGet(regLocal(r0))));
    }
    if (opc === OPS.st32) {
      const ofs = sextract(insn, 16, 16);

      return i32Store(memoryAddress(localGet(regLocal(r1)), ofs),
                      i32WrapI64(localGet(regLocal(r0))));
    }
    if (opc === OPS.st) {
      const ofs = sextract(insn, 16, 16);

      return i64Store(memoryAddress(localGet(regLocal(r1)), ofs),
                      localGet(regLocal(r0)));
    }
    if (opc === OPS.add || opc === OPS.and) {
      return localSet(regLocal(r0), [
        ...localGet(regLocal(r1)),
        ...localGet(regLocal(r2)),
        opc === OPS.add ? 0x7c : 0x83,
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
      return localSet(regLocal(r0), callFunc(0, [
        localGet(regLocal(14)),
        localGet(regLocal(r1)),
        localGet(regLocal(r2)),
        i64Const(op.tbPtr),
      ]));
    }
    if (opc === OPS.tci_qemu_st_rrr) {
      return callFunc(1, [
        localGet(regLocal(14)),
        localGet(regLocal(r1)),
        localGet(regLocal(r0)),
        localGet(regLocal(r2)),
        i64Const(op.tbPtr),
      ]);
    }
    return null;
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

        if (targetIndex <= index || targetIndex > end) {
          return null;
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
      const compiled = compileOp(op);

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
  instructions.push(...body);
  for (let reg = 0; reg < 16; reg++) {
    instructions.push(...i64Store(localGet(1), localGet(regLocal(reg)), reg * 8));
  }
  instructions.push(...i64Store(
    localGet(2),
    terminal.kind === "goto_tb" ? i64Load(i32Const(terminal.ret), 0)
                                : i64Const(terminal.ret),
    0,
  ));
  instructions.push(...i64Const(terminal.status));

  return Uint8Array.from([
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
    ...section(7, vector([[...name("run"), 0x00, ...encodeU32(2)]])),
    ...section(10, vector([functionBody(
      instructions,
      [{ count: 2, type: VALUE_I32 }, { count: 16, type: VALUE_I64 }],
    )])),
  ]);
}

function interpretGeneratedOutput(words, state, relativeBase) {
  const regs = state.regs.slice();
  const view = state.view;
  let index = 0;
  let executed = 0;
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
      index++;
    } else if (opc === OPS.ld32s) {
      const ofs = sextract(insn, 16, 16);
      regs[r0] = toU64(BigInt(view.getInt32(Number(regs[r1]) + ofs, true)));
      index++;
    } else if (opc === OPS.ld) {
      const ofs = sextract(insn, 16, 16);
      regs[r0] = view.getBigUint64(Number(regs[r1]) + ofs, true);
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
      regs[r0] = compare32(regs[r1], regs[r2], condition);
      index++;
    } else if (opc === OPS.tci_qemu_ld_rrr) {
      const taddr = regs[r1];
      const oi = regs[r2];
      regs[r0] = state.helpers.qemuLd(regs[14], taddr, oi, BigInt(tbPtr));
      index++;
    } else if (opc === OPS.tci_qemu_st_rrr) {
      const taddr = regs[r1];
      const oi = regs[r2];
      state.helpers.qemuSt(regs[14], taddr, regs[r0], oi, BigInt(tbPtr));
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
    } else if (opc === OPS.exit_tb) {
      const ptr = BigInt(tbPtr + sextract(insn, 12, 20));
      return { status: STATUS_EXIT, ret: ptr, regs, executed, memoryWrites };
    } else if (opc === OPS.goto_tb) {
      const ptr = tbPtr + sextract(insn, 12, 20);
      return {
        status: STATUS_DISPATCH,
        ret: view.getBigUint64(ptr, true),
        regs,
        executed,
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
  const dataBase = 0x3000 + seed * 0x100;
  const regs = Array.from({ length: 16 }, (_, index) =>
    BigInt(0x1000 + seed * 0x40 + index));

  regs[4] = 0n;
  regs[5] = 0n;
  regs[13] = 0n;
  regs[14] = BigInt(dataBase + 16);
  view.setBigUint64(ctxPtr, BigInt(regsPtr), true);
  view.setBigUint64(ctxPtr + 8, BigInt(retPtr), true);
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
    dataBase,
    regs,
    helpers: createHelpers(view),
  };
}

function captureState(view, regsPtr, retPtr, dataBase, helpers) {
  return {
    regs: Array.from({ length: 16 }, (_, reg) =>
      view.getBigUint64(regsPtr + reg * 8, true).toString()),
    ret: view.getBigUint64(retPtr, true).toString(),
    data: [
      view.getUint32(dataBase, true),
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

async function runFixture(fixture, seed) {
  const relativeBase = fixture.relativeBase;
  const reference = createState(relativeBase, fixture.words, seed);
  const expected = interpretGeneratedOutput(fixture.words, reference, relativeBase);
  const generated = createState(relativeBase, fixture.words, seed);
  const moduleBytes = compileGeneratedOutputModule(fixture.words, relativeBase);
  const compiled = await WebAssembly.compile(moduleBytes);
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
  reference.view.setBigUint64(reference.retPtr, expected.ret, true);
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
    generatedTciOpEquivalents: expected.executed,
    memoryWrites: expected.memoryWrites,
    helpers: generatedState.helpers,
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
    name: "qemu-ld-st-helper-boundary",
    terminal: "exit_tb",
    relativeBase: 0x5400,
    words: [
      OPS.tci_qemu_ld_rrr | (3 << 8) | (14 << 12) | (13 << 16),
      OPS.add | (3 << 8) | (3 << 12) | (5 << 16),
      OPS.tci_qemu_st_rrr | (3 << 8) | (14 << 12) | (13 << 16),
      OPS.exit_tb,
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
];

const liveX86Fixture = fixtures.find((fixture) =>
  fixture.name === "live-x86-pre-r4i-ld32u-goto-tb-13");
assert.deepEqual(
  decodedShape(liveX86Fixture.words),
  PRE_R4I_LIVE_X86_SHAPE,
  "pre-R4i live x86 fixture shape drifted",
);

const unsupportedFixtures = [
  {
    name: "qemu-helper-mixed-unsupported-fallback",
    relativeBase: 0x5800,
    words: [
      OPS.tci_qemu_ld_rrr | (3 << 8) | (14 << 12) | (13 << 16),
      OPS.call,
      OPS.exit_tb,
    ],
  },
];

const results = [];
const unsupportedResults = [];

for (const fixture of fixtures) {
  for (const seed of [1, 2]) {
    results.push(await runFixture(fixture, seed));
  }
}

for (const fixture of unsupportedFixtures) {
  assert.throws(
    () => compileGeneratedOutputModule(fixture.words, fixture.relativeBase),
    /unsupported generated-output shape/,
    `${fixture.name} should fail closed`,
  );
  unsupportedResults.push(fixture.name);
}

assert.equal(results.length, 12);
assert.equal(results.filter((entry) => entry.terminal === "goto_tb").length, 4);
assert.equal(results.filter((entry) => entry.terminal === "exit_tb").length, 8);
const helperBoundaryResults = results.filter((entry) =>
  entry.helpers.loads > 0 || entry.helpers.stores > 0);
const simpleGapResults = results.filter((entry) =>
  entry.name === "simple-gap-ops-validate");
const liveX86Results = results.filter((entry) =>
  entry.name === "live-x86-pre-r4i-ld32u-goto-tb-13");
assert.equal(liveX86Results.length, 2);
assert.equal(
  liveX86Results.filter((entry) =>
    entry.generatedTciOpEquivalents === 11 &&
    entry.memoryWrites === 2 &&
    entry.terminal === "goto_tb").length,
  2,
);
console.log(JSON.stringify({
  format: 1,
  event: "generated-output-equivalence",
  fixtures: results.length,
  unsupportedFixtures: unsupportedResults.length,
  liveX86PreR4iFixtures: liveX86Results.length,
  liveX86PreR4iShape: PRE_R4I_LIVE_X86_SHAPE,
  liveX86PreR4iGeneratedTciOpEquivalents:
    liveX86Results.reduce((count, entry) =>
      count + entry.generatedTciOpEquivalents, 0),
  liveX86PreR4iMemoryWrites:
    liveX86Results.reduce((count, entry) => count + entry.memoryWrites, 0),
  helperBoundaryFixtures: helperBoundaryResults.length,
  simpleGapFixtures: simpleGapResults.length,
  helperCalls: {
    loads: helperBoundaryResults.reduce((count, entry) =>
      count + entry.helpers.loads, 0),
    stores: helperBoundaryResults.reduce((count, entry) =>
      count + entry.helpers.stores, 0),
  },
  terminals: {
    goto_tb: results.filter((entry) => entry.terminal === "goto_tb").length,
    exit_tb: results.filter((entry) => entry.terminal === "exit_tb").length,
  },
}, null, 2));
