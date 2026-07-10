#!/usr/bin/env node
/*
 * Preflight a static VMState restore export before starting a browser or QEMU.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { compareVmstateManifests } from "./wasm-vmstate-manifest.mjs";

export const VMSTATE_STATIC_EXPORT_FORMAT =
  "qemu-wasm-vmstate-static-export-v1";
export const VMSTATE_STATIC_EXPORT_REQUIRED_KEYS = [
  "qemu.hostKind",
  "guest.packageSetDigest",
  "guest.profile",
  "guest.resumeAppend",
  "storage.immutableDisk.sha256",
  "storage.immutableDisk.bytes",
  "storage.immutableDisk.format",
  "storage.overlay.kind",
  "storage.pairingSha256",
  "harness.browser",
  "harness.runner",
  "harness.argv",
];

const SHA256_RE = /^[0-9a-f]{64}$/;

class StaticExportPreflightError extends Error {
  constructor(code, field, message, details = {}) {
    super(message);
    this.name = "StaticExportPreflightError";
    this.code = code;
    this.field = field;
    Object.assign(this, details);
  }
}

function fail(code, field, message, details = {}) {
  throw new StaticExportPreflightError(code, field, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, field) {
  if (!isObject(value)) {
    fail("invalid-field", field, `${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value === "") {
    fail("invalid-field", field, `${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, field, options = {}) {
  if (!Array.isArray(value) ||
      value.length === 0 ||
      value.some((entry) =>
        typeof entry !== "string" || (!options.allowEmpty && entry === ""))) {
    fail(
      "invalid-field",
      field,
      `${field} must be a non-empty array of ${
        options.allowEmpty ? "strings" : "non-empty strings"
      }`,
    );
  }
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    fail("invalid-field", field, `${field} must be a positive integer`);
  }
  return value;
}

function requireSha256(value, field) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    fail(
      "invalid-field",
      field,
      `${field} must be a lowercase 64-hex SHA-256`,
    );
  }
  return value;
}

function readJson(path, field) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return requireObject(value, field);
  } catch (error) {
    if (error instanceof StaticExportPreflightError) {
      throw error;
    }
    fail(
      "unreadable-json",
      field,
      `failed to read ${field} ${path}: ${error.message}`,
    );
  }
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

async function actualFileEvidence(path, role) {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      fail("not-a-file", role, `${role} is not a regular file: ${path}`);
    }
    return {
      role,
      path,
      bytes: stat.size,
      sha256: await sha256File(path),
    };
  } catch (error) {
    if (error instanceof StaticExportPreflightError) {
      throw error;
    }
    fail("unreadable-file", role, `${role} is not readable: ${path}`, {
      detail: error.message,
    });
  }
}

async function checkedFileEvidence(record, baseDir, role, options = {}) {
  requireObject(record, `files.${role}`);
  const rawPath = requireString(record.path, `files.${role}.path`);
  const path = resolve(baseDir, rawPath);
  const relativePath = relative(resolve(baseDir), path);
  if (isAbsolute(rawPath) ||
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)) {
    fail(
      "nonportable-path",
      `files.${role}.path`,
      `${role} path must stay inside the static export directory: ${rawPath}`,
    );
  }
  const expectedBytes = requirePositiveInteger(
    record.bytes,
    `files.${role}.bytes`,
  );
  const expectedSha256 = requireSha256(
    record.sha256,
    `files.${role}.sha256`,
  );
  const evidence = await actualFileEvidence(path, role);

  if (evidence.bytes !== expectedBytes) {
    fail(
      "file-bytes-mismatch",
      `files.${role}.bytes`,
      `${role} byte length mismatch: expected ${expectedBytes}, got ${evidence.bytes}`,
      { expected: expectedBytes, actual: evidence.bytes },
    );
  }
  if (evidence.sha256 !== expectedSha256) {
    fail(
      "file-sha256-mismatch",
      `files.${role}.sha256`,
      `${role} SHA-256 mismatch: expected ${expectedSha256}, got ${evidence.sha256}`,
      { expected: expectedSha256, actual: evidence.sha256 },
    );
  }
  if (options.requireFormat) {
    evidence.format = requireString(
      record.format,
      `files.${role}.format`,
    );
  }
  return evidence;
}

function nestedValue(object, dottedKey, fieldPrefix = "") {
  let current = object;
  for (const part of dottedKey.split(".")) {
    if (!isObject(current) || !Object.hasOwn(current, part)) {
      const field = fieldPrefix === ""
        ? dottedKey
        : `${fieldPrefix}.${dottedKey}`;
      fail("missing-field", field, `${field} is required`);
    }
    current = current[part];
  }
  return current;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function vmstateStoragePairingSha256(compatibility) {
  const storage = requireObject(compatibility.storage, "compatibility.storage");
  const immutableDisk = requireObject(
    storage.immutableDisk,
    "compatibility.storage.immutableDisk",
  );
  const overlay = requireObject(
    storage.overlay,
    "compatibility.storage.overlay",
  );
  const vmstate = requireObject(
    compatibility.vmstate,
    "compatibility.vmstate",
  );
  const overlayKind = requireString(
    overlay.kind,
    "compatibility.storage.overlay.kind",
  );
  const payload = {
    immutableDisk: {
      bytes: requirePositiveInteger(
        immutableDisk.bytes,
        "compatibility.storage.immutableDisk.bytes",
      ),
      format: requireString(
        immutableDisk.format,
        "compatibility.storage.immutableDisk.format",
      ),
      sha256: requireSha256(
        immutableDisk.sha256,
        "compatibility.storage.immutableDisk.sha256",
      ),
    },
    overlay: overlayKind === "none" ? { kind: "none" } : {
      kind: overlayKind,
      bytes: requirePositiveInteger(
        overlay.bytes,
        "compatibility.storage.overlay.bytes",
      ),
      format: requireString(
        overlay.format,
        "compatibility.storage.overlay.format",
      ),
      sha256: requireSha256(
        overlay.sha256,
        "compatibility.storage.overlay.sha256",
      ),
    },
    vmstate: {
      bytes: requirePositiveInteger(
        vmstate.streamBytes,
        "compatibility.vmstate.streamBytes",
      ),
      format: requireString(
        vmstate.format,
        "compatibility.vmstate.format",
      ),
      sha256: requireSha256(
        vmstate.streamSha256,
        "compatibility.vmstate.streamSha256",
      ),
    },
  };

  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function validateBrowserArtifactKeys(manifest, label) {
  const compatibility = manifest.compatibility;
  requireSha256(
    nestedValue(compatibility, "qemu.binarySha256", label),
    `${label}.qemu.binarySha256`,
  );
  requireString(
    nestedValue(compatibility, "qemu.buildConfigDigest", label),
    `${label}.qemu.buildConfigDigest`,
  );
  requireString(
    nestedValue(compatibility, "qemu.sourceCommit", label),
    `${label}.qemu.sourceCommit`,
  );
  const hostKind = nestedValue(compatibility, "qemu.hostKind", label);
  if (!["native", "wasm-browser"].includes(hostKind)) {
    fail(
      "invalid-field",
      `${label}.qemu.hostKind`,
      `${label}.qemu.hostKind must be native or wasm-browser`,
    );
  }
  if (hostKind === "wasm-browser") {
    requireSha256(
      nestedValue(compatibility, "qemu.launcherSha256", label),
      `${label}.qemu.launcherSha256`,
    );
    requireSha256(
      nestedValue(compatibility, "qemu.moduleSha256", label),
      `${label}.qemu.moduleSha256`,
    );
  }
}

function matchValue(actual, expected, field) {
  if (stableJson(actual) !== stableJson(expected)) {
    fail(
      "cross-reference-mismatch",
      field,
      `${field} does not match the compatibility tuple`,
      { expected, actual },
    );
  }
}

function validateTupleCrossReferences(
  manifest,
  saved,
  current,
  evidence,
) {
  const savedCompatibility = saved.compatibility;
  const currentCompatibility = current.compatibility;
  const staticGuest = requireObject(manifest.guest, "guest");
  const staticReadiness = requireObject(manifest.readiness, "readiness");
  const staticHarness = requireObject(manifest.harness, "harness");
  const profile = requireString(staticGuest.profile, "guest.profile");
  const packageSetDigest = requireString(
    staticGuest.packageSetDigest,
    "guest.packageSetDigest",
  );
  const marker = requireString(staticReadiness.marker, "readiness.marker");
  const expectedSerialText = requireStringArray(
    staticReadiness.expectedSerialText,
    "readiness.expectedSerialText",
  );
  const browser = requireString(staticHarness.browser, "harness.browser");
  if (!/chrome|chromium/i.test(browser)) {
    fail(
      "invalid-field",
      "harness.browser",
      "harness.browser must identify Chrome or Chromium",
    );
  }
  const runner = requireString(staticHarness.runner, "harness.runner");
  const argv = requireStringArray(
    staticHarness.argv,
    "harness.argv",
    { allowEmpty: true },
  );

  for (const [label, compatibility] of [
    ["saved.compatibility", savedCompatibility],
    ["current.compatibility", currentCompatibility],
  ]) {
    matchValue(
      nestedValue(compatibility, "guest.profile", label),
      profile,
      `${label}.guest.profile`,
    );
    matchValue(
      nestedValue(compatibility, "guest.packageSetDigest", label),
      packageSetDigest,
      `${label}.guest.packageSetDigest`,
    );
    matchValue(
      nestedValue(compatibility, "harness.browser", label),
      browser,
      `${label}.harness.browser`,
    );
    matchValue(
      nestedValue(compatibility, "harness.runner", label),
      runner,
      `${label}.harness.runner`,
    );
    matchValue(
      nestedValue(compatibility, "harness.argv", label),
      argv,
      `${label}.harness.argv`,
    );
    matchValue(
      nestedValue(compatibility, "vmstate.streamSha256", label),
      evidence.restoreStream.sha256,
      `${label}.vmstate.streamSha256`,
    );
    matchValue(
      nestedValue(compatibility, "vmstate.streamBytes", label),
      evidence.restoreStream.bytes,
      `${label}.vmstate.streamBytes`,
    );
    matchValue(
      nestedValue(compatibility, "vmstate.format", label),
      evidence.restoreStream.format,
      `${label}.vmstate.format`,
    );
    matchValue(
      nestedValue(compatibility, "storage.immutableDisk.sha256", label),
      evidence.immutableDisk.sha256,
      `${label}.storage.immutableDisk.sha256`,
    );
    matchValue(
      nestedValue(compatibility, "storage.immutableDisk.bytes", label),
      evidence.immutableDisk.bytes,
      `${label}.storage.immutableDisk.bytes`,
    );
    matchValue(
      nestedValue(compatibility, "storage.immutableDisk.format", label),
      evidence.immutableDisk.format,
      `${label}.storage.immutableDisk.format`,
    );
    const overlay = nestedValue(compatibility, "storage.overlay", label);
    if (overlay.kind === "none") {
      if (evidence.overlay !== null) {
        fail(
          "cross-reference-mismatch",
          "files.overlay",
          "files.overlay must be null when storage.overlay.kind is none",
        );
      }
    } else {
      if (evidence.overlay === null) {
        fail(
          "missing-field",
          "files.overlay",
          "files.overlay is required when storage.overlay.kind is not none",
        );
      }
      matchValue(overlay.sha256, evidence.overlay.sha256, `${label}.storage.overlay.sha256`);
      matchValue(overlay.bytes, evidence.overlay.bytes, `${label}.storage.overlay.bytes`);
      matchValue(overlay.format, evidence.overlay.format, `${label}.storage.overlay.format`);
    }
    const expectedPairing = vmstateStoragePairingSha256(compatibility);
    matchValue(
      nestedValue(compatibility, "storage.pairingSha256", label),
      expectedPairing,
      `${label}.storage.pairingSha256`,
    );
  }

  return {
    browser,
    runner,
    argv,
    profile,
    packageSetDigest,
    marker,
    expectedSerialText,
  };
}

function coldExpectedText(cold) {
  const value = Array.isArray(cold.expectedTextSeen)
    ? cold.expectedTextSeen
    : cold.smokeState?.expectedTextSeen;
  return Array.isArray(value) ? value : [];
}

function coldQemuCommand(cold) {
  if (Array.isArray(cold.qemuCommand)) {
    return cold.qemuCommand;
  }
  if (Array.isArray(cold.smokeState?.qemuArgs)) {
    return cold.smokeState.qemuArgs;
  }
  return [];
}

function inputEvidenceSha256(cold, role) {
  const entry = cold.inputEvidence?.[role];
  requireObject(entry, `coldBootResult.inputEvidence.${role}`);
  return requireSha256(
    entry.sha256,
    `coldBootResult.inputEvidence.${role}.sha256`,
  );
}

async function validateQemuArtifactManifest(manifestEvidence, current) {
  const manifest = readJson(
    manifestEvidence.path,
    "qemuArtifactManifest",
  );
  if (manifest.format !== 1) {
    fail(
      "invalid-format",
      "qemuArtifactManifest.format",
      "qemuArtifactManifest.format must be 1",
    );
  }
  if (!Array.isArray(manifest.targets)) {
    fail(
      "invalid-field",
      "qemuArtifactManifest.targets",
      "qemuArtifactManifest.targets must be an array",
    );
  }
  if (!Array.isArray(manifest.artifacts)) {
    fail(
      "invalid-field",
      "qemuArtifactManifest.artifacts",
      "qemuArtifactManifest.artifacts must be an array",
    );
  }
  const qemuTarget = requireString(
    current.compatibility.target,
    "current.compatibility.target",
  );
  const target = qemuTarget.endsWith("-softmmu")
    ? qemuTarget.slice(0, -"-softmmu".length)
    : qemuTarget;
  const pair = manifest.targets.find((entry) =>
    isObject(entry) && entry.target === target);
  if (!isObject(pair) || pair.complete !== true) {
    fail(
      "missing-artifact-pair",
      "qemuArtifactManifest.targets",
      `qemuArtifactManifest does not contain a complete ${target} target pair`,
    );
  }
  const baseDir = dirname(manifestEvidence.path);
  const checkedArtifact = async (pathValue, role, expectedSha256) => {
    const relativePath = requireString(
      pathValue,
      `qemuArtifactManifest.targets.${target}.${role}`,
    );
    const entry = manifest.artifacts.find((candidate) =>
      isObject(candidate) && candidate.path === relativePath);
    if (!isObject(entry)) {
      fail(
        "missing-artifact",
        `qemuArtifactManifest.artifacts.${role}`,
        `qemuArtifactManifest has no artifact entry for ${relativePath}`,
      );
    }
    const evidence = await checkedFileEvidence({
      path: relativePath,
      bytes: entry.size_bytes,
      sha256: entry.sha256,
    }, baseDir, `qemu-${role}`);
    matchValue(
      evidence.sha256,
      expectedSha256,
      `qemuArtifactManifest.artifacts.${role}.sha256`,
    );
    return evidence;
  };
  const launcher = await checkedArtifact(
    pair.javascript,
    "javascript",
    nestedValue(
      current.compatibility,
      "qemu.launcherSha256",
      "current.compatibility",
    ),
  );
  const module = await checkedArtifact(
    pair.wasm,
    "wasm",
    nestedValue(
      current.compatibility,
      "qemu.moduleSha256",
      "current.compatibility",
    ),
  );
  matchValue(
    current.compatibility.qemu.binarySha256,
    module.sha256,
    "current.compatibility.qemu.binarySha256",
  );
  return {
    target,
    launcher,
    module,
  };
}

function validateColdBootResult(cold, current, evidence, staticFields) {
  if (cold.success !== true) {
    fail(
      "cold-boot-invalid",
      "coldBootResult.success",
      "coldBootResult.success must be true",
    );
  }
  const readyMs = requirePositiveInteger(
    cold.elapsedMs,
    "coldBootResult.elapsedMs",
  );
  const browserVersion = requireString(
    cold.browserVersion?.browser,
    "coldBootResult.browserVersion.browser",
  );
  if (!/chrome|chromium/i.test(browserVersion)) {
    fail(
      "cold-boot-invalid",
      "coldBootResult.browserVersion.browser",
      "cold boot must record a Chrome or Chromium browser version",
    );
  }
  matchValue(cold.marker, staticFields.marker, "coldBootResult.marker");
  if (cold.markerSeen !== true) {
    fail(
      "cold-boot-invalid",
      "coldBootResult.markerSeen",
      "coldBootResult.markerSeen must be true",
    );
  }
  const expectedTextSeen = coldExpectedText(cold);
  for (const text of staticFields.expectedSerialText) {
    if (!expectedTextSeen.some((entry) =>
      isObject(entry) && entry.text === text && entry.seen === true)) {
      fail(
        "cold-boot-invalid",
        "coldBootResult.expectedTextSeen",
        `cold boot did not record required serial text: ${text}`,
      );
    }
  }
  const pageStatus = requireString(
    cold.pageStatus,
    "coldBootResult.pageStatus",
  );
  const qemuCommand = coldQemuCommand(cold);
  requireStringArray(qemuCommand, "coldBootResult.qemuCommand");
  const lastLine = typeof cold.lastLine === "string" ? cold.lastLine : "";
  const guestLastLine = typeof cold.guestLastLine === "string"
    ? cold.guestLastLine
    : "";
  if (lastLine === "" && guestLastLine === "") {
    fail(
      "cold-boot-invalid",
      "coldBootResult.finalConsoleState",
      "cold boot must retain lastLine or guestLastLine",
    );
  }

  const compatibility = current.compatibility;
  matchValue(
    inputEvidenceSha256(cold, "program"),
    nestedValue(compatibility, "qemu.launcherSha256", "current.compatibility"),
    "coldBootResult.inputEvidence.program.sha256",
  );
  matchValue(
    inputEvidenceSha256(cold, "wasm"),
    nestedValue(compatibility, "qemu.moduleSha256", "current.compatibility"),
    "coldBootResult.inputEvidence.wasm.sha256",
  );
  matchValue(
    inputEvidenceSha256(cold, "kernel"),
    nestedValue(compatibility, "guest.kernelSha256", "current.compatibility"),
    "coldBootResult.inputEvidence.kernel.sha256",
  );
  matchValue(
    inputEvidenceSha256(cold, "rootfs"),
    nestedValue(compatibility, "guest.rootfsSha256", "current.compatibility"),
    "coldBootResult.inputEvidence.rootfs.sha256",
  );
  matchValue(
    inputEvidenceSha256(cold, "guestManifest"),
    evidence.guestManifest.sha256,
    "coldBootResult.inputEvidence.guestManifest.sha256",
  );

  return {
    readyMs,
    browserVersion,
    marker: cold.marker,
    pageStatus,
    expectedTextSeen,
    qemuCommand,
    finalState: {
      lastLine,
      guestLastLine,
      programExitStatus: cold.programExitStatus ??
        cold.smokeState?.programExitStatus ?? null,
    },
  };
}

function failureRecord(error) {
  return {
    code: error.code || "preflight-error",
    field: error.field || null,
    message: error.message,
    expected: error.expected ?? null,
    actual: error.actual ?? null,
    detail: error.detail ?? null,
  };
}

export async function preflightVmstateStaticExport(manifestPath) {
  const absoluteManifestPath = resolve(manifestPath);
  const result = {
    format: 1,
    purpose: "qemu-wasm-vmstate-static-export-preflight",
    ok: false,
    browserStarted: false,
    qemuStarted: false,
    staticExportManifest: null,
    files: null,
    vmstateRestoreManifestCheck: null,
    coldBoot: null,
    restorePlan: null,
    failure: null,
  };

  try {
    result.staticExportManifest = await actualFileEvidence(
      absoluteManifestPath,
      "staticExportManifest",
    );
    const manifest = readJson(absoluteManifestPath, "staticExportManifest");
    if (manifest.format !== VMSTATE_STATIC_EXPORT_FORMAT) {
      fail(
        "invalid-format",
        "format",
        `format must be ${VMSTATE_STATIC_EXPORT_FORMAT}`,
        { expected: VMSTATE_STATIC_EXPORT_FORMAT, actual: manifest.format },
      );
    }
    const files = requireObject(manifest.files, "files");
    const baseDir = dirname(absoluteManifestPath);
    const evidence = {
      savedManifest: await checkedFileEvidence(
        files.savedManifest,
        baseDir,
        "savedManifest",
      ),
      currentManifest: await checkedFileEvidence(
        files.currentManifest,
        baseDir,
        "currentManifest",
      ),
      restoreStream: await checkedFileEvidence(
        files.restoreStream,
        baseDir,
        "restoreStream",
        { requireFormat: true },
      ),
      qemuArtifactManifest: await checkedFileEvidence(
        files.qemuArtifactManifest,
        baseDir,
        "qemuArtifactManifest",
      ),
      guestManifest: await checkedFileEvidence(
        files.guestManifest,
        baseDir,
        "guestManifest",
      ),
      immutableDisk: await checkedFileEvidence(
        files.immutableDisk,
        baseDir,
        "immutableDisk",
        { requireFormat: true },
      ),
      overlay: files.overlay === null ? null : await checkedFileEvidence(
        files.overlay,
        baseDir,
        "overlay",
        { requireFormat: true },
      ),
      coldBootResult: await checkedFileEvidence(
        files.coldBootResult,
        baseDir,
        "coldBootResult",
      ),
    };
    result.files = evidence;

    const saved = readJson(evidence.savedManifest.path, "savedManifest");
    const current = readJson(evidence.currentManifest.path, "currentManifest");
    const manifestCheck = compareVmstateManifests(saved, current, {
      requiredKeys: VMSTATE_STATIC_EXPORT_REQUIRED_KEYS,
      restoreTuple: true,
    });
    result.vmstateRestoreManifestCheck = {
      ...manifestCheck,
      saved: evidence.savedManifest.path,
      current: evidence.currentManifest.path,
    };
    if (!manifestCheck.ok) {
      const mismatch = manifestCheck.mismatches[0];
      fail(
        "incompatible-restore-tuple",
        mismatch.key,
        `VMState manifest mismatch: ${mismatch.key}: ${mismatch.reason}`,
        { expected: mismatch.saved, actual: mismatch.current },
      );
    }
    validateBrowserArtifactKeys(saved, "saved.compatibility");
    validateBrowserArtifactKeys(current, "current.compatibility");
    if (current.compatibility.qemu.hostKind !== "wasm-browser") {
      fail(
        "invalid-field",
        "current.compatibility.qemu.hostKind",
        "current browser restore consumer must use qemu.hostKind=wasm-browser",
      );
    }
    evidence.qemuArtifacts = await validateQemuArtifactManifest(
      evidence.qemuArtifactManifest,
      current,
    );
    const staticFields = validateTupleCrossReferences(
      manifest,
      saved,
      current,
      evidence,
    );
    const cold = readJson(evidence.coldBootResult.path, "coldBootResult");
    result.coldBoot = validateColdBootResult(
      cold,
      current,
      evidence,
      staticFields,
    );
    result.restorePlan = {
      browser: staticFields.browser,
      runner: staticFields.runner,
      argv: staticFields.argv,
      marker: staticFields.marker,
      expectedSerialText: staticFields.expectedSerialText,
      profile: staticFields.profile,
      packageSetDigest: staticFields.packageSetDigest,
      artifacts: {
        launcherSha256: current.compatibility.qemu.launcherSha256,
        moduleSha256: current.compatibility.qemu.moduleSha256,
        kernelSha256: current.compatibility.guest.kernelSha256,
        rootfsSha256: current.compatibility.guest.rootfsSha256,
      },
    };
    result.ok = true;
    return result;
  } catch (error) {
    result.failure = failureRecord(error);
    return result;
  }
}

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-vmstate-static-export.mjs --manifest FILE [OPTIONS]

Options:
  --manifest FILE  Static VMState export manifest
  --out FILE       Write structured preflight evidence
  --json           Print structured preflight evidence
  --help           Show this help
`);
  process.exit(status);
}

async function main(argv) {
  let manifest = null;
  let out = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      manifest = argv[++index];
    } else if (arg === "--out") {
      out = argv[++index];
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help") {
      usage(0);
    } else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      usage(2);
    }
  }
  if (manifest === null) {
    process.stderr.write("--manifest is required\n");
    usage(2);
  }

  const result = await preflightVmstateStaticExport(manifest);
  if (out !== null) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  }
  if (json || out === null) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write("VMState static export preflight passed\n");
  }
  if (!result.ok) {
    process.stderr.write(`${result.failure.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
