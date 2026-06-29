#!/usr/bin/env node
/*
 * Run a generated QEMU WebAssembly artifact under Node.js.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const options = {
    artifactDir: ".",
    program: "qemu-system-x86_64.js",
    marker: "QEMU emulator version",
    mountFiles: [],
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
    } else if (arg === "--mount-file") {
      options.mountFiles.push(parseMountFile(argv[++i]));
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

function parseMountFile(value) {
  const separator = value.indexOf(":");
  if (separator < 1) {
    console.error("--mount-file must use HOST:WASM_PATH");
    usage(2);
  }
  const hostPath = value.slice(0, separator);
  const wasmPath = value.slice(separator + 1);
  if (!wasmPath.startsWith("/")) {
    console.error("--mount-file WASM_PATH must be absolute");
    usage(2);
  }
  return { hostPath, wasmPath };
}

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-node-smoke.mjs [OPTIONS] [-- QEMU_ARGS...]

Options:
  --artifact-dir DIR   Directory containing qemu-system-*.js/.wasm artifacts
  --program FILE      JavaScript launcher inside artifact dir
  --marker TEXT       Output text required for success
  --mount-file H:W    Copy host file H to absolute Emscripten path W
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

function mountFiles(module) {
  for (const mount of options.mountFiles) {
    const data = readFileSync(mount.hostPath);
    module.FS_createPath("/", dirname(mount.wasmPath), true, true);
    module.FS.writeFile(mount.wasmPath, data);
  }
}

const timeout = setTimeout(() => {
  console.error(`timeout waiting for marker: ${options.marker}`);
  process.exit(124);
}, options.timeoutMs);

try {
  const moduleFactory = (await import(programUrl.href)).default;
  const moduleOptions = {
    arguments: options.qemuArgs,
    print: (line) => emit(line, process.stdout),
    printErr: (line) => emit(line, process.stderr),
  };
  if (options.mountFiles.length > 0) {
    moduleOptions.preRun = [(module) => mountFiles(module)];
  }
  await moduleFactory({
    ...moduleOptions,
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
