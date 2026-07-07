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

When the offset falls inside a code-section function body, the result also
decodes the instruction at that exact offset and reports whether it is a
plain (never traps on misalignment) or atomic (traps as "operation does not
support unaligned accesses" when misaligned) memory access, matching the
V8 diagnosis workflow used for the R4z load-dependent OOB investigation.
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

const ATOMIC_PREFIX_OPCODE = 0xfe;
const ATOMIC_FENCE_SUBOPCODE = 0x03;

// Plain (non-atomic) numeric memory instructions never trap on misaligned
// addresses; the align immediate is only a performance hint. Table per the
// WebAssembly core spec binary encoding (bytecode.ch/binary/instructions).
const PLAIN_MEMORY_OPS = {
  0x28: { mnemonic: "i32.load", naturalAlign: 2 },
  0x29: { mnemonic: "i64.load", naturalAlign: 3 },
  0x2a: { mnemonic: "f32.load", naturalAlign: 2 },
  0x2b: { mnemonic: "f64.load", naturalAlign: 3 },
  0x2c: { mnemonic: "i32.load8_s", naturalAlign: 0 },
  0x2d: { mnemonic: "i32.load8_u", naturalAlign: 0 },
  0x2e: { mnemonic: "i32.load16_s", naturalAlign: 1 },
  0x2f: { mnemonic: "i32.load16_u", naturalAlign: 1 },
  0x30: { mnemonic: "i64.load8_s", naturalAlign: 0 },
  0x31: { mnemonic: "i64.load8_u", naturalAlign: 0 },
  0x32: { mnemonic: "i64.load16_s", naturalAlign: 1 },
  0x33: { mnemonic: "i64.load16_u", naturalAlign: 1 },
  0x34: { mnemonic: "i64.load32_s", naturalAlign: 2 },
  0x35: { mnemonic: "i64.load32_u", naturalAlign: 2 },
  0x36: { mnemonic: "i32.store", naturalAlign: 2 },
  0x37: { mnemonic: "i64.store", naturalAlign: 3 },
  0x38: { mnemonic: "f32.store", naturalAlign: 2 },
  0x39: { mnemonic: "f64.store", naturalAlign: 3 },
  0x3a: { mnemonic: "i32.store8", naturalAlign: 0 },
  0x3b: { mnemonic: "i32.store16", naturalAlign: 1 },
  0x3c: { mnemonic: "i64.store8", naturalAlign: 0 },
  0x3d: { mnemonic: "i64.store16", naturalAlign: 1 },
  0x3e: { mnemonic: "i64.store32", naturalAlign: 2 },
};

// Atomic memory instructions (0xFE prefix) require natural alignment and
// raise the V8 "operation does not support unaligned accesses" trap
// otherwise. Table per the threads/atomics proposal binary encoding.
const ATOMIC_MEMORY_OPS = {
  0x00: { mnemonic: "memory.atomic.notify", naturalAlign: 2 },
  0x01: { mnemonic: "memory.atomic.wait32", naturalAlign: 2 },
  0x02: { mnemonic: "memory.atomic.wait64", naturalAlign: 3 },
  0x10: { mnemonic: "i32.atomic.load", naturalAlign: 2 },
  0x11: { mnemonic: "i64.atomic.load", naturalAlign: 3 },
  0x12: { mnemonic: "i32.atomic.load8_u", naturalAlign: 0 },
  0x13: { mnemonic: "i32.atomic.load16_u", naturalAlign: 1 },
  0x14: { mnemonic: "i64.atomic.load8_u", naturalAlign: 0 },
  0x15: { mnemonic: "i64.atomic.load16_u", naturalAlign: 1 },
  0x16: { mnemonic: "i64.atomic.load32_u", naturalAlign: 2 },
  0x17: { mnemonic: "i32.atomic.store", naturalAlign: 2 },
  0x18: { mnemonic: "i64.atomic.store", naturalAlign: 3 },
  0x19: { mnemonic: "i32.atomic.store8", naturalAlign: 0 },
  0x1a: { mnemonic: "i32.atomic.store16", naturalAlign: 1 },
  0x1b: { mnemonic: "i64.atomic.store8", naturalAlign: 0 },
  0x1c: { mnemonic: "i64.atomic.store16", naturalAlign: 1 },
  0x1d: { mnemonic: "i64.atomic.store32", naturalAlign: 2 },
  0x1e: { mnemonic: "i32.atomic.rmw.add", naturalAlign: 2 },
  0x1f: { mnemonic: "i64.atomic.rmw.add", naturalAlign: 3 },
  0x20: { mnemonic: "i32.atomic.rmw8.add_u", naturalAlign: 0 },
  0x21: { mnemonic: "i32.atomic.rmw16.add_u", naturalAlign: 1 },
  0x22: { mnemonic: "i64.atomic.rmw8.add_u", naturalAlign: 0 },
  0x23: { mnemonic: "i64.atomic.rmw16.add_u", naturalAlign: 1 },
  0x24: { mnemonic: "i64.atomic.rmw32.add_u", naturalAlign: 2 },
  0x25: { mnemonic: "i32.atomic.rmw.sub", naturalAlign: 2 },
  0x26: { mnemonic: "i64.atomic.rmw.sub", naturalAlign: 3 },
  0x27: { mnemonic: "i32.atomic.rmw8.sub_u", naturalAlign: 0 },
  0x28: { mnemonic: "i32.atomic.rmw16.sub_u", naturalAlign: 1 },
  0x29: { mnemonic: "i64.atomic.rmw8.sub_u", naturalAlign: 0 },
  0x2a: { mnemonic: "i64.atomic.rmw16.sub_u", naturalAlign: 1 },
  0x2b: { mnemonic: "i64.atomic.rmw32.sub_u", naturalAlign: 2 },
  0x2c: { mnemonic: "i32.atomic.rmw.and", naturalAlign: 2 },
  0x2d: { mnemonic: "i64.atomic.rmw.and", naturalAlign: 3 },
  0x2e: { mnemonic: "i32.atomic.rmw8.and_u", naturalAlign: 0 },
  0x2f: { mnemonic: "i32.atomic.rmw16.and_u", naturalAlign: 1 },
  0x30: { mnemonic: "i64.atomic.rmw8.and_u", naturalAlign: 0 },
  0x31: { mnemonic: "i64.atomic.rmw16.and_u", naturalAlign: 1 },
  0x32: { mnemonic: "i64.atomic.rmw32.and_u", naturalAlign: 2 },
  0x33: { mnemonic: "i32.atomic.rmw.or", naturalAlign: 2 },
  0x34: { mnemonic: "i64.atomic.rmw.or", naturalAlign: 3 },
  0x35: { mnemonic: "i32.atomic.rmw8.or_u", naturalAlign: 0 },
  0x36: { mnemonic: "i32.atomic.rmw16.or_u", naturalAlign: 1 },
  0x37: { mnemonic: "i64.atomic.rmw8.or_u", naturalAlign: 0 },
  0x38: { mnemonic: "i64.atomic.rmw16.or_u", naturalAlign: 1 },
  0x39: { mnemonic: "i64.atomic.rmw32.or_u", naturalAlign: 2 },
  0x3a: { mnemonic: "i32.atomic.rmw.xor", naturalAlign: 2 },
  0x3b: { mnemonic: "i64.atomic.rmw.xor", naturalAlign: 3 },
  0x3c: { mnemonic: "i32.atomic.rmw8.xor_u", naturalAlign: 0 },
  0x3d: { mnemonic: "i32.atomic.rmw16.xor_u", naturalAlign: 1 },
  0x3e: { mnemonic: "i64.atomic.rmw8.xor_u", naturalAlign: 0 },
  0x3f: { mnemonic: "i64.atomic.rmw16.xor_u", naturalAlign: 1 },
  0x40: { mnemonic: "i64.atomic.rmw32.xor_u", naturalAlign: 2 },
  0x41: { mnemonic: "i32.atomic.rmw.xchg", naturalAlign: 2 },
  0x42: { mnemonic: "i64.atomic.rmw.xchg", naturalAlign: 3 },
  0x43: { mnemonic: "i32.atomic.rmw8.xchg_u", naturalAlign: 0 },
  0x44: { mnemonic: "i32.atomic.rmw16.xchg_u", naturalAlign: 1 },
  0x45: { mnemonic: "i64.atomic.rmw8.xchg_u", naturalAlign: 0 },
  0x46: { mnemonic: "i64.atomic.rmw16.xchg_u", naturalAlign: 1 },
  0x47: { mnemonic: "i64.atomic.rmw32.xchg_u", naturalAlign: 2 },
  0x48: { mnemonic: "i32.atomic.rmw.cmpxchg", naturalAlign: 2 },
  0x49: { mnemonic: "i64.atomic.rmw.cmpxchg", naturalAlign: 3 },
  0x4a: { mnemonic: "i32.atomic.rmw8.cmpxchg_u", naturalAlign: 0 },
  0x4b: { mnemonic: "i32.atomic.rmw16.cmpxchg_u", naturalAlign: 1 },
  0x4c: { mnemonic: "i64.atomic.rmw8.cmpxchg_u", naturalAlign: 0 },
  0x4d: { mnemonic: "i64.atomic.rmw16.cmpxchg_u", naturalAlign: 1 },
  0x4e: { mnemonic: "i64.atomic.rmw32.cmpxchg_u", naturalAlign: 2 },
};

// Decode the single instruction starting at an absolute module byte offset,
// classifying whether it is a plain or atomic memory access. This turns the
// previously manual "is the trapped instruction atomic or plain" step (used
// to diagnose the R4z load-dependent OOB/unaligned-access crash) into a
// repeatable, deterministic check against the exact shipped artifact.
export function decodeInstructionAt(buffer, offset) {
  ensureAvailable(buffer, offset, 1, "instruction opcode");
  const opcode = buffer[offset];

  if (opcode === ATOMIC_PREFIX_OPCODE) {
    const subOpcodeInfo = readUleb(buffer, offset + 1, "atomic sub-opcode");
    const subOpcode = subOpcodeInfo.value;
    if (subOpcode === ATOMIC_FENCE_SUBOPCODE) {
      ensureAvailable(buffer, subOpcodeInfo.nextOffset, 1, "atomic.fence reserved byte");
      return {
        offset,
        opcode,
        subOpcode,
        mnemonic: "atomic.fence",
        isMemoryOp: false,
        isAtomic: true,
        recognized: true,
        byteLength: subOpcodeInfo.nextOffset + 1 - offset,
      };
    }
    const entry = ATOMIC_MEMORY_OPS[subOpcode];
    if (!entry) {
      return {
        offset,
        opcode,
        subOpcode,
        isMemoryOp: false,
        isAtomic: true,
        recognized: false,
      };
    }
    const align = readUleb(buffer, subOpcodeInfo.nextOffset, "atomic memarg align");
    const memoryOffset = readUleb(buffer, align.nextOffset, "atomic memarg offset");
    return {
      offset,
      opcode,
      subOpcode,
      mnemonic: entry.mnemonic,
      isMemoryOp: true,
      isAtomic: true,
      recognized: true,
      align: align.value,
      naturalAlign: entry.naturalAlign,
      alignExceedsNatural: align.value > entry.naturalAlign,
      memoryOffset: memoryOffset.value,
      byteLength: memoryOffset.nextOffset - offset,
    };
  }

  const entry = PLAIN_MEMORY_OPS[opcode];
  if (!entry) {
    return {
      offset,
      opcode,
      isMemoryOp: false,
      isAtomic: false,
      recognized: false,
    };
  }
  const align = readUleb(buffer, offset + 1, "memarg align");
  const memoryOffset = readUleb(buffer, align.nextOffset, "memarg offset");
  return {
    offset,
    opcode,
    mnemonic: entry.mnemonic,
    isMemoryOp: true,
    isAtomic: false,
    recognized: true,
    align: align.value,
    naturalAlign: entry.naturalAlign,
    alignExceedsNatural: align.value > entry.naturalAlign,
    memoryOffset: memoryOffset.value,
    byteLength: memoryOffset.nextOffset - offset,
  };
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
  let instruction = null;
  if (matchedBody !== null) {
    try {
      instruction = decodeInstructionAt(buffer, moduleOffset);
    } catch (error) {
      instruction = {
        offset: moduleOffset,
        recognized: false,
        error: error.message,
      };
    }
  }
  return {
    bodyCount: bodies.length,
    codeSection,
    declaredFunctionCount,
    importedFunctionCount,
    matched: matchedBody !== null,
    moduleBytes: buffer.length,
    moduleOffset,
    result: matchedBody === null ? null : { ...matchedBody, instruction },
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
    const insn = result.result.instruction;
    const insnSummary = insn && insn.recognized
      ? `instruction=${insn.mnemonic} isAtomic=${insn.isAtomic} ` +
        (insn.isMemoryOp
          ? `align=${insn.align} naturalAlign=${insn.naturalAlign} ` +
            `alignExceedsNatural=${insn.alignExceedsNatural} memoryOffset=${insn.memoryOffset}`
          : "")
      : `instruction=unrecognized opcode=0x${insn ? insn.opcode.toString(16) : "??"}`;
    process.stdout.write(
      `offset=${result.moduleOffset} functionIndex=${result.result.functionIndex} ` +
      `definedOrdinal=${result.result.definedOrdinal} bodyOffset=${result.result.bodyOffset} ` +
      `bodySize=${result.result.bodySize} ${insnSummary}\n`,
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
