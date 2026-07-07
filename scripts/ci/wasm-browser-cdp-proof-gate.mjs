#!/usr/bin/env node
/*
 * Validate CDP browser proof evidence fields.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

const SHA256_RE = /^[0-9a-f]{64}$/;

function usage() {
  return `Usage: wasm-browser-cdp-proof-gate.mjs --result FILE [options]

Options:
  --require-success         Fail when the proof result did not succeed
  --require-guest-manifest  Fail when inputEvidence.guestManifest is missing
  --require-generated-exec  Fail without nonzero generated-exec coverage
  --max-elapsed-ms MS       Fail when result elapsedMs exceeds MS
  --json                    Print JSON only
`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function parseArgs(argv) {
  const options = {
    json: false,
    maxElapsedMs: null,
    requireGeneratedExec: false,
    requireGuestManifest: false,
    requireSuccess: false,
    result: null,
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--result") {
      options.result = argv[++index];
    } else if (arg === "--require-generated-exec") {
      options.requireGeneratedExec = true;
    } else if (arg === "--require-guest-manifest") {
      options.requireGuestManifest = true;
    } else if (arg === "--require-success") {
      options.requireSuccess = true;
    } else if (arg === "--max-elapsed-ms") {
      options.maxElapsedMs = Number(argv[++index]);
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

function validateFileEvidence(inputEvidence, role, required) {
  const entry = inputEvidence?.[role] ?? null;
  const missingFields = [];
  if (entry === null) {
    if (required) {
      missingFields.push(`inputEvidence.${role}`);
    }
    return {
      present: false,
      role,
      missingFields,
      ok: !required,
    };
  }
  if (!isObject(entry)) {
    return {
      present: true,
      role,
      missingFields: [`inputEvidence.${role}`],
      ok: false,
    };
  }
  if (entry.role !== role) {
    missingFields.push(`inputEvidence.${role}.role`);
  }
  if (!isNonEmptyString(entry.path)) {
    missingFields.push(`inputEvidence.${role}.path`);
  }
  if (!isPositiveInteger(entry.bytes)) {
    missingFields.push(`inputEvidence.${role}.bytes`);
  }
  if (!isNonEmptyString(entry.sha256) || !SHA256_RE.test(entry.sha256)) {
    missingFields.push(`inputEvidence.${role}.sha256`);
  }
  return {
    present: true,
    role,
    missingFields,
    ok: missingFields.length === 0,
    bytes: entry.bytes,
    sha256: entry.sha256,
  };
}

function generatedSummary(result) {
  const runloop = result?.wasm64Runloop?.lastSummary;
  if (isObject(runloop) && runloop.event === "live-generated-exec-summary") {
    return {
      source: "wasm64Runloop",
      summary: runloop,
    };
  }
  const tcg = result?.wasm64Tcg?.lastSummary;
  if (isObject(tcg)) {
    return {
      source: "wasm64Tcg",
      summary: tcg,
    };
  }
  return {
    source: null,
    summary: null,
  };
}

// The wasm64Tcg "summary" event reports generated_coverage_ppm directly, but
// the wasm64Runloop "live-generated-exec-summary" event (tcg/wasm64.c
// tcg_wasm64_report_live_generated_exec_summary) never emits that field, only
// the numerator/denominator. Requiring the literal field rejected real
// nonzero generated-exec evidence from that event; derive it instead,
// matching the same numerator*1e6/denominator integer math the "summary"
// event uses (tcg_wasm64_report_summary).
function computeCoveragePpm(numerator, denominator) {
  if (!isPositiveInteger(numerator) || !isPositiveInteger(denominator)) {
    return null;
  }
  return Number((BigInt(numerator) * 1000000n) / BigInt(denominator));
}

function validateGeneratedExec(result, required) {
  const { source, summary } = generatedSummary(result);
  const missingFields = [];
  if (summary === null) {
    if (required) {
      missingFields.push("wasm64Runloop.lastSummary|wasm64Tcg.lastSummary");
    }
    return {
      present: false,
      source: null,
      missingFields,
      ok: !required,
    };
  }
  const generatedRunEntries = summary.generated_run_entries;
  const generatedCoverageNumerator = summary.generated_coverage_numerator;
  const generatedCoverageDenominator = summary.generated_coverage_denominator;
  const generatedCoveragePpmComputed = computeCoveragePpm(
    generatedCoverageNumerator,
    generatedCoverageDenominator,
  );
  const generatedCoveragePpm = Number.isInteger(summary.generated_coverage_ppm)
    ? summary.generated_coverage_ppm
    : generatedCoveragePpmComputed;

  if (!isPositiveInteger(generatedRunEntries)) {
    missingFields.push(`${source}.lastSummary.generated_run_entries`);
  }
  if (!isPositiveInteger(generatedCoverageNumerator)) {
    missingFields.push(`${source}.lastSummary.generated_coverage_numerator`);
  }
  if (!isPositiveInteger(generatedCoverageDenominator)) {
    missingFields.push(`${source}.lastSummary.generated_coverage_denominator`);
  }
  if (!Number.isInteger(generatedCoveragePpm) || generatedCoveragePpm <= 0) {
    missingFields.push(`${source}.lastSummary.generated_coverage_ppm`);
  }
  return {
    present: true,
    source,
    event: summary.event || null,
    generatedRunEntries: Number.isInteger(generatedRunEntries) ? generatedRunEntries : null,
    generatedCoverageNumerator: Number.isInteger(generatedCoverageNumerator)
      ? generatedCoverageNumerator
      : null,
    generatedCoverageDenominator: Number.isInteger(generatedCoverageDenominator)
      ? generatedCoverageDenominator
      : null,
    generatedCoveragePpm: Number.isInteger(generatedCoveragePpm)
      ? generatedCoveragePpm
      : null,
    generatedCoveragePpmReported: Number.isInteger(summary.generated_coverage_ppm),
    missingFields,
    ok: missingFields.length === 0,
  };
}

export function cdpProofEvidenceGate(result, options = {}) {
  const missingFields = [];
  const browserVersion = result?.browserVersion;
  if (!isObject(browserVersion)) {
    missingFields.push("browserVersion");
  } else if (!isNonEmptyString(browserVersion.browser)) {
    missingFields.push("browserVersion.browser");
  }

  const inputEvidence = result?.inputEvidence;
  if (!isObject(inputEvidence)) {
    missingFields.push("inputEvidence");
  }

  const files = {
    program: validateFileEvidence(inputEvidence, "program", true),
    wasm: validateFileEvidence(inputEvidence, "wasm", true),
    kernel: validateFileEvidence(inputEvidence, "kernel", true),
    initrd: validateFileEvidence(inputEvidence, "initrd", false),
    rootfs: validateFileEvidence(inputEvidence, "rootfs", false),
    guestManifest: validateFileEvidence(
      inputEvidence,
      "guestManifest",
      Boolean(options.requireGuestManifest),
    ),
  };
  for (const file of Object.values(files)) {
    missingFields.push(...file.missingFields);
  }
  const hasGuestDisk = files.initrd.present || files.rootfs.present;
  if (!hasGuestDisk) {
    missingFields.push("inputEvidence.initrd|rootfs");
  }
  if (options.requireSuccess && result?.success !== true) {
    missingFields.push("success");
  }
  const generatedExec = validateGeneratedExec(
    result,
    Boolean(options.requireGeneratedExec),
  );
  missingFields.push(...generatedExec.missingFields);
  const elapsedMs = Number.isInteger(result?.elapsedMs) ? result.elapsedMs : null;
  const maxElapsedMs = options.maxElapsedMs ?? null;
  let elapsedOk = elapsedMs !== null;
  if (elapsedMs === null) {
    missingFields.push("elapsedMs");
  }
  if (maxElapsedMs !== null) {
    if (!isPositiveInteger(maxElapsedMs)) {
      missingFields.push("maxElapsedMs");
    } else if (elapsedMs === null || elapsedMs > maxElapsedMs) {
      elapsedOk = false;
      missingFields.push("elapsedMs<=maxElapsedMs");
    }
  }

  const ok = missingFields.length === 0;
  return {
    format: 1,
    purpose: "qemu-browser-cdp-proof-gate",
    ok,
    success: result?.success === true,
    markerSeen: result?.markerSeen === true,
    elapsedMs,
    elapsedOk,
    maxElapsedMs: isPositiveInteger(maxElapsedMs)
      ? maxElapsedMs
      : null,
    browserVersion: browserVersion?.browser || null,
    inputEvidencePresent: isObject(inputEvidence),
    files,
    generatedExec,
    missingFields,
    pageErrorCount: Array.isArray(result?.pageErrors) ? result.pageErrors.length : null,
    resourceErrorCount: Array.isArray(result?.resourceErrors)
      ? result.resourceErrors.length
      : null,
  };
}

function printResult(gate, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `qemu-browser-cdp-proof-gate: ok=${gate.ok} ` +
    `success=${gate.success} markerSeen=${gate.markerSeen} ` +
    `elapsedMs=${gate.elapsedMs ?? "missing"} ` +
    `generatedExec=${gate.generatedExec.ok} ` +
    `browser=${gate.browserVersion || "missing"} ` +
    `missing=${gate.missingFields.length} ` +
    `resourceErrors=${gate.resourceErrorCount ?? "n/a"}\n`,
  );
}

export async function run(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.result) {
    throw new Error("--result is required");
  }
  const result = JSON.parse(fs.readFileSync(options.result, "utf8"));
  const gate = cdpProofEvidenceGate(result, options);
  printResult(gate, options.json);
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
