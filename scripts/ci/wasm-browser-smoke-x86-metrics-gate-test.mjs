#!/usr/bin/env node
/*
 * Test the browser smoke x86 metrics gate helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  X86_BROWSER_SMOKE_METRICS_GATE_VERSION,
  x86BrowserSmokeMetricsGate,
} from "./wasm-browser-smoke-x86-metrics-gate.mjs";

const runtimeSmokeResult = {
  wasm64Runloop: {
    summaryCount: 1,
    summaries: [
      {
        event: "runtime-smoke",
        ok: true,
        budget: 1000000,
        exit_reason: "budget",
        exit_reason_code: 1,
        generated_guest_instructions: 8000000,
        fallback_guest_instructions: 8000000,
        generated_body_time_ns: 3000000,
        tci_dispatch_time_ns: 15000000,
        tb_lookup_time_ns: 250000,
        helper_call_time_ns: 0,
        qemu_ld_time_ns: 0,
        qemu_st_time_ns: 0,
        generated_vs_tci_speedup_ppm: 5000000,
        min_generated_vs_tci_speedup_ppm: 3000000,
        compile_time_ns: 100,
        instantiate_time_ns: 200,
        generated_chain_length: 2000000,
        inline_tlb_hit_loads: 1000000,
        inline_tlb_hit_stores: 1000000,
        helper_calls: 0,
        qemu_ld_calls: 0,
        qemu_st_calls: 0,
        exits_budget: 2,
        exits_mmio: 0,
        exits_tlb_miss_or_fault: 0,
        exits_interrupt: 0,
        exits_helper: 0,
        exits_unsupported: 0,
        exits_hlt: 0,
        exits_invalidated: 0,
        workload_count: 2,
        workloads: [
          {
            name: "alu-branch",
            ok: true,
            generated_guest_instructions: 4000000,
            fallback_guest_instructions: 4000000,
            generated_body_time_ns: 1000000,
            tci_dispatch_time_ns: 5000000,
            generated_vs_tci_speedup_ppm: 5000000,
            generated_exit_value: 1,
            fallback_exit_value: 1,
            generated_ram_value: 0,
            fallback_ram_value: 0,
            inline_tlb_hit_loads: 0,
            inline_tlb_hit_stores: 0,
            helper_calls: 0,
            qemu_ld_calls: 0,
            qemu_st_calls: 0,
            exits_budget: 1,
            exits_mmio: 0,
            exits_tlb_miss_or_fault: 0,
            exits_interrupt: 0,
            exits_helper: 0,
            exits_unsupported: 0,
            exits_hlt: 0,
            exits_invalidated: 0,
          },
          {
            name: "tlb-hit-ram",
            ok: true,
            generated_guest_instructions: 4000000,
            fallback_guest_instructions: 4000000,
            generated_body_time_ns: 2000000,
            tci_dispatch_time_ns: 10000000,
            generated_vs_tci_speedup_ppm: 5000000,
            generated_exit_value: 3,
            fallback_exit_value: 3,
            generated_ram_value: 3,
            fallback_ram_value: 3,
            inline_tlb_hit_loads: 1000000,
            inline_tlb_hit_stores: 1000000,
            helper_calls: 0,
            qemu_ld_calls: 0,
            qemu_st_calls: 0,
            exits_budget: 1,
            exits_mmio: 0,
            exits_tlb_miss_or_fault: 0,
            exits_interrupt: 0,
            exits_helper: 0,
            exits_unsupported: 0,
            exits_hlt: 0,
            exits_invalidated: 0,
          },
        ],
      },
    ],
    lastSummary: {
      event: "runtime-smoke",
      ok: true,
      budget: 1000000,
      exit_reason: "budget",
      exit_reason_code: 1,
      generated_guest_instructions: 8000000,
      fallback_guest_instructions: 8000000,
      generated_body_time_ns: 3000000,
      tci_dispatch_time_ns: 15000000,
      tb_lookup_time_ns: 250000,
      helper_call_time_ns: 0,
      qemu_ld_time_ns: 0,
      qemu_st_time_ns: 0,
      generated_vs_tci_speedup_ppm: 5000000,
      min_generated_vs_tci_speedup_ppm: 3000000,
      compile_time_ns: 100,
      instantiate_time_ns: 200,
      generated_chain_length: 2000000,
      inline_tlb_hit_loads: 1000000,
      inline_tlb_hit_stores: 1000000,
      helper_calls: 0,
      qemu_ld_calls: 0,
      qemu_st_calls: 0,
      exits_budget: 2,
      exits_mmio: 0,
      exits_tlb_miss_or_fault: 0,
      exits_interrupt: 0,
      exits_helper: 0,
      exits_unsupported: 0,
      exits_hlt: 0,
      exits_invalidated: 0,
      workload_count: 2,
      workloads: [
        {
          name: "alu-branch",
          ok: true,
          generated_guest_instructions: 4000000,
          fallback_guest_instructions: 4000000,
          generated_body_time_ns: 1000000,
          tci_dispatch_time_ns: 5000000,
          generated_vs_tci_speedup_ppm: 5000000,
          generated_exit_value: 1,
          fallback_exit_value: 1,
          generated_ram_value: 0,
          fallback_ram_value: 0,
          inline_tlb_hit_loads: 0,
          inline_tlb_hit_stores: 0,
          helper_calls: 0,
          qemu_ld_calls: 0,
          qemu_st_calls: 0,
          exits_budget: 1,
          exits_mmio: 0,
          exits_tlb_miss_or_fault: 0,
          exits_interrupt: 0,
          exits_helper: 0,
          exits_unsupported: 0,
          exits_hlt: 0,
          exits_invalidated: 0,
        },
        {
          name: "tlb-hit-ram",
          ok: true,
          generated_guest_instructions: 4000000,
          fallback_guest_instructions: 4000000,
          generated_body_time_ns: 2000000,
          tci_dispatch_time_ns: 10000000,
          generated_vs_tci_speedup_ppm: 5000000,
          generated_exit_value: 3,
          fallback_exit_value: 3,
          generated_ram_value: 3,
          fallback_ram_value: 3,
          inline_tlb_hit_loads: 1000000,
          inline_tlb_hit_stores: 1000000,
          helper_calls: 0,
          qemu_ld_calls: 0,
          qemu_st_calls: 0,
          exits_budget: 1,
          exits_mmio: 0,
          exits_tlb_miss_or_fault: 0,
          exits_interrupt: 0,
          exits_helper: 0,
          exits_unsupported: 0,
          exits_hlt: 0,
          exits_invalidated: 0,
        },
      ],
    },
  },
  wasm64Tcg: {
    summaryCount: 1,
    summaries: [
      {
        event: "summary",
        reason: "interval",
        generated_attempts: 100,
        generated_compiled: 3,
        generated_executed: 12,
        generated_cache_hits: 9,
        generated_guest_instructions: 1440,
        fallback_guest_instructions: 720,
        generated_body_time_ns: 123456,
        generated_coverage_numerator: 21,
        generated_coverage_denominator: 1000,
        generated_coverage_ppm: 21000,
        generated_exits: {
          budget: 5,
          mmio: 1,
          tlb_miss: 2,
          interrupt: 3,
          csr: 4,
          invalid: 0,
          invalidation: 0,
          unsupported: 6,
          fatal: 0,
        },
        translated_tbs: 8,
        translated_ops: 144,
        translated_fallback_markers: 8,
        translated_metadata_lookups: 10,
        translated_metadata_hits: 9,
        translated_metadata_misses: 1,
        translated_metadata_hit_ppm: 900000,
        translated_profiled_tbs: 7,
        translated_lowerable_tbs: 6,
        translated_profile_supported_ops: 5,
        translated_profile_unsupported_ops: 2,
        translated_generated_candidate_tbs: 4,
        translated_generated_supported_ops: 3,
        translated_generated_unsupported_ops: 1,
        translated_generated_output_tbs: 2,
        translated_generated_output_unavailable_tbs: 1,
        exec_generated_output_lookup_tbs: 2,
        exec_generated_output_available_tbs: 1,
        fallback_unsupported: 88,
        fallback_helper: 1,
        fallback_qemu_load: 2,
        fallback_qemu_store: 3,
        fallback_runtime: 1,
        translated_generated_first_unsupported_ops: [
          { op: 1, name: "ld32u", count: 5 },
        ],
      },
    ],
    lastSummary: {
      event: "summary",
      reason: "interval",
      generated_attempts: 100,
      generated_compiled: 3,
      generated_executed: 12,
      generated_cache_hits: 9,
      generated_guest_instructions: 1440,
      fallback_guest_instructions: 720,
      generated_body_time_ns: 123456,
      generated_coverage_numerator: 21,
      generated_coverage_denominator: 1000,
      generated_coverage_ppm: 21000,
      generated_exits: {
        budget: 5,
        mmio: 1,
        tlb_miss: 2,
        interrupt: 3,
        csr: 4,
        invalid: 0,
        invalidation: 0,
        unsupported: 6,
        fatal: 0,
      },
      translated_tbs: 8,
      translated_ops: 144,
      translated_fallback_markers: 8,
      translated_metadata_lookups: 10,
      translated_metadata_hits: 9,
      translated_metadata_misses: 1,
      translated_metadata_hit_ppm: 900000,
      translated_profiled_tbs: 7,
      translated_lowerable_tbs: 6,
      translated_profile_supported_ops: 5,
      translated_profile_unsupported_ops: 2,
      translated_generated_candidate_tbs: 4,
      translated_generated_supported_ops: 3,
      translated_generated_unsupported_ops: 1,
      translated_generated_output_tbs: 2,
      translated_generated_output_unavailable_tbs: 1,
      exec_generated_output_lookup_tbs: 2,
      exec_generated_output_available_tbs: 1,
      fallback_unsupported: 88,
      fallback_helper: 1,
      fallback_qemu_load: 2,
      fallback_qemu_store: 3,
      fallback_runtime: 1,
      translated_generated_first_unsupported_ops: [
        { op: 1, name: "ld32u", count: 5 },
      ],
    },
  },
};

const liveGeneratedExecSummaryZeroResult = {
  wasm64Runloop: {
    summaryCount: 1,
    summaries: [
      {
        event: "live-generated-exec-summary",
        reason: "preflight-zero-generated-exec",
        chain_exit_reason: "none",
        compat_fallback: true,
        preflight: true,
        preflight_limit: 10000,
        chain_budget: 64,
        preflight_ready: false,
        no_silent_fallback: false,
        attempts: 10000,
        successes: 0,
        rejects: 10000,
        skips: 0,
        generated_guest_instructions: 0,
        fallback_guest_instructions: 0,
        generated_body_time_ns: 0,
        tci_dispatch_time_ns: 0,
        tb_lookup_time_ns: 0,
        helper_call_time_ns: 0,
        qemu_ld_time_ns: 0,
        qemu_st_time_ns: 0,
        compile_time_ns: 0,
        instantiate_time_ns: 0,
        generated_run_entries: 0,
        generated_chain_length: 0,
        generated_guest_instructions_per_entry: 0,
        generated_coverage_numerator: 0,
        generated_coverage_denominator: 10000,
        inline_tlb_hit_loads: 0,
        inline_tlb_hit_stores: 0,
        helper_calls: 0,
        qemu_ld_calls: 0,
        qemu_st_calls: 0,
        exits_budget: 0,
        exits_mmio: 0,
        exits_tlb_miss_or_fault: 0,
        exits_interrupt: 0,
        exits_helper: 0,
        exits_unsupported: 0,
        exits_hlt: 0,
        exits_invalidated: 0,
        hotset_probe_attempts: 10000,
        hotset_goto_sources: 0,
        hotset_target_slots_read: 0,
        hotset_target_slots_unsafe: 0,
        hotset_target_metadata_hits: 0,
        hotset_target_output_hits: 0,
        hotset_target_stale: 0,
        selected_body_helper_exit_skips: 0,
        selected_body_no_terminal: 0,
        reject_reasons: [
          { reason: "metadata-missing", count: 2 },
          { reason: "generated-output-unavailable", count: 3 },
          { reason: "selected-body-shape-unsupported", count: 9995 },
          { reason: "tb-identity-missing-or-stale", count: 0 },
          { reason: "generated-exec-rejected", count: 0 },
        ],
      },
    ],
    lastSummary: null,
  },
};
liveGeneratedExecSummaryZeroResult.wasm64Runloop.lastSummary =
  liveGeneratedExecSummaryZeroResult.wasm64Runloop.summaries[0];

const tcgOnlyResult = JSON.parse(JSON.stringify(runtimeSmokeResult));
delete tcgOnlyResult.wasm64Runloop;

const liveGeneratedExecSummaryReadyResult = JSON.parse(
  JSON.stringify(liveGeneratedExecSummaryZeroResult),
);
{
  const summary = liveGeneratedExecSummaryReadyResult.wasm64Runloop.summaries[0];

  summary.reason = "chain-target-unsupported";
  summary.chain_exit_reason = "chain-target-unsupported";
  summary.compat_fallback = false;
  summary.preflight_ready = true;
  summary.attempts = 1;
  summary.successes = 1;
  summary.rejects = 0;
  summary.generated_guest_instructions = 1;
  summary.generated_body_time_ns = 1000;
  summary.compile_time_ns = 100;
  summary.instantiate_time_ns = 200;
  summary.generated_run_entries = 1;
  summary.generated_chain_length = 1;
  summary.generated_guest_instructions_per_entry = 1;
  summary.generated_coverage_numerator = 1;
  summary.generated_coverage_denominator = 1;
  summary.hotset_probe_attempts = 1;
  summary.hotset_goto_sources = 1;
  summary.hotset_target_slots_read = 1;
  summary.hotset_target_stale = 1;
  summary.exits_unsupported = 1;
  for (const reason of summary.reject_reasons) {
    reason.count = 0;
  }
  liveGeneratedExecSummaryReadyResult.wasm64Runloop.lastSummary = {
    ...summary,
  };
}

const scaffoldOneTbDifferentialResult = {
  wasm64Runloop: {
    summaryCount: 1,
    summaries: [
      {
        event: "one-tb-differential",
        name: "live-x86-pre-r4i-ld32u-goto-tb-13",
        ok: true,
        live_shape_fixture: true,
        real_live_state_capture: false,
        shape: [
          "ld32u",
          "tci_movi",
          "tci_setcond32",
          "brcond",
          "tci_movi",
          "st8",
          "ld",
          "tci_movi",
          "add",
          "st",
          "goto_tb",
          "exit_tb",
          "exit_tb",
        ],
        generated_tci_op_equivalents: 11,
        reference_tci_op_equivalents: 11,
        generated_body_time_ns: 1000,
        tci_dispatch_time_ns: 4000,
        compile_time_ns: 100,
        instantiate_time_ns: 200,
        generated_chain_length: 1,
        inline_tlb_hit_loads: 0,
        inline_tlb_hit_stores: 0,
        helper_calls: 0,
        qemu_ld_calls: 0,
        qemu_st_calls: 0,
        generated_status: 0,
        reference_status: 0,
        dispatch_status: 1,
        generated_dispatch_target: 20552,
        reference_dispatch_target: 20552,
        exit_reason_code: 1,
        exit_value: 0,
        generated_regs_checksum: 4806450183793710000,
        reference_regs_checksum: 4806450183793710000,
        generated_memory_checksum: 16094818889002498000,
        reference_memory_checksum: 16094818889002498000,
        generated_memory_writes: 2,
        reference_memory_writes: 2,
        expected_memory_writes: 2,
        js_status: 0,
      },
    ],
    lastSummary: {
      event: "one-tb-differential",
      name: "live-x86-pre-r4i-ld32u-goto-tb-13",
      ok: true,
      live_shape_fixture: true,
      real_live_state_capture: false,
      shape: [
        "ld32u",
        "tci_movi",
        "tci_setcond32",
        "brcond",
        "tci_movi",
        "st8",
        "ld",
        "tci_movi",
        "add",
        "st",
        "goto_tb",
        "exit_tb",
        "exit_tb",
      ],
      generated_tci_op_equivalents: 11,
      reference_tci_op_equivalents: 11,
      generated_body_time_ns: 1000,
      tci_dispatch_time_ns: 4000,
      compile_time_ns: 100,
      instantiate_time_ns: 200,
      generated_chain_length: 1,
      inline_tlb_hit_loads: 0,
      inline_tlb_hit_stores: 0,
      helper_calls: 0,
      qemu_ld_calls: 0,
      qemu_st_calls: 0,
      generated_status: 0,
      reference_status: 0,
      dispatch_status: 1,
      generated_dispatch_target: 20552,
      reference_dispatch_target: 20552,
      exit_reason_code: 1,
      exit_value: 0,
      generated_regs_checksum: 4806450183793710000,
      reference_regs_checksum: 4806450183793710000,
      generated_memory_checksum: 16094818889002498000,
      reference_memory_checksum: 16094818889002498000,
      generated_memory_writes: 2,
      reference_memory_writes: 2,
      expected_memory_writes: 2,
      js_status: 0,
    },
  },
};

const liveOneTbDifferentialResult = {
  wasm64Runloop: {
    summaryCount: 1,
    summaries: [
      {
        elapsedMs: 2355,
        format: 1,
        event: "live-one-tb-differential",
        name: "live-x86-r4i-ld32u-goto-tb-11",
        ok: true,
        live_shape_fixture: false,
        real_live_state_capture: true,
        shape: [
          "ld32u",
          "tci_movi",
          "tci_setcond32",
          "brcond",
          "tci_movi",
          "st8",
          "ld",
          "tci_movi",
          "add",
          "st",
          "goto_tb",
        ],
        tb_ptr: "0x78700c0",
        tb_pc: "0x0",
        tb_cs_base: "0xffff0000",
        tb_flags: 64,
        tb_cflags: 4278321152,
        tb_size: 3,
        tb_icount: 1,
        metadata_op_count: 13,
        metadata_generated_output_available: false,
        generated_guest_instructions: 1,
        reference_guest_instructions: 1,
        generated_tci_op_equivalents: 11,
        reference_tci_op_equivalents: 11,
        generated_body_time_ns: 45000,
        tci_dispatch_time_ns: 300000,
        compile_time_ns: 200000,
        instantiate_time_ns: 50000,
        generated_chain_length: 1,
        host_memory_loads: 2,
        host_memory_stores: 2,
        helper_calls: 0,
        qemu_ld_calls: 0,
        qemu_st_calls: 0,
        generated_status: 2,
        reference_status: 2,
        dispatch_status: 2,
        generated_dispatch_target: 126288108,
        reference_dispatch_target: 126288108,
        exit_reason_code: 2,
        exit_value: 126288108,
        generated_regs_checksum: 407154517823240700,
        reference_regs_checksum: 407154517823240700,
        generated_memory_checksum: 8033238923928634000,
        reference_memory_checksum: 8033238923928634000,
        generated_memory_writes: 2,
        reference_memory_writes: 2,
        expected_memory_writes: 2,
        scanned_live_tbs_before_match: 1,
        js_status: 0,
      },
    ],
    lastSummary: {
      elapsedMs: 2355,
      format: 1,
      event: "live-one-tb-differential",
      name: "live-x86-r4i-ld32u-goto-tb-11",
      ok: true,
      live_shape_fixture: false,
      real_live_state_capture: true,
      shape: [
        "ld32u",
        "tci_movi",
        "tci_setcond32",
        "brcond",
        "tci_movi",
        "st8",
        "ld",
        "tci_movi",
        "add",
        "st",
        "goto_tb",
      ],
      tb_ptr: "0x78700c0",
      tb_pc: "0x0",
      tb_cs_base: "0xffff0000",
      tb_flags: 64,
      tb_cflags: 4278321152,
      tb_size: 3,
      tb_icount: 1,
      metadata_op_count: 13,
      metadata_generated_output_available: false,
      generated_guest_instructions: 1,
      reference_guest_instructions: 1,
      generated_tci_op_equivalents: 11,
      reference_tci_op_equivalents: 11,
      generated_body_time_ns: 45000,
      tci_dispatch_time_ns: 300000,
      compile_time_ns: 200000,
      instantiate_time_ns: 50000,
      generated_chain_length: 1,
      host_memory_loads: 2,
      host_memory_stores: 2,
      helper_calls: 0,
      qemu_ld_calls: 0,
      qemu_st_calls: 0,
      generated_status: 2,
      reference_status: 2,
      dispatch_status: 2,
      generated_dispatch_target: 126288108,
      reference_dispatch_target: 126288108,
      exit_reason_code: 2,
      exit_value: 126288108,
      generated_regs_checksum: 407154517823240700,
      reference_regs_checksum: 407154517823240700,
      generated_memory_checksum: 8033238923928634000,
      reference_memory_checksum: 8033238923928634000,
      generated_memory_writes: 2,
      reference_memory_writes: 2,
      expected_memory_writes: 2,
      scanned_live_tbs_before_match: 1,
      js_status: 0,
    },
  },
};

const liveInlineMemoryOneTbDifferentialResult = JSON.parse(
  JSON.stringify(liveOneTbDifferentialResult),
);
{
  const liveSummary =
    liveInlineMemoryOneTbDifferentialResult.wasm64Runloop.summaries[0];
  delete liveSummary.host_memory_loads;
  delete liveSummary.host_memory_stores;
  liveSummary.inline_tlb_hit_loads = 2;
  liveSummary.inline_tlb_hit_stores = 2;
  liveInlineMemoryOneTbDifferentialResult.wasm64Runloop.lastSummary = {
    ...liveSummary,
  };
}

assert.equal(X86_BROWSER_SMOKE_METRICS_GATE_VERSION, 4);

{
  const gate = x86BrowserSmokeMetricsGate(runtimeSmokeResult);
  assert.equal(gate.purpose, "qemu-browser-smoke-x86-metrics-gate");
  assert.equal(gate.ok, true);
  assert.equal(gate.acceptanceMode, "runloop");
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.runloop.summaryCount, 1);
  assert.equal(gate.runloop.summariesLength, 1);
  assert.equal(gate.runloop.lastSummary.event, "runtime-smoke");
  assert.equal(gate.runloop.acceptanceAllowed, true);
  assert.equal(gate.runloop.lastSummary.workload_count_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_vs_tci_speedup_ppm_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_vs_tci_speedup_ppm_computed, 5000000);
  assert.equal(gate.runloop.lastSummary.workloads.length, 2);
  assert.equal(gate.runloop.lastSummary.workloads[0].generated_vs_tci_speedup_ppm_matches, true);
  assert.equal(gate.runloop.lastSummary.workloads[1].generated_vs_tci_speedup_ppm_matches, true);
  assert.equal(gate.tcg.ok, true);
  assert.equal(gate.tcg.summaryCount, 1);
  assert.equal(gate.tcg.summariesLength, 1);
  assert.equal(gate.tcg.lastSummary.generated_coverage_share, 0.021);
  assert.equal(gate.tcg.lastSummary.generated_coverage_ppm_computed, 21000);
  assert.equal(gate.tcg.lastSummary.generated_coverage_ppm_matches, true);
  assert.equal(gate.tcg.lastSummary.generated_guest_instructions, 1440);
  assert.equal(gate.tcg.lastSummary.fallback_guest_instructions, 720);
  assert.equal(gate.tcg.lastSummary.generated_body_time_ns, 123456);
  assert.deepEqual(gate.tcg.lastSummary.generated_exits.missingFields, []);
}

{
  const gate = x86BrowserSmokeMetricsGate(tcgOnlyResult, { requireTcg: true });
  assert.equal(gate.ok, false);
  assert.equal(gate.acceptanceMode, "runloop");
  assert.equal(gate.runloop.present, false);
  assert.equal(gate.tcg.ok, true);
}

{
  const gate = x86BrowserSmokeMetricsGate(tcgOnlyResult, {
    allowTcgOnly: true,
    requireTcg: true,
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.acceptanceMode, "tcg-only");
  assert.equal(gate.runloop.present, false);
  assert.equal(gate.tcg.ok, true);
  assert.equal(gate.tcg.lastSummary.generated_coverage_ppm, 21000);
}

{
  const output = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-x86-metrics-gate.mjs",
    "--help",
  ], { encoding: "utf8" });
  assert.match(output, /Usage: wasm-browser-smoke-x86-metrics-gate\.mjs --result FILE/);
}

{
  const output = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-metrics-gate.mjs",
    "--help",
  ], { encoding: "utf8" });
  assert.match(output, /Usage: wasm-browser-smoke-metrics-gate\.mjs --result FILE/);
}

{
  const resultDir = mkdtempSync(join(tmpdir(), "qemu-smoke-metrics-gate-"));
  const resultPath = join(resultDir, "result.json");
  writeFileSync(resultPath, JSON.stringify(runtimeSmokeResult));

  const x86Json = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-x86-metrics-gate.mjs",
    "--result", resultPath,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(x86Json).purpose, "qemu-browser-smoke-x86-metrics-gate");

  const genericJson = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-metrics-gate.mjs",
    "--result", resultPath,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(genericJson).purpose, "qemu-browser-smoke-metrics-gate");

  const x86Text = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-x86-metrics-gate.mjs",
    "--result", resultPath,
  ], { encoding: "utf8" });
  assert.match(x86Text, /^qemu-browser-smoke-x86-metrics-gate:/);

  const genericText = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-metrics-gate.mjs",
    "--result", resultPath,
  ], { encoding: "utf8" });
  assert.match(genericText, /^qemu-browser-smoke-metrics-gate:/);
}

{
  const resultDir = mkdtempSync(join(tmpdir(), "qemu-smoke-metrics-gate-tcg-only-"));
  const resultPath = join(resultDir, "result.json");
  writeFileSync(resultPath, JSON.stringify(tcgOnlyResult));

  assert.throws(
    () => execFileSync(process.execPath, [
      "scripts/ci/wasm-browser-smoke-x86-metrics-gate.mjs",
      "--result", resultPath,
      "--require-tcg",
      "--json",
    ], { encoding: "utf8" }),
    /Command failed/,
  );

  const genericJson = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-smoke-metrics-gate.mjs",
    "--result", resultPath,
    "--require-tcg",
    "--json",
  ], { encoding: "utf8" });
  const gate = JSON.parse(genericJson);
  assert.equal(gate.purpose, "qemu-browser-smoke-metrics-gate");
  assert.equal(gate.ok, true);
  assert.equal(gate.acceptanceMode, "tcg-only");
  assert.equal(gate.tcg.lastSummary.generated_coverage_ppm, 21000);
}

for (const field of [
  "generated_guest_instructions",
  "fallback_guest_instructions",
  "generated_body_time_ns",
]) {
  const broken = JSON.parse(JSON.stringify(runtimeSmokeResult));
  delete broken.wasm64Tcg.summaries[0][field];
  delete broken.wasm64Tcg.lastSummary[field];
  const gate = x86BrowserSmokeMetricsGate(broken);
  assert.equal(gate.ok, false);
  assert.equal(gate.tcg.ok, false);
  assert.ok(gate.tcg.lastSummary.missingFields.includes(field));
  assert.ok(gate.tcg.missingFields.includes(field));
}

{
  const gate = x86BrowserSmokeMetricsGate(liveGeneratedExecSummaryZeroResult);
  assert.equal(gate.ok, false);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.runloop.acceptanceAllowed, false);
  assert.equal(gate.runloop.lastSummary.event, "live-generated-exec-summary");
  assert.equal(gate.runloop.lastSummary.reason, "preflight-zero-generated-exec");
  assert.equal(gate.runloop.lastSummary.preflight, true);
  assert.equal(gate.runloop.lastSummary.preflight_ready, false);
  assert.equal(gate.runloop.lastSummary.generated_guest_instructions, 0);
  assert.equal(gate.runloop.lastSummary.reject_reason_total, 10000);
  assert.equal(gate.runloop.lastSummary.reject_reason_total_matches, true);
}

{
  const gate = x86BrowserSmokeMetricsGate(liveGeneratedExecSummaryReadyResult);
  assert.equal(gate.ok, true);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.runloop.acceptanceAllowed, true);
  assert.equal(gate.runloop.lastSummary.event, "live-generated-exec-summary");
  assert.equal(gate.runloop.lastSummary.reason, "chain-target-unsupported");
  assert.equal(gate.runloop.lastSummary.chain_exit_reason,
    "chain-target-unsupported");
  assert.equal(gate.runloop.lastSummary.preflight_ready, true);
  assert.equal(gate.runloop.lastSummary.generated_guest_instructions, 1);
  assert.equal(gate.runloop.lastSummary.generated_body_time_ns, 1000);
  assert.equal(gate.runloop.lastSummary.exits_unsupported, 1);
  assert.equal(gate.runloop.lastSummary.reject_reason_total, 0);
  assert.equal(gate.runloop.lastSummary.reject_reason_total_matches, true);
}

// R4d-g: a real controlled proof carried an ok runloop-only
// live-generated-exec-summary alongside an incomplete/empty wasm64Tcg
// object. Without --require-tcg, that placeholder must not veto acceptance,
// but the tcg diagnostics stay visible; with --require-tcg, the gate must
// still fail and explain exactly what is missing.
{
  const readyRunloopOnlyWithEmptyTcg = JSON.parse(
    JSON.stringify(liveGeneratedExecSummaryReadyResult),
  );
  readyRunloopOnlyWithEmptyTcg.wasm64Tcg = {};

  const gate = x86BrowserSmokeMetricsGate(readyRunloopOnlyWithEmptyTcg);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.tcg.ok, false);
  assert.deepEqual(gate.tcg.missingFields, [
    "wasm64Tcg.summaryCount",
    "wasm64Tcg.summaries",
    "wasm64Tcg.lastSummary",
  ]);
  assert.equal(gate.ok, true);
  assert.equal(gate.acceptanceMode, "runloop");

  const requiredGate = x86BrowserSmokeMetricsGate(readyRunloopOnlyWithEmptyTcg, {
    requireTcg: true,
  });
  assert.equal(requiredGate.ok, false);
  assert.equal(requiredGate.tcg.ok, false);
  assert.deepEqual(requiredGate.tcg.missingFields, [
    "wasm64Tcg.summaryCount",
    "wasm64Tcg.summaries",
    "wasm64Tcg.lastSummary",
  ]);
}

// R4d-g: the real 5fd5d214e9 saved CDP proof result carries a richer
// zero-summary placeholder, not a bare `{}` - tcg summary reporting was
// enabled but never produced a summary:
// {enabled, interval, maxSummaries, summaryCount: 0, summaries: [],
// lastSummary: null}. Its summaryCount/summaries/lastSummary keys are all
// *present* (unlike the bare-`{}` case above), so a presence-only check
// would wrongly treat this as real tcg data and veto the gate even without
// --require-tcg. It must behave exactly like the bare `{}` placeholder.
{
  const readyRunloopOnlyWithZeroSummaryTcg = JSON.parse(
    JSON.stringify(liveGeneratedExecSummaryReadyResult),
  );
  readyRunloopOnlyWithZeroSummaryTcg.wasm64Tcg = {
    enabled: true,
    interval: 1000,
    maxSummaries: 16,
    summaryCount: 0,
    summaries: [],
    lastSummary: null,
  };

  const gate = x86BrowserSmokeMetricsGate(readyRunloopOnlyWithZeroSummaryTcg);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.tcg.ok, false);
  assert.deepEqual(gate.tcg.missingFields, [
    "wasm64Tcg.summaryCount",
    "wasm64Tcg.lastSummary",
  ]);
  assert.equal(gate.ok, true);
  assert.equal(gate.acceptanceMode, "runloop");

  const requiredGate = x86BrowserSmokeMetricsGate(readyRunloopOnlyWithZeroSummaryTcg, {
    requireTcg: true,
  });
  assert.equal(requiredGate.ok, false);
  assert.equal(requiredGate.tcg.ok, false);
  assert.deepEqual(requiredGate.tcg.missingFields, [
    "wasm64Tcg.summaryCount",
    "wasm64Tcg.lastSummary",
  ]);
}

// Fully absent wasm64Tcg (no key at all) is distinct from an empty
// placeholder: with no data to validate, tcg stays null in both modes, and
// --require-tcg alone is enough to fail the gate.
{
  assert.equal(
    x86BrowserSmokeMetricsGate(liveGeneratedExecSummaryReadyResult).tcg,
    null,
  );
  const requiredGate = x86BrowserSmokeMetricsGate(
    liveGeneratedExecSummaryReadyResult,
    { requireTcg: true },
  );
  assert.equal(requiredGate.ok, false);
  assert.equal(requiredGate.tcg, null);
}

{
  const gate = x86BrowserSmokeMetricsGate(scaffoldOneTbDifferentialResult);
  assert.equal(gate.ok, false);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.runloop.acceptanceAllowed, false);
  assert.equal(gate.runloop.lastSummary.event, "one-tb-differential");
  assert.equal(gate.runloop.lastSummary.real_live_state_capture, false);
  assert.equal(gate.runloop.lastSummary.generated_body_time_positive, true);
  assert.equal(gate.runloop.lastSummary.tci_dispatch_time_positive, true);
  assert.equal(gate.runloop.lastSummary.generated_chain_length_positive, true);
  assert.equal(gate.runloop.lastSummary.inline_tlb_hit_loads_valid, true);
  assert.equal(gate.runloop.lastSummary.inline_tlb_hit_stores_valid, true);
  assert.equal(gate.runloop.lastSummary.generated_tci_op_equivalents_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_dispatch_target_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_regs_checksum_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_memory_checksum_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_memory_writes_matches, true);
  assert.equal(gate.runloop.lastSummary.helper_calls_zero, true);
  assert.equal(gate.runloop.lastSummary.qemu_ld_calls_zero, true);
  assert.equal(gate.runloop.lastSummary.qemu_st_calls_zero, true);
  assert.equal(gate.tcg, null);
}

{
  const gate = x86BrowserSmokeMetricsGate(liveOneTbDifferentialResult);
  assert.equal(gate.ok, true);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.runloop.acceptanceAllowed, true);
  assert.equal(gate.runloop.lastSummary.event, "live-one-tb-differential");
  assert.equal(gate.runloop.lastSummary.real_live_state_capture, true);
  assert.equal(gate.runloop.lastSummary.live_shape_fixture, false);
  assert.equal(gate.runloop.lastSummary.tb_ptr, "0x78700c0");
  assert.equal(gate.runloop.lastSummary.tb_pc, "0x0");
  assert.equal(gate.runloop.lastSummary.tb_cs_base, "0xffff0000");
  assert.equal(gate.runloop.lastSummary.tb_flags, 64);
  assert.equal(gate.runloop.lastSummary.tb_cflags, 4278321152);
  assert.equal(gate.runloop.lastSummary.tb_size, 3);
  assert.equal(gate.runloop.lastSummary.tb_icount, 1);
  assert.equal(gate.runloop.lastSummary.metadata_op_count, 13);
  assert.equal(gate.runloop.lastSummary.metadata_generated_output_available, false);
  assert.equal(gate.runloop.lastSummary.scanned_live_tbs_before_match, 1);
  assert.equal(gate.runloop.lastSummary.generated_guest_instructions, 1);
  assert.equal(gate.runloop.lastSummary.reference_guest_instructions, 1);
  assert.equal(gate.runloop.lastSummary.host_memory_loads, 2);
  assert.equal(gate.runloop.lastSummary.host_memory_stores, 2);
  assert.equal(gate.runloop.lastSummary.generated_guest_instructions_positive, true);
  assert.equal(gate.runloop.lastSummary.reference_guest_instructions_positive, true);
  assert.equal(gate.runloop.lastSummary.tb_ptr_valid, true);
  assert.equal(gate.runloop.lastSummary.tb_pc_valid, true);
  assert.equal(gate.runloop.lastSummary.tb_cs_base_valid, true);
  assert.equal(gate.runloop.lastSummary.tb_size_positive, true);
  assert.equal(gate.runloop.lastSummary.tb_icount_positive, true);
  assert.equal(gate.runloop.lastSummary.metadata_op_count_positive, true);
  assert.equal(gate.runloop.lastSummary.metadata_generated_output_available_valid, true);
  assert.equal(gate.runloop.lastSummary.generated_body_time_positive, true);
  assert.equal(gate.runloop.lastSummary.tci_dispatch_time_positive, true);
  assert.equal(gate.runloop.lastSummary.compile_time_positive, true);
  assert.equal(gate.runloop.lastSummary.instantiate_time_positive, true);
  assert.equal(gate.runloop.lastSummary.generated_chain_length_positive, true);
  assert.equal(gate.runloop.lastSummary.generated_tci_op_equivalents_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_status_matches, true);
  assert.equal(gate.runloop.lastSummary.dispatch_status_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_dispatch_target_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_regs_checksum_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_memory_checksum_matches, true);
  assert.equal(gate.runloop.lastSummary.generated_memory_writes_matches, true);
  assert.equal(gate.runloop.lastSummary.helper_calls_zero, true);
  assert.equal(gate.runloop.lastSummary.qemu_ld_calls_zero, true);
  assert.equal(gate.runloop.lastSummary.qemu_st_calls_zero, true);
  assert.equal(gate.runloop.lastSummary.normalized_memory_counter_source, "host_memory");
  assert.equal(gate.runloop.lastSummary.normalized_memory_loads, 2);
  assert.equal(gate.runloop.lastSummary.normalized_memory_stores, 2);
  assert.equal(gate.runloop.lastSummary.memory_counters_match, true);
  assert.equal(gate.tcg, null);
}

{
  const gate = x86BrowserSmokeMetricsGate(liveInlineMemoryOneTbDifferentialResult);
  assert.equal(gate.ok, true);
  assert.equal(gate.runloop.ok, true);
  assert.equal(gate.runloop.acceptanceAllowed, true);
  assert.equal(gate.runloop.lastSummary.event, "live-one-tb-differential");
  assert.equal(gate.runloop.lastSummary.normalized_memory_counter_source, "inline_tlb_hit");
  assert.equal(gate.runloop.lastSummary.normalized_memory_loads, 2);
  assert.equal(gate.runloop.lastSummary.normalized_memory_stores, 2);
  assert.equal(gate.runloop.lastSummary.memory_counters_match, true);
  assert.equal(gate.runloop.lastSummary.host_memory_loads, undefined);
  assert.equal(gate.runloop.lastSummary.host_memory_stores, undefined);
  assert.equal(gate.runloop.lastSummary.inline_tlb_hit_loads, 2);
  assert.equal(gate.runloop.lastSummary.inline_tlb_hit_stores, 2);
}

{
  const broken = JSON.parse(JSON.stringify(runtimeSmokeResult));
  delete broken.wasm64Runloop.lastSummary.generated_body_time_ns;
  const gate = x86BrowserSmokeMetricsGate(broken);
  assert.equal(gate.ok, false);
  assert.ok(gate.runloop.lastSummary.missingFields.includes("generated_body_time_ns"));
}

{
  const gate = x86BrowserSmokeMetricsGate(
    {
      wasm64Runloop: runtimeSmokeResult.wasm64Runloop,
    },
    { requireTcg: true },
  );
  assert.equal(gate.ok, false);
  assert.equal(gate.tcg, null);
}

console.log("wasm-browser-smoke-x86-metrics-gate-test: ok");
