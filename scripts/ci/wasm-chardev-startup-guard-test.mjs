#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(join(root, "chardev/char-wasm.c"), "utf8");

const writeStart = source.indexOf("int qemu_wasm_chardev_write_pending(void)");
const writeEnd = source.indexOf("static void wasm_chr_accept_input", writeStart);
const writePending = source.slice(writeStart, writeEnd);
const readinessLoad = writePending.indexOf(
  "qatomic_load_acquire(&wasm_chardevs_ready)",
);

assert.notEqual(writeStart, -1);
assert.notEqual(writeEnd, -1);
assert.notEqual(readinessLoad, -1);
assert.ok(readinessLoad < writePending.indexOf("return -EAGAIN;"));
assert.ok(readinessLoad < writePending.indexOf("wasm_chardev_pending_channel_len()"));
assert.ok(readinessLoad < writePending.indexOf("qemu_mutex_lock("));

const registerStart = source.indexOf("static void register_types(void)");
const registerEnd = source.indexOf("type_init(register_types);", registerStart);
const registerTypes = source.slice(registerStart, registerEnd);
const mutexInit = registerTypes.indexOf("qemu_mutex_init(&wasm_chardevs_lock)");
const typeRegister = registerTypes.indexOf("type_register_static(&char_wasm_type_info)");
const readinessStore = registerTypes.indexOf(
  "qatomic_store_release(&wasm_chardevs_ready, true)",
);

assert.notEqual(registerStart, -1);
assert.notEqual(registerEnd, -1);
assert.ok(mutexInit >= 0 && mutexInit < typeRegister);
assert.ok(typeRegister < readinessStore);

console.log("wasm chardev startup guard contract: PASS");
