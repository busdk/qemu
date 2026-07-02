/*
 * Browser harness for QEMU WebAssembly smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const DEFAULT_MARKER = "QEMU_WASM_LINUX_BOOT_OK";
const POWER_OPERATIONS = new Set([
  "",
  "shutdown",
  "reboot",
  "guest-powerdown",
  "force-reset",
  "force-poweroff",
]);
const QEMU_WASM_POWER_ACTIONS = {
  "guest-powerdown": 1,
  "force-reset": 2,
  "force-poweroff": 3,
};
const OPTIONAL_FIRMWARE_FILES = [
  "bios-256k.bin",
  "kvmvapic.bin",
  "vgabios.bin",
  "vgabios-stdvga.bin",
  "efi-virtio.rom",
];
const DEFAULT_ROOTFS_OPFS_NAME = "qemu-wasm-rootfs.raw";
const OPFS_ROOTFS_DIRECTORY = "qemu-wasm-rootfs";
const DEFAULT_PERSISTENT_DISK_OPFS_NAME = "qemu-wasm-persistent.raw";
const DEFAULT_PERSISTENT_DISK_SIZE_BYTES = 256 * 1024 * 1024;
const OPFS_PERSISTENT_DISK_DIRECTORY = "qemu-wasm-persistent-disk";

function option(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value === "" ? fallback : value;
}

function pathOption(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null ? fallback : value;
}

function listOption(name) {
  return new URLSearchParams(window.location.search).getAll(name);
}

function numberOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeNumberOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function text(id) {
  return document.getElementById(id);
}

function boolOption(name, fallback) {
  const value = option(name, fallback ? "1" : "0").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function jsonObjectOption(name, fallback) {
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null || raw === "") {
    return fallback;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON object`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value;
}

function parseResolution(value) {
  if (value === "") {
    return null;
  }
  const match = /^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/.exec(value);
  if (match === null) {
    throw new Error("expectedResolution must use WIDTHxHEIGHT");
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function appendLine(target, line) {
  target.textContent += `${line}\n`;
  target.scrollTop = target.scrollHeight;
}

async function fetchBytes(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchOptionalBytes(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createParentPaths(module, path) {
  const parts = path.split("/").filter(Boolean).slice(0, -1);
  let current = "/";
  for (const part of parts) {
    module.FS_createPath(current, part, true, true);
    current = `${current === "/" ? "" : current}/${part}`;
  }
}

function mountFiles(module, mounts) {
  for (const mount of mounts) {
    createParentPaths(module, mount.path);
    module.FS.writeFile(mount.path, mount.data);
  }
}

function validateOpfsFileName(name, optionName = "rootfsOpfsName") {
  if (name === "" || /[\\/]/.test(name)) {
    throw new Error(`${optionName} must be a non-empty file name without path separators`);
  }
}

async function openOpfsDirectory(directoryName, create) {
  if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") {
    throw new Error("OPFS is not available in this browser");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(directoryName, { create });
}

async function readOpfsSnapshot(directoryName, name, optionName) {
  validateOpfsFileName(name, optionName);
  try {
    const directory = await openOpfsDirectory(directoryName, false);
    const fileHandle = await directory.getFileHandle(name, { create: false });
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (error && error.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

async function writeOpfsSnapshot(directoryName, name, optionName, data) {
  validateOpfsFileName(name, optionName);
  const directory = await openOpfsDirectory(directoryName, true);
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.truncate(0);
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

async function readRootfsOpfsSnapshot(name) {
  return readOpfsSnapshot(OPFS_ROOTFS_DIRECTORY, name, "rootfsOpfsName");
}

async function writeRootfsOpfsSnapshot(name, data) {
  return writeOpfsSnapshot(OPFS_ROOTFS_DIRECTORY, name, "rootfsOpfsName", data);
}

async function browserStorageSnapshot() {
  const snapshot = {
    opfs: Boolean(navigator.storage && navigator.storage.getDirectory),
    persisted: null,
    estimate: null,
  };
  if (!navigator.storage) {
    return snapshot;
  }
  if (typeof navigator.storage.persisted === "function") {
    snapshot.persisted = await navigator.storage.persisted();
  }
  if (typeof navigator.storage.estimate === "function") {
    snapshot.estimate = await navigator.storage.estimate();
  }
  return snapshot;
}

async function loadRootfsData(mount, config, storageState) {
  if (config.rootfsStorage !== "opfs-snapshot") {
    storageState.loadSource = "network";
    const data = await fetchBytes(mount.url);
    storageState.loadedBytes = data.length;
    return data;
  }

  const snapshot = await readRootfsOpfsSnapshot(config.rootfsOpfsName);
  if (snapshot !== null) {
    storageState.loadSource = "opfs";
    storageState.loadedBytes = snapshot.length;
    return snapshot;
  }

  const fetched = await fetchBytes(mount.url);
  storageState.loadSource = "network";
  storageState.loadedBytes = fetched.length;
  storageState.seededFromNetwork = true;
  return fetched;
}

async function loadPersistentDiskData(config, storageState) {
  if (!config.persistentDisk) {
    return null;
  }
  if (config.persistentDiskStorage !== "opfs") {
    throw new Error("persistentDiskStorage must be opfs");
  }
  const snapshot = await readOpfsSnapshot(
    OPFS_PERSISTENT_DISK_DIRECTORY,
    config.persistentDiskOpfsName,
    "persistentDiskOpfsName",
  );
  if (snapshot !== null) {
    storageState.loadSource = "opfs";
    storageState.loadedBytes = snapshot.length;
    return snapshot;
  }
  storageState.loadSource = "empty";
  storageState.loadedBytes = config.persistentDiskSizeBytes;
  storageState.seededEmpty = true;
  return new Uint8Array(config.persistentDiskSizeBytes);
}

function programExitStatus(line) {
  const match = /^program exited \(with status: ([0-9]+)\)/.exec(line);
  return match === null ? null : Number(match[1]);
}

export function hotBlockSummary(line) {
  const prefix = "qemu-tcg-hotblocks: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const summary = JSON.parse(line.slice(prefix.length));
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

export function perfAttributionSummary(line) {
  const prefix = "qemu-wasm-perf-attrib: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const summary = JSON.parse(line.slice(prefix.length));
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

export function tciWasmSubsetSummary(line) {
  const prefix = "qemu-tci-wasm-subset: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const summary = JSON.parse(line.slice(prefix.length));
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

export function tciWasmGeneratedTrace(line) {
  const prefix = "qemu-tci-wasm-generated-trace: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const trace = JSON.parse(line.slice(prefix.length));
    if (trace === null || typeof trace !== "object" || Array.isArray(trace)) {
      return null;
    }
    return trace;
  } catch {
    return null;
  }
}

export function fwCfgTrace(line) {
  const prefix = "qemu-fw-cfg-trace: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const trace = JSON.parse(line.slice(prefix.length));
    if (trace === null || typeof trace !== "object" || Array.isArray(trace)) {
      return null;
    }
    return trace;
  } catch {
    return null;
  }
}

export function tciProgressSummary(line) {
  const prefix = "qemu-tci-progress: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const summary = JSON.parse(line.slice(prefix.length));
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

export function wasm64TcgSummary(line) {
  const prefix = "qemu-wasm64-tcg: ";

  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const summary = JSON.parse(line.slice(prefix.length));
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

export function recordHotBlockSummary(state, line, elapsedMs) {
  if (!state || !state.hotBlocks || !state.hotBlocks.enabled) {
    return;
  }
  const summary = hotBlockSummary(line);
  if (summary === null) {
    return;
  }
  state.hotBlocks.summaryCount += 1;
  state.hotBlocks.lastSummary = {
    elapsedMs,
    ...summary,
  };
  state.hotBlocks.summaries.push(state.hotBlocks.lastSummary);
  if (state.hotBlocks.summaries.length > state.hotBlocks.maxSummaries) {
    state.hotBlocks.summaries.shift();
  }
}

export function recordTciWasmSubsetSummary(state, line, elapsedMs) {
  if (!state || !state.tci || !state.tci.wasmSubset ||
      !state.tci.wasmSubset.enabled) {
    return;
  }
  const summary = tciWasmSubsetSummary(line);
  if (summary === null) {
    return;
  }
  state.tci.wasmSubset.summaryCount += 1;
  state.tci.wasmSubset.lastSummary = {
    elapsedMs,
    ...summary,
  };
  state.tci.wasmSubset.summaries.push(state.tci.wasmSubset.lastSummary);
  if (state.tci.wasmSubset.summaries.length >
      state.tci.wasmSubset.maxSummaries) {
    state.tci.wasmSubset.summaries.shift();
  }
}

export function recordTciWasmGeneratedTrace(state, line, elapsedMs) {
  if (!state || !state.tci || !state.tci.wasmSubset ||
      !state.tci.wasmSubset.generatedTrace ||
      !state.tci.wasmSubset.generatedTrace.enabled) {
    return;
  }
  const trace = tciWasmGeneratedTrace(line);
  if (trace === null) {
    return;
  }
  const generatedTrace = state.tci.wasmSubset.generatedTrace;

  generatedTrace.count += 1;
  generatedTrace.last = {
    elapsedMs,
    ...trace,
  };
  generatedTrace.entries.push(generatedTrace.last);
  if (generatedTrace.entries.length > generatedTrace.limit) {
    generatedTrace.entries.shift();
  }
}

export function recordFwCfgTrace(state, line, elapsedMs) {
  if (!state || !state.fwCfgTrace || !state.fwCfgTrace.enabled) {
    return;
  }
  const trace = fwCfgTrace(line);
  if (trace === null) {
    return;
  }
  state.fwCfgTrace.count += 1;
  state.fwCfgTrace.last = {
    elapsedMs,
    ...trace,
  };
  state.fwCfgTrace.entries.push(state.fwCfgTrace.last);
  if (state.fwCfgTrace.entries.length > state.fwCfgTrace.limit) {
    state.fwCfgTrace.entries.shift();
  }
}

export function recordWasm64TcgSummary(state, line, elapsedMs) {
  if (!state || !state.wasm64Tcg) {
    return;
  }
  const summary = wasm64TcgSummary(line);
  if (summary === null) {
    return;
  }
  state.wasm64Tcg.summaryCount += 1;
  state.wasm64Tcg.lastSummary = {
    elapsedMs,
    ...summary,
  };
  state.wasm64Tcg.summaries.push(state.wasm64Tcg.lastSummary);
  if (state.wasm64Tcg.summaries.length > state.wasm64Tcg.maxSummaries) {
    state.wasm64Tcg.summaries.shift();
  }
}

export function recordTciProgressSummary(state, line, elapsedMs) {
  if (!state || !state.tci || !state.tci.progress ||
      !state.tci.progress.enabled) {
    return;
  }
  const summary = tciProgressSummary(line);
  if (summary === null) {
    return;
  }
  state.tci.progress.summaryCount += 1;
  state.tci.progress.lastSummary = {
    elapsedMs,
    ...summary,
  };
  state.tci.progress.summaries.push(state.tci.progress.lastSummary);
  if (state.tci.progress.summaries.length >
      state.tci.progress.maxSummaries) {
    state.tci.progress.summaries.shift();
  }
}

export function recordPerfAttributionSummary(state, line, elapsedMs) {
  if (!state || !state.performanceAttribution || !state.performanceAttribution.enabled) {
    return;
  }
  const summary = perfAttributionSummary(line);
  if (summary === null) {
    return;
  }
  state.performanceAttribution.summaryCount += 1;
  state.performanceAttribution.lastSummary = {
    elapsedMs,
    ...summary,
  };
  state.performanceAttribution.summaries.push(state.performanceAttribution.lastSummary);
  if (
    state.performanceAttribution.summaries.length >
    state.performanceAttribution.maxSummaries
  ) {
    state.performanceAttribution.summaries.shift();
  }
}

export const BOOT_MILESTONES = [
  {
    id: "kernel_linux_version",
    label: "Linux kernel version printed",
    pattern: /^Linux version /,
  },
  {
    id: "root_block_device",
    label: "root block device discovered",
    pattern: /(?:virtio_blk .*\[vda\]|\[vda\] [0-9]+ 512-byte logical blocks)/,
  },
  {
    id: "rootfs_mounted",
    label: "root filesystem mounted",
    pattern: /(?:VFS: Mounted root|EXT4-fs \(vda\): mounted filesystem)/,
  },
  {
    id: "init_started",
    label: "init process started",
    pattern: /(?:Run .* as init process|systemd\[1\]: systemd )/,
  },
  {
    id: "systemd_hostname",
    label: "systemd hostname configured",
    pattern: /systemd\[1\]: Hostname set/,
  },
  {
    id: "journald_started",
    label: "systemd journal service started",
    pattern: /systemd\[1\]: .*(?:systemd-journald|Journal Service)/,
  },
  {
    id: "udev_started",
    label: "udev device manager started",
    pattern: /systemd\[1\]: .*(?:udev|Rule-based Manager for Device Events)/,
  },
  {
    id: "basic_target",
    label: "systemd basic target reached",
    pattern: /systemd\[1\]: Reached target .*Basic System/,
  },
  {
    id: "multi_user_target",
    label: "systemd multi-user target reached",
    pattern: /systemd\[1\]: Reached target .*Multi-User System/,
  },
  {
    id: "login_prompt",
    label: "login prompt visible",
    pattern: /(?:^|\s)[^\s:]+ login:\s*$/,
  },
  {
    id: "service_ready_marker",
    label: "service readiness marker printed",
    pattern: /QEMU_WASM_SERVICE_READY/,
  },
];

export function bootMilestoneForLine(line) {
  if (typeof line !== "string" || line === "") {
    return null;
  }
  for (const milestone of BOOT_MILESTONES) {
    if (milestone.pattern.test(line)) {
      return {
        id: milestone.id,
        label: milestone.label,
      };
    }
  }
  return null;
}

export function recordBootMilestone(state, line, elapsedMs) {
  if (!state || !state.bootMilestones) {
    return null;
  }
  const milestone = bootMilestoneForLine(line);
  if (milestone === null) {
    return null;
  }
  if (state.bootMilestones.byId[milestone.id]) {
    return state.bootMilestones.byId[milestone.id];
  }
  const entry = {
    ...milestone,
    elapsedMs,
    line,
  };
  state.bootMilestones.byId[milestone.id] = entry;
  state.bootMilestones.entries.push(entry);
  state.bootMilestones.count = state.bootMilestones.entries.length;
  state.bootMilestones.last = entry;
  return entry;
}


function serviceBridgeResponseStatus(response) {
  if (typeof response.status === "string" && response.status !== "") {
    return response.status;
  }
  if (typeof response.error === "string" && response.error !== "") {
    return "error";
  }
  return "ok";
}

function serviceBridgeRequestId(request, sequence) {
  if (typeof request.id === "string" && request.id !== "") {
    return request.id;
  }
  return `request-${sequence}`;
}

function serviceBridgeError(state, error) {
  const message = error && error.message ? error.message : String(error);
  state.errors += 1;
  state.lastError = message;
  return message;
}

export function createServiceBridge(config, smokeState, scope = globalThis) {
  const bridgeConfig = config.serviceBridge;
  if (bridgeConfig === null) {
    return null;
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const pending = new Map();
  let module = null;
  let responseBuffer = "";
  let sequence = 0;
  const state = {
    kind: bridgeConfig.kind,
    requestChannel: bridgeConfig.requestChannel,
    responseChannel: bridgeConfig.responseChannel,
    readinessMarker: bridgeConfig.readinessMarker,
    timeoutMs: bridgeConfig.timeoutMs,
    maxPayloadBytes: bridgeConfig.maxPayloadBytes,
    interactiveOnly: bridgeConfig.interactiveOnly,
    moduleAttached: false,
    ready: false,
    readySource: null,
    sent: 0,
    received: 0,
    resolved: 0,
    timedOut: 0,
    errors: 0,
    pending: 0,
    lastRequestId: null,
    lastResponseId: null,
    lastResponseStatus: null,
    lastError: null,
    healthRequested: false,
    healthRequestId: null,
    healthStatus: null,
    healthError: null,
  };
  smokeState.serviceBridge = state;

  const maybeStartHealthRequest = () => {
    if (
      bridgeConfig.interactiveOnly ||
      state.healthRequested ||
      !state.ready ||
      !state.moduleAttached
    ) {
      return;
    }
    state.healthRequested = true;
    request(bridgeConfig.healthRequest)
      .then((response) => {
        state.healthRequestId = typeof response.id === "string" ? response.id : null;
        state.healthStatus = serviceBridgeResponseStatus(response);
      })
      .catch((error) => {
        state.healthError = serviceBridgeError(state, error);
      });
  };

  const markReady = (source) => {
    state.ready = true;
    state.readySource = source;
    maybeStartHealthRequest();
  };

  const attachModule = (nextModule) => {
    module = nextModule;
    state.moduleAttached = Boolean(module);
    maybeStartHealthRequest();
  };

  const sendFrame = (frame) => {
    if (!module || typeof module._qemu_wasm_chardev_write_pending !== "function") {
      throw new Error("QEMU WebAssembly service chardev is not available");
    }
    const text = `${JSON.stringify(frame)}\n`;
    const payloadBytes = encoder.encode(text).length;
    if (payloadBytes > bridgeConfig.maxPayloadBytes) {
      throw new Error("service bridge request exceeds maxPayloadBytes");
    }
    module.qemuWasmChardevPendingChannel = bridgeConfig.requestChannel;
    module.qemuWasmChardevPendingText = text;
    const status = Number(module._qemu_wasm_chardev_write_pending());
    if (!Number.isInteger(status) || status < 0) {
      throw new Error(`service bridge write failed: ${status}`);
    }
    state.sent += 1;
    state.lastRequestId = String(frame.id);
    return status;
  };

  const request = (requestFrame, options = {}) => {
    if (requestFrame === null || typeof requestFrame !== "object" || Array.isArray(requestFrame)) {
      return Promise.reject(new Error("service bridge request must be an object"));
    }
    const id = serviceBridgeRequestId(requestFrame, ++sequence);
    const frame = { ...requestFrame, id };
    const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : bridgeConfig.timeoutMs;
    return new Promise((resolve, reject) => {
      let timeout = null;
      pending.set(id, {
        resolve,
        reject,
        timer: null,
      });
      state.pending = pending.size;
      timeout = setTimeout(() => {
        if (!pending.has(id)) {
          return;
        }
        pending.delete(id);
        state.pending = pending.size;
        state.timedOut += 1;
        reject(new Error(`service bridge request timed out: ${id}`));
      }, timeoutMs);
      pending.get(id).timer = timeout;
      try {
        sendFrame(frame);
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        state.pending = pending.size;
        reject(error);
      }
    });
  };

  const handleResponse = (response) => {
    state.received += 1;
    state.lastResponseId = typeof response.id === "string" ? response.id : null;
    state.lastResponseStatus = serviceBridgeResponseStatus(response);
    if (state.lastResponseId === null || !pending.has(state.lastResponseId)) {
      return;
    }
    const entry = pending.get(state.lastResponseId);
    pending.delete(state.lastResponseId);
    clearTimeout(entry.timer);
    state.pending = pending.size;
    state.resolved += 1;
    entry.resolve(response);
  };

  const receive = (channel, bytes) => {
    if (channel !== bridgeConfig.responseChannel) {
      return false;
    }
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    responseBuffer += decoder.decode(data, { stream: true });
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      try {
        handleResponse(JSON.parse(line));
      } catch (error) {
        serviceBridgeError(state, error);
      }
    }
    return true;
  };

  const bridge = {
    attachModule,
    markReady,
    receive,
    request,
    state,
  };

  scope.qemuWasmChardevReceive = receive;
  scope.qemuWasmServiceBridge = bridge;
  if (typeof scope.addEventListener === "function") {
    scope.addEventListener("message", (event) => {
      const sameOrigin = !scope.location || event.origin === scope.location.origin;
      if (!sameOrigin || !event.data || event.data.type !== "qemu-wasm-service-request") {
        return;
      }
      request(event.data.request || {}, event.data.options || {})
        .then((response) => {
          event.source?.postMessage({
            type: "qemu-wasm-service-response",
            id: event.data.id || null,
            response,
          }, event.origin);
        })
        .catch((error) => {
          event.source?.postMessage({
            type: "qemu-wasm-service-response",
            id: event.data.id || null,
            error: serviceBridgeError(state, error),
          }, event.origin);
        });
    });
  }

  return bridge;
}

function powerOperationError(state, error) {
  const message = error && error.message ? error.message : String(error);
  state.errors += 1;
  state.lastError = message;
  return message;
}

function qemuPowerAction(operation) {
  return QEMU_WASM_POWER_ACTIONS[operation] || 0;
}

export function createPowerControl(config, smokeState, serviceBridge = null) {
  let module = null;
  const state = {
    requested: false,
    operation: "",
    deliveryPath: null,
    guestAcknowledged: false,
    qemuAction: null,
    qemuStatus: null,
    responseStatus: null,
    timeoutMs: config.powerTimeoutMs,
    errors: 0,
    lastError: null,
    completed: false,
  };
  smokeState.powerControl = state;

  const request = async (operation = config.powerOperation || "", options = {}) => {
    if (!POWER_OPERATIONS.has(operation)) {
      throw new Error("unsupported power operation");
    }
    if (operation === "") {
      return state;
    }
    if (state.requested && !state.completed) {
      throw new Error("power operation already pending");
    }
    state.requested = true;
    state.operation = operation;
    state.timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : config.powerTimeoutMs;
    state.deliveryPath = null;
    state.guestAcknowledged = false;
    state.qemuAction = null;
    state.qemuStatus = null;
    state.responseStatus = null;
    state.lastError = null;
    state.completed = false;

    try {
      if (operation === "shutdown" && serviceBridge !== null) {
        state.deliveryPath = "service-bridge";
        const response = await serviceBridge.request(
          { operation: "power", action: "shutdown" },
          { timeoutMs: state.timeoutMs },
        );
        state.responseStatus = serviceBridgeResponseStatus(response);
        state.guestAcknowledged = state.responseStatus !== "error";
        state.completed = true;
        return state;
      }
      if (operation === "reboot") {
        if (serviceBridge === null) {
          throw new Error("graceful reboot requires a configured service bridge");
        }
        state.deliveryPath = "service-bridge";
        const response = await serviceBridge.request(
          { operation: "power", action: "reboot" },
          { timeoutMs: state.timeoutMs },
        );
        state.responseStatus = serviceBridgeResponseStatus(response);
        state.guestAcknowledged = state.responseStatus !== "error";
        state.completed = true;
        return state;
      }

      const qemuOperation = operation === "shutdown" ? "guest-powerdown" : operation;
      const action = qemuPowerAction(qemuOperation);
      if (action === 0) {
        throw new Error("unsupported QEMU power operation");
      }
      if (!module || typeof module._qemu_wasm_power_request !== "function") {
        throw new Error("QEMU WebAssembly power control is not available");
      }
      state.deliveryPath = qemuOperation === "guest-powerdown"
        ? "qemu-guest-powerdown"
        : "qemu-forced";
      state.qemuAction = qemuOperation;
      state.qemuStatus = Number(module._qemu_wasm_power_request(action));
      if (!Number.isInteger(state.qemuStatus) || state.qemuStatus < 0) {
        throw new Error(`QEMU WebAssembly power request failed: ${state.qemuStatus}`);
      }
      state.completed = true;
      return state;
    } catch (error) {
      powerOperationError(state, error);
      throw error;
    }
  };

  const powerControl = {
    attachModule(nextModule) {
      module = nextModule;
    },
    request,
    state,
  };

  globalThis.qemuWasmPowerControl = powerControl;
  return powerControl;
}

export function qemuArgs(config) {
  const defaultKernelAppend = config.initrd
    ? "console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1"
    : "console=ttyS0 earlyprintk=serial,ttyS0,115200 root=/dev/vda rw init=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1";
  const kernelAppend = [
    config.kernelAppend === null ? defaultKernelAppend : config.kernelAppend,
    config.appendExtra,
  ].filter(Boolean).join(" ");
  const args = [
    "-M",
    config.machine,
    "-m",
    config.memory,
  ];
  if (config.cpu) {
    args.push("-cpu", config.cpu);
  }
  args.push("-accel", "tcg,thread=single");
  if (config.display === "none") {
    if (!["default", "none"].includes(config.displayDevice)) {
      throw new Error("displayDevice requires display=sdl or display=wasm");
    }
    args.push("-nographic");
  } else if (config.display === "sdl" || config.display === "wasm") {
    args.push("-display", config.display === "sdl" ? "sdl,gl=off" : "wasm");
    if (config.displayDevice === "none") {
      args.push("-vga", "none");
    } else if (config.displayDevice === "stdvga") {
      args.push("-vga", "std");
    } else if (config.displayDevice === "virtio-vga") {
      args.push("-vga", "virtio");
    } else if (config.displayDevice === "virtio-gpu-pci") {
      args.push("-vga", "none", "-device", "virtio-gpu-pci");
    } else if (config.displayDevice !== "default") {
      throw new Error("unsupported displayDevice");
    }
  } else {
    throw new Error("display must be none, sdl, or wasm");
  }
  args.push(
    "-serial", "mon:stdio",
    "-monitor", "none",
    "-kernel", "/kernel",
  );
  if (config.initrd) {
    args.push("-initrd", "/initramfs.cpio.gz");
  }
  args.push("-append", kernelAppend);
  if (config.rootfs) {
    if (config.rootfsDevice === "virtio-mmio") {
      args.push(
        "-drive",
        "file=/rootfs.raw,format=raw,if=none,id=hd0",
        "-device",
        "virtio-blk-device,drive=hd0",
      );
    } else {
      args.push("-drive", "file=/rootfs.raw,format=raw,if=virtio");
    }
  }
  if (config.persistentDisk) {
    if (config.persistentDiskDevice === "virtio-mmio") {
      args.push(
        "-drive",
        `file=${config.persistentDiskPath},format=raw,if=none,id=persist0`,
        "-device",
        "virtio-blk-device,drive=persist0",
      );
    } else {
      args.push("-drive", `file=${config.persistentDiskPath},format=raw,if=virtio`);
    }
  }
  if (config.serviceBridge) {
    const requestChardev = "qemu-wasm-service-request";
    const responseChardev = "qemu-wasm-service-response";
    const maxPayload = Number(config.serviceBridge.maxPayloadBytes) || 4096;
    args.push(
      "-chardev",
      `wasm,id=${requestChardev},channel=${config.serviceBridge.requestChannel},max-payload=${maxPayload}`,
      "-chardev",
      `wasm,id=${responseChardev},channel=${config.serviceBridge.responseChannel},max-payload=${maxPayload}`,
    );
    if (config.serviceBridge.kind === "serial-jsonl") {
      args.push(
        "-serial",
        `chardev:${requestChardev}`,
        "-serial",
        `chardev:${responseChardev}`,
      );
    } else {
      const serviceBridgeDevice = String(config.machine).startsWith("microvm")
        ? "virtio-serial-device"
        : "virtio-serial-pci";
      args.push(
        "-device",
        serviceBridgeDevice,
        "-device",
        `virtserialport,chardev=${requestChardev},name=${config.serviceBridge.requestChannel}`,
        "-device",
        `virtserialport,chardev=${responseChardev},name=${config.serviceBridge.responseChannel}`,
      );
    }
  }
  if (config.network === "none") {
    args.push("-nic", "none");
  }
  args.push("-L", "/firmware");
  args.push(...config.qemuArgs);
  return args;
}

export function recordHarnessFailure(state, error, elapsedMs) {
  if (!state) {
    return null;
  }
  state.failurePhase = state.phase;
  state.phase = "failed";
  state.failureName = error && error.name ? error.name : "Error";
  state.failure = error && error.message ? error.message : String(error);
  state.failureStack = error && error.stack ? error.stack : null;
  state.phases.push({
    phase: "failed",
    elapsedMs,
    failedDuring: state.failurePhase,
    message: state.failure,
    name: state.failureName,
  });
  return state;
}

function wasmMemory64Probe(wasm) {
  if (!wasm || typeof wasm.Memory !== "function") {
    return {
      supported: false,
      errorName: "Error",
      errorMessage: "WebAssembly.Memory is not available",
    };
  }
  try {
    new wasm.Memory({ initial: 1, maximum: 1, address: "i64" });
    return {
      supported: true,
      errorName: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      supported: false,
      errorName: error && error.name ? error.name : "Error",
      errorMessage: error && error.message ? error.message : String(error),
    };
  }
}

export function browserRuntimeSnapshot(scope = globalThis) {
  const nav = scope.navigator || {};
  const perf = scope.performance || {};
  const memory = perf.memory || {};
  return {
    crossOriginIsolated: Boolean(scope.crossOriginIsolated),
    sharedArrayBuffer: typeof scope.SharedArrayBuffer !== "undefined",
    webAssembly: typeof scope.WebAssembly !== "undefined",
    wasmMemory64: wasmMemory64Probe(scope.WebAssembly),
    userAgent: typeof nav.userAgent === "string" ? nav.userAgent : null,
    hardwareConcurrency: Number.isInteger(nav.hardwareConcurrency)
      ? nav.hardwareConcurrency
      : null,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    jsHeapSizeLimit: Number.isFinite(memory.jsHeapSizeLimit)
      ? memory.jsHeapSizeLimit
      : null,
  };
}

const BROWSER_SHORTCUT_KEYS = new Set([
  "l",
  "n",
  "p",
  "r",
  "t",
  "w",
]);
const CAPTURED_BROWSER_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "PageDown",
  "PageUp",
  "Tab",
]);

const BROWSER_CODE_TO_LINUX = new Map([
  ["Backquote", 41],
  ["Backslash", 43],
  ["Backspace", 14],
  ["BracketLeft", 26],
  ["BracketRight", 27],
  ["Comma", 51],
  ["ControlLeft", 29],
  ["ControlRight", 97],
  ["Digit0", 11],
  ["Digit1", 2],
  ["Digit2", 3],
  ["Digit3", 4],
  ["Digit4", 5],
  ["Digit5", 6],
  ["Digit6", 7],
  ["Digit7", 8],
  ["Digit8", 9],
  ["Digit9", 10],
  ["Enter", 28],
  ["Equal", 13],
  ["Escape", 1],
  ["F1", 59],
  ["F2", 60],
  ["F3", 61],
  ["F4", 62],
  ["F5", 63],
  ["F6", 64],
  ["F7", 65],
  ["F8", 66],
  ["F9", 67],
  ["F10", 68],
  ["F11", 87],
  ["F12", 88],
  ["Minus", 12],
  ["Period", 52],
  ["Quote", 40],
  ["Semicolon", 39],
  ["ShiftLeft", 42],
  ["ShiftRight", 54],
  ["Slash", 53],
  ["Space", 57],
  ["Tab", 15],
  ["AltLeft", 56],
  ["AltRight", 100],
  ["ArrowDown", 108],
  ["ArrowLeft", 105],
  ["ArrowRight", 106],
  ["ArrowUp", 103],
  ["Delete", 111],
  ["End", 107],
  ["Home", 102],
  ["Insert", 110],
  ["PageDown", 109],
  ["PageUp", 104],
  ["MetaLeft", 125],
  ["MetaRight", 126],
  ["KeyA", 30],
  ["KeyB", 48],
  ["KeyC", 46],
  ["KeyD", 32],
  ["KeyE", 18],
  ["KeyF", 33],
  ["KeyG", 34],
  ["KeyH", 35],
  ["KeyI", 23],
  ["KeyJ", 36],
  ["KeyK", 37],
  ["KeyL", 38],
  ["KeyM", 50],
  ["KeyN", 49],
  ["KeyO", 24],
  ["KeyP", 25],
  ["KeyQ", 16],
  ["KeyR", 19],
  ["KeyS", 31],
  ["KeyT", 20],
  ["KeyU", 22],
  ["KeyV", 47],
  ["KeyW", 17],
  ["KeyX", 45],
  ["KeyY", 21],
  ["KeyZ", 44],
]);

export function browserKeyLinuxCode(event) {
  const code = event && typeof event.code === "string" ? event.code : "";
  return BROWSER_CODE_TO_LINUX.get(code) || 0;
}

export function deliverDisplayKeyEvent(event, down, inputSink) {
  if (typeof inputSink !== "function") {
    return false;
  }
  const linuxCode = browserKeyLinuxCode(event);
  if (linuxCode === 0) {
    return false;
  }
  return inputSink(linuxCode, down) !== false;
}

export function displayKeyPolicy(event) {
  if (event.key === "Escape") {
    return "release-focus";
  }
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (event.metaKey || event.altKey || (event.ctrlKey && BROWSER_SHORTCUT_KEYS.has(key))) {
    return "browser-shortcut";
  }
  if (CAPTURED_BROWSER_KEYS.has(event.key)) {
    return "capture-browser-key";
  }
  return "pass-through";
}

export function installDisplayInputPolicy(canvas, displayState, inputSink = null) {
  if (!canvas || !displayState) {
    return null;
  }
  const policy = {
    browserShortcutsReserved: true,
    escapeReleasesFocus: true,
    paste: "capture-metadata",
    pointerFocus: "focus-on-pointer-down",
    pointerLock: false,
    capturedKeys: [...CAPTURED_BROWSER_KEYS].sort(),
  };
  displayState.inputPolicy = policy;
  displayState.focusEvents = 0;
  displayState.blurEvents = 0;
  displayState.pointerFocusEvents = 0;
  displayState.escapeReleaseEvents = 0;
  displayState.browserShortcutEvents = 0;
  displayState.capturedBrowserKeyEvents = 0;
  displayState.deliveredKeyEvents = 0;
  displayState.pasteEvents = 0;
  displayState.lastPasteLength = 0;
  canvas.dataset.inputActive = canvas.ownerDocument && canvas.ownerDocument.activeElement === canvas
    ? "true"
    : "false";
  canvas.title = "QEMU display. Escape releases keyboard focus.";
  canvas.addEventListener("focus", () => {
    displayState.focused = true;
    displayState.focusEvents += 1;
    canvas.dataset.inputActive = "true";
  });
  canvas.addEventListener("blur", () => {
    displayState.focused = false;
    displayState.blurEvents += 1;
    canvas.dataset.inputActive = "false";
  });
  canvas.addEventListener("pointerdown", () => {
    displayState.pointerFocusEvents += 1;
    canvas.focus();
  });
  canvas.addEventListener("keydown", (event) => {
    const action = displayKeyPolicy(event);
    if (action === "release-focus") {
      displayState.escapeReleaseEvents += 1;
      event.preventDefault();
      canvas.blur();
    } else if (action === "browser-shortcut") {
      displayState.browserShortcutEvents += 1;
    } else if (action === "capture-browser-key") {
      displayState.capturedBrowserKeyEvents += 1;
      event.preventDefault();
      if (deliverDisplayKeyEvent(event, true, inputSink)) {
        displayState.deliveredKeyEvents += 1;
      }
    } else if (deliverDisplayKeyEvent(event, true, inputSink)) {
      displayState.deliveredKeyEvents += 1;
      event.preventDefault();
    }
  });
  canvas.addEventListener("keyup", (event) => {
    const action = displayKeyPolicy(event);
    if (action === "release-focus" || action === "browser-shortcut") {
      return;
    }
    if (deliverDisplayKeyEvent(event, false, inputSink)) {
      displayState.deliveredKeyEvents += 1;
      event.preventDefault();
    }
  });
  canvas.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    const text = data && typeof data.getData === "function"
      ? data.getData("text/plain")
      : "";
    displayState.pasteEvents += 1;
    displayState.lastPasteLength = text.length;
    event.preventDefault();
  });
  return policy;
}

export function updateWasmDisplayKeyStats(module, displayState) {
  if (!module || !displayState) {
    return null;
  }
  const readCounter = (name) => {
    const fn = module[name];
    if (typeof fn !== "function") {
      return null;
    }
    const value = Number(fn());
    return Number.isFinite(value) ? value : null;
  };
  const stats = {
    received: readCounter("_qemu_wasm_display_key_events_received"),
    dropped: readCounter("_qemu_wasm_display_key_events_dropped"),
    drained: readCounter("_qemu_wasm_display_key_events_drained"),
    sent: readCounter("_qemu_wasm_display_key_events_sent"),
  };
  if (Object.values(stats).every((value) => value === null)) {
    return null;
  }
  displayState.wasmKeyStats = stats;
  return stats;
}

export function emscriptenModuleCanvas(display, canvas) {
  if (display === "sdl") {
    return canvas;
  }
  if (!["none", "wasm"].includes(display) || !canvas || !canvas.ownerDocument) {
    return undefined;
  }
  const document = canvas.ownerDocument;
  let workerCanvas = document.getElementById("qemu-wasm-worker-canvas");
  if (!workerCanvas) {
    workerCanvas = document.createElement("canvas");
    workerCanvas.id = "qemu-wasm-worker-canvas";
    workerCanvas.hidden = true;
    workerCanvas.width = 1;
    workerCanvas.height = 1;
    workerCanvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(workerCanvas);
  }
  return workerCanvas;
}

export function browserNonInteractiveStdin() {
  return null;
}

export function installBrowserDialogSuppression(globalObject, smokeState) {
  const windowObject = globalObject && globalObject.window
    ? globalObject.window
    : globalObject;
  if (!windowObject) {
    return null;
  }

  const original = {
    alert: windowObject.alert,
    confirm: windowObject.confirm,
    prompt: windowObject.prompt,
  };
  const dialogs = {
    alertCount: 0,
    confirmCount: 0,
    promptCount: 0,
    suppressed: true,
  };
  if (smokeState) {
    smokeState.browserDialogs = dialogs;
  }

  if (typeof original.alert === "function") {
    windowObject.alert = (message) => {
      dialogs.alertCount += 1;
      dialogs.lastAlert = String(message);
    };
  }
  if (typeof original.confirm === "function") {
    windowObject.confirm = (message) => {
      dialogs.confirmCount += 1;
      dialogs.lastConfirm = String(message);
      return false;
    };
  }
  if (typeof original.prompt === "function") {
    windowObject.prompt = (message, fallback = "") => {
      dialogs.promptCount += 1;
      dialogs.lastPrompt = String(message);
      if (fallback === "i") {
        return "i";
      }
      return null;
    };
  }

  return () => {
    if (typeof original.alert === "function") {
      windowObject.alert = original.alert;
    }
    if (typeof original.confirm === "function") {
      windowObject.confirm = original.confirm;
    }
    if (typeof original.prompt === "function") {
      windowObject.prompt = original.prompt;
    }
  };
}

function buildConfig() {
  return {
    appendExtra: option("appendExtra", ""),
    allowSerialFallback: boolOption("allowSerialFallback", true),
    cpu: option("cpu", "Nehalem"),
    display: option("display", "none"),
    displayDevice: option("displayDevice", "default"),
    expectText: listOption("expectText"),
    expectedResolution: option("expectedResolution", ""),
    focusDisplay: boolOption("focusDisplay", false),
    harnessExpectedKeyEvents: nonNegativeNumberOption("harnessExpectedKeyEvents", 0),
    harnessSelfTest: boolOption("harnessSelfTest", false),
    initrd: pathOption("initrd", "/guest/initramfs.cpio.gz"),
    kernel: option("kernel", "/guest/kernel"),
    kernelAppend: option("kernelAppend", null),
    linuxboot: option("linuxboot", "/firmware/linuxboot_dma.bin"),
    machine: option("machine", "microvm,acpi=off"),
    marker: option("marker", DEFAULT_MARKER),
    maxOutputBytes: numberOption("maxOutputBytes", 60000),
    memory: option("memory", "512M"),
    network: option("network", "none"),
    persistentDisk: boolOption("persistentDisk", false),
    persistentDiskDevice: option("persistentDiskDevice", "virtio-mmio"),
    persistentDiskOpfsName: option("persistentDiskOpfsName", DEFAULT_PERSISTENT_DISK_OPFS_NAME),
    persistentDiskPath: pathOption("persistentDiskPath", "/persistent.raw"),
    persistentDiskSizeBytes: numberOption("persistentDiskSizeBytes", DEFAULT_PERSISTENT_DISK_SIZE_BYTES),
    persistentDiskStorage: option("persistentDiskStorage", "opfs"),
    program: option("program", "/artifacts/qemu-system-x86_64.js"),
    qemuArgs: listOption("qemuArg"),
    qboot: option("qboot", "/firmware/qboot.rom"),
    rootfs: pathOption("rootfs", ""),
    rootfsDevice: option("rootfsDevice", "virtio-mmio"),
    rootfsOpfsName: option("rootfsOpfsName", DEFAULT_ROOTFS_OPFS_NAME),
    rootfsStorage: option("rootfsStorage", "memfs"),
    powerOperation: option("powerOperation", ""),
    powerTimeoutMs: numberOption("powerTimeoutMs", 30000),
    performanceAttribution: boolOption("performanceAttribution", false),
    performanceAttributionInterval: numberOption("performanceAttributionInterval", 10000),
    performanceAttributionTciInterval: numberOption("performanceAttributionTciInterval", 1000000),
    fwCfgTrace: boolOption("fwCfgTrace", false),
    fwCfgTraceLimit: nonNegativeNumberOption("fwCfgTraceLimit", 256),
    serviceBridge: jsonObjectOption("serviceBridge", null),
    tcgHotblocks: boolOption("tcgHotblocks", false),
    tcgHotblocksInterval: numberOption("tcgHotblocksInterval", 10000),
    tcgHotblocksOpLimit: numberOption("tcgHotblocksOpLimit", 134217728),
    tcgHotblocksOpSample: numberOption("tcgHotblocksOpSample", 1),
    tcgHotblocksTop: numberOption("tcgHotblocksTop", 12),
    tciFastGates: boolOption("tciFastGates", false),
    tciRelaxedMb: boolOption("tciRelaxedMb", false),
    tciProgress: boolOption("tciProgress", false),
    tciProgressInterval: numberOption("tciProgressInterval", 100000),
    tciWasmSubset: boolOption("tciWasmSubset", false),
    tciWasmGeneratedOnly: boolOption("tciWasmGeneratedOnly", false),
    tciWasmGeneratedTrace: boolOption("tciWasmGeneratedTrace", false),
    tciWasmGeneratedTraceLimit:
      nonNegativeNumberOption("tciWasmGeneratedTraceLimit", 64),
    tciWasmSubsetInterval: numberOption("tciWasmSubsetInterval", 100000),
    tciWasmSubsetMaxOps: numberOption("tciWasmSubsetMaxOps", 512),
    tciWasmSubsetThreshold: numberOption("tciWasmSubsetThreshold", 1024),
    timeoutMs: numberOption("timeoutMs", 180000),
    visualMarker: option("visualMarker", ""),
    wasm: option("wasm", "/artifacts/qemu-system-x86_64.wasm"),
  };
}

function drawHarnessSelfTestFrame(canvas) {
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("2D canvas context is not available for harness self-test");
  }
  context.fillStyle = "rgb(0, 0, 0)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgb(255, 0, 0)";
  context.fillRect(0, 0, 16, 16);
  context.fillStyle = "rgb(0, 255, 0)";
  context.fillRect(16, 0, 16, 16);
  context.fillStyle = "rgb(0, 0, 255)";
  context.fillRect(32, 0, 16, 16);
  context.fillStyle = "rgb(255, 255, 255)";
  context.fillRect(48, 0, 16, 16);
  context.fillStyle = "rgb(255, 255, 0)";
  context.fillRect(0, 16, 64, 4);
}

export function drawBrowserStatusFrame(canvas, message) {
  if (!canvas || canvas.hidden) {
    return false;
  }
  if (canvas.width <= 1 || canvas.height <= 1) {
    canvas.width = 720;
    canvas.height = 400;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return false;
  }
  context.fillStyle = "rgb(5, 5, 5)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgb(230, 230, 230)";
  context.font = "20px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, canvas.width / 2, canvas.height / 2);
  return true;
}

async function run() {
  const status = text("status");
  const output = text("output");
  const canvas = text("canvas");
  const config = buildConfig();
  if (!["none", "sdl", "wasm"].includes(config.display)) {
    throw new Error("display must be none, sdl, or wasm");
  }
  if (!["default", "none", "stdvga", "virtio-vga", "virtio-gpu-pci"].includes(config.displayDevice)) {
    throw new Error("displayDevice must be default, none, stdvga, virtio-vga, or virtio-gpu-pci");
  }
  if (!["sdl", "wasm"].includes(config.display) && !["default", "none"].includes(config.displayDevice)) {
    throw new Error("displayDevice requires display=sdl or display=wasm");
  }
  if (!["virtio-mmio", "virtio-pci"].includes(config.rootfsDevice)) {
    throw new Error("rootfsDevice must be virtio-mmio or virtio-pci");
  }
  if (!["virtio-mmio", "virtio-pci"].includes(config.persistentDiskDevice)) {
    throw new Error("persistentDiskDevice must be virtio-mmio or virtio-pci");
  }
  if (!["memfs", "opfs-snapshot"].includes(config.rootfsStorage)) {
    throw new Error("rootfsStorage must be memfs or opfs-snapshot");
  }
  validateOpfsFileName(config.rootfsOpfsName);
  validateOpfsFileName(config.persistentDiskOpfsName, "persistentDiskOpfsName");
  if (config.rootfsStorage === "opfs-snapshot" && !config.rootfs) {
    throw new Error("rootfsStorage=opfs-snapshot requires rootfs");
  }
  if (config.persistentDisk && config.persistentDiskStorage !== "opfs") {
    throw new Error("persistentDiskStorage must be opfs");
  }
  if (config.persistentDisk && !config.persistentDiskPath.startsWith("/")) {
    throw new Error("persistentDiskPath must be an absolute in-guest path");
  }
  if (!["none", "default"].includes(config.network)) {
    throw new Error("network must be none or default");
  }
  if (!POWER_OPERATIONS.has(config.powerOperation)) {
    throw new Error("powerOperation must be shutdown, reboot, guest-powerdown, force-reset, force-poweroff, or empty");
  }
  const programUrl = new URL(config.program, window.location.href);
  const wasmUrl = new URL(config.wasm, window.location.href);
  const generatedQemuArgs = qemuArgs(config);
  const expectedResolution = parseResolution(config.expectedResolution);
  const startTime = performance.now();
  const smokeState = {
    lines: 0,
    outputBytes: 0,
    outputSuppressed: false,
    guestLines: 0,
    guestOutputBytes: 0,
    guestLastLine: "",
    guestHeartbeat: {
      marker: "bus-engine-os-heartbeat:",
      count: 0,
      lastLine: "",
      lastElapsedMs: null,
    },
    bootMilestones: {
      count: 0,
      entries: [],
      byId: {},
      last: null,
    },
    phase: "init",
    phases: [],
    startedAtMs: startTime,
    qemuArgs: generatedQemuArgs,
    runtime: browserRuntimeSnapshot(globalThis),
    display: {
      mode: config.display,
      allowSerialFallback: config.allowSerialFallback,
      focused: false,
      canvasPresent: Boolean(canvas),
      device: config.displayDevice,
      expectedResolution,
      visualMarker: config.visualMarker,
    },
    rootfsStorage: {
      mode: config.rootfsStorage,
      opfsName: config.rootfsOpfsName,
      loadSource: null,
      loadedBytes: 0,
      persisted: false,
      persistedBytes: 0,
      browserStorage: null,
    },
    persistentDisk: {
      enabled: config.persistentDisk,
      mode: config.persistentDiskStorage,
      opfsName: config.persistentDiskOpfsName,
      path: config.persistentDiskPath,
      device: config.persistentDiskDevice,
      sizeBytes: config.persistentDiskSizeBytes,
      loadSource: null,
      loadedBytes: 0,
      persisted: false,
      persistedBytes: 0,
    },
    hotBlocks: {
      enabled: config.tcgHotblocks,
      env: config.tcgHotblocks ? {
        QEMU_TCG_HOTBLOCKS: "1",
        QEMU_TCG_HOTBLOCKS_INTERVAL: String(config.tcgHotblocksInterval),
        QEMU_TCG_HOTBLOCKS_OP_LIMIT: String(config.tcgHotblocksOpLimit),
        QEMU_TCG_HOTBLOCKS_OP_SAMPLE: String(config.tcgHotblocksOpSample),
        QEMU_TCG_HOTBLOCKS_TOP: String(config.tcgHotblocksTop),
      } : null,
      maxSummaries: 16,
      summaryCount: 0,
      summaries: [],
      lastSummary: null,
    },
    performanceAttribution: {
      enabled: config.performanceAttribution,
      env: config.performanceAttribution ? {
        QEMU_WASM_PERF_ATTRIBUTION: "1",
        QEMU_WASM_PERF_ATTRIBUTION_INTERVAL: String(config.performanceAttributionInterval),
        QEMU_WASM_PERF_ATTRIBUTION_TCI_INTERVAL: String(config.performanceAttributionTciInterval),
      } : null,
      maxSummaries: 16,
      summaryCount: 0,
      summaries: [],
      lastSummary: null,
    },
    fwCfgTrace: {
      enabled: Boolean(config.fwCfgTrace),
      limit: config.fwCfgTraceLimit,
      count: 0,
      entries: [],
      last: null,
    },
    wasm64Tcg: {
      maxSummaries: 16,
      summaryCount: 0,
      summaries: [],
      lastSummary: null,
    },
    tci: {
      fastGates: Boolean(config.tciFastGates),
      relaxedMb: Boolean(config.tciRelaxedMb),
      progress: {
        enabled: Boolean(config.tciProgress),
        interval: config.tciProgressInterval,
        maxSummaries: 16,
        summaryCount: 0,
        summaries: [],
        lastSummary: null,
      },
      wasmSubset: {
        enabled: Boolean(config.tciWasmSubset),
        generatedOnly: Boolean(config.tciWasmGeneratedOnly),
        interval: config.tciWasmSubsetInterval,
        maxOps: config.tciWasmSubsetMaxOps,
        threshold: config.tciWasmSubsetThreshold,
        generatedTrace: {
          enabled: Boolean(config.tciWasmGeneratedTrace),
          limit: config.tciWasmGeneratedTraceLimit,
          count: 0,
          entries: [],
          last: null,
        },
        maxSummaries: 16,
        summaryCount: 0,
        summaries: [],
        lastSummary: null,
      },
      env: (config.tciFastGates || config.tciRelaxedMb ||
          config.tciProgress ||
          config.tciWasmSubset ||
          config.tciWasmGeneratedTrace) ? {
        ...(config.tciFastGates ? { QEMU_TCI_FAST_GATES: "1" } : {}),
        ...(config.tciRelaxedMb ? { QEMU_TCI_RELAXED_MB: "1" } : {}),
        ...(config.tciProgress ? {
          QEMU_TCI_PROGRESS: "1",
          QEMU_TCI_PROGRESS_INTERVAL: String(config.tciProgressInterval),
        } : {}),
        ...(config.tciWasmSubset ? {
          QEMU_TCI_WASM_SUBSET: "1",
          ...(config.tciWasmGeneratedOnly ? {
            QEMU_TCI_WASM_GENERATED_ONLY: "1",
          } : {}),
          QEMU_TCI_WASM_SUBSET_INTERVAL: String(config.tciWasmSubsetInterval),
          QEMU_TCI_WASM_SUBSET_MAX_OPS: String(config.tciWasmSubsetMaxOps),
          QEMU_TCI_WASM_SUBSET_THRESHOLD: String(config.tciWasmSubsetThreshold),
        } : {}),
        ...(config.tciWasmGeneratedTrace ? {
          QEMU_TCI_WASM_GENERATED_TRACE: "1",
          QEMU_TCI_WASM_GENERATED_TRACE_LIMIT:
            String(config.tciWasmGeneratedTraceLimit),
        } : {}),
      } : null,
    },
    markerSeen: false,
    expectedTextSeen: config.expectText.map((text) => ({ text, seen: false })),
    lastLine: "",
    programExitStatus: null,
  };
  globalThis.qemuWasmSmokeState = smokeState;
  installBrowserDialogSuppression(globalThis, smokeState);
  const serviceBridge = createServiceBridge(config, smokeState, globalThis);
  const powerControl = createPowerControl(config, smokeState, serviceBridge);
  let qemuKeySink = null;
  let qemuModule = null;
  let activeModule = null;
  const setPhase = (phase, message = phase) => {
    smokeState.phase = phase;
    smokeState.phases.push({
      phase,
      elapsedMs: Math.round(performance.now() - startTime),
      message,
    });
    status.textContent = message;
  };
  setPhase("init", "initializing smoke harness");
  if (config.display === "sdl" || config.display === "wasm") {
    canvas.hidden = false;
    canvas.setAttribute("aria-hidden", "false");
    installDisplayInputPolicy(canvas, smokeState.display, (linuxKey, down) => {
      if (qemuKeySink === null) {
        return false;
      }
      return qemuKeySink(linuxKey, down) !== false;
    });
    if (expectedResolution !== null) {
      canvas.width = expectedResolution.width;
      canvas.height = expectedResolution.height;
    }
    if (config.focusDisplay) {
      canvas.focus();
    }
    drawBrowserStatusFrame(canvas, "Loading Bus Engine OS guest...");
    smokeState.display.focused = document.activeElement === canvas;
    smokeState.display.canvasWidth = canvas.width;
    smokeState.display.canvasHeight = canvas.height;
  } else {
    canvas.hidden = true;
    canvas.setAttribute("aria-hidden", "true");
  }

  if (config.harnessSelfTest) {
    if (!["sdl", "wasm"].includes(config.display)) {
      throw new Error("harnessSelfTest requires display=sdl or display=wasm");
    }
    if (config.focusDisplay) {
      canvas.focus();
      smokeState.display.focused = document.activeElement === canvas;
    }
  }

  const mounts = [
    { url: config.kernel, path: "/kernel" },
    { url: config.qboot, path: "/firmware/qboot.rom" },
    { url: config.linuxboot, path: "/firmware/linuxboot_dma.bin" },
  ];
  for (const name of OPTIONAL_FIRMWARE_FILES) {
    mounts.push({
      optional: true,
      path: `/firmware/${name}`,
      url: `/firmware/${name}`,
    });
  }
  if (config.initrd) {
    mounts.push({ url: config.initrd, path: "/initramfs.cpio.gz" });
  }
  if (config.rootfs) {
    mounts.push({ url: config.rootfs, path: "/rootfs.raw", rootfs: true });
  }
  if (config.persistentDisk) {
    mounts.push({ path: config.persistentDiskPath, persistentDisk: true });
  }

  setPhase("validate-browser", "validating browser WebAssembly features");
  if (!crossOriginIsolated) {
    throw new Error("cross-origin isolation is required for pthread WebAssembly");
  }
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("SharedArrayBuffer is not available");
  }

  if (config.harnessSelfTest) {
    const keyEvents = [];
    const timeout = setTimeout(() => {
      setPhase(
        "timeout",
        `timeout waiting for harness key events: ${config.harnessExpectedKeyEvents}`,
      );
    }, config.timeoutMs);
    qemuKeySink = (linuxKey, down) => {
      keyEvents.push({ linuxKey, down: Boolean(down) });
      smokeState.display.harnessKeyEvents = keyEvents;
      smokeState.display.harnessKeyEventCount = keyEvents.length;
      if (keyEvents.length >= config.harnessExpectedKeyEvents) {
        smokeState.markerSeen = true;
        clearTimeout(timeout);
        setPhase("success", `marker reached: ${config.marker}`);
      }
    };
    drawHarnessSelfTestFrame(canvas);
    smokeState.display.canvasWidth = canvas.width;
    smokeState.display.canvasHeight = canvas.height;
    smokeState.display.harnessSelfTest = true;
    smokeState.display.harnessExpectedKeyEvents = config.harnessExpectedKeyEvents;
    setPhase("harness-self-test", "browser harness self-test ready");
    if (config.harnessExpectedKeyEvents === 0) {
      smokeState.markerSeen = true;
      clearTimeout(timeout);
      setPhase("success", `marker reached: ${config.marker}`);
    }
    return;
  }

  const timeout = setTimeout(() => {
    if (!smokeState.markerSeen || !allExpectedTextSeen()) {
      const missing = smokeState.expectedTextSeen
        .filter((expected) => !expected.seen)
        .map((expected) => expected.text);
      setPhase("timeout", missing.length === 0
        ? `timeout waiting for marker: ${config.marker}`
        : `timeout waiting for marker or expected text: ${missing.join(", ")}`);
    }
  }, config.timeoutMs);

  const allExpectedTextSeen = () =>
    smokeState.expectedTextSeen.every((expected) => expected.seen);

  let completionStarted = false;
  const completeSuccess = () => {
    setPhase("success", `marker reached: ${config.marker}`);
  };
  const persistRootfsSnapshot = async () => {
    if (config.rootfsStorage !== "opfs-snapshot") {
      return;
    }
    if (!activeModule || !activeModule.FS) {
      throw new Error("QEMU module FS is not available for OPFS persistence");
    }
    const rootfs = activeModule.FS.readFile("/rootfs.raw");
    await writeRootfsOpfsSnapshot(config.rootfsOpfsName, rootfs);
    smokeState.rootfsStorage.persisted = true;
    smokeState.rootfsStorage.persistedBytes = rootfs.length;
  };
  const persistPersistentDiskSnapshot = async () => {
    if (!config.persistentDisk) {
      return;
    }
    if (!activeModule || !activeModule.FS) {
      throw new Error("QEMU module FS is not available for persistent disk OPFS persistence");
    }
    const disk = activeModule.FS.readFile(config.persistentDiskPath);
    await writeOpfsSnapshot(
      OPFS_PERSISTENT_DISK_DIRECTORY,
      config.persistentDiskOpfsName,
      "persistentDiskOpfsName",
      disk,
    );
    smokeState.persistentDisk.persisted = true;
    smokeState.persistentDisk.persistedBytes = disk.length;
  };
  const maybeComplete = () => {
    if (smokeState.markerSeen && allExpectedTextSeen()) {
      if (completionStarted) {
        return;
      }
      completionStarted = true;
      clearTimeout(timeout);
      if (config.rootfsStorage !== "opfs-snapshot" && !config.persistentDisk) {
        completeSuccess();
        return;
      }
      setPhase("persist-browser-storage", "persisting browser disk snapshots to OPFS");
      Promise.all([
        persistRootfsSnapshot(),
        persistPersistentDiskSnapshot(),
      ]).then(completeSuccess).catch((error) => {
        const targetState = config.persistentDisk ? smokeState.persistentDisk : smokeState.rootfsStorage;
        targetState.errorName = error && error.name ? error.name : "Error";
        targetState.errorMessage =
          error && error.message ? error.message : String(error);
        recordHarnessFailure(
          smokeState,
          error,
          Math.round(performance.now() - startTime),
        );
        status.textContent = "failed";
        appendLine(output, error && error.stack ? error.stack : String(error));
      });
    }
  };

  const isGuestProgressLine = (line) => {
    if (typeof line !== "string") {
      return false;
    }
    if (line === "") {
      return false;
    }
    return !(
      line.startsWith("qemu-tci-wasm-subset:") ||
      line.startsWith("qemu-tci-wasm-generated-trace:") ||
      line.startsWith("qemu-tci-progress:") ||
      line.startsWith("qemu-fw-cfg-trace:") ||
      line.startsWith("qemu-tcg-hotblocks:") ||
      line.startsWith("qemu-wasm64-tcg:") ||
      line.startsWith("qemu-wasm-perf-attrib:") ||
      line.startsWith("qemu-wasm-perf-attribution:") ||
      line.startsWith("wasm-browser-smoke:") ||
      line.startsWith(smokeState.guestHeartbeat.marker)
    );
  };

  const emit = (line) => {
    smokeState.lines += 1;
    smokeState.lastLine = line;
    const encoded = new TextEncoder().encode(`${line}\n`);
    if (line.startsWith(smokeState.guestHeartbeat.marker)) {
      smokeState.guestHeartbeat.count += 1;
      smokeState.guestHeartbeat.lastLine = line;
      smokeState.guestHeartbeat.lastElapsedMs = Math.round(performance.now() - startTime);
    }
    if (isGuestProgressLine(line)) {
      smokeState.guestLines += 1;
      smokeState.guestOutputBytes += encoded.length;
      smokeState.guestLastLine = line;
      recordBootMilestone(
        smokeState,
        line,
        Math.round(performance.now() - startTime),
      );
    }
    recordHotBlockSummary(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    recordPerfAttributionSummary(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    recordTciWasmSubsetSummary(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    recordTciWasmGeneratedTrace(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    recordFwCfgTrace(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    recordTciProgressSummary(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    recordWasm64TcgSummary(
      smokeState,
      line,
      Math.round(performance.now() - startTime),
    );
    if (smokeState.outputBytes < config.maxOutputBytes) {
      const remaining = config.maxOutputBytes - smokeState.outputBytes;
      if (encoded.length <= remaining) {
        appendLine(output, line);
        smokeState.outputBytes += encoded.length;
      } else {
        appendLine(output, new TextDecoder().decode(encoded.slice(0, remaining)));
        smokeState.outputBytes += remaining;
      }
    }
    if (smokeState.outputBytes >= config.maxOutputBytes && !smokeState.outputSuppressed) {
      smokeState.outputSuppressed = true;
      appendLine(output, `wasm-browser-smoke: output suppressed after ${config.maxOutputBytes} bytes`);
    }
    if (line.includes(config.marker)) {
      smokeState.markerSeen = true;
    }
    if (serviceBridge && line.includes(config.serviceBridge.readinessMarker)) {
      serviceBridge.markReady("serial");
    }
    for (const expected of smokeState.expectedTextSeen) {
      if (!expected.seen && line.includes(expected.text)) {
        expected.seen = true;
      }
    }
    maybeComplete();
    const exitStatus = programExitStatus(line);
    if (
      exitStatus !== null &&
      (!smokeState.markerSeen || !allExpectedTextSeen())
    ) {
      smokeState.programExitStatus = exitStatus;
      clearTimeout(timeout);
      setPhase("program-exit", `program exited before marker: status ${exitStatus}`);
    }
  };

  setPhase("fetch-guest-inputs", "loading smoke guest inputs");
  drawBrowserStatusFrame(canvas, "Loading Bus Engine OS guest...");
  if (config.persistentDisk) {
    smokeState.persistentDisk.browserStorage = await browserStorageSnapshot();
  }
  for (const mount of mounts) {
    if (mount.rootfs) {
      mount.data = await loadRootfsData(mount, config, smokeState.rootfsStorage);
    } else if (mount.persistentDisk) {
      mount.data = await loadPersistentDiskData(config, smokeState.persistentDisk);
    } else {
      mount.data = mount.optional
        ? await fetchOptionalBytes(mount.url)
        : await fetchBytes(mount.url);
    }
  }
  const availableMounts = mounts.filter((mount) => mount.data !== null);

  setPhase("import-qemu-module", "loading QEMU WebAssembly module");
  drawBrowserStatusFrame(canvas, "Loading QEMU WebAssembly runtime...");
  const moduleFactory = (await import(programUrl.href)).default;
  setPhase("start-qemu", "starting QEMU");
  drawBrowserStatusFrame(canvas, "Starting QEMU...");
  const hotBlocksEnv = config.tcgHotblocks ? {
    QEMU_TCG_HOTBLOCKS: "1",
    QEMU_TCG_HOTBLOCKS_INTERVAL: String(config.tcgHotblocksInterval),
    QEMU_TCG_HOTBLOCKS_OP_LIMIT: String(config.tcgHotblocksOpLimit),
    QEMU_TCG_HOTBLOCKS_OP_SAMPLE: String(config.tcgHotblocksOpSample),
    QEMU_TCG_HOTBLOCKS_TOP: String(config.tcgHotblocksTop),
  } : {};
  const performanceAttributionEnv = config.performanceAttribution ? {
    QEMU_WASM_PERF_ATTRIBUTION: "1",
    QEMU_WASM_PERF_ATTRIBUTION_INTERVAL: String(config.performanceAttributionInterval),
    QEMU_WASM_PERF_ATTRIBUTION_TCI_INTERVAL: String(config.performanceAttributionTciInterval),
  } : {};
  const fwCfgTraceEnv = config.fwCfgTrace ? {
    QEMU_WASM_FW_CFG_TRACE: "1",
    QEMU_WASM_FW_CFG_TRACE_LIMIT: String(config.fwCfgTraceLimit),
  } : {};
  const tciEnv = {
    ...(config.tciFastGates ? { QEMU_TCI_FAST_GATES: "1" } : {}),
    ...(config.tciRelaxedMb ? { QEMU_TCI_RELAXED_MB: "1" } : {}),
    ...(config.tciProgress ? {
      QEMU_TCI_PROGRESS: "1",
      QEMU_TCI_PROGRESS_INTERVAL: String(config.tciProgressInterval),
    } : {}),
    ...(config.tciWasmSubset ? {
      QEMU_TCI_WASM_SUBSET: "1",
      QEMU_WASM64_TCG_REPORT: "1",
      QEMU_WASM64_TCG_REPORT_INTERVAL: String(config.tciWasmSubsetInterval),
      ...(config.tciWasmGeneratedOnly ? {
        QEMU_TCI_WASM_GENERATED_ONLY: "1",
      } : {}),
      QEMU_TCI_WASM_SUBSET_INTERVAL: String(config.tciWasmSubsetInterval),
      QEMU_TCI_WASM_SUBSET_MAX_OPS: String(config.tciWasmSubsetMaxOps),
      QEMU_TCI_WASM_SUBSET_THRESHOLD: String(config.tciWasmSubsetThreshold),
    } : {}),
    ...(config.tciWasmGeneratedTrace ? {
      QEMU_TCI_WASM_GENERATED_TRACE: "1",
      QEMU_TCI_WASM_GENERATED_TRACE_LIMIT:
        String(config.tciWasmGeneratedTraceLimit),
    } : {}),
  };
  const installWasmKeySink = (module) => {
    if (config.display === "wasm" && typeof module._qemu_wasm_display_key_event === "function") {
      qemuKeySink = (linuxKey, down) => {
        smokeState.display.wasmKeySinkCalls =
          (Number(smokeState.display.wasmKeySinkCalls) || 0) + 1;
        try {
          module._qemu_wasm_display_key_event(linuxKey, down ? 1 : 0);
          updateWasmDisplayKeyStats(module, smokeState.display);
          return true;
        } catch (error) {
          smokeState.display.wasmKeySinkErrors =
            (Number(smokeState.display.wasmKeySinkErrors) || 0) + 1;
          smokeState.display.lastWasmKeySinkError =
            error && error.message ? error.message : String(error);
          return false;
        }
      };
      updateWasmDisplayKeyStats(module, smokeState.display);
    }
  };
  const moduleOptions = {
    arguments: generatedQemuArgs,
    ENV: { ...hotBlocksEnv, ...performanceAttributionEnv, ...fwCfgTraceEnv, ...tciEnv },
    qemuWasmHotBlocksEnv: hotBlocksEnv,
    qemuWasmPerfAttribEnv: performanceAttributionEnv,
    qemuWasmFwCfgEnv: fwCfgTraceEnv,
    qemuWasmTciEnv: tciEnv,
    qemuWasmDisplayCanvas: canvas,
    locateFile(path) {
      if (path === "qemu-system-x86_64.wasm") {
        return wasmUrl.href;
      }
      return new URL(path, programUrl).href;
    },
    mainScriptUrlOrBlob: programUrl.href,
    preRun: [
      (module) => {
        activeModule = module;
        mountFiles(module, availableMounts);
        if (config.tcgHotblocks) {
          const lines = Object.entries(hotBlocksEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n";
          module.FS.writeFile("/qemu-tcg-hotblocks-env", lines);
        }
        if (config.performanceAttribution) {
          const lines = Object.entries(performanceAttributionEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n";
          module.FS.writeFile("/qemu-wasm-perf-attrib-env", lines);
        }
        if (config.fwCfgTrace) {
          const lines = Object.entries(fwCfgTraceEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n";
          module.FS.writeFile("/qemu-fw-cfg-env", lines);
        }
        if (config.tciRelaxedMb || config.tciProgress ||
            config.tciWasmSubset || config.tciWasmGeneratedTrace) {
          const lines = Object.entries(tciEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n";
          module.FS.writeFile("/qemu-tci-env", lines);
        }
      },
    ],
    onRuntimeInitialized() {
      installWasmKeySink(moduleOptions);
    },
    print: emit,
    printErr: emit,
    stdin: browserNonInteractiveStdin,
  };
  const moduleCanvas = emscriptenModuleCanvas(config.display, canvas);
  if (moduleCanvas !== undefined) {
    moduleOptions.canvas = moduleCanvas;
  }
  qemuModule = await moduleFactory(moduleOptions);
  powerControl.attachModule(qemuModule);
  installWasmKeySink(qemuModule);
  if (serviceBridge) {
    serviceBridge.attachModule(qemuModule);
  }
  if (config.display === "wasm") {
    setInterval(() => {
      updateWasmDisplayKeyStats(qemuModule, smokeState.display);
    }, 250);
  }
  if (!smokeState.markerSeen || !allExpectedTextSeen()) {
    setPhase("guest-boot", "QEMU started; waiting for marker");
  }
}

if (typeof window !== "undefined") {
  run().catch((error) => {
    const state = globalThis.qemuWasmSmokeState;
    if (state) {
      recordHarnessFailure(
        state,
        error,
        typeof state.startedAtMs === "number"
          ? Math.round(performance.now() - state.startedAtMs)
          : 0,
      );
    }
    text("status").textContent = "failed";
    appendLine(text("output"), error && error.stack ? error.stack : String(error));
  });
}
