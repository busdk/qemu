#!/usr/bin/env node
/*
 * Test browser-hosted QEMU/WASM VM state manifest compatibility checks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  VMSTATE_MANIFEST_FORMAT,
  VMSTATE_RESTORE_TUPLE_REQUIRED_KEYS,
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

function restoreTupleManifest(overrides = {}) {
  return {
    format: VMSTATE_MANIFEST_FORMAT,
    compatibility: {
      qemu: {
        binarySha256: "c5c29bd49aa160ef220e6f70db3ac459ee23b2751852f149cf37bc4740627c56",
        buildConfigDigest: "target=riscv64-softmmu;tcg_interpreter=true;wasm64=true",
        sourceCommit: "b73bd4c184ec",
      },
      target: "riscv64-softmmu",
      machine: {
        type: "virt",
        version: "11.0",
      },
      cpu: {
        model: "rv64",
        extensions: [
          "a=true",
          "c=true",
          "d=true",
          "f=true",
          "m=true",
          "v=false",
        ],
      },
      memory: "512M",
      devices: [
        "-drive file=/rootfs.raw,format=raw,if=none,id=hd0",
        "-device virtio-blk-device,drive=hd0",
        "-nic none",
      ],
      migration: {
        capabilities: {
          "send-configuration": true,
          "send-section-footer": true,
        },
      },
      guest: {
        kernelSha256: "2bd8132a3bf21570290042324fff48c987f42f2a00c08de979f43f0662ebadba",
        rootfsSha256: "bdae7f7e022592800442b73eb32ec7631f43a4c13dd8621051204f7e482fbd2b",
        kernelAppend: "console=ttyS0 root=/dev/vda rw",
      },
      storage: {
        drive: "-drive file=/rootfs.raw,format=raw,if=none,id=hd0 -device virtio-blk-device,drive=hd0",
        resumeDevice: "virtio-blk-device",
      },
      vmstate: {
        streamSha256: "a98517d34f48025d47cfb1a37f7f2dd38c733a1e841b4b0dad96c22b8d655eed",
        streamBytes: 26782067,
        format: "qemu-migration-exec-stream",
      },
    },
    ...overrides,
  };
}

function tupleMismatch(mutator) {
  const current = structuredClone(restoreTupleManifest());

  mutator(current);
  return compareVmstateManifests(
    restoreTupleManifest(),
    current,
    { restoreTuple: true },
  );
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

{
  const result = compareVmstateManifests(
    restoreTupleManifest(),
    restoreTupleManifest(),
    { restoreTuple: true },
  );

  assert.equal(result.ok, true);
  for (const key of VMSTATE_RESTORE_TUPLE_REQUIRED_KEYS) {
    assert.ok(result.checkedKeys.includes(key));
  }
}

{
  const result = compareVmstateManifests(
    manifest(),
    manifest(),
    { restoreTuple: true },
  );

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((mismatch) =>
    mismatch.key === "machine.type" &&
    mismatch.reason === "missing-saved"));
  assert.ok(result.mismatches.some((mismatch) =>
    mismatch.key === "cpu.extensions" &&
    mismatch.reason === "missing-saved"));
}

{
  const result = tupleMismatch((current) => {
    current.compatibility.cpu.extensions = [
      "a=true",
      "c=true",
      "d=true",
      "f=true",
      "m=true",
      "v=true",
    ];
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "cpu.extensions",
    reason: "value-mismatch",
    saved: restoreTupleManifest().compatibility.cpu.extensions,
    current: [
      "a=true",
      "c=true",
      "d=true",
      "f=true",
      "m=true",
      "v=true",
    ],
  }]);
}

{
  const result = tupleMismatch((current) => {
    current.compatibility.machine.version = "12.0";
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "machine.version",
    reason: "value-mismatch",
    saved: "11.0",
    current: "12.0",
  }]);
}

{
  const result = tupleMismatch((current) => {
    current.compatibility.devices = [
      "-drive file=/rootfs.raw,format=raw,if=none,id=hd0",
      "-device virtio-rng-device",
      "-device virtio-blk-device,drive=hd0",
      "-nic none",
    ];
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "devices",
    reason: "value-mismatch",
    saved: restoreTupleManifest().compatibility.devices,
    current: [
      "-drive file=/rootfs.raw,format=raw,if=none,id=hd0",
      "-device virtio-rng-device",
      "-device virtio-blk-device,drive=hd0",
      "-nic none",
    ],
  }]);
}

{
  const result = tupleMismatch((current) => {
    current.compatibility.vmstate.streamSha256 =
      "0000000000000000000000000000000000000000000000000000000000000000";
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [{
    key: "vmstate.streamSha256",
    reason: "value-mismatch",
    saved: "a98517d34f48025d47cfb1a37f7f2dd38c733a1e841b4b0dad96c22b8d655eed",
    current: "0000000000000000000000000000000000000000000000000000000000000000",
  }]);
}

assert.throws(
  () => validateVmstateManifest({ format: "wrong", compatibility: {} }),
  /format must be qemu-wasm-vmstate-manifest-v1/,
);

console.log("wasm-vmstate-manifest-test: ok");
