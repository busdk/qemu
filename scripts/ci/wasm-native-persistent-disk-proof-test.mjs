#!/usr/bin/env node
/*
 * Test the native QEMU persistent disk proof runner.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  resultPassed,
  validateOptions,
} from "./wasm-native-persistent-disk-proof.mjs";

const validOptions = {
  cpu: "Nehalem",
  kernel: "/tmp/bzImage",
  persistentDiskDevice: "virtio-mmio",
  persistentDiskSizeBytes: 1048576,
  qemuSystem: "qemu-system-x86_64",
  rootfs: "/tmp/rootfs.raw",
  rootfsDevice: "virtio-mmio",
  timeoutMs: 180000,
  verifyInitrd: "/tmp/verify.cpio.gz",
  writeInitrd: "/tmp/write.cpio.gz",
};

assert.equal(validateOptions(validOptions), undefined);

for (const override of [
  { kernel: null },
  { persistentDiskDevice: "ide" },
  { persistentDiskSizeBytes: 0 },
  { qemuSystem: "" },
  { rootfsDevice: "ide" },
  { timeoutMs: 0 },
]) {
  assert.throws(
    () => validateOptions({ ...validOptions, ...override }),
    Error,
  );
}

const passing = {
  write: {
    success: true,
    persistentDiskState: {
      loadSource: "empty",
    },
  },
  verify: {
    success: true,
    persistentDiskState: {
      loadSource: "file",
    },
  },
  immutableRootfs: {
    unchanged: true,
  },
  persistentDisk: {
    sha256BeforeWrite: "zero",
    sha256AfterWrite: "payload",
    sha256AfterVerify: "payload",
  },
};

assert.equal(resultPassed(passing), true);
assert.equal(resultPassed({
  ...passing,
  write: {
    success: true,
    persistentDiskState: {
      loadSource: "file",
    },
  },
}), false);
assert.equal(resultPassed({
  ...passing,
  immutableRootfs: {
    unchanged: false,
  },
}), false);
assert.equal(resultPassed({
  ...passing,
  persistentDisk: {
    sha256BeforeWrite: "zero",
    sha256AfterWrite: "payload",
    sha256AfterVerify: "changed",
  },
}), false);

console.log("wasm-native-persistent-disk-proof-test: ok");
