#!/usr/bin/env node
/*
 * Validate CDP browser proof evidence fields.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

const SHA256_RE = /^[0-9a-f]{64}$/;
const SERVICE_REQUEST_ID_RE =
  /^gate2-initialize-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function usage() {
  return `Usage: wasm-browser-cdp-proof-gate.mjs --result FILE [options]

Options:
  --require-success         Fail when the proof result did not succeed
  --require-guest-manifest  Fail when inputEvidence.guestManifest is missing
  --require-generated-exec  Fail without nonzero generated-exec coverage
  --require-service-roundtrip initialize
                            Require one attributed initialize exchange
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
    requireServiceRoundtrip: null,
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
    } else if (arg === "--require-service-roundtrip") {
      options.requireServiceRoundtrip = argv[++index];
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

function hasForbiddenServiceEvidence(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasForbiddenServiceEvidence(entry));
  }
  if (!isObject(value)) {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (["body", "payload", "params", "error", "env"].includes(key.toLowerCase()) ||
        hasForbiddenServiceEvidence(entry)) {
      return true;
    }
  }
  return false;
}

function validateServiceRoundtrip(result, requiredOperation) {
  const evidence = result?.serviceRoundtrip;
  const missingFields = [];
  if (requiredOperation === null) {
    return {
      present: isObject(evidence),
      requiredOperation: null,
      ok: true,
      missingFields,
    };
  }
  if (requiredOperation !== "initialize") {
    return {
      present: isObject(evidence),
      requiredOperation,
      ok: false,
      missingFields: ["requireServiceRoundtrip=initialize"],
    };
  }
  if (!isObject(evidence)) {
    return {
      present: false,
      requiredOperation,
      ok: false,
      missingFields: ["serviceRoundtrip"],
    };
  }
  const readiness = evidence.readiness;
  const transport = evidence.transport;
  const response = evidence.response;
  const timing = evidence.timing;
  if (evidence.source !== "qemuWasmServiceBridge.request") {
    missingFields.push("serviceRoundtrip.source");
  }
  if (evidence.operation !== requiredOperation) {
    missingFields.push("serviceRoundtrip.operation");
  }
  if (!isNonEmptyString(evidence.requestId) ||
      evidence.requestId.length > 64 ||
      !SERVICE_REQUEST_ID_RE.test(evidence.requestId)) {
    missingFields.push("serviceRoundtrip.requestId");
  }
  if (!isPositiveInteger(evidence.timeoutMs) || evidence.timeoutMs > 10000) {
    missingFields.push("serviceRoundtrip.timeoutMs<=10000");
  }
  if (!isObject(readiness)) {
    missingFields.push("serviceRoundtrip.readiness");
  } else {
    for (const [field, expected] of [
      ["readyBefore", true],
      ["readyAfter", true],
      ["readySourceBefore", "serial"],
      ["readySourceAfter", "serial"],
      ["moduleAttachedBefore", true],
      ["moduleAttachedAfter", true],
      ["interactiveOnlyBefore", true],
      ["interactiveOnlyAfter", true],
      ["healthRequestedBefore", false],
      ["healthRequestedAfter", false],
    ]) {
      if (readiness[field] !== expected) {
        missingFields.push(`serviceRoundtrip.readiness.${field}`);
      }
    }
  }
  if (!isObject(transport)) {
    missingFields.push("serviceRoundtrip.transport");
  } else {
    for (const field of [
      "pendingBefore",
      "pendingAfter",
      "sentBefore",
      "sentAfter",
      "receivedBefore",
      "receivedAfter",
      "resolvedBefore",
      "resolvedAfter",
      "timedOutBefore",
      "timedOutAfter",
    ]) {
      if (!Number.isInteger(transport[field]) || transport[field] < 0) {
        missingFields.push(`serviceRoundtrip.transport.${field}`);
      }
    }
    if (transport.pendingBefore !== 0) {
      missingFields.push("serviceRoundtrip.transport.pendingBefore=0");
    }
    if (transport.pendingAfter !== 0) {
      missingFields.push("serviceRoundtrip.transport.pendingAfter=0");
    }
    if (transport.sentAfter !== transport.sentBefore + 1) {
      missingFields.push("serviceRoundtrip.transport.sentDelta=1");
    }
    if (transport.receivedAfter !== transport.receivedBefore + 1) {
      missingFields.push("serviceRoundtrip.transport.receivedDelta=1");
    }
    if (transport.resolvedAfter !== transport.resolvedBefore + 1) {
      missingFields.push("serviceRoundtrip.transport.resolvedDelta=1");
    }
    if (transport.timedOutAfter !== transport.timedOutBefore) {
      missingFields.push("serviceRoundtrip.transport.timedOutDelta=0");
    }
    if (transport.lastRequestId !== evidence.requestId) {
      missingFields.push("serviceRoundtrip.transport.lastRequestId");
    }
    if (transport.lastResponseId !== evidence.requestId) {
      missingFields.push("serviceRoundtrip.transport.lastResponseId");
    }
  }
  if (!isObject(response)) {
    missingFields.push("serviceRoundtrip.response");
  } else {
    if (JSON.stringify(Object.keys(response).sort()) !==
        JSON.stringify(["adapter", "app_server", "id", "operation", "status"])) {
      missingFields.push("serviceRoundtrip.response.fields");
    }
    for (const [field, expected] of [
      ["id", evidence.requestId],
      ["operation", "initialize"],
      ["status", "ok"],
      ["adapter", "ready"],
      ["app_server", "initialized"],
    ]) {
      if (response[field] !== expected ||
          !isNonEmptyString(response[field]) ||
          response[field].length > 64) {
        missingFields.push(`serviceRoundtrip.response.${field}`);
      }
    }
  }
  if (evidence.responseProjectionSafe !== true) {
    missingFields.push("serviceRoundtrip.responseProjectionSafe");
  }
  if (evidence.classification !== "success") {
    missingFields.push("serviceRoundtrip.classification=success");
  }
  let elapsedMs = null;
  if (!isObject(timing) ||
      !Number.isFinite(timing.startedAtMs) ||
      timing.startedAtMs < 0 ||
      !Number.isFinite(timing.completedAtMs) ||
      timing.completedAtMs < timing.startedAtMs ||
      !Number.isFinite(timing.elapsedMs) ||
      timing.elapsedMs < 0 ||
      Math.abs(
        timing.elapsedMs - (timing.completedAtMs - timing.startedAtMs),
      ) > 0.001 ||
      timing.elapsedMs > 10000 ||
      timing.elapsedMs > evidence.timeoutMs) {
    missingFields.push("serviceRoundtrip.timing");
  } else {
    elapsedMs = timing.elapsedMs;
  }
  if (hasForbiddenServiceEvidence(evidence)) {
    missingFields.push("serviceRoundtrip.forbiddenFields");
  }
  if (Object.hasOwn(result, "frontend_roundtrip")) {
    missingFields.push("frontend_roundtrip-forbidden");
  }
  return {
    present: true,
    requiredOperation,
    ok: missingFields.length === 0,
    source: evidence.source ?? null,
    operation: evidence.operation ?? null,
    requestId: isNonEmptyString(evidence.requestId) ? evidence.requestId : null,
    timeoutMs: isPositiveInteger(evidence.timeoutMs) ? evidence.timeoutMs : null,
    classification: evidence.classification ?? null,
    response: isObject(response) ? {
      id: response.id ?? null,
      operation: response.operation ?? null,
      status: response.status ?? null,
      adapter: response.adapter ?? null,
      app_server: response.app_server ?? null,
    } : null,
    elapsedMs,
    missingFields,
  };
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

function generatedSummary(result, required) {
  const runloop = result?.wasm64Runloop?.lastSummary;
  if (isObject(runloop) && runloop.event === "live-generated-exec-summary") {
    return {
      source: "wasm64Runloop",
      summary: runloop,
    };
  }
  const tcg = result?.wasm64Tcg?.lastSummary;
  if (!required && isObject(tcg)) {
    return {
      source: "wasm64Tcg",
      summary: tcg,
    };
  }
  return { source: null, summary: null };
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
  const { source, summary } = generatedSummary(result, required);
  const missingFields = [];
  if (summary === null) {
    if (required) {
      missingFields.push(
        "wasm64Runloop.lastSummary.event=live-generated-exec-summary",
      );
    }
    return {
      present: false,
      source: null,
      missingFields,
      ok: !required,
    };
  }
  const generatedRunEntries = summary.generated_run_entries;
  const generatedGuestInstructions = summary.generated_guest_instructions;
  const generatedBodyTimeNs = summary.generated_body_time_ns;
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
  if (required && !isPositiveInteger(generatedGuestInstructions)) {
    missingFields.push(`${source}.lastSummary.generated_guest_instructions`);
  }
  if (required && !isPositiveInteger(generatedBodyTimeNs)) {
    missingFields.push(`${source}.lastSummary.generated_body_time_ns`);
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
    generatedGuestInstructions: Number.isInteger(generatedGuestInstructions)
      ? generatedGuestInstructions
      : null,
    generatedBodyTimeNs: Number.isInteger(generatedBodyTimeNs)
      ? generatedBodyTimeNs
      : null,
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
  const serviceRoundtrip = validateServiceRoundtrip(
    result,
    options.requireServiceRoundtrip ?? null,
  );
  missingFields.push(...serviceRoundtrip.missingFields);
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
    serviceRoundtrip,
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
    `serviceRoundtrip=${gate.serviceRoundtrip.ok} ` +
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
    if (options.requireGeneratedExec && !gate.generatedExec.ok) {
      console.error(
        `generated execution evidence failed: ${gate.generatedExec.missingFields.join("; ")}`,
      );
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
