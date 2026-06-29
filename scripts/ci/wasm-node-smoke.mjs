#!/usr/bin/env node
/*
 * Run a generated QEMU WebAssembly artifact under Node.js.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

function parseArgs(argv) {
  const options = {
    artifactDir: ".",
    program: "qemu-system-x86_64.js",
    marker: "QEMU emulator version",
    timeoutMs: 10000,
    qemuArgs: ["--version"],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      options.qemuArgs = argv.slice(i + 1);
      break;
    } else if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
    } else if (arg === "--program") {
      options.program = argv[++i];
    } else if (arg === "--marker") {
      options.marker = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    usage(2);
  }

  return options;
}

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-node-smoke.mjs [OPTIONS] [-- QEMU_ARGS...]

Options:
  --artifact-dir DIR   Directory containing qemu-system-*.js/.wasm artifacts
  --program FILE      JavaScript launcher inside artifact dir
  --marker TEXT       Output text required for success
  --timeout-ms MS     Timeout in milliseconds
  --help              Show this help
`);
  process.exit(status);
}

const options = parseArgs(process.argv.slice(2));
const programUrl = pathToFileURL(resolve(options.artifactDir, options.program));

let markerSeen = false;
let exitScheduled = false;

function scheduleExit(status) {
  if (exitScheduled) {
    return;
  }
  exitScheduled = true;
  setTimeout(() => process.exit(status), 50);
}

function emit(line, stream) {
  stream.write(`${line}\n`);
  if (line.includes(options.marker)) {
    markerSeen = true;
    scheduleExit(0);
  }
}

const timeout = setTimeout(() => {
  console.error(`timeout waiting for marker: ${options.marker}`);
  process.exit(124);
}, options.timeoutMs);

try {
  const moduleFactory = (await import(programUrl.href)).default;
  await moduleFactory({
    arguments: options.qemuArgs,
    print: (line) => emit(line, process.stdout),
    printErr: (line) => emit(line, process.stderr),
  });
} catch (error) {
  clearTimeout(timeout);
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}

if (markerSeen) {
  clearTimeout(timeout);
} else {
  /*
   * Some Emscripten pthread builds keep the runtime alive after the module
   * promise resolves.  Leave timeout handling active unless the marker was
   * observed.
   */
}
