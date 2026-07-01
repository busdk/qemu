# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support for the 64-bit
browser MVP. Keep Bus Engine product work downstream.
The active working rule is to finish the unchecked `PLAN.md` items first. Only
when the active plan is empty or blocked on a concrete external dependency
should the next highest-value item be moved from `FUTURE_WORK.md` into this
file and then implemented.

## Active Goal

Implement an actual browser-hosted QEMU/WASM performance solution for the
Bus Engine OS boot slowness. First add evidence that separates CPU interpreter
cost from paravirtual device and browser-adapter cost in the current wasm64
`x86_64-softmmu` `microvm` proof. Then implement the smallest proven
acceleration path: hot translation-block WebAssembly execution with strict TCI
fallback if CPU execution is the blocker, or a virtio/browser API backend if
the measured blocker is storage, networking, entropy, graphics, input, or
another paravirtual device boundary. Browser APIs such as OPFS,
WebSocket/fetch, WebGL/WebGPU, WebCrypto, workers, and shared memory are
valid implementation tools only when they sit behind the matching QEMU device
or backend boundary and the measurement justifies them. The accepted outcome
is not more diagnostics: the generic Linux browser smoke must keep passing and
the downstream Bus Engine OS `virtual-server` browser proof must reach normal
multi-user/service readiness faster than the current timeout path or produce a
measured next bottleneck that is promoted into this plan before more
implementation work.

This lane must not take over the downstream bus-pkg, OPFS persistence,
virtio-net, virtual-desktop packaging, Codex packaging, or Engine OS
environment work owned by the parallel agent unless a narrow downstream proof
fixture is strictly required to prove the QEMU performance fix. Work from this
plan before taking any new backlog item. If every active `PLAN.md` item is
complete or blocked on a concrete external dependency, promote the
highest-value useful work item from the future plan backlog in
`FUTURE_WORK.md` into `PLAN.md` before implementing more work.

Current-goal tracking rule: every design note, code change, browser proof,
performance baseline, artifact rebuild, documentation update, commit, push,
and BusDK submodule-pin update for this slowness-fix lane must be represented
by a checkbox in this file before it is treated as accepted work.

## Current Direction

- [x] Use upstream QEMU's existing Emscripten/wasm64 baseline.
- [x] Prove `x86_64-softmmu` can build for wasm64 with TCI.
- [x] Prove a tiny 64-bit Linux console guest reaches a serial readiness
  marker under Node.js.
- [x] Prove the same generic smoke guest reaches the marker in Chrome or
  Chromium.
- [x] Keep the browser MVP focused on Chrome/Chromium. Treat Firefox and
  WebKit as compatibility tracking after the accepted Bus Engine OS proof.

## Active Browser Service Bridge Work

The next active QEMU/WASM goal is a generic browser-to-guest service bridge
that lets a browser frontend communicate with services running inside the
emulated guest. Keep this generic QEMU infrastructure; Bus Engine OS and Codex
App Server remain downstream proof payloads.

- [x] Define the browser-to-guest service bridge design: DoD is a developer
  note comparing serial console messages, QMP, virtio-console, virtio-vsock,
  9p/virtfs request files, browser networking, and worker `postMessage` for
  structured browser/frontend-to-guest service calls; selects the MVP channel;
  documents why no arbitrary host networking is promised; and records the
  security and origin-isolation assumptions for Chrome/Chromium.
- [x] Extend the browser harness manifest for service bridge metadata: DoD is
  generic manifest fields for bridge kind, request/response channel names,
  readiness marker, health request, timeout, maximum payload size, and whether
  the bridge is interactive-only or suitable for automated smoke tests, with
  deterministic Node coverage for parsing and validation.
- [x] Implement the selected generic service bridge in the browser harness:
  DoD is a browser-side API that frontend code can call through a constrained
  JavaScript interface or iframe `postMessage`, worker-to-QEMU plumbing for
  the selected guest channel, structured request/response correlation,
  timeout/error reporting, and no product-specific service names in QEMU code.
- [x] Prove the service bridge with a tiny generic guest service: DoD is a
  Chrome/Chromium smoke run where a minimal 64-bit guest starts a small
  echo/health service on the selected guest channel, the browser sends a
  structured health request, the guest returns a structured response, and the
  result JSON records bridge readiness, request id, response status, timeout,
  serial context, and screenshot.
- [x] Add generic browser power-control plumbing: DoD is a browser API and
  harness path for graceful shutdown, graceful reboot, and clearly separated
  forced power-off/reset operations; the implementation prefers guest-visible
  ACPI or selected control-channel requests where available; result JSON
  records requested operation, delivery path, guest acknowledgement when
  available, QEMU exit/reset state, timeout, and screenshot evidence; and the
  default serial/display smoke path remains unchanged unless a power operation
  is explicitly requested.
- [x] Add generic suspend/resume planning for browser-hosted QEMU state:
  DoD is a developer note describing which QEMU state can be saved in the
  browser runtime, which browser storage APIs are candidates, which manifest
  fields must match before restore, how incompatible state is rejected, and why
  native QEMU managed save remains the first acceptance target before browser
  persistence claims.
- [x] Add downstream handoff documentation for Bus Engine OS service proofs:
  DoD is documentation explaining how a downstream guest such as Bus Engine OS
  can expose an in-guest agent/service runtime through the generic bridge,
  which fields belong in the guest manifest, how frontend applications should
  discover the bridge, and which claims remain downstream responsibilities.
- [ ] Prove the full Bus Engine OS service bridge guest through Chrome:
  DoD is a Chrome/Chromium run using the accepted package-built x86_64
  Bus Engine OS `virtual-server` kernel and rootfs, the generic QEMU/WASM
  service bridge, and no `init=/bin/sh`; the run reaches normal systemd
  multi-user boot, observes the downstream `QEMU_WASM_SERVICE_READY` marker,
  sends the manifest health request through the generic bridge, receives a
  structured `ok` response with the same request id, records the Codex App
  Server binary-exists field without model credentials, and writes result JSON
  plus a screenshot. Current evidence on 2026-07-01 shows QEMU starts and the
  guest reaches `systemd[1]: Hostname set to <bus-engine-os>.` in Chromium,
  but times out before multi-user or bridge readiness even with
  `systemd-networkd-wait-online.service` masked and a virtio RNG device
  supplied; native QEMU with the same rootfs reaches login, so this item must
  diagnose and fix the browser-hosted full-system progress gap before it can
  be checked complete. Fresh optimized QEMU/WASM evidence on 2026-07-01 shows
  the bridge-capable artifact keeps making progress beyond hostname, but
  wasm64 TCI is slow enough that early systemd services such as
  `systemd-journald` and `systemd-udevd` exceed normal boot timing before the
  downstream adapter can start. The accepted fix must come from making QEMU
  execution faster or reducing unnecessary QEMU-side overhead for the same
  real guest, not from declaring a shell/init bypass or heavily masked guest
  boot as product acceptance.

## Active Browser Performance Work

The full Bus Engine OS service-bridge proof is currently gated by wasm64 TCI
performance, not by generic bridge API shape. These items were promoted from
`FUTURE_WORK.md` after Chromium evidence showed that long timeouts and
systemd masks only move the failure from one slow service to the next.

Current exact implementation goal: prove whether the opt-in wasm64 TCI subset
path produces a material Bus Engine OS boot improvement now that normal
generic Chromium smoke can execute accepted subset blocks without `-d nochain`.
Keep the default TCI path unchanged. DoD for this narrow goal is:

- [x] Keep `QEMU_TCI_WASM_SUBSET` disabled by default and prove the default
  generic Chromium smoke still reaches `QEMU_WASM_LINUX_BOOT_OK`.
- [x] Prove normal generic Chromium smoke with `--tci-wasm-subset` reaches
  `QEMU_WASM_LINUX_BOOT_OK` and reports `executed > 0` without `-d nochain`.
- [ ] Record the latest generic result JSON, screenshot, artifact hashes,
  subset counters, and remaining top fallback opcodes in this plan and
  `docs/devel/wasm-support-plan.rst`.
- [ ] Run the Bus Engine OS `virtual-server` browser proof with
  `--tci-wasm-subset` and compare marker-to-marker timing against the current
  baseline.
- [ ] If Bus Engine OS still does not reach multi-user/service readiness,
  promote the next measured blocker into this plan. Current generic-smoke
  fallback evidence says the likely next QEMU execution boundary is
  `goto_tb`/`goto_ptr` plus remaining branch/control-flow shapes, but this
  must be confirmed against the Bus Engine OS proof before more implementation
  work.

- [x] Capture the current slowness baseline before changing execution:
  DoD is a Chrome/Chromium Bus Engine OS browser run with the current
  `x86_64-softmmu` wasm64 TCI artifact, result JSON, screenshot, timeout or
  readiness state, elapsed time to the last meaningful serial/systemd marker,
  hot-block summary count, and artifact hashes. This baseline is the
  comparison point for accepting the performance fix. Accepted baseline:
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-hotblocks.json`
  timed out before multi-user/service readiness after capturing QEMU hot-block
  summaries, and
  `build/wasm-browser-proof-current/bus-engine-os-codex-bridge-optimized-long-result.json`
  showed the existing PC/i440FX path still timing out before service readiness.
- [x] Prove a lean `microvm` Bus Engine OS browser boot before writing a new
  TCG backend: DoD is a Chrome/Chromium run using the same accepted Bus Engine
  OS `virtual-server` kernel/rootfs artifacts and generic service bridge, but
  with `machine=microvm,acpi=off`, `rootfsDevice=virtio-mmio`, and matching
  non-PCI virtio devices. The run must record whether removing the default
  PC/i440FX/BIOS/ACPI path reaches multi-user/service readiness or materially
  improves marker-to-marker timing. If this works, make the harness or
  manifest path prefer the lean machine shape for browser-hosted virtual
  server proofs. If it does not, record the blocker and continue with the
  generated-WASM execution acceleration items below. Current evidence:
  `microvm,acpi=off` reaches the Linux kernel much faster than the PC path,
  but the accepted Bus Engine OS x86_64 kernel cannot discover the
  `virtio-blk-device` root disk because QEMU exposes `microvm` MMIO devices
  through auto-appended `virtio_mmio.device=` descriptors and the downstream
  kernel profile has `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES` disabled.
  Follow-up evidence with refreshed downstream kernel
  `3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920`
  wrote
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-new-kernel-2.json`.
  That run proved `virtio-mmio` devices register, `/dev/vda` appears, the
  ext4 rootfs mounts, and systemd starts under `microvm,acpi=off`, but it still
  timed out before `Reached target Multi-User System.`. The lean machine path
  removes the root-device blocker but is not by itself the performance
  solution, so continue with generated-WASM execution acceleration.
- [x] Refresh the downstream Bus Engine OS x86_64 virtual kernel proof fixture
  for lean `microvm`: DoD is an Engine OS commit enabling only the
  virtualization-specific kernel option needed for QEMU x86 `microvm`
  `virtio-mmio` command-line devices, a rebuilt browser proof kernel/rootfs
  input or documented accepted artifact replacement, and a repeated Chromium
  run that proves whether `/dev/vda` appears and the root filesystem mounts
  under `machine=microvm,acpi=off`. Accepted downstream commits:
  `099cde6` enables and gates `CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y`; `0ebf158`
  fixes Docker package source-cache propagation so the refreshed x86_64 Linux
  package can be rebuilt repeatably.
- [x] Define the wasm64 TCG/backend acceleration design before implementation:
  DoD is a developer note that explains how QEMU TCG IR can map to generated
  WebAssembly, how translated blocks call back into QEMU helpers, how guest
  RAM is accessed, how block lookup and invalidation work, which browser APIs
  are required, which part can be implemented first, and why TCI remains the
  correctness fallback for unsupported or disabled paths.
- [x] Add a TCI fallback invariant to every generated-WASM execution
  milestone: DoD is that unsupported opcodes, helper paths, browser/runtime
  failures, validation failures, disabled optimization flags, or cache
  rejection fall back to TCI without removing the already accepted 64-bit
  browser console boot path or the generic service-bridge API.
- [x] Build and measure an optimized wasm64 TCI artifact before deeper codegen
  work: DoD is a wasm64 `x86_64-softmmu` browser artifact built with Meson
  `-Doptimization=3` and LTO where Emscripten accepts it; generic Chromium
  smoke remains passing; the Bus Engine OS `virtual-server` browser proof is
  repeated against the same microvm kernel/rootfs inputs; result JSON records
  elapsed timing and last serial marker; and the evidence states whether this
  production-speed TCI build reaches multi-user/service readiness, materially
  improves the baseline, or leaves generated-WASM execution as the next
  required acceleration path.
- [x] Compile hot-block instrumentation out of normal TCI builds: DoD is a
  configure/Meson option that keeps the existing hot-block evidence path
  available for profiling builds, removes `tcg/hotblocks.c` and the per-op
  `tcg_hotblocks_maybe_tci_op()` branch from normal production wasm64 TCI
  artifacts, keeps generic Chromium smoke passing, and repeats the Bus Engine
  OS microvm proof to measure whether removing instrumentation overhead moves
  the full guest closer to multi-user readiness.
- [x] Add an opt-in wasm64 TCI memory-barrier fast path experiment: DoD is an
  Emscripten/TCI-only runtime switch that keeps the default `INDEX_op_mb`
  behavior unchanged, records why system-mode barriers cannot be removed
  unconditionally, runs generic Chromium smoke with the switch enabled, and
  repeats the Bus Engine OS microvm proof to measure whether the hot-block
  `mb` opcode overhead is a real boot bottleneck.
- [x] Add hot-block instrumentation before compiling blocks: DoD is structured
  evidence from the generic Linux smoke and the Bus Engine OS browser-hosted
  service proof showing translation-block frequency, guest PC ranges, helper
  calls, exit reasons, interpreter hot spots, and candidate instruction
  families for the first generated-WASM patches.
  - [x] Add opt-in ``QEMU_TCG_HOTBLOCKS=1`` instrumentation that records
    translation-block execution counts, guest PC ranges, exit reason counters,
    and TCI opcode hotspots.
  - [x] Keep the disabled path cheap and preserve TCI behavior when hot-block
    collection is not requested.
  - [x] Add browser smoke runner flags for ``--tcg-hotblocks``,
    ``--tcg-hotblocks-interval``, and ``--tcg-hotblocks-top``.
  - [x] Parse ``qemu-tcg-hotblocks`` JSON lines into browser smoke result
    JSON.
  - [x] Avoid a per-op C function call in the wasm64 TCI interpreter by
    counting active TCI opcodes through an inline guarded path.
  - [x] Add explicit TCI opcode sampling so browser proofs can collect useful
    interpreter hotspots without making exact per-op counting the only
    acceptance mode.
  - [x] Add an explicit opcode-sampling limit so QEMU can collect
    representative TCI hotspots and then continue the long browser boot with
    low-overhead translation-block summaries.
  - [x] Make the browser runtime reliably deliver the hot-block configuration
    to the Emscripten pthread that runs QEMU ``main()``.
  - [x] Keep the implementation scope to QEMU-side generic instrumentation in
    ``accel/tcg/cpu-exec.c``, ``include/tcg/hotblocks.h``,
    ``tcg/hotblocks.c``, and the generic browser smoke harness under
    ``scripts/ci/``; do not add Bus Engine product logic to QEMU.
  - [x] Rebuild the wasm64 ``x86_64-softmmu`` TCI artifact with the final
    instrumentation code and record JavaScript/WebAssembly hashes.
    - Current artifact hashes:
      ``qemu-system-x86_64.js`` =
      ``bd04d14a196f3126c074c5cb0f22f56aabef1f0034275f0b5e2375c674c73895``;
      ``qemu-system-x86_64.wasm`` =
      ``66066b05e99b666ed41f2899c9f713b57ad2d829ad138d54be9c4c51a4915dbc``.
  - [x] Capture passing generic Chrome/Chromium browser smoke evidence with
    ``summaryCount > 0`` and representative top translation blocks and TCI
    opcodes in the result JSON.
    - Current result target:
      ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-hotblocks-current.json``.
    - Current screenshot target:
      ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-hotblocks-current.png``.
    - Accepted evidence: Chromium ``149.0.7827.55`` reached
      ``QEMU_WASM_LINUX_BOOT_OK`` with ``summaryCount=10``,
      ``op_sample=1024``, ``op_limit=134217728``, and representative
      ``top_blocks`` plus ``top_tci_ops``.
  - [x] Capture downstream Bus Engine OS browser-hosted service proof evidence
    with ``summaryCount > 0`` and representative top translation blocks and
    TCI opcodes in the result JSON.
    - Use existing downstream Bus Engine OS proof assets only; do not change
      bus-pkg, OPFS persistence, virtio-net, virtual-desktop packaging, Codex
      packaging, or Engine OS environment files in this lane.
    - Current result target:
      ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-hotblocks.json``.
    - Current screenshot target:
      ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-hotblocks.png``.
    - Accepted QEMU-side evidence: Chromium run on the existing Bus Engine OS
      service manifest timed out before ``QEMU_WASM_SERVICE_READY`` and
      ``Reached target Multi-User System.``, matching the known downstream
      wasm64 TCI service-readiness gap, but captured ``summaryCount=15`` with
      ``op_sample=1024``, ``op_limit=134217728``, ``op_active=false``, and
      representative ``top_blocks`` plus ``top_tci_ops``.
  - [x] Record browser/runtime version, exact commands, artifact hashes,
    result files, marker state, and hot-block summary details in
    ``docs/devel/wasm-support-plan.rst``.
  - [x] Run local validation for this lane: ``git diff --check``, JavaScript
    syntax checks for the browser smoke scripts, browser smoke runner unit
    tests, guest manifest tests, and QEMU ``checkpatch.pl`` on the final
    patch.
  - [x] Commit and push QEMU ``develop``, then run BusDK
    ``scripts/sync-submodules.sh`` and commit/push the required submodule
    pins.
- [x] Add a minimal generated-Wasm block prototype outside the full backend:
  DoD is a tiny QEMU test harness that emits, validates, compiles,
  instantiates, and executes one or more simple generated WebAssembly
  functions in Node.js and Chrome/Chromium without participating in normal
  guest execution, plus documentation of browser compile latency and memory
  behavior.
- [x] Build and measure a release-shaped wasm64 TCI artifact before larger
  generated-block integration: DoD is a wasm64 `x86_64-softmmu` artifact built
  with hot-block instrumentation disabled, QOM cast debugging disabled, debug
  info disabled, QEMU assertions kept enabled because upstream QEMU rejects
  `NDEBUG`, and release-shaped build options recorded from
  `intro-buildoptions.json`; generic Chromium smoke still reaches
  `QEMU_WASM_LINUX_BOOT_OK`; the Bus Engine OS microvm proof is repeated
  against the same kernel/rootfs inputs; and the evidence states whether
  removing debug/runtime-check overhead reaches multi-user readiness,
  materially improves marker-to-marker timing, or leaves a different
  evidence-backed acceleration path as the next required work. Accepted
  evidence: QEMU rejects `NDEBUG`; the supported no-debug/QOM-cast-debug-off
  artifact passed generic Chromium smoke in 81.2 seconds and still timed out
  the Bus Engine OS microvm proof after 420 seconds at early systemd journal
  startup; adding Emscripten `-sASSERTIONS=0` produced identical JS/WASM
  hashes.
- [x] Classify the remaining boot slowness before changing execution again:
  DoD is a short evidence note based on current Bus Engine OS serial timing,
  hot-block data, `microvm`/virtio evidence, and prior art from
  `ktock/qemu-wasm` and upstream QEMU. The note must separate CPU execution
  cost from paravirtual device cost, name which browser or virtio APIs are
  relevant to the measured stall, and reject any optimization that is only a
  guess. This item gates the next implementation patch. Accepted evidence:
  `docs/devel/wasm-support-plan.rst` records that the current Bus Engine OS
  proof already uses `microvm`, direct kernel boot, `virtio-mmio` block,
  `virtio-rng`, and virtio serial/channel plumbing, then stalls in ordinary
  early systemd work. No current trace points at WebGL/WebGPU/WebCrypto as
  the next boot blocker, so the selected next implementation slice is hot-TB
  WebAssembly translation modeled on `ktock/qemu-wasm` with TCI fallback.
- [x] Add browser-hosted performance attribution before the first acceleration
  patch:
  DoD is a Chrome/Chromium Bus Engine OS `virtual-server` run that records
  enough QEMU-side counters to separate CPU interpreter time from device and
  browser-adapter time for the current `microvm` proof. At minimum it must
  report elapsed time, translation-block execution counts, TCI opcode
  samples, virtio block activity, virtio RNG activity, virtio serial/channel
  activity, display/input activity when enabled, and host/browser API waits
  that QEMU can observe. The result must name whether the next patch is CPU
  hot-TB WebAssembly translation or a paravirtual/browser API improvement
  such as OPFS-backed virtio block, WebSocket/fetch networking, WebGL/WebGPU
  display presentation, or WebCrypto-backed entropy/crypto. Do not implement
  an optimization from intuition alone.
  Accepted evidence: Chromium `141.0.7390.37` ran
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-perf-attribution-hotblocks.json`
  against the current hot-block-enabled profiling artifact
  `build-wasm64-attrib-hotblocks`. The run timed out after 420 seconds before
  multi-user readiness, but captured `summaryCount=210` hot-block summaries
  and `summaryCount=3` performance-attribution summaries. The final hot-block
  summary reported `tb_execs=2100000`, `unique_tbs=4096`,
  `dropped_tbs=2043592`, `tci_ops=134217728`, `helper_calls=60332`,
  `qemu_loads=3210491`, and `qemu_stores=3533877`; top sampled TCI opcodes
  were ordinary interpreter work such as `tci_movi`, `st`, `ld`, `add`, and
  `brcond`. The final device attribution summary reported 463 block kicks,
  10 RNG kicks, 70 serial kicks, no network/display/input activity, and about
  133 milliseconds of measured virtio handler time across the long run. A
  release-shaped no-hotblocks run produced the same device conclusion and
  timed out at early systemd journal startup. This points the next patch at
  CPU hot-TB WebAssembly translation with strict TCI fallback, not OPFS,
  networking, WebGL/WebGPU, WebCrypto, or another paravirtual browser backend
  as the first acceleration slice.
- [ ] Implement the first evidence-backed acceleration slice:
  DoD is an initial hot-TB WebAssembly translation slice modeled on
  `ktock/qemu-wasm` if CPU interpreter cost is the measured blocker, or the
  smallest virtio/browser API patch if a measured paravirtual device boundary
  is the blocker. A CPU slice must be enabled only when explicitly requested
  until proven, threshold-gated so cold TBs stay on TCI, conservative about
  eligible blocks, preserve strict TCI fallback for unsupported blocks or
  runtime failures, record generated-block hit/fallback counters, include
  deterministic tests or differential comparison against existing TCI/native
  behavior where practical, and keep the accepted TCI browser boot and generic
  service-bridge smoke from regressing. A paravirtual slice must keep the
  guest-visible device model explicit, use browser APIs only behind the
  matching QEMU device/backend boundary, include deterministic device tests,
  and keep the same smoke gates passing.
  Current rejected experiment on 2026-07-01: a tiny opt-in EM_JS-generated
  WebAssembly path for TCI bytecode was built and tested against the generic
  Chromium Linux smoke. The first straight-line register-only version kept the
  smoke passing but executed zero generated blocks because hot blocks require
  `tci_setcond32` and `brcond`. A prefix-return variant that handed branch
  control back to the interpreter failed the generic smoke with unaligned
  access traps. Do not continue expanding that shortcut. The next CPU
  acceleration attempt must either implement a proper translated-block
  control-flow model with differential tests, or prove a different measured
  bottleneck before changing direction.
  - [x] Define the minimal proper wasm64 generated-block control-flow model:
    DoD is a design note and tests for branch targets, internal labels,
    exit-to-dispatch semantics, helper fallback, and why returned internal TCI
    pointers are not accepted as the execution boundary.
    Accepted evidence: `scripts/ci/wasm-generated-block-prototype.mjs` exposes
    `validateGeneratedBlockControlFlow()` with model version 1, and
    `scripts/ci/wasm-generated-block-prototype-test.mjs` covers accepted
    label/branch/dispatch and helper-fallback shapes plus rejection for
    missing labels, raw/internal TCI pointer returns, helper calls without TCI
    fallback, and non-dispatch exits. The same prototype now emits a 267-byte
    executable WebAssembly module with branch, loop, dispatch-exit, and
    helper-fallback paths. Node evidence:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-control-flow-node.json`
    passed on Node.js `v22.19.0`; browser evidence:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-control-flow-browser.json`
    passed in Chromium `141.0.7390.37`.
  - [ ] Implement generated execution only after the control-flow model has
    deterministic coverage: DoD is a small supported opcode/control-flow
    subset with differential tests against TCI and a passing generic Chromium
    smoke with nonzero generated execution counters.
    Current prerequisite evidence: the standalone generated-block prototype
    now includes `subsetBlock(arg0, arg1)`, an independent
    `interpretGeneratedSubset(arg0, arg1)` oracle, and five differential cases
    covering normal, zero-sum, byte wraparound, larger inputs, and signed
    overflow. Node evidence:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-differential-node.json`
    passed with zero mismatches; Chromium evidence:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-differential-browser.json`
    passed with zero mismatches. This remains prototype evidence only; the
    item is unchecked until QEMU execution is opt-in wired and generic
    Chromium smoke passes with nonzero generated execution counters.
    Current evidence on 2026-07-01: the standalone prototype now includes a
    generated `subsetBlock` covering `i32.add`, `i32.eqz`, `brcond`-like
    dispatch selection, `i32.xor`, `i32.and`, and a helper fallback import.
    The generated result is compared with `interpretGeneratedSubset()` for
    five signed/wrapping input cases. Node evidence:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-subset-differential-node.json`
    passed with zero mismatches on Node.js `v22.19.0`; browser evidence:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-subset-differential-browser.json`
    passed with zero mismatches in Chromium `141.0.7390.37`. Remaining work
    for this item: wire a matching opt-in subset into QEMU guest execution and
    prove generic Chromium Linux smoke with nonzero generated execution
    counters.
    Current QEMU-hook evidence on 2026-07-01: the branch has an opt-in
    `QEMU_TCI_WASM_SUBSET=1` proof path in `tcg/tci.c` plus browser smoke
    runner flags/result parsing. The hook is threshold-gated, disabled by
    default, prevalidates the accepted TCI block shape before executing
    side-effectful helper-backed memory operations, and reports
    `qemu-tci-wasm-subset` counters. A rebuilt wasm64 `x86_64-softmmu`
    artifact with hashes
    `qemu-system-x86_64.js=b9c1b4294196c2666ebe415b0034b230ad0cb3f49f74585e13d3217fe3bd7807`
    and
    `qemu-system-x86_64.wasm=b105c4af963b90b85a1bf3af39185faaa53ba2d074f4af3fba5e30e521d760f3`
    passed the generic Chromium smoke with the subset disabled and with the
    subset enabled. Evidence files:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-subset-default-regression.json`
    and
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-current-full.json`.
    This is not yet accepted acceleration: even with threshold `1`, the
    latest enabled run reached `QEMU_WASM_LINUX_BOOT_OK` but reported
    `executed=0`, `fallback_unsupported=339999`, and top blockers
    `goto_tb`, `call`, and `brcond`. The next implementation work must prove
    safe `goto_tb`/dispatch-exit semantics or another complete-block boundary
    before adding more side-effectful helpers or claiming performance value.
    Diagnostic evidence with direct TB chaining disabled:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-nochain.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` and reported `executed=12787`, proving
    the prevalidated subset can execute complete blocks when `goto_tb` is not
    the terminal boundary. It was slower than the normal smoke path, so
    `-d nochain` is not the performance solution; it is evidence that the next
    useful implementation target is correct `goto_tb`/TB-dispatch handling.
    Follow-up evidence on the same date added helper-call and remaining
    arithmetic support. A rebuilt artifact with
    `qemu-system-x86_64.js=dedd3fe899335ade5f5b1b571c28f144d26a3f0fb7f8fe61e07133bd244908e9`
    and
    `qemu-system-x86_64.wasm=e3bcabb190970983a1abeac60a5c96411b4b0d56e562cd76e18fbc3b087c202b`
    passed default generic Chromium smoke:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-subset-extra-ops-default.json`.
    The normal subset-enabled smoke also passed without `-d nochain` and
    reported `executed=84850`, `fallback_unsupported=255064`; remaining top
    fallback opcodes were `goto_tb`, `goto_ptr`, `brcond`, `tci_movcond32`,
    `rotr`, and `tci_rotl32`:
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-extra-ops.json`.
    Current helper-call subset evidence: the latest generic Chromium smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-call.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` in Chromium `141.0.7390.37` with the
    same artifact hashes, and recorded `attempts=340000`, `executed=79444`,
    `fallback_cold=57173`, and `fallback_unsupported=203318`. Remaining top
    unsupported operations were `goto_ptr`, `goto_tb`, and `brcond`. This
    remains an opt-in TCI subset proof inside the QEMU WebAssembly binary, not
    the final generated WebAssembly backend.
  - [ ] Resolve the hot TB dispatch/chaining boundary:
    DoD is a design and implementation for hot blocks that currently fall
    back on `goto_ptr` and `goto_tb`, preserving QEMU's `tcg_qemu_tb_exec`
    return-value contract and direct-TB chaining semantics. The accepted path
    may extend the live subset with a safe terminal dispatch boundary, move to
    the generated-block dispatcher model, or prove with measurements that a
    different QEMU-side boundary has become dominant. It must keep generic
    Chromium smoke passing and record nonzero execution counters without
    treating raw linked-TB code pointers as `exit_tb` return values.
- [ ] Prove the acceleration improves the real downstream boot path:
  DoD is a Chrome/Chromium Bus Engine OS `virtual-server` browser run with the
  acceleration enabled that reaches normal multi-user/service readiness, or
  shows a measured and material marker-to-marker improvement plus a concrete
  remaining QEMU bottleneck promoted into this plan before any goal closeout.
  The proof must include result JSON, screenshot, artifact hashes, elapsed
  timing, fallback counters, and a comparison against the current baseline.
  Current evidence on 2026-07-01: the opt-in live TCI subset proof still
  timed out before `Reached target Multi-User System.` and
  `QEMU_WASM_SERVICE_READY`, but it progressed beyond the refreshed-kernel
  microvm baseline
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-new-kernel-2.json`,
  which stopped at `systemd[1]: Starting Coldplug All udev Devices...`.
  The latest downstream result
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-call.json`
  ran for `420251` ms, recorded `attempts=2660000`, `executed=221581`,
  `fallback_cold=353660`, and `fallback_unsupported=2084626`, and reached
  later systemd socket/unit startup such as `systemd[1]: Listening on Console
  Output Muting Service Socket.` and `systemd[1]: Starting Load Kernel
  Modules...`. The remaining measured QEMU-side blockers are `goto_ptr`,
  `goto_tb`, and residual `brcond` fallback, so TB dispatch/chaining is now
  promoted as the next active work item before goal closeout.
- [ ] Add a translation-block cache design and tests once the first generated
  blocks exist: DoD is a documented cache key, invalidation rule,
  memory-pressure behavior, browser-module lifetime policy, and deterministic
  tests for cache hit, miss, flush, stale-block rejection, and fallback to TCI.

- [ ] Add a generic browser OPFS-backed `virtio-blk` storage backend for
  QEMU/WASM: DoD is upstreamable QEMU-side support that exposes a block device
  to the guest while storing writable disk contents in browser Origin Private
  File System; keeps Bus Engine product policy out of QEMU; performs hot block
  I/O in a worker using synchronous OPFS access handles when available; defines
  metadata, quota, resize, flush, clean shutdown, and corruption/error
  behavior; supports an immutable fetched base image plus a writable persistent
  disk or overlay path; records browser compatibility and cross-origin
  isolation requirements; has deterministic Node/browser harness coverage for
  read/write/flush/reload persistence; and provides downstream handoff fields
  that Bus Engine OS can use to mount persistent user/workspace state for
  `virtual-server` and `virtual-desktop`.

## MVP Generic QEMU Work

- [x] Add artifact capture for `qemu-system-x86_64.js` and
  `qemu-system-x86_64.wasm`.
- [x] Add machine-readable artifact metadata.
- [x] Add target-pair metadata to the WebAssembly artifact manifest so smoke
  jobs and downstream replay tooling can verify the `qemu-system-$target`
  JavaScript launcher and WebAssembly module pair before browser startup.
- [x] Add a manifest handoff checker and run it in both wasm64 smoke jobs so
  missing or incomplete `x86_64` JavaScript/WebAssembly artifact pairs fail
  before guest preparation or browser launch.
- [x] Verify selected WebAssembly artifact manifest checksums before smoke jobs
  consume the JavaScript/WebAssembly pair.
- [x] Add deterministic test coverage for WebAssembly build artifact manifests.
- [x] Add a generic Node.js serial boot smoke harness.
- [x] Add a generic browser smoke harness with cross-origin isolation.
- [x] Add bounded browser serial evidence capture.
- [x] Add repeated `--append-extra` kernel argument diagnostics.
- [x] Add repeated `--qemu-arg` QEMU argument diagnostics and commit the
  current proof.
- [x] Add a generic browser smoke screenshot artifact so downstream users can
  preserve the terminal-like page state from success or failure runs.
- [x] Verify the native QEMU `microvm` virtio-block command line that exposes a
  raw ext4 root filesystem as `/dev/vda`.
- [x] Add optional browser harness support for a raw rootfs/disk image after a
  suitably small proof image is available.
- [x] Add a generic guest manifest so downstream systems can hand off kernel,
  initrd or rootfs, firmware, memory, marker, and diagnostic defaults without
  product-specific QEMU code.
- [x] Resolve manifest relative paths from the manifest file and verify
  optional SHA-256 checksums for guest kernel, initrd, and rootfs inputs.
- [x] Add deterministic test coverage for guest manifest path, checksum, and
  override behavior.
- [x] Add generic expected serial-text assertions so downstream proofs can
  require OS identity text in addition to a readiness marker.
- [x] Keep the accepted smoke profile stable while diagnostic arguments vary.
- [x] Add structured browser smoke phase tracking so result JSON can show
  whether a failure happened during browser feature validation, guest input
  loading, QEMU module import, QEMU startup, guest boot, timeout, early QEMU
  exit, or success.
- [x] Make browser smoke tests explicit about the no-network MVP boundary by
  defaulting to `-nic none`, with an opt-in mode for later networking probes.
- [x] Add deterministic Node coverage for browser smoke QEMU argument
  generation, including no-network, initrd, rootfs, and extra-argument paths.
- [x] Add deterministic Node coverage for browser runner terminal-status
  detection so page-level failures are captured promptly.
- [x] Preserve browser diagnostic source location, stack, and smoke state for
  Chromium page errors and failed resource requests.
- [x] Flush pending Chromium page-error diagnostics before writing browser
  smoke result JSON so intermittent WebAssembly traps keep their smoke-state
  snapshot and page-error progress sample.
- [x] Add a compact browser smoke result summary so Chromium timeout artifacts
  expose the primary error, page-error count, request-failure count, final
  progress sample, and last serial line without manual JSON correlation.
- [x] Record a page-level browser runtime snapshot in browser smoke result JSON
  so Chrome/Chromium runs preserve cross-origin isolation, SharedArrayBuffer,
  WebAssembly, memory64 constructor, user-agent, concurrency, device-memory,
  and heap-limit evidence next to guest progress.
- [x] Preserve browser harness failure name and stack in `qemuWasmSmokeState`.
- [x] Add progress-sample deltas so Chromium stall runs show whether serial
  output advanced between samples.
- [x] Compare the current Chromium stall against the older known-passing
  browser harness commit using the same wasm artifacts and guest inputs.
- [x] Probe the current Chromium stall with reduced guest memory.
- [x] Probe the current Chromium stall with the simpler `qemu64` CPU model.
- [x] Probe the current stall under Node.js v24 in both the generic Node image
  and the pinned QEMU wasm smoke runtime image.
- [x] Compare the post-FPU stall artifact against later saved wasm64 TCI
  artifacts and confirm that `optimized` and `pipe2-final` boot the same
  64-bit smoke guest under Node.js v24.
- [x] Re-run Chrome/Chromium with the accepted `pipe2-final` artifact and
  confirm the browser proof still reaches `QEMU_WASM_LINUX_BOOT_OK`.
- [x] Expose browser smoke CI variables for append-extra kernel arguments,
  guest CPU, guest memory, and timeout so Chrome/Chromium diagnostics can be
  replayed without editing CI YAML.
- [x] Archive a default browser smoke screenshot artifact from CI so every
  Chrome/Chromium proof or timeout preserves the visible terminal page state
  next to result JSON.
- [x] Add an optional browser smoke serial-idle watchdog, with optional
  last-line text gating, so Chrome/Chromium stall probes can fail with
  explicit no-progress evidence before the full marker timeout.
- [x] Add Node smoke runtime preflight so unsupported local Node versions fail
  with structured JSON evidence before importing the generated wasm module.
- [x] Add deterministic Node coverage for the Node smoke runtime preflight
  using synthetic runtime versions.
- [x] Add deterministic Node coverage for smoke result helper behavior so
  early QEMU exits, runtime errors, timeouts, missing markers, and missing
  expected serial text are recorded consistently.
- [x] Add deterministic Node coverage for runtime memory probe helper behavior.
- [x] Add deterministic Node coverage for browser memory probe runner helper
  behavior before Playwright launches a browser.
- [x] Record browser/runtime versions, commands, results, and failure modes in
  `docs/devel/wasm-support-plan.rst`.
- [x] Diagnose the wasm64 TCI guest stall where both Node.js v24 and
  Chrome/Chromium reach `x86/fpu: x87 FPU will use FXSAVE` and then time out
  instead of reaching the smoke marker.

## Bus Engine OS Downstream Proof

- [x] Treat Bus Engine OS as the downstream proof guest, not as upstream QEMU
  test data.
- [x] Define the Bus Engine OS browser-hosted guest artifact contract:
  kernel, initramfs or rootfs/disk image, firmware inputs, checksums, memory
  size, CPU model, boot arguments, readiness marker, and expected serial text.
- [x] Use the existing Bus Engine OS `virtual-server` profile as the first
  downstream input path because it is already the accepted console-oriented
  QEMU image profile.
- [x] Document the expected downstream build command:
  `bus engine os build image --profile virtual-server`, with the default host
  architecture selected automatically.
- [x] Build or consume a minimal x86_64 Bus Engine OS console artifact that can
  boot without networking or graphics.
- [x] Boot that Bus Engine OS artifact through the generic QEMU/WASM browser
  harness in Chrome or Chromium.
- [x] Capture serial evidence proving accepted Bus Engine OS kernel identity
  and rootfs init handoff through Chromium/WASM.
- [x] Add deeper userspace identity evidence that does not depend on network:
  Chrome/Chromium WASM reached the Bus Engine OS userspace welcome marker and
  observed `systemd 261.1`.
- [x] Capture a screenshot-like browser preview suitable for the
  `busdk.com/engine/` product page.
- [x] Keep the website preview code and product presentation outside upstream
  QEMU.

## Interactive Browser MVP Expansion

- [x] Add an opt-in browser SDL/canvas harness path without weakening the
  console boot gate: DoD is a `display=sdl` browser smoke mode that exposes a
  focusable canvas to the Emscripten module, passes `-display sdl,gl=off`, and
  preserves `-serial mon:stdio` so the existing console marker remains the
  default success oracle; deterministic Node tests cover both the default
  `display=none` `-nographic` path and the opt-in SDL path.
- [x] Add runner-side deterministic keyboard injection for the opt-in display
  path: DoD is a `--keyboard-text` browser smoke runner option that focuses the
  SDL canvas and types through Playwright only when `--display=sdl`, can wait
  for guest serial output with `--keyboard-after-text`, rejects keyboard
  injection in default `display=none` mode, and records non-secret input
  evidence in the result JSON.
- [x] Verify the wasm64 SDL build path enough to choose the next graphics
  implementation step: DoD is container evidence that Emscripten's SDL2 port
  works with `-sUSE_SDL=2`, QEMU configure reports `SDL support: YES 2.32.0`
  for `--enable-sdl`, and the `qemu-system-x86_64.js` target compiles through
  the QEMU SDL 2D/input sources and reaches the final link step.
- [x] Wire the wasm64 CI artifact build for the browser display path: DoD is
  the 64-bit wasm64 build job configuring QEMU with `--enable-sdl` and the
  Emscripten SDL2 compile/link flags, while the default browser smoke runner
  still uses `display=none` unless the display proof opts in.
- [x] Define the generic browser graphics/input MVP boundary: DoD is a
  developer note that makes browser graphics and keyboard input part of the
  MVP expansion, keeps WebGPU and accelerated 3D out of scope, selects the
  first QEMU display/input device path to expose in a browser, and records why
  the implementation stays generic QEMU infrastructure rather than Bus Engine
  product code.
- [x] Add opt-in browser display evidence plumbing without changing default
  serial smoke behavior: DoD is runner support for sampling the SDL canvas,
  recording canvas dimensions, focus, visibility, pixel counts, and an image
  hash in result JSON, plus a `--require-display-output` gate that only applies
  to explicit `display=sdl` runs.
- [x] Make local Chrome/Chromium proof runs independent of Playwright-managed
  browser downloads: DoD is a shared Playwright loader that can use
  `QEMU_WASM_BROWSER_EXECUTABLE` or browser-specific executable environment
  variables, both browser runners use it, and deterministic Node coverage
  verifies package loading and executable selection.
- [x] Capture the first downstream SDL/browser blocker against the existing
  Bus Engine browser-hosted artifacts: DoD is Chrome/Chromium result JSON and a
  screenshot showing that `display=sdl` plus `stdvga` starts the browser path
  but fails before the serial marker with an Emscripten WebGL context error,
  and the documented next build fix is OffscreenCanvas support for pthreaded
  SDL/WebGL.
- [x] Rebuild the wasm64 SDL artifact with OffscreenCanvas flags and capture
  the next blocker: DoD is a current QEMU build with
  `-sOFFSCREENCANVAS_SUPPORT=1` and `-sOFFSCREEN_FRAMEBUFFER=1`, Chromium
  evidence showing the default canvas transfer now fails with a transferred
  DOM-canvas `getContext` error, and a temporary no-transfer artifact proving
  the next failure is an Emscripten pthread/runtime unaligned-access trap after
  SDL draws into the browser page.
- [x] Add a first-class `wasm` display backend build path: DoD is QAPI support
  for `-display wasm`, Emscripten-only build configuration, a generic
  `ui/wasm-display.c` backend that copies QEMU 2D display surfaces to a
  browser canvas, and a wasm64 container build reaching the
  `qemu-system-x86_64.js` final link.
- [x] Extend the browser smoke harness for `display=wasm`: DoD is QEMU
  argument generation for `-display wasm`, deterministic Node coverage for the
  new display mode, browser keyboard-event mapping to Linux key codes, and an
  exported QEMU input hook for the focused browser canvas.
- [x] Prove the default serial-console regression gate after the `wasm`
  display backend lands: DoD is a Chrome/Chromium `display=none` run using the
  rebuilt wasm64 artifact that still reaches the Bus Engine OS serial marker
  and expected `systemd 261.1` text, with result JSON and screenshot evidence.
- [x] Add a browser display backend proof for QEMU/WASM: DoD is a generic
  display path that receives QEMU surface updates from the selected emulated
  display device and renders them into a browser canvas or equivalent 2D
  browser surface, with no guest-specific assumptions.
- [x] Add deterministic display harness coverage: DoD is a non-guest or tiny
  guest test path that produces a known visual frame, captures the browser
  canvas output, and compares stable pixels or a stable image hash while
  preserving the screenshot artifact on failure.
- [x] Add browser keyboard input mapping: DoD is a browser-side input bridge
  that captures focused keyboard events, maps printable keys, modifiers,
  Enter, Backspace, Tab, Escape, arrows, and function keys to the selected QEMU
  input path, and avoids stealing browser shortcuts that cannot safely be
  captured.
- [x] Add deterministic keyboard harness coverage: DoD is a browser test that
  focuses the emulator surface, sends a known key sequence through Playwright
  or an equivalent runner, and observes the expected guest-visible response
  through serial output, display output, or a structured test hook.
- [x] Add pointer/focus policy for the interactive surface: DoD is a minimal
  browser UI policy for focus, blur, keyboard capture, paste handling, pointer
  lock if used, and visible input state, with accessibility-safe escape
  behavior so the browser tab remains controllable.
- [x] Extend the generic guest manifest for graphics/input requirements: DoD is
  manifest metadata for display mode, preferred device, expected resolution,
  keyboard test sequence, expected visual marker, screenshot output, and
  whether serial-only fallback is acceptable for that run.
- [x] Prove a generic Linux graphical/input smoke before Bus Engine OS desktop:
  DoD is a Chrome/Chromium run where QEMU/WASM boots a small 64-bit Linux guest
  with the selected display/input devices, renders a stable visible marker,
  accepts keyboard input, and records result JSON plus screenshot evidence.
- [x] Prove Bus Engine OS with graphics and keyboard in the browser: DoD is a
  Chrome/Chromium run where the downstream Bus Engine OS artifact reaches a
  visible graphical or framebuffer-backed state, accepts a deterministic
  keyboard sequence, preserves serial and screenshot evidence, and records any
  limitations separately from the already accepted serial-console proof.
  Accepted evidence uses the existing downstream Bus Engine OS x86_64 kernel
  and rootfs, boots with `console=ttyS0 console=tty0 root=/dev/vda rw
  init=/bin/sh`, waits for the serial marker `Run /bin/sh as init process`,
  focuses the `display=wasm` framebuffer canvas, types `echo ok\n`, and
  captures a screenshot showing the guest shell prints `ok`. This is a
  controlled guest-visible input proof for the Bus Engine OS artifact; normal
  systemd/login readiness remains covered by the earlier serial and visible
  display proofs. Future downstream runs must not use `bus@bus-engine-os`
  alone as a readiness marker because that string can appear in the kernel
  compiler identity before userspace is ready.
- [x] Update the browser MVP acceptance definition after graphics/input proof:
  DoD is that the MVP is no longer described as serial-console-only; it
  requires 64-bit QEMU/WASM boot, visible graphics output, keyboard input,
  serial diagnostics, result JSON, screenshot artifacts, and clear fallback
  language for non-interactive runs.

## Definition Of Done

- [x] Upstream QEMU branch has reviewable incremental patches for the generic
  64-bit WebAssembly host path.
- [x] Developer documentation explains exact upstream baseline, browser
  requirements, runtime limits, tests, and known gaps.
- [x] Generic QEMU smoke tests prove a 64-bit Linux serial boot in Node.js and
  at least one browser.
- [x] Downstream Bus Engine OS proof boots through the generic QEMU/WASM
  browser harness and produces serial evidence plus a website-preview artifact.
- [x] The interactive browser path has Chrome/Chromium evidence for visible
  2D display output and deterministic keyboard input while the default
  serial-console marker remains a passing regression gate.
- [x] No Bus Engine product logic is added to upstream QEMU code.
