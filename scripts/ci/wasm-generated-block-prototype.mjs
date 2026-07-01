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

function functionBody(instructions) {
  const body = [0x00, ...instructions, 0x0b];
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
    ])),
    ...section(3, vector([
      [0x00],
      [0x01],
    ])),
    ...section(7, vector([
      [...name("add64"), 0x00, ...encodeU32(0)],
      [...name("mix32"), 0x00, ...encodeU32(1)],
    ])),
    ...section(10, vector([
      functionBody([
        ...localGet(0),
        ...localGet(1),
        0x7c, /* i64.add */
      ]),
      functionBody([
        ...localGet(0),
        0x41, ...encodeU32(17), /* i32.const 17 */
        0x6a,                  /* i32.add */
        0x41, ...encodeU32(3),  /* i32.const 3 */
        0x74,                  /* i32.shl */
      ]),
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
    if (!Number.isFinite(runtime.compileMs) || runtime.compileMs < 0) {
      throw new Error(`${runtime.runtime} compileMs must be non-negative`);
    }
    if (!Number.isFinite(runtime.executeMs) || runtime.executeMs < 0) {
      throw new Error(`${runtime.runtime} executeMs must be non-negative`);
    }
  }
  return true;
}

export async function runGeneratedBlockProbe(iterations, now = performance.now.bind(performance)) {
  const moduleBytes = buildGeneratedBlockModule();
  const compileStart = now();
  const compiled = await WebAssembly.compile(moduleBytes);
  const compileMs = now() - compileStart;
  const instantiateStart = now();
  const instance = await WebAssembly.instantiate(compiled, {});
  const instantiateMs = now() - instantiateStart;
  const { add64, mix32 } = instance.exports;
  const add64Result = add64(19n, 23n);
  const mix32Result = mix32(42);
  let accumulator = 0;
  const executeStart = now();
  for (let i = 0; i < iterations; i++) {
    accumulator = mix32(accumulator & 0xffff);
  }
  const executeMs = now() - executeStart;

  return {
    ok: add64Result === 42n && mix32Result === 472,
    moduleBytes: moduleBytes.length,
    validate: WebAssembly.validate(moduleBytes),
    compileMs,
    instantiateMs,
    executeMs,
    iterations,
    add64: add64Result.toString(),
    mix32: mix32Result,
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
          utf8Bytes,
          section,
          vector,
          name,
          functionType,
          localGet,
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
