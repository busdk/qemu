#!/usr/bin/env node
/*
 * Serve QEMU WebAssembly browser smoke-test inputs with cross-origin isolation.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { createServer } from "node:http";
import { accessSync, constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OPTIONAL_FIRMWARE_FILES = [
  "bios-256k.bin",
  "kvmvapic.bin",
  "vgabios.bin",
  "vgabios-stdvga.bin",
  "efi-virtio.rom",
];

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-smoke-server.mjs --artifact-dir DIR --kernel FILE [--initrd FILE | --rootfs FILE] [OPTIONS]

Options:
  --artifact-dir DIR  Directory containing qemu-system-*.js/.wasm artifacts
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --host HOST         Bind address (default: 127.0.0.1)
  --initrd FILE       Smoke initramfs image
  --kernel FILE       64-bit Linux bzImage
  --port PORT         Bind port (default: 8010)
  --program FILE      JavaScript launcher inside artifact dir
  --rootfs FILE       Raw root filesystem image exposed as /dev/vda
  --help              Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    artifactDir: null,
    firmwareDir: "pc-bios",
    host: "127.0.0.1",
    initrd: null,
    kernel: null,
    port: 8010,
    program: "qemu-system-x86_64.js",
    rootfs: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--initrd") {
      options.initrd = argv[++i];
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--program") {
      options.program = argv[++i];
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (options.artifactDir === null) {
    console.error("--artifact-dir is required");
    usage(2);
  }
  if (options.kernel === null) {
    console.error("--kernel is required");
    usage(2);
  }
  if (options.initrd === null && options.rootfs === null) {
    console.error("either --initrd or --rootfs is required");
    usage(2);
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    console.error("--port must be an integer from 1 to 65535");
    usage(2);
  }

  return {
    ...options,
    artifactDir: resolve(options.artifactDir),
    firmwareDir: resolve(options.firmwareDir),
    initrd: options.initrd === null ? null : resolve(options.initrd),
    kernel: resolve(options.kernel),
    rootfs: options.rootfs === null ? null : resolve(options.rootfs),
  };
}

function requireReadable(path, label) {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    console.error(`${label} is not readable: ${path}`);
    process.exit(2);
  }
}

function isReadable(path) {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function contentType(path) {
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".js") || path.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (path.endsWith(".wasm")) {
    return "application/wasm";
  }
  return "application/octet-stream";
}

function routeFile(options, scriptDir, pathname) {
  const routes = new Map([
    ["/", join(scriptDir, "wasm-browser-smoke.html")],
    ["/wasm-browser-smoke.html", join(scriptDir, "wasm-browser-smoke.html")],
    ["/wasm-browser-smoke.mjs", join(scriptDir, "wasm-browser-smoke.mjs")],
    ["/artifacts/qemu-system-x86_64.wasm", join(options.artifactDir, "qemu-system-x86_64.wasm")],
    [`/artifacts/${basename(options.program)}`, join(options.artifactDir, basename(options.program))],
    ["/guest/kernel", options.kernel],
    ["/firmware/qboot.rom", join(options.firmwareDir, "qboot.rom")],
    ["/firmware/linuxboot_dma.bin", join(options.firmwareDir, "linuxboot_dma.bin")],
  ]);
  for (const name of OPTIONAL_FIRMWARE_FILES) {
    const path = join(options.firmwareDir, name);
    if (isReadable(path)) {
      routes.set(`/firmware/${name}`, path);
    }
  }
  if (options.initrd !== null) {
    routes.set("/guest/initramfs.cpio.gz", options.initrd);
  }
  if (options.rootfs !== null) {
    routes.set("/guest/rootfs.raw", options.rootfs);
  }
  return routes.get(pathname);
}

const options = parseArgs(process.argv.slice(2));
const scriptDir = dirname(fileURLToPath(import.meta.url));

requireReadable(join(options.artifactDir, basename(options.program)), "program");
requireReadable(join(options.artifactDir, "qemu-system-x86_64.wasm"), "wasm module");
requireReadable(options.kernel, "kernel");
if (options.initrd !== null) {
  requireReadable(options.initrd, "initrd");
}
if (options.rootfs !== null) {
  requireReadable(options.rootfs, "rootfs");
}
requireReadable(join(options.firmwareDir, "qboot.rom"), "qboot firmware");
requireReadable(join(options.firmwareDir, "linuxboot_dma.bin"), "linuxboot firmware");

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${options.host}:${options.port}`);
  const file = routeFile(options, scriptDir, url.pathname);

  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found\n");
    return;
  }

  try {
    const data = await readFile(file);
    response.writeHead(200, { "Content-Type": contentType(file) });
    response.end(data);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`${error && error.message ? error.message : String(error)}\n`);
  }
});

server.listen(options.port, options.host, () => {
  console.log(`serving QEMU WASM browser smoke test at http://${options.host}:${options.port}/`);
});

server.on("error", (error) => {
  console.error(
    `failed to serve QEMU WASM browser smoke test on ${options.host}:${options.port}: ${
      error && error.message ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
