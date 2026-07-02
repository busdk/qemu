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

function memArg(align, offset) {
  return [...encodeU32(align), ...encodeU32(offset)];
}

function packDispatchResult(status, value) {
  return (BigInt(status >>> 0) << 32n) | BigInt(value >>> 0);
}

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

async function run() {
  const result = await runTBModuleEmitterProbe();
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
