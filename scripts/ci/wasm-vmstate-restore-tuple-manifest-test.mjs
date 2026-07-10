#!/usr/bin/env node
/*
 * Test strict browser-restore VMState tuple manifest emission.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareVmstateManifests } from "./wasm-vmstate-manifest.mjs";
import { emitRestoreTupleManifests } from "./wasm-vmstate-restore-tuple-manifest.mjs";

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

function guestManifest(dir, kernel, rootfs, defaults = {}) {
  const path = join(dir, "browser-hosted-manifest.json");
  const manifest = {
    files: [
      {
        role: "kernel",
        path: kernel.path,
        sha256: kernel.sha256,
        size_bytes: kernel.bytes,
      },
      {
        role: "rootfs",
        path: rootfs.path,
        sha256: rootfs.sha256,
        size_bytes: rootfs.bytes,
      },
    ],
    default_parameters: {
      kernelAppend: "console=ttyS0 root=/dev/vda rw",
      machine: "virt",
      memory: "512M",
      rootfsDevice: "virtio-mmio",
      ...defaults,
    },
  };

  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

function proof({
  drive,
  kernel,
  qemu,
  resumeDevice = drive,
  rootfs,
  sourceCommand,
  state,
}) {
  return {
    drive,
    kernel,
    kernelAppend: "console=ttyS0 root=/dev/vda rw",
    machine: "virt",
    memory: "512M",
    qemu: qemu.path,
    resumeDevice,
    rootfs,
    sourceCommand,
    state,
  };
}

const dir = mkdtempSync(join(tmpdir(), "qemu-vmstate-restore-tuple-test-"));
const qemu = writeFixture(dir, "qemu-system-riscv64", "same qemu bytes\n");
const qemuJs = writeFixture(dir, "qemu-system-riscv64.js", "launcher\n");
const qemuWasm = writeFixture(dir, "qemu-system-riscv64.wasm", "same qemu bytes\n");
const kernel = writeFixture(dir, "Image", "kernel\n");
const rootfs = writeFixture(dir, "rootfs.raw", "rootfs\n");
const state = writeFixture(dir, "state.vmstate", Buffer.from([0, 1, 2, 3]));
const virtioMmioDrive =
  "-drive file=/rootfs.raw,format=raw,if=none,id=hd0 -device virtio-blk-device,drive=hd0";
const rngObject = "-object rng-random,id=rng0,filename=/dev/urandom";
const rngDevice = "-device virtio-rng-device,rng=rng0";
const noNetwork = "-nic none";
const compatible = emitRestoreTupleManifests(
  proof({
    drive: virtioMmioDrive,
    kernel,
    qemu,
    resumeDevice: "virtio-blk-device",
    rootfs,
    sourceCommand: [
      "qemu-system-riscv64",
      "-display",
      "none",
      "-drive",
      "file=/rootfs.raw,format=raw,if=none,id=hd0",
      "-device",
      "virtio-blk-device,drive=hd0",
      "-object",
      "rng-random,id=rng0,filename=/dev/urandom",
      "-device",
      "virtio-rng-device,rng=rng0",
      "-nic",
      "none",
    ],
    state,
  }),
  {
    cpuExtensions: ["a=true", "c=true", "m=true"],
    cpuModel: "rv64",
    currentBuildConfigDigest: "same-build-config",
    currentDevices: [rngObject, rngDevice, noNetwork],
    currentGuestManifest: guestManifest(dir, kernel, rootfs),
    currentHostKind: "wasm-browser",
    currentQemuJs: qemuJs.path,
    currentQemuWasm: qemuWasm.path,
    machineVersion: "11.0",
    savedBuildConfigDigest: "same-build-config",
    savedHostKind: "native",
    sourceCommit: "c5ca7f518c",
  },
);
const compatibleCheck = compareVmstateManifests(
  compatible.saved,
  compatible.current,
  { restoreTuple: true },
);

assert.equal(compatibleCheck.ok, true);
assert.deepEqual(compatibleCheck.mismatches, []);
assert.equal(compatibleCheck.producerConsumer.crossHost, true);
assert.equal(compatible.saved.compatibility.qemu.binarySha256, qemuWasm.sha256);
assert.equal(compatible.saved.compatibility.storage.drive, virtioMmioDrive);
assert.equal(compatible.current.compatibility.storage.drive, virtioMmioDrive);
assert.deepEqual(compatible.saved.compatibility.devices, [
  "-drive file=/rootfs.raw,format=raw,if=none,id=hd0",
  "-device virtio-blk-device,drive=hd0",
  rngObject,
  rngDevice,
  noNetwork,
]);
assert.deepEqual(
  compatible.current.compatibility.devices,
  compatible.saved.compatibility.devices,
);
assert.equal(compatible.saved.compatibility.vmstate.streamSha256, state.sha256);
assert.equal(compatible.current.evidence.qemuModuleSha256, qemuWasm.sha256);
assert.equal(
  Object.hasOwn(compatible.saved.compatibility.guest, "kernelPath"),
  false,
);
assert.equal(
  Object.hasOwn(compatible.saved.compatibility.qemu, "path"),
  false,
);

const mismatchQemu = writeFixture(dir, "homebrew-qemu-system-riscv64", "native qemu bytes\n");
const mismatched = emitRestoreTupleManifests(
  proof({
    drive: "virtio-blk-pci",
    kernel,
    qemu: mismatchQemu,
    rootfs,
    sourceCommand: [
      "qemu-system-riscv64",
      "-drive",
      "file=/tmp/source-rootfs-overlay.qcow2,format=qcow2,if=none,id=hd0",
      "-device",
      "virtio-blk-pci,drive=hd0",
      "-nic",
      "none",
    ],
    state,
  }),
  {
    cpuExtensions: ["default-unpinned=true"],
    cpuModel: "default-unpinned",
    currentBuildConfigDigest: "browser-wasm-bundle",
    currentGuestManifest: guestManifest(dir, kernel, rootfs, {
      rootfsDevice: "virtio-pci",
    }),
    currentQemuJs: qemuJs.path,
    currentQemuWasm: qemuWasm.path,
    machineVersion: "unpinned-virt",
    savedBuildConfigDigest: "native-homebrew-qemu-11.0.1-riscv64-softmmu",
    sourceCommit: "c5ca7f518c",
  },
);
const mismatchCheck = compareVmstateManifests(
  mismatched.saved,
  mismatched.current,
  { restoreTuple: true },
);

assert.equal(mismatchCheck.ok, false);
assert.deepEqual(
  mismatchCheck.mismatches.map((entry) => entry.key),
  [
    "devices",
    "storage.drive",
    "storage.resumeDevice",
  ],
);

console.log("wasm-vmstate-restore-tuple-manifest-test: ok");
