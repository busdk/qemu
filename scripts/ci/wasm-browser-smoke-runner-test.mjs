#!/usr/bin/env node
/*
 * Test browser WebAssembly smoke runner helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  browserSmokeUrl,
  isTerminalPageStatus,
  promoteSmokeState,
} from "./wasm-browser-smoke-runner.mjs";

const marker = "QEMU_WASM_LINUX_BOOT_OK";

for (const status of [
  `marker reached: ${marker}`,
  "program exited before marker: status 1",
  "timeout waiting for marker: QEMU_WASM_LINUX_BOOT_OK",
  "timeout waiting for marker or expected text: Bus Engine OS",
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
    expectedTextSeen: [{ text: "Bus Engine OS", seen: true }],
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
  });

  assert.equal(result.phase, "failed");
  assert.equal(result.failurePhase, "fetch-guest-inputs");
  assert.equal(result.markerSeen, false);
  assert.equal(result.programExitStatus, null);
  assert.equal(result.outputLines, 42);
  assert.equal(result.outputBytes, 1234);
  assert.equal(result.outputSuppressed, true);
  assert.equal(result.lastLine, "last serial line");
  assert.deepEqual(result.expectedTextSeen, [{ text: "Bus Engine OS", seen: true }]);
  assert.deepEqual(result.qemuCommand, ["-M", "microvm,acpi=off", "-nic", "none"]);
  assert.equal(result.phases[1].failedDuring, "fetch-guest-inputs");
}

{
  const result = { untouched: true };
  promoteSmokeState(result, null);

  assert.deepEqual(result, { untouched: true });
}

{
  const url = browserSmokeUrl({
    appendExtra: "ignore_loglevel",
    cpu: "Nehalem",
    expectText: ["Bus Engine OS", "systemd 261.1"],
    host: "127.0.0.1",
    initrd: null,
    kernelAppend: "console=ttyS0 root=/dev/vda rw",
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
  });

  assert.equal(url.href, "http://127.0.0.1:8010/?" +
    "appendExtra=ignore_loglevel&" +
    "cpu=Nehalem&" +
    "marker=QEMU_WASM_LINUX_BOOT_OK&" +
    "maxOutputBytes=60000&" +
    "memory=512M&" +
    "machine=pc&" +
    "network=none&" +
    "rootfsDevice=virtio-pci&" +
    "kernelAppend=console%3DttyS0+root%3D%2Fdev%2Fvda+rw&" +
    "expectText=Bus+Engine+OS&" +
    "expectText=systemd+261.1&" +
    "initrd=&" +
    "rootfs=%2Fguest%2Frootfs.raw&" +
    "qemuArg=-name&" +
    "qemuArg=wasm-smoke&" +
    "timeoutMs=180000");
}

{
  const url = browserSmokeUrl({
    appendExtra: "",
    cpu: "",
    expectText: [],
    host: "localhost",
    initrd: "/tmp/initramfs.cpio.gz",
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
  });

  assert.equal(url.searchParams.has("initrd"), false);
  assert.equal(url.searchParams.has("rootfs"), false);
  assert.equal(url.searchParams.has("kernelAppend"), false);
  assert.equal(url.searchParams.get("network"), "default");
}
