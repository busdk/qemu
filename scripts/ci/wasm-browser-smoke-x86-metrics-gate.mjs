#!/usr/bin/env node
/*
 * Validate the x86 browser smoke metrics payload.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

export const X86_BROWSER_SMOKE_METRICS_GATE_VERSION = 2;

const RUNLOOP_RUNTIME_SMOKE_FIELDS = [
  ["event", (value) => value === "runtime-smoke"],
  ["ok", (value) => typeof value === "boolean"],
  ["budget", isPositiveInteger],
  ["exit_reason", isString],
  ["exit_reason_code", isInteger],
  ["generated_guest_instructions", isInteger],
  ["fallback_guest_instructions", isInteger],
  ["generated_body_time_ns", isInteger],
  ["tci_dispatch_time_ns", isInteger],
  ["tb_lookup_time_ns", isInteger],
  ["helper_call_time_ns", isInteger],
  ["qemu_ld_time_ns", isInteger],
  ["qemu_st_time_ns", isInteger],
  ["generated_vs_tci_speedup_ppm", isInteger],
  ["min_generated_vs_tci_speedup_ppm", isInteger],
  ["compile_time_ns", isInteger],
  ["instantiate_time_ns", isInteger],
  ["generated_chain_length", isInteger],
  ["inline_tlb_hit_loads", isInteger],
  ["inline_tlb_hit_stores", isInteger],
  ["helper_calls", isInteger],
  ["qemu_ld_calls", isInteger],
  ["qemu_st_calls", isInteger],
  ["exits_budget", isInteger],
  ["exits_mmio", isInteger],
  ["exits_tlb_miss_or_fault", isInteger],
  ["exits_interrupt", isInteger],
  ["exits_helper", isInteger],
  ["exits_unsupported", isInteger],
  ["exits_hlt", isInteger],
  ["exits_invalidated", isInteger],
  ["workload_count", isPositiveInteger],
  ["workloads", isArray],
];

const RUNLOOP_WORKLOAD_FIELDS = [
  ["name", isString],
  ["ok", (value) => typeof value === "boolean"],
  ["generated_guest_instructions", isInteger],
  ["fallback_guest_instructions", isInteger],
  ["generated_body_time_ns", isInteger],
  ["tci_dispatch_time_ns", isInteger],
  ["generated_vs_tci_speedup_ppm", isInteger],
  ["generated_exit_value", isInteger],
  ["fallback_exit_value", isInteger],
  ["generated_ram_value", isInteger],
  ["fallback_ram_value", isInteger],
  ["inline_tlb_hit_loads", isInteger],
  ["inline_tlb_hit_stores", isInteger],
  ["helper_calls", isInteger],
  ["qemu_ld_calls", isInteger],
  ["qemu_st_calls", isInteger],
  ["exits_budget", isInteger],
  ["exits_mmio", isInteger],
  ["exits_tlb_miss_or_fault", isInteger],
  ["exits_interrupt", isInteger],
  ["exits_helper", isInteger],
  ["exits_unsupported", isInteger],
  ["exits_hlt", isInteger],
  ["exits_invalidated", isInteger],
];

const ONE_TB_DIFFERENTIAL_SHARED_FIELDS = [
  ["name", isString],
  ["ok", (value) => typeof value === "boolean"],
  ["shape", isArray],
  ["generated_tci_op_equivalents", isInteger],
  ["reference_tci_op_equivalents", isInteger],
  ["generated_body_time_ns", isInteger],
  ["tci_dispatch_time_ns", isInteger],
  ["compile_time_ns", isInteger],
  ["instantiate_time_ns", isInteger],
  ["generated_chain_length", isInteger],
  ["inline_tlb_hit_loads", isInteger],
  ["inline_tlb_hit_stores", isInteger],
  ["helper_calls", isInteger],
  ["qemu_ld_calls", isInteger],
  ["qemu_st_calls", isInteger],
  ["generated_status", isInteger],
  ["reference_status", isInteger],
  ["dispatch_status", isInteger],
  ["generated_dispatch_target", isInteger],
  ["reference_dispatch_target", isInteger],
  ["exit_reason_code", isInteger],
  ["exit_value", isInteger],
  ["generated_regs_checksum", isInteger],
  ["reference_regs_checksum", isInteger],
  ["generated_memory_checksum", isInteger],
  ["reference_memory_checksum", isInteger],
  ["generated_memory_writes", isInteger],
  ["reference_memory_writes", isInteger],
  ["expected_memory_writes", isInteger],
  ["js_status", isInteger],
];

const ONE_TB_DIFFERENTIAL_SCAFFOLD_FIELDS = [
  ["event", (value) => value === "one-tb-differential"],
  ["live_shape_fixture", (value) => value === true],
  ["real_live_state_capture", (value) => value === false],
  ...ONE_TB_DIFFERENTIAL_SHARED_FIELDS,
];

const LIVE_ONE_TB_DIFFERENTIAL_FIELDS = [
  ["event", (value) => value === "live-one-tb-differential"],
  ["live_shape_fixture", (value) => value !== true],
  ["real_live_state_capture", (value) => value === true],
  ["tb_id", isOptionalInteger],
  ["pc", isOptionalInteger],
  ["generated_guest_instructions", isPositiveInteger],
  ["reference_guest_instructions", isPositiveInteger],
  ...ONE_TB_DIFFERENTIAL_SHARED_FIELDS,
];

const TCG_SUMMARY_FIELDS = [
  ["event", (value) => value === "summary"],
  ["reason", isString],
  ["generated_attempts", isInteger],
  ["generated_compiled", isInteger],
  ["generated_executed", isInteger],
  ["generated_cache_hits", isInteger],
  ["generated_coverage_numerator", isInteger],
  ["generated_coverage_denominator", isInteger],
  ["generated_coverage_ppm", isInteger],
  ["generated_exits", isObject],
  ["translated_tbs", isInteger],
  ["translated_ops", isInteger],
  ["translated_fallback_markers", isInteger],
  ["translated_metadata_misses", isInteger],
  ["translated_profiled_tbs", isInteger],
  ["translated_lowerable_tbs", isInteger],
  ["translated_profile_supported_ops", isInteger],
  ["translated_profile_unsupported_ops", isInteger],
  ["translated_generated_candidate_tbs", isInteger],
  ["translated_generated_supported_ops", isInteger],
  ["translated_generated_unsupported_ops", isInteger],
  ["translated_generated_output_tbs", isInteger],
  ["translated_generated_output_unavailable_tbs", isInteger],
  ["exec_generated_output_lookup_tbs", isInteger],
  ["exec_generated_output_available_tbs", isInteger],
  ["fallback_unsupported", isInteger],
  ["fallback_helper", isInteger],
  ["fallback_qemu_load", isInteger],
  ["fallback_qemu_store", isInteger],
  ["fallback_runtime", isInteger],
  ["translated_generated_first_unsupported_ops", isArray],
];

const TCG_GENERATED_EXITS_FIELDS = [
  ["budget", isInteger],
  ["mmio", isInteger],
  ["tlb_miss", isInteger],
  ["interrupt", isInteger],
  ["csr", isInteger],
  ["invalid", isInteger],
  ["invalidation", isInteger],
  ["unsupported", isInteger],
  ["fatal", isInteger],
];

function usage() {
  return `Usage: wasm-browser-smoke-x86-metrics-gate.mjs --result FILE [options]

Options:
  --require-tcg   Fail when the result does not include a wasm64Tcg summary
  --json          Print JSON only
`;
}

function isInteger(value) {
  return Number.isInteger(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isOptionalInteger(value) {
  return value === undefined || isInteger(value);
}

function isString(value) {
  return typeof value === "string";
}

function isArray(value) {
  return Array.isArray(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(argv) {
  const options = {
    json: false,
    requireTcg: false,
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--result") {
      options.result = argv[++index];
    } else if (arg === "--require-tcg") {
      options.requireTcg = true;
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

function collectMissingFields(object, specs, prefix = "") {
  const missing = [];
  for (const [field, predicate] of specs) {
    if (!predicate(object?.[field])) {
      missing.push(`${prefix}${field}`);
    }
  }
  return missing;
}

function expectedPpm(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }
  return Number((BigInt(numerator) * 1000000n) / BigInt(denominator));
}

function validateRunloopWorkload(workload, index) {
  const missingFields = collectMissingFields(
    workload,
    RUNLOOP_WORKLOAD_FIELDS,
    `workloads[${index}].`,
  );
  const generatedVsTciSpeedupPpmComputed =
    isInteger(workload?.generated_body_time_ns) &&
    isInteger(workload?.tci_dispatch_time_ns)
      ? expectedPpm(
          workload.tci_dispatch_time_ns,
          workload.generated_body_time_ns,
        )
      : null;

  return {
    ...workload,
    missingFields,
    generated_vs_tci_speedup_ppm_computed: generatedVsTciSpeedupPpmComputed,
    generated_vs_tci_speedup_ppm_matches:
      generatedVsTciSpeedupPpmComputed !== null &&
      workload.generated_vs_tci_speedup_ppm ===
        generatedVsTciSpeedupPpmComputed,
  };
}

function validateRunloopSummary(summary) {
  const missingFields = collectMissingFields(summary, RUNLOOP_RUNTIME_SMOKE_FIELDS);
  const workloadSummaries = [];
  let workloadCountMatches = false;
  let generatedVsTciSpeedupPpmComputed = null;
  let generatedVsTciSpeedupPpmMatches = false;

  if (summary?.event === "runtime-smoke") {
    if (Array.isArray(summary.workloads)) {
      for (let index = 0; index < summary.workloads.length; index++) {
        workloadSummaries.push(
          validateRunloopWorkload(summary.workloads[index], index),
        );
      }
      workloadCountMatches =
        summary.workloads.length === summary.workload_count;
    }
    if (
      isInteger(summary.generated_body_time_ns) &&
      isInteger(summary.tci_dispatch_time_ns)
    ) {
      generatedVsTciSpeedupPpmComputed = expectedPpm(
        summary.tci_dispatch_time_ns,
        summary.generated_body_time_ns,
      );
      generatedVsTciSpeedupPpmMatches =
        summary.generated_vs_tci_speedup_ppm ===
        generatedVsTciSpeedupPpmComputed;
    }
  } else {
    missingFields.push("event");
  }

  if (summary?.event === "runtime-smoke" && !Array.isArray(summary.workloads)) {
    missingFields.push("workloads");
  }

  return {
    ...summary,
    missingFields,
    generated_vs_tci_speedup_ppm_computed: generatedVsTciSpeedupPpmComputed,
    generated_vs_tci_speedup_ppm_matches: generatedVsTciSpeedupPpmMatches,
    workload_count_matches: workloadCountMatches,
    workloads: workloadSummaries,
    acceptanceAllowed: true,
    ok:
      summary?.ok === true &&
      missingFields.length === 0 &&
      generatedVsTciSpeedupPpmMatches &&
      (summary?.event !== "runtime-smoke" || workloadCountMatches) &&
      workloadSummaries.every((workload) =>
        workload.missingFields.length === 0 &&
        workload.generated_vs_tci_speedup_ppm_matches,
      ),
  };
}

function validateOneTbDifferentialSummary(summary, fields, options = {}) {
  const missingFields = collectMissingFields(summary, fields);
  const generatedTciOpEquivalentsMatch =
    isInteger(summary?.generated_tci_op_equivalents) &&
    isInteger(summary?.reference_tci_op_equivalents) &&
    summary.generated_tci_op_equivalents ===
      summary.reference_tci_op_equivalents;
  const generatedBodyTimePositive =
    isPositiveInteger(summary?.generated_body_time_ns);
  const tciDispatchTimePositive =
    isPositiveInteger(summary?.tci_dispatch_time_ns);
  const generatedChainLengthPositive =
    isPositiveInteger(summary?.generated_chain_length);
  const inlineTlbHitLoadsValid = options.requireInlineTlbHits
    ? isPositiveInteger(summary?.inline_tlb_hit_loads)
    : isInteger(summary?.inline_tlb_hit_loads);
  const inlineTlbHitStoresValid = options.requireInlineTlbHits
    ? isPositiveInteger(summary?.inline_tlb_hit_stores)
    : isInteger(summary?.inline_tlb_hit_stores);
  const helperCallsZero = summary?.helper_calls === 0;
  const qemuLdCallsZero = summary?.qemu_ld_calls === 0;
  const qemuStCallsZero = summary?.qemu_st_calls === 0;
  const generatedStatusMatches =
    isInteger(summary?.generated_status) &&
    isInteger(summary?.reference_status) &&
    summary.generated_status === summary.reference_status;
  const generatedDispatchTargetMatches =
    isInteger(summary?.generated_dispatch_target) &&
    isInteger(summary?.reference_dispatch_target) &&
    summary.generated_dispatch_target === summary.reference_dispatch_target;
  const generatedRegsChecksumMatches =
    isInteger(summary?.generated_regs_checksum) &&
    isInteger(summary?.reference_regs_checksum) &&
    summary.generated_regs_checksum === summary.reference_regs_checksum;
  const generatedMemoryChecksumMatches =
    isInteger(summary?.generated_memory_checksum) &&
    isInteger(summary?.reference_memory_checksum) &&
    summary.generated_memory_checksum === summary.reference_memory_checksum;
  const generatedMemoryWritesMatch =
    isInteger(summary?.generated_memory_writes) &&
    isInteger(summary?.reference_memory_writes) &&
    isInteger(summary?.expected_memory_writes) &&
    summary.generated_memory_writes === summary.reference_memory_writes &&
    summary.expected_memory_writes === summary.generated_memory_writes;
  const liveCaptureMatches = options.requireLiveCapture
    ? summary?.real_live_state_capture === true
    : summary?.real_live_state_capture === false;
  const fixtureMarkerMatches = options.requireFixtureMarker
    ? summary?.live_shape_fixture === true
    : summary?.live_shape_fixture !== true;
  const generatedGuestInstructionsValid = options.requireGuestInstructions
    ? isPositiveInteger(summary?.generated_guest_instructions)
    : true;
  const referenceGuestInstructionsValid = options.requireGuestInstructions
    ? isPositiveInteger(summary?.reference_guest_instructions)
    : true;
  const tbIdentityValid = options.allowTbIdentity
    ? isOptionalInteger(summary?.tb_id) && isOptionalInteger(summary?.pc)
    : true;

  return {
    ...summary,
    missingFields,
    generated_tci_op_equivalents_matches: generatedTciOpEquivalentsMatch,
    generated_body_time_positive: generatedBodyTimePositive,
    tci_dispatch_time_positive: tciDispatchTimePositive,
    generated_chain_length_positive: generatedChainLengthPositive,
    inline_tlb_hit_loads_valid: inlineTlbHitLoadsValid,
    inline_tlb_hit_stores_valid: inlineTlbHitStoresValid,
    generated_status_matches: generatedStatusMatches,
    generated_dispatch_target_matches: generatedDispatchTargetMatches,
    generated_regs_checksum_matches: generatedRegsChecksumMatches,
    generated_memory_checksum_matches: generatedMemoryChecksumMatches,
    generated_memory_writes_matches: generatedMemoryWritesMatch,
    helper_calls_zero: helperCallsZero,
    qemu_ld_calls_zero: qemuLdCallsZero,
    qemu_st_calls_zero: qemuStCallsZero,
    live_capture_matches: liveCaptureMatches,
    fixture_marker_matches: fixtureMarkerMatches,
    generated_guest_instructions_valid: generatedGuestInstructionsValid,
    reference_guest_instructions_valid: referenceGuestInstructionsValid,
    tb_identity_valid: tbIdentityValid,
    acceptanceAllowed: options.acceptanceAllowed === true,
    ok:
      summary?.ok === true &&
      missingFields.length === 0 &&
      generatedTciOpEquivalentsMatch &&
      generatedBodyTimePositive &&
      tciDispatchTimePositive &&
      generatedChainLengthPositive &&
      inlineTlbHitLoadsValid &&
      inlineTlbHitStoresValid &&
      generatedStatusMatches &&
      generatedDispatchTargetMatches &&
      generatedRegsChecksumMatches &&
      generatedMemoryChecksumMatches &&
      generatedMemoryWritesMatch &&
      helperCallsZero &&
      qemuLdCallsZero &&
      qemuStCallsZero &&
      liveCaptureMatches &&
      fixtureMarkerMatches &&
      generatedGuestInstructionsValid &&
      referenceGuestInstructionsValid &&
      tbIdentityValid,
  };
}

function validateScaffoldOneTbDifferentialSummary(summary) {
  return validateOneTbDifferentialSummary(
    summary,
    ONE_TB_DIFFERENTIAL_SCAFFOLD_FIELDS,
    {
      acceptanceAllowed: false,
      requireFixtureMarker: true,
      requireLiveCapture: false,
      requireGuestInstructions: false,
      requireInlineTlbHits: false,
      allowTbIdentity: false,
    },
  );
}

function validateLiveOneTbDifferentialSummary(summary) {
  return validateOneTbDifferentialSummary(
    summary,
    LIVE_ONE_TB_DIFFERENTIAL_FIELDS,
    {
      acceptanceAllowed: true,
      requireFixtureMarker: false,
      requireLiveCapture: true,
      requireGuestInstructions: true,
      requireInlineTlbHits: true,
      allowTbIdentity: true,
    },
  );
}

function validateRunloopSummaryByEvent(summary) {
  if (summary?.event === "runtime-smoke") {
    return validateRunloopSummary(summary);
  }
  if (summary?.event === "one-tb-differential") {
    return validateScaffoldOneTbDifferentialSummary(summary);
  }
  if (summary?.event === "live-one-tb-differential") {
    return validateLiveOneTbDifferentialSummary(summary);
  }
  return {
    ...summary,
    missingFields: ["event"],
    acceptanceAllowed: false,
    ok: false,
  };
}

function validateTcgGeneratedExits(generatedExits) {
  const missingFields = collectMissingFields(
    generatedExits,
    TCG_GENERATED_EXITS_FIELDS,
    "generated_exits.",
  );
  return {
    ...generatedExits,
    missingFields,
  };
}

function validateTcgSummary(summary) {
  const missingFields = collectMissingFields(summary, TCG_SUMMARY_FIELDS);
  const generatedExits = isObject(summary?.generated_exits)
    ? validateTcgGeneratedExits(summary.generated_exits)
    : null;
  const generatedCoveragePpmComputed =
    isInteger(summary?.generated_coverage_numerator) &&
    isInteger(summary?.generated_coverage_denominator)
      ? expectedPpm(
          summary.generated_coverage_numerator,
          summary.generated_coverage_denominator,
        )
      : null;

  if (generatedExits === null) {
    missingFields.push("generated_exits");
  }

  return {
    ...summary,
    missingFields: generatedExits === null
      ? missingFields
      : missingFields.concat(generatedExits.missingFields),
    generated_coverage_share:
      isInteger(summary?.generated_coverage_numerator) &&
      isInteger(summary?.generated_coverage_denominator) &&
      summary.generated_coverage_denominator !== 0
        ? summary.generated_coverage_numerator /
          summary.generated_coverage_denominator
        : null,
    generated_coverage_ppm_computed: generatedCoveragePpmComputed,
    generated_coverage_ppm_matches:
      generatedCoveragePpmComputed !== null &&
      summary.generated_coverage_ppm === generatedCoveragePpmComputed,
    generated_exits: generatedExits,
    ok:
      missingFields.length === 0 &&
      generatedExits !== null &&
      generatedExits.missingFields.length === 0 &&
      generatedCoveragePpmComputed !== null &&
      summary.generated_coverage_ppm === generatedCoveragePpmComputed,
  };
}

function validateMetricsState(state, validator, label) {
  if (!isObject(state)) {
    return {
      present: false,
      summaryCount: null,
      summariesLength: null,
      lastSummaryMatchesTail: false,
      missingFields: [
        `${label}.summaryCount`,
        `${label}.summaries`,
        `${label}.lastSummary`,
      ],
      lastSummary: null,
      ok: false,
    };
  }

  const missingFields = collectMissingFields(state, [
    ["summaryCount", isPositiveInteger],
    ["summaries", isArray],
    ["lastSummary", isObject],
  ], label ? `${label}.` : "");
  const summaries = Array.isArray(state.summaries) ? state.summaries : [];
  const lastSummary = isObject(state.lastSummary) ? state.lastSummary : null;
  const lastSummaryMatchesTail =
    summaries.length > 0 &&
    lastSummary !== null &&
    JSON.stringify(summaries[summaries.length - 1]) ===
      JSON.stringify(lastSummary);

  if (lastSummary === null && !missingFields.includes(`${label}.lastSummary`)) {
    missingFields.push(`${label}.lastSummary`);
  }

  if (!Array.isArray(state.summaries) && !missingFields.includes(`${label}.summaries`)) {
    missingFields.push(`${label}.summaries`);
  }

  const validatedSummary = lastSummary ? validator(lastSummary) : null;
  const ok =
    missingFields.length === 0 &&
    lastSummaryMatchesTail &&
    validatedSummary !== null &&
    validatedSummary.ok;

  return {
    present: true,
    summaryCount: state.summaryCount,
    summariesLength: summaries.length,
    lastSummaryMatchesTail,
    acceptanceAllowed: validatedSummary ? validatedSummary.acceptanceAllowed === true : false,
    missingFields: validatedSummary
      ? missingFields.concat(validatedSummary.missingFields)
      : missingFields,
    lastSummary: validatedSummary,
    ok,
  };
}

export function x86BrowserSmokeMetricsGate(result, options = {}) {
  const runloop = validateMetricsState(
    result?.wasm64Runloop,
    validateRunloopSummaryByEvent,
    "wasm64Runloop",
  );
  const tcgPresent = isObject(result?.wasm64Tcg);
  const tcg = tcgPresent
    ? validateMetricsState(
        result.wasm64Tcg,
        validateTcgSummary,
        "wasm64Tcg",
      )
    : null;

  const tcgRequired = Boolean(options.requireTcg);
  const tcgOk = tcg === null ? !tcgRequired : tcg.ok;
  const ok = runloop.ok && runloop.acceptanceAllowed !== false && tcgOk;

  return {
    format: 1,
    purpose: "qemu-browser-smoke-x86-metrics-gate",
    version: X86_BROWSER_SMOKE_METRICS_GATE_VERSION,
    ok,
    runloop,
    tcg,
  };
}

function printResult(gate, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
    return;
  }
  const tcgState = gate.tcg;
  process.stdout.write(
    `qemu-browser-smoke-x86-metrics-gate: ` +
    `runloop_ok=${gate.runloop.ok} ` +
    `runloop_event=${gate.runloop.lastSummary?.event || "missing"} ` +
    `runloop_acceptance=${gate.runloop.acceptanceAllowed} ` +
    `runloop_missing=${gate.runloop.missingFields.length} ` +
    `tcg_present=${tcgState !== null} ` +
    `tcg_ok=${tcgState === null ? "n/a" : tcgState.ok} ` +
    `tcg_missing=${tcgState === null ? 0 : tcgState.missingFields.length} ` +
    `ok=${gate.ok}\n`,
  );
  if (gate.runloop.lastSummary?.event === "runtime-smoke") {
    process.stdout.write(
      `  generated_vs_tci_speedup_ppm=${gate.runloop.lastSummary.generated_vs_tci_speedup_ppm} ` +
      `computed=${gate.runloop.lastSummary.generated_vs_tci_speedup_ppm_computed}\n`,
    );
  }
  if (tcgState !== null) {
    process.stdout.write(
      `  generated_coverage_ppm=${tcgState.lastSummary?.generated_coverage_ppm} ` +
      `computed=${tcgState.lastSummary?.generated_coverage_ppm_computed}\n`,
    );
  }
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
  const gate = x86BrowserSmokeMetricsGate(result, options);
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
