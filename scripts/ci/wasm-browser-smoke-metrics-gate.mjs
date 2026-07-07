#!/usr/bin/env node
/*
 * Validate generic QEMU WebAssembly browser smoke metrics payloads.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { run } from "./wasm-browser-smoke-x86-metrics-gate.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv, {
    allowTcgOnly: true,
    commandName: "wasm-browser-smoke-metrics-gate.mjs",
    purpose: "qemu-browser-smoke-metrics-gate",
  }).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
