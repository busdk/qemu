#!/usr/bin/env node
/*
 * Serve the browser OPFS probe with cross-origin isolation.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVED_FILES = new Map([
  ["/", "wasm-browser-opfs-probe.html"],
  ["/wasm-browser-opfs-probe.html", "wasm-browser-opfs-probe.html"],
  ["/wasm-opfs-probe-worker.mjs", "wasm-opfs-probe-worker.mjs"],
]);

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-opfs-probe-server.mjs [OPTIONS]

Options:
  --host HOST   Bind address (default: 127.0.0.1)
  --port PORT   Bind port (default: 8012)
  --help        Show this help
`);
  process.exit(status);
}

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 8012,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    console.error("--port must be an integer from 1 to 65535");
    usage(2);
  }

  return options;
}

function contentType(fileName) {
  if (fileName.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (fileName.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

const options = parseArgs(process.argv.slice(2));
const scriptDir = dirname(fileURLToPath(import.meta.url));

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${options.host}:${options.port}`);
  const fileName = SERVED_FILES.get(url.pathname);

  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (!fileName) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found\n");
    return;
  }

  try {
    const data = await readFile(join(scriptDir, basename(fileName)));
    response.writeHead(200, { "Content-Type": contentType(fileName) });
    response.end(data);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`${error && error.message ? error.message : String(error)}\n`);
  }
});

server.listen(options.port, options.host, () => {
  console.log(
    `serving QEMU WASM OPFS probe at http://${options.host}:${options.port}/`,
  );
});

server.on("error", (error) => {
  console.error(
    `failed to serve QEMU WASM OPFS probe on ${options.host}:${options.port}: ${
      error && error.message ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
