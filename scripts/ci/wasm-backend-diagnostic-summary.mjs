#!/usr/bin/env node
/*
 * Summarize QEMU WebAssembly backend diagnostics from a browser smoke result.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BACKEND_DIAGNOSTIC_SUMMARY_VERSION = 1;

const ARTIFACT_FILES = [
  "qemu-system-x86_64.js",
  "qemu-system-x86_64.wasm",
  "qemu-system-wasm-artifacts.json",
];

const COMPILE_FAILURE_FIELDS = [
  "generated_compile_failed",
  "generated_compile_zero",
  "generated_compile_prereq_failed",
  "generated_compile_no_terminal",
  "generated_compile_lowering_failed",
  "generated_compile_module_failed",
  "generated_compile_table_failed",
  "generated_compile_instance_failed",
  "generated_compile_add_function_failed",
  "generated_compile_exception_failed",
  "generated_compile_unknown_failed",
];

const FALLBACK_FIELDS = [
  "fallback_unsupported",
  "fallback_helper",
  "fallback_qemu_load",
  "fallback_qemu_store",
  "fallback_runtime",
  "generated_fallback_unsupported",
  "generated_status_nonpositive",
  "generated_status_unknown",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function artifactHashes(artifactDir) {
  if (!artifactDir) {
    return {};
  }
  const hashes = {};
  for (const name of ARTIFACT_FILES) {
    const file = path.join(artifactDir, name);
    if (fs.existsSync(file)) {
      hashes[name] = sha256File(file);
    }
  }
  return hashes;
}

function latestSummary(result) {
  const wasm64Tcg = result?.wasm64Tcg?.lastSummary;
  if (wasm64Tcg && typeof wasm64Tcg === "object") {
    return {
      source: "wasm64Tcg.lastSummary",
      summary: wasm64Tcg,
    };
  }

  const subset = result?.tci?.wasmSubset?.lastSummary;
  if (subset && typeof subset === "object") {
    return {
      source: "tci.wasmSubset.lastSummary",
      summary: subset,
    };
  }

  return {
    source: null,
    summary: {},
  };
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sortedNonzeroFields(summary, fields) {
  return fields
    .map((field) => ({
      field,
      value: numberOrZero(summary[field]),
    }))
    .filter((entry) => entry.value !== 0)
    .sort((left, right) =>
      right.value - left.value || left.field.localeCompare(right.field));
}

function traceReasonCounts(result) {
  const entries = generatedTraceEntries(result);
  if (!Array.isArray(entries)) {
    return [];
  }
  const counts = new Map();
  for (const entry of entries) {
    const reason = typeof entry?.reason === "string" && entry.reason.length > 0
      ? entry.reason
      : "<unknown>";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) =>
      right.count - left.count || left.reason.localeCompare(right.reason));
}

function generatedTraceEntries(result) {
  const entries = result?.tci?.wasmSubset?.generatedTrace?.entries;
  return Array.isArray(entries) ? entries : [];
}

function traceDerivedGenerated(result) {
  const entries = generatedTraceEntries(result);
  const compiled = new Set();
  let attempts = 0;
  let executed = 0;
  let dispatches = 0;
  let exits = 0;

  for (const entry of entries) {
    const signature = entry?.signature ?? entry?.tb_ptr ?? "";
    if (entry?.reason === "compile-enter") {
      attempts++;
    } else if (entry?.reason === "compile" && signature !== "") {
      compiled.add(signature);
    } else if (entry?.reason === "exec-dispatch") {
      executed++;
      dispatches++;
    } else if (entry?.reason === "exec-exit") {
      executed++;
      exits++;
    }
  }

  const denominator = attempts;
  const ppm = denominator === 0 ? 0 : Math.floor((executed * 1000000) / denominator);

  return {
    available: entries.length > 0,
    basis: "generated_trace_events",
    attempts,
    compiled: compiled.size,
    executed,
    cacheHits: 0,
    dispatches,
    exits,
    coverage: {
      basis: "generated_trace_events",
      numerator: executed,
      denominator,
      ppm,
      ratio: denominator === 0 ? 0 : executed / denominator,
    },
  };
}

function coverageFromSummary(summary, fallbackCoverage = null) {
  const directNumerator = numberOrZero(summary.direct_coverage_numerator);
  const directDenominator = numberOrZero(summary.direct_coverage_denominator);
  const directPpm = numberOrZero(summary.direct_coverage_ppm);
  if (directDenominator !== 0) {
    const computedDirectPpm =
      Math.floor((directNumerator * 1000000) / directDenominator);
    return {
      basis: summary.direct_coverage_basis ??
        "direct_generated_executed/direct_tb_entries",
      numerator: directNumerator,
      denominator: directDenominator,
      ppm: directPpm || computedDirectPpm,
      ratio: directNumerator / directDenominator,
    };
  }

  const numerator = numberOrZero(summary.generated_coverage_numerator);
  const denominator = numberOrZero(summary.generated_coverage_denominator);
  const ppm = numberOrZero(summary.generated_coverage_ppm);
  if (denominator === 0 && fallbackCoverage) {
    return fallbackCoverage;
  }
  const computedPpm = denominator === 0
    ? 0
    : Math.floor((numerator * 1000000) / denominator);
  return {
    basis: summary.generated_coverage_basis ?? null,
    numerator,
    denominator,
    ppm: ppm || computedPpm,
    ratio: denominator === 0 ? 0 : numerator / denominator,
  };
}

export function diagnosticSummary(result, options = {}) {
  const { source, summary } = latestSummary(result);
  const traceDerived = traceDerivedGenerated(result);
  const coverage = coverageFromSummary(summary, source ? null : traceDerived.coverage);
  const minCoveragePpm = numberOrZero(options.minCoveragePpm);
  const minCompiled = numberOrZero(options.minCompiled);
  const generatedCompiled = numberOrZero(summary.generated_compiled) ||
    (source ? 0 : traceDerived.compiled);
  const generatedExecuted = numberOrZero(summary.generated_executed) ||
    (source ? 0 : traceDerived.executed);
  const generatedCacheHits = numberOrZero(summary.generated_cache_hits) ||
    (source ? 0 : traceDerived.cacheHits);
  const generatedAttempts = numberOrZero(summary.generated_attempts) ||
    (source ? 0 : traceDerived.attempts);
  const directTbEntries = numberOrZero(summary.direct_tb_entries);
  const directGeneratedExecuted =
    numberOrZero(summary.direct_generated_executed);
  const directGeneratedDispatches =
    numberOrZero(summary.direct_generated_dispatches);
  const directTciFallbacks = numberOrZero(summary.direct_tci_fallbacks);
  const hasThresholds = minCoveragePpm > 0 || minCompiled > 0;

  return {
    format: 1,
    purpose: "qemu-wasm-backend-diagnostic-summary",
    version: BACKEND_DIAGNOSTIC_SUMMARY_VERSION,
    source: {
      result: options.resultPath ?? null,
      summary,
      summarySource: source,
      browserVersion: result?.browserVersion ?? null,
      elapsedMs: result?.elapsedMs ?? null,
      success: result?.success ?? null,
      marker: result?.marker ?? null,
      markerSeen: result?.markerSeen ?? null,
    },
    artifacts: {
      directory: options.artifactDir ?? null,
      hashes: artifactHashes(options.artifactDir),
    },
    generated: {
      attempts: generatedAttempts,
      compiled: generatedCompiled,
      executed: generatedExecuted,
      cacheHits: generatedCacheHits,
      coverage,
      direct: {
        tbEntries: directTbEntries,
        generatedExecuted: directGeneratedExecuted,
        generatedDispatches: directGeneratedDispatches,
        tciFallbacks: directTciFallbacks,
      },
      traceDerived,
    },
    translated: {
      tbs: numberOrZero(summary.translated_tbs),
      ops: numberOrZero(summary.translated_ops),
      generatedCandidateTbs:
        numberOrZero(summary.translated_generated_candidate_tbs),
      generatedOutputTbs:
        numberOrZero(summary.translated_generated_output_tbs),
      generatedOutputUnavailableTbs:
        numberOrZero(summary.translated_generated_output_unavailable_tbs),
      generatedOutputMissingCandidateTbs:
        numberOrZero(summary.translated_generated_output_missing_candidate_tbs),
      generatedFirstUnsupportedOps:
        Array.isArray(summary.translated_generated_first_unsupported_ops)
          ? summary.translated_generated_first_unsupported_ops
          : [],
    },
    failures: {
      compile: sortedNonzeroFields(summary, COMPILE_FAILURE_FIELDS),
      fallback: sortedNonzeroFields(summary, FALLBACK_FIELDS),
      traceReasons: traceReasonCounts(result),
    },
    thresholds: {
      minCoveragePpm,
      minCompiled,
      enabled: hasThresholds,
      passed: !hasThresholds ||
        (coverage.ppm >= minCoveragePpm && generatedCompiled >= minCompiled),
    },
  };
}

function usage() {
  return `Usage: wasm-backend-diagnostic-summary.mjs --result FILE [options]

Options:
  --artifact-dir DIR       Include JS/WASM/manifest SHA-256 hashes
  --out FILE               Write summary JSON to FILE
  --json                   Print summary JSON to stdout
  --min-coverage-ppm N     Optional coverage threshold for local triage
  --min-compiled N         Optional compiled-block threshold for local triage
  -h, --help               Show this help
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    minCoveragePpm: 0,
    minCompiled: 0,
  };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--result") {
      options.result = argv[++index];
    } else if (arg === "--artifact-dir") {
      options.artifactDir = argv[++index];
    } else if (arg === "--out") {
      options.out = argv[++index];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--min-coverage-ppm") {
      options.minCoveragePpm = Number(argv[++index]);
    } else if (arg === "--min-compiled") {
      options.minCompiled = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function printText(summary) {
  const generated = summary.generated;
  const coverage = generated.coverage;
  const thresholds = summary.thresholds;
  const artifacts = summary.artifacts.hashes;

  process.stdout.write(
    `wasm-backend-diagnostic-summary: source=${summary.source.summarySource}` +
    ` browser=${summary.source.browserVersion}` +
    ` elapsed_ms=${summary.source.elapsedMs}` +
    ` marker_seen=${summary.source.markerSeen}\n`,
  );
  process.stdout.write(
    `  generated compiled=${generated.compiled}` +
    ` executed=${generated.executed}` +
    ` cache_hits=${generated.cacheHits}` +
    ` coverage=${coverage.numerator}/${coverage.denominator}` +
    ` (${coverage.ppm} ppm)\n`,
  );
  if (generated.direct.tbEntries > 0) {
    process.stdout.write(
      `  direct tb_entries=${generated.direct.tbEntries}` +
      ` generated_executed=${generated.direct.generatedExecuted}` +
      ` generated_dispatches=${generated.direct.generatedDispatches}` +
      ` tci_fallbacks=${generated.direct.tciFallbacks}\n`,
    );
  }
  if (summary.failures.compile.length > 0) {
    process.stdout.write(
      `  compile_failures=${summary.failures.compile
        .map((entry) => `${entry.field}=${entry.value}`)
        .join(", ")}\n`,
    );
  }
  if (summary.failures.fallback.length > 0) {
    process.stdout.write(
      `  fallback=${summary.failures.fallback
        .map((entry) => `${entry.field}=${entry.value}`)
        .join(", ")}\n`,
    );
  }
  if (summary.translated.generatedFirstUnsupportedOps.length > 0) {
    process.stdout.write(
      `  first_unsupported_ops=${summary.translated.generatedFirstUnsupportedOps
        .slice(0, 8)
        .map((entry) => `${entry.name ?? entry.op}=${entry.count}`)
        .join(", ")}\n`,
    );
  }
  if (summary.failures.traceReasons.length > 0) {
    process.stdout.write(
      `  trace_reasons=${summary.failures.traceReasons
        .slice(0, 8)
        .map((entry) => `${entry.reason}=${entry.count}`)
        .join(", ")}\n`,
    );
  }
  for (const [name, hash] of Object.entries(artifacts)) {
    process.stdout.write(`  sha256 ${name} ${hash}\n`);
  }
  if (thresholds.enabled) {
    process.stdout.write(
      `  thresholds passed=${thresholds.passed}` +
      ` min_coverage_ppm=${thresholds.minCoveragePpm}` +
      ` min_compiled=${thresholds.minCompiled}\n`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.result) {
    throw new Error("--result is required");
  }
  const result = readJson(options.result);
  const summary = diagnosticSummary(result, {
    artifactDir: options.artifactDir,
    resultPath: options.result,
    minCoveragePpm: options.minCoveragePpm,
    minCompiled: options.minCompiled,
  });
  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printText(summary);
  }
  if (summary.thresholds.enabled && !summary.thresholds.passed) {
    process.exitCode = 2;
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`wasm-backend-diagnostic-summary: ${error.message}\n`);
    process.exit(1);
  });
}
