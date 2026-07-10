#!/usr/bin/env node
/*
 * Test static VMState restore export preflight.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import {
  VMSTATE_STATIC_EXPORT_FORMAT,
  preflightVmstateStaticExport,
  vmstateStoragePairingSha256,
} from "./wasm-vmstate-static-export.mjs";
import {
  proofInputEvidence,
  vmstateRestoreAffectingArgs,
  vmstateRestorePreflight,
} from "./wasm-browser-cdp-gate.mjs";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function writeFixture(dir, name, data) {
  const path = join(dir, name);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  writeFileSync(path, bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function fileRecord(path, format = undefined) {
  const record = {
    path: basename(path),
    bytes: statSync(path).size,
    sha256: sha256(readFileSync(path)),
  };
  if (format !== undefined) {
    record.format = format;
  }
  return record;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function compatibility({
  argv,
  immutableDisk,
  kernelSha256,
  launcherSha256,
  moduleSha256,
  restoreStream,
}) {
  const value = {
    qemu: {
      binarySha256: moduleSha256,
      buildConfigDigest: "target=riscv64-softmmu;wasm64=true",
      hostKind: "wasm-browser",
      launcherSha256,
      moduleSha256,
      sourceCommit: "01efc762848479a214fdb1c69d317a242c91b662",
    },
    target: "riscv64-softmmu",
    machine: {
      type: "virt",
      version: "11.0",
    },
    cpu: {
      model: "rv64",
      extensions: ["a=true", "c=true", "m=true"],
    },
    memory: "512M",
    devices: [
      "-drive file=/rootfs.raw,format=raw,if=virtio",
      "-nic none",
    ],
    migration: {
      capabilities: {
        "send-configuration": true,
        "send-section-footer": true,
      },
    },
    guest: {
      kernelSha256,
      rootfsSha256: immutableDisk.sha256,
      packageSetDigest: "package-set-v1:0123456789abcdef",
      profile: "virtual-server",
      kernelAppend: "console=ttyS0 root=/dev/vda rw",
      resumeAppend: "console=ttyS0 root=/dev/vda rw",
    },
    storage: {
      drive: "-drive file=/rootfs.raw,format=raw,if=virtio",
      resumeDevice: "if=virtio",
      immutableDisk: {
        sha256: immutableDisk.sha256,
        bytes: immutableDisk.bytes,
        format: "raw",
      },
      overlay: {
        kind: "none",
      },
      pairingSha256: "",
    },
    vmstate: {
      streamSha256: restoreStream.sha256,
      streamBytes: restoreStream.bytes,
      format: "qemu-migration-exec-stream",
    },
    harness: {
      browser: "Chromium",
      runner: "scripts/ci/wasm-browser-cdp-gate.mjs",
      argv,
    },
  };
  value.storage.pairingSha256 = vmstateStoragePairingSha256(value);
  return value;
}

const tmpRoot = join(process.cwd(), "tmp");
mkdirSync(tmpRoot, { recursive: true });
const dir = mkdtempSync(join(tmpRoot, "qemu-vmstate-static-export-test-"));

try {
  const launcher = writeFixture(dir, "qemu-system-riscv64.js", "launcher\n");
  const module = writeFixture(dir, "qemu-system-riscv64.wasm", "module\n");
  const kernel = writeFixture(dir, "Image", "kernel\n");
  const immutableDisk = writeFixture(dir, "rootfs.raw", "immutable disk\n");
  const restoreStream = writeFixture(
    dir,
    "state.vmstate",
    Buffer.from([0, 1, 2, 3, 4, 5, 255]),
  );
  const qemuArtifactManifest = join(dir, "qemu-artifacts.json");
  const guestManifest = join(dir, "guest-manifest.json");
  const savedManifest = join(dir, "saved.json");
  const currentManifest = join(dir, "current.json");
  const staticExport = join(dir, "static-export.json");
  writeJson(qemuArtifactManifest, {
    format: 1,
    artifacts: [
      {
        path: basename(launcher.path),
        kind: "emscripten-javascript",
        target: "riscv64",
        size_bytes: launcher.bytes,
        sha256: launcher.sha256,
      },
      {
        path: basename(module.path),
        kind: "webassembly-module",
        target: "riscv64",
        size_bytes: module.bytes,
        sha256: module.sha256,
      },
    ],
    targets: [{
      target: "riscv64",
      javascript: basename(launcher.path),
      wasm: basename(module.path),
      complete: true,
    }],
  });
  writeJson(guestManifest, { format: "generic-browser-guest-v1" });
  const runnerOptions = {
    artifactDir: dir,
    cpu: "rv64",
    expectText: ["generic login:"],
    firmwareDir: dir,
    guestManifest,
    initrd: null,
    kernel: kernel.path,
    kernelAppend: "console=ttyS0 root=/dev/vda rw",
    machine: "virt",
    marker: "event=ready state=multi-user",
    memory: "512M",
    program: launcher.path,
    rootfs: immutableDisk.path,
    rootfsDevice: "virtio-pci",
    targetArch: "riscv64",
    timeoutMs: 300000,
    vmstateRestore: true,
    vmstateRestoreCurrentManifest: currentManifest,
    vmstateRestoreSavedManifest: savedManifest,
    vmstateRestoreProof: true,
    vmstateRestoreStateBytes: restoreStream.bytes,
    vmstateRestoreStateFile: restoreStream.path,
    vmstateRestoreStateSha256: restoreStream.sha256,
    vmstateRestoreStaticExportManifest: staticExport,
    wasm: module.path,
  };
  const argv = vmstateRestoreAffectingArgs(runnerOptions);
  assert.equal(argv.some((entry) => entry.startsWith(dir)), false);
  const tuple = compatibility({
    argv,
    immutableDisk,
    kernelSha256: kernel.sha256,
    launcherSha256: launcher.sha256,
    moduleSha256: module.sha256,
    restoreStream,
  });
  const savedTuple = structuredClone(tuple);
  savedTuple.qemu.hostKind = "native";
  savedTuple.qemu.binarySha256 = "1".repeat(64);
  savedTuple.qemu.buildConfigDigest =
    "target=riscv64-softmmu;host=native";
  delete savedTuple.qemu.launcherSha256;
  delete savedTuple.qemu.moduleSha256;
  tuple.qemu.buildConfigDigest =
    "target=riscv64-softmmu;host=wasm-browser";
  writeJson(savedManifest, {
    format: "qemu-wasm-vmstate-manifest-v1",
    compatibility: savedTuple,
  });
  writeJson(currentManifest, {
    format: "qemu-wasm-vmstate-manifest-v1",
    compatibility: structuredClone(tuple),
  });
  const coldBootResult = join(dir, "cold-result.json");
  writeJson(coldBootResult, {
    success: true,
    elapsedMs: 373989,
    browserVersion: {
      browser: "HeadlessChrome/150.0.0.0",
    },
    marker: "event=ready state=multi-user",
    markerSeen: true,
    pageStatus: "marker reached: event=ready state=multi-user",
    expectedTextSeen: [{ text: "generic login:", seen: true }],
    qemuCommand: ["-M", "virt", "-kernel", "/guest/kernel"],
    lastLine: "generic login:",
    guestLastLine: "generic login:",
    programExitStatus: null,
    inputEvidence: {
      program: { sha256: launcher.sha256 },
      wasm: { sha256: module.sha256 },
      kernel: { sha256: kernel.sha256 },
      rootfs: { sha256: immutableDisk.sha256 },
      guestManifest: { sha256: fileRecord(guestManifest).sha256 },
    },
  });
  const staticManifest = {
    format: VMSTATE_STATIC_EXPORT_FORMAT,
    files: {
      savedManifest: fileRecord(savedManifest),
      currentManifest: fileRecord(currentManifest),
      restoreStream: fileRecord(
        restoreStream.path,
        "qemu-migration-exec-stream",
      ),
      qemuArtifactManifest: fileRecord(qemuArtifactManifest),
      guestManifest: fileRecord(guestManifest),
      immutableDisk: fileRecord(immutableDisk.path, "raw"),
      overlay: null,
      coldBootResult: fileRecord(coldBootResult),
    },
    guest: {
      profile: "virtual-server",
      packageSetDigest: "package-set-v1:0123456789abcdef",
    },
    readiness: {
      marker: "event=ready state=multi-user",
      expectedSerialText: ["generic login:"],
    },
    harness: {
      browser: "Chromium",
      runner: "scripts/ci/wasm-browser-cdp-gate.mjs",
      argv,
    },
  };
  writeJson(staticExport, staticManifest);
  const runRejectedCdp = ({
    includeStatic = true,
    name,
    rootfsPath = immutableDisk.path,
    staticPath = staticExport,
  }) => {
    const out = join(dir, `${name}-result.json`);
    const cliArgs = [
      "scripts/ci/wasm-browser-cdp-gate.mjs",
      "--artifact-dir", dir,
      "--guest-manifest", guestManifest,
      "--kernel", kernel.path,
      "--rootfs", rootfsPath,
      "--out", out,
      "--chrome", "/bin/sh",
      "--program", basename(launcher.path),
      "--wasm", basename(module.path),
      "--target-arch", "riscv64",
      "--machine", "virt",
      "--cpu", "rv64",
      "--memory", "512M",
      "--kernel-append", "console=ttyS0 root=/dev/vda rw",
      "--marker", "event=ready state=multi-user",
      "--expect-text", "generic login:",
      "--timeout-ms", "300000",
      "--rootfs-device", "virtio-pci",
      "--vmstate-restore",
      "--vmstate-restore-proof",
      "--vmstate-restore-state-file", restoreStream.path,
      "--vmstate-restore-state-bytes", String(restoreStream.bytes),
      "--vmstate-restore-state-sha256", restoreStream.sha256,
      "--vmstate-restore-saved-manifest", savedManifest,
      "--vmstate-restore-current-manifest", currentManifest,
    ];
    if (includeStatic) {
      cliArgs.push(
        "--vmstate-restore-static-export-manifest",
        staticPath,
      );
    }
    const child = spawnSync(process.execPath, cliArgs, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(child.status, 1, child.stderr);
    const result = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(result.success, false);
    assert.equal(result.staticExportProofEligible, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    return result;
  };

  {
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, true, JSON.stringify(result.failure));
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.vmstateRestoreManifestCheck.ok, true);
    assert.equal(
      result.vmstateRestoreManifestCheck.producerConsumer.crossHost,
      true,
    );
    assert.equal(result.coldBoot.readyMs, 373989);
    assert.deepEqual(result.restorePlan.expectedSerialText, ["generic login:"]);
    assert.equal(result.files.restoreStream.sha256, restoreStream.sha256);

    const inputEvidence = await proofInputEvidence(runnerOptions);
    const runnerPreflight = await vmstateRestorePreflight(
      runnerOptions,
      inputEvidence,
    );
    assert.equal(runnerPreflight.ok, true);
    assert.equal(runnerPreflight.staticExportProofEligible, true);
    assert.equal(runnerPreflight.browserStarted, false);
    assert.equal(runnerPreflight.qemuStarted, false);
    assert.equal(runnerPreflight.staticExportPreflight.ok, true);
  }

  {
    const staticPath = runnerOptions.vmstateRestoreStaticExportManifest;
    runnerOptions.vmstateRestoreStaticExportManifest = "";
    const missingInputEvidence = await proofInputEvidence(runnerOptions);
    const missingPreflight = await vmstateRestorePreflight(
      runnerOptions,
      missingInputEvidence,
    );
    assert.equal(missingPreflight.ok, false);
    assert.equal(missingPreflight.staticExportProofEligible, false);
    assert.equal(missingPreflight.browserStarted, false);
    assert.equal(missingPreflight.qemuStarted, false);
    assert.equal(missingPreflight.failure.code, "missing-static-export");

    runnerOptions.vmstateRestoreStaticExportManifest =
      join(dir, "missing-static-export.json");
    const inputEvidence = await proofInputEvidence(runnerOptions);
    const runnerPreflight = await vmstateRestorePreflight(
      runnerOptions,
      inputEvidence,
    );
    assert.equal(runnerPreflight.ok, false);
    assert.equal(runnerPreflight.browserStarted, false);
    assert.equal(runnerPreflight.qemuStarted, false);
    assert.equal(runnerPreflight.failure.code, "unreadable-file");
    assert.equal(runnerPreflight.failure.field, "staticExportManifest");
    const cliResult = runRejectedCdp({
      includeStatic: false,
      name: "missing-static-argument",
    });
    assert.equal(
      cliResult.vmstateRestorePreflight.failure.code,
      "missing-static-export",
    );
    const missingPathResult = runRejectedCdp({
      name: "missing-static",
      staticPath: join(dir, "missing-static-export.json"),
    });
    assert.equal(
      missingPathResult.vmstateRestorePreflight.failure.code,
      "unreadable-file",
    );
    runnerOptions.vmstateRestoreStaticExportManifest = staticPath;
  }

  {
    const restoreRecord = staticManifest.files.restoreStream;
    staticManifest.files.restoreStream = {
      ...restoreRecord,
      path: restoreStream.path,
    };
    writeJson(staticExport, staticManifest);
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.failure.code, "nonportable-path");
    assert.equal(result.failure.field, "files.restoreStream.path");
    staticManifest.files.restoreStream = restoreRecord;
    writeJson(staticExport, staticManifest);
  }

  {
    const restoreRecord = staticManifest.files.restoreStream;
    staticManifest.files.restoreStream = {
      ...restoreRecord,
      path: "missing.vmstate",
    };
    writeJson(staticExport, staticManifest);
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.failure.code, "unreadable-file");
    assert.equal(result.failure.field, "restoreStream");
    staticManifest.files.restoreStream = restoreRecord;
    writeJson(staticExport, staticManifest);
  }

  {
    const restoreRecord = staticManifest.files.restoreStream;
    staticManifest.files.restoreStream = {
      ...restoreRecord,
      sha256: "0".repeat(64),
    };
    writeJson(staticExport, staticManifest);
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.failure.code, "file-sha256-mismatch");
    assert.equal(result.failure.field, "files.restoreStream.sha256");
    staticManifest.files.restoreStream = restoreRecord;
    writeJson(staticExport, staticManifest);
  }

  {
    const artifactManifest = JSON.parse(
      readFileSync(qemuArtifactManifest, "utf8"),
    );
    artifactManifest.artifacts.find((entry) =>
      entry.kind === "webassembly-module").sha256 = "0".repeat(64);
    writeJson(qemuArtifactManifest, artifactManifest);
    staticManifest.files.qemuArtifactManifest =
      fileRecord(qemuArtifactManifest);
    writeJson(staticExport, staticManifest);
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.failure.code, "file-sha256-mismatch");
    assert.equal(result.failure.field, "files.qemu-wasm.sha256");
    artifactManifest.artifacts.find((entry) =>
      entry.kind === "webassembly-module").sha256 = module.sha256;
    writeJson(qemuArtifactManifest, artifactManifest);
    staticManifest.files.qemuArtifactManifest =
      fileRecord(qemuArtifactManifest);
    writeJson(staticExport, staticManifest);
  }

  {
    const otherRootfs = writeFixture(dir, "other-rootfs.raw", "other disk\n");
    runnerOptions.rootfs = otherRootfs.path;
    const inputEvidence = await proofInputEvidence(runnerOptions);
    const runnerPreflight = await vmstateRestorePreflight(
      runnerOptions,
      inputEvidence,
    );
    assert.equal(runnerPreflight.ok, false);
    assert.equal(runnerPreflight.browserStarted, false);
    assert.equal(runnerPreflight.qemuStarted, false);
    assert.equal(
      runnerPreflight.failure.code,
      "static-export-input-mismatch",
    );
    const cliResult = runRejectedCdp({
      name: "static-input-mismatch",
      rootfsPath: otherRootfs.path,
    });
    assert.equal(
      cliResult.vmstateRestorePreflight.failure.code,
      "static-export-input-mismatch",
    );
    runnerOptions.rootfs = immutableDisk.path;
  }

  {
    writeFileSync(restoreStream.path, Buffer.from([0, 1, 2]));
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.failure.code, "file-bytes-mismatch");
    assert.equal(result.failure.field, "files.restoreStream.bytes");

    const inputEvidence = await proofInputEvidence(runnerOptions);
    const runnerPreflight = await vmstateRestorePreflight(
      runnerOptions,
      inputEvidence,
    );
    assert.equal(runnerPreflight.ok, false);
    assert.equal(runnerPreflight.browserStarted, false);
    assert.equal(runnerPreflight.qemuStarted, false);
    assert.equal(
      runnerPreflight.failure.code,
      "restore-stream-bytes-mismatch",
    );
    const cliResult = runRejectedCdp({ name: "truncated-state" });
    assert.equal(
      cliResult.vmstateRestorePreflight.failure.code,
      "restore-stream-bytes-mismatch",
    );
    writeFileSync(
      restoreStream.path,
      Buffer.from([0, 1, 2, 3, 4, 5, 255]),
    );
  }

  {
    writeFileSync(
      restoreStream.path,
      Buffer.from([255, 254, 253, 252, 251, 250, 249]),
    );
    const cliResult = runRejectedCdp({ name: "state-hash-mismatch" });
    assert.equal(
      cliResult.vmstateRestorePreflight.failure.code,
      "restore-stream-sha256-mismatch",
    );
    writeFileSync(
      restoreStream.path,
      Buffer.from([0, 1, 2, 3, 4, 5, 255]),
    );
  }

  {
    const incompatible = {
      format: "qemu-wasm-vmstate-manifest-v1",
      compatibility: structuredClone(tuple),
    };
    incompatible.compatibility.guest.profile = "other-profile";
    writeJson(currentManifest, incompatible);
    staticManifest.files.currentManifest = fileRecord(currentManifest);
    writeJson(staticExport, staticManifest);
    const result = await preflightVmstateStaticExport(staticExport);
    assert.equal(result.ok, false);
    assert.equal(result.browserStarted, false);
    assert.equal(result.qemuStarted, false);
    assert.equal(result.failure.code, "incompatible-restore-tuple");
    assert.equal(result.failure.field, "guest.profile");
    const cliResult = runRejectedCdp({ name: "incompatible-tuple" });
    assert.equal(
      cliResult.vmstateRestorePreflight.failure.code,
      "incompatible-restore-tuple",
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("wasm-vmstate-static-export-test: ok");
