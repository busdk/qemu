#!/usr/bin/env node
/*
 * Run a short QEMU WebAssembly browser diagnostic and summarize backend
 * generated-block coverage.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  diagnosticSummary,
} from "./wasm-backend-diagnostic-summary.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MARKER = "QEMU_WASM_LINUX_BOOT_OK";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_OUTPUT_BYTES = 80000;
const DEFAULT_PAGE_TEXT_TAIL_BYTES = 40000;
const DEFAULT_GENERATED_TRACE_LIMIT = 1024;
const DEFAULT_FW_CFG_TRACE_LIMIT = 256;

function usage() {
  return `Usage: wasm-backend-diagnostic-runner.mjs --artifact-dir DIR --guest-manifest FILE --out-dir DIR [options]

Runs wasm-browser-smoke-runner.mjs with generated-Wasm trace diagnostics,
then writes wasm-backend-diagnostic-summary.json from the smoke result.
The default mode accepts a smoke timeout as useful diagnostic evidence when
the runner writes a result JSON. Use --require-smoke-success for gate runs.

Options:
  --artifact-dir DIR          Directory containing qemu-system-*.js/.wasm
  --guest-manifest FILE       Guest manifest passed to the smoke runner
  --out-dir DIR               Directory for result and summary JSON
  --result FILE               Smoke result JSON path
  --summary FILE              Diagnostic summary JSON path
  --marker TEXT               Success marker (default: ${DEFAULT_MARKER})
  --timeout-ms MS             Smoke timeout (default: ${DEFAULT_TIMEOUT_MS})
  --port PORT                 Local smoke server port
  --max-output-bytes N        Browser output byte limit
  --page-text-tail-bytes N    Result text tail byte limit
  --generated-trace-limit N   Generated-Wasm trace entry limit
  --fw-cfg-trace-limit N      fw_cfg trace entry limit
  --min-coverage-ppm N        Optional generated coverage threshold
  --min-compiled N            Optional compiled-block threshold
  --smoke-arg ARG             Extra argument appended to smoke runner;
                              repeat for multiple arguments
  --require-smoke-success     Return smoke failure after writing summary
  --json                      Print summary JSON
  --dry-run                   Print the smoke command without running it
  -h, --help                  Show this help
`;
}

function numericOption(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a number`);
  }
  return number;
}

export function parseArgs(argv) {
  const options = {
    artifactDir: null,
    dryRun: false,
    fwCfgTraceLimit: DEFAULT_FW_CFG_TRACE_LIMIT,
    generatedTraceLimit: DEFAULT_GENERATED_TRACE_LIMIT,
    guestManifest: null,
    help: false,
    json: false,
    marker: DEFAULT_MARKER,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    minCompiled: 0,
    minCoveragePpm: 0,
    outDir: null,
    pageTextTailBytes: DEFAULT_PAGE_TEXT_TAIL_BYTES,
    port: null,
    requireSmokeSuccess: false,
    result: null,
    smokeArgs: [],
    summary: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--artifact-dir") {
      options.artifactDir = argv[++index];
    } else if (arg === "--guest-manifest") {
      options.guestManifest = argv[++index];
    } else if (arg === "--out-dir") {
      options.outDir = argv[++index];
    } else if (arg === "--result") {
      options.result = argv[++index];
    } else if (arg === "--summary") {
      options.summary = argv[++index];
    } else if (arg === "--marker") {
      options.marker = argv[++index];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = numericOption(arg, argv[++index]);
    } else if (arg === "--port") {
      options.port = numericOption(arg, argv[++index]);
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = numericOption(arg, argv[++index]);
    } else if (arg === "--page-text-tail-bytes") {
      options.pageTextTailBytes = numericOption(arg, argv[++index]);
    } else if (arg === "--generated-trace-limit") {
      options.generatedTraceLimit = numericOption(arg, argv[++index]);
    } else if (arg === "--fw-cfg-trace-limit") {
      options.fwCfgTraceLimit = numericOption(arg, argv[++index]);
    } else if (arg === "--min-coverage-ppm") {
      options.minCoveragePpm = numericOption(arg, argv[++index]);
    } else if (arg === "--min-compiled") {
      options.minCompiled = numericOption(arg, argv[++index]);
    } else if (arg === "--smoke-arg") {
      options.smokeArgs.push(argv[++index]);
    } else if (arg === "--require-smoke-success") {
      options.requireSmokeSuccess = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function resolvedPath(file) {
  return path.resolve(file);
}

export function normalizeOptions(options) {
  if (options.help) {
    return options;
  }
  if (!options.artifactDir) {
    throw new Error("--artifact-dir is required");
  }
  if (!options.guestManifest) {
    throw new Error("--guest-manifest is required");
  }
  if (!options.outDir && (!options.result || !options.summary)) {
    throw new Error("--out-dir is required unless --result and --summary are both set");
  }

  const outDir = options.outDir ? resolvedPath(options.outDir) : null;
  return {
    ...options,
    artifactDir: resolvedPath(options.artifactDir),
    guestManifest: resolvedPath(options.guestManifest),
    outDir,
    result: resolvedPath(options.result ?? path.join(outDir, "wasm-browser-smoke-result.json")),
    summary: resolvedPath(options.summary ?? path.join(outDir, "wasm-backend-diagnostic-summary.json")),
  };
}

export function buildSmokeArgs(options) {
  const args = [
    path.join(THIS_DIR, "wasm-browser-smoke-runner.mjs"),
    "--artifact-dir",
    options.artifactDir,
    "--guest-manifest",
    options.guestManifest,
    "--timeout-ms",
    String(options.timeoutMs),
    "--marker",
    options.marker,
    "--out",
    options.result,
    "--max-output-bytes",
    String(options.maxOutputBytes),
    "--page-text-tail-bytes",
    String(options.pageTextTailBytes),
    "--tci-wasm-subset",
    "--tci-wasm-generated-trace",
    "--tci-wasm-generated-trace-limit",
    String(options.generatedTraceLimit),
    "--fw-cfg-trace",
    "--fw-cfg-trace-limit",
    String(options.fwCfgTraceLimit),
  ];

  if (options.port !== null) {
    args.push("--port", String(options.port));
  }

  args.push(...options.smokeArgs);
  return args;
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve({
        status: status ?? 1,
        signal,
      });
    });
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeSummary(options) {
  const result = readJson(options.result);
  const summary = diagnosticSummary(result, {
    artifactDir: options.artifactDir,
    resultPath: options.result,
    minCoveragePpm: options.minCoveragePpm,
    minCompiled: options.minCompiled,
  });
  fs.mkdirSync(path.dirname(options.summary), { recursive: true });
  fs.writeFileSync(options.summary, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function printSummary(options, summary, smokeExit) {
  const generated = summary.generated;
  const coverage = generated.coverage;

  process.stdout.write(
    `wasm-backend-diagnostic-runner: smoke_status=${smokeExit.status}` +
    ` result=${options.result} summary=${options.summary}\n`,
  );
  process.stdout.write(
    `  browser=${summary.source.browserVersion}` +
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
  for (const [name, hash] of Object.entries(summary.artifacts.hashes)) {
    process.stdout.write(`  sha256 ${name} ${hash}\n`);
  }
  if (summary.thresholds.enabled) {
    process.stdout.write(
      `  thresholds passed=${summary.thresholds.passed}` +
      ` min_coverage_ppm=${summary.thresholds.minCoveragePpm}` +
      ` min_compiled=${summary.thresholds.minCompiled}\n`,
    );
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

async function main() {
  let options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  options = normalizeOptions(options);
  fs.mkdirSync(path.dirname(options.result), { recursive: true });

  const smokeArgs = buildSmokeArgs(options);
  if (options.dryRun) {
    process.stdout.write(`${process.execPath} ${smokeArgs.map(JSON.stringify).join(" ")}\n`);
    return;
  }

  const smokeExit = await runNode(smokeArgs);
  if (!fs.existsSync(options.result)) {
    throw new Error(`smoke runner did not write result JSON: ${options.result}`);
  }

  const summary = writeSummary(options);
  printSummary(options, summary, smokeExit);

  if (summary.thresholds.enabled && !summary.thresholds.passed) {
    process.exitCode = 2;
  } else if (options.requireSmokeSuccess && smokeExit.status !== 0) {
    process.exitCode = smokeExit.status;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`wasm-backend-diagnostic-runner: ${error.message}\n`);
    process.exit(1);
  });
}
