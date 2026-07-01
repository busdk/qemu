/*
 * Probe OPFS synchronous access handles from a dedicated worker.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const DIRECTORY_NAME = "qemu-wasm-opfs-probe";

function fnv1a32(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

function bytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

async function storageSnapshot() {
  const snapshot = {
    persisted: null,
    persistRequested: null,
    estimate: null,
  };

  if (!navigator.storage) {
    return snapshot;
  }
  if (typeof navigator.storage.persisted === "function") {
    snapshot.persisted = await navigator.storage.persisted();
  }
  if (typeof navigator.storage.persist === "function") {
    snapshot.persistRequested = await navigator.storage.persist();
    if (typeof navigator.storage.persisted === "function") {
      snapshot.persisted = await navigator.storage.persisted();
    }
  }
  if (typeof navigator.storage.estimate === "function") {
    snapshot.estimate = await navigator.storage.estimate();
  }

  return snapshot;
}

async function openProbeFile(storageName) {
  if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") {
    throw new Error("navigator.storage.getDirectory is not available");
  }

  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(DIRECTORY_NAME, { create: true });
  const file = await directory.getFileHandle(storageName, { create: true });

  if (typeof file.createSyncAccessHandle !== "function") {
    throw new Error("FileSystemSyncAccessHandle is not available");
  }

  return file;
}

async function writeAndRead(options) {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(options.payload);
  const file = await openProbeFile(options.storageName);

  const writeHandle = await file.createSyncAccessHandle();
  let bytesWritten = 0;
  try {
    writeHandle.truncate(0);
    bytesWritten = writeHandle.write(payloadBytes, { at: 0 });
    writeHandle.flush();
  } finally {
    writeHandle.close();
  }

  return {
    bytesWritten,
    ...(await readExisting(options)),
  };
}

async function readExisting(options) {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(options.payload);
  const file = await openProbeFile(options.storageName);
  const readHandle = await file.createSyncAccessHandle();
  const observedBytes = new Uint8Array(expectedBytes.length);
  let size = 0;
  let bytesRead = 0;

  try {
    size = readHandle.getSize();
    bytesRead = readHandle.read(observedBytes, { at: 0 });
  } finally {
    readHandle.close();
  }

  return {
    size,
    bytesRead,
    expectedBytes: expectedBytes.length,
    expectedHash: fnv1a32(expectedBytes),
    observedHash: fnv1a32(observedBytes),
    dataMatches: bytesRead === expectedBytes.length &&
      size === expectedBytes.length &&
      bytesEqual(observedBytes, expectedBytes),
  };
}

async function runProbe(message) {
  const result = {
    format: 1,
    command: message.command,
    ok: false,
    runtime: {
      worker: true,
      userAgent: navigator.userAgent,
      crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
      opfs: Boolean(navigator.storage && navigator.storage.getDirectory),
    },
    storage: await storageSnapshot(),
  };

  try {
    if (message.command === "write-read") {
      Object.assign(result, await writeAndRead(message));
    } else if (message.command === "read-existing") {
      Object.assign(result, await readExisting(message));
    } else {
      throw new Error(`unknown OPFS probe command: ${message.command}`);
    }
    result.ok = result.dataMatches === true;
  } catch (error) {
    result.errorName = error && error.name ? error.name : "Error";
    result.errorMessage = error && error.message ? error.message : String(error);
  }

  return result;
}

globalThis.addEventListener("message", async (event) => {
  const id = event.data && event.data.id;
  const result = await runProbe(event.data || {});
  globalThis.postMessage({ id, result });
});
