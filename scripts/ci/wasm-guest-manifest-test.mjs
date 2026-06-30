#!/usr/bin/env node
/*
 * Test QEMU WebAssembly smoke guest manifest helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";

class ProcessExit extends Error {
  constructor(status) {
    super(`process.exit(${status})`);
    this.status = status;
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function manifestSchema() {
  return {
    stringFields: [
      "display",
      "displayDevice",
      "expectedResolution",
      "initrd",
      "kernel",
      "keyboardAfterText",
      "keyboardText",
      "marker",
      "screenshot",
      "visualMarker",
    ],
    integerFields: ["displayMinNonblackPixels", "timeoutMs"],
    booleanFields: [
      "allowSerialFallback",
      "focusDisplay",
      "memory64",
      "requireDisplayOutput",
      "screenshotFullPage",
    ],
    stringListFields: ["expectText", "qemuArgs"],
    pathFields: ["kernel", "initrd", "screenshot"],
    checksumFields: ["kernel", "initrd"],
  };
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-guest-manifest-"));
  const kernelData = Buffer.from("kernel\n");
  const initrdData = Buffer.from("initrd\n");
  writeFileSync(join(dir, "kernel.bin"), kernelData);
  writeFileSync(join(dir, "initrd.cpio.gz"), initrdData);
  const manifestPath = join(dir, "guest.json");
  writeJson(manifestPath, {
    kernel: "kernel.bin",
    initrd: "initrd.cpio.gz",
    allowSerialFallback: false,
    display: "sdl",
    displayDevice: "stdvga",
    displayMinNonblackPixels: 64,
    expectedResolution: "800x600",
    focusDisplay: true,
    keyboardAfterText: "login:",
    keyboardText: "uname -a\n",
    marker: "manifest-marker",
    requireDisplayOutput: true,
    screenshot: "display.png",
    screenshotFullPage: true,
    timeoutMs: 120000,
    visualMarker: "login",
    memory64: true,
    expectText: ["manifest text"],
    qemuArgs: ["-name", "manifest-smoke"],
    sha256: {
      kernel: `sha256:${sha256(kernelData).toUpperCase()}`,
      initrd: sha256(initrdData),
    },
  });

  const options = {
    guestManifest: manifestPath,
    kernel: null,
    initrd: null,
    allowSerialFallback: true,
    display: "none",
    displayDevice: "default",
    displayMinNonblackPixels: 1,
    expectedResolution: "",
    focusDisplay: false,
    keyboardAfterText: "",
    keyboardText: "",
    marker: "cli-marker",
    requireDisplayOutput: false,
    screenshot: null,
    screenshotFullPage: false,
    timeoutMs: null,
    visualMarker: "",
    memory64: false,
    expectText: [],
    qemuArgs: ["-trace", "wasm"],
  };
  const explicit = new Set(["marker", "qemuArgs"]);
  applyGuestManifest(options, explicit, manifestSchema());

  assert.equal(options.kernel, join(dir, "kernel.bin"));
  assert.equal(options.initrd, join(dir, "initrd.cpio.gz"));
  assert.equal(options.allowSerialFallback, false);
  assert.equal(options.display, "sdl");
  assert.equal(options.displayDevice, "stdvga");
  assert.equal(options.displayMinNonblackPixels, 64);
  assert.equal(options.expectedResolution, "800x600");
  assert.equal(options.focusDisplay, true);
  assert.equal(options.keyboardAfterText, "login:");
  assert.equal(options.keyboardText, "uname -a\n");
  assert.equal(options.marker, "cli-marker");
  assert.equal(options.requireDisplayOutput, true);
  assert.equal(options.screenshot, join(dir, "display.png"));
  assert.equal(options.screenshotFullPage, true);
  assert.equal(options.timeoutMs, 120000);
  assert.equal(options.visualMarker, "login");
  assert.equal(options.memory64, true);
  assert.deepEqual(options.expectText, ["manifest text"]);
  assert.deepEqual(options.qemuArgs, ["-name", "manifest-smoke", "-trace", "wasm"]);
}

{
  const dir = mkdtempSync(join(tmpdir(), "qemu-wasm-guest-manifest-bad-"));
  writeFileSync(join(dir, "kernel.bin"), "kernel\n");
  const manifestPath = join(dir, "guest.json");
  writeJson(manifestPath, {
    kernel: "kernel.bin",
    sha256: {
      kernel: "0".repeat(64),
    },
  });

  const originalExit = process.exit;
  const originalError = console.error;
  const errors = [];
  process.exit = (status) => {
    throw new ProcessExit(status);
  };
  console.error = (message) => {
    errors.push(String(message));
  };
  try {
    assert.throws(
      () => applyGuestManifest(
        {
          guestManifest: manifestPath,
          kernel: null,
        },
        new Set(),
        {
          stringFields: ["kernel"],
          pathFields: ["kernel"],
          checksumFields: ["kernel"],
        },
      ),
      (error) => error instanceof ProcessExit && error.status === 2,
    );
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  assert.match(errors.join("\n"), /guest manifest checksum mismatch for kernel/);
}
