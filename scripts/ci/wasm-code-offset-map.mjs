#!/usr/bin/env node
/*
 * Map a WebAssembly module byte offset to a code-section function body.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const WASM_VERSION = [0x01, 0x00, 0x00, 0x00];

function usage() {
  return `Usage: wasm-code-offset-map.mjs --wasm FILE --offset OFFSET [--json]

Options:
  --wasm FILE    WebAssembly module to inspect
  --offset N     Absolute module byte offset, decimal or 0x-prefixed hex
  --json         Print JSON only
`;
}

function parseInteger(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  const parsed = value.startsWith("0x") || value.startsWith("0X")
    ? Number.parseInt(value, 16)
    : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid ${name}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    json: false,
    offset: null,
    wasm: null,
  };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--wasm") {
      options.wasm = argv[++index];
    } else if (arg === "--offset") {
      options.offset = parseInteger(argv[++index], "offset");
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function ensureAvailable(buffer, offset, length, context) {
  if (offset + length > buffer.length) {
    throw new Error(`truncated wasm while reading ${context}`);
  }
}

function readUleb(buffer, offset, context) {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    ensureAvailable(buffer, cursor, 1, context);
    const byte = buffer[cursor++];
    result += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(result)) {
        throw new Error(`ULEB128 overflow while reading ${context}`);
      }
      return {
        value: result,
        nextOffset: cursor,
      };
    }
    shift += 7;
    if (shift > 53) {
      throw new Error(`ULEB128 too large while reading ${context}`);
    }
  }
}

function skipName(buffer, offset, end, context) {
  const length = readUleb(buffer, offset, `${context} length`);
  const nextOffset = length.nextOffset + length.value;
  if (nextOffset > end) {
    throw new Error(`truncated wasm while reading ${context}`);
  }
  return nextOffset;
}

function skipLimits(buffer, offset, end, context) {
  ensureAvailable(buffer, offset, 1, `${context} flags`);
  const flags = buffer[offset++];
  offset = readUleb(buffer, offset, `${context} minimum`).nextOffset;
  if ((flags & 0x01) !== 0) {
    offset = readUleb(buffer, offset, `${context} maximum`).nextOffset;
  }
  if (offset > end) {
    throw new Error(`truncated wasm while reading ${context}`);
  }
  return offset;
}

function skipGlobalType(buffer, offset, end, context) {
  ensureAvailable(buffer, offset, 2, context);
  offset += 2;
  if (offset > end) {
    throw new Error(`truncated wasm while reading ${context}`);
  }
  return offset;
}

function validateHeader(buffer) {
  ensureAvailable(buffer, 0, 8, "wasm header");
  for (let index = 0; index < 4; index++) {
    if (buffer[index] !== WASM_MAGIC[index]) {
      throw new Error("input is not a WebAssembly module");
    }
    if (buffer[index + 4] !== WASM_VERSION[index]) {
      throw new Error("unsupported WebAssembly binary version");
    }
  }
}

export function inspectWasmCodeOffset(buffer, moduleOffset) {
  validateHeader(buffer);

  let cursor = 8;
  let importedFunctionCount = 0;
  let declaredFunctionCount = 0;
  let codeSection = null;
  const bodies = [];

  while (cursor < buffer.length) {
    const sectionStart = cursor;
    ensureAvailable(buffer, cursor, 1, "section id");
    const id = buffer[cursor++];
    const size = readUleb(buffer, cursor, `section ${id} size`);
    cursor = size.nextOffset;
    const payloadStart = cursor;
    const payloadEnd = payloadStart + size.value;
    if (payloadEnd > buffer.length) {
      throw new Error(`truncated wasm section ${id}`);
    }

    if (id === 2) {
      let pos = payloadStart;
      const entries = readUleb(buffer, pos, "import count");
      pos = entries.nextOffset;
      for (let index = 0; index < entries.value; index++) {
        pos = skipName(buffer, pos, payloadEnd, `import ${index} module`);
        pos = skipName(buffer, pos, payloadEnd, `import ${index} name`);
        ensureAvailable(buffer, pos, 1, `import ${index} kind`);
        const kind = buffer[pos++];
        if (kind === 0x00) {
          importedFunctionCount++;
          pos = readUleb(buffer, pos, `import ${index} function type`).nextOffset;
        } else if (kind === 0x01) {
          ensureAvailable(buffer, pos, 1, `import ${index} table element type`);
          pos = skipLimits(buffer, pos + 1, payloadEnd, `import ${index} table limits`);
        } else if (kind === 0x02) {
          pos = skipLimits(buffer, pos, payloadEnd, `import ${index} limits`);
        } else if (kind === 0x03) {
          pos = skipGlobalType(buffer, pos, payloadEnd, `import ${index} global type`);
        } else if (kind === 0x04) {
          pos = readUleb(buffer, pos, `import ${index} tag attribute`).nextOffset;
          pos = readUleb(buffer, pos, `import ${index} tag type`).nextOffset;
        } else {
          throw new Error(`unsupported import kind ${kind}`);
        }
      }
      if (pos !== payloadEnd) {
        throw new Error("import section has trailing bytes");
      }
    } else if (id === 3) {
      let pos = payloadStart;
      const entries = readUleb(buffer, pos, "function count");
      pos = entries.nextOffset;
      declaredFunctionCount = entries.value;
      for (let index = 0; index < entries.value; index++) {
        pos = readUleb(buffer, pos, `function ${index} type`).nextOffset;
      }
      if (pos !== payloadEnd) {
        throw new Error("function section has trailing bytes");
      }
    } else if (id === 10) {
      codeSection = {
        payloadStart,
        payloadEnd,
        sectionStart,
      };
      let pos = payloadStart;
      const count = readUleb(buffer, pos, "code body count");
      pos = count.nextOffset;
      for (let ordinal = 0; ordinal < count.value; ordinal++) {
        const bodySize = readUleb(buffer, pos, `body ${ordinal} size`);
        const sizeOffset = pos;
        const bodyStart = bodySize.nextOffset;
        const bodyEnd = bodyStart + bodySize.value;
        if (bodyEnd > payloadEnd) {
          throw new Error(`truncated wasm code body ${ordinal}`);
        }
        bodies.push({
          bodyEnd,
          bodyOffset: moduleOffset >= bodyStart && moduleOffset < bodyEnd
            ? moduleOffset - bodyStart
            : null,
          bodySize: bodySize.value,
          bodyStart,
          definedOrdinal: ordinal,
          functionIndex: importedFunctionCount + ordinal,
          sizeOffset,
        });
        pos = bodyEnd;
      }
      if (pos !== payloadEnd) {
        throw new Error("code section has trailing bytes");
      }
    }

    cursor = payloadEnd;
  }

  if (codeSection === null) {
    throw new Error("wasm module has no code section");
  }
  if (declaredFunctionCount !== bodies.length) {
    throw new Error(
      `function/code count mismatch: function section declares ` +
      `${declaredFunctionCount}, code section has ${bodies.length}`,
    );
  }

  const matchedBody = bodies.find((body) => body.bodyOffset !== null) ?? null;
  return {
    bodyCount: bodies.length,
    codeSection,
    declaredFunctionCount,
    importedFunctionCount,
    matched: matchedBody !== null,
    moduleBytes: buffer.length,
    moduleOffset,
    result: matchedBody,
  };
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (!options.wasm || options.offset === null) {
    throw new Error("both --wasm and --offset are required");
  }
  const buffer = fs.readFileSync(options.wasm);
  const result = inspectWasmCodeOffset(buffer, options.offset);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.matched) {
    process.stdout.write(
      `offset=${result.moduleOffset} functionIndex=${result.result.functionIndex} ` +
      `definedOrdinal=${result.result.definedOrdinal} bodyOffset=${result.result.bodyOffset} ` +
      `bodySize=${result.result.bodySize}\n`,
    );
  } else {
    process.stdout.write(`offset=${result.moduleOffset} matched=false\n`);
  }
  return result.matched ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage());
    process.exitCode = 1;
  }
}
