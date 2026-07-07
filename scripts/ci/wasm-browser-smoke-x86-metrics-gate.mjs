#!/usr/bin/env node
/*
 * Validate the x86 browser smoke metrics payload.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

export const X86_BROWSER_SMOKE_METRICS_GATE_VERSION = 4;

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

const RUNLOOP_LIVE_GENERATED_EXEC_SUMMARY_FIELDS = [
  ["event", (value) => value === "live-generated-exec-summary"],
  ["reason", isString],
  ["chain_exit_reason", isString],
  ["compat_fallback", isBoolean],
  ["preflight", isBoolean],
  ["preflight_limit", isPositiveInteger],
  ["chain_budget", isPositiveInteger],
  ["preflight_ready", isBoolean],
  ["no_silent_fallback", isBoolean],
  ["attempts", isPositiveInteger],
  ["successes", isInteger],
  ["rejects", isInteger],
  ["skips", isInteger],
  ["generated_guest_instructions", isInteger],
  ["fallback_guest_instructions", isInteger],
  ["generated_body_time_ns", isInteger],
  ["tci_dispatch_time_ns", isInteger],
  ["tb_lookup_time_ns", isInteger],
  ["helper_call_time_ns", isInteger],
  ["qemu_ld_time_ns", isInteger],
  ["qemu_st_time_ns", isInteger],
  ["compile_time_ns", isInteger],
  ["instantiate_time_ns", isInteger],
  ["generated_run_entries", isInteger],
  ["generated_chain_length", isInteger],
  ["generated_guest_instructions_per_entry", isInteger],
  ["generated_coverage_numerator", isInteger],
  ["generated_coverage_denominator", isInteger],
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
  ["hotset_probe_attempts", isInteger],
  ["hotset_goto_sources", isInteger],
  ["hotset_target_slots_read", isInteger],
  ["hotset_target_slots_unsafe", isInteger],
  ["hotset_target_metadata_hits", isInteger],
  ["hotset_target_output_hits", isInteger],
  ["hotset_target_stale", isInteger],
  ["selected_body_helper_exit_skips", isInteger],
  ["selected_body_no_terminal", isInteger],
  ["reject_reasons", isArray],
];

const RUNLOOP_LIVE_GENERATED_EXEC_REJECT_REASON_FIELDS = [
  ["reason", isString],
  ["count", isInteger],
];

const ONE_TB_DIFFERENTIAL_RESULT_FIELDS = [
  ["name", isString],
  ["ok", isBoolean],
  ["shape", isArray],
  ["generated_tci_op_equivalents", isInteger],
  ["reference_tci_op_equivalents", isInteger],
  ["generated_body_time_ns", isPositiveInteger],
  ["tci_dispatch_time_ns", isPositiveInteger],
  ["compile_time_ns", isPositiveInteger],
  ["instantiate_time_ns", isPositiveInteger],
  ["generated_chain_length", isPositiveInteger],
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
  ["inline_tlb_hit_loads", isInteger],
  ["inline_tlb_hit_stores", isInteger],
  ...ONE_TB_DIFFERENTIAL_RESULT_FIELDS,
];

const LIVE_ONE_TB_DIFFERENTIAL_FIELDS = [
  ["event", (value) => value === "live-one-tb-differential"],
  ["live_shape_fixture", (value) => value !== true],
  ["real_live_state_capture", (value) => value === true],
  ["tb_ptr", isNonEmptyString],
  ["tb_pc", isNonEmptyString],
  ["tb_cs_base", isNonEmptyString],
  ["tb_flags", isInteger],
  ["tb_cflags", isInteger],
  ["tb_size", isPositiveInteger],
  ["tb_icount", isPositiveInteger],
  ["metadata_op_count", isPositiveInteger],
  ["metadata_generated_output_available", isBoolean],
  ["generated_guest_instructions", isPositiveInteger],
  ["reference_guest_instructions", isPositiveInteger],
  ["host_memory_loads", isOptionalPositiveInteger],
  ["host_memory_stores", isOptionalPositiveInteger],
  ["inline_tlb_hit_loads", isOptionalPositiveInteger],
  ["inline_tlb_hit_stores", isOptionalPositiveInteger],
  ...ONE_TB_DIFFERENTIAL_RESULT_FIELDS,
  ["scanned_live_tbs_before_match", isPositiveInteger],
];

const TCG_SUMMARY_FIELDS = [
  ["event", (value) => value === "summary"],
  ["reason", isString],
  ["generated_attempts", isInteger],
  ["generated_compiled", isInteger],
  ["generated_executed", isInteger],
  ["generated_cache_hits", isInteger],
  ["generated_guest_instructions", isInteger],
  ["fallback_guest_instructions", isInteger],
  ["generated_body_time_ns", isInteger],
  ["generated_coverage_numerator", isInteger],
  ["generated_coverage_denominator", isInteger],
  ["generated_coverage_ppm", isInteger],
  ["generated_exits", isObject],
  ["translated_tbs", isInteger],
  ["translated_ops", isInteger],
  ["translated_fallback_markers", isInteger],
  ["translated_metadata_lookups", isInteger],
  ["translated_metadata_hits", isInteger],
  ["translated_metadata_misses", isInteger],
  ["translated_metadata_hit_ppm", isInteger],
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

const DEFAULT_PURPOSE = "qemu-browser-smoke-x86-metrics-gate";
const DEFAULT_COMMAND_NAME = "wasm-browser-smoke-x86-metrics-gate.mjs";

function usage(commandName = DEFAULT_COMMAND_NAME) {
  return `Usage: ${commandName} --result FILE [options]

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

function isOptionalPositiveInteger(value) {
  return value === undefined || isPositiveInteger(value);
}

function isString(value) {
  return typeof value === "string";
}

function isNonEmptyString(value) {
  return isString(value) && value.length > 0;
}

function isBoolean(value) {
  return typeof value === "boolean";
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

function validateScaffoldOneTbDifferentialSummary(summary) {
  const missingFields = collectMissingFields(
    summary,
    ONE_TB_DIFFERENTIAL_SCAFFOLD_FIELDS,
  );
  const generatedTciOpEquivalentsMatch =
    isInteger(summary?.generated_tci_op_equivalents) &&
    isInteger(summary?.reference_tci_op_equivalents) &&
    summary.generated_tci_op_equivalents ===
      summary.reference_tci_op_equivalents;
  const generatedBodyTimePositive =
    isPositiveInteger(summary?.generated_body_time_ns);
  const tciDispatchTimePositive =
    isPositiveInteger(summary?.tci_dispatch_time_ns);
  const compileTimePositive = isPositiveInteger(summary?.compile_time_ns);
  const instantiateTimePositive =
    isPositiveInteger(summary?.instantiate_time_ns);
  const generatedChainLengthPositive =
    isPositiveInteger(summary?.generated_chain_length);
  const inlineTlbHitLoadsValid = isInteger(summary?.inline_tlb_hit_loads);
  const inlineTlbHitStoresValid = isInteger(summary?.inline_tlb_hit_stores);
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

  return {
    ...summary,
    missingFields,
    generated_tci_op_equivalents_matches: generatedTciOpEquivalentsMatch,
    generated_body_time_positive: generatedBodyTimePositive,
    tci_dispatch_time_positive: tciDispatchTimePositive,
    compile_time_positive: compileTimePositive,
    instantiate_time_positive: instantiateTimePositive,
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
    acceptanceAllowed: false,
    ok:
      summary?.ok === true &&
      missingFields.length === 0 &&
      generatedTciOpEquivalentsMatch &&
      generatedBodyTimePositive &&
      tciDispatchTimePositive &&
      compileTimePositive &&
      instantiateTimePositive &&
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
      qemuStCallsZero,
  };
}

function normalizeLiveMemoryCounters(summary) {
  const hostLoads = summary?.host_memory_loads;
  const hostStores = summary?.host_memory_stores;
  const inlineLoads = summary?.inline_tlb_hit_loads;
  const inlineStores = summary?.inline_tlb_hit_stores;
  const hostProvided =
    hostLoads !== undefined || hostStores !== undefined;
  const inlineProvided =
    inlineLoads !== undefined || inlineStores !== undefined;
  const hostValid =
    !hostProvided ||
    (isPositiveInteger(hostLoads) && isPositiveInteger(hostStores));
  const inlineValid =
    !inlineProvided ||
    (isPositiveInteger(inlineLoads) && isPositiveInteger(inlineStores));

  if (hostProvided && hostValid && (!inlineProvided || !inlineValid)) {
    return {
      normalized_memory_loads: hostLoads,
      normalized_memory_stores: hostStores,
      normalized_memory_counter_source: "host_memory",
      memory_counters_match: !inlineProvided,
    };
  }

  if (inlineProvided && inlineValid && (!hostProvided || !hostValid)) {
    return {
      normalized_memory_loads: inlineLoads,
      normalized_memory_stores: inlineStores,
      normalized_memory_counter_source: "inline_tlb_hit",
      memory_counters_match: !hostProvided,
    };
  }

  if (
    hostProvided &&
    hostValid &&
    inlineProvided &&
    inlineValid &&
    hostLoads === inlineLoads &&
    hostStores === inlineStores
  ) {
    return {
      normalized_memory_loads: hostLoads,
      normalized_memory_stores: hostStores,
      normalized_memory_counter_source: "host_memory",
      memory_counters_match: true,
    };
  }

  return {
    normalized_memory_loads: null,
    normalized_memory_stores: null,
    normalized_memory_counter_source: null,
    memory_counters_match: false,
  };
}

function validateLiveOneTbDifferentialSummary(summary) {
  const missingFields = collectMissingFields(
    summary,
    LIVE_ONE_TB_DIFFERENTIAL_FIELDS,
  );
  const memoryCounters = normalizeLiveMemoryCounters(summary);
  const generatedTciOpEquivalentsMatch =
    isInteger(summary?.generated_tci_op_equivalents) &&
    isInteger(summary?.reference_tci_op_equivalents) &&
    summary.generated_tci_op_equivalents ===
      summary.reference_tci_op_equivalents;
  const generatedBodyTimePositive =
    isPositiveInteger(summary?.generated_body_time_ns);
  const tciDispatchTimePositive =
    isPositiveInteger(summary?.tci_dispatch_time_ns);
  const compileTimePositive = isPositiveInteger(summary?.compile_time_ns);
  const instantiateTimePositive =
    isPositiveInteger(summary?.instantiate_time_ns);
  const generatedChainLengthPositive =
    isPositiveInteger(summary?.generated_chain_length);
  const helperCallsZero = summary?.helper_calls === 0;
  const qemuLdCallsZero = summary?.qemu_ld_calls === 0;
  const qemuStCallsZero = summary?.qemu_st_calls === 0;
  const generatedStatusMatches =
    isInteger(summary?.generated_status) &&
    isInteger(summary?.reference_status) &&
    summary.generated_status === summary.reference_status;
  const dispatchStatusMatches =
    generatedStatusMatches && summary.generated_status === summary.dispatch_status;
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
  const liveCaptureMatches = summary?.real_live_state_capture === true;
  const fixtureMarkerMatches = summary?.live_shape_fixture !== true;
  const tbPtrValid = isNonEmptyString(summary?.tb_ptr);
  const tbPcValid = isNonEmptyString(summary?.tb_pc);
  const tbCsBaseValid = isNonEmptyString(summary?.tb_cs_base);
  const tbSizePositive = isPositiveInteger(summary?.tb_size);
  const tbIcountPositive = isPositiveInteger(summary?.tb_icount);
  const metadataOpCountPositive = isPositiveInteger(summary?.metadata_op_count);
  const metadataGeneratedOutputAvailableValid = isBoolean(
    summary?.metadata_generated_output_available,
  );
  const generatedGuestInstructionsPositive = isPositiveInteger(
    summary?.generated_guest_instructions,
  );
  const referenceGuestInstructionsPositive = isPositiveInteger(
    summary?.reference_guest_instructions,
  );
  const scannedLiveTbsBeforeMatchPositive = isPositiveInteger(
    summary?.scanned_live_tbs_before_match,
  );
  const memoryLoadsPositive = isPositiveInteger(
    memoryCounters.normalized_memory_loads,
  );
  const memoryStoresPositive = isPositiveInteger(
    memoryCounters.normalized_memory_stores,
  );

  return {
    ...summary,
    missingFields,
    generated_tci_op_equivalents_matches: generatedTciOpEquivalentsMatch,
    generated_body_time_positive: generatedBodyTimePositive,
    tci_dispatch_time_positive: tciDispatchTimePositive,
    compile_time_positive: compileTimePositive,
    instantiate_time_positive: instantiateTimePositive,
    generated_chain_length_positive: generatedChainLengthPositive,
    helper_calls_zero: helperCallsZero,
    qemu_ld_calls_zero: qemuLdCallsZero,
    qemu_st_calls_zero: qemuStCallsZero,
    generated_status_matches: generatedStatusMatches,
    dispatch_status_matches: dispatchStatusMatches,
    generated_dispatch_target_matches: generatedDispatchTargetMatches,
    generated_regs_checksum_matches: generatedRegsChecksumMatches,
    generated_memory_checksum_matches: generatedMemoryChecksumMatches,
    generated_memory_writes_matches: generatedMemoryWritesMatch,
    live_capture_matches: liveCaptureMatches,
    fixture_marker_matches: fixtureMarkerMatches,
    tb_ptr_valid: tbPtrValid,
    tb_pc_valid: tbPcValid,
    tb_cs_base_valid: tbCsBaseValid,
    tb_size_positive: tbSizePositive,
    tb_icount_positive: tbIcountPositive,
    metadata_op_count_positive: metadataOpCountPositive,
    metadata_generated_output_available_valid:
      metadataGeneratedOutputAvailableValid,
    generated_guest_instructions_positive: generatedGuestInstructionsPositive,
    reference_guest_instructions_positive: referenceGuestInstructionsPositive,
    normalized_memory_loads: memoryCounters.normalized_memory_loads,
    normalized_memory_stores: memoryCounters.normalized_memory_stores,
    normalized_memory_counter_source:
      memoryCounters.normalized_memory_counter_source,
    memory_counters_match: memoryCounters.memory_counters_match &&
      memoryLoadsPositive &&
      memoryStoresPositive,
    scanned_live_tbs_before_match_positive: scannedLiveTbsBeforeMatchPositive,
    acceptanceAllowed: true,
    ok:
      summary?.ok === true &&
      missingFields.length === 0 &&
      generatedTciOpEquivalentsMatch &&
      generatedBodyTimePositive &&
      tciDispatchTimePositive &&
      compileTimePositive &&
      instantiateTimePositive &&
      generatedChainLengthPositive &&
      helperCallsZero &&
      qemuLdCallsZero &&
      qemuStCallsZero &&
      generatedStatusMatches &&
      dispatchStatusMatches &&
      generatedDispatchTargetMatches &&
      generatedRegsChecksumMatches &&
      generatedMemoryChecksumMatches &&
      generatedMemoryWritesMatch &&
      liveCaptureMatches &&
      fixtureMarkerMatches &&
      tbPtrValid &&
      tbPcValid &&
      tbCsBaseValid &&
      tbSizePositive &&
      tbIcountPositive &&
      metadataOpCountPositive &&
      metadataGeneratedOutputAvailableValid &&
      generatedGuestInstructionsPositive &&
      referenceGuestInstructionsPositive &&
      memoryLoadsPositive &&
      memoryStoresPositive &&
      memoryCounters.memory_counters_match &&
      scannedLiveTbsBeforeMatchPositive,
  };
}

function validateLiveGeneratedExecRejectReason(reason, index) {
  return {
    ...reason,
    missingFields: collectMissingFields(
      reason,
      RUNLOOP_LIVE_GENERATED_EXEC_REJECT_REASON_FIELDS,
      `reject_reasons[${index}].`,
    ),
  };
}

function validateLiveGeneratedExecSummary(summary) {
  const missingFields = collectMissingFields(
    summary,
    RUNLOOP_LIVE_GENERATED_EXEC_SUMMARY_FIELDS,
  );
  const rejectReasons = [];
  let rejectReasonTotal = 0;

  if (Array.isArray(summary?.reject_reasons)) {
    for (let index = 0; index < summary.reject_reasons.length; index++) {
      const validated = validateLiveGeneratedExecRejectReason(
        summary.reject_reasons[index],
        index,
      );

      rejectReasons.push(validated);
      if (isInteger(validated.count)) {
        rejectReasonTotal += validated.count;
      }
    }
  }

  return {
    ...summary,
    missingFields,
    reject_reasons: rejectReasons,
    reject_reason_total: rejectReasonTotal,
    reject_reason_total_matches:
      isInteger(summary?.rejects) && rejectReasonTotal === summary.rejects,
    acceptanceAllowed:
      summary?.preflight_ready === true &&
      summary?.generated_guest_instructions > 0,
    ok:
      missingFields.length === 0 &&
      rejectReasons.every((entry) => entry.missingFields.length === 0) &&
      isInteger(summary?.attempts) &&
      isInteger(summary?.successes) &&
      isInteger(summary?.rejects) &&
      summary.attempts === summary.successes + summary.rejects &&
      rejectReasonTotal === summary.rejects,
  };
}

function validateRunloopSummaryByEvent(summary) {
  if (summary?.event === "runtime-smoke") {
    return validateRunloopSummary(summary);
  }
  if (summary?.event === "live-generated-exec-summary") {
    return validateLiveGeneratedExecSummary(summary);
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
    purpose: options.purpose || DEFAULT_PURPOSE,
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
  const label = gate.purpose || DEFAULT_PURPOSE;
  process.stdout.write(
    `${label}: ` +
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
  if (gate.runloop.lastSummary?.normalized_memory_counter_source !== undefined) {
    process.stdout.write(
      `  normalized_memory_counter_source=${gate.runloop.lastSummary.normalized_memory_counter_source} ` +
      `normalized_memory_loads=${gate.runloop.lastSummary.normalized_memory_loads} ` +
      `normalized_memory_stores=${gate.runloop.lastSummary.normalized_memory_stores}\n`,
    );
  }
  if (tcgState !== null) {
    process.stdout.write(
      `  generated_coverage_ppm=${tcgState.lastSummary?.generated_coverage_ppm} ` +
      `computed=${tcgState.lastSummary?.generated_coverage_ppm_computed}\n`,
    );
  }
}

export async function run(argv = process.argv, runOptions = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage(runOptions.commandName));
    return;
  }
  if (!options.result) {
    throw new Error("--result is required");
  }

  const result = JSON.parse(fs.readFileSync(options.result, "utf8"));
  const gate = x86BrowserSmokeMetricsGate(result, {
    ...options,
    purpose: runOptions.purpose,
  });
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
