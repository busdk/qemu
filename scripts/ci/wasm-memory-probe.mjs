#!/usr/bin/env node
/*
 * Probe WebAssembly.Memory constructor limits for a JavaScript runtime.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const PAGE_SIZE_BYTES = 64 * 1024;
const DEFAULT_PAGES = [16384, 32768, 65536, 131072];
const IS_NODE = typeof process !== "undefined" && process.versions && process.versions.node;
const MAIN_URL = IS_NODE && process.argv[1]
  ? new URL(process.argv[1], `file://${process.cwd()}/`).href
  : null;

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-memory-probe.mjs [OPTIONS]

Options:
  --pages LIST       Comma-separated WebAssembly page counts to test
                     (default: ${DEFAULT_PAGES.join(",")})
  --memory64        Also test address: "i64" memory construction
  --help            Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    pages: DEFAULT_PAGES,
    memory64: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pages") {
      try {
        options.pages = parsePages(argv[++i]);
      } catch (error) {
        console.error(error.message);
        usage(2);
      }
    } else if (arg === "--memory64") {
      options.memory64 = true;
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  return options;
}

function parsePages(value) {
  if (typeof value !== "string") {
    throw new Error("--pages must be a comma-separated list of positive integers");
  }
  const pages = value.split(",").map((item) => Number(item.trim()));
  if (pages.length === 0 || pages.some((page) => !Number.isInteger(page) || page <= 0)) {
    throw new Error("--pages must be a comma-separated list of positive integers");
  }
  return pages;
}

function runtimeInfo() {
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    return {
      kind: "node",
      node: process.version,
      v8: process.versions.v8 || null,
      platform: process.platform,
      arch: process.arch,
    };
  }

  return {
    kind: "browser",
    userAgent: globalThis.navigator ? globalThis.navigator.userAgent : null,
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
  };
}

function memoryDescriptor(pages, shared, address) {
  const descriptor = {
    initial: address === "i64" ? BigInt(pages) : pages,
    maximum: address === "i64" ? BigInt(pages) : pages,
  };
  if (shared) {
    descriptor.shared = true;
  }
  if (address !== "default") {
    descriptor.address = address;
  }
  return descriptor;
}

function probeMemory(pages, shared, address) {
  const entry = {
    pages,
    bytes: pages * PAGE_SIZE_BYTES,
    gib: (pages * PAGE_SIZE_BYTES) / (1024 ** 3),
    shared,
    address,
    ok: false,
  };

  try {
    const memory = new WebAssembly.Memory(memoryDescriptor(pages, shared, address));
    entry.ok = true;
    entry.bufferConstructor = memory.buffer.constructor.name;
    entry.bufferByteLength = memory.buffer.byteLength;
  } catch (error) {
    entry.errorName = error && error.name ? error.name : "Error";
    entry.errorMessage = error && error.message ? error.message : String(error);
  }

  return entry;
}

function runProbe(options = {}) {
  options = {
    pages: DEFAULT_PAGES,
    memory64: false,
    ...options,
  };

  const addressModes = options.memory64 ? ["default", "i64"] : ["default"];
  const probes = [];

  for (const pages of options.pages) {
    for (const address of addressModes) {
      probes.push(probeMemory(pages, false, address));
      probes.push(probeMemory(pages, true, address));
    }
  }

  return {
    format: 1,
    pageSizeBytes: PAGE_SIZE_BYTES,
    runtime: runtimeInfo(),
    probes,
  };
}

export { PAGE_SIZE_BYTES, DEFAULT_PAGES, memoryDescriptor, parsePages, runProbe };

if (IS_NODE && import.meta.url === MAIN_URL) {
  const options = parseArgs(process.argv.slice(2));
  console.log(JSON.stringify(runProbe(options), null, 2));
} else if (!IS_NODE) {
  globalThis.qemuWasmMemoryProbe = { runProbe };
}
