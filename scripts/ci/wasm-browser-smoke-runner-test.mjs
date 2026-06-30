#!/usr/bin/env node
/*
 * Test browser WebAssembly smoke runner helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  appendBoundedLimit,
  browserSmokeUrl,
  consoleMessageDiagnostic,
  displayContextErrorEvidence,
  displayPixelSummary,
  initialSmokeResult,
  isTerminalPageStatus,
  pageErrorDiagnostic,
  progressSampleDiagnostic,
  promoteSmokeState,
  requestFailureDiagnostic,
  serialIdleDiagnostic,
  smokeResultSummary,
} from "./wasm-browser-smoke-runner.mjs";

const marker = "QEMU_WASM_LINUX_BOOT_OK";
const runnerPath = fileURLToPath(new URL("./wasm-browser-smoke-runner.mjs", import.meta.url));

for (const status of [
  `marker reached: ${marker}`,
  "program exited before marker: status 1",
  "timeout waiting for marker: QEMU_WASM_LINUX_BOOT_OK",
  "timeout waiting for marker or expected text: Example Linux",
  "failed",
]) {
  assert.equal(isTerminalPageStatus(status, marker), true, `${status} should be terminal`);
}

for (const status of [
  "",
  "initializing smoke harness",
  "validating browser WebAssembly features",
  "loading smoke guest inputs",
  "loading QEMU WebAssembly module",
  "starting QEMU",
  "QEMU started; waiting for marker",
  "marker reached: some-other-marker",
  "program exited after marker: status 0",
]) {
  assert.equal(isTerminalPageStatus(status, marker), false, `${status} should not be terminal`);
}

{
  const result = {};
  promoteSmokeState(result, {
    expectedTextSeen: [{ text: "Example Linux", seen: true }],
    failurePhase: "fetch-guest-inputs",
    lastLine: "last serial line",
    lines: 42,
    markerSeen: false,
    outputBytes: 1234,
    outputSuppressed: true,
    phase: "failed",
    phases: [
      { phase: "init", elapsedMs: 0, message: "initializing smoke harness" },
      { phase: "failed", elapsedMs: 10, failedDuring: "fetch-guest-inputs" },
    ],
    programExitStatus: null,
    qemuArgs: ["-M", "microvm,acpi=off", "-nic", "none"],
    runtime: {
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      webAssembly: true,
    },
  });

  assert.equal(result.phase, "failed");
  assert.equal(result.failurePhase, "fetch-guest-inputs");
  assert.equal(result.markerSeen, false);
  assert.equal(result.programExitStatus, null);
  assert.equal(result.outputLines, 42);
  assert.equal(result.outputBytes, 1234);
  assert.equal(result.outputSuppressed, true);
  assert.equal(result.lastLine, "last serial line");
  assert.deepEqual(result.expectedTextSeen, [{ text: "Example Linux", seen: true }]);
  assert.deepEqual(result.qemuCommand, ["-M", "microvm,acpi=off", "-nic", "none"]);
  assert.deepEqual(result.browserRuntime, {
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    webAssembly: true,
  });
  assert.equal(result.phases[1].failedDuring, "fetch-guest-inputs");
}

{
  const result = { untouched: true };
  promoteSmokeState(result, null);

  assert.deepEqual(result, { untouched: true });
}

{
  const blank = displayPixelSummary(
    new Uint8ClampedArray([
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
    2,
    1,
  );
  const visible = displayPixelSummary(
    new Uint8ClampedArray([
      0, 0, 0, 0,
      0, 0, 0, 255,
      10, 0, 0, 255,
      0, 5, 0, 255,
    ]),
    2,
    2,
  );

  assert.equal(blank.nonZeroPixels, 0);
  assert.equal(blank.nonTransparentPixels, 0);
  assert.equal(blank.nonBlackPixels, 0);
  assert.equal(blank.totalPixels, 2);
  assert.match(blank.hash, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(visible.nonZeroPixels, 3);
  assert.equal(visible.nonTransparentPixels, 3);
  assert.equal(visible.nonBlackPixels, 2);
  assert.equal(visible.totalPixels, 4);
  assert.notEqual(blank.hash, visible.hash);
}

{
  const transferred = displayContextErrorEvidence({
    name: "InvalidStateError",
    message: "Failed to execute 'getContext' on 'HTMLCanvasElement': Cannot get context from a canvas that has transferred its control to offscreen.",
  });
  const generic = displayContextErrorEvidence(new Error("ordinary canvas failure"));

  assert.equal(transferred.controlTransferredOffscreen, true);
  assert.equal(transferred.contextErrorName, "InvalidStateError");
  assert.match(transferred.pixelError, /transferred to OffscreenCanvas/);
  assert.equal(generic.controlTransferredOffscreen, false);
  assert.equal(generic.contextErrorName, "Error");
  assert.equal(generic.pixelError, "ordinary canvas failure");
}

{
  assert.throws(
    () => displayPixelSummary(new Uint8ClampedArray([0, 0, 0]), 1, 1),
    /display pixel data length does not match dimensions/,
  );
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: false,
    appendExtra: "ignore_loglevel",
    cpu: "Nehalem",
    display: "sdl",
    displayDevice: "virtio-gpu-pci",
    expectedResolution: "800x600",
    expectText: ["Example Linux", "systemd 261.1"],
    focusDisplay: true,
    host: "127.0.0.1",
    initrd: null,
    keyboardAfterText: "login:",
    keyboardText: "uname -a\n",
    idleAfterText: "",
    kernelAppend: "console=ttyS0 root=/dev/vda rw",
    idleTimeoutMs: 0,
    machine: "pc",
    marker,
    maxOutputBytes: 60000,
    memory: "512M",
    network: "none",
    port: 8010,
    qemuArgs: ["-name", "wasm-smoke"],
    rootfs: "/tmp/rootfs.raw",
    rootfsDevice: "virtio-pci",
    timeoutMs: 180000,
    visualMarker: "login",
  });

  assert.equal(url.href, "http://127.0.0.1:8010/?" +
    "appendExtra=ignore_loglevel&" +
    "allowSerialFallback=0&" +
    "cpu=Nehalem&" +
    "display=sdl&" +
    "displayDevice=virtio-gpu-pci&" +
    "expectedResolution=800x600&" +
    "focusDisplay=1&" +
    "marker=QEMU_WASM_LINUX_BOOT_OK&" +
    "maxOutputBytes=60000&" +
    "memory=512M&" +
    "machine=pc&" +
    "network=none&" +
    "rootfsDevice=virtio-pci&" +
    "kernelAppend=console%3DttyS0+root%3D%2Fdev%2Fvda+rw&" +
    "expectText=Example+Linux&" +
    "expectText=systemd+261.1&" +
    "initrd=&" +
    "rootfs=%2Fguest%2Frootfs.raw&" +
    "qemuArg=-name&" +
    "qemuArg=wasm-smoke&" +
    "timeoutMs=180000&" +
    "visualMarker=login");
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "",
    display: "none",
    displayDevice: "default",
    expectedResolution: "",
    expectText: [],
    focusDisplay: false,
    host: "localhost",
    initrd: "/tmp/initramfs.cpio.gz",
    keyboardAfterText: "",
    keyboardText: "",
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker,
    maxOutputBytes: 8192,
    memory: "256M",
    network: "default",
    port: 8020,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.equal(url.searchParams.has("initrd"), false);
  assert.equal(url.searchParams.has("rootfs"), false);
  assert.equal(url.searchParams.has("kernelAppend"), false);
  assert.equal(url.searchParams.get("display"), "none");
  assert.equal(url.searchParams.get("displayDevice"), "default");
  assert.equal(url.searchParams.get("expectedResolution"), "");
  assert.equal(url.searchParams.get("focusDisplay"), "0");
  assert.equal(url.searchParams.get("network"), "default");
  assert.equal(url.searchParams.get("allowSerialFallback"), "1");
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "Nehalem",
    display: "wasm",
    displayDevice: "default",
    expectedResolution: "",
    expectText: [],
    focusDisplay: true,
    harnessExpectedKeyEvents: 6,
    harnessSelfTest: true,
    host: "127.0.0.1",
    initrd: null,
    keyboardAfterText: "",
    keyboardText: "ab\n",
    idleAfterText: "",
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker: "QEMU_WASM_BROWSER_HARNESS_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    network: "none",
    port: 8010,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.equal(url.searchParams.get("harnessSelfTest"), "1");
  assert.equal(url.searchParams.get("harnessExpectedKeyEvents"), "6");
  assert.equal(url.searchParams.get("display"), "wasm");
  assert.equal(url.searchParams.get("focusDisplay"), "1");
  assert.equal(url.searchParams.get("initrd"), "");
  assert.equal(url.searchParams.has("rootfs"), false);
}

{
  const result = initialSmokeResult({
    allowSerialFallback: false,
    appendExtra: "ignore_loglevel",
    browser: "chromium",
    cpu: "Nehalem",
    display: "sdl",
    displayDevice: "virtio-gpu-pci",
    expectedResolution: "800x600",
    expectDisplayHash: "fnv1a32:2a8cd5c5",
    expectText: ["Example Linux"],
    focusDisplay: true,
    harnessExpectedKeyEvents: 6,
    harnessSelfTest: true,
    keyboardAfterText: "login:",
    keyboardText: "uname -a\n",
    idleAfterText: "",
    kernelAppend: "console=ttyS0 root=/dev/vda rw",
    idleTimeoutMs: 0,
    machine: "pc",
    marker,
    memory: "512M",
    network: "none",
    pageTextTailBytes: 60000,
    preKeyboardWaitMs: 500,
    postKeyboardWaitMs: 250,
    progressSampleIntervalMs: 10000,
    progressSampleLimit: 120,
    qemuArgs: ["-name", "wasm-smoke"],
    requireDisplayOutput: true,
    displayMinNonblackPixels: 4,
    rootfs: "/tmp/rootfs.raw",
    rootfsDevice: "virtio-pci",
    timeoutMs: 180000,
    visualMarker: "login",
  }, "HeadlessChrome/141.0.7390.37");

  assert.equal(result.format, 1);
  assert.equal(result.success, false);
  assert.equal(result.browser, "chromium");
  assert.equal(result.browserVersion, "HeadlessChrome/141.0.7390.37");
  assert.equal(result.allowSerialFallback, false);
  assert.equal(result.display, "sdl");
  assert.equal(result.displayDevice, "virtio-gpu-pci");
  assert.equal(result.expectedResolution, "800x600");
  assert.equal(result.expectDisplayHash, "fnv1a32:2a8cd5c5");
  assert.equal(result.focusDisplay, true);
  assert.equal(result.harnessExpectedKeyEvents, 6);
  assert.equal(result.harnessSelfTest, true);
  assert.equal(result.keyboardAfterText, "login:");
  assert.equal(result.keyboardTextLength, "uname -a\n".length);
  assert.equal(result.preKeyboardWaitMs, 500);
  assert.equal(result.postKeyboardWaitMs, 250);
  assert.equal(result.network, "none");
  assert.equal(result.idleAfterText, "");
  assert.equal(result.idleTimeoutMs, 0);
  assert.equal(result.requireDisplayOutput, true);
  assert.equal(result.displayMinNonblackPixels, 4);
  assert.equal(result.rootfsDevice, "virtio-pci");
  assert.equal(result.visualMarker, "login");
  assert.equal(result.maxDiagnosticEntries, 50);
  assert.deepEqual(result.expectText, ["Example Linux"]);
  assert.deepEqual(result.qemuArgs, ["-name", "wasm-smoke"]);
  assert.deepEqual(result.consoleMessages, []);
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.progressSampleErrors, []);
  assert.deepEqual(result.progressSamples, []);
  assert.deepEqual(result.requestFailures, []);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--keyboard-text", "uname -a\n",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "wasm",
    "--pre-keyboard-wait-ms", "100",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "wasm",
    "--keyboard-text", "uname -a\n",
    "--pre-keyboard-wait-ms", "-1",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "wasm",
    "--post-keyboard-wait-ms", "100",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "wasm",
    "--keyboard-text", "uname -a\n",
    "--post-keyboard-wait-ms", "-1",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "wasm",
    "--display-device", "stdvga",
    "--keyboard-text", "uname -a\n",
    "--require-display-output",
    "--timeout-ms", "1",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.notEqual(child.status, 2, child.stderr);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display-device", "stdvga",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "sdl",
    "--expected-resolution", "800*600",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "sdl",
    "--keyboard-after-text", "login:",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--require-display-output",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--initrd", "/tmp/initrd",
    "--display", "sdl",
    "--require-display-output",
    "--display-min-nonblack-pixels", "0",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
}

{
  const entries = [];
  appendBoundedLimit(entries, "first", 3);
  appendBoundedLimit(entries, "second", 3);
  appendBoundedLimit(entries, "third", 3);
  appendBoundedLimit(entries, "fourth", 3);

  assert.deepEqual(entries, ["second", "third", "fourth"]);
}

{
  const diagnostic = consoleMessageDiagnostic({
    type: () => "warning",
    text: () => "browser warning",
    location: () => ({
      url: "http://127.0.0.1:8010/wasm-browser-smoke.mjs",
      lineNumber: 12,
      columnNumber: 34,
    }),
  }, 1234);

  assert.deepEqual(diagnostic, {
    elapsedMs: 1234,
    type: "warning",
    text: "browser warning",
    location: {
      url: "http://127.0.0.1:8010/wasm-browser-smoke.mjs",
      lineNumber: 12,
      columnNumber: 34,
    },
  });
}

{
  const error = new Error("memory access out of bounds");
  error.name = "RuntimeError";
  error.stack = "RuntimeError: memory access out of bounds\n    at wasm://wasm/...";
  const state = {
    phase: "guest-boot",
    lastLine: "x86/fpu: x87 FPU will use FXSAVE",
  };

  assert.deepEqual(pageErrorDiagnostic(error, 240181, state), {
    elapsedMs: 240181,
    name: "RuntimeError",
    message: "memory access out of bounds",
    stack: "RuntimeError: memory access out of bounds\n    at wasm://wasm/...",
    state,
  });
}

{
  const diagnostic = requestFailureDiagnostic({
    method: () => "GET",
    url: () => "http://127.0.0.1:8010/qemu-system-x86_64.wasm",
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  }, 99);

  assert.deepEqual(diagnostic, {
    elapsedMs: 99,
    method: "GET",
    url: "http://127.0.0.1:8010/qemu-system-x86_64.wasm",
    failureText: "net::ERR_FAILED",
  });
}

{
  const result = {
    progressSamples: [],
  };
  const firstState = {
    lines: 100,
    outputBytes: 5000,
    lastLine: "x86/fpu: x87 FPU will use FXSAVE",
  };
  const first = progressSampleDiagnostic(result, 10000, "interval", firstState);

  assert.deepEqual(first, {
    elapsedMs: 10000,
    reason: "interval",
    state: firstState,
    lineDelta: null,
    outputByteDelta: null,
    lastLineChanged: null,
    previousElapsedMs: null,
  });

  result.progressSamples.push(first);
  const secondState = {
    lines: 100,
    outputBytes: 5000,
    lastLine: "x86/fpu: x87 FPU will use FXSAVE",
  };
  assert.deepEqual(progressSampleDiagnostic(result, 20000, "interval", secondState), {
    elapsedMs: 20000,
    reason: "interval",
    state: secondState,
    lineDelta: 0,
    outputByteDelta: 0,
    lastLineChanged: false,
    previousElapsedMs: 10000,
  });

  const thirdState = {
    lines: 103,
    outputBytes: 5120,
    lastLine: "Freeing unused kernel image memory",
  };
  assert.deepEqual(progressSampleDiagnostic(result, 30000, "interval", thirdState), {
    elapsedMs: 30000,
    reason: "interval",
    state: thirdState,
    lineDelta: 3,
    outputByteDelta: 120,
    lastLineChanged: true,
    previousElapsedMs: 10000,
  });
}

{
  assert.equal(serialIdleDiagnostic([], 10000), null);
  assert.equal(serialIdleDiagnostic([
    {
      elapsedMs: 10000,
      state: {
        lines: 0,
        outputBytes: 0,
        lastLine: "",
      },
    },
  ], 10000), null);

  const samples = [
    {
      elapsedMs: 10000,
      state: {
        lines: 100,
        outputBytes: 5000,
        lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      },
    },
    {
      elapsedMs: 20000,
      state: {
        lines: 100,
        outputBytes: 5000,
        lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      },
    },
    {
      elapsedMs: 30000,
      state: {
        lines: 100,
        outputBytes: 5000,
        lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      },
    },
  ];
  assert.equal(serialIdleDiagnostic(samples, 25000), null);
  assert.equal(serialIdleDiagnostic(samples, 20000, "Run /init"), null);
  assert.deepEqual(serialIdleDiagnostic(samples, 20000), {
    idle: true,
    idleAfterText: "",
    idleMs: 20000,
    idleSinceElapsedMs: 10000,
    idleTimeoutMs: 20000,
    lastLine: "x86/fpu: x87 FPU will use FXSAVE",
    outputBytes: 5000,
    outputLines: 100,
  });
  assert.deepEqual(
    serialIdleDiagnostic(samples, 20000, "x87 FPU will use FXSAVE"),
    {
      idle: true,
      idleAfterText: "x87 FPU will use FXSAVE",
      idleMs: 20000,
      idleSinceElapsedMs: 10000,
      idleTimeoutMs: 20000,
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      outputBytes: 5000,
      outputLines: 100,
    },
  );
  assert.equal(serialIdleDiagnostic([
    ...samples,
    {
      elapsedMs: 40000,
      state: {
        lines: 103,
        outputBytes: 5120,
        lastLine: "Freeing unused kernel image memory",
      },
    },
  ], 10000), null);
}

{
  assert.deepEqual(smokeResultSummary({
    errorName: "TimeoutError",
    errorMessage: "page wait timed out",
    lastLine: "x86/fpu: x87 FPU will use FXSAVE",
    markerSeen: false,
    outputLines: 107,
    idleTimeout: {
      idle: true,
      idleAfterText: "x87 FPU will use FXSAVE",
      idleMs: 20000,
      idleSinceElapsedMs: 220000,
      idleTimeoutMs: 20000,
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      outputBytes: 5585,
      outputLines: 107,
    },
    pageStatus: "QEMU started; waiting for marker",
    phase: "guest-boot",
    pageErrors: [
      {
        elapsedMs: 240181,
        name: "RuntimeError",
        message: "memory access out of bounds",
        state: {
          phase: "guest-boot",
          lastLine: "x86/fpu: x87 FPU will use FXSAVE",
        },
      },
    ],
    progressSamples: [
      {
        elapsedMs: 240000,
        reason: "final",
        lineDelta: 0,
        outputByteDelta: 0,
        lastLineChanged: false,
        state: {
          lastLine: "x86/fpu: x87 FPU will use FXSAVE",
        },
      },
    ],
    requestFailures: [],
    success: false,
  }), {
    success: false,
    phase: "guest-boot",
    pageStatus: "QEMU started; waiting for marker",
    markerSeen: false,
    lastLine: "x86/fpu: x87 FPU will use FXSAVE",
    outputLines: 107,
    primaryError: {
      name: "TimeoutError",
      message: "page wait timed out",
    },
    pageErrorCount: 1,
    firstPageError: {
      elapsedMs: 240181,
      name: "RuntimeError",
      message: "memory access out of bounds",
      phase: "guest-boot",
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
    },
    lastPageError: {
      elapsedMs: 240181,
      name: "RuntimeError",
      message: "memory access out of bounds",
      phase: "guest-boot",
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
    },
    requestFailureCount: 0,
    firstRequestFailure: null,
    idleTimeout: {
      idle: true,
      idleAfterText: "x87 FPU will use FXSAVE",
      idleMs: 20000,
      idleSinceElapsedMs: 220000,
      idleTimeoutMs: 20000,
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      outputBytes: 5585,
      outputLines: 107,
    },
    progressSampleCount: 1,
    lastProgressSample: {
      elapsedMs: 240000,
      reason: "final",
      lineDelta: 0,
      outputByteDelta: 0,
      lastLineChanged: false,
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
    },
  });
}
