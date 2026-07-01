#!/usr/bin/env node
/*
 * Test the QEMU WebAssembly browser persistent disk proof runner.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  resultPassed,
  validateOptions,
} from "./wasm-browser-persistent-disk-proof.mjs";

const validOptions = {
  artifactDir: "/tmp/artifacts",
  kernel: "/tmp/bzImage",
  persistentDiskDevice: "virtio-pci",
  persistentDiskOpfsName: "persistent.raw",
  persistentDiskSizeBytes: 1048576,
  port: 8010,
  rootfs: "/tmp/rootfs.raw",
  rootfsDevice: "virtio-pci",
  timeoutMs: 180000,
  verifyInitrd: "/tmp/verify.cpio.gz",
  writeInitrd: "/tmp/write.cpio.gz",
};

assert.equal(validateOptions(validOptions), undefined);

for (const override of [
  { artifactDir: null },
  { persistentDiskDevice: "ide" },
  { persistentDiskOpfsName: "bad/name.raw" },
  { persistentDiskSizeBytes: 0 },
  { port: 0 },
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
      persisted: true,
    },
  },
  verify: {
    success: true,
    persistentDiskState: {
      loadSource: "opfs",
      persisted: true,
    },
  },
  immutableRootfs: {
    unchanged: true,
  },
};

assert.equal(resultPassed(passing), true);
assert.equal(resultPassed({
  ...passing,
  verify: {
    success: true,
    persistentDiskState: {
      loadSource: "empty",
      persisted: true,
    },
  },
}), false);
assert.equal(resultPassed({
  ...passing,
  immutableRootfs: {
    unchanged: false,
  },
}), false);

console.log("wasm-browser-persistent-disk-proof-test: ok");
