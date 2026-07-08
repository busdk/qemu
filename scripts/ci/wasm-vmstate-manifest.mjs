#!/usr/bin/env node
/*
 * Compatibility checks for browser-hosted QEMU/WASM VM state manifests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const VMSTATE_MANIFEST_FORMAT = "qemu-wasm-vmstate-manifest-v1";
export const VMSTATE_RESTORE_TUPLE_REQUIRED_KEYS = [
  "qemu.binarySha256",
  "qemu.buildConfigDigest",
  "qemu.sourceCommit",
  "target",
  "machine.type",
  "machine.version",
  "cpu.model",
  "cpu.extensions",
  "memory",
  "devices",
  "migration.capabilities",
  "guest.kernelSha256",
  "guest.rootfsSha256",
  "guest.kernelAppend",
  "storage.drive",
  "storage.resumeDevice",
  "vmstate.streamSha256",
  "vmstate.streamBytes",
  "vmstate.format",
];

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-vmstate-manifest.mjs --saved FILE --current FILE [OPTIONS]

Options:
  --saved FILE          Saved-state compatibility manifest
  --current FILE        Current emulator/guest compatibility manifest
  --required-key KEY    Require compatibility.KEY to exist in both manifests;
                        may be repeated
  --restore-tuple       Require the full browser restore compatibility tuple
  --json                Print a JSON result
  --help                Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    current: null,
    json: false,
    requiredKeys: [],
    restoreTuple: false,
    saved: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--current") {
      options.current = argv[++i];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--required-key") {
      options.requiredKeys.push(argv[++i]);
    } else if (arg === "--restore-tuple") {
      options.restoreTuple = true;
    } else if (arg === "--saved") {
      options.saved = argv[++i];
    } else if (arg === "--help") {
      usage(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.saved) {
    throw new Error("--saved is required");
  }
  if (!options.current) {
    throw new Error("--current is required");
  }
  if (options.requiredKeys.some((key) => !validCompatibilityKey(key))) {
    throw new Error("--required-key must be a non-empty dotted identifier");
  }
  return options;
}

function validCompatibilityKey(key) {
  return typeof key === "string" &&
    /^[A-Za-z0-9_.-]+$/.test(key) &&
    !key.includes("..");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read manifest ${path}: ${error.message}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function nestedValue(object, dottedKey) {
  let current = object;
  for (const part of dottedKey.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, part)) {
      return {
        present: false,
        value: undefined,
      };
    }
    current = current[part];
  }
  return {
    present: true,
    value: current,
  };
}

function collectDottedKeys(object, prefix = "") {
  const keys = [];

  for (const key of Object.keys(object).sort()) {
    const value = object[key];
    const dotted = prefix === "" ? key : `${prefix}.${key}`;

    if (isObject(value)) {
      keys.push(...collectDottedKeys(value, dotted));
    } else {
      keys.push(dotted);
    }
  }
  return keys;
}

export function validateVmstateManifest(manifest, label = "manifest") {
  if (!isObject(manifest)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (manifest.format !== VMSTATE_MANIFEST_FORMAT) {
    throw new Error(`${label}.format must be ${VMSTATE_MANIFEST_FORMAT}`);
  }
  if (!isObject(manifest.compatibility)) {
    throw new Error(`${label}.compatibility must be an object`);
  }
  const declared = manifest.requiredCompatibilityKeys;
  if (declared !== undefined) {
    if (!Array.isArray(declared) ||
        declared.some((key) => !validCompatibilityKey(key))) {
      throw new Error(`${label}.requiredCompatibilityKeys must be an array of dotted identifiers`);
    }
  }
}

export function compareVmstateManifests(saved, current, options = {}) {
  validateVmstateManifest(saved, "saved");
  validateVmstateManifest(current, "current");

  const required = new Set([
    ...collectDottedKeys(saved.compatibility),
    ...(saved.requiredCompatibilityKeys || []),
    ...(options.requiredKeys || []),
    ...(options.restoreTuple ? VMSTATE_RESTORE_TUPLE_REQUIRED_KEYS : []),
  ]);
  const mismatches = [];

  for (const key of [...required].sort()) {
    const savedValue = nestedValue(saved.compatibility, key);
    const currentValue = nestedValue(current.compatibility, key);

    if (!savedValue.present) {
      mismatches.push({
        key,
        reason: "missing-saved",
      });
      continue;
    }
    if (!currentValue.present) {
      mismatches.push({
        key,
        reason: "missing-current",
        saved: savedValue.value,
      });
      continue;
    }
    if (canonical(savedValue.value) !== canonical(currentValue.value)) {
      mismatches.push({
        key,
        reason: "value-mismatch",
        saved: savedValue.value,
        current: currentValue.value,
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    checkedKeys: [...required].sort(),
    mismatches,
  };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
    const result = compareVmstateManifests(
      readJson(options.saved),
      readJson(options.current),
      {
        requiredKeys: options.requiredKeys,
        restoreTuple: options.restoreTuple,
      },
    );

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      process.stdout.write("vmstate manifest compatible\n");
    } else {
      for (const mismatch of result.mismatches) {
        process.stderr.write(
          `vmstate manifest mismatch: ${mismatch.key}: ${mismatch.reason}\n`,
        );
      }
    }
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    usage(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
