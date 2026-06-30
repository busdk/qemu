/*
 * Shared Node.js runtime preflight checks for QEMU WebAssembly smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

export const MIN_NODE_MAJOR = 23;

export function nodeMajorVersion(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const majorText = normalized.split(".", 1)[0];
  const major = Number(majorText);
  if (!Number.isInteger(major)) {
    throw new Error(`cannot parse Node.js version: ${version}`);
  }
  return major;
}

export function nodeVersionPreflight(version = process.version) {
  const major = nodeMajorVersion(version);
  if (major >= MIN_NODE_MAJOR) {
    return {
      ok: true,
      nodeVersion: version,
      requiredNodeMajor: MIN_NODE_MAJOR,
    };
  }
  return {
    ok: false,
    nodeVersion: version,
    requiredNodeMajor: MIN_NODE_MAJOR,
    errorName: "Error",
    errorMessage:
      `Node.js ${version} is too old for the wasm64 Emscripten smoke runtime; ` +
      `Node.js v${MIN_NODE_MAJOR}.0.0 or newer is required`,
    preflight: "node-version",
  };
}
