#!/usr/bin/env node
/*
 * Deterministic generated-TB WebAssembly module shape probe.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const VALUE_I32 = 0x7f;
const VALUE_I64 = 0x7e;

export const TB_MODULE_EMITTER_MODEL_VERSION = 1;

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

function memArg(align, offset) {
  return [...encodeU32(align), ...encodeU32(offset)];
}

function packDispatchResult(status, value) {
  return (BigInt(status >>> 0) << 32n) | BigInt(value >>> 0);
}

function i64Local(index) {
  return index + 1;
}

function maxRegister(ops) {
  let max = -1;
  for (const op of ops) {
    for (const key of ["condReg", "dst", "src", "lhs", "rhs", "value"]) {
      if (Number.isInteger(op[key])) {
        max = Math.max(max, op[key]);
      }
    }
  }
  return max;
}

function packDispatchResultBytes(statusReg, valueReg) {
  return [
    ...localGet(i64Local(statusReg)),
    ...i64Const(32),
    0x86,                   /* i64.shl */
    ...localGet(i64Local(valueReg)),
    0x84,                   /* i64.or */
  ];
}

function branchDepth(labelStack, target) {
  const index = labelStack.lastIndexOf(target);
  if (index < 0) {
    throw new Error(`branch target is not an open block label: ${target}`);
  }
  return labelStack.length - 1 - index;
}

function emitLoweringOp(op, labelStack) {
  switch (op.op) {
  case "block":
    if (typeof op.label !== "string" || op.label.length === 0) {
      throw new Error("block requires a non-empty label");
    }
    if (labelStack.includes(op.label)) {
      throw new Error(`duplicate open block label: ${op.label}`);
    }
    labelStack.push(op.label);
    return [
      0x02, 0x40,            /* block */
    ];
  case "end_block":
    if (labelStack.length === 0) {
      throw new Error("end_block without block");
    }
    labelStack.pop();
    return [
      0x0b,                  /* end */
    ];
  case "brcond_i64":
    return [
      ...localGet(i64Local(op.condReg)),
      0xa7,                  /* i32.wrap_i64 */
      0x0d, ...encodeU32(branchDepth(labelStack, op.target)),
    ];
  case "const_i64":
    return [
      ...i64Const(op.value),
      ...localSet(i64Local(op.dst)),
    ];
  case "mov_i64":
    return [
      ...localGet(i64Local(op.src)),
      ...localSet(i64Local(op.dst)),
    ];
  case "ld_ctx_i64":
    return [
      ...localGet(0),
      0x29, ...memArg(3, op.offset),
      ...localSet(i64Local(op.dst)),
    ];
  case "st_ctx_i64":
    return [
      ...localGet(0),
      ...localGet(i64Local(op.src)),
      0x37, ...memArg(3, op.offset),
    ];
  case "add_i64":
    return [
      ...localGet(i64Local(op.lhs)),
      ...localGet(i64Local(op.rhs)),
      0x7c,
      ...localSet(i64Local(op.dst)),
    ];
  case "xor_i64":
    return [
      ...localGet(i64Local(op.lhs)),
      ...localGet(i64Local(op.rhs)),
      0x85,
      ...localSet(i64Local(op.dst)),
    ];
  case "setcond_i64":
    if (!["eq", "ne"].includes(op.cond)) {
      throw new Error(`unsupported setcond_i64 condition: ${op.cond}`);
    }
    return [
      ...localGet(i64Local(op.lhs)),
      ...localGet(i64Local(op.rhs)),
      op.cond === "eq" ? 0x51 : 0x52,
      0xad,
      ...localSet(i64Local(op.dst)),
    ];
  case "helper_i64":
    return [
      ...i32Const(op.opcode),
      ...localGet(i64Local(op.value)),
      0x10, ...encodeU32(0),
      ...localSet(i64Local(op.dst)),
    ];
  case "pack_dispatch_i64":
    return [
      ...packDispatchResultBytes(op.status, op.value),
      ...localSet(i64Local(op.dst)),
    ];
  case "exit_i64":
    if (op.boundary !== "tb-dispatch") {
      throw new Error("exit_i64 requires boundary tb-dispatch");
    }
    return [
      ...localGet(i64Local(op.src)),
    ];
  case "return_i64":
    return [
      ...localGet(i64Local(op.src)),
    ];
  default:
    throw new Error(`unsupported lowering op: ${op.op}`);
  }
}

export const LOWERING_SUBSET_BLOCK = [
  { op: "ld_ctx_i64", dst: 0, offset: 0 },
  { op: "ld_ctx_i64", dst: 1, offset: 8 },
  { op: "add_i64", dst: 2, lhs: 0, rhs: 1 },
  { op: "const_i64", dst: 3, value: 42n },
  { op: "setcond_i64", cond: "eq", dst: 4, lhs: 2, rhs: 3 },
  { op: "mov_i64", dst: 5, src: 2 },
  { op: "st_ctx_i64", src: 5, offset: 16 },
  { op: "st_ctx_i64", src: 4, offset: 32 },
  { op: "const_i64", dst: 6, value: 6n },
  { op: "const_i64", dst: 7, value: 42n },
  { op: "pack_dispatch_i64", dst: 8, status: 6, value: 7 },
  { op: "block", label: "helper-path" },
  { op: "brcond_i64", condReg: 4, target: "helper-path" },
  { op: "helper_i64", dst: 6, opcode: 7, value: 5 },
  { op: "mov_i64", dst: 8, src: 6 },
  { op: "end_block" },
  { op: "st_ctx_i64", src: 8, offset: 24 },
  { op: "exit_i64", boundary: "tb-dispatch", src: 8 },
];

export function buildTBModule() {
  const bytes = [
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([
      functionType([VALUE_I32, VALUE_I64], [VALUE_I64]),
      functionType([VALUE_I32], [VALUE_I64]),
    ])),
    ...section(2, vector([
      [...name("h"), ...name("helper0"), 0x00, ...encodeU32(0)],
      [...name("env"), ...name("memory"), 0x02, 0x00, ...encodeU32(1)],
    ])),
    ...section(3, vector([
      [0x01],
    ])),
    ...section(7, vector([
      [...name("start"), 0x00, ...encodeU32(1)],
    ])),
    ...section(10, vector([
      functionBody([
        ...localGet(0),
        0x29, ...memArg(3, 0),  /* i64.load ctx.reg0 */
        ...localGet(0),
        0x29, ...memArg(3, 8),  /* i64.load ctx.reg1 */
        0x7c,                   /* i64.add */
        ...localSet(1),
        ...localGet(0),
        ...localGet(1),
        0x37, ...memArg(3, 16), /* i64.store ctx.sum */
        ...i32Const(7),
        ...localGet(1),
        0x10, ...encodeU32(0),  /* call h.helper0 */
        ...localSet(2),
        ...localGet(0),
        ...localGet(2),
        0x37, ...memArg(3, 24), /* i64.store ctx.helper_result */
        ...localGet(2),
      ], [{ count: 2, type: VALUE_I64 }]),
    ])),
  ];

  return Uint8Array.from(bytes);
}

export function buildLoweringSubsetModule(ops = LOWERING_SUBSET_BLOCK) {
  const registerCount = maxRegister(ops) + 1;
  const labelStack = [];
  const instructions = ops.flatMap((op) => emitLoweringOp(op, labelStack));
  if (labelStack.length !== 0) {
    throw new Error(`unclosed block label: ${labelStack[labelStack.length - 1]}`);
  }
  const bytes = [
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([
      functionType([VALUE_I32, VALUE_I64], [VALUE_I64]),
      functionType([VALUE_I32], [VALUE_I64]),
    ])),
    ...section(2, vector([
      [...name("h"), ...name("helper0"), 0x00, ...encodeU32(0)],
      [...name("env"), ...name("memory"), 0x02, 0x00, ...encodeU32(1)],
    ])),
    ...section(3, vector([
      [0x01],
    ])),
    ...section(7, vector([
      [...name("start"), 0x00, ...encodeU32(1)],
    ])),
    ...section(10, vector([
      functionBody(instructions, registerCount > 0
        ? [{ count: registerCount, type: VALUE_I64 }]
        : []),
    ])),
  ];

  return Uint8Array.from(bytes);
}

export function validateTBModuleContract(bytes) {
  if (!WebAssembly.validate(bytes)) {
    throw new Error("generated TB module is not valid WebAssembly");
  }
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const hasMemoryImport = imports.some((entry) =>
    entry.module === "env" &&
    entry.name === "memory" &&
    entry.kind === "memory");
  const hasHelperImport = imports.some((entry) =>
    entry.module === "h" &&
    entry.name === "helper0" &&
    entry.kind === "function");
  const hasStartExport = exports.some((entry) =>
    entry.name === "start" &&
    entry.kind === "function");

  if (!hasMemoryImport) {
    throw new Error("generated TB module must import env.memory");
  }
  if (!hasHelperImport) {
    throw new Error("generated TB module must import h.helper0");
  }
  if (!hasStartExport) {
    throw new Error("generated TB module must export start(ctx)");
  }

  return {
    imports,
    exports,
  };
}

export async function runTBModuleEmitterProbe() {
  const moduleBytes = buildTBModule();
  const contract = validateTBModuleContract(moduleBytes);
  const compiled = await WebAssembly.compile(moduleBytes);
  const memory = new WebAssembly.Memory({ initial: 1 });
  const contextPointer = 64;
  const view = new DataView(memory.buffer);
  const helperCalls = [];

  view.setBigUint64(contextPointer, 19n, true);
  view.setBigUint64(contextPointer + 8, 23n, true);

  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      memory,
    },
    h: {
      helper0(opcode, value) {
        helperCalls.push({
          opcode,
          value: value.toString(),
        });
        return packDispatchResult(6, Number(value & 0xffffffffn));
      },
    },
  });

  const result = instance.exports.start(contextPointer);
  const storedSum = view.getBigUint64(contextPointer + 16, true);
  const storedHelperResult = view.getBigUint64(contextPointer + 24, true);
  const expected = packDispatchResult(6, 42);

  return {
    format: 1,
    purpose: "qemu-wasm64-tb-module-emitter",
    version: TB_MODULE_EMITTER_MODEL_VERSION,
    ok: result === expected &&
      storedSum === 42n &&
      storedHelperResult === expected &&
      helperCalls.length === 1 &&
      helperCalls[0].opcode === 7 &&
      helperCalls[0].value === "42",
    moduleBytes: moduleBytes.length,
    imports: contract.imports,
    exports: contract.exports,
    contextPointer,
    storedSum: storedSum.toString(),
    result: result.toString(),
    storedHelperResult: storedHelperResult.toString(),
    expected: expected.toString(),
    helperCalls,
  };
}

function readCtxI64(view, pointer, offset) {
  return view.getBigUint64(pointer + offset, true);
}

function writeCtxI64(view, pointer, offset, value) {
  view.setBigUint64(pointer + offset, BigInt.asUintN(64, value), true);
}

export function interpretLoweringSubset(ops, view, contextPointer, helper) {
  const regs = [];
  let result = 0n;
  const blockEnds = new Map();
  const labelToBlock = new Map();
  const stack = [];

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    if (op.op === "block") {
      stack.push({ label: op.label, index });
      labelToBlock.set(op.label, index);
    } else if (op.op === "end_block") {
      const block = stack.pop();
      if (!block) {
        throw new Error("end_block without block");
      }
      blockEnds.set(block.index, index);
    }
  }
  if (stack.length !== 0) {
    throw new Error(`unclosed block label: ${stack[stack.length - 1].label}`);
  }

  for (let pc = 0; pc < ops.length; pc++) {
    const op = ops[pc];
    switch (op.op) {
    case "block":
    case "end_block":
      break;
    case "brcond_i64": {
      const blockIndex = labelToBlock.get(op.target);
      if (blockIndex === undefined) {
        throw new Error(`branch target is not a known label: ${op.target}`);
      }
      if (regs[op.condReg] !== 0n) {
        pc = blockEnds.get(blockIndex);
      }
      break;
    }
    case "const_i64":
      regs[op.dst] = BigInt.asUintN(64, BigInt(op.value));
      break;
    case "mov_i64":
      regs[op.dst] = regs[op.src];
      break;
    case "ld_ctx_i64":
      regs[op.dst] = readCtxI64(view, contextPointer, op.offset);
      break;
    case "st_ctx_i64":
      writeCtxI64(view, contextPointer, op.offset, regs[op.src]);
      break;
    case "add_i64":
      regs[op.dst] = BigInt.asUintN(64, regs[op.lhs] + regs[op.rhs]);
      break;
    case "xor_i64":
      regs[op.dst] = BigInt.asUintN(64, regs[op.lhs] ^ regs[op.rhs]);
      break;
    case "setcond_i64":
      if (op.cond === "eq") {
        regs[op.dst] = regs[op.lhs] === regs[op.rhs] ? 1n : 0n;
      } else if (op.cond === "ne") {
        regs[op.dst] = regs[op.lhs] !== regs[op.rhs] ? 1n : 0n;
      } else {
        throw new Error(`unsupported setcond_i64 condition: ${op.cond}`);
      }
      break;
    case "helper_i64":
      regs[op.dst] = helper(op.opcode, regs[op.value]);
      break;
    case "pack_dispatch_i64":
      regs[op.dst] = BigInt.asUintN(64,
        (regs[op.status] << 32n) | (regs[op.value] & 0xffffffffn));
      break;
    case "exit_i64":
      if (op.boundary !== "tb-dispatch") {
        throw new Error("exit_i64 requires boundary tb-dispatch");
      }
      result = regs[op.src];
      pc = ops.length;
      break;
    case "return_i64":
      result = regs[op.src];
      break;
    default:
      throw new Error(`unsupported lowering op: ${op.op}`);
    }
  }

  return result;
}

export async function runLoweringSubsetProbe(ops = LOWERING_SUBSET_BLOCK) {
  const moduleBytes = buildLoweringSubsetModule(ops);
  const contract = validateTBModuleContract(moduleBytes);
  const compiled = await WebAssembly.compile(moduleBytes);
  const helper = (calls) => (opcode, value) => {
    calls.push({
      opcode,
      value: value.toString(),
    });
    return packDispatchResult(6, Number(value & 0xffffffffn));
  };
  const cases = [];

  for (const testCase of [
    { name: "branch-taken-skip-helper", reg0: 19n, reg1: 23n },
    { name: "branch-not-taken-helper", reg0: 19n, reg1: 24n },
  ]) {
    const generatedMemory = new WebAssembly.Memory({ initial: 1 });
    const interpretedMemory = new WebAssembly.Memory({ initial: 1 });
    const contextPointer = 64;
    const generatedView = new DataView(generatedMemory.buffer);
    const interpretedView = new DataView(interpretedMemory.buffer);
    const generatedHelperCalls = [];
    const interpretedHelperCalls = [];

    for (const view of [generatedView, interpretedView]) {
      view.setBigUint64(contextPointer, testCase.reg0, true);
      view.setBigUint64(contextPointer + 8, testCase.reg1, true);
    }

    const instance = await WebAssembly.instantiate(compiled, {
      env: {
        memory: generatedMemory,
      },
      h: {
        helper0: helper(generatedHelperCalls),
      },
    });

    const generatedResult = instance.exports.start(contextPointer);
    const interpretedResult = interpretLoweringSubset(
      ops,
      interpretedView,
      contextPointer,
      helper(interpretedHelperCalls),
    );
    const contextOffsets = [16, 24, 32];
    const contextMatches = contextOffsets.every((offset) =>
      readCtxI64(generatedView, contextPointer, offset) ===
      readCtxI64(interpretedView, contextPointer, offset));

    cases.push({
      name: testCase.name,
      reg0: testCase.reg0.toString(),
      reg1: testCase.reg1.toString(),
      ok: generatedResult === interpretedResult &&
        contextMatches &&
        JSON.stringify(generatedHelperCalls) === JSON.stringify(interpretedHelperCalls),
      generatedResult: generatedResult.toString(),
      interpretedResult: interpretedResult.toString(),
      generatedContext: Object.fromEntries(contextOffsets.map((offset) => [
        String(offset),
        readCtxI64(generatedView, contextPointer, offset).toString(),
      ])),
      interpretedContext: Object.fromEntries(contextOffsets.map((offset) => [
        String(offset),
        readCtxI64(interpretedView, contextPointer, offset).toString(),
      ])),
      generatedHelperCalls,
      interpretedHelperCalls,
    });
  }

  return {
    format: 1,
    purpose: "qemu-wasm64-lowering-subset",
    version: TB_MODULE_EMITTER_MODEL_VERSION,
    ok: cases.every((entry) => entry.ok),
    moduleBytes: moduleBytes.length,
    imports: contract.imports,
    exports: contract.exports,
    ops: ops.length,
    cases,
  };
}

async function run() {
  const tbProbe = await runTBModuleEmitterProbe();
  const loweringProbe = await runLoweringSubsetProbe();
  const result = {
    format: 1,
    purpose: "qemu-wasm64-tb-module-emitter",
    ok: tbProbe.ok && loweringProbe.ok,
    tbProbe,
    loweringProbe,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
