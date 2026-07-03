#!/usr/bin/env node
/*
 * Test deterministic browser-Wasm accelerator run-loop model.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildHotsetFromMetadataModel,
  buildWasmjitRunloopModule,
  encodeS64,
  encodeTciP,
  encodeTciRI,
  encodeTciRL,
  encodeTciRRR,
  encodeTciRRS,
  encodeU32,
  expectedRunloopValue,
  runTciLikeRunloopModel,
  runWasmjitRunloopBenchmark,
  runWasmjitRunloopProbe,
  validateWasmjitRunloopContract,
  WASMJIT_EXIT_BUDGET,
  WASMJIT_ENV_OFFSET_INVALID,
  WASMJIT_HOTSET_BUILD_STATUS,
  WASMJIT_HOTSET_OP,
  WASMJIT_RUNLOOP_MODEL_VERSION,
  WASMJIT_TB_METADATA_FLAGS,
  WASMJIT_TB_METADATA_MAGIC,
  WASMJIT_TB_METADATA_VERSION,
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
} from "./wasmjit-runloop-model.mjs";

assert.deepEqual(encodeU32(0), [0]);
assert.deepEqual(encodeU32(128), [128, 1]);
assert.deepEqual(encodeS64(0n), [0]);
assert.deepEqual(encodeS64(-1n), [127]);
assert.equal(expectedRunloopValue(0n, 0), 0n);
assert.equal(expectedRunloopValue(0n, 1), 1n);
assert.equal(expectedRunloopValue(0n, 2), 0x5a5bn);
assert.equal(WASMJIT_ENV_OFFSET_INVALID, 0xffffffff);

function parseOpcodes(...sources) {
  const opcodes = {};
  let index = 0;

  for (const source of sources) {
    for (const match of source.matchAll(/^DEF\(([^,\s]+)/gm)) {
      opcodes[match[1]] = index;
      index++;
    }
  }
  return opcodes;
}

const opcodes = parseOpcodes(
  readFileSync(new URL("../../include/tcg/tcg-opc.h", import.meta.url), "utf8"),
  readFileSync(new URL("../../tcg/tci/tcg-target-opc.h.inc", import.meta.url), "utf8"),
);

function aluBranchGeneratedOutput(binaryOp, immediate) {
  return [
    encodeTciRI(opcodes.tci_movi, 2, immediate),
    encodeTciRRR(opcodes[binaryOp], 0, 0, 2),
    encodeTciRL(opcodes.brcond, 0, 0),
    encodeTciP(opcodes.goto_tb, 0),
  ];
}

function ramGeneratedOutput(binaryOp, immediate) {
  return [
    encodeTciRRS(opcodes.ld, 0, 1, 0),
    encodeTciRI(opcodes.tci_movi, 2, immediate),
    encodeTciRRR(opcodes[binaryOp], 0, 0, 2),
    encodeTciRRS(opcodes.st, 0, 1, 0),
    encodeTciP(opcodes.goto_tb, 0),
  ];
}

function traceLd32uBranchStoreOutput() {
  return [
    0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
    0x0000147d, 0xfff4e435, 0x0100e41e, 0xfff9057d,
    0x00054407, 0x0100e438, 0xfff74049, 0xfff10048,
    0xfff0f048,
  ];
}

function generatedMetadata({
  checksum = 1,
  flags = WASMJIT_TB_METADATA_FLAGS.valid |
    WASMJIT_TB_METADATA_FLAGS.loweringProfile |
    WASMJIT_TB_METADATA_FLAGS.profileLowerable |
    WASMJIT_TB_METADATA_FLAGS.generatedCandidate |
    WASMJIT_TB_METADATA_FLAGS.terminal |
    WASMJIT_TB_METADATA_FLAGS.generatedOutput,
  generatedUnsupportedOpCount = 0,
  generatedOutput = ramGeneratedOutput("add", checksum),
  generatedOutputSize = generatedOutput.length * 4,
  generatedOutputOpCount = generatedOutput.length,
  opCount = generatedOutput.length,
  tciRegEnvOffsets,
} = {}) {
  return {
    magic: WASMJIT_TB_METADATA_MAGIC,
    version: WASMJIT_TB_METADATA_VERSION,
    flags,
    opCount,
    generatedUnsupportedOpCount,
    generatedOutputSize,
    generatedOutputOpCount,
    generatedOutputChecksum: checksum,
    generatedOutput,
    tciRegEnvOffsets,
  };
}

{
  const built = buildHotsetFromMetadataModel([
    generatedMetadata({ generatedOutput: aluBranchGeneratedOutput("add", 1) }),
    generatedMetadata({ generatedOutput: ramGeneratedOutput("xor", 0x5a5a) }),
    generatedMetadata({ generatedOutput: ramGeneratedOutput("add", 3) }),
  ], { opcodes });

  assert.equal(built.ok, true);
  assert.equal(built.status, WASMJIT_HOTSET_BUILD_STATUS.ok);
  assert.equal(built.hotset.tbCount, 3);
  assert.equal(built.hotset.entryTbId, 1);
  assert.deepEqual(built.hotset.tbs.map((tb) => tb.tbId), [1, 2, 3]);
  assert.deepEqual(built.hotset.tbs.map((tb) => tb.nextTbId), [2, 3, 1]);
  assert.deepEqual(built.hotset.tbs.map((tb) => tb.op), [
    WASMJIT_HOTSET_OP.aluAddConst,
    WASMJIT_HOTSET_OP.ramXorConst,
    WASMJIT_HOTSET_OP.ramAddConst,
  ]);
  assert.deepEqual(
    built.hotset.tbs.map((tb) => tb.guestInstructions),
    [4, 5, 5],
  );
  assert.deepEqual(
    built.hotset.tbs.map((tb) => tb.immediate.toString()),
    ["1", "23130", "3"],
  );
  assert.deepEqual(
    built.hotset.tbs.map((tb) => tb.valueEnvOffset),
    [
      WASMJIT_ENV_OFFSET_INVALID,
      WASMJIT_ENV_OFFSET_INVALID,
      WASMJIT_ENV_OFFSET_INVALID,
    ],
  );
}

{
  const offsets = Array(16).fill(WASMJIT_ENV_OFFSET_INVALID);
  offsets[0] = 0x120;
  offsets[1] = 0x200;
  const built = buildHotsetFromMetadataModel([
    generatedMetadata({
      generatedOutput: ramGeneratedOutput("add", 7),
      tciRegEnvOffsets: offsets,
    }),
  ], { opcodes });

  assert.equal(built.ok, true);
  assert.equal(built.hotset.tbs[0].valueEnvOffset, 0x120);
  assert.equal(built.hotset.tbs[0].baseEnvOffset, 0x200);
  assert.equal(built.hotset.tbs[0].storeEnvOffset, 0x120);
  assert.equal(built.hotset.tbs[0].branchEnvOffset, WASMJIT_ENV_OFFSET_INVALID);
}

{
  const built = buildHotsetFromMetadataModel([
    generatedMetadata({ generatedOutput: traceLd32uBranchStoreOutput() }),
  ], { opcodes });

  assert.equal(built.ok, true);
  assert.equal(built.status, WASMJIT_HOTSET_BUILD_STATUS.ok);
  assert.equal(built.hotset.tbCount, 1);
  assert.equal(
    built.hotset.tbs[0].op,
    WASMJIT_HOTSET_OP.traceLd32uBranchStore,
  );
  assert.equal(built.hotset.tbs[0].guestInstructions, 13);
  assert.equal(built.hotset.tbs[0].immediate.toString(), "0");
  assert.equal(built.hotset.tbs[0].valueReg, 4);
  assert.equal(built.hotset.tbs[0].baseReg, 14);
  assert.equal(built.hotset.tbs[0].loadOffset, -16);
  assert.equal(built.hotset.tbs[0].storeOffset, -12);
  assert.equal(built.hotset.tbs[0].branchReg, 13);
  assert.equal(built.hotset.tbs[0].storeReg, 4);
  assert.equal(built.hotset.tbs[0].branchCond, 2);
  assert.equal(built.hotset.tbs[0].terminalOp, opcodes.goto_tb);
  assert.equal(built.hotset.tbs[0].terminalDiff, -140);
  assert.equal(built.hotset.tbs[0].valueEnvOffset, WASMJIT_ENV_OFFSET_INVALID);
  assert.equal(built.hotset.tbs[0].baseEnvOffset, WASMJIT_ENV_OFFSET_INVALID);
  assert.equal(built.hotset.tbs[0].branchEnvOffset, WASMJIT_ENV_OFFSET_INVALID);
  assert.equal(built.hotset.tbs[0].storeEnvOffset, WASMJIT_ENV_OFFSET_INVALID);
}

assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({
      generatedOutput: [
        0xfff0e41c, 0x0000057d, 0x00254d88, 0x00000d04,
        0xfff74049,
      ],
    }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.unsupportedHotTb,
);

assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({
      generatedOutput: [
        encodeTciRI(opcodes.tci_movi, 2, 1),
        encodeTciRRR(opcodes.add, 0, 1, 2),
        encodeTciRL(opcodes.brcond, 0, 0),
        encodeTciP(opcodes.goto_tb, 0),
      ],
    }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.unsupportedHotTb,
);

assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({
      generatedOutput: [
        encodeTciRRS(opcodes.ld, 0, 1, 0),
        encodeTciRI(opcodes.tci_movi, 2, 1),
        encodeTciRRR(opcodes.add, 0, 0, 2),
        encodeTciRRS(opcodes.st, 0, 1, 4),
        encodeTciP(opcodes.goto_tb, 0),
      ],
    }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.unsupportedHotTb,
);

assert.equal(
  buildHotsetFromMetadataModel([]).status,
  WASMJIT_HOTSET_BUILD_STATUS.empty,
);
assert.equal(
  buildHotsetFromMetadataModel([generatedMetadata(), generatedMetadata()], {
    capacity: 1,
    opcodes,
  }).status,
  WASMJIT_HOTSET_BUILD_STATUS.capacity,
);
assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({
      flags: WASMJIT_TB_METADATA_FLAGS.valid |
        WASMJIT_TB_METADATA_FLAGS.generatedCandidate |
        WASMJIT_TB_METADATA_FLAGS.generatedOutput,
    }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.nonTerminal,
);
assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({ generatedUnsupportedOpCount: 1 }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.unsupportedHotTb,
);
assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({
      flags: WASMJIT_TB_METADATA_FLAGS.valid |
        WASMJIT_TB_METADATA_FLAGS.generatedCandidate |
        WASMJIT_TB_METADATA_FLAGS.terminal,
    }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.noGeneratedOutput,
);
assert.equal(
  buildHotsetFromMetadataModel([
    generatedMetadata({
      flags: WASMJIT_TB_METADATA_FLAGS.valid |
        WASMJIT_TB_METADATA_FLAGS.generatedCandidate |
        WASMJIT_TB_METADATA_FLAGS.terminal |
        WASMJIT_TB_METADATA_FLAGS.generatedOutput |
        WASMJIT_TB_METADATA_FLAGS.outputTruncated,
    }),
  ], { opcodes }).status,
  WASMJIT_HOTSET_BUILD_STATUS.outputTruncated,
);

for (const workload of [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
]) {
  const moduleBytes = buildWasmjitRunloopModule({ workload });
  assert.equal(WebAssembly.validate(moduleBytes), true);

  const contract = validateWasmjitRunloopContract(moduleBytes);
  assert.deepEqual(contract.imports, [
    {
      module: "env",
      name: "memory",
      kind: "memory",
    },
  ]);
  assert.deepEqual(contract.exports, [
    {
      name: "wasmjit_run",
      kind: "function",
    },
  ]);
}

assert.throws(
  () => validateWasmjitRunloopContract(Uint8Array.from([0, 1, 2, 3])),
  /not valid WebAssembly/,
);

const aluSmallProbe = await runWasmjitRunloopProbe({
  budget: 32,
  workload: WASMJIT_WORKLOAD_ALU_BRANCH,
});
assert.equal(aluSmallProbe.format, 1);
assert.equal(aluSmallProbe.purpose, "qemu-wasmjit-runloop-model");
assert.equal(aluSmallProbe.version, WASMJIT_RUNLOOP_MODEL_VERSION);
assert.equal(aluSmallProbe.workload, WASMJIT_WORKLOAD_ALU_BRANCH);
assert.equal(aluSmallProbe.ok, true);
assert.equal(aluSmallProbe.exitReason, WASMJIT_EXIT_BUDGET);
assert.equal(aluSmallProbe.generatedGuestInstructions, "128");
assert.equal(aluSmallProbe.generatedChainLength, "32");
assert.equal(aluSmallProbe.inlineTlbHitLoads, "0");
assert.equal(aluSmallProbe.inlineTlbHitStores, "0");
assert.equal(aluSmallProbe.helperCalls, "0");
assert.equal(aluSmallProbe.qemuLoadCalls, "0");
assert.equal(aluSmallProbe.qemuStoreCalls, "0");
assert.equal(aluSmallProbe.exitValue, aluSmallProbe.expectedValue);
assert.equal(aluSmallProbe.ramValue, "0");

const ramSmallProbe = await runWasmjitRunloopProbe({
  budget: 32,
  workload: WASMJIT_WORKLOAD_TLB_HIT_RAM,
});
assert.equal(ramSmallProbe.workload, WASMJIT_WORKLOAD_TLB_HIT_RAM);
assert.equal(ramSmallProbe.ok, true);
assert.equal(ramSmallProbe.generatedGuestInstructions, "128");
assert.equal(ramSmallProbe.generatedChainLength, "32");
assert.equal(ramSmallProbe.inlineTlbHitLoads, "32");
assert.equal(ramSmallProbe.inlineTlbHitStores, "32");
assert.equal(ramSmallProbe.helperCalls, "0");
assert.equal(ramSmallProbe.qemuLoadCalls, "0");
assert.equal(ramSmallProbe.qemuStoreCalls, "0");
assert.equal(ramSmallProbe.exitValue, ramSmallProbe.expectedValue);
assert.equal(ramSmallProbe.ramValue, ramSmallProbe.expectedValue);

for (const workload of [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
]) {
  const budgetProbe = await runWasmjitRunloopProbe({
    budget: 1_000_000,
    workload,
  });
  assert.equal(budgetProbe.ok, true);
  assert.equal(budgetProbe.exitReason, WASMJIT_EXIT_BUDGET);
  assert.equal(budgetProbe.generatedGuestInstructions, "4000000");
  assert.equal(budgetProbe.generatedChainLength, "1000000");
  assert.equal(budgetProbe.helperCalls, "0");
  assert.equal(budgetProbe.qemuLoadCalls, "0");
  assert.equal(budgetProbe.qemuStoreCalls, "0");
  assert.equal(budgetProbe.exitValue, budgetProbe.expectedValue);
  if (workload === WASMJIT_WORKLOAD_TLB_HIT_RAM) {
    assert.equal(budgetProbe.inlineTlbHitLoads, "1000000");
    assert.equal(budgetProbe.inlineTlbHitStores, "1000000");
    assert.equal(budgetProbe.ramValue, budgetProbe.expectedValue);
  } else {
    assert.equal(budgetProbe.inlineTlbHitLoads, "0");
    assert.equal(budgetProbe.inlineTlbHitStores, "0");
    assert.equal(budgetProbe.ramValue, "0");
  }

  const tciLike = runTciLikeRunloopModel({
    budget: 1_000_000,
    workload,
  });
  assert.equal(tciLike.exitReason, WASMJIT_EXIT_BUDGET);
  assert.equal(tciLike.generatedGuestInstructions, 4000000n);
  assert.equal(tciLike.generatedChainLength, 1000000n);
  assert.equal(tciLike.helperCalls, 0n);
  assert.equal(tciLike.qemuLoadCalls, 0n);
  assert.equal(tciLike.qemuStoreCalls, 0n);
  assert.equal(tciLike.tb0Executions, 500000n);
  assert.equal(tciLike.tb1Executions, 500000n);
  assert.equal(tciLike.accumulator.toString(), budgetProbe.expectedValue);
}

for (const workload of [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
]) {
  const benchmark = await runWasmjitRunloopBenchmark({
    budget: 1_000_000,
    rounds: 3,
    workload,
  });
  assert.equal(benchmark.format, 1);
  assert.equal(benchmark.purpose, "qemu-wasmjit-runloop-model-benchmark");
  assert.equal(benchmark.version, WASMJIT_RUNLOOP_MODEL_VERSION);
  assert.equal(benchmark.workload, workload);
  assert.equal(benchmark.wasmTimesMs.length, 3);
  assert.equal(benchmark.tciLikeTimesMs.length, 3);
  assert.equal(benchmark.wasmBestMs > 0, true);
  assert.equal(benchmark.tciLikeBestMs > 0, true);
  assert.equal(benchmark.bestRatio > 1, true);
}

console.log("wasmjit runloop model: ok");
