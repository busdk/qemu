#!/usr/bin/env node
/*
 * Test browser-hosted QEMU/WASM VM state manifest compatibility checks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  VMSTATE_MANIFEST_FORMAT,
  compareVmstateManifests,
  validateVmstateManifest,
} from "./wasm-vmstate-manifest.mjs";

function manifest(overrides = {}) {
  return {
    format: VMSTATE_MANIFEST_FORMAT,
    requiredCompatibilityKeys: [
      "qemu.commit",
      "machine",
      "memory",
      "guest.kernelSha256",
      "guest.rootfsSha256",
      "storage.resumeDevice",
    ],
    compatibility: {
      qemu: {
        commit: "4a7b9d2b22",
      },
      wasm: {
        programSha256: "7fa406692c8a4238acc0607d3ec18ab518bdb639c77f7a223bb1ff2bf95b19a0",
        binarySha256: "c5c29bd49aa160ef220e6f70db3ac459ee23b2751852f149cf37bc4740627c56",
      },
      target: "riscv64-softmmu",
      machine: "virt",
      cpu: "",
      memory: "512M",
      guest: {
        kernelSha256: "2bd8132a3bf21570290042324fff48c987f42f2a00c08de979f43f0662ebadba",
        rootfsSha256: "bdae7f7e022592800442b73eb32ec7631f43a4c13dd8621051204f7e482fbd2b",
        profile: "generic-tuxboot-riscv64",
      },
      storage: {
        resumeDevice: "virtio-blk-device",
        overlaySha256: "0bad90b1f4a47b42230d20f0e9859890ea8ad58f73284bb6c60abc0143d0ed50",
      },
      vmstate: {
        streamSha256: "a98517d34f48025d47cfb1a37f7f2dd38c733a1e841b4b0dad96c22b8d655eed",
        format: "qemu-migration-exec-stream",
      },
    },
    ...overrides,
  };
}

assert.equal(validateVmstateManifest(manifest(), "saved"), undefined);

{
  const result = compareVmstateManifests(manifest(), manifest());

  assert.equal(result.ok, true);
  assert.equal(result.mismatches.length, 0);
  assert.ok(result.checkedKeys.includes("guest.kernelSha256"));
  assert.ok(result.checkedKeys.includes("vmstate.streamSha256"));
}

{
  const current = manifest();

  current.compatibility.guest.rootfsSha256 =
    "0000000000000000000000000000000000000000000000000000000000000000";
  const result = compareVmstateManifests(manifest(), current);

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "guest.rootfsSha256",
    reason: "value-mismatch",
    saved: "bdae7f7e022592800442b73eb32ec7631f43a4c13dd8621051204f7e482fbd2b",
    current: "0000000000000000000000000000000000000000000000000000000000000000",
  }]);
}

{
  const current = manifest();

  delete current.compatibility.storage.resumeDevice;
  const result = compareVmstateManifests(manifest(), current);

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "storage.resumeDevice",
    reason: "missing-current",
    saved: "virtio-blk-device",
  }]);
}

{
  const saved = manifest({
    requiredCompatibilityKeys: ["guest.packageSetDigest"],
  });
  const result = compareVmstateManifests(saved, manifest());

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "guest.packageSetDigest",
    reason: "missing-saved",
  }]);
}

{
  const current = manifest();

  current.compatibility.browser = { storage: "opfs" };
  const result = compareVmstateManifests(manifest(), current);

  assert.equal(result.ok, true);
}

assert.throws(
  () => validateVmstateManifest({ format: "wrong", compatibility: {} }),
  /format must be qemu-wasm-vmstate-manifest-v1/,
);

console.log("wasm-vmstate-manifest-test: ok");
