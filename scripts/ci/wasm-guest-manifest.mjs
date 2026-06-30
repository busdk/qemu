/*
 * Helpers for QEMU WebAssembly smoke guest manifests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { readFileSync } from "node:fs";

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

export function applyGuestManifest(options, explicit, schema) {
  if (options.guestManifest === null) {
    return;
  }
  const manifest = readGuestManifest(options.guestManifest);
  for (const field of schema.stringFields || []) {
    const value = manifestString(manifest, field);
    if (value !== null && !explicit.has(field)) {
      options[field] = value;
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
}
