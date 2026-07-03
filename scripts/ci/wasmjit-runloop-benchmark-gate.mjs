#!/usr/bin/env node
/*
 * Deterministic wasmjit run-loop microbenchmark gate.
 *
 * This is a preflight for the browser-WASM accelerator path. It does not
 * prove Linux boot acceleration; it proves the generated run-loop shape can
 * beat the local TCI-like interpreter model for the hot ALU/branch and
 * TLB-hit RAM paths before an expensive browser smoke is attempted.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import {
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
  runWasmjitRunloopBenchmark,
} from "./wasmjit-runloop-model.mjs";
import { writeFileSync } from "node:fs";

function usage() {
  return `usage: node scripts/ci/wasmjit-runloop-benchmark-gate.mjs [options]

options:
  --budget <n>       guest-instruction-equivalent loop budget (default: 1000000)
  --rounds <n>       benchmark rounds per workload (default: 7)
  --min-ratio <n>    required tci-like / wasm best-time ratio (default: 3)
  --out <path>       also write the JSON result to a file
  --help             show this help
`;
}

function parseInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} expects a positive integer`);
  }
  return parsed;
}

function parseNumber(name, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} expects a positive number`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    budget: 1_000_000,
    rounds: 7,
    minRatio: 3,
    out: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--budget") {
      options.budget = parseInteger(arg, argv[++index]);
      continue;
    }
    if (arg === "--rounds") {
      options.rounds = parseInteger(arg, argv[++index]);
      continue;
    }
    if (arg === "--min-ratio") {
      options.minRatio = parseNumber(arg, argv[++index]);
      continue;
    }
    if (arg === "--out") {
      options.out = argv[++index];
      if (!options.out) {
        throw new Error("--out expects a path");
      }
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const workloads = [
  WASMJIT_WORKLOAD_ALU_BRANCH,
  WASMJIT_WORKLOAD_TLB_HIT_RAM,
];
const results = [];

for (const workload of workloads) {
  const result = await runWasmjitRunloopBenchmark({
    budget: options.budget,
    rounds: options.rounds,
    workload,
  });
  results.push({
    workload,
    budget: result.budget,
    rounds: result.rounds,
    wasmBestMs: result.wasmBestMs,
    tciLikeBestMs: result.tciLikeBestMs,
    bestRatio: result.bestRatio,
    pass: result.bestRatio >= options.minRatio,
    wasmTimesMs: result.wasmTimesMs,
    tciLikeTimesMs: result.tciLikeTimesMs,
  });
}

const output = {
  format: 1,
  purpose: "qemu-wasmjit-runloop-benchmark-gate",
  minRatio: options.minRatio,
  ok: results.every((result) => result.pass),
  results,
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (options.out) {
  writeFileSync(options.out, serialized);
}
process.stdout.write(serialized);
if (!output.ok) {
  process.exitCode = 1;
}
