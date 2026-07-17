#!/usr/bin/env node
/*
 * Test dependency-free Chrome DevTools Protocol gate helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  browserVersionDiagnostic,
  cdpConsoleMessageDiagnostic,
  cdpResourceErrorDiagnostic,
  createServiceRequestId,
  parseArgs,
  proofInputEvidence,
  runServiceRoundtripInPage,
  serviceRoundtripSucceeded,
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
  qemuArgs: ["-device", "virtio-rng-device"],
  rootfs: "/tmp/qemu-guest/rootfs.raw",
  rootfsDevice: "virtio-mmio",
  serviceRequestOperation: "initialize",
  serviceRequestTimeoutMs: 10000,
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
assert.deepEqual(url.searchParams.getAll("qemuArg"), [
  "-device",
  "virtio-rng-device",
]);
assert.deepEqual(JSON.parse(url.searchParams.get("serviceBridge")), {
  kind: "virtio-serial-jsonl",
  requestChannel: "org.qemu.wasm.service.request",
  responseChannel: "org.qemu.wasm.service.response",
  readinessMarker: "QEMU_WASM_SERVICE_READY",
  healthRequest: { operation: "health" },
  timeoutMs: 10000,
  maxPayloadBytes: 16384,
  interactiveOnly: true,
});

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
  "--qemu-arg", "-device",
  "--qemu-arg", "virtio-rng-device",
  "--service-request-operation", "initialize",
  "--service-request-timeout-ms", "10000",
  "--out", "/tmp/qemu-cdp-gate-result.json",
]);
assert.equal(manifestOptions.artifactDir, "/tmp/explicit-artifacts");
assert.equal(manifestOptions.firmwareDir, join(manifestDir, "firmware"));
assert.equal(manifestOptions.kernel, join(manifestDir, "Image"));
assert.equal(manifestOptions.initrd, null);
assert.equal(manifestOptions.rootfs, join(manifestDir, "rootfs.raw"));
assert.equal(manifestOptions.targetArch, "riscv64");
assert.equal(manifestOptions.guestManifest, manifestPath);
assert.deepEqual(manifestOptions.qemuArgs, ["-device", "virtio-rng-device"]);
assert.equal(manifestOptions.serviceRequestOperation, "initialize");
assert.equal(manifestOptions.serviceRequestTimeoutMs, 10000);

const serviceRequestId = createServiceRequestId(
  "01234567-89ab-4cde-8fab-0123456789ab",
);
assert.equal(
  serviceRequestId,
  "gate2-initialize-01234567-89ab-4cde-8fab-0123456789ab",
);

function serviceBridgeState(overrides = {}) {
  return {
    ready: true,
    readySource: "serial",
    moduleAttached: true,
    interactiveOnly: true,
    healthRequested: false,
    pending: 0,
    sent: 0,
    received: 0,
    resolved: 0,
    timedOut: 0,
    lastRequestId: null,
    lastResponseId: null,
    ...overrides,
  };
}

function monotonicNow(...values) {
  let index = 0;
  return () => values[index++];
}

const safetyRegressionFailures = [];

async function checkSafetyRegression(name, callback) {
  try {
    await callback();
  } catch (error) {
    safetyRegressionFailures.push(`${name}: ${error.message}`);
  }
}

await checkSafetyRegression("literal initialize timeout", () => {
  const moduleUrl =
    new URL("./wasm-browser-cdp-gate.mjs", import.meta.url).href;
  const script = `
    const { parseArgs } = await import(${JSON.stringify(moduleUrl)});
    await parseArgs([
      "--artifact-dir", "/tmp/artifacts",
      "--kernel", "/tmp/Image",
      "--initrd", "/tmp/initrd",
      "--out", "/tmp/result.json",
      "--service-request-operation", "initialize",
      "--service-request-timeout-ms", "60000",
    ]);
  `;
  const probe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
  ], { encoding: "utf8" });
  assert.equal(probe.status, 2);
  assert.match(
    probe.stderr,
    /--service-request-timeout-ms must be exactly 10000 for initialize/,
  );
});

let successfulServiceRoundtripEvidence = null;

{
  const state = serviceBridgeState();
  const scope = {
    qemuWasmServiceBridge: {
      state,
      async request(frame, requestOptions) {
        assert.deepEqual(frame, {
          id: serviceRequestId,
          operation: "initialize",
        });
        assert.deepEqual(requestOptions, { timeoutMs: 10000 });
        state.pending = 1;
        state.sent += 1;
        state.lastRequestId = frame.id;
        await Promise.resolve();
        state.received += 1;
        state.resolved += 1;
        state.pending = 0;
        state.lastResponseId = frame.id;
        return {
          id: frame.id,
          operation: "initialize",
          status: "ok",
          adapter: "ready",
          app_server: "initialized",
        };
      },
    },
  };
  const evidence = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 10000,
  }, scope, monotonicNow(100, 112.5));
  successfulServiceRoundtripEvidence = evidence;
  assert.equal(serviceRoundtripSucceeded(evidence), true);
  assert.equal(evidence.readiness.healthRequestedBefore, false);
  assert.equal(evidence.readiness.healthRequestedAfter, false);
  assert.equal(evidence.transport.pendingBefore, 0);
  assert.equal(evidence.transport.pendingAfter, 0);
  assert.equal(evidence.transport.sentAfter - evidence.transport.sentBefore, 1);
  assert.equal(
    evidence.transport.receivedAfter - evidence.transport.receivedBefore,
    1,
  );
  assert.equal(
    evidence.transport.resolvedAfter - evidence.transport.resolvedBefore,
    1,
  );
  assert.equal(evidence.transport.lastRequestId, serviceRequestId);
  assert.equal(evidence.transport.lastResponseId, serviceRequestId);
  assert.equal(evidence.response.id, serviceRequestId);
  assert.equal(evidence.response.adapter, "ready");
  assert.equal(evidence.response.app_server, "initialized");
  assert.equal(evidence.timing.elapsedMs, 12.5);
  assert.equal(Object.hasOwn(evidence, "cAccepted"), false);

  for (const mutate of [
    (copy) => { copy.readiness.healthRequestedAfter = true; },
    (copy) => { copy.transport.pendingBefore = 1; },
    (copy) => { copy.transport.sentAfter += 1; },
    (copy) => { copy.transport.lastResponseId = "mismatched"; },
    (copy) => { copy.response.adapter = "wrong"; },
    (copy) => { copy.response.app_server = "wrong"; },
    (copy) => { copy.classification = "timeout"; },
    (copy) => { copy.timing.elapsedMs = 10001; },
  ]) {
    const broken = JSON.parse(JSON.stringify(evidence));
    mutate(broken);
    assert.equal(serviceRoundtripSucceeded(broken), false);
  }
}

await checkSafetyRegression("60000 ms request with 15000 ms elapsed", async () => {
  const state = serviceBridgeState();
  let calls = 0;
  const evidence = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 60000,
  }, {
    qemuWasmServiceBridge: {
      state,
      async request(frame) {
        calls += 1;
        state.pending = 1;
        state.sent += 1;
        state.lastRequestId = frame.id;
        state.received += 1;
        state.resolved += 1;
        state.pending = 0;
        state.lastResponseId = frame.id;
        return {
          id: frame.id,
          operation: "initialize",
          status: "ok",
          adapter: "ready",
          app_server: "initialized",
        };
      },
    },
  }, monotonicNow(1000, 16000));
  assert.equal(calls, 0);
  assert.equal(evidence.classification, "precondition-failed");
  assert.equal(serviceRoundtripSucceeded(evidence), false);
});

for (const [name, beforeField, afterField, beforeValue, afterValue] of [
  ["sent", "sentBefore", "sentAfter", -3, -2],
  ["received", "receivedBefore", "receivedAfter", -4, -3],
  ["resolved", "resolvedBefore", "resolvedAfter", -5, -4],
  ["timedOut", "timedOutBefore", "timedOutAfter", -6, -6],
]) {
  await checkSafetyRegression(`nonnegative ${name} counters`, () => {
    const evidence =
      JSON.parse(JSON.stringify(successfulServiceRoundtripEvidence));
    evidence.transport[beforeField] = beforeValue;
    evidence.transport[afterField] = afterValue;
    assert.equal(serviceRoundtripSucceeded(evidence), false);
  });
}

await checkSafetyRegression("whole result smoke-state redaction", async () => {
  const sentinel = "sk-unmatched-response-status";
  const state = serviceBridgeState({
    received: 1,
    lastResponseId: "unmatched-response",
    lastResponseStatus: sentinel,
  });
  const capturedFinalState = {
    markerSeen: true,
    serviceBridge: JSON.parse(JSON.stringify(state)),
  };
  const serviceRoundtrip = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 10000,
  }, {
    qemuWasmServiceBridge: {
      state,
      async request(frame) {
        state.pending = 1;
        state.sent += 1;
        state.lastRequestId = frame.id;
        state.received += 1;
        state.resolved += 1;
        state.pending = 0;
        state.lastResponseId = frame.id;
        state.lastResponseStatus = "ok";
        return {
          id: frame.id,
          operation: "initialize",
          status: "ok",
          adapter: "ready",
          app_server: "initialized",
        };
      },
    },
  }, monotonicNow(180, 181));
  assert.equal(serviceRoundtripSucceeded(serviceRoundtrip), true);
  const completeResult = {
    format: 1,
    success: true,
    browserStarted: true,
    qemuStarted: true,
    markerSeen: true,
    serviceRoundtrip,
    smokeState: capturedFinalState,
  };
  const gateModule =
    await import("./wasm-browser-cdp-gate.mjs");
  const serializeResult = typeof gateModule.serializeCdpResult === "function"
    ? gateModule.serializeCdpResult
    : (result) => JSON.stringify(result, null, 2);
  const serializedResult = serializeResult(completeResult);
  assert.equal(serializedResult.includes(sentinel), false);
  const parsedResult = JSON.parse(serializedResult);
  assert.equal(parsedResult.success, true);
  assert.equal(
    serviceRoundtripSucceeded(parsedResult.serviceRoundtrip),
    true,
  );
  assert.equal(
    Object.hasOwn(parsedResult.smokeState, "serviceBridge"),
    false,
  );
});

{
  const state = serviceBridgeState();
  const scope = {
    qemuWasmServiceBridge: {
      state,
      async request(frame) {
        state.pending = 1;
        state.sent += 1;
        state.lastRequestId = frame.id;
        state.received += 1;
        state.resolved += 1;
        state.pending = 0;
        state.lastResponseId = frame.id;
        return {
          id: frame.id,
          operation: "initialize",
          status: "ok",
          adapter: "ready",
          app_server: "initialized",
          body: "must-not-be-retained",
        };
      },
    },
  };
  const evidence = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 10000,
  }, scope, monotonicNow(200, 201));
  assert.equal(evidence.responseProjectionSafe, false);
  assert.equal(serviceRoundtripSucceeded(evidence), false);
  assert.equal(JSON.stringify(evidence).includes("must-not-be-retained"), false);
  assert.equal(Object.hasOwn(evidence.response, "body"), false);
}

await checkSafetyRegression("guest scalar sentinel redaction", async () => {
  const sentinel = "sk-retained-secret";
  const state = serviceBridgeState();
  const evidence = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 10000,
  }, {
    qemuWasmServiceBridge: {
      state,
      async request(frame) {
        state.pending = 1;
        state.sent += 1;
        state.lastRequestId = frame.id;
        state.received += 1;
        state.resolved += 1;
        state.pending = 0;
        state.lastResponseId = sentinel;
        return {
          id: sentinel,
          operation: sentinel,
          status: sentinel,
          adapter: sentinel,
          app_server: sentinel,
          error: sentinel,
        };
      },
    },
  }, monotonicNow(250, 251));
  assert.equal(JSON.stringify(evidence).includes(sentinel), false);
  assert.deepEqual(evidence.response, {
    id: null,
    operation: null,
    status: null,
    adapter: null,
    app_server: null,
  });
  assert.equal(evidence.transport.lastResponseId, null);
  assert.equal(evidence.classification, "error");
  assert.equal(serviceRoundtripSucceeded(evidence), false);
});

{
  const state = serviceBridgeState();
  let calls = 0;
  const scope = {
    qemuWasmServiceBridge: {
      state,
      async request(frame) {
        calls += 1;
        state.pending = 1;
        state.sent += 1;
        state.lastRequestId = frame.id;
        state.pending = 0;
        state.timedOut += 1;
        throw new Error("secret timeout detail");
      },
    },
  };
  const evidence = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 10000,
  }, scope, monotonicNow(300, 10300));
  assert.equal(calls, 1);
  assert.equal(evidence.classification, "timeout");
  assert.equal(serviceRoundtripSucceeded(evidence), false);
  assert.equal(JSON.stringify(evidence).includes("secret timeout detail"), false);
}

{
  const state = serviceBridgeState({ pending: 1 });
  let calls = 0;
  const evidence = await runServiceRoundtripInPage({
    operation: "initialize",
    requestId: serviceRequestId,
    timeoutMs: 10000,
  }, {
    qemuWasmServiceBridge: {
      state,
      request() {
        calls += 1;
      },
    },
  }, monotonicNow(400, 401));
  assert.equal(calls, 0);
  assert.equal(evidence.classification, "precondition-failed");
  assert.equal(serviceRoundtripSucceeded(evidence), false);
}

assert.deepEqual(safetyRegressionFailures, []);

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
        hostKind: "wasm-browser",
        launcherSha256: "f".repeat(64),
        moduleSha256: "d".repeat(64),
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
