#!/usr/bin/env node
/*
 * Test WebAssembly.Memory probe helpers.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";

import {
  DEFAULT_PAGES,
  PAGE_SIZE_BYTES,
  memoryDescriptor,
  parsePages,
  runProbe,
} from "./wasm-memory-probe.mjs";

assert.equal(PAGE_SIZE_BYTES, 64 * 1024);
assert.deepEqual(DEFAULT_PAGES, [16384, 32768, 65536, 131072]);

assert.deepEqual(parsePages("1,2, 3"), [1, 2, 3]);
for (const value of [undefined, "", "0", "-1", "1.5", "abc", "1,0"]) {
  assert.throws(
    () => parsePages(value),
    /--pages must be a comma-separated list of positive integers/,
    `${value} should fail page-list parsing`,
  );
}

assert.deepEqual(memoryDescriptor(4, false, "default"), {
  initial: 4,
  maximum: 4,
});

assert.deepEqual(memoryDescriptor(4, true, "default"), {
  initial: 4,
  maximum: 4,
  shared: true,
});

assert.deepEqual(memoryDescriptor(4, true, "i64"), {
  initial: 4n,
  maximum: 4n,
  shared: true,
  address: "i64",
});

{
  const result = runProbe({ pages: [1], memory64: false });

  assert.equal(result.format, 1);
  assert.equal(result.pageSizeBytes, PAGE_SIZE_BYTES);
  assert.equal(result.runtime.kind, "node");
  assert.equal(result.runtime.node, process.version);
  assert.equal(result.probes.length, 2);
  assert.deepEqual(
    result.probes.map((probe) => ({
      pages: probe.pages,
      bytes: probe.bytes,
      gib: probe.gib,
      shared: probe.shared,
      address: probe.address,
    })),
    [
      {
        pages: 1,
        bytes: PAGE_SIZE_BYTES,
        gib: PAGE_SIZE_BYTES / (1024 ** 3),
        shared: false,
        address: "default",
      },
      {
        pages: 1,
        bytes: PAGE_SIZE_BYTES,
        gib: PAGE_SIZE_BYTES / (1024 ** 3),
        shared: true,
        address: "default",
      },
    ],
  );
}
