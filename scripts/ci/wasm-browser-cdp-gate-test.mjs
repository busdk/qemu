#!/usr/bin/env node
/*
 * Test dependency-free Chrome DevTools Protocol gate helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  smokeServerArgs,
  smokeUrl,
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

const manifestDir = mkdtempSync(join(tmpdir(), "qemu-cdp-gate-manifest-"));
const manifestPath = join(manifestDir, "guest.json");
writeFileSync(manifestPath, JSON.stringify({
  target_arch: "riscv64",
  default_parameters: {
    firmwareDir: "firmware",
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
assert.equal(manifestOptions.rootfs, join(manifestDir, "rootfs.raw"));
assert.equal(manifestOptions.targetArch, "riscv64");
