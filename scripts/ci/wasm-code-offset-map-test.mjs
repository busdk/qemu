#!/usr/bin/env node
/*
 * Test wasm code offset mapper.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeInstructionAt,
  inspectWasmCodeOffset,
} from "./wasm-code-offset-map.mjs";

function uleb(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}

function nameBytes(value) {
  const bytes = Array.from(Buffer.from(value, "utf8"));
  return [...uleb(bytes.length), ...bytes];
}

const body0 = [0x00, 0x0b];
const body1 = [0x00, 0x01, 0x0b];
const codePayload = [
  0x02,
  ...uleb(body0.length), ...body0,
  ...uleb(body1.length), ...body1,
];

function wasmWithSections(extraSections = []) {
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...section(1, [
      0x01,
      0x60, 0x00, 0x00,
    ]),
    ...section(2, [
      0x01,
      ...nameBytes("env"),
      ...nameBytes("imp"),
      0x00,
      0x00,
    ]),
    ...extraSections,
  ]);
}

const wasm = wasmWithSections([
  ...section(3, [
    0x02,
    0x00,
    0x00,
  ]),
  ...section(10, codePayload),
]);

const mismatchedFunctionCountWasm = wasmWithSections([
  ...section(3, [
    0x01,
    0x00,
  ]),
  ...section(10, codePayload),
]);

const trailingFunctionSectionWasm = wasmWithSections([
  ...section(3, [
    0x01,
    0x00,
    0x00,
  ]),
  ...section(10, [
    0x01,
    ...uleb(body0.length), ...body0,
  ]),
]);

const trailingCodeSectionWasm = wasmWithSections([
  ...section(3, [
    0x01,
    0x00,
  ]),
  ...section(10, [
    0x01,
    ...uleb(body0.length), ...body0,
    0x00,
  ]),
]);

const trailingImportSectionWasm = Buffer.from([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  ...section(1, [
    0x01,
    0x60, 0x00, 0x00,
  ]),
  ...section(2, [
    0x01,
    ...nameBytes("env"),
    ...nameBytes("imp"),
    0x00,
    0x00,
    0x00,
  ]),
  ...section(3, [
    0x01,
    0x00,
  ]),
  ...section(10, [
    0x01,
    ...uleb(body0.length), ...body0,
  ]),
]);

const body1NopOffset = wasm.indexOf(Buffer.from(body1)) + 1;
assert.ok(body1NopOffset > 0);

{
  const mapped = inspectWasmCodeOffset(wasm, body1NopOffset);
  assert.equal(mapped.matched, true);
  assert.equal(mapped.importedFunctionCount, 1);
  assert.equal(mapped.declaredFunctionCount, 2);
  assert.equal(mapped.bodyCount, 2);
  assert.equal(mapped.result.functionIndex, 2);
  assert.equal(mapped.result.definedOrdinal, 1);
  assert.equal(mapped.result.bodyOffset, 1);
  assert.equal(mapped.result.bodySize, 3);
}

{
  const mapped = inspectWasmCodeOffset(wasm, 8);
  assert.equal(mapped.matched, false);
  assert.equal(mapped.result, null);
}

assert.throws(
  () => inspectWasmCodeOffset(mismatchedFunctionCountWasm, 8),
  /function\/code count mismatch/,
);

assert.throws(
  () => inspectWasmCodeOffset(trailingFunctionSectionWasm, 8),
  /function section has trailing bytes/,
);

assert.throws(
  () => inspectWasmCodeOffset(trailingCodeSectionWasm, 8),
  /code section has trailing bytes/,
);

assert.throws(
  () => inspectWasmCodeOffset(trailingImportSectionWasm, 8),
  /import section has trailing bytes/,
);

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-offset-map-"));
  const wasmPath = join(dir, "tiny.wasm");
  writeFileSync(wasmPath, wasm);
  const output = execFileSync(process.execPath, [
    "scripts/ci/wasm-code-offset-map.mjs",
    "--wasm", wasmPath,
    "--offset", `0x${body1NopOffset.toString(16)}`,
    "--json",
  ], { encoding: "utf8" });
  const mapped = JSON.parse(output);
  assert.equal(mapped.matched, true);
  assert.equal(mapped.result.functionIndex, 2);
  assert.equal(mapped.result.definedOrdinal, 1);
}

{
  const output = execFileSync(process.execPath, [
    "scripts/ci/wasm-code-offset-map.mjs",
    "--help",
  ], { encoding: "utf8" });
  assert.match(output, /Usage: wasm-code-offset-map\.mjs --wasm FILE --offset OFFSET/);
}

// The R4z trapped instruction was reported as plain `i64.load align=3
// offset=8` (not an atomic). Decode that exact byte pattern directly.
{
  const insn = decodeInstructionAt(
    Buffer.from([0x29, ...uleb(3), ...uleb(8)]),
    0,
  );
  assert.equal(insn.recognized, true);
  assert.equal(insn.mnemonic, "i64.load");
  assert.equal(insn.isMemoryOp, true);
  assert.equal(insn.isAtomic, false);
  assert.equal(insn.align, 3);
  assert.equal(insn.naturalAlign, 3);
  assert.equal(insn.alignExceedsNatural, false);
  assert.equal(insn.memoryOffset, 8);
  assert.equal(insn.byteLength, 3);
}

// An over-aligned plain load is still a plain load: the align immediate is
// only a hint and never causes a trap, unlike the atomic case below.
{
  const insn = decodeInstructionAt(
    Buffer.from([0x2d, ...uleb(1), ...uleb(0)]),
    0,
  );
  assert.equal(insn.mnemonic, "i32.load8_u");
  assert.equal(insn.isAtomic, false);
  assert.equal(insn.naturalAlign, 0);
  assert.equal(insn.alignExceedsNatural, true);
}

// The atomic counterpart of the same load width traps on misalignment.
{
  const insn = decodeInstructionAt(
    Buffer.from([0xfe, 0x11, ...uleb(3), ...uleb(8)]),
    0,
  );
  assert.equal(insn.recognized, true);
  assert.equal(insn.mnemonic, "i64.atomic.load");
  assert.equal(insn.isMemoryOp, true);
  assert.equal(insn.isAtomic, true);
  assert.equal(insn.align, 3);
  assert.equal(insn.memoryOffset, 8);
  assert.equal(insn.byteLength, 4);
}

// atomic.fence has no memarg, only a reserved zero byte after the sub-opcode.
{
  const insn = decodeInstructionAt(Buffer.from([0xfe, 0x03, 0x00]), 0);
  assert.equal(insn.mnemonic, "atomic.fence");
  assert.equal(insn.isMemoryOp, false);
  assert.equal(insn.isAtomic, true);
  assert.equal(insn.byteLength, 3);
}

// Unknown opcodes (plain and atomic-prefixed) are reported, not thrown.
{
  const insn = decodeInstructionAt(Buffer.from([0x01]), 0);
  assert.equal(insn.recognized, false);
  assert.equal(insn.isMemoryOp, false);
  assert.equal(insn.isAtomic, false);
}
{
  const insn = decodeInstructionAt(Buffer.from([0xfe, 0x7f]), 0);
  assert.equal(insn.recognized, false);
  assert.equal(insn.isAtomic, true);
}

// End-to-end: a function body whose byte offset is the exact opcode of an
// `i64.load align=3 offset=8` reports the instruction through
// inspectWasmCodeOffset, the same call site the R4z investigation uses.
{
  const loadBody = [0x00, 0x29, ...uleb(3), ...uleb(8), 0x1a, 0x0b];
  const loadWasm = wasmWithSections([
    ...section(3, [0x01, 0x00]),
    ...section(10, [
      0x01,
      ...uleb(loadBody.length), ...loadBody,
    ]),
  ]);
  const loadOpcodeOffset = loadWasm.indexOf(0x29, loadWasm.indexOf(Buffer.from(loadBody)));
  const mapped = inspectWasmCodeOffset(loadWasm, loadOpcodeOffset);
  assert.equal(mapped.matched, true);
  assert.equal(mapped.result.instruction.mnemonic, "i64.load");
  assert.equal(mapped.result.instruction.isAtomic, false);
  assert.equal(mapped.result.instruction.align, 3);
  assert.equal(mapped.result.instruction.memoryOffset, 8);
}

console.log("wasm-code-offset-map-test: ok");
