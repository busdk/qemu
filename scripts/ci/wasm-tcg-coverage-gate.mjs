#!/usr/bin/env node
/*
 * Estimate whether a wasm64 TCG lowering profile covers the measured hot TCI
 * opcode mix from a browser smoke result.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

export const COVERAGE_GATE_MODEL_VERSION = 2;

export const LOWERING_PROFILES = {
  /*
   * Operations covered by the deterministic backend-shaped lowering probe in
   * wasm-tb-module-emitter.mjs.  Keep this profile conservative: add an
   * operation only after the emitter has executable differential coverage for
   * the corresponding lowering shape.
   */
  deterministic: new Set([
    "add",
    "brcond",
    "exit_tb",
    "goto_tb",
    "ld",
    "mb",
    "mov",
    "qemu_ld",
    "qemu_st",
    "setcond",
    "st",
    "tci_movi",
    "tci_movl",
    "tci_qemu_ld_rrr",
    "tci_qemu_st_rrr",
    "tci_setcond32",
    "xor",
  ]),

  /*
   * The next useful broad backend target from the recorded Bus Engine OS hot
   * block evidence.  It includes ordinary interpreter work that dominated the
   * previous run: tci_movi, st, ld, add, brcond, mb, and related load/store
   * and set-condition operations.  It is a planning gate, not a claim that the
   * live backend already lowers every operation here.
   */
  plannedHotblock: new Set([
    "add",
    "and",
    "brcond",
    "exit_tb",
    "goto_tb",
    "ld",
    "ld8s",
    "ld8u",
    "ld16s",
    "ld16u",
    "ld32s",
    "ld32u",
    "mb",
    "mov",
    "or",
    "qemu_ld",
    "qemu_st",
    "setcond",
    "st",
    "st8",
    "st16",
    "st32",
    "sub",
    "tci_movi",
    "tci_movl",
    "tci_qemu_ld_rrr",
    "tci_qemu_st_rrr",
    "tci_setcond32",
    "xor",
  ]),
};

function usage() {
  return `Usage: wasm-tcg-coverage-gate.mjs --result FILE [options]

Options:
  --profile NAME       Lowering profile: deterministic, planned-hotblock
                       (default: deterministic)
  --scope SCOPE        Hot-block evidence scope: latest, histogram
                       (default: latest)
  --min-ratio RATIO    Minimum supported top-op ratio from 0 to 1
                       (default: 0.80)
  --require-op OP      Require a specific operation to be covered by the
                       selected profile. May be repeated.
  --json               Print JSON only
`;
}

function normalizeProfileName(name) {
  if (name === "planned-hotblock") {
    return "plannedHotblock";
  }
  return name;
}

export function hotBlockSummariesFromResult(result) {
  const summaries = result?.hotBlocks?.summaries;
  if (Array.isArray(summaries)) {
    return summaries;
  }
  const last = result?.hotBlocks?.lastSummary;
  if (last && typeof last === "object" && !Array.isArray(last)) {
    return [last];
  }
  return [];
}

export function latestHotBlockSummary(result) {
  const summaries = hotBlockSummariesFromResult(result);
  return summaries.length === 0 ? null : summaries[summaries.length - 1];
}

export function opHistogramFromHotBlockSummaries(summaries) {
  const countsByOp = new Map();
  for (const summary of summaries) {
    const topOps = Array.isArray(summary?.top_tci_ops)
      ? summary.top_tci_ops
      : [];
    for (const entry of topOps) {
      const op = entry?.op;
      const count = Number(entry?.count);
      if (typeof op !== "string" || !Number.isFinite(count) || count < 0) {
        continue;
      }
      /*
       * QEMU hot-block summaries report cumulative opcode counters.  The
       * histogram uses the maximum observed value per opcode so an opcode that
       * drops out of a later top-N list remains visible without double-counting
       * repeated cumulative samples.
       */
      countsByOp.set(op, Math.max(countsByOp.get(op) ?? 0, count));
    }
  }
  return Array.from(countsByOp, ([op, count]) => ({ op, count }))
    .sort((a, b) => b.count - a.count || a.op.localeCompare(b.op));
}

export function coverageFromOpHistogram(histogram, supportedOps) {
  let supportedCount = 0;
  let unsupportedCount = 0;
  const supported = [];
  const unsupported = [];

  const topOps = Array.isArray(histogram) ? histogram : [];
  for (const entry of topOps) {
    const op = entry?.op;
    const count = Number(entry?.count);
    if (typeof op !== "string" || !Number.isFinite(count) || count < 0) {
      continue;
    }
    const normalized = { op, count };
    if (supportedOps.has(op)) {
      supportedCount += count;
      supported.push(normalized);
    } else {
      unsupportedCount += count;
      unsupported.push(normalized);
    }
  }

  const measuredCount = supportedCount + unsupportedCount;
  return {
    measuredCount,
    supportedCount,
    unsupportedCount,
    supportedRatio: measuredCount === 0 ? 0 : supportedCount / measuredCount,
    supported,
    unsupported,
  };
}

export function coverageFromHotBlockSummary(summary, supportedOps) {
  return coverageFromOpHistogram(
    opHistogramFromHotBlockSummaries([summary]),
    supportedOps,
  );
}

export function coverageFromHotBlockSummaries(summaries, supportedOps) {
  return coverageFromOpHistogram(
    opHistogramFromHotBlockSummaries(summaries),
    supportedOps,
  );
}

export function coverageGate(result, options = {}) {
  const profileName = normalizeProfileName(options.profile || "deterministic");
  const supportedOps = LOWERING_PROFILES[profileName];
  const minRatio = options.minRatio ?? 0.80;
  const scope = options.scope || "latest";
  const requiredOps = Array.isArray(options.requiredOps)
    ? options.requiredOps
    : [];
  const summaries = hotBlockSummariesFromResult(result);
  const summary = latestHotBlockSummary(result);

  if (!supportedOps) {
    throw new Error(`unknown lowering profile: ${options.profile}`);
  }
  if (scope !== "latest" && scope !== "histogram") {
    throw new Error(`unknown coverage scope: ${scope}`);
  }
  if (!summary) {
    throw new Error("result does not contain hotBlocks summaries");
  }

  const coverage = scope === "histogram"
    ? coverageFromHotBlockSummaries(summaries, supportedOps)
    : coverageFromHotBlockSummary(summary, supportedOps);
  const missingRequiredOps = requiredOps.filter((op) => !supportedOps.has(op));
  return {
    format: 1,
    purpose: "qemu-wasm64-tcg-coverage-gate",
    version: COVERAGE_GATE_MODEL_VERSION,
    profile: profileName,
    scope,
    minRatio,
    requiredOps,
    missingRequiredOps,
    ok: coverage.supportedRatio >= minRatio && missingRequiredOps.length === 0,
    summary: {
      reason: summary.reason,
      tbExecs: summary.tb_execs,
      tciOps: summary.tci_ops,
      helperCalls: summary.helper_calls,
      qemuLoads: summary.qemu_loads,
      qemuStores: summary.qemu_stores,
      sourceSummaries: scope === "histogram" ? summaries.length : 1,
    },
    coverage,
  };
}

function parseArgs(argv) {
  const options = {
    profile: "deterministic",
    scope: "latest",
    minRatio: 0.80,
    requiredOps: [],
    json: false,
  };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--result") {
      options.result = argv[++index];
    } else if (arg === "--profile") {
      options.profile = argv[++index];
    } else if (arg === "--scope") {
      options.scope = argv[++index];
    } else if (arg === "--min-ratio") {
      options.minRatio = Number(argv[++index]);
    } else if (arg === "--require-op") {
      options.requiredOps.push(argv[++index]);
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

async function run() {
  const options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.result) {
    throw new Error("--result is required");
  }
  if (!Number.isFinite(options.minRatio) ||
      options.minRatio < 0 ||
      options.minRatio > 1) {
    throw new Error("--min-ratio must be a number from 0 to 1");
  }
  if (options.scope !== "latest" && options.scope !== "histogram") {
    throw new Error("--scope must be latest or histogram");
  }

  const result = JSON.parse(fs.readFileSync(options.result, "utf8"));
  const gate = coverageGate(result, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  } else {
    process.stdout.write(
      `qemu-wasm64-tcg-coverage-gate: profile=${gate.profile} ` +
      `scope=${gate.scope} ` +
      `supported=${gate.coverage.supportedCount} ` +
      `unsupported=${gate.coverage.unsupportedCount} ` +
      `ratio=${gate.coverage.supportedRatio.toFixed(4)} ` +
      `min=${gate.minRatio.toFixed(4)} ` +
      `missing_required=${gate.missingRequiredOps.length} ok=${gate.ok}\n`,
    );
    if (gate.missingRequiredOps.length > 0) {
      process.stdout.write(
        `missing required ops: ${gate.missingRequiredOps.join(", ")}\n`,
      );
    }
    if (gate.coverage.unsupported.length > 0) {
      process.stdout.write(
        `unsupported top ops: ${gate.coverage.unsupported
          .map((entry) => `${entry.op}=${entry.count}`)
          .join(", ")}\n`,
      );
    }
  }
  if (!gate.ok) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
