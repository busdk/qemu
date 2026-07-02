#!/usr/bin/env node
/*
 * Test helper-call classification for QEMU WebAssembly browser smoke results.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  HELPER_CALL_CLASSIFIER_VERSION,
  classifyHelperCalls,
  decodeTcgCallFlags,
  generatedTraceEntries,
  parseU32,
  returnLenFromTciCallInsn,
  returnShapeFromLen,
} from "./wasm-helper-call-classify.mjs";

assert.equal(HELPER_CALL_CLASSIFIER_VERSION, 1);
assert.deepEqual(decodeTcgCallFlags(0), []);
assert.deepEqual(decodeTcgCallFlags(6), [
  "NO_WRITE_GLOBALS",
  "NO_SIDE_EFFECTS",
]);
assert.equal(parseU32("0x00018202"), 0x00018202);
assert.equal(parseU32("123"), 123);
assert.equal(returnLenFromTciCallInsn("0x00000002"), 0);
assert.equal(returnLenFromTciCallInsn("0x00000102"), 1);
assert.equal(returnLenFromTciCallInsn("0x00000202"), 2);
assert.equal(returnShapeFromLen(0), "void");
assert.equal(returnShapeFromLen(1), "uint32");
assert.equal(returnShapeFromLen(2), "uint64");
assert.equal(returnShapeFromLen(3), "int128");
assert.equal(returnShapeFromLen(7), "stack-len-7");

const result = {
  browserVersion: "Chromium 149",
  elapsedMs: 8200,
  markerSeen: false,
  tci: {
    wasmSubset: {
      generatedTrace: {
        count: 7,
        limit: 16,
        entries: [
          {
            elapsedMs: 10,
            reason: "unsupported-op",
            helper: "",
            insn: "0x0",
          },
          {
            elapsedMs: 20,
            reason: "ffi-call-enter",
            helper: "lookup_tb_ptr",
            helper_flags: 6,
            helper_no_return: false,
            nargs: 1,
            insn: "0x00018202",
            arg0: "0x1000",
          },
          {
            elapsedMs: 21,
            reason: "ffi-call-return",
            helper: "lookup_tb_ptr",
            helper_flags: 6,
            helper_no_return: false,
            nargs: 1,
            insn: "0x00018202",
          },
          {
            elapsedMs: 30,
            reason: "ffi-call-enter",
            helper: "lookup_tb_ptr",
            helper_flags: 6,
            helper_no_return: false,
            nargs: 1,
            insn: "0x00018202",
            arg0: "0x2000",
          },
          {
            elapsedMs: 40,
            reason: "ffi-call-enter",
            helper: "outb",
            helper_flags: 0,
            helper_no_return: false,
            nargs: 3,
            insn: "0x0002c002",
            arg0: "0x3000",
            arg1: "0x3f8",
            arg2: "0x41",
          },
          {
            elapsedMs: 41,
            reason: "ffi-call-return",
            helper: "outb",
            helper_flags: 0,
            helper_no_return: false,
            nargs: 3,
            insn: "0x0002c002",
          },
        ],
      },
    },
  },
};

assert.equal(generatedTraceEntries(result).length, 6);
assert.deepEqual(generatedTraceEntries({}), []);

const classification = classifyHelperCalls(result);
assert.equal(classification.format, 1);
assert.equal(classification.purpose, "qemu-wasm-helper-call-classification");
assert.equal(classification.version, HELPER_CALL_CLASSIFIER_VERSION);
assert.deepEqual(classification.source, {
  browserVersion: "Chromium 149",
  elapsedMs: 8200,
  markerSeen: false,
  generatedTraceCount: 7,
  generatedTraceLimit: 16,
  retainedTraceEntries: 6,
});
assert.deepEqual(classification.totals, {
  helperCallEntries: 3,
  helperReturnEntries: 2,
  callReturnDelta: 1,
  helperGroups: 2,
  distinctHelpers: 2,
  helperCallsPerRetainedTraceEntry: 0.5,
});
assert.deepEqual(classification.helpers, [
  {
    helper: "lookup_tb_ptr",
    count: 2,
    share: 2 / 3,
  },
  {
    helper: "outb",
    count: 1,
    share: 1 / 3,
  },
]);
assert.equal(classification.groups[0].helper, "lookup_tb_ptr");
assert.equal(classification.groups[0].count, 2);
assert.equal(classification.groups[0].share, 2 / 3);
assert.equal(classification.groups[0].helperFlags, 6);
assert.deepEqual(classification.groups[0].helperFlagNames, [
  "NO_WRITE_GLOBALS",
  "NO_SIDE_EFFECTS",
]);
assert.equal(classification.groups[0].nargs, 1);
assert.equal(classification.groups[0].returnLen, 2);
assert.equal(classification.groups[0].returnShape, "uint64");
assert.equal(classification.groups[0].firstElapsedMs, 20);
assert.equal(classification.groups[0].lastElapsedMs, 30);
assert.deepEqual(classification.groups[0].samples, [
  {
    elapsedMs: 20,
    insn: "0x00018202",
    args: ["0x1000"],
  },
  {
    elapsedMs: 30,
    insn: "0x00018202",
    args: ["0x2000"],
  },
]);
assert.equal(classification.groups[1].helper, "outb");
assert.equal(classification.groups[1].returnShape, "void");

console.log("wasm-helper-call-classify-test: ok");
