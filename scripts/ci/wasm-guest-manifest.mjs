/*
 * Helpers for QEMU WebAssembly smoke guest manifests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readGuestManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`failed to read guest manifest ${path}: ${error && error.message ? error.message : String(error)}`);
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`guest manifest must be a JSON object: ${path}`);
  }
  return manifest;
}

function manifestString(manifest, name) {
  const value = manifest[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    fail(`guest manifest field ${name} must be a string`);
  }
  return value;
}

function manifestInteger(manifest, name) {
  const value = manifest[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    fail(`guest manifest field ${name} must be a positive integer`);
  }
  return value;
}

function manifestBoolean(manifest, name) {
  const value = manifest[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    fail(`guest manifest field ${name} must be a boolean`);
  }
  return value;
}

function manifestBooleanLike(value, name) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  fail(`guest manifest field ${name} must be a boolean`);
}

function manifestIntegerLike(value, name) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return Number(value);
  }
  fail(`guest manifest field ${name} must be a non-negative integer`);
}

function manifestStringList(manifest, name) {
  const value = manifest[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(`guest manifest field ${name} must be an array of strings`);
  }
  return value;
}

function manifestObject(manifest, name) {
  const value = manifest[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    fail(`guest manifest field ${name} must be an object`);
  }
  return value;
}

function normalizePowerOperation(value) {
  if (value === null) {
    return null;
  }
  if (!["", "shutdown", "reboot", "guest-powerdown", "force-reset", "force-poweroff"].includes(value)) {
    fail("guest manifest field powerOperation must be shutdown, reboot, guest-powerdown, force-reset, force-poweroff, or empty");
  }
  return value;
}

function serviceBridgeString(bridge, name) {
  const value = bridge[name];
  if (typeof value !== "string" || value === "") {
    fail(`guest manifest serviceBridge.${name} must be a non-empty string`);
  }
  return value;
}

function serviceBridgeInteger(bridge, name, maximum) {
  const value = bridge[name];
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    fail(`guest manifest serviceBridge.${name} must be a positive integer <= ${maximum}`);
  }
  return value;
}

function serviceBridgeBoolean(bridge, name) {
  const value = bridge[name];
  if (typeof value !== "boolean") {
    fail(`guest manifest serviceBridge.${name} must be a boolean`);
  }
  return value;
}

function serviceBridgeObject(bridge, name) {
  const value = bridge[name];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`guest manifest serviceBridge.${name} must be an object`);
  }
  return value;
}

function normalizeServiceBridgeManifest(manifest) {
  const bridge = manifestObject(manifest, "serviceBridge");
  if (bridge === null) {
    return null;
  }
  const kind = serviceBridgeString(bridge, "kind");
  if (!["serial-jsonl", "virtio-console-jsonl", "virtio-serial-jsonl"].includes(kind)) {
    fail("guest manifest serviceBridge.kind must be serial-jsonl, virtio-console-jsonl, or virtio-serial-jsonl");
  }
  const normalized = {
    kind,
    requestChannel: serviceBridgeString(bridge, "requestChannel"),
    responseChannel: serviceBridgeString(bridge, "responseChannel"),
    readinessMarker: serviceBridgeString(bridge, "readinessMarker"),
    healthRequest: serviceBridgeObject(bridge, "healthRequest"),
    timeoutMs: serviceBridgeInteger(bridge, "timeoutMs", 300000),
    maxPayloadBytes: serviceBridgeInteger(bridge, "maxPayloadBytes", 1048576),
    interactiveOnly: serviceBridgeBoolean(bridge, "interactiveOnly"),
  };
  return normalized;
}

function normalizeChecksum(value, name) {
  if (typeof value !== "string") {
    fail(`guest manifest checksum for ${name} must be a string`);
  }
  const checksum = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(checksum)) {
    fail(`guest manifest checksum for ${name} must be a SHA-256 hex string`);
  }
  return checksum.toLowerCase();
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function resolveManifestPath(manifestDir, value) {
  if (value === "" || isAbsolute(value)) {
    return value;
  }
  return resolve(manifestDir, value);
}

function normalizeBrowserHostedManifest(manifest, schema) {
  const params = manifest.default_parameters;
  if (params === undefined || params === null) {
    return manifest;
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    fail("guest manifest field default_parameters must be an object");
  }

  const normalized = {
    ...manifest,
    ...params,
  };
  if (normalized.targetArch === undefined && typeof manifest.target_arch === "string") {
    normalized.targetArch = manifest.target_arch;
  }
  if (normalized.artifactDir === undefined && typeof normalized.program === "string") {
    normalized.artifactDir = dirname(normalized.program);
  }
  if (normalized.firmwareDir === undefined && typeof normalized.qboot === "string") {
    normalized.firmwareDir = dirname(normalized.qboot);
  }
  if (normalized.firmwareDir === undefined && typeof normalized.linuxboot === "string") {
    normalized.firmwareDir = dirname(normalized.linuxboot);
  }

  for (const field of schema.booleanFields || []) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      normalized[field] = manifestBooleanLike(normalized[field], field);
    }
  }
  for (const field of schema.integerFields || []) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      normalized[field] = manifestIntegerLike(normalized[field], field);
    }
  }
  return normalized;
}

export function applyGuestManifest(options, explicit, schema) {
  if (options.guestManifest === null) {
    return;
  }
  const manifestPath = resolve(options.guestManifest);
  const manifestDir = dirname(manifestPath);
  const manifest = normalizeBrowserHostedManifest(readGuestManifest(manifestPath), schema);
  const applied = new Set();
  const pathFields = new Set(schema.pathFields || []);
  for (const field of schema.stringFields || []) {
    const value = manifestString(manifest, field);
    if (value !== null && !explicit.has(field)) {
      options[field] = field === "powerOperation"
        ? normalizePowerOperation(value)
        : pathFields.has(field)
          ? resolveManifestPath(manifestDir, value)
          : value;
      applied.add(field);
    }
  }
  for (const field of schema.integerFields || []) {
    const value = manifestInteger(manifest, field);
    if (value !== null && !explicit.has(field)) {
      options[field] = value;
    }
  }
  for (const field of schema.booleanFields || []) {
    const value = manifestBoolean(manifest, field);
    if (value !== null && !explicit.has(field)) {
      options[field] = value;
    }
  }
  for (const field of schema.stringListFields || []) {
    const value = manifestStringList(manifest, field);
    if (value !== null) {
      options[field] = explicit.has(field) ? [...value, ...options[field]] : value;
    }
  }
  if (schema.serviceBridgeField) {
    const value = normalizeServiceBridgeManifest(manifest);
    if (value !== null && !explicit.has(schema.serviceBridgeField)) {
      options[schema.serviceBridgeField] = value;
    }
  }
  const checksums = manifestObject(manifest, "sha256");
  if (checksums !== null) {
    for (const field of schema.checksumFields || []) {
      if (!applied.has(field)) {
        continue;
      }
      const value = checksums[field];
      if (value === undefined || value === null) {
        continue;
      }
      const expected = normalizeChecksum(value, field);
      const actual = sha256File(options[field]);
      if (actual !== expected) {
        fail(`guest manifest checksum mismatch for ${field}: expected ${expected}, got ${actual}`);
      }
    }
  }
}
