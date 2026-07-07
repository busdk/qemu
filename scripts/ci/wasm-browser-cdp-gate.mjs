#!/usr/bin/env node
/*
 * Dependency-free Chrome DevTools Protocol gate for QEMU WebAssembly smoke runs.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";
import { installSignalCleanup } from "./wasm-playwright-loader.mjs";

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
  stream.write(`usage: wasm-browser-cdp-gate.mjs --artifact-dir DIR --kernel FILE [--initrd FILE | --rootfs FILE] --out FILE [OPTIONS]\n\nRuns the QEMU WebAssembly browser smoke page through Chrome DevTools Protocol, without Playwright.\n\nOptions:\n  --artifact-dir DIR       Directory containing qemu-system-*.js/.wasm artifacts\n  --guest-manifest FILE    Load guest defaults such as kernel/rootfs/marker\n  --kernel FILE            Guest kernel served as /guest/kernel\n  --initrd FILE            Guest initramfs served as /guest/initramfs.cpio.gz\n  --rootfs FILE            Guest rootfs served as /guest/rootfs.raw\n  --out FILE               Write result JSON\n  --chrome FILE            Chrome/Chromium executable\n  --firmware-dir DIR       Directory containing QEMU firmware blobs\n  --host HOST              Smoke server host (default: 127.0.0.1)\n  --port N                 Smoke server port (default: 8151)\n  --cdp-port N             Chrome remote-debugging port (default: 9223)\n  --program FILE           QEMU JS artifact basename (default: manifest or qemu-system-riscv64.js)\n  --wasm FILE              QEMU WASM artifact basename (default: derived from program)\n  --marker TEXT            Required marker text (default: manifest or Welcome to TuxTest)\n  --timeout-ms N           Smoke timeout (default: manifest or 180000)\n  --max-output-bytes N     Smoke output byte cap (default: 160000)\n  --memory SIZE            Guest memory (default: manifest or 512M)\n  --machine NAME           QEMU machine (default: manifest or virt)\n  --cpu MODEL              QEMU CPU model (default: manifest or empty)\n  --rootfs-device KIND     Rootfs block device (default: manifest or virtio-mmio)\n  --target-arch ARCH       Guest target architecture for firmware mounts\n  --kernel-append TEXT     Kernel command line\n  --diagnostics-limit N    Live-generated-exec diagnostics limit (default: 24)\n  --no-live-generated-exec Disable live generated exec query flags\n  --help                   Show this help\n`);
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
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    targetArch: "riscv64",
    timeoutMs: 180000,
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
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
      explicit.add("rootfs");
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
      explicit.add("rootfsDevice");
    } else if (arg === "--target-arch") {
      options.targetArch = argv[++i];
      explicit.add("targetArch");
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
      explicit.add("timeoutMs");
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
    pathFields: ["artifactDir", "firmwareDir", "initrd", "kernel", "rootfs"],
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
      "wasm",
    ],
  });

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
  url.searchParams.set("focusDisplay", "0");
  url.searchParams.set("marker", options.marker);
  url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
  url.searchParams.set("memory", options.memory);
  url.searchParams.set("machine", options.machine);
  url.searchParams.set("network", options.network);
  url.searchParams.set("program", `/artifacts/${basename(options.program)}`);
  url.searchParams.set("wasm", `/artifacts/${basename(options.wasm)}`);
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

function requireReadable(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
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
  requireReadable(resolve(options.artifactDir, basename(options.program)), "program artifact");
  requireReadable(resolve(options.artifactDir, basename(options.wasm)), "wasm artifact");
  await mkdir(dirname(options.out), { recursive: true });

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
  await waitForHttp(`http://127.0.0.1:${options.cdpPort}/json/version`, 10000);

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
      pageStatus.startsWith("timeout waiting for ") ||
      pageStatus === "failed" ||
      pageErrors.length > 0
    ) {
      break;
    }
    await sleep(1000);
  }

  const elapsedMs = Date.now() - started;
  const result = {
    format: 1,
    success: pageStatus === `marker reached: ${options.marker}` && pageErrors.length === 0,
    marker: options.marker,
    markerSeen: Boolean(finalState?.markerSeen) || pageStatus === `marker reached: ${options.marker}`,
    elapsedMs,
    pageStatus,
    smokeUrl: smokeUrl(options),
    pageErrors,
    consoleMessages: consoleMessages.slice(-200),
    resourceErrors: resourceErrors.slice(-200),
    pageTextTail,
    lastLine: finalState?.lastLine || null,
    guestLastLine: finalState?.guestLastLine || null,
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
