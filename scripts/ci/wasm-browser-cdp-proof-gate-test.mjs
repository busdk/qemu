#!/usr/bin/env node
/*
 * Test CDP browser proof evidence gate helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cdpProofEvidenceGate,
} from "./wasm-browser-cdp-proof-gate.mjs";

const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const result = {
  browserVersion: {
    browser: "HeadlessChrome/150.0.0.0",
  },
  elapsedMs: 40194,
  inputEvidence: {
    artifactDir: "/tmp/artifacts",
    firmwareDir: "/tmp/pc-bios",
    guestManifest: {
      role: "guestManifest",
      path: "/tmp/guest.json",
      bytes: 77,
      sha256: sha,
    },
    kernel: {
      role: "kernel",
      path: "/tmp/Image",
      bytes: 1000,
      sha256: sha,
    },
    program: {
      role: "program",
      path: "/tmp/artifacts/qemu-system-riscv64.js",
      bytes: 2048,
      sha256: sha,
    },
    rootfs: {
      role: "rootfs",
      path: "/tmp/rootfs.ext4",
      bytes: 4096,
      sha256: sha,
    },
    wasm: {
      role: "wasm",
      path: "/tmp/artifacts/qemu-system-riscv64.wasm",
      bytes: 8192,
      sha256: sha,
    },
  },
  markerSeen: true,
  pageErrors: [],
  resourceErrors: [],
  success: true,
  wasm64Runloop: {
    lastSummary: {
      event: "live-generated-exec-summary",
      generated_coverage_denominator: 1000,
      generated_coverage_numerator: 21,
      generated_coverage_ppm: 21000,
      generated_body_time_ns: 45000,
      generated_guest_instructions: 163,
      generated_run_entries: 7,
    },
  },
};

{
  const gate = cdpProofEvidenceGate(result, {
    requireGuestManifest: true,
    requireGeneratedExec: true,
    requireSuccess: true,
    maxElapsedMs: 300000,
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.purpose, "qemu-browser-cdp-proof-gate");
  assert.equal(gate.browserVersion, "HeadlessChrome/150.0.0.0");
  assert.equal(gate.files.program.ok, true);
  assert.equal(gate.generatedExec.ok, true);
  assert.equal(gate.generatedExec.source, "wasm64Runloop");
  assert.equal(gate.generatedExec.generatedRunEntries, 7);
  assert.equal(gate.generatedExec.generatedGuestInstructions, 163);
  assert.equal(gate.generatedExec.generatedBodyTimeNs, 45000);
  assert.equal(gate.elapsedOk, true);
  assert.equal(gate.maxElapsedMs, 300000);
  assert.equal(gate.files.rootfs.present, true);
  assert.deepEqual(gate.missingFields, []);
}

{
  const broken = JSON.parse(JSON.stringify(result));
  delete broken.browserVersion.browser;
  broken.inputEvidence.wasm.sha256 = "not-a-sha";
  delete broken.inputEvidence.rootfs;
  const gate = cdpProofEvidenceGate(broken, { requireGuestManifest: true });
  assert.equal(gate.ok, false);
  assert.ok(gate.missingFields.includes("browserVersion.browser"));
  assert.ok(gate.missingFields.includes("inputEvidence.wasm.sha256"));
  assert.ok(gate.missingFields.includes("inputEvidence.initrd|rootfs"));
}

{
  const broken = JSON.parse(JSON.stringify(result));
  broken.wasm64Runloop.lastSummary.generated_run_entries = 0;
  broken.wasm64Runloop.lastSummary.generated_coverage_numerator = 0;
  const gate = cdpProofEvidenceGate(broken, { requireGeneratedExec: true });
  assert.equal(gate.ok, false);
  assert.ok(gate.missingFields.includes(
    "wasm64Runloop.lastSummary.generated_run_entries",
  ));
  assert.ok(gate.missingFields.includes(
    "wasm64Runloop.lastSummary.generated_coverage_numerator",
  ));
}

for (const [field, invalidValue] of [
  ["generated_guest_instructions", undefined],
  ["generated_guest_instructions", 0],
  ["generated_guest_instructions", 1.5],
  ["generated_body_time_ns", undefined],
  ["generated_body_time_ns", 0],
  ["generated_body_time_ns", 1.5],
]) {
  const broken = JSON.parse(JSON.stringify(result));
  if (invalidValue === undefined) {
    delete broken.wasm64Runloop.lastSummary[field];
  } else {
    broken.wasm64Runloop.lastSummary[field] = invalidValue;
  }
  const gate = cdpProofEvidenceGate(broken, { requireGeneratedExec: true });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.generatedExec.missingFields, [
    `wasm64Runloop.lastSummary.${field}`,
  ]);
}

// R4d-g: the wasm64Runloop "live-generated-exec-summary" event
// (tcg/wasm64.c tcg_wasm64_report_live_generated_exec_summary) never emits
// generated_coverage_ppm, only the numerator/denominator. A real controlled
// proof (58 generated_run_entries, 163/964 coverage) reported this exact
// shape and was wrongly rejected before the gate derived ppm itself.
{
  const runloopNoPpm = JSON.parse(JSON.stringify(result));
  delete runloopNoPpm.wasm64Runloop.lastSummary.generated_coverage_ppm;
  runloopNoPpm.wasm64Runloop.lastSummary.generated_run_entries = 58;
  runloopNoPpm.wasm64Runloop.lastSummary.generated_coverage_numerator = 163;
  runloopNoPpm.wasm64Runloop.lastSummary.generated_coverage_denominator = 964;
  const gate = cdpProofEvidenceGate(runloopNoPpm, { requireGeneratedExec: true });
  assert.equal(gate.ok, true);
  assert.equal(gate.generatedExec.ok, true);
  assert.equal(gate.generatedExec.generatedCoveragePpmReported, false);
  assert.equal(gate.generatedExec.generatedCoveragePpm, 169087);
}

{
  const tcgOnly = JSON.parse(JSON.stringify(result));
  delete tcgOnly.wasm64Runloop;
  tcgOnly.wasm64Tcg = {
    lastSummary: {
      event: "summary",
      generated_coverage_denominator: 2000,
      generated_coverage_numerator: 5,
      generated_coverage_ppm: 2500,
      generated_body_time_ns: 45000,
      generated_guest_instructions: 163,
      generated_run_entries: 3,
    },
  };
  const gate = cdpProofEvidenceGate(tcgOnly, { requireGeneratedExec: true });
  assert.equal(gate.ok, false);
  assert.equal(gate.generatedExec.source, null);
  assert.deepEqual(gate.generatedExec.missingFields, [
    "wasm64Runloop.lastSummary.event=live-generated-exec-summary",
  ]);
  const diagnosticGate = cdpProofEvidenceGate(tcgOnly);
  assert.equal(diagnosticGate.ok, true);
  assert.equal(diagnosticGate.generatedExec.source, "wasm64Tcg");
}

{
  const wrongEvent = JSON.parse(JSON.stringify(result));
  wrongEvent.wasm64Runloop.lastSummary.event = "summary";
  const gate = cdpProofEvidenceGate(wrongEvent, { requireGeneratedExec: true });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.generatedExec.missingFields, [
    "wasm64Runloop.lastSummary.event=live-generated-exec-summary",
  ]);
}

{
  const gate = cdpProofEvidenceGate(result, { maxElapsedMs: 1000 });
  assert.equal(gate.ok, false);
  assert.equal(gate.elapsedOk, false);
  assert.ok(gate.missingFields.includes("elapsedMs<=maxElapsedMs"));
}

{
  const failedProof = {
    ...result,
    success: false,
  };
  assert.equal(cdpProofEvidenceGate(failedProof).ok, true);
  assert.equal(cdpProofEvidenceGate(failedProof, { requireSuccess: true }).ok, false);
}

{
  const output = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-cdp-proof-gate.mjs",
    "--help",
  ], { encoding: "utf8" });
  assert.match(output, /Usage: wasm-browser-cdp-proof-gate\.mjs --result FILE/);
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-cdp-proof-gate-"));
  const resultPath = join(dir, "result.json");
  writeFileSync(resultPath, JSON.stringify(result));
  const output = execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-cdp-proof-gate.mjs",
    "--result", resultPath,
    "--require-generated-exec",
    "--require-guest-manifest",
    "--require-success",
    "--max-elapsed-ms", "300000",
    "--json",
  ], { encoding: "utf8" });
  const gate = JSON.parse(output);
  assert.equal(gate.ok, true);
  assert.equal(gate.purpose, "qemu-browser-cdp-proof-gate");
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-cdp-proof-gate-"));
  const resultPath = join(dir, "result.json");
  const broken = JSON.parse(JSON.stringify(result));
  delete broken.wasm64Runloop.lastSummary.generated_guest_instructions;
  broken.wasm64Runloop.lastSummary.generated_body_time_ns = 0;
  writeFileSync(resultPath, JSON.stringify(broken));
  assert.throws(() => execFileSync(process.execPath, [
    "scripts/ci/wasm-browser-cdp-proof-gate.mjs",
    "--result", resultPath,
    "--require-generated-exec",
  ], { encoding: "utf8", stdio: "pipe" }), (error) => {
    assert.equal(error.status, 1);
    assert.equal(
      error.stderr,
      "generated execution evidence failed: wasm64Runloop.lastSummary.generated_guest_instructions; wasm64Runloop.lastSummary.generated_body_time_ns\n",
    );
    return true;
  });
}

console.log("wasm-browser-cdp-proof-gate-test: ok");
