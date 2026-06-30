/*
 * Result helpers for QEMU WebAssembly Node.js smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

export function programExitStatus(line) {
  const match = /^program exited \(with status: ([0-9]+)\)/.exec(line);
  return match === null ? null : Number(match[1]);
}

export function describeMissingText(expectedTextSeen) {
  return expectedTextSeen
    .filter((expected) => !expected.seen)
    .map((expected) => expected.text);
}

export function timeoutEvidence(markerSeen, expectedTextSeen) {
  return {
    timeout: true,
    markerMissing: !markerSeen,
    missingExpectedText: describeMissingText(expectedTextSeen),
  };
}

export function earlyProgramExitEvidence(status, markerSeen, expectedTextSeen) {
  return {
    earlyProgramExit: true,
    programExitStatus: status,
    markerMissing: !markerSeen,
    missingExpectedText: describeMissingText(expectedTextSeen),
  };
}

export function runtimeErrorEvidence(error, markerSeen, expectedTextSeen) {
  return {
    errorName: error && error.name ? error.name : "Error",
    errorMessage: error && error.message ? error.message : String(error),
    errorStack: error && error.stack ? error.stack : null,
    markerMissing: !markerSeen,
    missingExpectedText: describeMissingText(expectedTextSeen),
  };
}
