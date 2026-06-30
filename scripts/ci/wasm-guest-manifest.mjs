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

export function applyGuestManifest(options, explicit, schema) {
  if (options.guestManifest === null) {
    return;
  }
  const manifestPath = resolve(options.guestManifest);
  const manifestDir = dirname(manifestPath);
  const manifest = readGuestManifest(manifestPath);
  const applied = new Set();
  const pathFields = new Set(schema.pathFields || []);
  for (const field of schema.stringFields || []) {
    const value = manifestString(manifest, field);
    if (value !== null && !explicit.has(field)) {
      options[field] = pathFields.has(field)
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
