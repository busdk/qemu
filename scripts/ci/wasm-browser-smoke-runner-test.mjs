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
  guestSerialIdleDiagnostic,
  pageErrorDiagnostic,
  progressSampleDiagnostic,
  promoteSmokeState,
  requestFailureDiagnostic,
  requestPowerOperation,
  serialIdleDiagnostic,
  smokeResultSummary,
} from "./wasm-browser-smoke-runner.mjs";
import {
  bootMilestoneForLine,
  hotBlockSummary,
  perfAttributionSummary,
  recordBootMilestone,
  recordHotBlockSummary,
  recordPerfAttributionSummary,
  recordTciProgressSummary,
  recordTciWasmSubsetSummary,
  tciProgressSummary,
  tciWasmSubsetSummary,
} from "./wasm-browser-smoke.mjs";

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
    bootMilestones: {
      count: 1,
      entries: [
        {
          id: "rootfs_mounted",
          label: "root filesystem mounted",
          elapsedMs: 1234,
          line: "VFS: Mounted root (ext4 filesystem) on device 254:0.",
        },
      ],
      byId: {
        rootfs_mounted: {
          id: "rootfs_mounted",
          label: "root filesystem mounted",
          elapsedMs: 1234,
          line: "VFS: Mounted root (ext4 filesystem) on device 254:0.",
        },
      },
      last: {
        id: "rootfs_mounted",
        label: "root filesystem mounted",
        elapsedMs: 1234,
        line: "VFS: Mounted root (ext4 filesystem) on device 254:0.",
      },
    },
    qemuArgs: ["-M", "microvm,acpi=off", "-nic", "none"],
    runtime: {
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      webAssembly: true,
    },
    serviceBridge: {
      ready: true,
      healthRequested: true,
      healthRequestId: "health-1",
      healthStatus: "ok",
    },
    powerControl: {
      requested: true,
      operation: "shutdown",
      deliveryPath: "qemu-guest-powerdown",
      completed: true,
    },
    persistentDisk: {
      enabled: true,
      mode: "opfs",
      opfsName: "proof.raw",
      path: "/persistent.raw",
      device: "virtio-pci",
      sizeBytes: 1048576,
      loadSource: "opfs",
      loadedBytes: 1048576,
      persisted: true,
      persistedBytes: 1048576,
    },
    hotBlocks: {
      enabled: true,
      summaryCount: 1,
      lastSummary: {
        event: "summary",
        tb_execs: 100,
      },
    },
    performanceAttribution: {
      enabled: true,
      summaryCount: 1,
      lastSummary: {
        event: "summary",
        events: 200,
      },
    },
    tci: {
      progress: {
        enabled: true,
        summaryCount: 1,
        lastSummary: {
          event: "summary",
          tb_entries: 300,
        },
      },
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
  assert.equal(result.bootMilestones.count, 1);
  assert.equal(result.bootMilestones.entries[0].id, "rootfs_mounted");
  assert.equal(result.bootMilestones.byId.rootfs_mounted.elapsedMs, 1234);
  assert.deepEqual(result.qemuCommand, ["-M", "microvm,acpi=off", "-nic", "none"]);
  assert.deepEqual(result.browserRuntime, {
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    webAssembly: true,
  });
  assert.deepEqual(result.serviceBridgeState, {
    ready: true,
    healthRequested: true,
    healthRequestId: "health-1",
    healthStatus: "ok",
  });
  assert.deepEqual(result.powerControlState, {
    requested: true,
    operation: "shutdown",
    deliveryPath: "qemu-guest-powerdown",
    completed: true,
  });
  assert.deepEqual(result.persistentDiskState, {
    enabled: true,
    mode: "opfs",
    opfsName: "proof.raw",
    path: "/persistent.raw",
    device: "virtio-pci",
    sizeBytes: 1048576,
    loadSource: "opfs",
    loadedBytes: 1048576,
    persisted: true,
    persistedBytes: 1048576,
  });
  assert.deepEqual(result.hotBlocks, {
    enabled: true,
    summaryCount: 1,
    lastSummary: {
      event: "summary",
      tb_execs: 100,
    },
  });
  assert.deepEqual(result.performanceAttribution, {
    enabled: true,
    summaryCount: 1,
    lastSummary: {
      event: "summary",
      events: 200,
    },
  });
  assert.deepEqual(result.tci, {
    progress: {
      enabled: true,
      summaryCount: 1,
      lastSummary: {
        event: "summary",
        tb_entries: 300,
      },
    },
  });
  assert.equal(result.phases[1].failedDuring, "fetch-guest-inputs");
}

{
  assert.deepEqual(
    bootMilestoneForLine("Linux version 6.18.36 (bus@bus-engine-os)"),
    {
      id: "kernel_linux_version",
      label: "Linux kernel version printed",
    },
  );
  assert.deepEqual(
    bootMilestoneForLine("EXT4-fs (vda): mounted filesystem 00000000 r/w"),
    {
      id: "rootfs_mounted",
      label: "root filesystem mounted",
    },
  );
  assert.deepEqual(
    bootMilestoneForLine("systemd[1]: Reached target Multi-User System."),
    {
      id: "multi_user_target",
      label: "systemd multi-user target reached",
    },
  );
  assert.deepEqual(
    bootMilestoneForLine("bus-engine-os login:"),
    {
      id: "login_prompt",
      label: "login prompt visible",
    },
  );
  assert.equal(bootMilestoneForLine("qemu-tci-wasm-subset: {}"), null);

  const state = {
    bootMilestones: {
      count: 0,
      entries: [],
      byId: {},
      last: null,
    },
  };
  const first = recordBootMilestone(
    state,
    "systemd[1]: Hostname set to <bus-engine-os>.",
    120000,
  );
  const duplicate = recordBootMilestone(
    state,
    "systemd[1]: Hostname set to <bus-engine-os>.",
    130000,
  );

  assert.equal(first.id, "systemd_hostname");
  assert.equal(duplicate.elapsedMs, 120000);
  assert.equal(state.bootMilestones.count, 1);
  assert.equal(state.bootMilestones.entries[0].elapsedMs, 120000);
  assert.equal(state.bootMilestones.byId.systemd_hostname.line, "systemd[1]: Hostname set to <bus-engine-os>.");
}

{
  const line = "qemu-tcg-hotblocks: " + JSON.stringify({
    format: 1,
    event: "summary",
    reason: "interval",
    tb_execs: 10000,
    unique_tbs: 200,
    dropped_tbs: 0,
    tci_ops: 40000,
    helper_calls: 20,
    qemu_loads: 300,
    qemu_stores: 100,
    top_blocks: [
      {
        pc: "0xffffffff81000000",
        size: 64,
        icount: 12,
        execs: 2500,
        exit0: 2000,
        exit1: 500,
      },
    ],
    top_tci_ops: [
      {
        op: "add",
        count: 9000,
      },
    ],
  });
  const parsed = hotBlockSummary(line);
  assert.equal(parsed.event, "summary");
  assert.equal(parsed.tb_execs, 10000);
  assert.equal(parsed.helper_calls, 20);
  assert.equal(parsed.top_blocks[0].pc, "0xffffffff81000000");
  assert.equal(hotBlockSummary("ordinary serial line"), null);
  assert.equal(hotBlockSummary("qemu-tcg-hotblocks: not-json"), null);
}

{
  const state = {
    hotBlocks: {
      enabled: true,
      maxSummaries: 2,
      summaryCount: 0,
      summaries: [],
      lastSummary: null,
    },
  };
  for (const value of [1, 2, 3]) {
    recordHotBlockSummary(
      state,
      `qemu-tcg-hotblocks: {"format":1,"event":"summary","tb_execs":${value}}`,
      value * 10,
    );
  }
  assert.equal(state.hotBlocks.summaryCount, 3);
  assert.equal(state.hotBlocks.summaries.length, 2);
  assert.equal(state.hotBlocks.summaries[0].tb_execs, 2);
  assert.equal(state.hotBlocks.lastSummary.elapsedMs, 30);
}

{
  const line = "qemu-wasm-perf-attrib: " + JSON.stringify({
    format: 1,
    event: "summary",
    reason: "interval",
    events: 200,
    virtio: {
      block: {
        kicks: 4,
        completions: 4,
        handle_ns: 12345,
      },
    },
    block: {
      reads: 3,
      read_bytes: 12288,
      writes: 1,
      write_bytes: 4096,
    },
  });
  const parsed = perfAttributionSummary(line);
  assert.equal(parsed.event, "summary");
  assert.equal(parsed.events, 200);
  assert.equal(parsed.virtio.block.kicks, 4);
  assert.equal(parsed.block.read_bytes, 12288);
  assert.equal(perfAttributionSummary("ordinary serial line"), null);
  assert.equal(perfAttributionSummary("qemu-wasm-perf-attrib: not-json"), null);
}

{
  const state = {
    performanceAttribution: {
      enabled: true,
      maxSummaries: 2,
      summaryCount: 0,
      summaries: [],
      lastSummary: null,
    },
  };
  for (const value of [1, 2, 3]) {
    recordPerfAttributionSummary(
      state,
      `qemu-wasm-perf-attrib: {"format":1,"event":"summary","events":${value}}`,
      value * 10,
    );
  }
  assert.equal(state.performanceAttribution.summaryCount, 3);
  assert.equal(state.performanceAttribution.summaries.length, 2);
  assert.equal(state.performanceAttribution.summaries[0].events, 2);
  assert.equal(state.performanceAttribution.lastSummary.elapsedMs, 30);
}

{
  const line = "qemu-tci-wasm-subset: " + JSON.stringify({
    format: 1,
    event: "summary",
    reason: "interval",
    attempts: 1000,
    executed: 12,
    fallback_cold: 900,
    fallback_unsupported: 88,
    max_ops_rejected: 1,
  });
  const parsed = tciWasmSubsetSummary(line);
  assert.equal(parsed.event, "summary");
  assert.equal(parsed.executed, 12);
  assert.equal(parsed.fallback_unsupported, 88);
  assert.equal(tciWasmSubsetSummary("ordinary serial line"), null);
  assert.equal(tciWasmSubsetSummary("qemu-tci-wasm-subset: not-json"), null);
}

{
  const state = {
    tci: {
      wasmSubset: {
        enabled: true,
        maxSummaries: 2,
        summaryCount: 0,
        summaries: [],
        lastSummary: null,
      },
    },
  };
  for (const value of [1, 2, 3]) {
    recordTciWasmSubsetSummary(
      state,
      `qemu-tci-wasm-subset: {"format":1,"event":"summary","executed":${value}}`,
      value * 10,
    );
  }
  assert.equal(state.tci.wasmSubset.summaryCount, 3);
  assert.equal(state.tci.wasmSubset.summaries.length, 2);
  assert.equal(state.tci.wasmSubset.summaries[0].executed, 2);
  assert.equal(state.tci.wasmSubset.lastSummary.elapsedMs, 30);
}

{
  const line = "qemu-tci-progress: " + JSON.stringify({
    format: 1,
    event: "summary",
    reason: "interval",
    elapsed_ms: 1234,
    tb_entries: 5000000,
    dispatches: 4900000,
    tb_ptr: "0x1234",
  });
  const parsed = tciProgressSummary(line);
  assert.equal(parsed.event, "summary");
  assert.equal(parsed.tb_entries, 5000000);
  assert.equal(parsed.dispatches, 4900000);
  assert.equal(parsed.tb_ptr, "0x1234");
  assert.equal(tciProgressSummary("ordinary serial line"), null);
  assert.equal(tciProgressSummary("qemu-tci-progress: not-json"), null);
}

{
  const state = {
    tci: {
      progress: {
        enabled: true,
        maxSummaries: 2,
        summaryCount: 0,
        summaries: [],
        lastSummary: null,
      },
    },
  };
  for (const value of [1, 2, 3]) {
    recordTciProgressSummary(
      state,
      `qemu-tci-progress: {"format":1,"event":"summary","tb_entries":${value}}`,
      value * 10,
    );
  }
  assert.equal(state.tci.progress.summaryCount, 3);
  assert.equal(state.tci.progress.summaries.length, 2);
  assert.equal(state.tci.progress.summaries[0].tb_entries, 2);
  assert.equal(state.tci.progress.lastSummary.elapsedMs, 30);
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
    persistentDisk: true,
    persistentDiskDevice: "virtio-pci",
    persistentDiskOpfsName: "virtual-server-state.raw",
    persistentDiskPath: "/guest/persistent.raw",
    persistentDiskSizeBytes: 33554432,
    powerOperation: "shutdown",
    powerTimeoutMs: 15000,
    qemuArgs: ["-name", "wasm-smoke"],
    rootfs: "/tmp/rootfs.raw",
    rootfsDevice: "virtio-pci",
    rootfsOpfsName: "virtual-server.raw",
    rootfsStorage: "opfs-snapshot",
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
    "persistentDisk=1&" +
    "persistentDiskDevice=virtio-pci&" +
    "persistentDiskOpfsName=virtual-server-state.raw&" +
    "persistentDiskPath=%2Fguest%2Fpersistent.raw&" +
    "persistentDiskSizeBytes=33554432&" +
    "persistentDiskStorage=opfs&" +
    "powerOperation=shutdown&" +
    "powerTimeoutMs=15000&" +
    "rootfsDevice=virtio-pci&" +
    "rootfsStorage=opfs-snapshot&" +
    "rootfsOpfsName=virtual-server.raw&" +
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
    powerOperation: "",
    powerTimeoutMs: 30000,
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
  assert.equal(url.searchParams.get("powerOperation"), "");
  assert.equal(url.searchParams.get("powerTimeoutMs"), "30000");
  assert.equal(url.searchParams.get("allowSerialFallback"), "1");
  assert.equal(url.searchParams.has("rootfsStorage"), false);
  assert.equal(url.searchParams.has("rootfsOpfsName"), false);
  assert.equal(url.searchParams.has("tcgHotblocks"), false);
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "Nehalem",
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
    network: "none",
    port: 8020,
    powerOperation: "",
    powerTimeoutMs: 30000,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    tcgHotblocks: true,
    tcgHotblocksInterval: 77,
    tcgHotblocksOpLimit: 4096,
    tcgHotblocksOpSample: 1024,
    tcgHotblocksTop: 5,
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.equal(url.searchParams.get("tcgHotblocks"), "1");
  assert.equal(url.searchParams.get("tcgHotblocksInterval"), "77");
  assert.equal(url.searchParams.get("tcgHotblocksOpLimit"), "4096");
  assert.equal(url.searchParams.get("tcgHotblocksOpSample"), "1024");
  assert.equal(url.searchParams.get("tcgHotblocksTop"), "5");
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "Nehalem",
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
    network: "none",
    port: 8020,
    powerOperation: "",
    powerTimeoutMs: 30000,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    tciProgress: true,
    tciProgressInterval: 2000000,
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.equal(url.searchParams.get("tciProgress"), "1");
  assert.equal(url.searchParams.get("tciProgressInterval"), "2000000");
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "Nehalem",
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
    network: "none",
    port: 8020,
    powerOperation: "",
    powerTimeoutMs: 30000,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    tciWasmSubset: true,
    tciWasmGeneratedOnly: true,
    tciWasmSubsetInterval: 10000,
    tciWasmSubsetMaxOps: 64,
    tciWasmSubsetThreshold: 4,
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.equal(url.searchParams.get("tciWasmSubset"), "1");
  assert.equal(url.searchParams.get("tciWasmGeneratedOnly"), "1");
  assert.equal(url.searchParams.get("tciWasmSubsetInterval"), "10000");
  assert.equal(url.searchParams.get("tciWasmSubsetMaxOps"), "64");
  assert.equal(url.searchParams.get("tciWasmSubsetThreshold"), "4");
}

{
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "Nehalem",
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
    network: "none",
    performanceAttribution: true,
    performanceAttributionInterval: 25,
    port: 8020,
    powerOperation: "",
    powerTimeoutMs: 30000,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.equal(url.searchParams.get("performanceAttribution"), "1");
  assert.equal(url.searchParams.get("performanceAttributionInterval"), "25");
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
    powerOperation: "",
    powerTimeoutMs: 30000,
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
  const serviceBridge = {
    kind: "virtio-serial-jsonl",
    requestChannel: "org.qemu.wasm.service.request",
    responseChannel: "org.qemu.wasm.service.response",
    readinessMarker: "QEMU_WASM_SERVICE_READY",
    healthRequest: {
      id: "health-1",
      operation: "health",
    },
    timeoutMs: 5000,
    maxPayloadBytes: 4096,
    interactiveOnly: false,
  };
  const url = browserSmokeUrl({
    allowSerialFallback: true,
    appendExtra: "",
    cpu: "Nehalem",
    display: "none",
    displayDevice: "default",
    expectedResolution: "",
    expectText: [],
    focusDisplay: false,
    host: "127.0.0.1",
    initrd: "/tmp/initramfs.cpio.gz",
    keyboardAfterText: "",
    keyboardText: "",
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker,
    maxOutputBytes: 60000,
    memory: "512M",
    network: "none",
    port: 8010,
    powerOperation: "",
    powerTimeoutMs: 30000,
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    serviceBridge,
    timeoutMs: 30000,
    visualMarker: "",
  });

  assert.deepEqual(JSON.parse(url.searchParams.get("serviceBridge")), serviceBridge);
}

{
  const result = {};
  const page = {
    async evaluate(callback, payload) {
      assert.deepEqual(payload, {
        operation: "force-reset",
        timeoutMs: 3210,
      });
      globalThis.qemuWasmPowerControl = {
        state: {
          requested: true,
          operation: "force-reset",
          deliveryPath: "qemu-forced",
          completed: true,
        },
        async request(operation, options) {
          assert.equal(operation, "force-reset");
          assert.deepEqual(options, { timeoutMs: 3210 });
        },
      };
      try {
        return await callback(payload);
      } finally {
        delete globalThis.qemuWasmPowerControl;
      }
    },
  };

  await requestPowerOperation(
    page,
    { powerOperation: "force-reset", powerTimeoutMs: 3210 },
    result,
  );

  assert.deepEqual(result.powerOperation, {
    operation: "force-reset",
    state: {
      requested: true,
      operation: "force-reset",
      deliveryPath: "qemu-forced",
      completed: true,
    },
  });
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
    persistentDisk: true,
    persistentDiskDevice: "virtio-pci",
    persistentDiskOpfsName: "virtual-server-state.raw",
    persistentDiskPath: "/guest/persistent.raw",
    persistentDiskSizeBytes: 33554432,
    performanceAttribution: true,
    performanceAttributionInterval: 25,
    preKeyboardWaitMs: 500,
    postKeyboardWaitMs: 250,
    powerOperation: "shutdown",
    powerTimeoutMs: 15000,
    progressSampleIntervalMs: 10000,
    progressSampleLimit: 120,
    qemuArgs: ["-name", "wasm-smoke"],
    requireDisplayOutput: true,
    displayMinNonblackPixels: 4,
    rootfs: "/tmp/rootfs.raw",
    rootfsDevice: "virtio-pci",
    serviceBridge: {
      kind: "virtio-console-jsonl",
      requestChannel: "org.qemu.wasm.service.request",
      responseChannel: "org.qemu.wasm.service.response",
      readinessMarker: "QEMU_WASM_SERVICE_READY",
      healthRequest: {
        operation: "health",
      },
      timeoutMs: 5000,
      maxPayloadBytes: 4096,
      interactiveOnly: false,
    },
    timeoutMs: 180000,
    tciProgress: true,
    tciProgressInterval: 2000000,
    tciWasmSubset: true,
    tciWasmGeneratedOnly: true,
    tciWasmSubsetInterval: 10000,
    tciWasmSubsetMaxOps: 64,
    tciWasmSubsetThreshold: 4,
    userDataDir: "/tmp/qemu-wasm-profile",
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
  assert.equal(result.powerOperation, "shutdown");
  assert.equal(result.powerTimeoutMs, 15000);
  assert.equal(result.network, "none");
  assert.equal(result.persistentDisk, true);
  assert.equal(result.persistentDiskDevice, "virtio-pci");
  assert.equal(result.persistentDiskOpfsName, "virtual-server-state.raw");
  assert.equal(result.persistentDiskPath, "/guest/persistent.raw");
  assert.equal(result.persistentDiskSizeBytes, 33554432);
  assert.equal(result.idleAfterText, "");
  assert.equal(result.idleTimeoutMs, 0);
  assert.equal(result.performanceAttribution, true);
  assert.equal(result.performanceAttributionInterval, 25);
  assert.equal(result.requireDisplayOutput, true);
  assert.equal(result.displayMinNonblackPixels, 4);
  assert.equal(result.rootfsDevice, "virtio-pci");
  assert.equal(result.tciProgress, true);
  assert.equal(result.tciProgressInterval, 2000000);
  assert.equal(result.tciWasmSubset, true);
  assert.equal(result.tciWasmGeneratedOnly, true);
  assert.equal(result.tciWasmSubsetInterval, 10000);
  assert.equal(result.tciWasmSubsetMaxOps, 64);
  assert.equal(result.tciWasmSubsetThreshold, 4);
  assert.equal(result.userDataDir, "/tmp/qemu-wasm-profile");
  assert.equal(result.visualMarker, "login");
  assert.deepEqual(result.serviceBridge, {
    kind: "virtio-console-jsonl",
    requestChannel: "org.qemu.wasm.service.request",
    responseChannel: "org.qemu.wasm.service.response",
    readinessMarker: "QEMU_WASM_SERVICE_READY",
    healthRequest: {
      operation: "health",
    },
    timeoutMs: 5000,
    maxPayloadBytes: 4096,
    interactiveOnly: false,
  });
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
    "--rootfs-storage", "opfs-snapshot",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
  assert.match(
    `${child.stdout}${child.stderr}`,
    /--rootfs-storage opfs-snapshot requires --rootfs/,
  );
}

{
  const child = spawnSync(process.execPath, [
    runnerPath,
    "--artifact-dir", "/tmp/artifacts",
    "--kernel", "/tmp/kernel",
    "--rootfs", "/tmp/rootfs.raw",
    "--rootfs-storage", "opfs-snapshot",
    "--rootfs-opfs-name", "bad/name.raw",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(child.status, 2);
  assert.match(
    `${child.stdout}${child.stderr}`,
    /--rootfs-opfs-name must be a non-empty file name/,
  );
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
    guestLineDelta: null,
    guestOutputByteDelta: null,
    guestHeartbeatDelta: null,
    lastLineChanged: null,
    guestLastLineChanged: null,
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
    guestLineDelta: null,
    guestOutputByteDelta: null,
    guestHeartbeatDelta: null,
    lastLineChanged: false,
    guestLastLineChanged: false,
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
    guestLineDelta: null,
    guestOutputByteDelta: null,
    guestHeartbeatDelta: null,
    lastLineChanged: true,
    guestLastLineChanged: false,
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
  const samples = [
    {
      elapsedMs: 10000,
      state: {
        lines: 100,
        outputBytes: 5000,
        lastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
        guestLines: 100,
        guestOutputBytes: 5000,
        guestLastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
      },
    },
    {
      elapsedMs: 20000,
      state: {
        lines: 110,
        outputBytes: 5600,
        lastLine: "qemu-tci-wasm-subset: {\"event\":\"summary\"}",
        guestLines: 100,
        guestOutputBytes: 5000,
        guestLastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
      },
    },
    {
      elapsedMs: 30000,
      state: {
        lines: 120,
        outputBytes: 6200,
        lastLine: "qemu-tci-wasm-subset: {\"event\":\"summary\"}",
        guestLines: 100,
        guestOutputBytes: 5000,
        guestLastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
      },
    },
  ];
  assert.equal(serialIdleDiagnostic(samples, 20000), null);
  assert.deepEqual(guestSerialIdleDiagnostic(samples, 20000), {
    idle: true,
    idleAfterText: "",
    idleMs: 20000,
    idleSinceElapsedMs: 10000,
    idleTimeoutMs: 20000,
    lastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
    outputBytes: 5000,
    outputLines: 100,
  });
  assert.deepEqual(
    guestSerialIdleDiagnostic(samples, 20000, "/sys/fs/bpf"),
    {
      idle: true,
      idleAfterText: "/sys/fs/bpf",
      idleMs: 20000,
      idleSinceElapsedMs: 10000,
      idleTimeoutMs: 20000,
      lastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
      outputBytes: 5000,
      outputLines: 100,
    },
  );
  assert.equal(guestSerialIdleDiagnostic(samples, 20000, "multi-user"), null);

  const heartbeatSamples = [
    {
      elapsedMs: 10000,
      state: {
        lines: 100,
        outputBytes: 5000,
        lastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
        guestLines: 100,
        guestOutputBytes: 5000,
        guestLastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
        guestHeartbeat: {
          count: 0,
          lastLine: "",
        },
      },
    },
    {
      elapsedMs: 20000,
      state: {
        lines: 101,
        outputBytes: 5075,
        lastLine: "bus-engine-os-heartbeat: seq=1 event=tick",
        guestLines: 100,
        guestOutputBytes: 5000,
        guestLastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
        guestHeartbeat: {
          count: 1,
          lastLine: "bus-engine-os-heartbeat: seq=1 event=tick",
        },
      },
    },
    {
      elapsedMs: 30000,
      state: {
        lines: 102,
        outputBytes: 5150,
        lastLine: "bus-engine-os-heartbeat: seq=2 event=tick",
        guestLines: 100,
        guestOutputBytes: 5000,
        guestLastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
        guestHeartbeat: {
          count: 2,
          lastLine: "bus-engine-os-heartbeat: seq=2 event=tick",
        },
      },
    },
  ];
  assert.equal(serialIdleDiagnostic(heartbeatSamples, 20000), null);
  assert.deepEqual(guestSerialIdleDiagnostic(heartbeatSamples, 20000), {
    idle: true,
    idleAfterText: "",
    idleMs: 20000,
    idleSinceElapsedMs: 10000,
    idleTimeoutMs: 20000,
    lastLine: "systemd[1]: Mounting bpf on /sys/fs/bpf...",
    outputBytes: 5000,
    outputLines: 100,
  });
  const heartbeatProgress = progressSampleDiagnostic({
    progressSamples: [
      {
        elapsedMs: 20000,
        state: heartbeatSamples[1].state,
      },
    ],
  }, 30000, "sample", heartbeatSamples[2].state);
  assert.equal(heartbeatProgress.guestHeartbeatDelta, 1);
  assert.equal(heartbeatProgress.guestOutputByteDelta, 0);
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
    guestIdleTimeout: null,
    progressSampleCount: 1,
    lastProgressSample: {
      elapsedMs: 240000,
      reason: "final",
      lineDelta: 0,
      outputByteDelta: 0,
      guestLineDelta: null,
      guestOutputByteDelta: null,
      guestHeartbeatDelta: null,
      lastLineChanged: false,
      guestLastLineChanged: null,
      lastLine: "x86/fpu: x87 FPU will use FXSAVE",
      guestLastLine: null,
    },
    bootMilestones: null,
  });
}
