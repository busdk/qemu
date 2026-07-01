#!/usr/bin/env node
/*
 * Probe generated WebAssembly blocks outside normal QEMU guest execution.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import {
  loadPlaywrightBrowser,
  playwrightLaunchOptions,
} from "./wasm-playwright-loader.mjs";

const DEFAULT_ITERATIONS = 100000;
export const GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION = 1;

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-generated-block-prototype.mjs [OPTIONS]

Options:
  --browser NAME       Browser engine for --runtime browser|both
                       (default: chromium)
  --iterations N       Execution-loop iterations per generated function
                       (default: ${DEFAULT_ITERATIONS})
  --out FILE           Write result JSON to FILE
  --runtime MODE       node, browser, or both (default: node)
  --timeout-ms MS      Browser timeout in milliseconds (default: 30000)
  --help               Show this help

Environment:
  QEMU_WASM_BROWSER_EXECUTABLE
                       Browser executable path used for Playwright launch
  QEMU_WASM_CHROMIUM_EXECUTABLE
                       Chromium-specific executable path; overrides the
                       generic executable when --browser chromium
`);
  process.exit(status);
}

export function parseArgs(argv) {
  const options = {
    browser: "chromium",
    iterations: DEFAULT_ITERATIONS,
    out: null,
    runtime: "node",
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--browser") {
      options.browser = argv[++i];
    } else if (arg === "--iterations") {
      options.iterations = Number(argv[++i]);
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--runtime") {
      options.runtime = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (!["node", "browser", "both"].includes(options.runtime)) {
    console.error("--runtime must be node, browser, or both");
    usage(2);
  }
  if (!Number.isInteger(options.iterations) || options.iterations <= 0) {
    console.error("--iterations must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    usage(2);
  }

  return options;
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

export function encodeS32(value) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error("encodeS32 expects a signed 32-bit integer");
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
      return bytes;
    }
  }
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
  return [0x60, ...vector(params.map((param) => [param])), ...vector(results.map((result) => [result]))];
}

function localGet(index) {
  return [0x20, ...encodeU32(index)];
}

function localSet(index) {
  return [0x21, ...encodeU32(index)];
}

function localTee(index) {
  return [0x22, ...encodeU32(index)];
}

function i32Const(value) {
  return [0x41, ...encodeS32(value)];
}

function i64Const(value) {
  return [0x42, ...encodeS64(value)];
}

function memArg(align, offset) {
  return [...encodeU32(align), ...encodeU32(offset)];
}

function packExit(statusCode, valueCode) {
  return [
    ...statusCode,
    0xad,          /* i64.extend_i32_u */
    ...i64Const(32),
    0x86,          /* i64.shl */
    ...valueCode,
    0xad,          /* i64.extend_i32_u */
    0x84,          /* i64.or */
  ];
}

export function packDispatchResult(status, value) {
  return ((BigInt(status >>> 0) << 32n) | BigInt(value >>> 0)).toString();
}

export function interpretGeneratedSubset(arg0, arg1) {
  const sum = (arg0 + arg1) | 0;
  if (sum === 0) {
    return packDispatchResult(1, 100);
  }
  return packDispatchResult(2, (sum ^ 0x55) & 0xff);
}

export function interpretContextBlock(reg0, reg1) {
  const sum = BigInt.asUintN(64, BigInt(reg0) + BigInt(reg1));
  return {
    sum: sum.toString(),
    dispatch: packDispatchResult(5, Number(sum & 0xffffffffn)),
  };
}

export function createGeneratedBlockCache({ maxEntries = 4096 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("maxEntries must be a positive integer");
  }

  const entries = new Map();
  const counters = {
    hits: 0,
    misses: 0,
    stale: 0,
    evictions: 0,
  };

  return {
    get size() {
      return entries.size;
    },

    stats() {
      return { ...counters };
    },

    getOrCompile(key, signature, compile) {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error("cache key must be a non-empty string");
      }
      if (typeof signature !== "string" || signature.length === 0) {
        throw new Error("cache signature must be a non-empty string");
      }
      if (typeof compile !== "function") {
        throw new Error("cache compile callback must be a function");
      }

      const current = entries.get(key);
      if (current && current.signature === signature) {
        counters.hits++;
        return current.value;
      }

      if (current) {
        counters.stale++;
      } else {
        counters.misses++;
      }

      const value = compile();
      entries.set(key, { signature, value });

      if (entries.size > maxEntries) {
        const evictedKey = entries.keys().next().value;
        entries.delete(evictedKey);
        counters.evictions++;
      }

      return value;
    },
  };
}

function functionBody(instructions, locals = []) {
  const body = [
    ...vector(locals.map(({ count, type }) => [encodeU32(count), [type]].flat())),
    ...instructions,
    0x0b,
  ];
  return [...encodeU32(body.length), ...body];
}

export function buildGeneratedBlockModule() {
  const valueI32 = 0x7f;
  const valueI64 = 0x7e;
  const bytes = [
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([
      functionType([valueI64, valueI64], [valueI64]),
      functionType([valueI32], [valueI32]),
      functionType([valueI32], [valueI64]),
      functionType([valueI32, valueI32], [valueI64]),
      functionType([valueI32], [valueI64]),
    ])),
    ...section(2, vector([
      [...name("h"), ...name("fallback"), 0x00, ...encodeU32(3)],
      [...name("env"), ...name("memory"), 0x02, 0x00, ...encodeU32(1)],
    ])),
    ...section(3, vector([
      [0x00],
      [0x01],
      [0x02],
      [0x02],
      [0x03],
      [0x03],
      [0x04],
    ])),
    ...section(7, vector([
      [...name("add64"), 0x00, ...encodeU32(1)],
      [...name("mix32"), 0x00, ...encodeU32(2)],
      [...name("branchExit"), 0x00, ...encodeU32(3)],
      [...name("countdownExit"), 0x00, ...encodeU32(4)],
      [...name("helperGate"), 0x00, ...encodeU32(5)],
      [...name("subsetBlock"), 0x00, ...encodeU32(6)],
      [...name("contextBlock"), 0x00, ...encodeU32(7)],
    ])),
    ...section(10, vector([
      functionBody([
        ...localGet(0),
        ...localGet(1),
        0x7c, /* i64.add */
      ]),
      functionBody([
        ...localGet(0),
        ...i32Const(17),
        0x6a,                  /* i32.add */
        ...i32Const(3),
        0x74,                  /* i32.shl */
      ]),
      functionBody([
        ...localGet(0),
        0x45,                  /* i32.eqz */
        0x04, valueI64,        /* if result i64 */
          ...packExit(i32Const(1), i32Const(100)),
        0x05,                  /* else */
          ...packExit(
            i32Const(2),
            [...localGet(0), ...i32Const(17), 0x6a],
          ),
        0x0b,                  /* end */
      ]),
      functionBody([
        ...i32Const(0),
        ...localSet(1),
        0x02, valueI64,        /* block result i64 */
          0x03, 0x40,          /* loop */
            ...localGet(0),
            0x45,              /* i32.eqz */
            0x04, 0x40,        /* if */
              ...packExit(i32Const(3), localGet(1)),
              0x0c, ...encodeU32(2), /* br to outer block */
            0x0b,              /* end if */
            ...localGet(1),
            ...localGet(0),
            0x6a,              /* i32.add */
            ...localSet(1),
            ...localGet(0),
            ...i32Const(1),
            0x6b,              /* i32.sub */
            ...localSet(0),
            0x0c, ...encodeU32(0), /* br loop */
          0x0b,                /* end loop */
          ...packExit(i32Const(255), i32Const(0)),
        0x0b,                  /* end block */
      ], [{ count: 1, type: valueI32 }]),
      functionBody([
        ...localGet(0),
        ...i32Const(7),
        0x46,                  /* i32.eq */
        0x04, valueI64,        /* if result i64 */
          ...packExit(
            i32Const(4),
            [...localGet(1), ...i32Const(0x55), 0x73],
          ),
        0x05,                  /* else */
          ...localGet(0),
          ...localGet(1),
          0x10, ...encodeU32(0), /* call h.fallback */
        0x0b,                  /* end */
      ]),
      functionBody([
        ...localGet(0),
        ...localGet(1),
        0x6a,                  /* i32.add */
        ...localTee(2),
        0x45,                  /* i32.eqz */
        0x04, valueI64,        /* if result i64 */
          ...packExit(i32Const(1), i32Const(100)),
        0x05,                  /* else */
          ...packExit(
            i32Const(2),
            [
              ...localGet(2),
              ...i32Const(0x55),
              0x73,            /* i32.xor */
              ...i32Const(0xff),
              0x71,            /* i32.and */
            ],
          ),
        0x0b,                  /* end */
      ], [{ count: 1, type: valueI32 }]),
      functionBody([
        ...localGet(0),
        0x29, ...memArg(3, 0), /* i64.load ctx.regs[0] */
        ...localGet(0),
        0x29, ...memArg(3, 8), /* i64.load ctx.regs[1] */
        0x7c,                  /* i64.add */
        ...localSet(1),
        ...localGet(0),
        ...localGet(1),
        0x37, ...memArg(3, 16), /* i64.store ctx.ret */
        ...packExit(
          i32Const(5),
          [
            ...localGet(1),
            0xa7,              /* i32.wrap_i64 */
          ],
        ),
      ], [{ count: 1, type: valueI64 }]),
    ])),
  ];

  return Uint8Array.from(bytes);
}

export function validatePrototypeResult(result) {
  if (result.format !== 1) {
    throw new Error("unexpected generated-block prototype format");
  }
  for (const runtime of result.runtimes || []) {
    if (!runtime.ok) {
      throw new Error(`${runtime.runtime} generated-block prototype failed`);
    }
    if (runtime.add64 !== "42") {
      throw new Error(`${runtime.runtime} add64 result mismatch`);
    }
    if (runtime.mix32 !== 472) {
      throw new Error(`${runtime.runtime} mix32 result mismatch`);
    }
    if (runtime.branchExitZero !== "4294967396") {
      throw new Error(`${runtime.runtime} branchExit zero result mismatch`);
    }
    if (runtime.branchExitNonzero !== "8589934626") {
      throw new Error(`${runtime.runtime} branchExit nonzero result mismatch`);
    }
    if (runtime.countdownExit !== "12884901898") {
      throw new Error(`${runtime.runtime} countdownExit result mismatch`);
    }
    if (runtime.helperGateFast !== "17179869198") {
      throw new Error(`${runtime.runtime} helperGate fast result mismatch`);
    }
    if (runtime.helperGateFallback !== "425201762319") {
      throw new Error(`${runtime.runtime} helperGate fallback result mismatch`);
    }
    if (runtime.helperFallbacks !== 1) {
      throw new Error(`${runtime.runtime} helper fallback count mismatch`);
    }
    if (runtime.subsetDifferentialMismatches !== 0) {
      throw new Error(`${runtime.runtime} subset differential mismatch`);
    }
    if (runtime.contextBlockResult !== "21474836522") {
      throw new Error(`${runtime.runtime} contextBlock result mismatch`);
    }
    if (runtime.contextBlockStored !== "42") {
      throw new Error(`${runtime.runtime} contextBlock stored value mismatch`);
    }
    if (!Array.isArray(runtime.subsetDifferentialCases) ||
        runtime.subsetDifferentialCases.length < 5) {
      throw new Error(`${runtime.runtime} subset differential coverage missing`);
    }
    if (!Number.isFinite(runtime.compileMs) || runtime.compileMs < 0) {
      throw new Error(`${runtime.runtime} compileMs must be non-negative`);
    }
    if (!Number.isFinite(runtime.executeMs) || runtime.executeMs < 0) {
      throw new Error(`${runtime.runtime} executeMs must be non-negative`);
    }
  }
  return true;
}

export function validateGeneratedBlockControlFlow(block) {
  if (!block || block.version !== GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION) {
    throw new Error("unexpected generated-block control-flow model version");
  }
  if (!Array.isArray(block.ops) || block.ops.length === 0) {
    throw new Error("control-flow block must contain operations");
  }

  const labels = new Map();
  for (let index = 0; index < block.ops.length; index++) {
    const op = block.ops[index];
    if (op.kind === "label") {
      if (!op.name) {
        throw new Error("label operation requires a name");
      }
      if (labels.has(op.name)) {
        throw new Error(`duplicate generated-block label: ${op.name}`);
      }
      labels.set(op.name, index);
    }
  }

  let hasTerminal = false;
  for (const op of block.ops) {
    if (op.kind === "br" || op.kind === "brcond") {
      if (!op.target || !labels.has(op.target)) {
        throw new Error(`branch target is not a known label: ${op.target}`);
      }
    } else if (op.kind === "exit") {
      if (op.boundary !== "tb-dispatch") {
        throw new Error("generated blocks may exit only through TB dispatch");
      }
      hasTerminal = true;
    } else if (op.kind === "helper") {
      if (op.fallback !== "tci") {
        throw new Error("helper calls require explicit TCI fallback");
      }
      hasTerminal = true;
    } else if (op.kind === "return-internal-pointer") {
      throw new Error("internal TCI pointers are not generated-block exits");
    } else if (op.kind !== "label" && op.kind !== "op") {
      throw new Error(`unsupported generated-block operation: ${op.kind}`);
    }
  }

  const last = block.ops[block.ops.length - 1];
  if (!hasTerminal || (last.kind !== "exit" && last.kind !== "helper" &&
                       last.kind !== "br")) {
    throw new Error("control-flow block must end at dispatch or TCI fallback");
  }

  return {
    version: block.version,
    labels: labels.size,
    ops: block.ops.length,
    terminal: last.kind,
  };
}

export async function runGeneratedBlockProbe(iterations, now = performance.now.bind(performance)) {
  const moduleBytes = buildGeneratedBlockModule();
  const compileStart = now();
  const compiled = await WebAssembly.compile(moduleBytes);
  const compileMs = now() - compileStart;
  const instantiateStart = now();
  let helperFallbacks = 0;
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = await WebAssembly.instantiate(compiled, {
    h: {
      fallback(opcode, value) {
        helperFallbacks++;
        return (99n << 32n) | BigInt((opcode ^ value) >>> 0);
      },
    },
    env: {
      memory,
    },
  });
  const instantiateMs = now() - instantiateStart;
  const {
    add64,
    mix32,
    branchExit,
    countdownExit: runCountdownExit,
    helperGate,
    subsetBlock,
    contextBlock,
  } = instance.exports;
  const add64Result = add64(19n, 23n);
  const mix32Result = mix32(42);
  const branchExitZero = branchExit(0);
  const branchExitNonzero = branchExit(17);
  const countdownExitResult = runCountdownExit(4);
  const helperGateFast = helperGate(7, 91);
  const helperGateFallback = helperGate(5, 10);
  const subsetInputs = [
    [1, 2],
    [-1, 1],
    [255, 1],
    [1234, 5678],
    [0x7fffffff, 1],
  ];
  const subsetDifferentialCases = subsetInputs.map(([arg0, arg1]) => {
    const generated = subsetBlock(arg0, arg1).toString();
    const expected = interpretGeneratedSubset(arg0, arg1);
    return {
      arg0,
      arg1,
      generated,
      expected,
      ok: generated === expected,
    };
  });
  const subsetDifferentialMismatches =
    subsetDifferentialCases.filter((entry) => !entry.ok).length;
  const contextPointer = 64;
  const contextView = new DataView(memory.buffer);
  const contextExpected = interpretContextBlock(19n, 23n);
  contextView.setBigUint64(contextPointer, 19n, true);
  contextView.setBigUint64(contextPointer + 8, 23n, true);
  const contextBlockResult = contextBlock(contextPointer).toString();
  const contextBlockStored =
    contextView.getBigUint64(contextPointer + 16, true).toString();
  let accumulator = 0;
  const executeStart = now();
  for (let i = 0; i < iterations; i++) {
    accumulator = mix32(accumulator & 0xffff);
  }
  const executeMs = now() - executeStart;

  return {
    ok: add64Result === 42n &&
      mix32Result === 472 &&
      branchExitZero === 4294967396n &&
      branchExitNonzero === 8589934626n &&
      countdownExitResult === 12884901898n &&
      helperGateFast === 17179869198n &&
      helperGateFallback === 425201762319n &&
      helperFallbacks === 1 &&
      subsetDifferentialMismatches === 0 &&
      contextBlockResult === contextExpected.dispatch &&
      contextBlockStored === contextExpected.sum,
    moduleBytes: moduleBytes.length,
    validate: WebAssembly.validate(moduleBytes),
    compileMs,
    instantiateMs,
    executeMs,
    iterations,
    add64: add64Result.toString(),
    mix32: mix32Result,
    branchExitZero: branchExitZero.toString(),
    branchExitNonzero: branchExitNonzero.toString(),
    countdownExit: countdownExitResult.toString(),
    helperGateFast: helperGateFast.toString(),
    helperGateFallback: helperGateFallback.toString(),
    helperFallbacks,
    subsetDifferentialCases,
    subsetDifferentialMismatches,
    contextBlockResult,
    contextBlockStored,
    accumulator,
  };
}

async function runNode(iterations) {
  return {
    runtime: "node",
    nodeVersion: process.version,
    ...(await runGeneratedBlockProbe(iterations)),
  };
}

async function runBrowser(options) {
  const browserType = await loadPlaywrightBrowser(options.browser);
  const browser = await browserType.launch(playwrightLaunchOptions(options.browser));
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    const result = await page.evaluate(
      async ({ source, iterations }) => {
        const module = {};
        const exports = {};
        const fn = new Function("module", "exports", source);
        fn(module, exports);
        return exports.runGeneratedBlockProbe(iterations, performance.now.bind(performance));
      },
      {
        source: [
          encodeU32,
          encodeS32,
          encodeS64,
          utf8Bytes,
          section,
          vector,
          name,
          functionType,
          localGet,
          localSet,
          localTee,
          i32Const,
          i64Const,
          memArg,
          packExit,
          packDispatchResult,
          interpretGeneratedSubset,
          interpretContextBlock,
          functionBody,
          buildGeneratedBlockModule,
          runGeneratedBlockProbe,
          "exports.runGeneratedBlockProbe = runGeneratedBlockProbe;",
        ].map((fn) => fn.toString()).join("\n"),
        iterations: options.iterations,
      },
    );
    return {
      runtime: "browser",
      browser: options.browser,
      browserVersion: browser.version(),
      ...result,
    };
  } finally {
    await browser.close();
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const runtimes = [];

  if (options.runtime === "node" || options.runtime === "both") {
    runtimes.push(await runNode(options.iterations));
  }
  if (options.runtime === "browser" || options.runtime === "both") {
    runtimes.push(await runBrowser(options));
  }

  const result = {
    format: 1,
    purpose: "qemu-generated-wasm-block-prototype",
    iterations: options.iterations,
    runtimes,
  };
  result.ok = runtimes.every((runtime) => runtime.ok);
  validatePrototypeResult(result);

  const output = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(output);
  if (options.out !== null) {
    await writeFile(options.out, output);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
