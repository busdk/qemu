#!/usr/bin/env node
/*
 * Emit strict browser-restore VMState tuple manifests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VMSTATE_MANIFEST_FORMAT } from "./wasm-vmstate-manifest.mjs";

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;

  stream.write(`usage: wasm-vmstate-restore-tuple-manifest.mjs --proof FILE --out-dir DIR [OPTIONS]

Options:
  --proof FILE                    Native VMState proof result JSON
  --out-dir DIR                   Directory for emitted manifests
  --current-qemu-js FILE          Current browser QEMU JavaScript launcher
  --current-qemu-wasm FILE        Current browser QEMU WebAssembly module
  --current-guest-manifest FILE   Current browser-hosted guest manifest
  --current-device ARG           Additional current QEMU device/object argument;
                                 repeat in exact QEMU order
  --source-commit COMMIT          QEMU source commit for both artifacts
  --saved-build-config-digest TEXT
  --current-build-config-digest TEXT
  --machine-version VERSION       Explicit machine version, for example 11.0
  --cpu-model MODEL               Explicit CPU model, for example rv64
  --cpu-extension KEY=VALUE       Explicit CPU extension; may be repeated
  --json                          Print a JSON summary
  --help                          Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    cpuExtensions: [],
    cpuModel: null,
    currentBuildConfigDigest: null,
    currentDevices: [],
    currentGuestManifest: null,
    currentQemuJs: null,
    currentQemuWasm: null,
    json: false,
    machineVersion: null,
    outDir: null,
    proof: null,
    savedBuildConfigDigest: null,
    sourceCommit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--cpu-extension") {
      options.cpuExtensions.push(argv[++i]);
    } else if (arg === "--cpu-model") {
      options.cpuModel = argv[++i];
    } else if (arg === "--current-build-config-digest") {
      options.currentBuildConfigDigest = argv[++i];
    } else if (arg === "--current-device") {
      options.currentDevices.push(argv[++i]);
    } else if (arg === "--current-guest-manifest") {
      options.currentGuestManifest = argv[++i];
    } else if (arg === "--current-qemu-js") {
      options.currentQemuJs = argv[++i];
    } else if (arg === "--current-qemu-wasm") {
      options.currentQemuWasm = argv[++i];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--machine-version") {
      options.machineVersion = argv[++i];
    } else if (arg === "--out-dir") {
      options.outDir = argv[++i];
    } else if (arg === "--proof") {
      options.proof = argv[++i];
    } else if (arg === "--saved-build-config-digest") {
      options.savedBuildConfigDigest = argv[++i];
    } else if (arg === "--source-commit") {
      options.sourceCommit = argv[++i];
    } else if (arg === "--help") {
      usage(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  for (const key of [
    "proof",
    "outDir",
    "currentQemuJs",
    "currentQemuWasm",
    "currentGuestManifest",
    "sourceCommit",
    "savedBuildConfigDigest",
    "currentBuildConfigDigest",
    "machineVersion",
    "cpuModel",
  ]) {
    if (!options[key]) {
      throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
    }
  }
  if (options.cpuExtensions.length === 0) {
    throw new Error("--cpu-extension is required at least once");
  }
  return options;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${path}: ${error.message}`);
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileEvidence(path) {
  const stat = statSync(path);

  return {
    path,
    basename: basename(path),
    bytes: stat.size,
    sha256: sha256File(path),
  };
}

function requireProofField(proof, dottedKey) {
  let current = proof;

  for (const part of dottedKey.split(".")) {
    if (current === null ||
        typeof current !== "object" ||
        !Object.hasOwn(current, part)) {
      throw new Error(`proof missing ${dottedKey}`);
    }
    current = current[part];
  }
  return current;
}

function proofFileEvidence(proof, dottedKey) {
  const entry = requireProofField(proof, dottedKey);

  if (!entry || typeof entry.path !== "string") {
    throw new Error(`proof ${dottedKey}.path must be present`);
  }
  const evidence = fileEvidence(entry.path);

  if (entry.sha256 && entry.sha256 !== evidence.sha256) {
    throw new Error(`proof ${dottedKey}.sha256 ${entry.sha256} does not match ${evidence.sha256}`);
  }
  if (entry.bytes !== undefined && entry.bytes !== evidence.bytes) {
    throw new Error(`proof ${dottedKey}.bytes ${entry.bytes} does not match ${evidence.bytes}`);
  }
  return evidence;
}

function guestFileEvidence(guestManifestPath, role) {
  const manifest = readJson(guestManifestPath);
  const entry = (manifest.files || []).find((file) => file.role === role);

  if (!entry) {
    throw new Error(`guest manifest missing ${role} file`);
  }
  const base = dirname(guestManifestPath);
  const path = isAbsolute(entry.path) ? entry.path : resolve(base, entry.path);
  const evidence = fileEvidence(path);

  if (entry.sha256 && entry.sha256 !== evidence.sha256) {
    throw new Error(`guest manifest ${role} sha256 ${entry.sha256} does not match ${evidence.sha256}`);
  }
  if (entry.size_bytes !== undefined && entry.size_bytes !== evidence.bytes) {
    throw new Error(`guest manifest ${role} size ${entry.size_bytes} does not match ${evidence.bytes}`);
  }
  return {
    evidence,
    manifest,
  };
}

function selectedProofDevices(command) {
  const devices = [];

  for (let i = 0; i < command.length; i += 1) {
    const arg = command[i];

    if (["-drive", "-device", "-nic", "-netdev", "-object", "-display"].includes(arg)) {
      devices.push(`${arg} ${command[i + 1] || ""}`);
      i += 1;
    }
  }
  return devices;
}

function browserStorage(defaults) {
  const rootfsDevice = defaults.rootfsDevice || "virtio-mmio";

  if (rootfsDevice === "virtio-mmio") {
    return {
      devices: [
        "-drive file=/rootfs.raw,format=raw,if=none,id=hd0",
        "-device virtio-blk-device,drive=hd0",
      ],
      drive: "-drive file=/rootfs.raw,format=raw,if=none,id=hd0 -device virtio-blk-device,drive=hd0",
      resumeDevice: "virtio-blk-device",
    };
  }
  if (rootfsDevice === "virtio-pci") {
    return {
      devices: ["-drive file=/rootfs.raw,format=raw,if=virtio"],
      drive: "-drive file=/rootfs.raw,format=raw,if=virtio",
      resumeDevice: "if=virtio",
    };
  }
  throw new Error(`unsupported rootfsDevice ${rootfsDevice}`);
}

function manifestFor({
  cpuExtensions,
  cpuModel,
  buildConfigDigest,
  devices,
  guest,
  hostKind,
  kernel,
  machine,
  machineVersion,
  memory,
  qemu,
  rootfs,
  sourceCommit,
  state,
  storage,
}) {
  return {
    format: VMSTATE_MANIFEST_FORMAT,
    evidence: {
      qemuPath: qemu.path,
      kernelPath: kernel.path,
      rootfsPath: rootfs.path,
      vmstateStreamPath: state.path,
    },
    compatibility: {
      qemu: {
        binarySha256: qemu.sha256,
        hostKind,
        buildConfigDigest,
        sourceCommit,
      },
      target: "riscv64-softmmu",
      machine: {
        type: machine,
        version: machineVersion,
      },
      cpu: {
        model: cpuModel,
        extensions: [...cpuExtensions].sort(),
      },
      memory,
      devices,
      migration: {
        capabilities: {
          "send-configuration": true,
          "send-section-footer": true,
        },
      },
      guest: {
        kernelSha256: kernel.sha256,
        rootfsSha256: rootfs.sha256,
        kernelAppend: guest.kernelAppend,
      },
      storage,
      vmstate: {
        streamPath: state.path,
        streamSha256: state.sha256,
        streamBytes: state.bytes,
        format: "qemu-migration-exec-stream",
      },
    },
  };
}

export function emitRestoreTupleManifests(proof, options) {
  const qemu = fileEvidence(requireProofField(proof, "qemu"));
  const kernel = proofFileEvidence(proof, "kernel");
  const rootfs = proofFileEvidence(proof, "rootfs");
  const state = proofFileEvidence(proof, "state");
  const guestKernel = guestFileEvidence(options.currentGuestManifest, "kernel");
  const guestRootfs = guestFileEvidence(options.currentGuestManifest, "rootfs");
  const defaults = guestKernel.manifest.default_parameters || {};
  const browserQemu = fileEvidence(options.currentQemuWasm);
  const browserJs = fileEvidence(options.currentQemuJs);
  const storage = browserStorage(defaults);
  const saved = manifestFor({
    buildConfigDigest: options.savedBuildConfigDigest,
    cpuExtensions: options.cpuExtensions,
    cpuModel: options.cpuModel,
    devices: selectedProofDevices(requireProofField(proof, "sourceCommand")),
    guest: { kernelAppend: requireProofField(proof, "kernelAppend") },
    hostKind: options.savedHostKind || "native",
    kernel,
    machine: requireProofField(proof, "machine"),
    machineVersion: options.machineVersion,
    memory: requireProofField(proof, "memory"),
    qemu,
    rootfs,
    sourceCommit: options.sourceCommit,
    state,
    storage: {
      drive: requireProofField(proof, "drive"),
      resumeDevice: proof.resumeDevice || requireProofField(proof, "drive"),
    },
  });
  const current = manifestFor({
    buildConfigDigest: options.currentBuildConfigDigest,
    cpuExtensions: options.cpuExtensions,
    cpuModel: options.cpuModel,
    devices: [...storage.devices, ...(options.currentDevices || [])],
    guest: { kernelAppend: defaults.kernelAppend || "" },
    hostKind: options.currentHostKind || "wasm-browser",
    kernel: guestKernel.evidence,
    machine: defaults.machine || requireProofField(proof, "machine"),
    machineVersion: options.machineVersion,
    memory: defaults.memory || requireProofField(proof, "memory"),
    qemu: {
      path: browserJs.path,
      sha256: browserQemu.sha256,
    },
    rootfs: guestRootfs.evidence,
    sourceCommit: options.sourceCommit,
    state,
    storage: {
      drive: storage.drive,
      resumeDevice: storage.resumeDevice,
    },
  });

  current.compatibility.qemu.launcherPath = browserJs.path;
  current.compatibility.qemu.launcherSha256 = browserJs.sha256;
  current.compatibility.qemu.modulePath = options.currentQemuWasm;
  current.compatibility.qemu.moduleSha256 = browserQemu.sha256;
  current.evidence.qemuLauncherPath = browserJs.path;
  current.evidence.qemuLauncherSha256 = browserJs.sha256;
  current.evidence.qemuModulePath = options.currentQemuWasm;
  current.evidence.qemuModuleSha256 = browserQemu.sha256;
  return { saved, current };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    const proof = readJson(options.proof);
    const result = emitRestoreTupleManifests(proof, {
      ...options,
      currentGuestManifest: resolve(options.currentGuestManifest),
      currentQemuJs: resolve(options.currentQemuJs),
      currentQemuWasm: resolve(options.currentQemuWasm),
    });
    mkdirSync(options.outDir, { recursive: true });
    const paths = {
      saved: join(options.outDir, "saved-restore-tuple-manifest.json"),
      current: join(options.outDir, "current-restore-tuple-manifest.json"),
    };

    writeJson(paths.saved, result.saved);
    writeJson(paths.current, result.current);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ format: 1, paths }, null, 2)}\n`);
    } else {
      process.stdout.write(`vmstate restore tuple manifests written to ${options.outDir}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    usage(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
