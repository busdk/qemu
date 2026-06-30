# QEMU WebAssembly Future Work

This file tracks QEMU/WASM work that is not part of the current 64-bit
Chrome/Chromium graphics and keyboard MVP. Keep `PLAN.md` focused on the
active goal.

## Compatibility Tracking

- [ ] Track Firefox boot progress only after the Chrome/Chromium proof path is
  accepted, unless maintainers explicitly require a wider browser matrix.
- [ ] Keep WebKit out of the first MVP unless wasm64 instantiation becomes
  reliable in the tested runtime.

## Native wasm64 TCG Work

- [ ] Define the wasm64 TCG backend design before implementation: DoD is a
  developer note that explains how QEMU TCG IR maps to generated WebAssembly,
  how translated blocks call back into QEMU helpers, how guest RAM is accessed,
  how block lookup and invalidation work, which Web APIs are required, and why
  TCI remains the correctness fallback for unsupported or disabled paths.
- [ ] Add a TCI fallback invariant to every native wasm64 TCG milestone: DoD is
  that unsupported opcodes, helper paths, browser/runtime failures, validation
  failures, or disabled optimization flags can fall back to TCI without
  removing the already accepted 64-bit browser console boot path.
- [ ] Add hot-block instrumentation before compiling blocks: DoD is structured
  evidence from the generic Linux smoke and Bus Engine OS browser proof showing
  translation-block frequency, guest PC ranges, helper calls, exit reasons, and
  candidate instruction families for the first wasm64 TCG patches.
- [ ] Add a translation-block cache design and tests: DoD is a documented cache
  key, invalidation rule, memory-pressure behavior, browser-module lifetime
  policy, and deterministic tests for cache hit, miss, flush, and stale-block
  rejection behavior.
- [ ] Add a minimal generated-Wasm block prototype outside the full backend:
  DoD is a tiny QEMU test harness that emits, validates, compiles, instantiates,
  and executes one or more simple generated Wasm functions in Node.js and
  Chrome/Chromium without participating in normal guest execution.
- [ ] Prototype integer ALU translation as the first wasm64 TCG fast path: DoD
  is a small patch set for a narrow, named instruction/op family with TCI
  fallback, deterministic TCG tests, differential comparison against native
  QEMU TCG where practical, and no regression in the accepted TCI browser boot.
- [ ] Prototype branch and direct block chaining after integer ALU proof: DoD
  is a small patch set that handles a limited branch/control-flow subset,
  preserves precise exits back to the dispatcher, and records whether compile
  overhead is offset by reduced interpreter time in Chrome/Chromium.
- [ ] Prototype guest memory load/store translation after branch proof: DoD is
  a small patch set for a limited load/store subset against wasm64 guest RAM,
  with alignment, bounds, fault-path, and helper fallback tests.
- [ ] Prototype helper-call integration after memory proof: DoD is generated
  Wasm calling selected QEMU helper functions through a stable import or
  trampoline layer, with tests for argument marshalling, return values, traps,
  and fallback on unsupported helpers.
- [ ] Prototype flags and condition-code handling after helper-call proof: DoD
  is a small x86_64-focused patch set for selected flag-producing and
  flag-consuming operations, with differential tests that compare register and
  flag state against the existing native/TCI paths.
- [ ] Expand wasm64 TCG by instruction family only after each family has proof:
  DoD for each expansion is a named supported subset, deterministic tests,
  smoke evidence, performance evidence, known gaps, and a fallback path for
  unsupported operations.
- [ ] Keep floating point, SIMD, atomics, precise exception timing, and SMP
  acceleration out of the first wasm64 TCG fast path unless earlier proofs show
  they are required for the accepted browser guest: DoD is an explicit support
  matrix and deferral note for every excluded family.
- [ ] Add browser-specific acceptance for wasm64 TCG opt-in mode: DoD is a
  Chrome/Chromium run that boots the generic Linux guest and Bus Engine OS
  with wasm64 TCG enabled for the supported subset, records fallback counters,
  serial markers, screenshots, runtime memory evidence, and compares against
  the TCI baseline.
- [ ] Make wasm64 TCG default only after fallback counters, tests, and browser
  evidence justify it: DoD is an explicit maintainer-facing decision record,
  not merely a passing demo; until then TCI remains the default correctness
  path and wasm64 TCG remains opt-in.

## Browser Control And Runtime Research

- [ ] Add QMP or structured browser-control integration after the interactive
  graphics and keyboard MVP is stable.
- [ ] Add networking support after the no-network MVP is accepted.
- [ ] Add browser persistence after the no-persistence MVP is accepted.
- [ ] Evaluate WebGPU and accelerated 3D after the 2D browser display path is
  accepted.
- [ ] Add richer graphical desktop support after the `virtual-desktop` proof
  has a stable 2D baseline.
