/*
 * Helpers for QEMU WebAssembly Node.js smoke runtime preflight checks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

export const MIN_NODE_MAJOR = 23;

export function nodeMajorVersion(version) {
  const match = /^v?([0-9]+)\./.exec(version);
  if (match === null) {
    throw new Error(`cannot parse Node.js version: ${version}`);
  }
  return Number(match[1]);
}

export function nodeVersionPreflight(version = process.version) {
  const nodeMajor = nodeMajorVersion(version);
  const result = {
    ok: nodeMajor >= MIN_NODE_MAJOR,
    nodeVersion: version,
    requiredNodeMajor: MIN_NODE_MAJOR,
  };

  if (result.ok) {
    return result;
  }

  const errorMessage =
    `Node.js ${version} is too old for the wasm64 Emscripten smoke runtime; ` +
    `Node.js v${MIN_NODE_MAJOR}.0.0 or newer is required`;
  return {
    ...result,
    errorName: "Error",
    errorMessage,
    preflight: "node-version",
  };
}
