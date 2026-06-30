#!/usr/bin/env node
/*
 * Unit tests for QEMU WebAssembly Node.js smoke runtime preflight checks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  MIN_NODE_MAJOR,
  nodeMajorVersion,
  nodeVersionPreflight,
} from "./wasm-node-preflight.mjs";

assert.equal(MIN_NODE_MAJOR, 23);

assert.equal(nodeMajorVersion("v22.19.0"), 22);
assert.equal(nodeMajorVersion("23.0.0"), 23);
assert.equal(nodeMajorVersion("v24.18.0"), 24);
assert.throws(() => nodeMajorVersion("not-a-version"), /cannot parse Node\.js version/);

assert.deepEqual(nodeVersionPreflight("v22.19.0"), {
  ok: false,
  nodeVersion: "v22.19.0",
  requiredNodeMajor: 23,
  errorName: "Error",
  errorMessage:
    "Node.js v22.19.0 is too old for the wasm64 Emscripten smoke runtime; " +
    "Node.js v23.0.0 or newer is required",
  preflight: "node-version",
});

assert.deepEqual(nodeVersionPreflight("v23.0.0"), {
  ok: true,
  nodeVersion: "v23.0.0",
  requiredNodeMajor: 23,
});

assert.deepEqual(nodeVersionPreflight("v24.18.0"), {
  ok: true,
  nodeVersion: "v24.18.0",
  requiredNodeMajor: 23,
});
