#!/usr/bin/env node
/*
 * Test the QEMU WebAssembly smoke input server.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";

async function unusedPort() {
  const server = createServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

function fixture(path, data) {
  writeFileSync(path, data);
  return path;
}

async function waitForServer(child) {
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  for (let i = 0; i < 50; i += 1) {
    if (stdout.includes("serving QEMU WASM browser smoke test")) {
      return { stdout, stderr };
    }
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for server: ${stderr}`);
}

async function runServer(args) {
  return spawn(process.execPath, [
    "scripts/ci/wasm-browser-smoke-server.mjs",
    ...args,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const dir = mkdtempSync(join(tmpdir(), "qemu-smoke-server-test-"));
const artifactDir = join(dir, "artifacts");
const firmwareDir = join(dir, "pc-bios");
mkdirSync(artifactDir);
mkdirSync(firmwareDir);

fixture(join(artifactDir, "qemu-system-riscv64.js"), "program\n");
fixture(join(artifactDir, "qemu-system-riscv64.wasm"), "wasm\n");
fixture(join(firmwareDir, "qboot.rom"), "qboot\n");
fixture(join(firmwareDir, "linuxboot_dma.bin"), "linuxboot\n");
const kernel = fixture(join(dir, "Image"), "kernel\n");
const rootfs = fixture(join(dir, "rootfs.raw"), "rootfs\n");
const stateBytes = Buffer.from([0, 1, 2, 3, 255, 128, 64]);
const vmstate = fixture(join(dir, "state.vmstate"), stateBytes);
const port = await unusedPort();
const child = await runServer([
  "--artifact-dir", artifactDir,
  "--firmware-dir", firmwareDir,
  "--kernel", kernel,
  "--rootfs", rootfs,
  "--program", "qemu-system-riscv64.js",
  "--wasm", "qemu-system-riscv64.wasm",
  "--vmstate-restore-state-file", vmstate,
  "--host", "127.0.0.1",
  "--port", String(port),
]);

try {
  await waitForServer(child);
  const response = await fetch(`http://127.0.0.1:${port}/vmstate/restore`);
  const body = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-embedder-policy"), "require-corp");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.deepEqual([...body], [...stateBytes]);
} finally {
  child.kill("SIGTERM");
}

{
  const missing = await runServer([
    "--artifact-dir", artifactDir,
    "--firmware-dir", firmwareDir,
    "--kernel", kernel,
    "--rootfs", rootfs,
    "--program", "qemu-system-riscv64.js",
    "--wasm", "qemu-system-riscv64.wasm",
    "--vmstate-restore-state-file", join(dir, "missing.vmstate"),
    "--host", "127.0.0.1",
    "--port", String(await unusedPort()),
  ]);
  let stderr = "";

  missing.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(missing, "exit");

  assert.equal(code, 2);
  assert.match(stderr, /VMState restore stream is not readable/);
}

console.log("wasm-browser-smoke-server-test: ok");
