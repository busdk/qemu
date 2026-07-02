#!/usr/bin/env node
/*
 * Deterministic browser-Wasm accelerator run-loop model.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const VALUE_I32 = 0x7f;
const VALUE_I64 = 0x7e;

export const WASMJIT_RUNLOOP_MODEL_VERSION = 1;
export const WASMJIT_EXIT_BUDGET = 1;

export const WASMJIT_CTX = {
  generatedGuestInstructions: 0,
  generatedChainLength: 8,
  exitReason: 16,
  ramBase: 20,
  accumulator: 24,
  tlbHitAccesses: 32,
  helperCalls: 40,
  qemuLoadCalls: 48,
  qemuStoreCalls: 56,
  tb0Executions: 64,
  tb1Executions: 72,
};

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

function i32LoadCtx(offset) {
  return [
    ...localGet(0),
    0x28, ...memArg(2, offset),
  ];
}

function i64LoadCtx(offset) {
  return [
    ...localGet(0),
    0x29, ...memArg(3, offset),
  ];
}

function i64StoreCtx(offset, valueBytes) {
  return [
    ...localGet(0),
    ...valueBytes,
    0x37, ...memArg(3, offset),
  ];
}

function i32StoreCtx(offset, valueBytes) {
  return [
    ...localGet(0),
    ...valueBytes,
    0x36, ...memArg(2, offset),
  ];
}

function i64Local(index) {
  return [VALUE_I64, index];
}

function wasmjitRunInstructions() {
  const remaining = 2;
  const state = 3;
  const generatedGuestInstructions = 4;
  const generatedChainLength = 5;
  const value = 6;
  const tlbHitAccesses = 7;
  const tb0Executions = 8;
  const tb1Executions = 9;

  return [
    ...localGet(1),
    ...localSet(remaining),
    ...i32Const(0),
    ...localSet(state),
    ...i64LoadCtx(WASMJIT_CTX.generatedGuestInstructions),
    ...localSet(generatedGuestInstructions),
    ...i64LoadCtx(WASMJIT_CTX.generatedChainLength),
    ...localSet(generatedChainLength),
    ...i64LoadCtx(WASMJIT_CTX.tlbHitAccesses),
    ...localSet(tlbHitAccesses),
    ...i64LoadCtx(WASMJIT_CTX.tb0Executions),
    ...localSet(tb0Executions),
    ...i64LoadCtx(WASMJIT_CTX.tb1Executions),
    ...localSet(tb1Executions),
    ...i32LoadCtx(WASMJIT_CTX.ramBase),
    0x29, ...memArg(3, 0), /* i64.load guest RAM */
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
    ...i32LoadCtx(WASMJIT_CTX.ramBase),
    0x29, ...memArg(3, 0), /* i64.load guest RAM */
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(value),
    ...i32LoadCtx(WASMJIT_CTX.ramBase),
    ...localGet(value),
    0x37, ...memArg(3, 0), /* i64.store guest RAM */
    ...localGet(tb0Executions),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(tb0Executions),
    ...i32Const(1),
    ...localSet(state),
    0x05,                  /* else tb1 */
    ...i32LoadCtx(WASMJIT_CTX.ramBase),
    0x29, ...memArg(3, 0), /* i64.load guest RAM */
    ...i64Const(0x5a5an),
    0x85,                  /* i64.xor */
    ...localSet(value),
    ...i32LoadCtx(WASMJIT_CTX.ramBase),
    ...localGet(value),
    0x37, ...memArg(3, 0), /* i64.store guest RAM */
    ...localGet(tb1Executions),
    ...i64Const(1n),
    0x7c,                  /* i64.add */
    ...localSet(tb1Executions),
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
    ...localGet(tlbHitAccesses),
    ...i64Const(2n),
    0x7c,                  /* i64.add */
    ...localSet(tlbHitAccesses),
    0x0c, ...encodeU32(0), /* br dispatch */
    0x0b,                  /* end loop */
    0x0b,                  /* end block */

    ...i64StoreCtx(WASMJIT_CTX.generatedGuestInstructions,
      localGet(generatedGuestInstructions)),
    ...i64StoreCtx(WASMJIT_CTX.generatedChainLength,
      localGet(generatedChainLength)),
    ...i32StoreCtx(WASMJIT_CTX.exitReason, i32Const(WASMJIT_EXIT_BUDGET)),
    ...i64StoreCtx(WASMJIT_CTX.accumulator, localGet(value)),
    ...i64StoreCtx(WASMJIT_CTX.tlbHitAccesses, localGet(tlbHitAccesses)),
    ...i64StoreCtx(WASMJIT_CTX.tb0Executions, localGet(tb0Executions)),
    ...i64StoreCtx(WASMJIT_CTX.tb1Executions, localGet(tb1Executions)),
    ...i32Const(WASMJIT_EXIT_BUDGET),
  ];
}

export function buildWasmjitRunloopModule() {
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
      functionBody(wasmjitRunInstructions(), [
        { count: 2, type: VALUE_I32 },
        { count: 6, type: VALUE_I64 },
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
  ramPointer = 512,
  initialRamValue = 0n,
} = {}) {
  const view = new DataView(memory.buffer);

  for (const offset of Object.values(WASMJIT_CTX)) {
    if (offset === WASMJIT_CTX.ramBase) {
      writeU32(view, contextPointer, offset, ramPointer);
    } else if (offset === WASMJIT_CTX.exitReason) {
      writeU32(view, contextPointer, offset, 0);
    } else {
      writeU64(view, contextPointer, offset, 0n);
    }
  }
  writeU64(view, ramPointer, 0, initialRamValue);

  return {
    view,
    contextPointer,
    ramPointer,
    initialRamValue,
  };
}

export async function instantiateWasmjitRunloop() {
  const moduleBytes = buildWasmjitRunloopModule();
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

export function runTciLikeRunloopModel({ budget = 1_000_000, initial = 0n } = {}) {
  let value = BigInt.asUintN(64, BigInt(initial));
  let state = 0;
  let generatedGuestInstructions = 0n;
  let generatedChainLength = 0n;
  let tlbHitAccesses = 0n;
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
    tlbHitAccesses += 2n;
  }

  return {
    exitReason: WASMJIT_EXIT_BUDGET,
    generatedGuestInstructions,
    generatedChainLength,
    tlbHitAccesses,
    helperCalls: 0n,
    qemuLoadCalls: 0n,
    qemuStoreCalls: 0n,
    tb0Executions,
    tb1Executions,
    accumulator: value,
    ramValue: value,
  };
}

export async function runWasmjitRunloopProbe({ budget = 1_000_000 } = {}) {
  const {
    moduleBytes,
    contract,
    memory,
    instance,
  } = await instantiateWasmjitRunloop();
  const {
    view,
    contextPointer,
    ramPointer,
    initialRamValue,
  } = initializeWasmjitRunloopState({ memory });
  const exitReason = instance.exports.wasmjit_run(contextPointer, budget);
  const generatedGuestInstructions =
    readU64(view, contextPointer, WASMJIT_CTX.generatedGuestInstructions);
  const generatedChainLength =
    readU64(view, contextPointer, WASMJIT_CTX.generatedChainLength);
  const storedExitReason =
    view.getUint32(contextPointer + WASMJIT_CTX.exitReason, true);
  const accumulator = readU64(view, contextPointer, WASMJIT_CTX.accumulator);
  const tlbHitAccesses = readU64(view, contextPointer, WASMJIT_CTX.tlbHitAccesses);
  const helperCalls = readU64(view, contextPointer, WASMJIT_CTX.helperCalls);
  const qemuLoadCalls = readU64(view, contextPointer, WASMJIT_CTX.qemuLoadCalls);
  const qemuStoreCalls = readU64(view, contextPointer, WASMJIT_CTX.qemuStoreCalls);
  const tb0Executions = readU64(view, contextPointer, WASMJIT_CTX.tb0Executions);
  const tb1Executions = readU64(view, contextPointer, WASMJIT_CTX.tb1Executions);
  const ramValue = readU64(view, ramPointer, 0);
  const expectedValue = expectedRunloopValue(initialRamValue, budget);

  return {
    format: 1,
    purpose: "qemu-wasmjit-runloop-model",
    version: WASMJIT_RUNLOOP_MODEL_VERSION,
    ok: exitReason === WASMJIT_EXIT_BUDGET &&
      storedExitReason === WASMJIT_EXIT_BUDGET &&
      generatedGuestInstructions === BigInt(budget) * 4n &&
      generatedChainLength === BigInt(budget) &&
      tlbHitAccesses === BigInt(budget) * 2n &&
      helperCalls === 0n &&
      qemuLoadCalls === 0n &&
      qemuStoreCalls === 0n &&
      tb0Executions === BigInt(Math.ceil(budget / 2)) &&
      tb1Executions === BigInt(Math.floor(budget / 2)) &&
      accumulator === expectedValue &&
      ramValue === expectedValue,
    moduleBytes: moduleBytes.length,
    imports: contract.imports,
    exports: contract.exports,
    contextPointer,
    ramPointer,
    budget,
    exitReason,
    storedExitReason,
    generatedGuestInstructions: generatedGuestInstructions.toString(),
    generatedChainLength: generatedChainLength.toString(),
    tlbHitAccesses: tlbHitAccesses.toString(),
    helperCalls: helperCalls.toString(),
    qemuLoadCalls: qemuLoadCalls.toString(),
    qemuStoreCalls: qemuStoreCalls.toString(),
    tb0Executions: tb0Executions.toString(),
    tb1Executions: tb1Executions.toString(),
    accumulator: accumulator.toString(),
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
} = {}) {
  const {
    memory,
    instance,
  } = await instantiateWasmjitRunloop();
  const wasmTimesMs = [];
  const tciLikeTimesMs = [];

  initializeWasmjitRunloopState({ memory });
  instance.exports.wasmjit_run(128, Math.min(budget, 1024));

  for (let round = 0; round < rounds; round++) {
    const {
      contextPointer,
    } = initializeWasmjitRunloopState({ memory });
    const start = performance.now();
    instance.exports.wasmjit_run(contextPointer, budget);
    wasmTimesMs.push(performance.now() - start);
  }

  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    runTciLikeRunloopModel({ budget });
    tciLikeTimesMs.push(performance.now() - start);
  }

  const wasmBestMs = best(wasmTimesMs);
  const tciLikeBestMs = best(tciLikeTimesMs);

  return {
    format: 1,
    purpose: "qemu-wasmjit-runloop-model-benchmark",
    version: WASMJIT_RUNLOOP_MODEL_VERSION,
    budget,
    rounds,
    wasmTimesMs,
    tciLikeTimesMs,
    wasmBestMs,
    tciLikeBestMs,
    bestRatio: tciLikeBestMs / wasmBestMs,
  };
}
