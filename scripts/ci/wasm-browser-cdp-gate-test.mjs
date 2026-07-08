#!/usr/bin/env node
/*
 * Test dependency-free Chrome DevTools Protocol gate helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  browserVersionDiagnostic,
  cdpConsoleMessageDiagnostic,
  cdpResourceErrorDiagnostic,
  parseArgs,
  proofInputEvidence,
  smokeServerArgs,
  smokeUrl,
  vmstateRestoreManifestCheck,
} from "./wasm-browser-cdp-gate.mjs";

const options = {
  artifactDir: "/tmp/qemu-artifacts",
  cpu: "",
  diagnosticsLimit: 24,
  display: "none",
  displayDevice: "default",
  firmwareDir: "/tmp/qemu-firmware",
  host: "127.0.0.1",
  initrd: null,
  kernel: "/tmp/qemu-guest/Image",
  kernelAppend: "console=ttyS0 root=/dev/vda",
  liveGeneratedExec: true,
  machine: "virt",
  marker: "Welcome to TuxTest",
  maxOutputBytes: 160000,
  memory: "512M",
  network: "none",
  port: 8151,
  program: "qemu-system-riscv64.js",
  rootfs: "/tmp/qemu-guest/rootfs.raw",
  rootfsDevice: "virtio-mmio",
  targetArch: "riscv64",
  timeoutMs: 180000,
  vmstateRestore: false,
  vmstateRestoreCurrentManifest: "",
  vmstateRestoreManifestCheck: null,
  vmstateRestoreSavedManifest: "",
  vmstateRestoreStateBytes: 0,
  vmstateRestoreStateFile: "",
  vmstateRestoreStateSha256: "",
  wasm: "qemu-system-riscv64.wasm",
};

const args = smokeServerArgs(options);
assert.deepEqual(args.slice(0, 7), [
  "scripts/ci/wasm-browser-smoke-server.mjs",
  "--artifact-dir",
  "/tmp/qemu-artifacts",
  "--firmware-dir",
  "/tmp/qemu-firmware",
  "--kernel",
  "/tmp/qemu-guest/Image",
]);
assert.equal(args.includes("--rootfs"), true);
assert.equal(args.includes("/tmp/qemu-guest/rootfs.raw"), true);
assert.equal(args.includes("--initrd"), false);

const url = new URL(smokeUrl(options));
assert.equal(url.searchParams.get("targetArch"), "riscv64");
assert.equal(url.searchParams.get("machine"), "virt");
assert.equal(url.searchParams.get("program"), "/artifacts/qemu-system-riscv64.js");
assert.equal(url.searchParams.get("wasm"), "/artifacts/qemu-system-riscv64.wasm");
assert.equal(url.searchParams.get("rootfs"), "/guest/rootfs.raw");
assert.equal(url.searchParams.get("rootfsDevice"), "virtio-mmio");
assert.equal(url.searchParams.get("wasm64LiveGeneratedExec"), "1");

const vmstateOptions = {
  ...options,
  vmstateRestore: true,
  vmstateRestoreStateBytes: 26782067,
  vmstateRestoreStateFile: "/tmp/state.vmstate",
  vmstateRestoreStateSha256: "9f1c1825bad301514db7f9684671480d0aa577916b0d6fe43bbdbc54e97915c8",
};
const vmstateUrl = new URL(smokeUrl(vmstateOptions));
assert.equal(vmstateUrl.searchParams.get("vmstateRestore"), "1");
assert.equal(vmstateUrl.searchParams.get("vmstateRestoreSource"), "http");
assert.equal(vmstateUrl.searchParams.get("vmstateRestoreUrl"), "http://127.0.0.1:8151/vmstate/restore");
assert.equal(vmstateUrl.searchParams.get("vmstateRestoreStateBytes"), "26782067");
assert.equal(
  vmstateUrl.searchParams.get("vmstateRestoreStateSha256"),
  "9f1c1825bad301514db7f9684671480d0aa577916b0d6fe43bbdbc54e97915c8",
);
const vmstateServerArgs = smokeServerArgs(vmstateOptions);
assert.equal(vmstateServerArgs.includes("--vmstate-restore-state-file"), true);
assert.equal(vmstateServerArgs.includes("/tmp/state.vmstate"), true);

const manifestDir = mkdtempSync(join(tmpdir(), "qemu-cdp-gate-manifest-"));
const manifestPath = join(manifestDir, "guest.json");
writeFileSync(manifestPath, JSON.stringify({
  target_arch: "riscv64",
  default_parameters: {
    firmwareDir: "firmware",
    initrd: "",
    kernel: "Image",
    rootfs: "rootfs.raw",
    marker: "Welcome to TuxTest",
    program: "qemu-system-riscv64.js",
    wasm: "qemu-system-riscv64.wasm",
  },
}));

const manifestOptions = await parseArgs([
  "--guest-manifest", manifestPath,
  "--artifact-dir", "/tmp/explicit-artifacts",
  "--chrome", "/bin/sh",
  "--out", "/tmp/qemu-cdp-gate-result.json",
]);
assert.equal(manifestOptions.artifactDir, "/tmp/explicit-artifacts");
assert.equal(manifestOptions.firmwareDir, join(manifestDir, "firmware"));
assert.equal(manifestOptions.kernel, join(manifestDir, "Image"));
assert.equal(manifestOptions.initrd, null);
assert.equal(manifestOptions.rootfs, join(manifestDir, "rootfs.raw"));
assert.equal(manifestOptions.targetArch, "riscv64");
assert.equal(manifestOptions.guestManifest, manifestPath);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

{
  const evidenceDir = mkdtempSync(join(tmpdir(), "qemu-cdp-gate-evidence-"));
  const artifactDir = join(evidenceDir, "artifacts");
  const firmwareDir = join(evidenceDir, "pc-bios");
  const kernel = join(evidenceDir, "Image");
  const rootfs = join(evidenceDir, "rootfs.raw");
  const manifest = join(evidenceDir, "guest.json");
  mkdirSync(artifactDir);
  mkdirSync(firmwareDir);
  writeFileSync(join(artifactDir, "qemu-system-riscv64.js"), "js artifact\n");
  writeFileSync(join(artifactDir, "qemu-system-riscv64.wasm"), "wasm artifact\n");
  writeFileSync(kernel, "kernel\n");
  writeFileSync(rootfs, "rootfs\n");
  writeFileSync(manifest, "manifest\n");

  const evidence = await proofInputEvidence({
    artifactDir,
    firmwareDir,
    guestManifest: manifest,
    initrd: null,
    kernel,
    program: "qemu-system-riscv64.js",
    rootfs,
    wasm: "qemu-system-riscv64.wasm",
  });

  assert.equal(evidence.artifactDir, artifactDir);
  assert.equal(evidence.firmwareDir, firmwareDir);
  assert.equal(evidence.program.bytes, "js artifact\n".length);
  assert.equal(evidence.program.sha256, sha256("js artifact\n"));
  assert.equal(evidence.wasm.sha256, sha256("wasm artifact\n"));
  assert.equal(evidence.kernel.sha256, sha256("kernel\n"));
  assert.equal(evidence.rootfs.sha256, sha256("rootfs\n"));
  assert.equal(evidence.guestManifest.sha256, sha256("manifest\n"));
  assert.equal(evidence.initrd, null);
}

{
  assert.deepEqual(browserVersionDiagnostic({
    Browser: "HeadlessChrome/150.0.0.0",
    "Protocol-Version": "1.3",
    "User-Agent": "Mozilla/5.0 HeadlessChrome/150.0.0.0",
    "V8-Version": "15.0.0",
    "WebKit-Version": "537.36",
    extra: "ignored",
  }), {
    browser: "HeadlessChrome/150.0.0.0",
    protocolVersion: "1.3",
    userAgent: "Mozilla/5.0 HeadlessChrome/150.0.0.0",
    v8Version: "15.0.0",
    webkitVersion: "537.36",
  });
}

{
  assert.deepEqual(browserVersionDiagnostic({}), {
    browser: null,
    protocolVersion: null,
    userAgent: null,
    v8Version: null,
    webkitVersion: null,
  });
}

{
  const requestInfo = {
    requestId: "1",
    request: {
      method: "GET",
      url: "http://127.0.0.1:8151/missing.wasm",
    },
    initiator: {
      type: "script",
      url: "http://127.0.0.1:8151/wasm-browser-smoke.mjs",
      lineNumber: 12,
      columnNumber: 3,
    },
    type: "Script",
  };
  const diagnostic = cdpResourceErrorDiagnostic({
    method: "Network.responseReceived",
    params: {
      requestId: "1",
      type: "Script",
      response: {
        url: "http://127.0.0.1:8151/missing.wasm",
        status: 404,
        statusText: "Not Found",
      },
    },
  }, requestInfo, 55);

  assert.deepEqual(diagnostic, {
    elapsedMs: 55,
    event: "Network.responseReceived",
    requestId: "1",
    method: "GET",
    url: "http://127.0.0.1:8151/missing.wasm",
    status: 404,
    statusText: "Not Found",
    failureText: null,
    resourceType: "Script",
    initiator: {
      type: "script",
      url: "http://127.0.0.1:8151/wasm-browser-smoke.mjs",
      lineNumber: 12,
      columnNumber: 3,
      stack: null,
    },
  });
}

{
  const diagnostic = cdpResourceErrorDiagnostic({
    method: "Network.loadingFailed",
    params: {
      requestId: "2",
      errorText: "net::ERR_FAILED",
      type: "Fetch",
    },
  }, {
    requestId: "2",
    request: {
      method: "GET",
      url: "http://127.0.0.1:8151/qemu-system-riscv64.wasm",
    },
    initiator: { type: "parser" },
  }, 99);

  assert.equal(diagnostic.url, "http://127.0.0.1:8151/qemu-system-riscv64.wasm");
  assert.equal(diagnostic.failureText, "net::ERR_FAILED");
  assert.equal(diagnostic.initiator.type, "parser");
}

{
  const diagnostic = cdpConsoleMessageDiagnostic({
    type: "error",
    args: [{
      value: "Failed to load resource: the server responded with a status of 404 (Not Found)",
    }],
  }, 100, [{
    elapsedMs: 99,
    event: "Network.responseReceived",
    method: "GET",
    url: "http://127.0.0.1:8151/missing.js",
    status: 404,
    statusText: "Not Found",
    initiator: {
      type: "script",
      url: "http://127.0.0.1:8151/wasm-browser-smoke.mjs",
    },
  }]);

  assert.equal(diagnostic.resourceError.url, "http://127.0.0.1:8151/missing.js");
  assert.equal(diagnostic.resourceError.status, 404);
  assert.equal(diagnostic.resourceError.initiator.type, "script");
}

{
  const vmstateManifestDir = mkdtempSync(join(tmpdir(), "qemu-cdp-gate-vmstate-"));
  const savedManifest = join(vmstateManifestDir, "saved.json");
  const currentManifest = join(vmstateManifestDir, "current.json");
  const mismatchManifest = join(vmstateManifestDir, "mismatch.json");
  const legacyManifest = join(vmstateManifestDir, "legacy.json");
  const manifest = {
    format: "qemu-wasm-vmstate-manifest-v1",
    compatibility: {
      qemu: {
        binarySha256: "d".repeat(64),
        buildConfigDigest: "target=riscv64-softmmu;wasm64=true",
        sourceCommit: "b73bd4c184ec",
      },
      target: "riscv64-softmmu",
      machine: {
        type: "virt",
        version: "11.0",
      },
      cpu: {
        model: "rv64",
        extensions: ["a=true", "c=true", "m=true", "v=false"],
      },
      memory: "512M",
      devices: [
        "-drive file=/rootfs.raw,format=raw,if=none,id=hd0",
        "-device virtio-blk-device,drive=hd0",
      ],
      migration: {
        capabilities: {
          "send-configuration": true,
          "send-section-footer": true,
        },
      },
      guest: {
        kernelSha256: "e".repeat(64),
        rootfsSha256: "a".repeat(64),
        kernelAppend: "console=ttyS0 root=/dev/vda rw",
      },
      storage: {
        drive: "-drive file=/rootfs.raw,format=raw,if=none,id=hd0 -device virtio-blk-device,drive=hd0",
        resumeDevice: "virtio-blk-device",
      },
      vmstate: {
        streamSha256: "b".repeat(64),
        streamBytes: 26782067,
        format: "qemu-migration-exec-stream",
      },
    },
  };
  const legacy = {
    format: "qemu-wasm-vmstate-manifest-v1",
    compatibility: {
      guest: {
        rootfsSha256: "a".repeat(64),
      },
      vmstate: {
        streamSha256: "b".repeat(64),
      },
    },
  };
  writeFileSync(savedManifest, `${JSON.stringify(manifest)}\n`);
  writeFileSync(currentManifest, `${JSON.stringify(manifest)}\n`);
  writeFileSync(mismatchManifest, `${JSON.stringify({
    ...manifest,
    compatibility: {
      ...manifest.compatibility,
      guest: {
        rootfsSha256: "c".repeat(64),
      },
    },
  })}\n`);
  writeFileSync(legacyManifest, `${JSON.stringify(legacy)}\n`);

  const exact = vmstateRestoreManifestCheck({
    vmstateRestore: true,
    vmstateRestoreSavedManifest: savedManifest,
    vmstateRestoreCurrentManifest: currentManifest,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.saved, savedManifest);
  assert.equal(exact.current, currentManifest);
  const mismatch = vmstateRestoreManifestCheck({
    vmstateRestore: true,
    vmstateRestoreSavedManifest: savedManifest,
    vmstateRestoreCurrentManifest: mismatchManifest,
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.mismatches.some((entry) =>
    entry.key === "guest.rootfsSha256" &&
    entry.reason === "value-mismatch"));
  const legacyCheck = vmstateRestoreManifestCheck({
    vmstateRestore: true,
    vmstateRestoreSavedManifest: legacyManifest,
    vmstateRestoreCurrentManifest: legacyManifest,
  });
  assert.equal(legacyCheck.ok, false);
  assert.ok(legacyCheck.mismatches.some((mismatch) =>
    mismatch.key === "cpu.extensions" &&
    mismatch.reason === "missing-saved"));
}
