#!/usr/bin/env node
/*
 * Dependency-free Chrome DevTools Protocol gate for QEMU WebAssembly smoke runs.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";
import { installSignalCleanup } from "./wasm-playwright-loader.mjs";
import { compareVmstateManifests } from "./wasm-vmstate-manifest.mjs";
import {
  preflightVmstateStaticExport,
} from "./wasm-vmstate-static-export.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_CHROME_PATHS = [
  process.env.QEMU_WASM_CHROMIUM_EXECUTABLE,
  process.env.QEMU_WASM_BROWSER_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
].filter(Boolean);

function usage(status = 0) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-cdp-gate.mjs --artifact-dir DIR --kernel FILE [--initrd FILE | --rootfs FILE] --out FILE [OPTIONS]\n\nRuns the QEMU WebAssembly browser smoke page through Chrome DevTools Protocol, without Playwright.\n\nOptions:\n  --artifact-dir DIR       Directory containing qemu-system-*.js/.wasm artifacts\n  --guest-manifest FILE    Load guest defaults such as kernel/rootfs/marker\n  --kernel FILE            Guest kernel served as /guest/kernel\n  --initrd FILE            Guest initramfs image\n  --rootfs FILE            Guest rootfs served as /guest/rootfs.raw\n  --out FILE               Write result JSON\n  --chrome FILE            Chrome/Chromium executable\n  --firmware-dir DIR       Directory containing QEMU firmware blobs\n  --host HOST              Smoke server host (default: 127.0.0.1)\n  --port N                 Smoke server port (default: 8151)\n  --cdp-host HOST          Chrome remote-debugging host (default: 127.0.0.1)\n  --cdp-port N             Chrome remote-debugging port (default: 9223)\n  --program FILE           QEMU JS artifact basename (default: manifest or qemu-system-riscv64.js)\n  --wasm FILE              QEMU WASM artifact basename (default: derived from program)\n  --marker TEXT            Required marker text (default: manifest or Welcome to TuxTest)\n  --timeout-ms N           Smoke timeout (default: manifest or 180000)\n  --max-output-bytes N     Smoke output byte cap (default: 160000)\n  --memory SIZE            Guest memory (default: manifest or 512M)\n  --machine NAME           QEMU machine (default: manifest or virt)\n  --cpu MODEL              QEMU CPU model (default: manifest or empty)\n  --rootfs-device KIND     Rootfs block device (default: manifest or virtio-mmio)\n  --target-arch ARCH       Guest target architecture for firmware mounts\n  --kernel-append TEXT     Kernel command line\n  --vmstate-restore        Enable browser VMState restore import\n  --vmstate-restore-state-file FILE\n                           Local VMState stream served as /vmstate/restore\n  --vmstate-restore-state-bytes N\n                           Expected VMState byte length\n  --vmstate-restore-state-sha256 HASH\n                           Expected VMState SHA-256\n  --vmstate-restore-saved-manifest FILE\n                           Saved-state compatibility manifest\n  --vmstate-restore-current-manifest FILE\n                           Current compatibility manifest\n  --diagnostics-limit N    Live-generated-exec diagnostics limit (default: 24)\n  --no-live-generated-exec Disable live generated exec query flags\n  --help                   Show this help\n`);
  stream.write(`Static restore options:\n  --expect-text TEXT       Additional serial text required for success; repeatable\n  --qemu-arg ARG           Additional QEMU argument; repeat in exact order\n  --serial-input-after-text TEXT\n                           Wait for serial text before sending configured input\n  --serial-input-text TEXT Send exact text through the primary serial channel\n  --vmstate-restore-proof  Require acceptance-shaped fail-closed proof evidence\n  --vmstate-restore-static-export-manifest FILE\n                           Fail-closed static export source of truth\n`);
  process.exit(status);
}

function defaultWasmForProgram(program) {
  return String(program).endsWith(".js")
    ? `${String(program).slice(0, -3)}.wasm`
    : `${program}.wasm`;
}

function boolValue(value) {
  return value ? "1" : "0";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lineBuffer(prefix) {
  let pending = "";
  return (chunk) => {
    pending += chunk.toString();
    for (;;) {
      const index = pending.indexOf("\n");
      if (index < 0) {
        break;
      }
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (line.trim()) {
        console.error(`${prefix}${line}`);
      }
    }
  };
}

export async function parseArgs(argv) {
  const explicit = new Set();
  const options = {
    artifactDir: null,
    cdpHost: "127.0.0.1",
    cdpPort: 9223,
    chrome: null,
    cpu: "",
    diagnosticsLimit: 24,
    display: "none",
    displayDevice: "default",
    expectText: [],
    firmwareDir: "pc-bios",
    guestManifest: null,
    host: "127.0.0.1",
    initrd: null,
    kernel: null,
    kernelAppend: "printk.time=0 root=/dev/vda console=ttyS0 panic=-1",
    liveGeneratedExec: true,
    machine: "virt",
    marker: "Welcome to TuxTest",
    maxOutputBytes: 160000,
    memory: "512M",
    network: "none",
    out: null,
    port: 8151,
    program: "qemu-system-riscv64.js",
    qemuArgs: [],
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    serialInputAfterText: "",
    serialInputText: "",
    targetArch: "riscv64",
    timeoutMs: 180000,
    vmstateRestore: false,
    vmstateRestoreCurrentManifest: "",
    vmstateRestoreManifestCheck: null,
    vmstateRestorePreflight: null,
    vmstateRestoreProof: false,
    vmstateRestoreSavedManifest: "",
    vmstateRestoreStaticExportManifest: "",
    vmstateRestoreStateBytes: 0,
    vmstateRestoreStateFile: "",
    vmstateRestoreStateSha256: "",
    wasm: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
      explicit.add("artifactDir");
    } else if (arg === "--cdp-host") {
      options.cdpHost = argv[++i];
    } else if (arg === "--cdp-port") {
      options.cdpPort = Number(argv[++i]);
    } else if (arg === "--chrome") {
      options.chrome = argv[++i];
    } else if (arg === "--cpu") {
      options.cpu = argv[++i];
      explicit.add("cpu");
    } else if (arg === "--diagnostics-limit") {
      options.diagnosticsLimit = Number(argv[++i]);
    } else if (arg === "--expect-text") {
      options.expectText.push(argv[++i]);
      explicit.add("expectText");
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
      explicit.add("firmwareDir");
    } else if (arg === "--guest-manifest") {
      options.guestManifest = argv[++i];
    } else if (arg === "--host") {
      options.host = argv[++i];
    } else if (arg === "--initrd") {
      options.initrd = argv[++i];
      explicit.add("initrd");
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
      explicit.add("kernel");
    } else if (arg === "--kernel-append") {
      options.kernelAppend = argv[++i];
      explicit.add("kernelAppend");
    } else if (arg === "--machine") {
      options.machine = argv[++i];
      explicit.add("machine");
    } else if (arg === "--marker") {
      options.marker = argv[++i];
      explicit.add("marker");
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(argv[++i]);
    } else if (arg === "--memory") {
      options.memory = argv[++i];
      explicit.add("memory");
    } else if (arg === "--network") {
      options.network = argv[++i];
      explicit.add("network");
    } else if (arg === "--no-live-generated-exec") {
      options.liveGeneratedExec = false;
    } else if (arg === "--out") {
      options.out = argv[++i];
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--program") {
      options.program = argv[++i];
      explicit.add("program");
    } else if (arg === "--qemu-arg") {
      options.qemuArgs.push(argv[++i]);
      explicit.add("qemuArgs");
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
      explicit.add("rootfs");
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
      explicit.add("rootfsDevice");
    } else if (arg === "--serial-input-after-text") {
      options.serialInputAfterText = argv[++i];
      explicit.add("serialInputAfterText");
    } else if (arg === "--serial-input-text") {
      options.serialInputText = argv[++i];
      explicit.add("serialInputText");
    } else if (arg === "--target-arch") {
      options.targetArch = argv[++i];
      explicit.add("targetArch");
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
      explicit.add("timeoutMs");
    } else if (arg === "--vmstate-restore") {
      options.vmstateRestore = true;
    } else if (arg === "--vmstate-restore-proof") {
      options.vmstateRestoreProof = true;
    } else if (arg === "--vmstate-restore-current-manifest") {
      options.vmstateRestoreCurrentManifest = argv[++i];
    } else if (arg === "--vmstate-restore-saved-manifest") {
      options.vmstateRestoreSavedManifest = argv[++i];
    } else if (arg === "--vmstate-restore-static-export-manifest") {
      options.vmstateRestoreStaticExportManifest = argv[++i];
    } else if (arg === "--vmstate-restore-state-bytes") {
      options.vmstateRestoreStateBytes = Number(argv[++i]);
    } else if (arg === "--vmstate-restore-state-file") {
      options.vmstateRestoreStateFile = argv[++i];
    } else if (arg === "--vmstate-restore-state-sha256") {
      options.vmstateRestoreStateSha256 = argv[++i];
    } else if (arg === "--wasm") {
      options.wasm = argv[++i];
      explicit.add("wasm");
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  applyGuestManifest(options, explicit, {
    integerFields: ["timeoutMs"],
    pathFields: [
      "artifactDir",
      "firmwareDir",
      "initrd",
      "kernel",
      "rootfs",
      "vmstateRestoreCurrentManifest",
      "vmstateRestoreSavedManifest",
      "vmstateRestoreStaticExportManifest",
      "vmstateRestoreStateFile",
    ],
    stringFields: [
      "artifactDir",
      "cpu",
      "firmwareDir",
      "initrd",
      "kernel",
      "kernelAppend",
      "machine",
      "marker",
      "memory",
      "network",
      "program",
      "rootfs",
      "rootfsDevice",
      "serialInputAfterText",
      "serialInputText",
      "targetArch",
      "vmstateRestoreCurrentManifest",
      "vmstateRestoreSavedManifest",
      "vmstateRestoreStaticExportManifest",
      "vmstateRestoreStateFile",
      "vmstateRestoreStateSha256",
      "wasm",
    ],
    stringListFields: ["expectText", "qemuArgs"],
  });

  if (options.initrd === "") {
    options.initrd = null;
  }
  if (options.rootfs === "") {
    options.rootfs = null;
  }

  if (options.artifactDir === null) {
    console.error("--artifact-dir is required");
    usage(2);
  }
  if (options.kernel === null) {
    console.error("--kernel or --guest-manifest with kernel is required");
    usage(2);
  }
  if (options.initrd === null && options.rootfs === null) {
    console.error("either --initrd/--rootfs or a guest manifest with one is required");
    usage(2);
  }
  if (options.vmstateRestore) {
    const sha256 = /^[0-9a-f]{64}$/i;
    if (options.vmstateRestoreStateFile === "") {
      console.error("--vmstate-restore requires --vmstate-restore-state-file");
      usage(2);
    }
    if (!Number.isInteger(options.vmstateRestoreStateBytes) ||
        options.vmstateRestoreStateBytes <= 0) {
      console.error("--vmstate-restore-state-bytes must be a positive integer");
      usage(2);
    }
    if (!sha256.test(options.vmstateRestoreStateSha256)) {
      console.error("--vmstate-restore-state-sha256 must be a 64-hex SHA-256");
      usage(2);
    }
    if ((options.vmstateRestoreSavedManifest === "") !==
        (options.vmstateRestoreCurrentManifest === "")) {
      console.error("--vmstate-restore-saved-manifest and --vmstate-restore-current-manifest must be used together");
      usage(2);
    }
    if (options.vmstateRestoreProof &&
        options.vmstateRestoreSavedManifest === "") {
      console.error("--vmstate-restore-proof requires saved/current VMState manifests");
      usage(2);
    }
    if (options.vmstateRestoreProof && options.expectText.length === 0) {
      console.error("--vmstate-restore-proof requires --expect-text");
      usage(2);
    }
    if (!options.vmstateRestoreProof &&
        options.vmstateRestoreStaticExportManifest !== "") {
      console.error("--vmstate-restore-static-export-manifest requires --vmstate-restore-proof");
      usage(2);
    }
  } else if (options.vmstateRestoreStaticExportManifest !== "") {
    console.error("--vmstate-restore-static-export-manifest requires --vmstate-restore");
    usage(2);
  }
  if (options.expectText.some((text) => typeof text !== "string" || text === "")) {
    console.error("--expect-text must be a non-empty string");
    usage(2);
  }
  if (options.serialInputAfterText !== "" && options.serialInputText === "") {
    console.error("--serial-input-after-text requires --serial-input-text");
    usage(2);
  }
  if (options.out === null) {
    console.error("--out is required");
    usage(2);
  }
  for (const [name, value] of [
    ["--port", options.port],
    ["--cdp-port", options.cdpPort],
    ["--timeout-ms", options.timeoutMs],
    ["--max-output-bytes", options.maxOutputBytes],
    ["--diagnostics-limit", options.diagnosticsLimit],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      console.error(`${name} must be a positive integer`);
      usage(2);
    }
  }

  options.artifactDir = resolve(options.artifactDir);
  options.firmwareDir = resolve(options.firmwareDir);
  options.kernel = resolve(options.kernel);
  options.initrd = options.initrd === null ? null : resolve(options.initrd);
  options.rootfs = options.rootfs === null ? null : resolve(options.rootfs);
  options.out = resolve(options.out);
  options.guestManifest = options.guestManifest === null ? null : resolve(options.guestManifest);
  options.vmstateRestoreCurrentManifest = options.vmstateRestoreCurrentManifest === ""
    ? ""
    : resolve(options.vmstateRestoreCurrentManifest);
  options.vmstateRestoreSavedManifest = options.vmstateRestoreSavedManifest === ""
    ? ""
    : resolve(options.vmstateRestoreSavedManifest);
  options.vmstateRestoreStaticExportManifest =
    options.vmstateRestoreStaticExportManifest === ""
      ? ""
      : resolve(options.vmstateRestoreStaticExportManifest);
  options.vmstateRestoreStateFile = options.vmstateRestoreStateFile === ""
    ? ""
    : resolve(options.vmstateRestoreStateFile);
  options.wasm = options.wasm || defaultWasmForProgram(options.program);
  options.chrome = options.chrome || DEFAULT_CHROME_PATHS.find((path) => existsSync(path));
  if (!options.chrome) {
    console.error("Chrome/Chromium executable not found; pass --chrome or QEMU_WASM_CHROMIUM_EXECUTABLE");
    process.exit(2);
  }
  return options;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError || new Error(`timed out waiting for ${url}`);
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          resolve(message.result || {});
        }
      } else {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.ws.close();
  }
}

export function smokeUrl(options) {
  const url = new URL(`http://${options.host}:${options.port}/`);
  url.searchParams.set("appendExtra", "");
  url.searchParams.set("allowSerialFallback", "1");
  url.searchParams.set("cpu", options.cpu);
  url.searchParams.set("display", options.display);
  url.searchParams.set("displayDevice", options.displayDevice);
  url.searchParams.set("expectedResolution", "");
  for (const text of options.expectText || []) {
    url.searchParams.append("expectText", text);
  }
  url.searchParams.set("focusDisplay", "0");
  url.searchParams.set("marker", options.marker);
  url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
  url.searchParams.set("memory", options.memory);
  url.searchParams.set("machine", options.machine);
  url.searchParams.set("network", options.network);
  url.searchParams.set("program", `/artifacts/${basename(options.program)}`);
  url.searchParams.set("wasm", `/artifacts/${basename(options.wasm)}`);
  for (const arg of options.qemuArgs || []) {
    url.searchParams.append("qemuArg", arg);
  }
  url.searchParams.set("powerOperation", "");
  url.searchParams.set("powerTimeoutMs", "30000");
  if ((options.serialInputText || "") !== "") {
    url.searchParams.set("primarySerialInput", "1");
  }
  if (options.liveGeneratedExec) {
    url.searchParams.set("wasm64LiveGeneratedExec", "1");
    url.searchParams.set("wasm64LiveGeneratedExecDiagnostics", "1");
    url.searchParams.set("wasm64LiveGeneratedExecDiagnosticsLimit", String(options.diagnosticsLimit));
    url.searchParams.set("wasm64TcgSummary", "1");
    url.searchParams.set("wasm64TcgSummaryInterval", "1000");
  }
  url.searchParams.set("rootfsDevice", options.rootfsDevice);
  url.searchParams.set("targetArch", options.targetArch);
  url.searchParams.set("kernelAppend", options.kernelAppend);
  url.searchParams.set("initrd", options.initrd === null ? "" : "/guest/initramfs.cpio.gz");
  if (options.rootfs !== null) {
    url.searchParams.set("rootfs", "/guest/rootfs.raw");
  }
  if (options.vmstateRestore) {
    url.searchParams.set("vmstateRestore", "1");
    url.searchParams.set("vmstateRestoreSource", "http");
    url.searchParams.set("vmstateRestoreUrl", `${url.origin}/vmstate/restore`);
    url.searchParams.set("vmstateRestoreStateBytes", String(options.vmstateRestoreStateBytes));
    url.searchParams.set("vmstateRestoreStateSha256", options.vmstateRestoreStateSha256);
  }
  url.searchParams.set("timeoutMs", String(options.timeoutMs));
  url.searchParams.set("visualMarker", "");
  return url.href;
}

export function serialInputTriggerReady(snapshot, afterText = "") {
  if (!snapshot?.state?.primarySerialInput?.moduleAttached) {
    return false;
  }
  if (afterText !== "") {
    return String(snapshot.output || "").includes(afterText);
  }
  return ["start-qemu", "guest-boot", "success"].includes(
    snapshot.state.phase,
  );
}

export function smokeServerArgs(options) {
  const args = [
    "scripts/ci/wasm-browser-smoke-server.mjs",
    "--artifact-dir", options.artifactDir,
    "--firmware-dir", options.firmwareDir,
    "--kernel", options.kernel,
    "--program", basename(options.program),
    "--wasm", basename(options.wasm),
    "--host", options.host,
    "--port", String(options.port),
  ];
  if (options.initrd !== null) {
    args.push("--initrd", options.initrd);
  }
  if (options.rootfs !== null) {
    args.push("--rootfs", options.rootfs);
  }
  if (options.vmstateRestoreStateFile !== "") {
    args.push("--vmstate-restore-state-file", options.vmstateRestoreStateFile);
  }
  return args;
}

export function chromeLaunchArgs(options, userDataDir) {
  return [
    "--headless=new",
    `--remote-debugging-address=${options.cdpHost}`,
    `--remote-debugging-port=${options.cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-gpu",
    "about:blank",
  ];
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolveDone) => {
    child.once("exit", resolveDone);
    setTimeout(resolveDone, 1000);
  });
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolveDone) => {
      child.once("exit", resolveDone);
      setTimeout(resolveDone, 1000);
    });
  }
}

async function cdpEval(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: 5000,
  });
  if (result.exceptionDetails) {
    return { exception: result.exceptionDetails.text || "exception" };
  }
  return result.result?.value;
}

function compactCdpInitiator(initiator) {
  if (!initiator) {
    return null;
  }
  return {
    type: initiator.type || null,
    url: initiator.url || null,
    lineNumber: initiator.lineNumber ?? null,
    columnNumber: initiator.columnNumber ?? null,
    stack: initiator.stack || null,
  };
}

export function cdpResourceErrorDiagnostic(event, requestInfo, elapsedMs) {
  const params = event.params || {};
  const response = params.response || {};
  const request = requestInfo?.request || {};
  return {
    elapsedMs,
    event: event.method,
    requestId: params.requestId || requestInfo?.requestId || null,
    method: request.method || null,
    url: response.url || request.url || null,
    status: response.status ?? null,
    statusText: response.statusText || null,
    failureText: params.errorText || null,
    resourceType: params.type || requestInfo?.type || null,
    initiator: compactCdpInitiator(requestInfo?.initiator || null),
  };
}

function recentResourceError(resourceErrors) {
  if (!Array.isArray(resourceErrors) || resourceErrors.length === 0) {
    return null;
  }
  const entry = resourceErrors[resourceErrors.length - 1];
  return {
    elapsedMs: entry.elapsedMs,
    event: entry.event,
    method: entry.method,
    url: entry.url,
    status: entry.status ?? null,
    statusText: entry.statusText ?? null,
    failureText: entry.failureText ?? null,
    resourceType: entry.resourceType || null,
    initiator: entry.initiator || null,
  };
}

function consoleLooksLikeResourceError(text) {
  return /Failed to load resource|Cross-Origin-Embedder-Policy|COEP|CORS|404|403|net::ERR_/i.test(text);
}

export function cdpConsoleMessageDiagnostic(params, elapsedMs, resourceErrors = []) {
  const text = (params?.args || [])
    .map((arg) => arg.value ?? arg.description ?? "")
    .join(" ");
  return {
    elapsedMs,
    type: params?.type || null,
    text,
    resourceError: consoleLooksLikeResourceError(text)
      ? recentResourceError(resourceErrors)
      : null,
  };
}

export function browserVersionDiagnostic(version) {
  return {
    browser: typeof version?.Browser === "string" ? version.Browser : null,
    protocolVersion: typeof version?.["Protocol-Version"] === "string"
      ? version["Protocol-Version"]
      : null,
    userAgent: typeof version?.["User-Agent"] === "string" ? version["User-Agent"] : null,
    v8Version: typeof version?.["V8-Version"] === "string" ? version["V8-Version"] : null,
    webkitVersion: typeof version?.["WebKit-Version"] === "string"
      ? version["WebKit-Version"]
      : null,
  };
}

function requireReadable(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label} ${path}: ${error.message}`);
  }
}

export function vmstateRestoreManifestCheck(options) {
  if (!options.vmstateRestore ||
      !options.vmstateRestoreSavedManifest ||
      !options.vmstateRestoreCurrentManifest) {
    return null;
  }
  const result = compareVmstateManifests(
    readJsonFile(options.vmstateRestoreSavedManifest, "saved VMState manifest"),
    readJsonFile(options.vmstateRestoreCurrentManifest, "current VMState manifest"),
    { restoreTuple: true },
  );
  return {
    ...result,
    saved: options.vmstateRestoreSavedManifest,
    current: options.vmstateRestoreCurrentManifest,
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolveDone, rejectDone) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectDone);
    stream.on("end", resolveDone);
  });
  return hash.digest("hex");
}

async function fileEvidence(role, path) {
  if (path === null || path === undefined || path === "") {
    return null;
  }
  return {
    role,
    path,
    bytes: statSync(path).size,
    sha256: await sha256File(path),
  };
}

export async function proofInputEvidence(options) {
  return {
    artifactDir: options.artifactDir,
    firmwareDir: options.firmwareDir,
    program: await fileEvidence(
      "program",
      resolve(options.artifactDir, basename(options.program)),
    ),
    wasm: await fileEvidence(
      "wasm",
      resolve(options.artifactDir, basename(options.wasm)),
    ),
    kernel: await fileEvidence("kernel", options.kernel),
    initrd: await fileEvidence("initrd", options.initrd),
    rootfs: await fileEvidence("rootfs", options.rootfs),
    guestManifest: await fileEvidence("guestManifest", options.guestManifest),
    vmstateRestoreState: await fileEvidence(
      "vmstateRestoreState",
      options.vmstateRestore ? options.vmstateRestoreStateFile : null,
    ),
    vmstateRestoreSavedManifest: await fileEvidence(
      "vmstateRestoreSavedManifest",
      options.vmstateRestoreSavedManifest,
    ),
    vmstateRestoreCurrentManifest: await fileEvidence(
      "vmstateRestoreCurrentManifest",
      options.vmstateRestoreCurrentManifest,
    ),
  };
}

export function vmstateRestoreAffectingArgs(options) {
  const staticExportRoot = options.vmstateRestoreStaticExportManifest
    ? dirname(resolve(options.vmstateRestoreStaticExportManifest))
    : null;
  const portablePath = (path, label) => {
    if (staticExportRoot === null) {
      return path;
    }
    const value = relative(staticExportRoot, resolve(path));
    if (value === "") {
      return ".";
    }
    if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
      throw new Error(
        `${label} must be inside the static export directory: ${path}`,
      );
    }
    return value.split(sep).join("/");
  };
  const args = [
    "--artifact-dir", portablePath(options.artifactDir, "artifactDir"),
  ];
  if (options.guestManifest !== null) {
    args.push(
      "--guest-manifest",
      portablePath(options.guestManifest, "guestManifest"),
    );
  }
  args.push("--kernel", portablePath(options.kernel, "kernel"));
  if (options.initrd !== null) {
    args.push("--initrd", portablePath(options.initrd, "initrd"));
  }
  if (options.rootfs !== null) {
    args.push("--rootfs", portablePath(options.rootfs, "rootfs"));
  }
  args.push(
    "--program", portablePath(
      resolve(options.artifactDir, basename(options.program)),
      "program",
    ),
    "--wasm", portablePath(
      resolve(options.artifactDir, basename(options.wasm)),
      "wasm",
    ),
    "--target-arch", options.targetArch,
    "--machine", options.machine,
    "--cpu", options.cpu,
    "--memory", options.memory,
    "--kernel-append", options.kernelAppend,
    "--marker", options.marker,
  );
  for (const text of options.expectText || []) {
    args.push("--expect-text", text);
  }
  for (const arg of options.qemuArgs || []) {
    args.push("--qemu-arg", arg);
  }
  if ((options.serialInputText || "") !== "") {
    args.push(
      "--serial-input-after-text", options.serialInputAfterText || "",
      "--serial-input-text", options.serialInputText,
    );
  }
  args.push(
    "--timeout-ms", String(options.timeoutMs),
    "--rootfs-device", options.rootfsDevice,
    "--vmstate-restore",
    "--vmstate-restore-proof",
    "--vmstate-restore-state-file",
    portablePath(options.vmstateRestoreStateFile, "vmstateRestoreStateFile"),
    "--vmstate-restore-state-bytes", String(options.vmstateRestoreStateBytes),
    "--vmstate-restore-state-sha256", options.vmstateRestoreStateSha256,
    "--vmstate-restore-saved-manifest",
    portablePath(
      options.vmstateRestoreSavedManifest,
      "vmstateRestoreSavedManifest",
    ),
    "--vmstate-restore-current-manifest",
    portablePath(
      options.vmstateRestoreCurrentManifest,
      "vmstateRestoreCurrentManifest",
    ),
    "--vmstate-restore-static-export-manifest",
    portablePath(
      options.vmstateRestoreStaticExportManifest,
      "vmstateRestoreStaticExportManifest",
    ),
  );
  return args;
}

function restorePreflightFailure(code, field, message, details = {}) {
  return {
    format: 1,
    purpose: "qemu-browser-cdp-vmstate-restore-preflight",
    ok: false,
    restoreMode: details.restoreMode || "static-export-proof",
    staticExportProofEligible: false,
    browserStarted: false,
    qemuStarted: false,
    vmstateRestoreManifestCheck: details.vmstateRestoreManifestCheck || null,
    staticExportPreflight: details.staticExportPreflight || null,
    failure: {
      code,
      field,
      message,
      expected: details.expected ?? null,
      actual: details.actual ?? null,
    },
  };
}

function evidenceMismatch(entry, expected, field, staticExportPreflight) {
  if (entry === null || entry === undefined) {
    return restorePreflightFailure(
      "missing-input-evidence",
      field,
      `${field} is required`,
      { staticExportPreflight },
    );
  }
  if (entry.sha256 !== expected.sha256 || entry.bytes !== expected.bytes) {
    return restorePreflightFailure(
      "static-export-input-mismatch",
      field,
      `${field} does not match the static export`,
      {
        expected: { bytes: expected.bytes, sha256: expected.sha256 },
        actual: { bytes: entry.bytes, sha256: entry.sha256 },
        staticExportPreflight,
      },
    );
  }
  return null;
}

export async function vmstateRestorePreflight(options, inputEvidence) {
  const base = {
    format: 1,
    purpose: "qemu-browser-cdp-vmstate-restore-preflight",
    ok: true,
    restoreMode: options.vmstateRestore ? "generic-legacy" : "none",
    staticExportProofEligible: false,
    browserStarted: false,
    qemuStarted: false,
    vmstateRestoreManifestCheck: null,
    staticExportPreflight: null,
    failure: null,
  };
  if (!options.vmstateRestore) {
    return base;
  }

  const manifestCheck = vmstateRestoreManifestCheck(options);
  base.vmstateRestoreManifestCheck = manifestCheck;
  if (manifestCheck !== null && !manifestCheck.ok) {
    const mismatch = manifestCheck.mismatches[0];
    return restorePreflightFailure(
      "incompatible-restore-tuple",
      mismatch.key,
      `VMState manifest mismatch: ${mismatch.key}: ${mismatch.reason}`,
      {
        expected: mismatch.saved,
        actual: mismatch.current,
        vmstateRestoreManifestCheck: manifestCheck,
      },
    );
  }

  const state = inputEvidence.vmstateRestoreState;
  if (state.bytes !== options.vmstateRestoreStateBytes) {
    return restorePreflightFailure(
      "restore-stream-bytes-mismatch",
      "vmstateRestoreState.bytes",
      `VMState restore stream byte length mismatch: expected ${options.vmstateRestoreStateBytes}, got ${state.bytes}`,
      {
        expected: options.vmstateRestoreStateBytes,
        actual: state.bytes,
        vmstateRestoreManifestCheck: manifestCheck,
      },
    );
  }
  if (state.sha256 !== options.vmstateRestoreStateSha256.toLowerCase()) {
    return restorePreflightFailure(
      "restore-stream-sha256-mismatch",
      "vmstateRestoreState.sha256",
      `VMState restore stream SHA-256 mismatch: expected ${options.vmstateRestoreStateSha256.toLowerCase()}, got ${state.sha256}`,
      {
        expected: options.vmstateRestoreStateSha256.toLowerCase(),
        actual: state.sha256,
        vmstateRestoreManifestCheck: manifestCheck,
      },
    );
  }

  if (!options.vmstateRestoreProof) {
    return base;
  }
  base.restoreMode = "static-export-proof";
  if (options.vmstateRestoreStaticExportManifest === "") {
    return restorePreflightFailure(
      "missing-static-export",
      "vmstateRestoreStaticExportManifest",
      "strict VMState restore proof requires a static export manifest",
    );
  }
  const staticCheck = await preflightVmstateStaticExport(
    options.vmstateRestoreStaticExportManifest,
  );
  base.staticExportPreflight = staticCheck;
  if (!staticCheck.ok) {
    return restorePreflightFailure(
      staticCheck.failure.code,
      staticCheck.failure.field,
      staticCheck.failure.message,
      {
        expected: staticCheck.failure.expected,
        actual: staticCheck.failure.actual,
        vmstateRestoreManifestCheck: manifestCheck,
        staticExportPreflight: staticCheck,
      },
    );
  }

  for (const [role, expected] of [
    ["vmstateRestoreState", staticCheck.files.restoreStream],
    ["vmstateRestoreSavedManifest", staticCheck.files.savedManifest],
    ["vmstateRestoreCurrentManifest", staticCheck.files.currentManifest],
    ["guestManifest", staticCheck.files.guestManifest],
    ["rootfs", staticCheck.files.immutableDisk],
  ]) {
    const mismatch = evidenceMismatch(
      inputEvidence[role],
      expected,
      `inputEvidence.${role}`,
      staticCheck,
    );
    if (mismatch !== null) {
      return mismatch;
    }
  }

  for (const [role, expectedSha256] of [
    ["program", staticCheck.restorePlan.artifacts.launcherSha256],
    ["wasm", staticCheck.restorePlan.artifacts.moduleSha256],
    ["kernel", staticCheck.restorePlan.artifacts.kernelSha256],
  ]) {
    const entry = inputEvidence[role];
    if (entry === null || entry.sha256 !== expectedSha256) {
      return restorePreflightFailure(
        "static-export-input-mismatch",
        `inputEvidence.${role}.sha256`,
        `inputEvidence.${role}.sha256 does not match the static export tuple`,
        {
          expected: expectedSha256,
          actual: entry?.sha256 ?? null,
          vmstateRestoreManifestCheck: manifestCheck,
          staticExportPreflight: staticCheck,
        },
      );
    }
  }
  if (options.marker !== staticCheck.restorePlan.marker) {
    return restorePreflightFailure(
      "static-export-runner-mismatch",
      "marker",
      "restore marker does not match the static export",
      {
        expected: staticCheck.restorePlan.marker,
        actual: options.marker,
        staticExportPreflight: staticCheck,
      },
    );
  }
  if (JSON.stringify(options.expectText || []) !==
      JSON.stringify(staticCheck.restorePlan.expectedSerialText)) {
    return restorePreflightFailure(
      "static-export-runner-mismatch",
      "expectText",
      "ordered expected serial text does not match the static export",
      {
        expected: staticCheck.restorePlan.expectedSerialText,
        actual: options.expectText || [],
        staticExportPreflight: staticCheck,
      },
    );
  }
  if (staticCheck.restorePlan.runner !==
      "scripts/ci/wasm-browser-cdp-gate.mjs") {
    return restorePreflightFailure(
      "unsupported-static-export-runner",
      "harness.runner",
      `unsupported static export runner: ${staticCheck.restorePlan.runner}`,
      { staticExportPreflight: staticCheck },
    );
  }
  let actualArgv;
  try {
    actualArgv = vmstateRestoreAffectingArgs(options);
  } catch (error) {
    return restorePreflightFailure(
      "nonportable-static-export-path",
      "harness.argv",
      error.message,
      { staticExportPreflight: staticCheck },
    );
  }
  if (JSON.stringify(actualArgv) !== JSON.stringify(staticCheck.restorePlan.argv)) {
    return restorePreflightFailure(
      "static-export-runner-mismatch",
      "harness.argv",
      "ordered restore-affecting arguments do not match the static export",
      {
        expected: staticCheck.restorePlan.argv,
        actual: actualArgv,
        staticExportPreflight: staticCheck,
      },
    );
  }
  base.staticExportProofEligible = true;
  return base;
}

async function main() {
  const options = await parseArgs(process.argv.slice(2));
  const root = process.cwd();
  requireReadable(options.chrome, "Chrome/Chromium executable");
  requireReadable(options.kernel, "kernel");
  if (options.initrd !== null) {
    requireReadable(options.initrd, "initrd");
  }
  if (options.rootfs !== null) {
    requireReadable(options.rootfs, "rootfs");
  }
  if (options.vmstateRestore) {
    requireReadable(options.vmstateRestoreStateFile, "VMState restore stream");
    if (options.vmstateRestoreSavedManifest !== "") {
      requireReadable(options.vmstateRestoreSavedManifest, "saved VMState manifest");
      requireReadable(options.vmstateRestoreCurrentManifest, "current VMState manifest");
    }
  }
  requireReadable(resolve(options.artifactDir, basename(options.program)), "program artifact");
  requireReadable(resolve(options.artifactDir, basename(options.wasm)), "wasm artifact");
  const inputEvidence = await proofInputEvidence(options);
  await mkdir(dirname(options.out), { recursive: true });
  options.vmstateRestorePreflight = await vmstateRestorePreflight(
    options,
    inputEvidence,
  );
  options.vmstateRestoreManifestCheck =
    options.vmstateRestorePreflight.vmstateRestoreManifestCheck;
  if (!options.vmstateRestorePreflight.ok) {
    const result = {
      format: 1,
      success: false,
      restoreMode: options.vmstateRestorePreflight.restoreMode,
      staticExportProofEligible: false,
      browserStarted: false,
      qemuStarted: false,
      marker: options.marker,
      markerSeen: false,
      inputEvidence,
      vmstateRestorePreflight: options.vmstateRestorePreflight,
      vmstateRestoreManifestCheck: options.vmstateRestoreManifestCheck,
      staticExportPreflight:
        options.vmstateRestorePreflight.staticExportPreflight,
      errorMessage: options.vmstateRestorePreflight.failure.message,
    };
    await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`);
    console.error(result.errorMessage);
    process.exitCode = 1;
    return;
  }

  const serverArgs = smokeServerArgs(options);
  const server = spawn(process.execPath, serverArgs, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", lineBuffer("[server] "));
  server.stderr.on("data", lineBuffer("[server] "));
  let chrome = null;
  let cdp = null;
  const cleanup = async () => {
    if (cdp !== null) {
      cdp.close();
      cdp = null;
    }
    await stopProcess(chrome);
    chrome = null;
    await stopProcess(server);
  };
  const uninstallSignalCleanup = installSignalCleanup(cleanup);

  try {
  await waitForHttp(`http://${options.host}:${options.port}/wasm-browser-smoke.html`, 10000);

  const userDataDir = resolve(dirname(options.out), "chrome-profile");
  await mkdir(userDataDir, { recursive: true });
  chrome = spawn(options.chrome, chromeLaunchArgs(options, userDataDir), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  chrome.stdout.on("data", lineBuffer("[chrome] "));
  chrome.stderr.on("data", lineBuffer("[chrome] "));
  const versionResponse = await waitForHttp(
    `http://${options.cdpHost}:${options.cdpPort}/json/version`,
    10000,
  );
  const browserVersion = browserVersionDiagnostic(await versionResponse.json());

  const targetResponse = await fetch(
    `http://${options.cdpHost}:${options.cdpPort}/json/new?${encodeURIComponent(smokeUrl(options))}`,
    { method: "PUT" },
  );
  if (!targetResponse.ok) {
    throw new Error(`create target failed: ${targetResponse.status} ${await targetResponse.text()}`);
  }
  const target = await targetResponse.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", rejectOpen, { once: true });
  });
  cdp = new CdpSession(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");

  const started = Date.now();
  const pageErrors = [];
  const consoleMessages = [];
  const resourceErrors = [];
  const requests = new Map();
  let finalState = null;
  let pageStatus = "";
  let pageOutput = "";
  let pageTextTail = "";
  let lastProgressAt = 0;
  const serialInput = options.serialInputText === "" ? null : {
    afterText: options.serialInputAfterText,
    elapsedMs: null,
    sent: false,
    target: "primary-serial",
    textLength: options.serialInputText.length,
    writeStatus: null,
  };

  while (Date.now() - started < options.timeoutMs + 5000) {
    for (const event of cdp.events.splice(0)) {
      if (event.method === "Runtime.exceptionThrown") {
        pageErrors.push({
          elapsedMs: Date.now() - started,
          exceptionDetails: event.params?.exceptionDetails || null,
        });
      } else if (event.method === "Runtime.consoleAPICalled") {
        consoleMessages.push(cdpConsoleMessageDiagnostic(
          event.params,
          Date.now() - started,
          resourceErrors,
        ));
      } else if (event.method === "Network.requestWillBeSent") {
        requests.set(event.params?.requestId, {
          requestId: event.params?.requestId,
          request: event.params?.request || null,
          initiator: event.params?.initiator || null,
          type: event.params?.type || null,
        });
      } else if (event.method === "Network.responseReceived") {
        if ((event.params?.response?.status || 0) >= 400) {
          resourceErrors.push(cdpResourceErrorDiagnostic(
            event,
            requests.get(event.params?.requestId),
            Date.now() - started,
          ));
        }
      } else if (event.method === "Network.loadingFailed") {
        resourceErrors.push(cdpResourceErrorDiagnostic(
          event,
          requests.get(event.params?.requestId),
          Date.now() - started,
        ));
      }
    }
    const snapshotJson = await cdpEval(cdp, `(() => JSON.stringify({
      status: document.querySelector('#status')?.textContent || '',
      state: globalThis.qemuWasmSmokeState || null,
      output: document.querySelector('#output')?.textContent || '',
      text: (document.body?.textContent || '').slice(-200000),
    }))()`);
    if (typeof snapshotJson === "string") {
      const snapshot = JSON.parse(snapshotJson);
      pageStatus = snapshot.status || "";
      finalState = snapshot.state || finalState;
      pageOutput = snapshot.output || pageOutput;
      pageTextTail = snapshot.text || pageTextTail;
    }
    const elapsedMs = Date.now() - started;
    if (serialInput !== null && !serialInput.sent && serialInputTriggerReady({
      output: pageOutput,
      state: finalState,
    }, serialInput.afterText)) {
      const writeStatus = await cdpEval(cdp, `(() => {
        const input = globalThis.qemuWasmPrimarySerialInput;
        if (!input || !input.state || !input.state.moduleAttached) {
          throw new Error('primary serial input is not attached');
        }
        return input.writeText(${JSON.stringify(options.serialInputText)});
      })()`);
      if (!Number.isInteger(writeStatus) || writeStatus < 0) {
        throw new Error(`primary serial input write failed: ${JSON.stringify(writeStatus)}`);
      }
      serialInput.elapsedMs = elapsedMs;
      serialInput.sent = true;
      serialInput.writeStatus = writeStatus;
    }
    if (elapsedMs - lastProgressAt >= 10000) {
      lastProgressAt = elapsedMs;
      const entries = finalState?.wasm64Tcg?.lastSummary?.generated_run_entries ??
        finalState?.wasm64Runloop?.lastSummary?.generated_run_entries ?? null;
      console.error(`[gate] elapsed=${elapsedMs} status=${JSON.stringify(pageStatus)} entries=${entries}`);
    }
    if (
      pageStatus === `marker reached: ${options.marker}` ||
      pageStatus === "Bus Engine OS is ready" ||
      pageStatus.startsWith("timeout waiting for ") ||
      pageStatus === "failed" ||
      pageErrors.length > 0
    ) {
      break;
    }
    await sleep(1000);
  }

  const elapsedMs = Date.now() - started;
  const pageSuccess = (
    pageStatus === `marker reached: ${options.marker}` ||
    pageStatus === "Bus Engine OS is ready"
  ) && pageErrors.length === 0 && (serialInput === null || serialInput.sent);
  const coldBootReadyMs =
    options.vmstateRestorePreflight?.staticExportPreflight?.coldBoot?.readyMs ??
    null;
  const restoreFasterThanColdBoot = Number.isInteger(coldBootReadyMs)
    ? elapsedMs < coldBootReadyMs
    : null;
  const success = pageSuccess && restoreFasterThanColdBoot !== false;
  const result = {
    format: 1,
    success,
    restoreMode: options.vmstateRestorePreflight.restoreMode,
    staticExportProofEligible:
      success && options.vmstateRestorePreflight.staticExportProofEligible,
    browserStarted: true,
    qemuStarted: Boolean(finalState?.phases?.some((entry) =>
      entry?.phase === "start-qemu")),
    marker: options.marker,
    markerSeen: Boolean(finalState?.markerSeen) ||
      pageStatus === `marker reached: ${options.marker}` ||
      pageStatus === "Bus Engine OS is ready",
    elapsedMs,
    browserVersion,
    inputEvidence,
    serialInput,
    browserRunnerCommand: [process.execPath, THIS_FILE, ...process.argv.slice(2)],
    qemuCommand: finalState?.qemuArgs || [],
    vmstateRestoreManifestCheck: options.vmstateRestoreManifestCheck,
    vmstateRestorePreflight: options.vmstateRestorePreflight,
    staticExportPreflight:
      options.vmstateRestorePreflight?.staticExportPreflight || null,
    pageStatus,
    smokeUrl: smokeUrl(options),
    pageErrors,
    consoleMessages: consoleMessages.slice(-200),
    resourceErrors: resourceErrors.slice(-200),
    pageTextTail,
    lastLine: finalState?.lastLine || null,
    guestLastLine: finalState?.guestLastLine || null,
    expectedTextSeen: finalState?.expectedTextSeen || [],
    programExitStatus: finalState?.programExitStatus ?? null,
    vmstateRestoreState: finalState?.vmstateRestore || null,
    timing: options.vmstateRestore ? {
      restoreReadyMs: elapsedMs,
      coldBootReadyMs,
      restoreImportMs: finalState?.vmstateRestore?.totalMs ?? null,
      restoreFasterThanColdBoot,
    } : null,
    coldBootFallback:
      options.vmstateRestorePreflight?.staticExportPreflight?.coldBoot || null,
    finalState: {
      pageStatus,
      markerSeen: Boolean(finalState?.markerSeen) ||
        pageStatus === `marker reached: ${options.marker}` ||
        pageStatus === "Bus Engine OS is ready",
      lastLine: finalState?.lastLine || null,
      guestLastLine: finalState?.guestLastLine || null,
      expectedTextSeen: finalState?.expectedTextSeen || [],
      programExitStatus: finalState?.programExitStatus ?? null,
    },
    serialBlocker: pageErrors[0]?.exceptionDetails?.exception?.description || null,
    wasm64Tcg: finalState?.wasm64Tcg || null,
    wasm64Runloop: finalState?.wasm64Runloop || null,
    smokeState: finalState,
  };
  await writeFile(options.out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    outPath: options.out,
    markerSeen: result.markerSeen,
    elapsedMs: result.elapsedMs,
    generated_run_entries: result.wasm64Tcg?.lastSummary?.generated_run_entries ??
      result.wasm64Runloop?.lastSummary?.generated_run_entries ?? null,
    browserVersion: result.browserVersion?.browser || null,
    pageStatus: result.pageStatus,
    pageErrors: result.pageErrors.length,
    serialBlocker: result.serialBlocker,
    lastLine: result.lastLine,
    guestLastLine: result.guestLastLine,
  }, null, 2));
  if (!result.success) {
    process.exitCode = 1;
  }
  } finally {
    uninstallSignalCleanup();
    await cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  main().catch(async (error) => {
    const message = error && error.message ? error.message : String(error);
    try {
      const fallbackOut = process.argv.includes("--out")
        ? process.argv[process.argv.indexOf("--out") + 1]
        : null;
      if (fallbackOut) {
        await mkdir(dirname(resolve(fallbackOut)), { recursive: true });
        await writeFile(resolve(fallbackOut), JSON.stringify({
          success: false,
          errorMessage: message,
          stack: error && error.stack ? error.stack : null,
        }, null, 2));
      }
    } catch {
      /* best-effort failure report */
    }
    console.error(error && error.stack ? error.stack : message);
    process.exit(1);
  });
}
