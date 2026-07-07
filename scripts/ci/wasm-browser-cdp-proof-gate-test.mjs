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
};

{
  const gate = cdpProofEvidenceGate(result, {
    requireGuestManifest: true,
    requireSuccess: true,
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.purpose, "qemu-browser-cdp-proof-gate");
  assert.equal(gate.browserVersion, "HeadlessChrome/150.0.0.0");
  assert.equal(gate.files.program.ok, true);
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
    "--require-guest-manifest",
    "--require-success",
    "--json",
  ], { encoding: "utf8" });
  const gate = JSON.parse(output);
  assert.equal(gate.ok, true);
  assert.equal(gate.purpose, "qemu-browser-cdp-proof-gate");
}

console.log("wasm-browser-cdp-proof-gate-test: ok");
