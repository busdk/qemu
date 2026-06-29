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
    dumpFiles: [],
    maxOutputBytes: null,
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
    } else if (arg === "--dump-file") {
      options.dumpFiles.push(parseDumpFile(argv[++i]));
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(argv[++i]);
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
  if (
    options.maxOutputBytes !== null &&
    (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0)
  ) {
    console.error("--max-output-bytes must be a positive integer");
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

function parseDumpFile(value) {
  let path = value;
  let maxBytes = null;
  const separator = value.lastIndexOf(":");
  if (separator > 0) {
    const suffix = value.slice(separator + 1);
    if (/^[0-9]+$/.test(suffix)) {
      path = value.slice(0, separator);
      maxBytes = Number(suffix);
    }
  }
  if (!path.startsWith("/")) {
    console.error("--dump-file path must be absolute");
    usage(2);
  }
  if (maxBytes !== null && (!Number.isInteger(maxBytes) || maxBytes <= 0)) {
    console.error("--dump-file byte limit must be a positive integer");
    usage(2);
  }
  return { path, maxBytes };
}

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-node-smoke.mjs [OPTIONS] [-- QEMU_ARGS...]

Options:
  --artifact-dir DIR   Directory containing qemu-system-*.js/.wasm artifacts
  --program FILE      JavaScript launcher inside artifact dir
  --marker TEXT       Output text required for success
  --mount-file H:W    Copy host file H to absolute Emscripten path W
  --dump-file PATH[:N]
                     Print Emscripten file PATH on timeout, capped at N bytes
  --max-output-bytes N
                     Suppress stdout/stderr after N total output bytes
  --timeout-ms MS     Timeout in milliseconds
  --help              Show this help
`);
  process.exit(status);
}

const options = parseArgs(process.argv.slice(2));
const programUrl = pathToFileURL(resolve(options.artifactDir, options.program));

let markerSeen = false;
let exitScheduled = false;
let activeModule = null;
let outputBytes = 0;
let outputSuppressed = false;

function scheduleExit(status) {
  if (exitScheduled) {
    return;
  }
  exitScheduled = true;
  setTimeout(() => process.exit(status), 50);
}

function emit(line, stream) {
  const text = `${line}\n`;
  if (options.maxOutputBytes === null) {
    stream.write(text);
  } else if (outputBytes < options.maxOutputBytes) {
    const encoded = new TextEncoder().encode(text);
    const remaining = options.maxOutputBytes - outputBytes;
    if (encoded.length <= remaining) {
      stream.write(text);
      outputBytes += encoded.length;
    } else {
      stream.write(new TextDecoder().decode(encoded.slice(0, remaining)));
      outputBytes += remaining;
    }
  }
  if (
    options.maxOutputBytes !== null &&
    outputBytes >= options.maxOutputBytes &&
    !outputSuppressed
  ) {
    outputSuppressed = true;
    process.stderr.write(
      `\nwasm-node-smoke: output suppressed after ${options.maxOutputBytes} bytes\n`,
    );
  }
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

function dumpFiles() {
  if (activeModule === null) {
    return;
  }
  for (const dump of options.dumpFiles) {
    process.stderr.write(`----- begin ${dump.path} -----\n`);
    try {
      let data = activeModule.FS.readFile(dump.path);
      if (dump.maxBytes !== null && data.length > dump.maxBytes) {
        data = data.slice(0, dump.maxBytes);
      }
      process.stderr.write(new TextDecoder().decode(data));
      if (data.length > 0 && data[data.length - 1] !== 10) {
        process.stderr.write("\n");
      }
      if (dump.maxBytes !== null) {
        process.stderr.write(`----- truncated at ${dump.maxBytes} bytes -----\n`);
      }
    } catch (error) {
      process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    }
    process.stderr.write(`----- end ${dump.path} -----\n`);
  }
}

const timeout = setTimeout(() => {
  console.error(`timeout waiting for marker: ${options.marker}`);
  dumpFiles();
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
  moduleOptions.preRun = [
    (module) => {
      activeModule = module;
    },
    ...(moduleOptions.preRun || []),
  ];
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
