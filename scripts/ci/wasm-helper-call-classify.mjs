#!/usr/bin/env node
/*
 * Classify TCI helper-call sites from a QEMU WebAssembly browser smoke result.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import fs from "node:fs";

export const HELPER_CALL_CLASSIFIER_VERSION = 1;

export const TCG_CALL_FLAGS = [
  [0x0001, "NO_READ_GLOBALS"],
  [0x0002, "NO_WRITE_GLOBALS"],
  [0x0004, "NO_SIDE_EFFECTS"],
  [0x0008, "NO_RETURN"],
];

export function decodeTcgCallFlags(flags) {
  const value = Number(flags);
  if (!Number.isFinite(value) || value < 0) {
    return [];
  }
  return TCG_CALL_FLAGS
    .filter(([bit]) => (value & bit) !== 0)
    .map(([, name]) => name);
}

export function parseU32(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >>> 0;
  }
  if (typeof value === "string") {
    if (/^0x[0-9a-f]+$/i.test(value)) {
      return Number.parseInt(value, 16) >>> 0;
    }
    if (/^[0-9]+$/.test(value)) {
      return Number.parseInt(value, 10) >>> 0;
    }
  }
  return 0;
}

export function returnLenFromTciCallInsn(insn) {
  return (parseU32(insn) >>> 8) & 0xf;
}

export function returnShapeFromLen(len) {
  switch (len) {
  case 0:
    return "void";
  case 1:
    return "uint32";
  case 2:
    return "uint64";
  case 3:
    return "int128";
  default:
    return `stack-len-${len}`;
  }
}

export function generatedTraceEntries(result) {
  const entries = result?.tci?.generatedTrace?.entries;
  return Array.isArray(entries) ? entries : [];
}

function normalizeHelperName(entry) {
  return typeof entry?.helper === "string" && entry.helper.length > 0
    ? entry.helper
    : "<unknown>";
}

function callEvent(entry) {
  return entry?.reason === "ffi-call-enter";
}

function callReturnEvent(entry) {
  return entry?.reason === "ffi-call-return";
}

function sampleArgs(entry) {
  return ["arg0", "arg1", "arg2", "arg3"]
    .filter((name) => Object.hasOwn(entry, name))
    .map((name) => entry[name]);
}

function groupKey(entry) {
  const helper = normalizeHelperName(entry);
  const flags = Number(entry?.helper_flags ?? 0);
  const noReturn = Boolean(entry?.helper_no_return);
  const nargs = Number(entry?.nargs ?? 0);
  const returnLen = returnLenFromTciCallInsn(entry?.insn);
  return [
    helper,
    flags,
    noReturn ? "noreturn" : "returns",
    nargs,
    returnLen,
  ].join("\u0000");
}

function newGroup(entry) {
  const flags = Number(entry?.helper_flags ?? 0);
  const returnLen = returnLenFromTciCallInsn(entry?.insn);
  return {
    helper: normalizeHelperName(entry),
    count: 0,
    share: 0,
    helperFlags: flags,
    helperFlagNames: decodeTcgCallFlags(flags),
    helperNoReturn: Boolean(entry?.helper_no_return),
    nargs: Number(entry?.nargs ?? 0),
    returnLen,
    returnShape: returnShapeFromLen(returnLen),
    firstElapsedMs: null,
    lastElapsedMs: null,
    firstInsn: typeof entry?.insn === "string" ? entry.insn : null,
    samples: [],
  };
}

export function classifyHelperCalls(result) {
  const trace = result?.tci?.generatedTrace ?? {};
  const entries = generatedTraceEntries(result);
  const calls = entries.filter(callEvent);
  const returns = entries.filter(callReturnEvent);
  const groupsByKey = new Map();
  const helpersByName = new Map();

  for (const entry of calls) {
    const key = groupKey(entry);
    let group = groupsByKey.get(key);
    if (!group) {
      group = newGroup(entry);
      groupsByKey.set(key, group);
    }
    group.count += 1;
    const elapsedMs = Number(entry?.elapsedMs);
    if (Number.isFinite(elapsedMs)) {
      if (group.firstElapsedMs === null) {
        group.firstElapsedMs = elapsedMs;
      }
      group.lastElapsedMs = elapsedMs;
    }
    if (group.samples.length < 3) {
      group.samples.push({
        elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
        insn: typeof entry?.insn === "string" ? entry.insn : null,
        args: sampleArgs(entry),
      });
    }

    const helperName = normalizeHelperName(entry);
    helpersByName.set(helperName, (helpersByName.get(helperName) ?? 0) + 1);
  }

  const groups = Array.from(groupsByKey.values())
    .map((group) => ({
      ...group,
      share: calls.length === 0 ? 0 : group.count / calls.length,
    }))
    .sort((left, right) =>
      right.count - left.count ||
      left.helper.localeCompare(right.helper) ||
      left.returnLen - right.returnLen ||
      left.nargs - right.nargs);

  const helpers = Array.from(helpersByName.entries())
    .map(([helper, count]) => ({
      helper,
      count,
      share: calls.length === 0 ? 0 : count / calls.length,
    }))
    .sort((left, right) =>
      right.count - left.count || left.helper.localeCompare(right.helper));

  return {
    format: 1,
    purpose: "qemu-wasm-helper-call-classification",
    version: HELPER_CALL_CLASSIFIER_VERSION,
    source: {
      browserVersion: result?.browserVersion ?? null,
      elapsedMs: result?.elapsedMs ?? null,
      markerSeen: result?.markerSeen ?? null,
      generatedTraceCount: trace?.count ?? null,
      generatedTraceLimit: trace?.limit ?? null,
      retainedTraceEntries: entries.length,
    },
    totals: {
      helperCallEntries: calls.length,
      helperReturnEntries: returns.length,
      callReturnDelta: calls.length - returns.length,
      helperGroups: groups.length,
      distinctHelpers: helpers.length,
      helperCallsPerRetainedTraceEntry:
        entries.length === 0 ? 0 : calls.length / entries.length,
    },
    helpers,
    groups,
  };
}

function usage() {
  return `Usage: wasm-helper-call-classify.mjs --result FILE [options]

Options:
  --out FILE          Write JSON classification to FILE
  --json             Print JSON classification to stdout
  --top N            Number of helper groups in text output (default: 12)
  -h, --help         Show this help
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    top: 12,
  };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--result") {
      options.result = argv[++index];
    } else if (arg === "--out") {
      options.out = argv[++index];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--top") {
      options.top = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function printText(classification, top) {
  const totals = classification.totals;
  const dominant = classification.helpers[0];
  const dominantText = dominant
    ? ` dominant=${dominant.helper}=${dominant.count}` +
      ` share=${dominant.share.toFixed(4)}`
    : "";
  process.stdout.write(
    `wasm-helper-call-classify: calls=${totals.helperCallEntries} ` +
    `returns=${totals.helperReturnEntries} groups=${totals.helperGroups} ` +
    `helpers=${totals.distinctHelpers}${dominantText}\n`,
  );
  for (const group of classification.groups.slice(0, top)) {
    process.stdout.write(
      `  ${group.helper} count=${group.count} share=${group.share.toFixed(4)} ` +
      `flags=${group.helperFlags}` +
      `(${group.helperFlagNames.join("|") || "none"}) ` +
      `nargs=${group.nargs} return=${group.returnShape}` +
      ` first=${group.firstElapsedMs} last=${group.lastElapsedMs}\n`,
    );
  }
}

async function run() {
  const options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.result) {
    throw new Error("--result is required");
  }
  if (!Number.isInteger(options.top) || options.top < 0) {
    throw new Error("--top must be a non-negative integer");
  }

  const result = JSON.parse(fs.readFileSync(options.result, "utf8"));
  const classification = classifyHelperCalls(result);
  const json = `${JSON.stringify(classification, null, 2)}\n`;
  if (options.out) {
    fs.writeFileSync(options.out, json);
  }
  if (options.json) {
    process.stdout.write(json);
  } else {
    printText(classification, options.top);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
