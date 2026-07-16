#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-2.0-or-later */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const root = process.env.QEMU_TEST_ROOT || ownRoot;
const source = readFileSync(join(root, "chardev/char-wasm.c"), "utf8");
const header = readFileSync(join(root, "include/chardev/char.h"), "utf8");

const flushStart = source.indexOf("static void wasm_chr_flush_pending_input");
const flushEnd = source.indexOf("static void wasm_chr_clear_pending_input", flushStart);
const flushPending = source.slice(flushStart, flushEnd);
const started = flushPending.indexOf("s->pending_input_started = true");
const backendWrite = flushPending.indexOf("qemu_chr_be_write(");
const cancelStart = source.indexOf("int qemu_wasm_chardev_cancel_pending_input");
const cancelEnd = source.indexOf("static void wasm_chr_accept_input", cancelStart);
const cancelPending = source.slice(cancelStart, cancelEnd);

assert.notEqual(flushStart, -1);
assert.notEqual(flushEnd, -1);
assert.ok(started >= 0 && started < backendWrite,
  "partial delivery must retain cancellation identity before backend write");
assert.match(source, /uint64_t pending_input_token;/);
assert.match(source, /bool pending_input_cancellable;/);
assert.match(source, /bool pending_input_started;/);
assert.match(source, /qemu_wasm_chardev_pending_input_token\(void\)/);
assert.match(cancelPending, /s->pending_input\[0\] = 0x18;/);
assert.match(cancelPending, /s->pending_input\[1\] = '\\n';/);
assert.match(cancelPending, /s->pending_input_len = 2;/);
assert.match(cancelPending, /QEMU_WASM_CHARDEV_CANCEL_UNDELIVERED/);
assert.match(cancelPending, /QEMU_WASM_CHARDEV_CANCEL_PARTIAL/);
assert.match(header, /QEMU_WASM_CHARDEV_CANCEL_NONE = 0/);
assert.match(header, /QEMU_WASM_CHARDEV_CANCEL_UNDELIVERED = 1/);
assert.match(header, /QEMU_WASM_CHARDEV_CANCEL_PARTIAL = 2/);
assert.match(header, /uint64_t qemu_wasm_chardev_pending_input_token\(void\);/);
assert.match(header, /qemu_wasm_chardev_cancel_pending_input\(uint64_t token\);/);

console.log("wasm chardev startup guard contract: PASS");
