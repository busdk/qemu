#!/usr/bin/env node
/*
 * Dependency-free Chrome DevTools Protocol gate for QEMU WebAssembly smoke runs.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const SERVICE_REQUEST_ID_RE =
  /^gate2-initialize-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVICE_REQUEST_TIMEOUT_MS = 10000;

function usage(status = 0) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-cdp-gate.mjs --artifact-dir DIR --kernel FILE [--initrd FILE | --rootfs FILE] --out FILE [OPTIONS]\n\nRuns the QEMU WebAssembly browser smoke page through Chrome DevTools Protocol, without Playwright.\n\nOptions:\n  --artifact-dir DIR       Directory containing qemu-system-*.js/.wasm artifacts\n  --guest-manifest FILE    Load guest defaults such as kernel/rootfs/marker\n  --kernel FILE            Guest kernel served as /guest/kernel\n  --initrd FILE            Guest initramfs image\n  --rootfs FILE            Guest rootfs served as /guest/rootfs.raw\n  --out FILE               Write result JSON\n  --chrome FILE            Chrome/Chromium executable\n  --firmware-dir DIR       Directory containing QEMU firmware blobs\n  --host HOST              Smoke server host (default: 127.0.0.1)\n  --port N                 Smoke server port (default: 8151)\n  --cdp-port N             Chrome remote-debugging port (default: 9223)\n  --program FILE           QEMU JS artifact basename (default: manifest or qemu-system-riscv64.js)\n  --wasm FILE              QEMU WASM artifact basename (default: derived from program)\n  --marker TEXT            Required marker text (default: manifest or Welcome to TuxTest)\n  --timeout-ms N           Smoke timeout (default: manifest or 180000)\n  --max-output-bytes N     Smoke output byte cap (default: 160000)\n  --memory SIZE            Guest memory (default: manifest or 512M)\n  --machine NAME           QEMU machine (default: manifest or virt)\n  --cpu MODEL              QEMU CPU model (default: manifest or empty)\n  --rootfs-device KIND     Rootfs block device (default: manifest or virtio-mmio)\n  --target-arch ARCH       Guest target architecture for firmware mounts\n  --kernel-append TEXT     Kernel command line\n  --vmstate-restore        Enable browser VMState restore import\n  --vmstate-restore-state-file FILE\n                           Local VMState stream served as /vmstate/restore\n  --vmstate-restore-state-bytes N\n                           Expected VMState byte length\n  --vmstate-restore-state-sha256 HASH\n                           Expected VMState SHA-256\n  --vmstate-restore-saved-manifest FILE\n                           Saved-state compatibility manifest\n  --vmstate-restore-current-manifest FILE\n                           Current compatibility manifest\n  --diagnostics-limit N    Live-generated-exec diagnostics limit (default: 24)\n  --no-live-generated-exec Disable live generated exec query flags\n  --help                   Show this help\n`);
  stream.write(`Static restore options:\n  --expect-text TEXT       Additional serial text required for success; repeatable\n  --vmstate-restore-proof  Require acceptance-shaped fail-closed proof evidence\n  --vmstate-restore-static-export-manifest FILE\n                           Fail-closed static export source of truth\n`);
  stream.write(`Service request options:
  --service-request-operation initialize
                           Send one initialize request after guest readiness
  --service-request-timeout-ms 10000
                           Request timeout (default and required: 10000 ms)
  --qemu-arg ARG           Additional ordered QEMU argument; repeatable
`);
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
    serviceRequestOperation: "",
    serviceRequestTimeoutMs: 10000,
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
    } else if (arg === "--service-request-operation") {
      options.serviceRequestOperation = argv[++i];
      explicit.add("serviceRequestOperation");
    } else if (arg === "--service-request-timeout-ms") {
      options.serviceRequestTimeoutMs = Number(argv[++i]);
      explicit.add("serviceRequestTimeoutMs");
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
  if (options.qemuArgs.some((arg) => typeof arg !== "string" || arg === "")) {
    console.error("--qemu-arg must be a non-empty string");
    usage(2);
  }
  if (options.serviceRequestOperation !== "" &&
      options.serviceRequestOperation !== "initialize") {
    console.error("--service-request-operation only supports initialize");
    usage(2);
  }
  if (explicit.has("serviceRequestTimeoutMs") &&
      options.serviceRequestOperation === "") {
    console.error("--service-request-timeout-ms requires --service-request-operation");
    usage(2);
  }
  if (options.serviceRequestTimeoutMs !== SERVICE_REQUEST_TIMEOUT_MS) {
    console.error("--service-request-timeout-ms must be exactly 10000 for initialize");
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
  for (const qemuArg of options.qemuArgs || []) {
    url.searchParams.append("qemuArg", qemuArg);
  }
  if (options.serviceRequestOperation === "initialize") {
    url.searchParams.set("serviceBridge", JSON.stringify({
      kind: "virtio-serial-jsonl",
      requestChannel: "org.qemu.wasm.service.request",
      responseChannel: "org.qemu.wasm.service.response",
      readinessMarker: "QEMU_WASM_SERVICE_READY",
      healthRequest: { operation: "health" },
      timeoutMs: options.serviceRequestTimeoutMs,
      maxPayloadBytes: 16384,
      interactiveOnly: true,
    }));
  }
  url.searchParams.set("powerOperation", "");
  url.searchParams.set("powerTimeoutMs", "30000");
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

async function cdpEval(cdp, expression, timeout = 5000) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout,
  });
  if (result.exceptionDetails) {
    return { exception: result.exceptionDetails.text || "exception" };
  }
  return result.result?.value;
}

function hasForbiddenServiceEvidence(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasForbiddenServiceEvidence(entry));
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (["body", "payload", "params", "error", "env"].includes(key.toLowerCase()) ||
        hasForbiddenServiceEvidence(entry)) {
      return true;
    }
  }
  return false;
}

export function createServiceRequestId(uuid = randomUUID()) {
  const requestId = `gate2-initialize-${uuid}`;
  if (!SERVICE_REQUEST_ID_RE.test(requestId) || requestId.length > 64) {
    throw new Error("invalid generated service request id");
  }
  return requestId;
}

export function serializeCdpResult(result) {
  if (result?.smokeState === null ||
      typeof result?.smokeState !== "object" ||
      Array.isArray(result.smokeState)) {
    return JSON.stringify(result, null, 2);
  }
  const smokeState = { ...result.smokeState };
  delete smokeState.serviceBridge;
  return JSON.stringify({ ...result, smokeState }, null, 2);
}

export async function runServiceRoundtripInPage(
  request,
  scope = globalThis,
  now = () => scope.performance.now(),
) {
  const requestIdRe =
    /^gate2-initialize-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const boundedScalar = (value, maxLength) =>
    typeof value === "string" && value.length > 0 &&
    value.length <= maxLength ? value : null;
  const nonnegativeInteger = (value) =>
    Number.isInteger(value) && value >= 0 ? value : null;
  const bridge = scope.qemuWasmServiceBridge;
  const state = bridge?.state;
  const startedAtMs = Number(now());
  const stateSnapshot = (candidate) => ({
    ready: candidate?.ready === true,
    readySource: boundedScalar(candidate?.readySource, 32),
    moduleAttached: candidate?.moduleAttached === true,
    interactiveOnly: candidate?.interactiveOnly === true,
    healthRequested: candidate?.healthRequested === true,
    pending: nonnegativeInteger(candidate?.pending),
    sent: nonnegativeInteger(candidate?.sent),
    received: nonnegativeInteger(candidate?.received),
    resolved: nonnegativeInteger(candidate?.resolved),
    timedOut: nonnegativeInteger(candidate?.timedOut),
    lastRequestId: boundedScalar(candidate?.lastRequestId, 64),
    lastResponseId: boundedScalar(candidate?.lastResponseId, 64),
  });
  const before = stateSnapshot(state);
  const requestId =
    typeof request?.requestId === "string" &&
    requestIdRe.test(request.requestId) &&
    request.requestId.length <= 64 ? request.requestId : null;
  const preconditionsOk =
    request?.operation === "initialize" &&
    requestId !== null &&
    request?.timeoutMs === 10000 &&
    typeof bridge?.request === "function" &&
    before.ready &&
    before.readySource === "serial" &&
    before.moduleAttached &&
    before.interactiveOnly &&
    !before.healthRequested &&
    before.pending === 0;
  let response = null;
  let requestRejected = false;
  if (preconditionsOk) {
    try {
      response = await bridge.request({
        id: request.requestId,
        operation: request.operation,
      }, {
        timeoutMs: request.timeoutMs,
      });
    } catch {
      requestRejected = true;
    }
  }
  const completedAtMs = Number(now());
  const after = stateSnapshot(state);
  const responseIsObject = response !== null &&
    typeof response === "object" && !Array.isArray(response);
  const responseFieldsSafe = responseIsObject &&
    Object.keys(response).every((key) =>
      ["id", "operation", "status", "adapter", "app_server"].includes(key));
  const selectedResponse = responseIsObject ? {
    id: response.id === requestId ? requestId : null,
    operation: response.operation === "initialize" ? "initialize" : null,
    status: response.status === "ok" ? "ok" : null,
    adapter: response.adapter === "ready" ? "ready" : null,
    app_server: response.app_server === "initialized" ? "initialized" : null,
  } : null;
  const responseProjectionSafe = responseFieldsSafe &&
    Object.values(selectedResponse).every((value) => value !== null);
  let classification = "precondition-failed";
  if (preconditionsOk && requestRejected) {
    classification = after.timedOut === before.timedOut + 1
      ? "timeout"
      : "error";
  } else if (preconditionsOk && selectedResponse !== null) {
    classification =
      responseProjectionSafe &&
      selectedResponse.id === request.requestId &&
      selectedResponse.operation === "initialize" &&
      selectedResponse.status === "ok" &&
      selectedResponse.adapter === "ready" &&
      selectedResponse.app_server === "initialized"
        ? "success"
        : "error";
  }
  return {
    source: "qemuWasmServiceBridge.request",
    operation: request?.operation ?? null,
    requestId: request?.requestId ?? null,
    timeoutMs: request?.timeoutMs ?? null,
    readiness: {
      readyBefore: before.ready,
      readyAfter: after.ready,
      readySourceBefore: before.readySource,
      readySourceAfter: after.readySource,
      moduleAttachedBefore: before.moduleAttached,
      moduleAttachedAfter: after.moduleAttached,
      interactiveOnlyBefore: before.interactiveOnly,
      interactiveOnlyAfter: after.interactiveOnly,
      healthRequestedBefore: before.healthRequested,
      healthRequestedAfter: after.healthRequested,
    },
    transport: {
      pendingBefore: before.pending,
      pendingAfter: after.pending,
      sentBefore: before.sent,
      sentAfter: after.sent,
      receivedBefore: before.received,
      receivedAfter: after.received,
      resolvedBefore: before.resolved,
      resolvedAfter: after.resolved,
      timedOutBefore: before.timedOut,
      timedOutAfter: after.timedOut,
      lastRequestId: after.lastRequestId === requestId ? requestId : null,
      lastResponseId: after.lastResponseId === requestId ? requestId : null,
    },
    response: selectedResponse,
    responseProjectionSafe,
    classification,
    timing: {
      startedAtMs,
      completedAtMs,
      elapsedMs: completedAtMs - startedAtMs,
    },
  };
}

export function serviceRoundtripSucceeded(evidence) {
  const readiness = evidence?.readiness;
  const transport = evidence?.transport;
  const response = evidence?.response;
  const timing = evidence?.timing;
  const transportCountersValid = [
    "sentBefore",
    "sentAfter",
    "receivedBefore",
    "receivedAfter",
    "resolvedBefore",
    "resolvedAfter",
    "timedOutBefore",
    "timedOutAfter",
  ].every((field) =>
    Number.isInteger(transport?.[field]) && transport[field] >= 0);
  const elapsedMatches = Number.isFinite(timing?.startedAtMs) &&
    timing.startedAtMs >= 0 &&
    Number.isFinite(timing?.completedAtMs) &&
    timing.completedAtMs >= timing.startedAtMs &&
    Number.isFinite(timing?.elapsedMs) &&
    timing.elapsedMs >= 0 &&
    Math.abs(
      timing.elapsedMs - (timing.completedAtMs - timing.startedAtMs),
    ) <= 0.001 &&
    timing.elapsedMs <= evidence?.timeoutMs;
  return evidence?.source === "qemuWasmServiceBridge.request" &&
    evidence?.operation === "initialize" &&
    typeof evidence?.requestId === "string" &&
    evidence.requestId.length <= 64 &&
    SERVICE_REQUEST_ID_RE.test(evidence.requestId) &&
    evidence?.timeoutMs === SERVICE_REQUEST_TIMEOUT_MS &&
    readiness?.readyBefore === true &&
    readiness?.readyAfter === true &&
    readiness?.readySourceBefore === "serial" &&
    readiness?.readySourceAfter === "serial" &&
    readiness?.moduleAttachedBefore === true &&
    readiness?.moduleAttachedAfter === true &&
    readiness?.interactiveOnlyBefore === true &&
    readiness?.interactiveOnlyAfter === true &&
    readiness?.healthRequestedBefore === false &&
    readiness?.healthRequestedAfter === false &&
    transport?.pendingBefore === 0 &&
    transport?.pendingAfter === 0 &&
    transportCountersValid &&
    transport?.sentAfter === transport?.sentBefore + 1 &&
    transport?.receivedAfter === transport?.receivedBefore + 1 &&
    transport?.resolvedAfter === transport?.resolvedBefore + 1 &&
    transport?.timedOutAfter === transport?.timedOutBefore &&
    transport?.lastRequestId === evidence.requestId &&
    transport?.lastResponseId === evidence.requestId &&
    response?.id === evidence.requestId &&
    response?.operation === "initialize" &&
    response?.status === "ok" &&
    response?.adapter === "ready" &&
    response?.app_server === "initialized" &&
    evidence?.responseProjectionSafe === true &&
    evidence?.classification === "success" &&
    elapsedMatches &&
    !hasForbiddenServiceEvidence(evidence);
}

async function requestServiceRoundtrip(cdp, options) {
  const request = {
    operation: options.serviceRequestOperation,
    requestId: createServiceRequestId(),
    timeoutMs: options.serviceRequestTimeoutMs,
  };
  const expression =
    `(${runServiceRoundtripInPage.toString()})(${JSON.stringify(request)})`;
  try {
    return await cdpEval(
      cdp,
      expression,
      Math.min(options.serviceRequestTimeoutMs + 1000, 61000),
    );
  } catch {
    return {
      source: "qemuWasmServiceBridge.request",
      operation: request.operation,
      requestId: request.requestId,
      timeoutMs: request.timeoutMs,
      classification: "cdp-error",
    };
  }
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
  chrome = spawn(options.chrome, [
    "--headless=new",
    `--remote-debugging-port=${options.cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-gpu",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stdout.on("data", lineBuffer("[chrome] "));
  chrome.stderr.on("data", lineBuffer("[chrome] "));
  const versionResponse = await waitForHttp(
    `http://127.0.0.1:${options.cdpPort}/json/version`,
    10000,
  );
  const browserVersion = browserVersionDiagnostic(await versionResponse.json());

  const targetResponse = await fetch(
    `http://127.0.0.1:${options.cdpPort}/json/new?${encodeURIComponent(smokeUrl(options))}`,
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
  let pageTextTail = "";
  let lastProgressAt = 0;

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
      text: (document.body?.textContent || '').slice(-200000),
    }))()`);
    if (typeof snapshotJson === "string") {
      const snapshot = JSON.parse(snapshotJson);
      pageStatus = snapshot.status || "";
      finalState = snapshot.state || finalState;
      pageTextTail = snapshot.text || pageTextTail;
    }
    const elapsedMs = Date.now() - started;
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

  const pageReady = (
    pageStatus === `marker reached: ${options.marker}` ||
    pageStatus === "Bus Engine OS is ready"
  );
  let serviceRoundtrip = null;
  if (options.serviceRequestOperation !== "" &&
      pageReady && pageErrors.length === 0) {
    serviceRoundtrip = await requestServiceRoundtrip(cdp, options);
  }
  const elapsedMs = Date.now() - started;
  const pageSuccess = pageReady && pageErrors.length === 0 &&
    (options.serviceRequestOperation === "" ||
      serviceRoundtripSucceeded(serviceRoundtrip));
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
    serviceRoundtrip,
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
  await writeFile(options.out, serializeCdpResult(result));
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
