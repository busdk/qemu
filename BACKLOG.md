# QEMU WebAssembly Backlog

This file tracks QEMU/WASM work that is not part of the current active goal.
Keep `PLAN.md` focused on making the Bus Engine OS `virtual-server` guest
reach normal multi-user boot in browser-hosted QEMU/WASM within five minutes.

## Compatibility Tracking

- [ ] Track Firefox boot progress only after the Chrome/Chromium proof path is
  accepted, unless maintainers explicitly require a wider browser matrix.
- [ ] Keep WebKit out of the first MVP unless wasm64 instantiation becomes
  reliable in the tested runtime.

## Native wasm64 TCG Work

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

- [ ] Evaluate richer QMP integration after the active browser service bridge
  proves the first structured guest-service path. DoD is a decision on whether
  QMP remains only VM control plumbing or becomes part of the public browser
  controller surface, without replacing the accepted guest-service bridge.
- [ ] Add a generic browser OPFS-backed `virtio-blk` storage backend for
  QEMU/WASM after the active CPU performance proof is accepted. DoD is
  upstreamable QEMU-side support that exposes a block device to the guest while
  storing writable disk contents in browser Origin Private File System; keeps
  product policy out of QEMU; performs hot block I/O in a worker using
  synchronous OPFS access handles when available; defines metadata, quota,
  resize, flush, clean shutdown, and corruption/error behavior; supports an
  immutable fetched base image plus a writable persistent disk or overlay
  path; records browser compatibility and cross-origin isolation requirements;
  has deterministic Node/browser harness coverage for read/write/flush/reload
  persistence; and provides downstream handoff fields for future virtual
  server and virtual desktop use.
- [ ] Add networking support after the no-network MVP is accepted.
- [ ] Add browser persistence after the no-persistence MVP is accepted.
- [ ] Evaluate WebGPU and accelerated 3D after the 2D browser display path is
  accepted.
- [ ] Add richer graphical desktop support after the `virtual-desktop` proof
  has a stable 2D baseline.


## Moved From PLAN.md On 2026-07-02

The following material was moved out of `PLAN.md` because it is not the current active goal. The current active goal is only to make the Bus Engine OS `virtual-server` guest reach normal multi-user boot in browser-hosted WASM QEMU within five minutes.

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
performance, not by generic bridge API shape. These items were previously
promoted from the backlog after Chromium evidence showed that long timeouts
and systemd masks only move the failure from one slow service to the next.

Current exact implementation goal: prove whether the opt-in wasm64 TCI subset
path produces a material Bus Engine OS boot improvement now that normal
generic Chromium smoke can execute accepted subset blocks without `-d nochain`.
Keep the default TCI path unchanged. DoD for this narrow goal is:

- [x] Keep `QEMU_TCI_WASM_SUBSET` disabled by default and prove the default
  generic Chromium smoke still reaches `QEMU_WASM_LINUX_BOOT_OK`.
- [x] Prove normal generic Chromium smoke with `--tci-wasm-subset` reaches
  `QEMU_WASM_LINUX_BOOT_OK` and reports `executed > 0` without `-d nochain`.
- [x] Record the latest generic result JSON, screenshot, artifact hashes,
  subset counters, and remaining top fallback opcodes in this plan and
  `docs/devel/wasm-support-plan.rst`.
- [x] Run the Bus Engine OS `virtual-server` browser proof with
  `--tci-wasm-subset` and compare marker-to-marker timing against the current
  baseline.
- [x] If Bus Engine OS still does not reach multi-user/service readiness,
  promote the next measured blocker into this plan. Current generic-smoke
  and Bus Engine OS fallback evidence says the next QEMU execution boundary is
  side-effect-safe `brcond` support inside the hot-TB subset. Terminal
  `goto_tb`/`goto_ptr` dispatch is now implemented and no longer appears in
  the top unsupported operations.

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
  Follow-up evidence on 2026-07-01: an O3/no-LTO/no-debug-info artifact with
  QOM cast debugging disabled and QEMU assertions kept enabled produced
  `qemu-system-x86_64.js=088c177d4e2099d187052008ee32203f4b5a8fc481cb6ce4d2eb7659ddfc04a4`
  and
  `qemu-system-x86_64.wasm=cbf01416613890e67629a642bfbcb41266f095f8d33bd991c524966133dbe9db`.
  Generic Chromium `149.0.7827.55` smoke
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-o3-nodebug-nohot.json`
  reached `QEMU_WASM_LINUX_BOOT_OK` in `98467` ms. This is slower than the
  same-browser O2/default comparison (`95502` ms) and slower than the earlier
  O3/LTO run (`79973` ms), so O3/no-LTO compiler flags are rejected as the
  current performance solution and do not justify a long Bus Engine OS proof.
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
- [x] Add guest-origin heartbeat/progress diagnostics for Bus Engine OS boot:
  DoD is browser smoke runner support that records guest-only serial line and
  byte counters separately from QEMU instrumentation, supports an explicit
  guest-idle timeout, records the last guest-origin line in result JSON and
  summaries, and reruns the Bus Engine OS microvm proof with verbose
  kernel/systemd logging to decide whether the current stop is a mount/unit
  blocker such as `/sys/fs/bpf` or continued slow CPU execution. This item is
  QEMU-generic harness work; any downstream Engine OS heartbeat service,
  kernel config change, or systemd unit mask belongs in the downstream module
  after this diagnostic names the failing phase.
  Accepted evidence on 2026-07-01: the QEMU browser harness now tracks
  `guestLines`, `guestOutputBytes`, and `guestLastLine` separately from raw
  serial output, exposes `--guest-idle-timeout-ms` and
  `--guest-idle-after-text`, and includes guest-idle state in result
  summaries. The Bus Engine OS microvm diagnostic
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-guest-idle-diagnostic.json`
  failed after guest-origin serial output was idle for 90001 ms, while raw
  QEMU serial output continued with `qemu-tci-wasm-subset` summaries. The last
  guest line was `systemd[1]: Mounting bpf (bpf) on /sys/fs/bpf ...`, so the
  current blocker is a downstream kernel/systemd BPF filesystem mount phase,
  not merely lack of QEMU process output. A follow-up run with
  `systemd.mask=sys-fs-bpf.mount` still reached the same last guest line,
  proving that argument did not suppress the mount in this path. Downstream
  Bus Engine OS must add heartbeat/progress policy and rebuild the virtual
  kernels with `CONFIG_BPF_FS=y` before more QEMU CPU optimization can be
  treated as the next boot-readiness blocker.
- [x] Treat Bus Engine OS heartbeat markers as liveness, not progress:
  DoD is page-side detection of `bus-engine-os-heartbeat:` serial markers,
  result-state fields for count/last marker/last elapsed time, progress-sample
  heartbeat deltas, and a runner test proving that heartbeat output keeps raw
  serial output active while `--guest-idle-timeout-ms` still fails against the
  last non-heartbeat guest progress line. Accepted evidence on 2026-07-01:
  `wasm-browser-smoke.mjs` records `guestHeartbeat`, excludes heartbeat
  markers from `guestLines`/`guestOutputBytes`/`guestLastLine`, and
  `wasm-browser-smoke-runner-test.mjs` passes with a synthetic `/sys/fs/bpf`
  stall plus continuing heartbeat lines.
- [x] Add default-path TCI progress visibility for post-hostname silence:
  DoD is a production-shaped, non-debug wasm64 artifact that can emit
  low-volume opt-in `qemu-tci-progress` JSON summaries without enabling
  hot-block instrumentation; browser runner flags and result fields for the
  progress interval and bounded summaries; deterministic parser, URL, and
  result tests; a passing generic Chromium smoke; and strict versus
  relaxed-memory-barrier Bus Engine OS microvm proofs that identify whether
  the guest is still executing CPU work after the last guest-origin serial
  line. Accepted evidence on 2026-07-02: `QEMU_TCI_PROGRESS=1` and
  `QEMU_TCI_PROGRESS_INTERVAL=N` are default-off Emscripten/TCI switches in
  `tcg/tci.c`; the browser smoke runner exposes `--tci-progress` and
  `--tci-progress-interval`; generic Chromium smoke
  `/tmp/qemu-wasm-tci-progress/generic-browser-smoke-tci-progress.json`
  reached `QEMU_WASM_LINUX_BOOT_OK` in `84703` ms with `summaryCount=7379`.
  The strict Bus Engine OS proof
  `/tmp/qemu-wasm-tci-progress/bus-engine-os-virtual-server-tci-progress.json`
  timed out after hostname but recorded `194000000` TB entries and
  `192308504` dispatches, proving ongoing guest CPU execution. The relaxed
  comparison
  `/tmp/qemu-wasm-tci-progress/bus-engine-os-virtual-server-relaxed-mb-tci-progress.json`
  improved early markers by about six seconds but still timed out after
  hostname, so relaxed barriers remain insufficient as the performance fix.
- [ ] Implement a measured CPU execution throughput fix for the post-hostname
  systemd workload:
  DoD is a QEMU-side acceleration patch selected from evidence rather than
  speculation, preserves strict TCI fallback, keeps the default generic
  Chromium smoke passing, and produces a Bus Engine OS `virtual-server`
  microvm run that either reaches multi-user/service readiness within
  `300000` ms or records a marker-to-marker improvement plus the next concrete
  measured CPU-side bottleneck in this plan. Do not continue the rejected
  per-block `EM_JS` generated-module path unless new evidence shows it can
  beat strict TCI on the generic smoke gate.
- [x] Measure opt-in TCI fast feature gates:
  DoD is an Emscripten/wasm64 `x86_64-softmmu` artifact with
  `QEMU_TCI_FAST_GATES=1` support, runner plumbing through
  `--tci-fast-gates`, a passing default generic Chromium smoke, a passing
  generic Chromium smoke with `--tci-fast-gates`, and a timing comparison
  against the accepted default-path baseline. The implementation must leave
  default behavior unchanged, keep existing progress/subset diagnostics
  available when explicitly enabled, and be rejected in this plan if the
  optimized generic smoke does not beat the same-artifact default path.
  Accepted evidence on 2026-07-02: artifact
  `/tmp/qemu-wasm-fast-gates/qemu-system-x86_64.{js,wasm}` was built with
  `-Doptimization=2 -Ddebug=false`; hashes were
  `qemu-system-x86_64.js=e462c4f543062b271dfca8f7a50f2e6576f1be490b6c558281541e510847c9c6`
  and
  `qemu-system-x86_64.wasm=f29ecf0bf72cdb5d5fd32bb832d2fb06389bea6d0d1cf5527818fece5a398989`.
  Generic Chromium `149.0.7827.55` smoke reached
  `QEMU_WASM_LINUX_BOOT_OK` in `91269` ms by default and `89291` ms with
  `--tci-fast-gates`, so the opt-in gate cache is a small generic win and
  default behavior remains unchanged. The same artifact still failed the Bus
  Engine OS `virtual-server` proof with `--tci-fast-gates`, idling after the
  hostname line at `310470` ms; this does not complete the broader
  post-hostname CPU-throughput fix.
- [x] Implement the first evidence-backed acceleration slice:
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
  - [x] Implement generated execution only after the control-flow model has
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
    Accepted generated-execution evidence on 2026-07-01: the live QEMU
    `tcg/tci.c` path now builds and caches real WebAssembly modules for a
    conservative straight-line register-only TCI subset ending at `exit_tb` or
    `goto_tb`. The default TCI path remains unchanged unless
    `QEMU_TCI_WASM_SUBSET=1` is enabled. Unsupported generated shapes are
    cached in C after the first failed classification, so hot unsupported
    blocks do not cross into JavaScript repeatedly. Final rebuilt artifact
    hashes were
    `qemu-system-x86_64.js=3c0cf09128f97248346d180b843f3b20f714fa4ceef4c422de1a369fa5071e68`
    and
    `qemu-system-x86_64.wasm=678a2c5a805afb684b45feccdb4583c3048c285cf7872a0536dd415f5c590900`.
    Default generic Chromium smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-opcounters-default.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` in `82256` ms. Subset generic Chromium
    smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-opcounters-subset.json`
    reached the same marker in `89034` ms with `generated_compiled=38`,
    `generated_executed=27657`, and `generated_compile_failed=0`.
    Generated-specific unsupported counters show the next coverage blocker is
    `ld32u` (`690150` generated fallback classifications), followed by `st8`
    (`386`). The broader C subset still reports `brcond` as the top fallback.
    Downstream Bus Engine OS proof with the same artifact
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-generated-opcounters-subset.json`
    still timed out before multi-user readiness, but recorded
    `generated_compiled=135`, `generated_executed=1301928`,
    `generated_compile_failed=0`, and generated fallback blockers `ld32u`
    (`5018171`) plus `st8` (`69`).
  - [ ] Add generated host-memory load/store support for the measured
    `ld32u`/`st8` blocker:
    DoD is a generated-Wasm memory-access design and implementation that
    imports or otherwise safely reaches the Emscripten/QEMU linear memory,
    supports at least the measured `ld32u` load shape and either rejects or
    correctly handles `st8`, preserves fallback for alignment, fault, and
    unsupported memory cases, and keeps generic Chromium smoke passing with
    increased generated execution coverage. The proof must record
    generated-specific unsupported counters again before another downstream
    Bus Engine OS proof is treated as acceptance evidence.
    Rejected evidence on 2026-07-01: a JS-imported `ld32u` helper kept generic
    Chromium smoke passing and moved the dominant generated fallback from
    `ld32u` to `tci_setcond32`, but it was slower than the same-artifact
    default run (`105717` ms with subset versus `99884` ms default in Chromium
    `149.0.7827.55`). Adding native generated `tci_setcond32` shifted the
    dominant generated fallback to `brcond`, but made the generic subset run
    slower again (`108723` ms) and did not increase generated execution. Do not
    promote the JS helper-import memory path as a performance fix without
    new evidence; the next performance-oriented step should avoid per-op JS
    helper calls or address the measured `brcond`/control-flow boundary.
    Follow-up rejected evidence on 2026-07-01: the first narrower
    generated-Wasm `ld32u` experiment imported `Module.wasmMemory` instead
    of calling a per-load JavaScript helper. The rebuilt artifact hashes were
    `qemu-system-x86_64.js=50aef5028941ce4eedabbe6675d485e810b1c4b7d8be7db4c9602e4431b0ae25`
    and
    `qemu-system-x86_64.wasm=280fee79206958044aeb98d544e6b1ab7753d6b26ce778413ad3629b80ebebac`.
    Default Chromium smoke reached `QEMU_WASM_LINUX_BOOT_OK` in `81075` ms,
    but the subset run took `113677` ms with `generated_compiled=0`,
    `generated_executed=0`, and `generated_compile_failed=27627`. Inspecting
    the generated Emscripten glue showed `wasmMemory` is an internal runtime
    variable and `Module.wasmMemory` is not exported in this build shape, so
    the submodules imported an undefined memory. Do not reattempt generated
    memory loads through `Module.wasmMemory`.
  - [x] Reject direct generated-Wasm `ld32u` memory import as the current
    performance fix:
    DoD is a rebuilt artifact and paired Chromium default/subset smokes
    proving whether importing the internal Emscripten `wasmMemory` object into
    generated wasm64 blocks is both valid and faster than default TCI. Result
    on 2026-07-01: the rebuilt artifact hashes were
    `qemu-system-x86_64.js=18f690b5dcb99d4cff6fe6caa78e89af5aec87770f2ee06c5a84c4f9160919b7`
    and
    `qemu-system-x86_64.wasm=2bce0f78365aae4d6a08af09c29cfc78a7f425892c1758f2d7d20875f14f788b`.
    Default Chromium `141.0.7390.37` smoke reached
    `QEMU_WASM_LINUX_BOOT_OK` in `81487` ms, while the subset run reached the
    same marker in `115358` ms. The subset run compiled generated modules
    (`generated_compiled=26153`, `generated_compile_failed=0`) and executed
    them (`generated_executed=54146`), proving the direct `wasmMemory` import
    ABI, but it regressed wall-clock time and still fell back mostly on
    `tci_setcond32`. The live `ld32u` patch was removed; do not promote
    generated memory loads as a performance solution unless new evidence
    removes this overhead and improves the generic smoke.
    Confirming evidence on 2026-07-02: a broader unpromoted direct
    host-memory variant added generated support for `ld8u`, `ld8s`, `ld16u`,
    `ld16s`, `ld32u`, `ld32s`, `ld`, `st8`, `st16`, `st32`, and `st`, plus
    deterministic signed/unsigned direct-memory prototype coverage. The
    rebuilt artifact hashes were
    `qemu-system-x86_64.js=5e789189fbf0d251a63578d0b2b866997b22411437cbec3518d3a4c6a57de1ed`
    and
    `qemu-system-x86_64.wasm=ab3d385c4e2745e26c7f3eba9fbe9148816cd6c5968e217fb56fef6987a0fbaf`.
    Default Chromium `149.0.7827.55` smoke reached
    `QEMU_WASM_LINUX_BOOT_OK` in `79106` ms. The opt-in subset smoke reached
    the same marker in `109920` ms with `generated_compiled=30271`,
    `generated_executed=59544`, `generated_compile_failed=0`, and
    `generated_direct_load_ops=0`/`generated_direct_store_ops=0`. The dominant
    generated fallback was `tci_setcond32` with `5348494` classifications,
    followed by `mb`. The live patch was removed because the generic speed
    gate failed and the added direct-memory opcodes did not cover the blocks
    selected in this run.
  - [x] Reject wiring the deterministic hot-block lowering subset into the
    current live generated path:
    DoD is an opt-in `tcg/tci.c` generated-Wasm slice that supports forward,
    non-crossing `brcond`, local host-memory `ld`/`st` forms, `ld32u`,
    `st32`, `tci_setcond32`, and `mb` only when the existing relaxed-barrier
    switch is enabled; rejects unsupported branch or memory shapes before
    executing generated code; falls back to TCI for every rejected shape; keeps
    generic Chromium smoke passing; and records whether generated execution
    coverage and wall-clock time improve enough to justify a downstream Bus
    Engine OS proof.
    Rejected evidence on 2026-07-02: an unpromoted runtime slice added
    forward non-crossing `brcond`, `ld`, `st`, `ld32u`, `st32`,
    `tci_setcond32`, and relaxed-`mb` lowering to the live EM_JS generated
    compiler. The artifact built successfully with
    `scripts/ci/wasm-build-artifacts-local.py` and produced
    `qemu-system-x86_64.js` SHA-256
    `c0a5e66e96103172c61e6677de99370a535c67070ae461662c17ef813f481b60`
    plus `qemu-system-x86_64.wasm` SHA-256
    `508cbeea55f3561a66066d4c733ce771e5bd53b38f187c52062b6baa0807b8b9`.
    Generic Chromium smoke with the subset disabled reached
    `QEMU_WASM_LINUX_BOOT_OK` in `92557` ms
    (`/tmp/qemu-wasm-generated-hot-subset/generic-browser-smoke-default.json`).
    The opt-in run with `--tci-wasm-subset --tci-relaxed-mb` reached the same
    marker in `102346` ms
    (`/tmp/qemu-wasm-generated-hot-subset/generic-browser-smoke-subset-relaxed-mb.json`)
    with `executed=76978971`, `generated_compiled=4`,
    `generated_executed=933`, `generated_compile_failed=0`, and remaining
    generated fallback `st8=9690`. The runtime patch was removed because it
    regressed the generic smoke and did not create enough generated-Wasm
    coverage to justify a downstream Bus Engine OS proof.
  - [x] Isolate generated-Wasm execution from the slower C subset path before
    adding more opcode lowering:
    DoD is an opt-in measurement mode where generated-Wasm eligible blocks may
    run, but generated-unsupported blocks fall back directly to normal TCI
    instead of executing the C subset interpreter. Run generic Chromium smokes
    for default TCI, current subset, and generated-only isolation using the
    same artifact and guest inputs. If generated-only does not beat default
    while reporting nonzero generated execution, stop expanding the current
    per-block EM_JS generated-module path and promote a different measured
    QEMU-side acceleration approach into this plan.
    Rejected evidence on 2026-07-02: the opt-in
    `QEMU_TCI_WASM_GENERATED_ONLY=1` measurement mode was added and keeps
    generated-Wasm eligible blocks enabled while routing generated-unsupported
    blocks straight back to normal TCI. The rebuilt non-debug artifact hashes
    were `qemu-system-x86_64.js`
    `d08902173814be81e8783530e3537177b96fba6267ef01734de5d13b65a040d5`
    and `qemu-system-x86_64.wasm`
    `00cd2b141d965607e4836880d4ac8f17014d9178e9115f85466026ba0f1b03a0`.
    Generic Chromium smoke with the subset disabled reached
    `QEMU_WASM_LINUX_BOOT_OK` in `100787` ms
    (`/tmp/qemu-wasm-generated-only-isolation/generic-browser-smoke-default.json`).
    The current subset reached the same marker in `117284` ms
    (`/tmp/qemu-wasm-generated-only-isolation/generic-browser-smoke-subset.json`).
    Generated-only isolation reached the marker in `110353` ms
    (`/tmp/qemu-wasm-generated-only-isolation/generic-browser-smoke-generated-only.json`)
    with `generated_compiled=3`, `generated_executed=1979`,
    `generated_cache_hits=1976`, and `generated_compile_failed=0`. The
    generated path executes correctly, but it does not beat default TCI and
    should remain measurement tooling until a different architecture can
    remove the per-block generated-module overhead.
  - [x] Re-baseline Bus Engine OS `virtual-server` with the current non-debug
    QEMU/WASM artifact before selecting the next optimization:
    DoD is a Chromium run using the accepted Bus Engine OS `virtual-server`
    kernel/rootfs fixture and the current QEMU artifact that records kernel
    boot milestones, systemd service progress, idle/heartbeat state, rootfs
    device mode, browser/QEMU attribution summaries, artifact hashes, and final
    timeout or readiness state. The next implementation item must name the
    measured QEMU-side bottleneck from this run before adding another CPU or
    device optimization.
    Accepted evidence on 2026-07-02: the current non-debug artifact
    `/tmp/qemu-wasm-generated-only-isolation/qemu-system-x86_64.js`
    (`d08902173814be81e8783530e3537177b96fba6267ef01734de5d13b65a040d5`)
    and `qemu-system-x86_64.wasm`
    (`00cd2b141d965607e4836880d4ac8f17014d9178e9115f85466026ba0f1b03a0`)
    still failed the accepted Bus Engine OS `virtual-server` proof in Chromium
    `149.0.7827.55`. The `microvm,acpi=off` run using kernel
    `3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920`
    and rootfs
    `5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e`
    wrote
    `/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-baseline.json`,
    reached kernel `53157` ms, `/dev/vda` `74801` ms, rootfs `95878` ms,
    init `97268` ms, hostname `109431` ms, then idled until timeout at
    `290450` ms. Adding `virtio-rng-device` wrote
    `/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-rng-baseline.json`
    and did not change the failure shape: hostname at `108412` ms, timeout at
    `290448` ms. The PC/virtio-pci comparison with kernel
    `cdf8945cfc3cef3bcefbc78fe4b82a4b07af0d04da1ac48a8a0013a27899ee0d`
    wrote
    `/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-pc-baseline.json`
    and also idled after hostname, with `/dev/vda` at `130119` ms, rootfs at
    `141655` ms, init at `143414` ms, hostname at `158334` ms, and timeout at
    `340481` ms. A follow-up `microvm` run with hot-block flags wrote
    `/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-rng-hotblocks.json`
    and reproduced the same idle after hostname at `106328` ms, but recorded
    `summaryCount=0` because this production-shaped artifact does not include
    the opt-in hot-block instrumentation path. The current measured failure is
    therefore stable post-hostname silence across microvm, PC, and virtio RNG;
    the next task must improve current-path progress visibility before another
    optimization can be accepted.
  - [ ] Add focused post-hostname progress visibility for the default
    production-shaped browser path:
    DoD is a generic QEMU-side or harness-side diagnostic that works with the
    non-debug artifact and distinguishes "guest CPU still making progress" from
    "guest waiting for an interrupt, timer, block, serial, or virtio event"
    during the silence after `systemd[1]: Hostname set to <bus-engine-os>.`.
    The diagnostic must not require broad systemd console debug arguments that
    change guest behavior, and it must produce machine-readable JSON evidence
    on the accepted Bus Engine OS `virtual-server` fixture before another
    acceleration patch is selected.
  - [x] Resolve the hot TB dispatch/chaining boundary:
    DoD is a design and implementation for hot blocks that currently fall
    back on `goto_ptr` and `goto_tb`, preserving QEMU's `tcg_qemu_tb_exec`
    return-value contract and direct-TB chaining semantics. The accepted path
    may extend the live subset with a safe terminal dispatch boundary, move to
    the generated-block dispatcher model, or prove with measurements that a
    different QEMU-side boundary has become dominant. It must keep generic
    Chromium smoke passing and record nonzero execution counters without
    treating raw linked-TB code pointers as `exit_tb` return values.
    Accepted evidence on 2026-07-01: the opt-in subset now returns an internal
    dispatch status for `goto_tb` and `goto_ptr`, lets `tcg_qemu_tb_exec`
    continue at the linked TB internally, and keeps raw linked-TB code
    pointers out of the outer `exit_tb` return contract. The same slice added
    existing TCI semantics for `tci_movcond32`, `tci_rotl32`, `tci_rotr32`,
    `rotl`, and `rotr`. The rebuilt wasm64 artifact hashes were
    `qemu-system-x86_64.js=dedd3fe899335ade5f5b1b571c28f144d26a3f0fb7f8fe61e07133bd244908e9`
    and
    `qemu-system-x86_64.wasm=98f615687766cfb27477af6e6a0d989084d92987dea509dd1dd0faf888c7ed09`.
    Default generic Chromium smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-dispatch-ops-default.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` in `80039` ms with the subset disabled.
    Generic Chromium smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-dispatch-ops.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` with `attempts=72000000`,
    `executed=56973162`, `fallback_cold=6444667`, and
    `fallback_unsupported=8577811`; the only top unsupported op was
    `brcond`.
  - [ ] Add side-effect-safe `brcond` support for hot subset blocks:
    DoD is a control-flow validation and execution model that supports the
    measured remaining `brcond` shapes without replaying side effects on
    fallback. The accepted path may support only acyclic branches, may reject
    loops that contain calls or memory stores, or may use a bounded
    side-effect-safe generated-block dispatcher, but it must not restart TCI
    after partially executing side-effectful operations. Generic Chromium
    smoke must pass with nonzero subset counters and the next unsupported
    operation recorded before another Bus Engine OS proof is treated as
    acceptance evidence.
    Rejected evidence on 2026-07-01: a conservative backward-`brcond`
    validator that accepted only reachable side-effect-free loop bodies kept
    generic Chromium smoke passing, but the accepted-safe counter stayed at
    zero. The run
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-brcond-safe.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` with `attempts=72000000`,
    `executed=65063722`, `fallback_unsupported=156066`,
    `brcond_backward_safe=0`, and `brcond_backward_unsafe=1860`; the top
    unsupported operations were `brcond` and `st8`. That shortcut was removed
    rather than committed because it did not accelerate a measured safe loop
    shape. The next valid implementation needs a proper generated-block
    control-flow model for side-effectful loops, or new evidence showing a
    different QEMU-side bottleneck.
    Follow-up rejected evidence on 2026-07-01: a RAM-only `qemu_ld`/`qemu_st`
    fallback experiment used `probe_access()` plus a bounded store journal so
    backward `brcond` loops could roll back local and RAM stores before
    falling back to TCI. The rebuilt artifact hashes were
    `qemu-system-x86_64.js=abcdad6c42b0c384b18e5c1cb932ca2a61161c67a2e7beb1fb2c47338a94676a`
    and
    `qemu-system-x86_64.wasm=a842e329148b46717692c93134d04a3eb97c2eb16d02dbe3fc129f0fda43b688`.
    Generic Chromium smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-store-journal-qemu-ram.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` in `90688` ms with
    `brcond_backward_safe=4217`, proving that the validation shape can accept
    real loops. The default path with the same artifact reached the marker in
    `85201` ms, and a threshold-`1` generic run
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-store-journal-qemu-ram-threshold1.json`
    reached the marker in `95473` ms with `fallback_cold=0`. The downstream
    Bus Engine OS proof
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-store-journal-qemu-ram.json`
    still timed out after `420228` ms before multi-user readiness with
    `brcond_backward_safe=4304`, `fallback_cold=66385502`, and
    `fallback_unsupported=24048`. The accepted conclusion is that this C
    interpreter replay path is diagnostic evidence, not the performance
    solution. It should not be merged as the current acceleration slice.
    Follow-up rejected evidence on 2026-07-01: a generated-Wasm
    branch-to-terminal experiment accepted only forward `brcond` targets that
    resolved to an in-block `exit_tb` or `goto_tb`, emitted an early Wasm
    `return`, and rejected every other branch shape before execution. Generic
    Chromium smoke passed, but the subset run was slower than the same-artifact
    default run (`104833` ms versus `95502` ms in Chromium `149.0.7827.55`).
    Generated counters still showed `ld32u` as the dominant generated fallback
    (`854356`) and did not make the generated path a performance win. Do not
    promote this narrow branch-to-terminal generated path without new evidence.
    Follow-up rejected evidence on 2026-07-02: an opt-in adjacent
    `tci_setcond32` plus `brcond` C interpreter fusion preserved the
    `tci_setcond32` destination register, skipped only the immediately
    following branch dispatch when the branch source register matched, and
    otherwise fell back to normal TCI. The rebuilt artifact hashes were
    `qemu-system-x86_64.js=9167e1c7dc95b99c4da48210f22fa0c55dfb8a4a14ddcbf0e03239dc91561911`
    and
    `qemu-system-x86_64.wasm=dc922919841e83a438f523caf42ce0413eb75395b2b83ba453e2a2fa81e123f4`.
    Default Chromium `149.0.7827.55` smoke reached `QEMU_WASM_LINUX_BOOT_OK`
    in `87638` ms. The fused path with a practical summary interval reached
    the same marker in `91578` ms with `attempts=72400000`,
    `executed=72399999`, and `reg_mismatch=0`. A summary-interval-`1`
    diagnostic timed out from excessive logging after proving the path active
    with `2481138` attempts and `2481137` executions. The patch was removed:
    this hot pattern exists, but single-op C interpreter fusion does not beat
    default TCI. Do not spend more work on narrow adjacent-op interpreter
    peepholes unless a measurement first shows they can improve the generic
    Chromium smoke gate.
    Current decision: do not keep expanding generated `brcond` or memory
    helper coverage from opcode availability alone. Each accepted CPU
    acceleration patch must first improve the generic Chromium smoke or
    provide stronger attribution that the generic-smoke slowdown is irrelevant
    to the Bus Engine OS boot path.
  - [x] Raise the opt-in TCI subset validation window to the measured useful
    maximum: DoD is a rebuilt wasm64 artifact where the default
    `QEMU_TCI_WASM_SUBSET_MAX_OPS` and browser harness default are `512`,
    generic Chromium smoke passes with and without `--tci-wasm-subset`, and
    the downstream Bus Engine OS proof records whether the wider window
    materially changes fallback coverage or readiness. Accepted evidence on
    2026-07-01: rebuilt artifact hashes
    `qemu-system-x86_64.js=700ae01fe2a06ce86cdd7989556245dc664c5cdf83ba0755b4af11f23399ba66`
    and
    `qemu-system-x86_64.wasm=de11a3fed950420dfc1871bbca88e5a27b667505ab83e08474fe09373f546703`.
    Default generic Chromium smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-max512-default.json`
    reached `QEMU_WASM_LINUX_BOOT_OK` in `81626` ms. Subset generic Chromium
    smoke
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-max512-default.json`
    reached the same marker in `86959` ms with `attempts=72000000`,
    `executed=65159611`, `fallback_cold=6680304`,
    `fallback_unsupported=147287`, and top unsupported op `brcond`. The wider
    window is accepted because it reduces unsupported fallback by orders of
    magnitude compared with the previous `64`-op default, while remaining
    opt-in behind `--tci-wasm-subset`.
- [ ] Prove the acceleration improves the real downstream boot path:
  DoD is a Chrome/Chromium Bus Engine OS `virtual-server` browser run with the
  acceleration enabled that reaches normal multi-user/service readiness, or
  shows a measured and material marker-to-marker improvement plus a concrete
  remaining QEMU bottleneck promoted into this plan before any goal closeout.
  The proof must include result JSON, screenshot, artifact hashes, elapsed
  timing, fallback counters, and a comparison against the current baseline.
  Current evidence on 2026-07-01: the opt-in live TCI subset proof with
  terminal TB dispatch still timed out before
  `Reached target Multi-User System.` and `QEMU_WASM_SERVICE_READY`, but the
  measured QEMU-side blocker moved. The final downstream result
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-dispatch-ops.json`
  ran for `420237` ms and recorded `attempts=236000000`,
  `executed=152524448`, `fallback_cold=64768794`,
  `fallback_unsupported=18694499`, and `max_ops_rejected=0`; the only top
  unsupported op was `brcond`. The acceleration proof is still incomplete
  because the guest did not reach multi-user/service readiness, but the next
  active QEMU work item is now side-effect-safe `brcond` support rather than
  `goto_tb`/`goto_ptr`, OPFS, networking, display, input, or WebCrypto.
  Follow-up evidence with the accepted `512`-op default:
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-max512-default.json`
  still timed out after `420333` ms before multi-user/service readiness. It
  reached the Linux kernel and progressed into early systemd, with last line
  `systemd[1]: Load Kernel Module fuse skipped, unmet condition check ConditionKernelModuleLoaded=!fuse`.
  Final subset counters were `attempts=241000000`, `executed=174939800`,
  `fallback_cold=65979484`, `fallback_unsupported=73921`,
  `brcond_bad_target=700`, `brcond_backward=5479`, and top unsupported op
  `brcond`. This is material fallback-coverage improvement, but not the
  required boot-readiness solution; the goal remains open.
  Follow-up RAM-only store-journal evidence accepted thousands of backward
  branches as replay-safe but still timed out before multi-user readiness:
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-store-journal-qemu-ram.json`
  ran for `420228` ms with `executed=173584564`, `fallback_cold=66385502`,
  `fallback_unsupported=24048`, `brcond_backward_safe=4304`, and
  `brcond_backward_unsafe=20`. The run reached early systemd mount setup but
  not `Reached target Multi-User System.` or `QEMU_WASM_SERVICE_READY`.
  This rejects committing the C replay-journal experiment as the performance
  fix. The next implementation must either produce actual generated
  WebAssembly execution for hot TBs, or add fresh attribution proving a
  different QEMU-side boundary has become dominant.
- [x] Refresh current bottleneck attribution after rejected generated-execution
  and compiler-flag experiments:
  DoD is a current Chromium Bus Engine OS `virtual-server` run, using the
  latest accepted QEMU artifact and the same accepted downstream kernel/rootfs
  fixture, that records marker timing, final guest progress, hot-block or
  lightweight execution counters, and device/backend attribution. The result
  must explicitly decide whether the next implementation is a generated
  WebAssembly execution slice that can plausibly improve runtime, a
  paravirtual/browser API backend behind an existing QEMU device boundary, or
  a downstream guest-profile issue that must be handed off before more QEMU
  optimization. Do not implement another acceleration patch from opcode
  coverage alone.
  Current evidence on 2026-07-01: two refreshed Chromium runs used accepted
  artifact hashes
  `qemu-system-x86_64.js=700ae01fe2a06ce86cdd7989556245dc664c5cdf83ba0755b4af11f23399ba66`
  and
  `qemu-system-x86_64.wasm=de11a3fed950420dfc1871bbca88e5a27b667505ab83e08474fe09373f546703`,
  downstream kernel
  `3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920`,
  and rootfs
  `5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e`.
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-current-attribution-20260701.json`
  timed out after `420194` ms with last guest line
  `systemd[1]: Load Kernel Module fuse skipped, unmet condition check ConditionKernelModuleLoaded=!fuse`
  and TCI subset counters `attempts=244000000`, `executed=174460225`,
  `fallback_cold=69414765`, `fallback_unsupported=110081`, and top
  unsupported op `brcond`. A second run with a lower performance-attribution
  interval,
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-current-attribution-interval1000-20260701.json`,
  timed out after `420165` ms with last guest line
  `Mountpoint-cache hash table entries: 1024 (order: 1, 8192 bytes, linear)`
  and counters `attempts=110000000`, `executed=98857540`,
  `fallback_cold=483940`, `fallback_unsupported=37461`, and top unsupported
  op `brcond`. Both runs recorded zero performance-attribution summaries, so
  this item remains open: the next proof must use an artifact or interval that
  actually emits device/backend summaries, or explicitly prove that no
  measured device boundary is active before the guest stalls.
  Implementation step in progress: add `qemu_perf_attrib_poll()` with a
  time-based report interval so CPU-bound browser runs can emit attribution
  summaries even when device event counts stay below the event interval and
  QEMU does not exit before the harness timeout. The first call site is the
  low-frequency TCI wasm-subset summary path, which is already enabled for
  this proof lane.
  Accepted implementation evidence: rebuilt artifact hashes
  `qemu-system-x86_64.js=f890fb7cb7b6469df6b21ffc0e129a4f2e35d166e2aac34a77a096dd5ce1a412`
  and
  `qemu-system-x86_64.wasm=d869e74146dbd4fe0b89aa6ce1b476dfa7ea0b003175850c6bb2c795a422f0d3`
  passed generic Chromium `149.0.7827.55` smoke
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-perf-time-poll.json`
  and recorded three time-based performance-attribution summaries. The
  downstream Bus Engine OS proof
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-attribution-time-poll-20260701.json`
  still timed out after `420211` ms before multi-user/service readiness, but
  recorded `perfCount=13`. The final attribution summary at QEMU elapsed
  `391824` ms reported `events=0`, `virtio_notifies=0`, and zero block, RNG,
  serial, network, display, input, and other device counters. The final TCI
  subset summary reported `attempts=232000000`, `executed=231826121`,
  `fallback_cold=147870`, `fallback_unsupported=12026`, top unsupported op
  `brcond`, and generated fallbacks `ld32u=18058` plus `st8=16`. This closes
  the attribution gap: current evidence says the next implementation remains
  CPU execution acceleration, not OPFS, networking, graphics, input, WebCrypto,
  or another device/browser backend.
  Proof-harness hygiene in progress: keep `--rootfs-storage opfs-snapshot`
  validation ahead of the generic initrd/rootfs requirement so bad storage
  arguments fail with the actionable OPFS rootfs error before long browser
  proof setup.
- [x] Add marker-to-marker Bus Engine OS boot timing before another
  acceleration patch:
  DoD is browser smoke harness support that records first-seen elapsed times
  for guest boot milestones even when the run times out, including kernel
  version, root block device discovery, root filesystem mount, init/systemd
  start, hostname, journald, udev, basic target, multi-user target, login
  prompt, and service readiness marker. Result JSON and summaries must expose
  both ordered milestone entries and lookup-by-id data. The next Bus Engine OS
  proof must compare these milestones against the current 420 second timeout
  baseline before accepting any speedup or regression claim.
  Accepted evidence on 2026-07-01: the milestone harness wrote first-seen
  entries under `bootMilestones.entries` plus lookup data under
  `bootMilestones.byId`. Three Chromium `149.0.7827.55` runs used artifact
  hashes `qemu-system-x86_64.js=d2f298574e0b504cb497582121c660a1180247b6f74ba2b675ad5e3731bc2cb3`
  and
  `qemu-system-x86_64.wasm=9753379b4acc70b597a2ba8e893993a9b1eea0450792a1fd1dae51cd1a31d750`.
  The strict TCI/no-subset run
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-milestones-nosubset-20260701.json`
  timed out after `420212` ms, reached kernel at `50379` ms,
  `/dev/vda` at `73455` ms, rootfs mount at `91960` ms, init at `93323` ms,
  hostname at `104290` ms, udev socket at `341751` ms, and journald start at
  `392463` ms. The opt-in subset run
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-milestones-20260701.json`
  timed out after `420218` ms and reached the same milestones later:
  kernel `51991` ms, `/dev/vda` `78095` ms, rootfs `99131` ms, init
  `100719` ms, hostname `112798` ms, udev `368029` ms, and journald
  `419497` ms. The threshold-`1` subset run
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-milestones-threshold1-20260701.json`
  was worse, reaching only hostname by `181391` ms and ending at
  `systemd[1]: Freezing execution.` before timeout. Current conclusion:
  the opt-in generated/subset path is useful instrumentation but is not an
  accepted performance fix. The real boot delay is between systemd hostname
  setup and early udev/journald progress, and strict TCI remains the fastest
  measured execution path for this Bus Engine OS fixture.
- [x] Measure the full strict-TCI Bus Engine OS readiness time before another
  acceleration patch:
  DoD is a long Chromium run using the same accepted Bus Engine OS
  `virtual-server` microvm kernel/rootfs fixture with the TCI wasm subset
  disabled, a timeout high enough to determine whether the guest reaches
  `Reached target Multi-User System.` or `QEMU_WASM_SERVICE_READY`, and
  result JSON plus screenshot recording milestone timings, final serial
  marker, elapsed readiness time or the next observed blocker. This measurement
  defines the concrete speed target for the next QEMU performance patch. If
  strict TCI still fails to reach readiness within the extended run, the next
  plan item must be a root-cause diagnostic for the last guest phase rather
  than another generated-opcode coverage experiment.
  Accepted evidence on 2026-07-01: strict TCI long-run proof
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-strict-tci-long-20260701.json`
  timed out after `900211` ms in Chromium `149.0.7827.55` with no
  `Reached target Multi-User System.` and no `QEMU_WASM_SERVICE_READY`.
  Milestones were kernel `50102` ms, `/dev/vda` `74689` ms, rootfs mount
  `94953` ms, init `96404` ms, hostname `108319` ms, udev socket `348413` ms,
  and journald start `397506` ms. The final guest line was
  `systemd-journald[75]: Received client request to flush runtime journal.`
  and progress samples showed no further guest output through the final
  `900218` ms sample. This proves the current fixture does not merely boot
  later than 420 seconds; it fails to reach multi-user within 15 minutes and
  needs a guest-phase diagnostic before more opcode-coverage work.
- [x] Diagnose the post-journald guest stall under strict TCI:
  DoD is a Chromium run using the same accepted Bus Engine OS fixture with
  strict TCI, systemd/kernel console diagnostics enabled through guest command
  line only, and a bounded guest-idle timeout after systemd starts. The result
  must identify the last active unit, mount, service, syscall-visible phase, or
  timer/clock symptom after `systemd-journald` flushes the runtime journal. If
  the diagnostic still cannot name the guest phase, add the smallest QEMU
  generic trace point or harness extraction needed to distinguish CPU-bound
  progress from a missing interrupt, timer, block, serial, or virtio event.
  Current evidence on 2026-07-01: broad systemd console-debug arguments were
  rejected as a diagnostic shape because they changed behavior and the guest
  idled immediately after `Run /sbin/init as init process`. A focused strict
  TCI run that masked only `systemd-journal-flush.service` wrote
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-strict-tci-mask-journal-flush-20260701.json`
  and timed out after `600217` ms; it got past the previous journal-flush
  final line and ended at
  `systemd[1]: systemd-hwdb-update.service: Consumed 15.668s CPU time over 1min 27.096s wall clock time, 1.3M memory peak.`
  A second strict TCI run masking both `systemd-journal-flush.service` and
  `systemd-hwdb-update.service` wrote
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-strict-tci-mask-journal-hwdb-20260701.json`
  and still timed out after `600197` ms, ending at
  `systemd[1]: Listening on System Extension Image Management.`. This points
  to normal guest boot workload under very slow browser-hosted TCI, with
  journal flush, hwdb update, and sysext-related startup as visible milestones.
  The next accepted work should either add a downstream browser-hosted Engine
  OS boot profile that prebuilds or disables unnecessary one-shot preparation
  services, or implement a QEMU CPU execution improvement with evidence that
  it beats strict TCI on these milestones.
- [x] Build and measure an O3/LTO/no-debug-info wasm64 TCI artifact:
  DoD is a wasm64 `x86_64-softmmu` artifact built with the previously
  fastest measured compiler shape, Meson `-Doptimization=3` plus LTO where
  Emscripten accepts it, while keeping the accepted no-debug-info and QOM
  cast-debug-off settings. Generic Chromium smoke must pass and beat the
  current strict-TCI generic baseline before a long Bus Engine OS proof is run.
  If generic smoke regresses or only matches strict TCI, record the rejection
  and return to proper generated-block execution work instead of spending a
  10-15 minute downstream proof on a weak compiler-flag result.

  Rejected evidence on 2026-07-01: the artifact built successfully with
  Meson `-Doptimization=3`, `--enable-lto`, `--disable-debug-info`, and
  `--disable-qom-cast-debug`. It produced `qemu-system-x86_64.js` SHA-256
  `ba64e96e2b1422a38e5c03142995e1896217b1ec33b0cb0cb7fa1327af67ec4a`
  and `qemu-system-x86_64.wasm` SHA-256
  `a5e36ff9cd8d831bee410b1d9e504956553a541e9662480b597ca982f630bb84`.
  Generic Chromium `149.0.7827.55` smoke wrote
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-o3-lto-nodebug.json`
  and reached `QEMU_WASM_LINUX_BOOT_OK` in `101664` ms, which is slower than
  the current strict-TCI generic baseline around `81626` ms. No Bus Engine OS
  long proof was run because the cheap gate regressed. Compiler flag tuning is
  rejected for this goal unless new profiling evidence identifies a specific
  compiler/runtime bottleneck.
- [x] Add a translation-block cache design and tests once the first generated
  blocks exist: DoD is a documented cache key, invalidation rule,
  memory-pressure behavior, browser-module lifetime policy, and deterministic
  tests for cache hit, miss, flush, stale-block rejection, and fallback to TCI.

  Accepted evidence on 2026-07-01: the opt-in generated-block path now keys
  generated module entries by TCI bytecode pointer plus a 64-bit signature of
  the current bytecode and terminal target, bounds browser module lifetime with
  a 4096-entry FIFO eviction cap, recompiles stale pointer/signature entries,
  and reports `generated_cache_hits` plus `generated_cache_stale` in the
  existing subset summary. Deterministic Node tests in
  `scripts/ci/wasm-generated-block-prototype-test.mjs` cover cache hit, miss,
  stale replacement, eviction, invalid keys, invalid signatures, and missing
  compile callbacks. The rebuilt wasm64 artifact
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/cache-signature` produced
  `qemu-system-x86_64.js` SHA-256
  `14cdafd3e03999d458b64c8afa5200d656fd512f26741e2b09058b2bc6581ef1`
  and `qemu-system-x86_64.wasm` SHA-256
  `4810087084f0d1ad3fa32752675deb4d871e03344b9caa2e359bfc16e2af66e0`.
  Generic Chromium `149.0.7827.55` default smoke reached
  `QEMU_WASM_LINUX_BOOT_OK` in `94207` ms
  (`generic-browser-smoke-cache-signature-default.json`). The opt-in subset
  smoke reached the same marker in `96794` ms
  (`generic-browser-smoke-cache-signature-subset.json`) with
  `generated_compiled=3`, `generated_executed=2394`,
  `generated_cache_hits=2391`, `generated_cache_stale=0`, and dominant
  generated fallback still `ld32u`. This is accepted as cache correctness and
  observability foundation, not as the performance fix; no Bus Engine OS long
  proof was run because the generic opt-in gate remained slower than default.
- [ ] Start the proper native wasm64 TCG prototype with direct block return
  semantics: DoD is a small opt-in generated-block path that avoids the
  per-operation JavaScript helper model, compiles only a documented integer
  ALU plus terminal branch subset, records compile/execute/fallback counters,
  preserves strict TCI fallback for unsupported or invalid blocks, and proves
  generic Chromium smoke does not regress before any Bus Engine OS long proof
  is attempted.
  - [x] Add C-side generated-block prevalidation before entering JavaScript:
    DoD is a content-aware TB signature for the opt-in generated path, stale
    unsupported decisions cleared when the same TCI bytecode pointer receives
    different contents, unsupported generated opcodes rejected in C before
    `EM_JS` module compilation/execution, strict TCI fallback preserved, a
    successful wasm64 `x86_64-softmmu` build, and generic Chromium default plus
    opt-in smoke evidence showing whether the reduced JavaScript crossing
    improves or regresses the measured boot marker.
    Rejected performance evidence on 2026-07-01: the implementation compiled
    and linked through `scripts/ci/wasm-build-artifacts-local.py` into
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-prevalidate`.
    Artifact SHA-256 values were
    `qemu-system-x86_64.js=14cdafd3e03999d458b64c8afa5200d656fd512f26741e2b09058b2bc6581ef1`
    and
    `qemu-system-x86_64.wasm=74128a37de5ff666f95fc0413fd5fdae47c66f91f47348c68cb0b89be80ce450`.
    Generic Chromium `141.0.7390.37` smoke with the default path reached
    `QEMU_WASM_LINUX_BOOT_OK` in `81611` ms
    (`generic-browser-smoke-generated-prevalidate-default.json`). The same
    smoke with `--tci-wasm-subset` reached the marker in `90736` ms
    (`generic-browser-smoke-generated-prevalidate-subset.json`) with
    `generated_compiled=4`, `generated_executed=16774`,
    `generated_cache_hits=16770`, `generated_compile_failed=0`, and remaining
    generated fallbacks `ld32u=2431` plus `st8=1`. This proves the C-side
    prevalidation is safe and observable, but it is slower than default and is
    not the Bus Engine OS performance solution. Do not run a Bus Engine OS long
    proof from this patch unless a later generic gate first shows an actual
    speedup.
  Accepted prototype evidence on 2026-07-01: the standalone generated-block
  prototype now includes a context-pointer ABI modeled on a native TB
  function boundary. The generated module imports linear memory, accepts one
  context pointer, reads two 64-bit register slots, stores a 64-bit return
  slot, and returns a packed TB-dispatch value without using many BigInt
  parameters or result arrays. This does not alter live QEMU execution yet.
  Node.js `v22.19.0` proof
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-context-node.json`
  passed with `moduleBytes=399`, `contextBlockResult=21474836522`, and
  `contextBlockStored=42`. Chromium `141.0.7390.37` proof
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-context-browser.json`
  passed with the same context result and stored value. The next implementation
  step is to move this ABI into a QEMU-side opt-in TB function boundary or
  wasm64 backend skeleton while preserving strict TCI fallback; a standalone
  prototype alone is not the Bus Engine OS performance fix.
  Rejected evidence on 2026-07-01: an opt-in direct register-memory ABI was
  tested so generated blocks imported QEMU's shared wasm64 memory and accepted
  only `(regsPtr, retPtr) -> i32`, avoiding the previous BigInt argument/result
  array crossing for every generated block. The rebuilt artifact
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-reg-memory` produced
  `qemu-system-x86_64.js` SHA-256
  `89e592ef6362274edca161ff27022119de381f6af97b4b5ec74e189c360014e2` and
  `qemu-system-x86_64.wasm` SHA-256
  `9519be1f6e0abb732c28578962d6df80590df01140b55ba9eb2b61bf5e5e7bb1`.
  Default Chromium `149.0.7827.55` smoke reached
  `QEMU_WASM_LINUX_BOOT_OK` in `95836` ms. The opt-in subset smoke reached the
  same marker in `97142` ms with `generated_compiled=3`,
  `generated_executed=1528`, and `generated_cache_hits=1525`; dominant
  generated fallback was still `ld32u`. This proved the direct register-memory
  ABI, but it did not improve wall-clock time, so no Bus Engine OS long proof
  was run.
  Rejected follow-up evidence on 2026-07-01: extending that direct-memory ABI
  to generated `ld32u` and `st8` produced artifact
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-reg-memory-ld32u` with
  `qemu-system-x86_64.js` SHA-256
  `23bcb1c1fd1876426a03061404798f499b7e14d878ff65770ed7ad383a92a991` and
  `qemu-system-x86_64.wasm` SHA-256
  `32f57a5aec19db059c42e7f4102473c59511c98303fe7ca117b8a4bdf77af650`.
  Two default Chromium smoke runs timed out after `240000` ms with
  `page.evaluate: Target crashed` before guest boot milestones were reported.
  Because default execution must remain stable even when the opt-in subset is
  disabled, the `ld32u`/`st8` patch was rejected and removed. The next native
  wasm64 TCG attempt must first preserve the default generic Chromium gate,
  then prove an opt-in speedup on the generic smoke before any downstream Bus
  Engine OS proof is meaningful.
  - [x] Move live generated execution to a direct C-callable TB function
    boundary:
    DoD is an opt-in generated-block path that compiles each accepted
    register-only TCI block into a WebAssembly function once, stores the
    Emscripten function-table pointer in the C-side TB cache entry, calls it
    directly from C with a single context pointer, avoids the previous
    per-execution `EM_JS` helper call and BigInt argument/result arrays,
    preserves strict TCI fallback for unsupported or invalid blocks, keeps the
    default generic Chromium Linux smoke passing, and proves whether the
    opt-in generic Chromium smoke improves before any downstream Bus Engine OS
    long proof is attempted.
    Rejected performance evidence on 2026-07-01: the implementation compiled
    through `scripts/ci/wasm-build-artifacts-local.py` into
    `/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-tb-func`. Artifact
    SHA-256 values were
    `qemu-system-x86_64.js=2d06ef25db9698c4815ec274f67c450db7fc4c73ff982e1bd746a36eebf1ef84`
    and
    `qemu-system-x86_64.wasm=b167b063c5345d33cf3ebb8a0347f2bde611d6458bb5fc1c73bbff5f8f9a4d10`.
    Generic Chromium `141.0.7390.37` default smoke reached
    `QEMU_WASM_LINUX_BOOT_OK` in `78079` ms
    (`generic-browser-smoke-direct-tb-func-default.json`). The opt-in subset
    smoke reached the same marker in `90199` ms
    (`generic-browser-smoke-direct-tb-func-subset.json`) with
    `generated_compiled=6`, `generated_executed=14501`,
    `generated_cache_hits=14495`, `generated_compile_failed=0`, and remaining
    generated fallbacks `ld32u=2538` plus `st8=1`. This proves the direct
    C-callable generated-block function-table boundary works and keeps strict
    fallback, but it is slower than default and is not the Bus Engine OS
    performance solution. No Bus Engine OS long proof is justified from this
    artifact.
  - [x] Stop expanding the tiny live TCI-subset path unless new evidence
    predicts a real speedup:
    DoD is a short implementation note that compares the accepted generated
    execution coverage against total TCI/subset attempts, explains why
    register-only or narrow memory/branch additions have not beaten strict TCI
    in Chromium, and selects the next QEMU-side performance implementation
    from measured evidence. If the selected direction remains CPU execution,
    it must move toward a real generated-block/backend shape with broader
    block coverage and dispatch semantics instead of another isolated opcode
    shortcut. If a fresh measurement points to a device/backend boundary, the
    next patch must sit behind that QEMU boundary.
    Accepted decision evidence on 2026-07-01: the direct C-callable
    generated-block proof compiled and executed generated functions but covered
    only `17040` generated attempts out of `72400000` subset attempts
    (`0.0235%`) and only `14501` generated executions out of `53808998`
    executed subset blocks (`0.0269%`) in generic Chromium smoke. The first
    live generated-WASM slice covered more Bus Engine OS work
    (`generated_executed=1301928`) but still timed out before multi-user
    readiness and left `ld32u` as the dominant generated fallback with
    `5018171` classifications. Later memory, branch, direct register-memory,
    and direct C-callable variants all kept the default path safe but failed
    the generic speed gate. The accepted conclusion is that isolated TCI
    opcode shortcuts do not cover enough hot execution to beat strict TCI.
    The next CPU patch must use a broader generated-block or backend-shaped
    execution model instead of another narrow TCI-subset expansion.
  - [ ] Implement the next broad generated-block/backend slice only after a
    coverage gate predicts a win:
    DoD is an opt-in wasm64 execution path that covers a measured hot block
    family including the memory and control-flow shapes that keep rejecting
    the tiny subset path, preserves strict TCI fallback for unsupported or
    faulting blocks, records generated coverage and wall-clock timing, passes
    default generic Chromium smoke, passes opt-in generic Chromium smoke with
    nonzero generated counters, and beats the current strict-TCI generic smoke
    gate before any Bus Engine OS long proof is started. If this gate does not
    beat strict TCI, record it as rejected evidence and pick a different
    measured implementation direction.
    - [x] Add a machine-readable hot-block coverage gate:
      DoD is a deterministic helper that reads browser smoke result JSON,
      extracts the latest `qemu-tcg-hotblocks` summary, compares measured
      `top_tci_ops` against a named lowering profile, reports supported and
      unsupported top-op counts, and fails when the selected profile does not
      meet a configured minimum ratio. Accepted implementation on 2026-07-02:
      `scripts/ci/wasm-tcg-coverage-gate.mjs` provides `deterministic` and
      `planned-hotblock` profiles. The deterministic profile tracks the
      executable backend-shaped lowering probe; the planned-hotblock profile
      tracks the broader operation family from the recorded Bus Engine OS hot
      block evidence (`tci_movi`, `st`, `ld`, `add`, `brcond`, `mb`, related
      load/store, set-condition, and QEMU load/store operations). Verification:
      `node --check scripts/ci/wasm-tcg-coverage-gate.mjs`, `node --check
      scripts/ci/wasm-tcg-coverage-gate-test.mjs`, and `node
      scripts/ci/wasm-tcg-coverage-gate-test.mjs` passed. This is a planning
      and proof gate, not a performance fix.
      Follow-up tightening on 2026-07-02: the helper supports repeated
      `--require-op` arguments so a proof can require individual measured hot
      operations such as `ld`, `st`, `mb`, and `tci_setcond32`, even if the
      aggregate supported ratio would otherwise pass. The result JSON reports
      `requiredOps`, `missingRequiredOps`, and fails the gate when any required
      operation is missing. Verification: `node --check
      scripts/ci/wasm-tcg-coverage-gate.mjs`, `node --check
      scripts/ci/wasm-tcg-coverage-gate-test.mjs`, and `node
      scripts/ci/wasm-tcg-coverage-gate-test.mjs` passed.
    - [x] Inspect the `ktock/qemu-wasm` `origin/wasm64-tcg-b` backend
      architecture without copying it wholesale:
      DoD is a short note naming the reference files, the runtime boundary,
      and the pieces that are useful for an upstreamable BusDK/QEMU branch.
      Accepted evidence on 2026-07-01: the reference branch adds
      `tcg/wasm64.c`, `tcg/wasm64.h`, and `tcg/wasm64/tcg-target.c.inc`
      selected from `tcg/meson.build` on Emscripten when TCI is not selected.
      Its execution boundary is a `WasmContext *` passed to an instantiated
      TB function, with a `WasmTBHeader` storing TCI bytes, generated wasm
      bytes, helper import vectors, per-thread execution counters, and
      per-thread instance records. The runtime interprets cold TBs through a
      forked TCI path, instantiates hot TBs after a threshold, calls generated
      TBs through the function table, and evicts old instances with
      `removeFunction()` plus browser GC tracking. Useful upstreamable pieces
      are the context/TB-header boundary, per-thread thresholding, helper
      import table, memory64-aware load/store emission, label/block patching,
      and strict fallback model; the fork-specific monolithic TCI copy and
      wholesale backend import should not be copied directly.
    - [x] Add a gated `tcg/wasm64` backend skeleton without instruction
      lowering:
      DoD is build plumbing and empty backend files that can be selected only
      by an explicit experimental Emscripten/wasm64 option, carries the
      context/TB-header types and instance-lifetime plan, fails closed or
      falls back to TCI when no lowering is available, and keeps the existing
      TCI wasm64 build and generic Chromium smoke path unchanged.
      Accepted implementation on 2026-07-02: Meson now exposes
      `tcg_wasm64_backend=false` as an explicit experimental option. On a
      wasm64 host, selecting it is mutually exclusive with `tcg_interpreter`
      and fails closed with a configure error because no lowering exists yet.
      The default wasm64 rule still requires TCI. The skeleton adds
      `tcg/wasm64.h` and `tcg/wasm64.c` for the context/TB-header/instance
      boundary, plus `tcg/wasm64/` target include files. The target source
      contains an intentional compile-time fail-closed guard if it is included
      before lowering exists. This commit does not make the backend runnable
      and does not alter the default TCI execution path. Verification:
      `_meson_option_parse --enable-tcg-wasm64-backend` emits
      `-Dtcg_wasm64_backend=true`; `python3
      scripts/ci/wasm-build-artifacts-local.py --out
      /tmp/qemu-wasm64-backend-skeleton-guard --jobs 1
      --configure-arg=--enable-tcg-wasm64-backend` fails during Meson setup
      with `The experimental wasm64 TCG backend and TCG interpreter are
      mutually exclusive`; `python3
      scripts/ci/wasm-build-artifacts-local.py --out
      /tmp/qemu-wasm64-backend-skeleton-tci --jobs auto` built the default
      wasm64 TCI artifact (`qemu-system-x86_64.wasm`
      `sha256:b167b063c5345d33cf3ebb8a0347f2bde611d6458bb5fc1c73bbff5f8f9a4d10`);
      Chromium 141 browser smoke reached `QEMU_WASM_LINUX_BOOT_OK` in
      `/tmp/qemu-wasm64-backend-skeleton-tci/generic-browser-smoke-default.json`
      at 80436 ms, with kernel banner at 31397 ms and init at 78824 ms.
    - [x] Add deterministic module-emitter tests for the backend skeleton:
      DoD is a host-side test that emits and validates a minimal wasm64 TB
      module with `env.memory`, a `start(ctx)` function, context loads/stores,
      and a helper import table shape, without requiring a full QEMU boot.
      Accepted implementation on 2026-07-02: `scripts/ci/wasm-tb-module-emitter.mjs`
      emits a deterministic 155-byte generated-TB module that imports
      `env.memory`, imports `h.helper0`, imports `h.qemu_ld_i64` and
      `h.qemu_st_i64` fallback boundaries, exports `start`, loads two i64
      context fields, stores their sum, calls the helper import, stores the
      helper result, and returns it. `scripts/ci/wasm-tb-module-emitter-test.mjs`
      validates the module imports/exports and proves `start(ctx)` stores sum
      `42`, calls helper opcode `7` with value `42`, and returns/stores
      dispatch result `25769803818`. Verification: `node --check
      scripts/ci/wasm-tb-module-emitter.mjs`, `node --check
      scripts/ci/wasm-tb-module-emitter-test.mjs`, and `node
      scripts/ci/wasm-tb-module-emitter-test.mjs` passed.
    - [ ] Add the first backend-shaped lowering subset behind the gated
      skeleton:
      DoD is lowering for integer ALU, constant moves, register moves,
      `setcond`, internal labels, terminal exits, and direct host-memory
      loads/stores needed by the measured hot shapes, plus differential tests
      against the existing TCI semantics.
      Partial implementation on 2026-07-02: the deterministic emitter now
      includes an executable lowering-subset spec from a small TB IR into a
      WebAssembly module. The covered operations are `const_i64`, `mov_i64`,
      `ld_ctx_i64`, `st_ctx_i64`, `add_i64`, `xor_i64`, `setcond_i64`
      (`eq`/`ne`), structured `block`, `brcond_i64`, `end_block`,
      `pack_dispatch_i64`, `helper_i64`, and `exit_i64` through the
      `tb-dispatch` boundary. The generated module and a local interpreter
      agree for two control-flow cases: `branch-taken-skip-helper` returns
      `25769803818`, writes context offsets `16=42`, `24=25769803818`,
      `32=1`, and makes no helper call; `branch-not-taken-helper` returns
      `25769803819`, writes offsets `16=43`, `24=25769803819`, `32=0`, and
      makes helper call opcode `7` with value `43`. Verification: `node
      --check scripts/ci/wasm-tb-module-emitter.mjs`, `node --check
      scripts/ci/wasm-tb-module-emitter-test.mjs`, `node
      scripts/ci/wasm-tb-module-emitter-test.mjs`, and `node
      scripts/ci/wasm-tb-module-emitter.mjs` passed. This item remains open
      until C backend integration exists.
      Follow-up partial implementation on 2026-07-02: the deterministic
      emitter now includes direct imported-memory `ld_mem_i64` and
      `st_mem_i64` operations plus a no-op `mb` lowering. The generated and
      interpreted paths agree for both existing branch cases, store and reload
      `0x1122334455667788`, and report `directLoadOps=2`,
      `directStoreOps=2`, and `memoryBarrierOps=2`.
      Follow-up tightening on 2026-07-02 added executable `setcond_i32`
      coverage for the measured `tci_setcond32` family; it verifies 32-bit
      truncation by comparing `0x100000001` with `1` and reports
      `setcond32Ops=2`. The deterministic coverage-gate profile now counts
      measured hot `ld`, `st`, `mb`, and `tci_setcond32` operations because
      this executable differential coverage exists.
      Verification: `node --check scripts/ci/wasm-tb-module-emitter.mjs`,
      `node --check scripts/ci/wasm-tb-module-emitter-test.mjs`, `node
      scripts/ci/wasm-tb-module-emitter-test.mjs`, `node --check
      scripts/ci/wasm-tcg-coverage-gate-test.mjs`, and `node
      scripts/ci/wasm-tcg-coverage-gate-test.mjs` passed.
    - [ ] Add helper-call and guest-memory fallback boundaries before long
      browser proofs:
      DoD is helper import generation for calls that cannot be inlined,
      memory64-aware QEMU load/store helper calls for MMU/fault paths,
      structured counters for generated execution versus fallback, and default
      generic Chromium smoke remaining unchanged.
      Partial implementation on 2026-07-02: the deterministic lowering
      contract now imports `h.qemu_ld_i64` and `h.qemu_st_i64`, passes an i64
      guest address `0x100000000` through those fallback imports, compares the
      generated calls with the local interpreter, and reports structured
      counters: `generatedBlocks=2`, `helperFallbacks=1`,
      `qemuLoadFallbacks=2`, and `qemuStoreFallbacks=2`. The branch-taken and
      branch-not-taken cases both use qemu load/store fallback boundaries and
      match the interpreter. This item remains open until the same fallback
      counters are wired into the C backend and default Chromium smoke is
      re-run from a QEMU artifact.
      Follow-up C boundary on 2026-07-02: `tcg/wasm64.h` now defines
      `TCGWasm64Counters` and `TCGWasm64FallbackReason`, and
      `tcg/wasm64.c` provides reset, add, and fallback-count helpers for
      generated attempts, compiled blocks, executed blocks, cache hits,
      unsupported fallbacks, helper fallbacks, QEMU load/store fallbacks, and
      runtime fallbacks. This is the typed C contract needed before live
      backend integration can report nonzero generated/fallback counters. The
      item remains open until generated helper imports and memory fallback
      calls use these counters in a selectable wasm64 backend artifact.
    - [ ] Run the broad backend generic speed gate:
      DoD is a rebuilt wasm64 artifact, default generic Chromium smoke passing,
      opt-in backend Chromium smoke passing with nonzero generated counters,
      and opt-in wall time faster than the strict-TCI generic baseline before
      any Bus Engine OS long proof is attempted.
    - [x] Preserve the real TCI fallback architecture in the next runnable
      acceleration slice:
      DoD is a short design and build-graph note explaining why strict TCI
      fallback cannot be added by simply enabling `tcg_wasm64_backend` and
      `tcg_interpreter` together. The next runnable slice must either keep
      `tcg_arch=tci` and accelerate selected TCI bytecode blocks with a
      generated WebAssembly side path, or implement a full wasm64 TCG target
      that defines its own precise fallback boundary. Do not merge a Meson
      change that claims fallback while selecting `tcg/wasm64/tcg-target.*`
      and losing the TCI bytecode ABI used by `tcg_qemu_tb_exec`.

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

- [ ] WebCrypto-backed virtio-crypto (cryptodev) slice - gated on offloadable
  crypto trace evidence:
  Status 2026-07-05: guest side is already ready (Bus Engine OS riscv64
  kernel carries CONFIG_CRYPTO_DEV_VIRTIO=y) but no QEMU invocation attaches
  a virtio-crypto device, so the path is unused end to end. The first
  trace-backed crypto stall appeared in the NATIVE boot gate: first-boot
  OpenSSH RSA host-key generation blocks multi-user.target for >100s under
  TCG (serial log shows crng init done early, so entropy is ruled out; this
  is raw CPU cost). That specific class CANNOT be fixed by virtio-crypto:
  the AKCIPHER service offloads encrypt/decrypt/sign/verify with provided
  keys - RSA keypair generation (prime search) is not an offloadable
  operation - and ssh-keygen is userspace OpenSSL, which never enters the
  kernel crypto API by default. Chosen fix for the boot stall lives in Bus
  Engine OS instead: ed25519-only host keys plus non-blocking keygen
  ordering, which carries over to the browser boot automatically.
  Implement this slice only when an attribution run shows guest crypto time
  that IS offloadable: kernel crypto consumers (kTLS, dm-crypt/fscrypt) or
  userspace deliberately routed through AF_ALG/an OpenSSL provider in the
  image profile. Design sketch when triggered: QEMU cryptodev backend
  bridging to browser SubtleCrypto (async Promise completion maps cleanly to
  virtio used-ring completion); SubtleCrypto covers AES/SHA/HMAC/RSA/ECDSA
  and Ed25519 sign/verify in current browsers. DoD: a perf-attribution run
  showing measured guest crypto time replaced by WebCrypto-backed device
  time with a net workload/boot improvement, while the serial marker gate
  still passes; no Bus Engine product logic in upstream QEMU code.

## Deferred x86/W historical accelerator items moved from PLAN.md on 2026-07-07

These unchecked items are useful future accelerator work, but they are not part of the current active RISC-V five-minute Bus Engine OS browser boot goal. The active QEMU PLAN stays focused on the RISC-V lane and final proof/non-regression gates.

- [ ] R4f - Add an x86_64 reuse and gap map before implementing x86_64
    generated execution. DoD: using current `x86_64-softmmu` browser smoke
    evidence or a fresh bounded smoke, record which parts are reusable from
    R4b/R4e and which are x86-specific. The reusable list must include the
    run/exit ABI, counters, browser harness parser, module-instantiation
    path, runtime ratio smoke, no-silent-fallback mode, and same-commit speed
    gate shape. The x86-specific list must include CPU state/register mapping,
    flags and condition-code handling, segmentation/privilege-sensitive state,
    x86 helper exits, x86 TCG op lowering, real x86 SoftMMU/TLB-hit
    load/store lowering, TB chaining/hotset dispatch, and invalidation rules.
    The output must name the first deterministic x86_64 tests to write and
    the first top hot TB/op shapes that would block real generated coverage.
    Started 2026-07-03 from existing evidence only; no code or browser run was
    performed. Reusable from R4b/current x86 evidence: the
    `wasmjit_run(ctx,budget)` run/exit ABI and budget-exit loop shape; runtime
    counters for generated/fallback instruction-equivalent counts, body time,
    C/TCI-like dispatch time, inline TLB-hit loads/stores, helpers, `qemu_ld`,
    `qemu_st`, chain length, compile/instantiate time, and exit reason; the
    browser parser/result JSON paths for `wasm64Runloop` and `wasm64Tcg`
    summaries; the Emscripten module-instantiation path used by the
    same-artifact runtime smoke; the `alu-branch` and `tlb-hit-ram` runtime
    ratio smoke workloads; the strict/no-silent-fallback performance contract;
    and the same-commit default-versus-accelerator Chromium speed-gate shape.
    X86-specific before real generated execution: map `CPUX86State` general
    registers, `eip/rip`, segment bases/limits/selectors, control registers,
    privilege-sensitive state, and lazy flags/condition-code state; define
    helper exits for x86 architectural helpers and side-effectful helpers;
    lower only the measured real x86 TCG op shapes; add real x86 SoftMMU
    TLB-hit load/store lowering for safe RAM hits; preserve exits for misses,
    MMIO, page faults, page-crossing and permission-sensitive cases; attach
    internal TB chaining or hotset dispatch without returning to QEMU per TB;
    and prove generated code cannot outlive TB or address-space invalidation.
    First deterministic tests to write: x86 CPU-state offset/register flush
    fixture; lazy-flags/setcond/brcond equivalence fixture; segmentation and
    privilege-sensitive fallback fixture; x86 helper-exit classification
    fixture; SoftMMU TLB-hit load/store equivalence with miss/MMIO/page-fault
    exits; TB invalidation/stale-code rejection fixture; and same-input
    live-TB differential fixture that records TB identity, `TranslationBlock`
    `icount`, register checksum, memory writes, and dispatch target. Current
    top blockers from R4h/R4i-a evidence are the stable unsupported-op family
    `ld32u=43978` plus `st8=22`, with the first attachable fixture shape
    `ld32u, tci_movi, tci_setcond32, brcond, tci_movi, st8, ld, tci_movi,
    add, st, goto_tb, exit_tb, exit_tb`; `call`-heavy TBs remain fallback
    until a helper-exit design exists. R4f remains open because current x86
    evidence does not record a real hot TB PC/identity plus
    `TranslationBlock.icount` for the `ld32u`-first family; the pre-R4i
    fixture explicitly reports `real_live_state_capture=false`.

- [ ] R4g - Record the current x86_64 baseline and shared accelerator
    contract evidence without accepting it as real x86 acceleration. DoD:
    build current default-TCI and backend-gated `x86_64-softmmu` Emscripten
    artifacts, run the deterministic runloop/parser/contract tests, run the
    opt-in runtime smoke in Chrome/Chromium, verify default x86_64 TCI smoke
    behavior, and explicitly record that real x86 guest TB generated coverage
    remains zero until R4i. Evidence captured 2026-07-03 from QEMU commit
    `b4bc035facc9956f9a81bf4ef9649d83e8a627bf`: default artifact
    `qemu-system-x86_64.js`
    `105d0404f8f105be8604cff8f4f094c665a663c9696bd5dab3f7ab7e20e69870`,
    `qemu-system-x86_64.wasm`
    `6fe1613185bcbdb0fdfd7fddfac6c1ea384a0ebb92893887c1081c5d6af7c50e`,
    manifest
    `d9c96709f2984502d92097397efcbf7c05dc695de05be9e9dd5e86e35190cad0`;
    backend-gated artifact `qemu-system-x86_64.js`
    `f2cd3daf6f04af351f23316de5156d7a3d1bd94a14526c40a0a4ae7c8e0c39b4`,
    `qemu-system-x86_64.wasm`
    `183fee2e9a51e1870e60384d32ba8fd07a3e84f8b0cc0718fa8e42331c47de01`,
    manifest
    `e2304da4745f1d92f13a380e2e39098325ba81289152124b6aa4197f4d34e6a9`.
    Chrome/Chromium `149.0.7827.55` default TuxBoot smoke reached
    `QEMU_WASM_LINUX_BOOT_OK` in `86715` ms with result JSON
    `tmp/qemu-x86_64-current-guest-20260703-06/wasm-browser-smoke-result.json`
    SHA256
    `096401f6c8ffa05aa55705daeae059f6690935842a7d4e8fb6040cfffd01ed7f`.
    The backend-gated run with `wasm64RunloopSmoke=1` reached the same marker
    in `86074` ms with result JSON
    `tmp/qemu-x86_64-current-backend-smoke-20260703-06/wasm-browser-smoke-result.json`
    SHA256
    `c92ec0621522245a390faa033bf2002507783013df58d901ea3a4d0e42f88930`.
    The runtime smoke reported aggregate generated/fallback
    guest-instruction-equivalent counts `8000000`/`8000000`, generated body
    time `9125000` ns, TCI-like dispatch time `89932000` ns, and zero
    helper/`qemu_ld`/`qemu_st` calls for synthetic micro-workloads. Live x86
    TB summaries remained empty (`wasm64Tcg.summaryCount=0`), so this is
    baseline/contract evidence only, not a performance pass.

- [ ] R4k - Expand from the one-TB proof to x86_64 generated bodies with
    internal chaining and inline SoftMMU/TLB-hit RAM load/store fast paths.
    DoD: generated x86_64 bodies retire counted guest instructions inside
    Wasm, avoid returning to the QEMU main loop per TB on deterministic hot
    paths, keep hot CPU state in Wasm locals where safe, and do not call
    `qemu_ld`/`qemu_st` helpers on common TLB-hit RAM loads/stores. Miss,
    MMIO, permission fault, page-crossing, unsupported helper, invalidation,
    interrupt, and budget expiry must exit or fall back with precise reason
    counters. No-silent-fallback performance mode must fail loudly for
    unsupported hot x86 paths. Ordered implementation slices after R4j:
    (1) add a deterministic per-TB function-body emitter scaffold for the R4i
    TCI-word shape that compiles the recorded words into a body instead of
    the hard-coded one-TB path; prove byte/module validity and differential
    equivalence locally with `wasm-generated-output-equivalence-test.mjs`
    extended to cover the selected emitter path; (2) define and test the x86
    CPU-state contract for general registers, RIP/EIP, lazy condition-code
    inputs, and required flush points, with no browser run; (3) connect one
    live translated TB to the per-TB body path through `wasmjit_run()` and
    require nonzero generated guest-instruction retirement plus precise
    no-silent-fallback failure when the selected hot shape is unsupported;
    (4) add a deterministic two-TB hotset/`goto_tb` dispatch fixture that
    stays inside generated Wasm for chained hits and exits only for missing,
    invalidated, interrupt, helper, unsupported, or budget cases; (5) replace
    shape-specific load/store handling with guarded x86 SoftMMU/TLB-hit RAM
    load and store fast paths, with deterministic hit/miss/MMIO/page-fault/
    page-crossing tests and zero `qemu_ld`/`qemu_st` calls on proven hits;
    (6) add stale-TB/address-space invalidation rejection and metrics tests.
    Browser smokes remain blocked until these deterministic slices pass.
    Slice 1 accepted 2026-07-03 on branch
    `qemu-r4k-per-tb-emitter-20260703-10`: the deterministic
    `scripts/ci/wasm-generated-output-equivalence-test.mjs` gate now routes
    fixture execution through named emitter
    `r4k-per-tb-function-body-emitter`, validates generated module bytes with
    `WebAssembly.validate`, and covers the accepted R4i live word shape
    `ld32u, tci_movi, tci_setcond32, brcond, tci_movi, st8, ld, tci_movi,
    add, st, goto_tb` from recorded TCI words rather than the hard-coded
    one-TB body. Unsupported shapes fail closed with explicit reason data; the
    R4i fixture also records a fail-closed runtime guard for the taken
    out-of-recorded-range `brcond` target. Local evidence reported
    `fixtures=13`, `unsupportedFixtures=1`, `emittedModuleFixtures=13`,
    `r4iPerTBEmitterFixtures=1`, register and memory state matched, dispatch
    target `20618`, `r4iPerTBEmitterGeneratedGuestInstructions=1`,
    `r4iPerTBEmitterGeneratedTciOpEquivalents=11`,
    `r4iPerTBEmitterInlineTlbHitLoads=2`,
    `r4iPerTBEmitterInlineTlbHitStores=2`,
    `r4iPerTBEmitterMemoryWrites=2`, and zero helper, `qemu_ld`, and
    `qemu_st` calls. Checks: `git diff --check`,
    `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    No browser smoke, live guest routing, broad chaining, x86 CPU-state
    contract, no-silent-fallback performance mode, or generic SoftMMU/TLB
    lowering was run or enabled; R4k remains open for slices 2-6.
    Slice 2 accepted 2026-07-03 on branch
    `qemu-r4k-x86-cpu-state-20260703-10`: the deterministic per-TB emitter
    gate now records `r4iX86CpuStateContract` for the accepted R4i word shape.
    The contract names QEMU's x86 TCG globals and backing `CPUX86State`
    fields: general register input `CPUX86State.regs[R_R14]`,
    dirty/required flush registers `CPUX86State.regs[R_ESP]`,
    `CPUX86State.regs[R_EBP]`, and `CPUX86State.regs[R_R13]`,
    `CPUX86State.eip`/`cpu_eip` as not read or written by the generated body
    with dispatch target supplied by the recorded `goto_tb` slot, and lazy
    condition-code fields `CPUX86State.cc_dst`, `cc_src`, `cc_src2`, and
    `cc_op` as unmodeled except for the explicit `tci_setcond32` comparison
    inputs from the TCI register operands. The test requires all generated
    register locals to flush before `goto_tb`/`exit_tb` terminal return and
    before a runtime `STATUS_UNSUPPORTED` return; the taken
    out-of-recorded-range `brcond` guard returns status `6` with dirty locals
    flushed (`R_ESP=4294967295`, `R_EBP=0`, `R_R13=1`). Explicit negative
    fixtures fail closed for direct RIP/EIP write
    (`unmodeled-rip-eip-write`), lazy CC state read
    (`unmodeled-lazy-condition-code-state`), segment state read
    (`unmodeled-segment-state`), and helper-sensitive state
    (`unmodeled-helper-sensitive-state`). Local evidence reported
    `fixtures=13`, `unsupportedFixtures=1`, `r4iPerTBEmitterFixtures=1`,
    `r4iPerTBEmitterGeneratedGuestInstructions=1`,
    `r4iPerTBEmitterGeneratedTciOpEquivalents=11`, zero helper, `qemu_ld`,
    and `qemu_st` calls, and the contract fields above. Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    No browser smoke, live guest routing, broad chaining,
    no-silent-fallback performance mode, or generic SoftMMU/TLB lowering was
    run or enabled; R4k remains open for slices 3-6.
    Slice 3 accepted 2026-07-03 on branch
    `qemu-r4k-live-tb-body-20260703-11`: the opt-in live one-TB differential
    path still enters through `tcg_wasm64_tb_exec()` and still returns to the
    normal TCI fallback for guest execution, but the generated `wasmjit_run`
    body for the accepted R4i live TB is now sourced from
    `metadata->generated_output` and `metadata->generated_output_size` instead
    of the removed hard-coded `tcg_wasm64_live_one_tb_words[]` body source.
    The live gate fails closed with explicit JSON/status reporting for missing
    metadata, generated output unavailable for the selected hot shape,
    selected hot shape unsupported by the live per-TB emitter, metadata output
    versus TB code drift, module emission failure, and module validation
    failure. Unsupported selected hot shapes report
    `generated_guest_instructions=0` and are not counted as successful
    generated work. Successful selected live execution can still record
    nonzero generated guest-instruction retirement for the single TB
    (`guestInsns`, `1` for the accepted R4i fixture) plus the existing
    `11` generated TCI-op equivalents, two inline TLB-hit loads, two inline
    TLB-hit stores, two memory writes, and zero helper, `qemu_ld`, and
    `qemu_st` calls. The deterministic equivalence gate now records
    `r4kLiveMetadataRouting` cases: `metadata-missing`,
    `generated-output-unavailable`, `selected-hot-shape-unsupported`,
    `unsupported-shape` mapped to `module-emission-failed`, and a successful
    R4i metadata-backed route with `generatedGuestInstructions=1`,
    `moduleValid=true`, and module byte length `564`. Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    No browser smoke, speed claim, two-TB chaining, broad SoftMMU/TLB
    lowering, helper exits, RISC-V work, BusDK work, or Bus Engine OS proof
    was run or enabled; R4k remains open for slices 4-6.
    Slice 4 accepted 2026-07-03 on branch
    `qemu/r4k-two-tb-hotset-20260703-11`: the deterministic equivalence gate
    now includes a `r4k-two-tb-hotset-dispatch-fixture` module that exports a
    single `wasmjit_run` entry, executes TB A from the accepted R4i recorded
    `ld32u, tci_movi, tci_setcond32, brcond, tci_movi, st8, ld, tci_movi,
    add, st, goto_tb` shape, reads A's recorded `goto_tb` slot, and dispatches
    to a second generated TB body without returning to JavaScript/QEMU for the
    chained-hit case. The successful fixture
    `r4k-two-tb-chained-hit` reported one generated module call,
    `moduleValid=true`, module byte length `1142`, matching source and target
    dispatch target `29184`, register and memory state matched,
    `generatedGuestInstructions=2`, `generatedChainLength=2`,
    deterministic stand-in `generatedBodyTimeNs=2000`, inline TLB-hit loads
    `2`, inline TLB-hit stores `2`, and zero helper, `qemu_ld`, and
    `qemu_st` calls. Fail-closed deterministic fixtures now cover
    `missing-chain-target`, `unsupported-chain-target-shape`,
    `budget-before-second-tb`, and `invalidated-chain-target`; all four
    negative cases reported `generatedGuestInstructions=0`,
    `generatedChainLength=0`, `generatedBodyTimeNs=0`, matching state after
    TB A only, and the expected exit counter (`exitsUnsupported=1`,
    `exitsBudget=1`, or `exitsInvalidated=1`). Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`
    (`wasm64 translate metadata contract: ok`),
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`
    (JSON event `generated-output-equivalence`, `r4kTwoTBHotset.fixtureCount=5`),
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    This is deterministic local accelerator-shape evidence only, not a
    browser smoke, browser speed claim, same-commit speed gate, broad
    SoftMMU/TLB lowering, RISC-V work, BusDK work, or Bus Engine OS proof;
    R4k remains open for slices 5-6.
    Slice 5 prep accepted 2026-07-03 on branch
    `qemu/r4k-softmmu-fastpath-map-20260703-11`: this is a source-map and
    deterministic-fixture plan only; it does not implement broad SoftMMU/TLB
    lowering, run a browser smoke, claim a speedup, or mark R4k slice 5
    complete. The exact x86 state reachability is `TCGWasm64RunContext.env`
    in `tcg/wasm64.h`, `env_cpu(env)` in `include/exec/cpu-common.h`, and
    `CPUState.neg.tlb` in `include/hw/core/cpu.h`; the generated path must
    use C-authored mirrors instead of hard-coding the negative
    `CPUState`/`CPUArchState` displacement. The x86 translator state that
    supplies the SoftMMU index is `DisasContext.mem_index` in
    `target/i386/tcg/translate.c`, initialized by
    `cpu_mmu_index(cpu, false)` and implemented by
    `x86_cpu_mmu_index()`/`x86_mmu_index_pl()` in
    `target/i386/tcg/tcg-cpu.c` for `MMU_KSMAP64_IDX`,
    `MMU_KSMAP32_IDX`, `MMU_USER64_IDX`, `MMU_USER32_IDX`,
    `MMU_KNOSMAP64_IDX`, `MMU_KNOSMAP32_IDX`, `MMU_PHYS_IDX`, and
    `MMU_NESTED_IDX` from `target/i386/cpu.h`. The CPU state fields already
    needed around these accesses are `CPUX86State.regs[]`, `eip`,
    `cc_dst`, `cc_src`, `cc_src2`, `cc_op`, `hflags`, `hflags2`,
    `segs[]`, `cr[]`, and `a20_mask` in `target/i386/cpu.h`, with TCG
    globals wired by `tcg_global_mem_new*()` in
    `target/i386/tcg/translate.c`.
    The exact TLB layout for a wasm64 hit is
    `CPUTLBDescFast.mask`/`table` in `include/exec/tlb-common.h`, indexed as
    `((vaddr >> TARGET_PAGE_BITS) & (mask >> CPU_TLB_ENTRY_BITS))`, where
    x86 has `TARGET_PAGE_BITS == 12` from `target/i386/cpu-param.h` and
    wasm64 has `CPU_TLB_ENTRY_BITS == 5`, so `CPUTLBEntry` is 32 bytes with
    `addr_read` at offset 0, `addr_write` at offset 8, `addr_code` at offset
    16, and `addend` at offset 24. `cpu_tlb_fast()` and
    `mmuidx_to_fast_index()` in `include/hw/core/cpu.h` select the fast TLB
    array. Permission and slow-path tags are the comparator bits
    `TLB_INVALID_MASK`, `TLB_NOTDIRTY`, and `TLB_FORCE_SLOW` plus
    `CPUTLBEntryFull.slow_flags[MMU_DATA_LOAD]` and
    `slow_flags[MMU_DATA_STORE]` from `include/hw/core/cpu.h` and
    `include/exec/tlb-flags.h`; `TLB_BSWAP`, `TLB_WATCHPOINT`,
    `TLB_CHECK_ALIGNED`, `TLB_DISCARD_WRITE`, and `TLB_MMIO` must not be
    modeled as RAM hits.
    The current QEMU slow boundary is `tci_qemu_ld()`/`tci_qemu_st()` in
    `tcg/tci.c`, which dispatch through `helper_ldub_mmu`,
    `helper_lduw_mmu`, `helper_ldul_mmu`, `helper_ldq_mmu`, and the matching
    store helpers in `accel/tcg/ldst_common.c.inc` to
    `do_ld*_mmu()`/`do_st*_mmu()` in `accel/tcg/cputlb.c`. Those helpers
    decode `MemOpIdx` with `get_memop()`/`get_mmuidx()` from
    `include/exec/memopidx.h`, split page-crossing accesses in
    `mmu_lookup()`, fill or fault through `tlb_fill_align()`, and classify
    RAM versus MMIO in `tlb_set_page_full()`: RAM and ROMD reads get
    `entry->addend = memory_region_get_ram_ptr(section->mr) + xlat -
    addr_page`, I/O has addend 0, I/O reads and I/O or ROMD writes set
    `TLB_MMIO`, missing permissions set the comparator to `-1`, and
    dirty/write-discard/watchpoint/alignment/bswap cases force the slow path.
    The native x86 TCG reference guard is
    `prepare_host_addr()` in `tcg/x86_64/tcg-target.c.inc`, using
    `tlb_mask_table_ofs()` in `tcg/tcg.c`: compare the page/adjusted-page
    address against `addr_read` or `addr_write`, then use `vaddr + addend`
    only on a clean hit.
    Slice 5 implementation must export or mirror into
    `TCGWasm64RunContext` enough C-owned data to reproduce that guard:
    either an explicit `CPUState *cpu` plus per-access reloads of
    `CPUTLBDescFast.mask`, `CPUTLBDescFast.table`, and
    `CPUTLBDesc.fulltlb`, or precomputed per-`mmu_idx` mirror fields for
    those three values, with `QEMU_BUILD_BUG_ON()` checks for all exported
    offsets and constants. The current context has only `env`, `guest_ram`,
    `budget`, `counters`, `exit`, `mode`, and `flags`, so it is not enough to
    identify MMIO versus a miss/fault. The generated hit guard must fail
    closed before any direct memory access when `((addr ^ (addr + size - 1))
    & TARGET_PAGE_MASK) != 0`, the comparator base page
    `(addr_read_or_write & TARGET_PAGE_MASK)` does not match
    `(addr & TARGET_PAGE_MASK)`, the `MemOp` is not a little-endian
    1/4/8-byte scalar covered by the fixture, or the operation would require
    a helper side effect. If the base page matches but `addr_read`/`addr_write`
    contains any `TLB_FLAGS_MASK` bit or the mirrored full entry has any
    `TLB_SLOW_FLAGS_MASK` bit, the only precise generated classifications are
    `TCG_WASM64_RUN_EXIT_MMIO` when the mirrored full entry contains
    `TLB_MMIO`, `TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT` for invalid or
    disabled permission state, and `TCG_WASM64_RUN_EXIT_UNSUPPORTED` for
    unmodeled slow flags; none may be guessed as RAM.
    Deterministic slice-5 fixture names and expected generated counters are:
    these are SoftMMU `qemu_ld`/`qemu_st` width/access cases, not approval to
    generate raw host-memory `INDEX_op_ld32u`, `INDEX_op_ld`,
    `INDEX_op_st8`, or `INDEX_op_st`, which
    `tcg_wasm64_translate_op_generated_supported()` in `tcg/wasm64.c`
    intentionally still excludes.
    `r4k-softmmu-ld32u-tlb-hit-ram` (`inline_tlb_hit_loads=1`,
    `inline_tlb_hit_stores=0`, `helper_calls=0`, `qemu_ld_calls=0`,
    `qemu_st_calls=0`, no synthetic exit beyond normal TB terminal);
    `r4k-softmmu-ld-tlb-hit-ram` with the same counts for one 64-bit load;
    `r4k-softmmu-st8-tlb-hit-ram` (`loads=0`, `stores=1`, helper and
    `qemu_*` counts 0, normal terminal); `r4k-softmmu-st-tlb-hit-ram` with
    the same counts for one 64-bit store; `r4k-softmmu-tlb-miss` (all inline,
    helper, and `qemu_*` counts 0, `TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT`,
    `exits_tlb_miss_or_fault=1`); `r4k-softmmu-mmio` (all inline, helper,
    and `qemu_*` counts 0, mirrored `TLB_MMIO`,
    `TCG_WASM64_RUN_EXIT_MMIO`, `exits_mmio=1`);
    `r4k-softmmu-permission-fault` (all inline, helper, and `qemu_*` counts
    0, disabled comparator or `TLB_INVALID_MASK`,
    `TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT`,
    `exits_tlb_miss_or_fault=1`); `r4k-softmmu-page-crossing` (all inline,
    helper, and `qemu_*` counts 0, page-crossing flag in
    `TCGWasm64RunExit.flags`, `TCG_WASM64_RUN_EXIT_TLB_MISS_OR_FAULT`,
    `exits_tlb_miss_or_fault=1`); and
    `r4k-softmmu-stale-output-mismatch` (all generated counters 0, current
    status `metadata-output-tb-code-mismatch` from `tcg/wasm64.c` when
    `metadata->generated_output` no longer matches TB words). True
    stale-TB/address-space invalidation is not safely expressible until
    slice 6 adds generation tracking; that later fixture should use
    `TCG_WASM64_RUN_EXIT_INVALIDATED` and `exits_invalidated=1`. The first
    real implementation task is to add the narrow run-context TLB mirror and
    deterministic JS softmmu fixture model, then replace only the generated
    `qemu_ld`/`qemu_st` helper call in
    `scripts/ci/wasm-generated-output-equivalence-test.mjs` for these width
    cases with the guard above. Its failure mode must be a zero-inline-count
    synthetic exit for every unmirrored offset, flag, crossing, miss, MMIO,
    permission, or unsupported `MemOp`; its first check command is
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs` followed by
    `node scripts/ci/wasm64-translate-metadata-test.mjs`.
    Slice 6 prep accepted 2026-07-03 on branch
    `qemu/r4k-invalidation-map-20260703-12`: this is a source-map and
    deterministic-fixture plan only; it does not implement broad invalidation
    runtime, complete slice 6, run a browser smoke, claim a speedup, touch
    RISC-V, or alter the direct-boundary path. The exact TB identity source
    is `struct TranslationBlock` in `include/exec/translation-block.h`:
    `pc`, `cs_base`, `flags`, `cflags`, `size`, `icount`, `tc.ptr`,
    `tc.size`, `page_addr[2]`, `jmp_reset_offset[]`, `jmp_target_addr[]`,
    `jmp_list_head`, `jmp_list_next[]`, and `jmp_dest[]`. QEMU publishes a
    TB by `tb_gen_code()` in `accel/tcg/translate-all.c`, inserts the
    `tb->tc.ptr` interval into the region tree with `tcg_tb_insert()` in
    `tcg/region.c`, and links it into the physical-page/QHT lookup with
    `tb_link_page()` in `accel/tcg/tb-maint.c`. Lookup identity is the
    `tb_hash_func(tb_page_addr0(tb), pc-or-0-for-CF_PCREL, flags, cs_base,
    cflags)` key used by `tb_link_page()` and by `tb_htable_lookup()` /
    `tb_lookup_cmp()` in `accel/tcg/cpu-exec.c`; second-page identity is
    checked with `tb_page_addr1()` and `get_page_addr_code()` when needed.
    `CF_INVALID` in `TranslationBlock.cflags` is the in-struct stale flag,
    protected by `jmp_lock`, but it is not safe as the only generated-code
    guard because full TB flush resets code regions and may make stale TB
    pointers invalid before generated Wasm can inspect them.
    The exact TB invalidation and flush paths are `do_tb_phys_invalidate()`,
    `tb_phys_invalidate()`, `tb_invalidate_phys_range()`,
    `tb_invalidate_phys_range_fast()`, and
    `tb_invalidate_phys_page_range__locked()` in
    `accel/tcg/tb-maint.c`, plus `tb_flush__exclusive_or_serial()` and
    `queue_tb_flush()`. `do_tb_phys_invalidate()` sets `CF_INVALID`, removes
    the TB from `tb_ctx.htable` and page lists, clears jump-cache entries,
    removes outgoing and incoming jumps, and increments
    `tb_ctx.tb_phys_invalidate_count` only after successful QHT removal.
    `tb_flush__exclusive_or_serial()` clears every CPU jump cache, resets
    `tb_ctx.htable`, removes all TBs, resets TCG regions, increments
    `tb_ctx.tb_flush_count`, and invokes plugin flush callbacks. Those two
    fields in `struct TBContext` (`accel/tcg/tb-context.h`) are global stats,
    not per-TB lifetime tokens; generated hotset bodies therefore need a
    stable wasm64-owned `tb_generation` token, bumped by successful physical
    invalidation and full flush before stale generated bodies are allowed to
    run. A generated body must compare its stamped TB generation before it
    dereferences any TB pointer, code pointer, chain table entry, or
    generated-output binding; mismatch returns
    `TCG_WASM64_RUN_EXIT_INVALIDATED` and increments `exits_invalidated`
    before guest state or generated counters are updated.
    The exact generated-output binding is `tcg_out_tb_start()` in
    `tcg/wasm64/tcg-target.c.inc`, which calls
    `tcg_wasm64_translate_begin(tcg_splitwx_to_rx(s->code_buf))` before
    emitting the TCI fallback byte stream. `TCGWasm64TranslateEntry` in
    `tcg/wasm64.c` is keyed by that `tb->tc.ptr` value and owns
    `TCGWasm64TBMetadata metadata` plus the `generated_output[]` word buffer.
    `TCGWasm64TBMetadata` in `tcg/wasm64.h` binds `tb_ptr`, `magic`,
    `version`, `flags`, op counts, generated-supported/unsupported counts,
    `generated_output_size`, `generated_output_op_count`,
    `generated_output_checksum`, and `generated_output`. Lookup through
    `tcg_wasm64_translate_lookup()` / `_mutable()` accepts only matching
    `tb_ptr`, magic, version, and `TCG_WASM64_TB_METADATA_VALID`.
    Generated-output availability requires
    `tcg_wasm64_translate_generated_candidate()`, generated-output flag set,
    no truncation, nonzero 4-byte-aligned output, output op count equal to
    metadata op count and word count, and non-NULL output. The current live
    one-TB proof reconstructs TB identity with
    `tcg_tb_lookup((uintptr_t)tb_ptr)` and its JavaScript guard compares each
    word from `metadata->generated_output` against live TB code at
    `tb->tc.ptr`; drift currently reports
    status `metadata-output-tb-code-mismatch`. Slice 6 must keep that
    diagnostic but classify the `wasmjit_run()` rejection as invalidated:
    zero generated work, `TCG_WASM64_RUN_EXIT_INVALIDATED`, and
    `exits_invalidated=1`.
    The exact address-space state source is `struct AddressSpace` and
    `struct FlatView` in `include/system/memory.h`: `AddressSpace.root`,
    RCU `current_map`, ioeventfd fields, listeners, and the `FlatView`
    ranges/dispatch/root. `address_space_set_flatview()` in
    `system/memory.c` swaps `as->current_map` under BQL when memory topology
    changes, and `memory_region_transaction_commit()` walks every
    `AddressSpace` when `memory_region_update_pending` is set.
    `cpu_address_space_init()` in `system/physmem.c` registers
    `CPUAddressSpace.tcg_as_listener.commit = tcg_commit`; `tcg_commit()`
    runs `tlb_flush(cpu)` because CPU TLBs store RAM addresses. x86 address
    spaces are `X86ASIdx_MEM` and `X86ASIdx_SMM` from `target/i386/cpu.h`,
    initialized by `target/i386/tcg/system/tcg-cpu.c`; `x86_asidx_from_attrs()`
    chooses SMM for secure attrs. There is no existing AddressSpace generation
    field, so slice 6 needs a wasm64-owned `address_space_generation` token
    for the CPU address-space snapshot used by generated bodies, bumped when
    `old_view != new_view` for a CPU-visible address space or from the TCG
    listener commit that already flushes the CPU TLB. A generated body must
    compare this token before using cached address-space/TLB-derived RAM
    assumptions; mismatch is an invalidated exit with zero generated work.
    The exact TLB state source remains `CPUState.neg.tlb` in
    `include/hw/core/cpu.h`: `CPUTLBCommon.lock`, `dirty`,
    `full_flush_count`, `part_flush_count`, `elide_flush_count`;
    per-`mmu_idx` `CPUTLBDesc.fulltlb`, `vtable`, `vfulltlb`,
    large-page and sizing fields; and `CPUTLBDescFast.mask` / `table` from
    `include/exec/tlb-common.h`, selected through `cpu_tlb_fast()` and
    `mmuidx_to_fast_index()`. `tlb_flush_one_mmuidx_locked()`,
    `tlb_flush_by_mmuidx()`, page/range flush helpers, and
    `tlb_set_page_full()` in `accel/tcg/cputlb.c` can clear, resize, or
    refill the fast table and full entries; `tlb_fill_align()` explicitly
    warns that a fill can resize the table and invalidate prior TLB entry
    pointers. `CPUTLBCommon` flush counts and dirty bits are stats and
    bookkeeping, not a complete mirror-generation contract. If slice 5 uses
    precomputed TLB mirror fields in `TCGWasm64RunContext`, slice 6 must add
    a C-owned `tlb_mirror_generation` token that is bumped whenever the mirror
    is refreshed or invalidated and compared before the first inline load/store
    and before a chained target that reuses the mirror. If the implementation
    instead reloads `CPUState.neg.tlb` per access, the TLB mirror mismatch
    fixture should be omitted and the test must assert that no precomputed
    mirror fields are used.
    Deterministic slice-6 fixture names and expected counters are:
    `r4k-invalidation-valid-unchanged-tb-executes` uses matching generated
    output, TB generation, address-space generation, and TLB mirror generation
    when present; it exits normally with `runExitReason=none`,
    `generatedGuestInstructions=2`, `generatedChainLength=2`,
    deterministic `generatedBodyTimeNs=2000`, `inlineTlbHitLoads=2`,
    `inlineTlbHitStores=2`, helper/`qemu_ld`/`qemu_st` calls `0`, and all
    synthetic exit counters including `exits_invalidated=0`.
    `r4k-invalidation-generated-output-mismatch` mutates one recorded
    generated-output word after metadata binding but before `wasmjit_run()`;
    it must not call any generated body, reports diagnostic
    `metadata-output-tb-code-mismatch`, and records
    `generatedGuestInstructions=0`, `generatedChainLength=0`,
    `generatedBodyTimeNs=0`, inline load/store/helper/`qemu_*` counts `0`,
    `TCG_WASM64_RUN_EXIT_INVALIDATED`, and `exits_invalidated=1`.
    `r4k-invalidation-tb-generation-mismatch` changes the current
    `tb_generation` after body compilation; the entry guard fails before any
    source TB body or TB pointer dereference, with the same zero generated
    counters and `exits_invalidated=1`.
    `r4k-invalidation-address-space-generation-mismatch` changes
    `address_space_generation` before the first cached RAM/TLB assumption; it
    has the same zero generated counters and invalidated exit.
    `r4k-invalidation-tlb-mirror-generation-mismatch` is
    required only if a precomputed mirror exists; it changes
    `tlb_mirror_generation` before the first inline RAM access and expects the
    same zero generated counters and invalidated exit. The existing
    `r4k-two-tb-invalidated-chained-target` fixture should be upgraded from
    its fixture-local generation word to the same TB-generation token used by
    live hotsets: source TB state may be flushed to the deterministic expected
    state after TB A, but the target body must not execute and the reported
    generated metrics remain `generatedGuestInstructions=0`,
    `generatedChainLength=0`, `generatedBodyTimeNs=0`,
    inline load/store/helper/`qemu_*` counts `0`,
    `TCG_WASM64_RUN_EXIT_INVALIDATED`, and `exits_invalidated=1`.
    The first real implementation task is to add the narrow wasm64
    invalidation-token context/descriptor fields, deterministic JS fixture
    model, and C-side bump/read helpers with `QEMU_BUILD_BUG_ON()` offset
    checks; generated code must fail closed on any token mismatch before
    executing guest-visible work.
    Slice 5 accepted 2026-07-03 on branch
    `qemu/r4k-softmmu-fastpath-impl-20260703-12`: the deterministic
    generated-output equivalence gate now includes observable
    `r4kSoftmmuFastPath` JSON with `12` fixtures. RAM-hit fixtures
    `r4k-softmmu-ld32u-tlb-hit-ram`, `r4k-softmmu-ld-tlb-hit-ram`,
    `r4k-softmmu-st8-tlb-hit-ram`, and
    `r4k-softmmu-st-tlb-hit-ram` validate generated modules, return normal
    terminal status, report `runExitReason="none"`, record inline TLB-hit
    load/store counts `1/0`, `1/0`, `0/1`, and `0/1`, and keep
    `helperCalls=0`, `qemuLdCalls=0`, and `qemuStCalls=0`. Fail-closed
    fixtures cover `r4k-softmmu-tlb-miss`,
    `r4k-softmmu-mmio`, `r4k-softmmu-permission-fault`,
    `r4k-softmmu-page-crossing`, unsupported `MemOp`, slow flags, and
    unmirrored state; all report zero inline/helper/`qemu_*` counts before
    RAM access, with precise exit reasons/counters (`MMIO`,
    `TLB_MISS_OR_FAULT`, `UNSUPPORTED`) and the page-crossing exit flag.
    The expressible stale-output case
    `r4k-softmmu-stale-output-mismatch` uses the current
    `metadata-output-tb-code-mismatch` status and zero generated counters;
    true stale-TB/address-space invalidation remains slice 6 because it needs
    generation tracking. `TCGWasm64RunContext` now carries a C-owned
    `TCGWasm64TLBMirror *tlb`; `tcg_wasm64_tlb_mirror_reset()` and
    `tcg_wasm64_tlb_mirror_refresh()` snapshot only
    `CPUTLBDescFast.mask`, `CPUTLBDescFast.table`, and
    `CPUTLBDesc.fulltlb` plus exported TLB constants for a selected
    `mmu_idx`, with `QEMU_BUILD_BUG_ON()` checks for the run context, mirror,
    `CPUTLBEntry`, `CPUTLBEntryFull.slow_flags`, and TLB flag layouts. The
    generated fixture reads only the mirror and does not hard-code
    `CPUState`/`CPUArchState` negative displacement. Checks passed:
    `git diff --check`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`; extra
    sanity check `node scripts/ci/wasm64-runloop-contract-test.mjs` also
    passed. No browser smoke, speed claim, broad generic x86 lowering,
    RISC-V work, BusDK work, or Bus Engine OS proof was run or enabled; R4k
    remains open for slice 6 stale-TB/address-space invalidation rejection
    and metrics tests. Rebase validation on 2026-07-03 kept this as one
    reviewable commit on top of `origin/develop` `99247562af` and repeated
    the required deterministic checks plus
    `node scripts/ci/wasm64-runloop-contract-test.mjs`. No scoped C compile
    check was run because this worker tree has no configured Meson/Ninja
    build directory or `compile_commands.json`, and standalone
    `tcg/wasm64.c` compilation depends on generated QEMU config/target
    headers; configuring a full x86_64-softmmu build was outside this slice.
    Slice 6 accepted 2026-07-03 on branch
    `qemu/r4k-invalidation-impl-20260703-12`: the deterministic x86_64
    accelerator contract now carries wasm64-owned invalidation tokens in
    `TCGWasm64RunContext`: `tb_generation` and
    `address_space_generation`, plus `TCGWasm64TLBMirror.generation` for the
    precomputed TLB mirror added in slice 5. `tcg/wasm64.c` has
    `QEMU_BUILD_BUG_ON()` layout checks for the new fields and narrow
    C-owned read/bump helpers:
    `tcg_wasm64_tb_generation()`, `tcg_wasm64_bump_tb_generation()`,
    `tcg_wasm64_address_space_generation()`,
    `tcg_wasm64_bump_address_space_generation()`,
    `tcg_wasm64_tlb_mirror_generation()`, and
    `tcg_wasm64_tlb_mirror_bump_generation()`; TLB mirror refresh bumps the
    mirror token before republishing mirrored pointers. The deterministic
    generated-output equivalence gate now reports `r4kInvalidationRejection`
    with `5` fixtures. `r4k-invalidation-valid-unchanged-tb-executes`
    validates matching generated output, TB generation `7`, address-space
    generation `11`, and TLB mirror generation `13`, then executes the
    two-TB hotset path with `generatedGuestInstructions=2`,
    `generatedChainLength=2`, `generatedBodyTimeNs=2000`,
    `inlineTlbHitLoads=2`, `inlineTlbHitStores=2`, helper/`qemu_ld`/
    `qemu_st` calls all `0`, `runExitReason="none"`, and
    `exits.invalidated=0`. Fail-closed fixtures cover
    `r4k-invalidation-generated-output-mismatch`,
    `r4k-invalidation-tb-generation-mismatch`,
    `r4k-invalidation-address-space-generation-mismatch`, and
    `r4k-invalidation-tlb-mirror-generation-mismatch`; all four report
    `runExitReason="invalidated"`, `exits.invalidated=1`, zero generated
    guest instructions, zero chain length, zero generated body time, zero
    inline TLB loads/stores, and zero helper/`qemu_ld`/`qemu_st` calls. The
    existing `r4k-two-tb-invalidated-chained-target` fixture now uses the
    same run-context TB generation token instead of a fixture-local memory
    word, and the stale generated-output diagnostic remains
    `metadata-output-tb-code-mismatch` while the run rejection is classified
    as `TCG_WASM64_RUN_EXIT_INVALIDATED`. Checks passed:
    `git diff --check`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm64-runloop-contract-test.mjs`,
    `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm64-runloop-contract-test.mjs`, and
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`. No browser
    smoke, speed claim, broad generic x86 lowering, invalidation hook into
    QEMU TB/page/address-space listeners, RISC-V work, BusDK work, or Bus
    Engine OS proof was run or enabled; R4k deterministic slices are complete
    and R4k remains open only for later integration/performance proof work
    before R4l may run a browser speed gate.

- [ ] R4l - Run the x86_64 same-commit generic Chromium speed gate only
    after R4h-R4k have deterministic evidence. DoD: build one default-TCI
    `x86_64-softmmu` artifact and one accelerator artifact from the same
    commit, run the same generic x86_64 browser guest/marker, record hashes,
    browser version, result JSON paths, generated/fallback instruction counts,
    generated body time, TCI dispatch time, helper/`qemu_ld`/`qemu_st` counts,
    internal chain or hotset residency, and marker timings. The accelerator
    must beat same-commit default TCI by at least `25%`; otherwise record the
    failed gate and re-plan before another x86 browser run.

    Attempt 2026-07-03 after latest QEMU fetch: `origin/develop` was fetched
    and `projects/qemu` was current at
    `bc620279c05a7bbec2851f278d7a3cba524d73c5` (`Record latest x86 WASM
    speed gate rejection`). This supersedes the earlier same-day
    `d447dd51d9b831824af9da1de7d1e18c1f066d65` measurement because QEMU
    `origin/develop` moved while the first evidence was being recorded. A
    clean Docker build helper was used for both current-tip artifacts:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4l-bc62027-default-artifacts
    --target x86_64 --jobs 10`, and the same command with
    `--tcg-wasm64-backend` writing
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4l-bc62027-accelerator-artifacts`.
    Default artifact hashes: JS
    `105d0404f8f105be8604cff8f4f094c665a663c9696bd5dab3f7ab7e20e69870`,
    WASM `6fe1613185bcbdb0fdfd7fddfac6c1ea384a0ebb92893887c1081c5d6af7c50e`,
    manifest
    `d9c96709f2984502d92097397efcbf7c05dc695de05be9e9dd5e86e35190cad0`.
    Accelerator artifact hashes: JS
    `3c49db2604c6f8ce79b60a21f7e2c930fc699e4b68ab1bf1fad83e980f48e8bd`,
    WASM `c9666b47f7a32f65379a4948a221ae17fe01775192191ca9ee956c18a9683e9a`,
    manifest
    `dfb2c5f6a75fe3b90d7902f461071319b7b122a65f27cdff8c6ee881dc2bdc32`.
    Both ran in Chrome for Testing `149.0.7827.55` using the same fresh
    `microvm,acpi=off` generic x86_64 TuxBoot smoke guest manifest
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4l-d447dd5-guest-current/tuxboot-browser-smoke-guest.json`.
    The guest used kernel SHA-256
    `f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8`
    and initramfs SHA-256
    `632b8d6b856ca868bdf66b42c97ee64623b1897c144ebf9cf26608d4f9f06e02`.

    Default TCI reached `QEMU_WASM_LINUX_BOOT_OK` in `86701` ms with result
    JSON
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4l-bc62027-default-smoke/wasm-browser-smoke-result.json`.
    Kernel version printed at `35229` ms and init started at `85042` ms.
    The accelerator run used the same runner shape plus
    `--wasm64-live-generated-exec --wasm64-tcg-summary`, wrote result JSON
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4l-bc62027-accelerator-smoke/wasm-browser-smoke-result.json`,
    and timed out at `180227` ms without `QEMU_WASM_LINUX_BOOT_OK`. Kernel
    version printed at `39941` ms, but init did not start before timeout.
    The final `wasm64Tcg.lastSummary` had `generated_attempts=0`,
    `generated_compiled=0`, `generated_executed=0`,
    `generated_cache_hits=0`, and generated coverage `0` over denominator
    `0`. It did report translated/generated-output shape data at the first
    interval: `translated_tbs=10000`, `translated_generated_output_tbs=9691`,
    `translated_generated_output_unavailable_tbs=309`,
    `translated_generated_output_missing_candidate_tbs=309`, and first
    unsupported ops led by `sar=99`, `tci_movcond32=56`, `not=52`,
    `ctz=39`, `muls2=18`, `clz=17`, `tci_rotr32=13`, and `tci_rotl32=5`.
    The final
    `wasm64Runloop.lastSummary` rejected live generated execution with
    `reason=selected-body-shape-unsupported`, `compat_fallback=true`,
    `generated_guest_instructions=0`, `generated_chain_length=0`,
    `inline_tlb_hit_loads=0`, `inline_tlb_hit_stores=0`, `helper_calls=0`,
    `qemu_ld_calls=0`, `qemu_st_calls=0`, `exits_unsupported=1`, and
    `attempt_index=161551`.

    This rejects the current latest-QEMU accelerator artifact for R4l. It is
    not just below the required `25%` improvement; it is slower than default
    TCI and does not retire generated guest instructions. The run also emitted
    per-attempt `qemu-wasm64-runloop:` diagnostics until the page output was
    suppressed, so another browser speed run is not justified until the
    accelerator path records aggregate metrics without serial-output flooding
    and can execute a supported live generated body or fail no-silent preflight
    before a long run. Do not start an x86_64 Bus Engine OS browser proof from
    this artifact.

    Failed speed gate 2026-07-04 after R4s17 unlock: `origin/develop` was
    fetched and `projects/qemu` remained at base QEMU SHA
    `0dd7cb05f400e9a5ac1738b71a9e99018822220a` (`Record x86 R4s17
    no-silent preflight`). The worker used branch
    `qemu-r4l-x86-speed-gate-current`. Default-TCI build command:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-default-artifacts
    --target x86_64 --jobs 10 --build-image`. Accelerator build command:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-accelerator-artifacts
    --target x86_64 --tcg-wasm64-backend --jobs 10 --build-image`.
    Artifact directories:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-default-artifacts`
    and
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-accelerator-artifacts`.
    Default artifact hashes: `qemu-system-x86_64.js`
    `105d0404f8f105be8604cff8f4f094c665a663c9696bd5dab3f7ab7e20e69870`,
    `qemu-system-x86_64.wasm`
    `6fe1613185bcbdb0fdfd7fddfac6c1ea384a0ebb92893887c1081c5d6af7c50e`,
    manifest `qemu-system-wasm-artifacts.json`
    `d9c96709f2984502d92097397efcbf7c05dc695de05be9e9dd5e86e35190cad0`,
    and `SHA256SUMS`
    `6112eeaadc3764d8284ae02722eb907d08cf0ed73231d3a2b85f02bb38e8fad0`.
    Accelerator artifact hashes: `qemu-system-x86_64.js`
    `dca9af5932ad4f0ef594306904af9de7f630f90656d01ba5619439a050938076`,
    `qemu-system-x86_64.wasm`
    `a3edb64e351a7197454cbdddaf0d5636f9af95e2c3eda79fe16d16fe249c0157`,
    manifest `qemu-system-wasm-artifacts.json`
    `98ea500fe3c630737f45d103026fa165e8a8cee03c8e10d45ee02e98bd8a0cf7`,
    and `SHA256SUMS`
    `22172c9499fdd4053a57bfbe386f21592cdd4dc758daf16d1c676d49380c0ebc`.

    Both runs used Chromium `149.0.7827.55` and the same generic x86_64
    TuxBoot manifest
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4s8-guest-current/tuxboot-browser-smoke-guest.json`
    (`microvm,acpi=off`, CPU `Nehalem`, marker
    `QEMU_WASM_LINUX_BOOT_OK`; kernel SHA-256
    `f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8`,
    initrd SHA-256
    `632b8d6b856ca868bdf66b42c97ee64623b1897c144ebf9cf26608d4f9f06e02`).
    Default run command: `npm exec --yes --package=playwright -- node
    scripts/ci/wasm-browser-smoke-runner.mjs --browser chromium
    --artifact-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-default-artifacts
    --firmware-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/projects/qemu/pc-bios
    --guest-manifest
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4s8-guest-current/tuxboot-browser-smoke-guest.json
    --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-default-smoke/wasm-browser-smoke-result.json
    --screenshot
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-default-smoke/wasm-browser-smoke.png
    --port 8218 --timeout-ms 180000 --max-output-bytes 100000
    --page-text-tail-bytes 100000`. Default result JSON:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-default-smoke/wasm-browser-smoke-result.json`
    (SHA-256
    `4bad48c593d614115426eb38c69731d78cbf0b3ea34951ff5a4bc19048dc15c8`);
    screenshot SHA-256
    `7790c1602b7fc002de8c3020befa4d332828fe041dec420dbda28caa83284ff5`.
    Default TCI reached the marker: `markerSeen=true`, phase `success`,
    elapsed `86849` ms, final line `QEMU_WASM_LINUX_BOOT_OK`; kernel version
    printed at `35989` ms and init started at `85094` ms.

    Accelerator run command: `npm exec --yes --package=playwright -- node
    scripts/ci/wasm-browser-smoke-runner.mjs --browser chromium
    --artifact-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-accelerator-artifacts
    --firmware-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/projects/qemu/pc-bios
    --guest-manifest
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4s8-guest-current/tuxboot-browser-smoke-guest.json
    --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-accelerator-smoke/wasm-browser-smoke-result.json
    --screenshot
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-accelerator-smoke/wasm-browser-smoke.png
    --port 8219 --timeout-ms 180000 --max-output-bytes 100000
    --page-text-tail-bytes 100000 --wasm64-live-generated-exec
    --wasm64-tcg-summary --wasm64-tcg-summary-interval 1000`. This measured
    the normal accelerator path and did not use no-silent-fallback or
    preflight mode. Accelerator result JSON:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4l-0dd7cb0-accelerator-smoke/wasm-browser-smoke-result.json`
    (SHA-256
    `2a0ecae8d6d202e42440f01904c11a505b2d419b3e349f4584e261ac4640987f`);
    screenshot SHA-256
    `a86277b5f630e6a72011d17928c06e5c46df3f4f5d48f2416a7905e47747feac`.
    The accelerator did not reach the marker: `markerSeen=false`, phase
    `timeout`, elapsed `180200` ms, page status `timeout waiting for marker:
    QEMU_WASM_LINUX_BOOT_OK`, final line `Pthread 0x31f695d0 sent an error!
    http://127.0.0.1:8219/artifacts/qemu-system-x86_64.js:612: Uncaught
    RuntimeError: operation does not support unaligned accesses`. No kernel
    boot milestone was reached; the page recorded the unaligned-access
    `RuntimeError` at `2371` ms.

    Accelerator metrics captured before the runtime error:
    `wasm64Runloop.summaryCount=1`, `reason=chain-target-unsupported`,
    `preflight_ready=true`, `preflight=false`,
    `no_silent_fallback=false`, `compat_fallback=false`, `attempts=1`,
    `successes=1`, `rejects=0`, `skips=0`,
    `generated_guest_instructions=1`, `generated_run_entries=1`,
    `generated_chain_length=1`,
    `generated_guest_instructions_per_entry=1`, generated coverage `1 / 1`,
    `hotset_probe_attempts=1`, `hotset_goto_sources=1`,
    `hotset_target_slots_read=1`, `hotset_target_slots_unsafe=0`,
    `hotset_target_metadata_hits=0`, `hotset_target_output_hits=0`,
    `hotset_target_stale=1`, `selected_body_helper_exit_skips=0`,
    `selected_body_no_terminal=0`, no selected unsupported ops, no nonzero
    reject reasons, and empty reject memop/multi-access lists. The result
    JSON did not expose generated body wall time, TCI dispatch wall time,
    helper/`qemu_ld`/`qemu_st` counts, inline TLB hit counts, compile time, or
    instantiate time for this crash path. `wasm64Tcg` was enabled with
    interval `1000` but emitted no periodic summary
    (`summaryCount=0`, `lastSummary=null`) before the runtime error. The
    computed speed improvement was `(86849 - 180200) / 86849 =
    -1.0748655712788864` (`-107.49%`), and the accelerator therefore did not
    beat default TCI by at least `25%`. R4l remains failed/rejected, and no
    x86_64 Bus Engine OS proof was run.

- [ ] R4s - Implement the next x86_64 live generated-body slice for measured
  QEMU memory-helper shapes. DoD: `tci_qemu_ld_rrr` and
  `tci_qemu_st_rrr` generated-output words can be handled in the real
  `wasmjit_run()` path for the R4r-selected live body family by using the
  existing R4k SoftMMU/TLB-hit guard on clean RAM hits and returning precise
  synthetic exits for miss/fault, MMIO, page crossing, slow flags,
  unmirrored state, unsupported `MemOp`, or helper-sensitive cases. The
  implementation must not call `qemu_ld`/`qemu_st` helpers on proven TLB-hit
  RAM accesses, must preserve strict TCI compatibility fallback, must update
  generated instruction/body-time/inline-TLB/exit counters, and must include
  deterministic differential tests before any browser preflight. A bounded
  x86 Chromium preflight may run only after those deterministic tests pass,
  and R4l remains blocked until that preflight reports nonzero generated
  guest-instruction retirement from live x86 TBs.

- [ ] R4s5 - Rework the live x86 SoftMMU slice with fail-closed safety
    before another artifact build. DoD: the implementation zero-initializes
    the TLB mirror before refresh, rejects any `MemOpIdx` whose `MemOp`
    carries unmodeled high flags such as alignment or atomicity, assigns
    distinct generated status values for dispatch, exit, MMIO,
    TLB-miss/fault, unsupported, and invalidated outcomes, and has
    deterministic tests that prove each fail-closed case is classified
    precisely. This item must land before any new R4s browser preflight.
    This item is intentionally split into reviewable safety slices after a
    broad worker attempt did not produce a checkpoint:

- [ ] R4s6 - Run the bounded x86 Chromium preflight after the accepted
    R4s5d live-emitter repair before any R4l speed gate. DoD: build a fresh
    current
    `x86_64-softmmu` backend artifact from QEMU `develop` with
    `--tcg-wasm64-backend`, run only the generic TuxBoot browser smoke with
    `--wasm64-live-generated-exec`,
    `--wasm64-live-generated-exec-preflight`, bounded preflight limit, and
    wasm64 TCG summary enabled, and record exact commands, Chromium version,
    artifact hashes, result JSON, screenshot, marker or timeout, generated
    guest-instruction retirement, generated coverage numerator/denominator,
    generated attempts/successes/rejects, chain/run-loop residency metrics
    when present, helper/`qemu_ld`/`qemu_st` counts when present, and the top
    remaining reject or unsupported reasons. This is not a W3 speed gate. If
    generated guest-instruction retirement remains zero, R4l stays blocked and
    the next implementation item must name the measured blocker before more
    code changes.

    Artifact build preparation 2026-07-04: after rebuilding
    `qemu/emsdk-wasm64-cross:latest`, the x86_64 backend artifact build passed
    with command `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s6-x86-backend-artifacts
    --target x86_64 --tcg-wasm64-backend`. Artifacts:
    `qemu-system-x86_64.js`
    `c2a8ec8bbd2ccacdf51cf9d0167397073395d59d1956e24b68c89c194fb4bcfb`,
    `qemu-system-x86_64.wasm`
    `1b913d3ce5d19eda0cec3eecfdefcb04a5e0af8085dd4692bd9a399f100664d5`,
    manifest
    `608fa44bd53438b483410135ad944819d686fff194572468b45046a7d1761a27`.
    The bounded Chromium preflight has not run yet, so R4s6 remains open and
    R4l remains blocked.

    Rejected preflight 2026-07-04: worker-run bounded Chromium preflight used
    the artifact pair above and command shape `npm exec --yes
    --package=playwright -- node scripts/ci/wasm-browser-smoke-runner.mjs
    --browser chromium --artifact-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s6-x86-backend-artifacts
    --firmware-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/projects/qemu/pc-bios
    --guest-manifest
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s6-x86-guest-0d6ecfb-20260704/tuxboot-browser-smoke-guest.json
    --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s6-x86-preflight/wasm-browser-smoke-result.json
    --screenshot
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s6-x86-preflight/wasm-browser-smoke.png
    --port 8128 --timeout-ms 60000 --max-output-bytes 100000
    --page-text-tail-bytes 100000 --wasm64-live-generated-exec
    --wasm64-live-generated-exec-preflight
    --wasm64-live-generated-exec-preflight-limit 100
    --wasm64-tcg-summary --wasm64-tcg-summary-interval 1000`.
    Browser was Chromium `149.0.7827.55`. Result JSON SHA256
    `217320ba03d15af2d348fb3de43c41b84fdfe9620859e5107425d973d9713c12`;
    screenshot SHA256
    `ce65ca61a9c0c454e7a46f21e39759409c259dcf4402cfb9d29076faa9a2eb79`.
    The run timed out after `60640` ms without `QEMU_WASM_LINUX_BOOT_OK` and
    ended with `Aborted(native code called abort())` because preflight failed.
    The x86 metrics gate failed:
    `runloop_ok=true runloop_event=live-generated-exec-summary
    runloop_acceptance=false runloop_missing=0 tcg_present=true
    tcg_ok=false tcg_missing=2 ok=false`.
    `wasm64Runloop.lastSummary` reported
    `reason=preflight-zero-generated-exec`, `preflight_ready=false`,
    `attempts=100`, `successes=0`, `rejects=100`, `skips=82`,
    `generated_guest_instructions=0`, `generated_run_entries=0`,
    `generated_chain_length=0`, `generated_coverage_numerator=0`, and
    `generated_coverage_denominator=1120`. Hotset attribution reported
    `hotset_goto_sources=98`, `hotset_target_slots_read=98`,
    `hotset_target_metadata_hits=14`, `hotset_target_output_hits=14`, and
    `hotset_target_stale=84`. Nonzero reject reasons were
    `selected-body-memop-unsupported-atomic=85`,
    `js-status-metadata-output-tb-code-mismatch=13`,
    `selected-body-memop-unsupported-size=1`, and
    `selected-body-memop-unsupported-alignment=1`.
    `wasm64Tcg` was enabled but `summaryCount=0`, so the TCG summary fields
    required by the metrics gate were absent. R4s6 remains rejected, R4l
    remains blocked, and the next x86 implementation item must address the
    measured live-body MemOp rejection and metadata-output mismatch before
    another browser speed run.

- [ ] R4s13 - Run the bounded x86 Chromium generated-retirement preflight on
    a fresh same-commit artifact after R4s12. DoD: build current
    `x86_64-softmmu` Emscripten/WASM artifacts from QEMU `develop`, record
    artifact SHA-256 hashes, browser version, exact command, result JSON path,
    marker/timeout, and generated-retirement counters. Acceptance for this
    preflight is not a speed claim: it only unlocks R4l if the live browser
    summary reports nonzero generated guest-instruction retirement without
    hidden TCI fallback for the selected generated body. If generated
    retirement is still zero, record the exact blocker and add the next
    deterministic repair item instead of running R4l.

    Rejected preflight 2026-07-04: fresh current `x86_64-softmmu`
    backend artifacts were built from QEMU commit
    `362842178615b1571bec4d37d6886480335f3f47` with command `python3
    scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-backend-artifacts-3628421-20260704
    --target x86_64 --tcg-wasm64-backend`. Artifact directory:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-backend-artifacts-3628421-20260704`.
    Artifact hashes: `qemu-system-x86_64.js`
    `5547c17e21f9d7e40f009d019919cb21204edea3a4857392a23330f591473d72`,
    `qemu-system-x86_64.wasm`
    `5850bdeb6e07af3dbef7c87c16591687805dc9ea9a093427ec27c212b8047994`,
    manifest `qemu-system-wasm-artifacts.json`
    `c89fc1b9963550885767ad6dfe231c59f93cf5ecc4e5fd33f81132bc0aeaff09`,
    and `SHA256SUMS`
    `6edc433e8a2a2f9c6d9ee3b8075836dbb9d0267a2d23cc5f19112216ee8b1d81`.
    Bounded Chromium `149.0.7827.55` preflight command:
    `npm exec --yes --package=playwright -- node
    scripts/ci/wasm-browser-smoke-runner.mjs --browser chromium
    --artifact-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-backend-artifacts-3628421-20260704
    --firmware-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/projects/qemu/pc-bios
    --guest-manifest
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4s8-guest-current/tuxboot-browser-smoke-guest.json
    --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-preflight-3628421-20260704/wasm-browser-smoke-result.json
    --screenshot
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-preflight-3628421-20260704/wasm-browser-smoke.png
    --port 8213 --timeout-ms 60000 --max-output-bytes 100000
    --page-text-tail-bytes 100000 --wasm64-live-generated-exec
    --wasm64-live-generated-exec-preflight
    --wasm64-live-generated-exec-preflight-limit 100
    --wasm64-tcg-summary --wasm64-tcg-summary-interval 1000`.
    Result JSON:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-preflight-3628421-20260704/wasm-browser-smoke-result.json`
    (SHA256
    `5aaa82461efa14022ce164999095fc343c1eff3cbe45fb6a5bd4ef06b8defe7f`);
    screenshot SHA256
    `dd09b48b461ac629fb19059bbb7de4e6d4cfdf0d851a82302d1880123dea4ee3`.
    The generic marker `QEMU_WASM_LINUX_BOOT_OK` was not reached:
    `markerSeen=false`, phase `timeout`, elapsed `60222` ms, final line
    `Aborted(native code called abort())`. The runloop summary at `2483` ms
    reported `reason=preflight-zero-generated-exec`, `preflight_ready=false`,
    `compat_fallback=true`, `no_silent_fallback=false`, attempts `100`,
    successes `0`, rejects `100`, skips `82`, generated guest instructions
    `0`, generated run entries `0`, generated chain length `0`, generated
    coverage `0 / 1120`, hotset probe attempts `100`, hotset goto sources
    `98`, metadata hits `14`, output hits `14`, stale targets `84`, and
    selected helper-exit skips `82`. `wasm64Tcg` was enabled but
    `summaryCount=0`, so `node
    scripts/ci/wasm-browser-smoke-x86-metrics-gate.mjs --result
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s13-x86-preflight-3628421-20260704/wasm-browser-smoke-result.json
    --require-tcg --json` failed with missing `wasm64Tcg.summaryCount` and
    `wasm64Tcg.lastSummary`.

    The exact live blockers were still fail-closed generated-body rejection,
    not useful generated retirement:
    `selected-body-softmmu-multi-access-unsupported=61`,
    `js-status-module-emission-failed=24`,
    `selected-body-memop-unsupported-alignment=6`,
    `selected-body-memop-unsupported-size=5`, and
    `js-status-metadata-output-pool-relocation=4`. The live module failure
    remained `phase=body-build`, `status=6`, first op `ld32u`, terminal op
    `goto_tb`, shape
    `ld32u,tci_movi,tci_setcond32,brcond,tci_movi,st8,ld,tci_movi,add,st,goto_tb,exit_tb,exit_tb`,
    with shared memory64 import `limits_flags=0x07`, initial pages `0`,
    maximum pages `262144`, and `memory64=true`. The first metadata mismatch
    was still pool relocation at index `12`, op `tci_movl`, metadata word
    `0x0000057e`, live word `0x0007457e`. Reject MemOps were `0xa01`
    for unsupported size and `0xae0` for unsupported alignment. The
    multi-access attribution still includes store-before-later-guard cases
    such as order `SSSS` and `SL`. This does not accept R4s13, does not
    unlock R4l, makes no speed claim, and does not permit a Bus Engine OS
    browser proof.

- [ ] R4s15 - Run the bounded x86 Chromium generated-retirement preflight
    after R4s14. DoD: build fresh current `x86_64-softmmu`
    Emscripten/WASM artifacts from QEMU `develop`, record artifact SHA-256
    hashes, browser version, exact build and preflight commands, result JSON
    path, marker/timeout, and generated-retirement counters. Acceptance for
    this item is not a speed claim and does not itself satisfy R4l. It only
    unlocks R4l if the live browser summary reports nonzero generated
    guest-instruction retirement for the selected generated body without
    hidden TCI fallback. If generated retirement remains zero, record the
    exact blocker and add the next deterministic repair item instead of
    running R4l. Do not run a Bus Engine OS browser proof from this item.

    Rejected preflight 2026-07-04: fresh current `x86_64-softmmu`
    backend artifacts were built from QEMU commit
    `654c133e26a396fd5627a2b27cc4fb6a04f35531` with command `python3
    scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-backend-artifacts-654c133-20260704
    --target x86_64 --tcg-wasm64-backend --build-image`. Artifact directory:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-backend-artifacts-654c133-20260704`.
    Artifact hashes: `qemu-system-x86_64.js`
    `97fed78d7fe6805f6564ff123f2ded0806cbcd4825f31cc096e404432d93d80a`,
    `qemu-system-x86_64.wasm`
    `342041a0fa54dea966ac57fb548e71f309d90d9ed9d93bb02677343732dff4a4`,
    manifest `qemu-system-wasm-artifacts.json`
    `98e430503243da5dda58b2bc7c498f37537edfe4c6d86c6dc3f9d2a66fd227ea`,
    and `SHA256SUMS`
    `a1abff759bd43e446afad38f8061a62107304217802afc87d32bd9da2fa886cf`.

    Bounded Chromium `149.0.7827.55` compatibility-fallback preflight
    command: `npm exec --yes --package=playwright -- node
    scripts/ci/wasm-browser-smoke-runner.mjs --browser chromium
    --artifact-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-backend-artifacts-654c133-20260704
    --firmware-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/projects/qemu/pc-bios
    --guest-manifest
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4s8-guest-current/tuxboot-browser-smoke-guest.json
    --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-654c133-20260704/wasm-browser-smoke-result.json
    --screenshot
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-654c133-20260704/wasm-browser-smoke.png
    --port 8215 --timeout-ms 60000 --max-output-bytes 100000
    --page-text-tail-bytes 100000 --wasm64-live-generated-exec
    --wasm64-live-generated-exec-preflight
    --wasm64-live-generated-exec-preflight-limit 100
    --wasm64-tcg-summary --wasm64-tcg-summary-interval 1000`.
    Result JSON:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-654c133-20260704/wasm-browser-smoke-result.json`
    (SHA256
    `56cccf58eac057fad443ae3e4c015632548fd4a8264cdfbdd3f8d60ae7b3ab5d`);
    screenshot SHA256
    `a5732577ba4857d5ebde8722572f1c30285220803f90c0655ee39f435101f0fb`.
    The generic marker `QEMU_WASM_LINUX_BOOT_OK` was not reached:
    `markerSeen=false`, phase `timeout`, elapsed `60216` ms, final line
    `Pthread ... Uncaught RuntimeError: operation does not support unaligned
    accesses`. The live-generated-exec summary at `2268` ms reported
    `reason=generated-exec-dispatch`, `preflight_ready=true`,
    `compat_fallback=true`, `no_silent_fallback=false`, attempts `1`,
    successes `1`, rejects `1`, skips `0`, generated guest instructions `1`,
    generated run entries `1`, generated chain length `1`, generated guest
    instructions per entry `1`, generated coverage `1 / 1`, hotset probe
    attempts `1`, hotset goto sources `1`, hotset target slots read `1`,
    hotset target stale `1`, and one reject reason:
    `chain-target-unsupported=1`. `wasm64Tcg` was enabled but emitted no
    periodic summary before the later abort (`summaryCount=0`,
    `lastSummary=null`), so `node
    scripts/ci/wasm-browser-smoke-x86-metrics-gate.mjs --result
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-654c133-20260704/wasm-browser-smoke-result.json
    --require-tcg --json` failed with missing `wasm64Tcg.summaryCount` and
    `wasm64Tcg.lastSummary`. This compatibility-fallback run proves R4s14
    moved the selected body from body-build rejection to one retired generated
    guest instruction, but it does not by itself prove the required no-hidden
    fallback condition.

    A second bounded Chromium `149.0.7827.55` no-silent-fallback confirmation
    used the same artifact and guest with command: `npm exec --yes
    --package=playwright -- node scripts/ci/wasm-browser-smoke-runner.mjs
    --browser chromium --artifact-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-backend-artifacts-654c133-20260704
    --firmware-dir
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/projects/qemu/pc-bios
    --guest-manifest
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86-r4s8-guest-current/tuxboot-browser-smoke-guest.json
    --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-no-fallback-654c133-20260704/wasm-browser-smoke-result.json
    --screenshot
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-no-fallback-654c133-20260704/wasm-browser-smoke.png
    --port 8216 --timeout-ms 60000 --max-output-bytes 100000
    --page-text-tail-bytes 100000 --wasm64-live-generated-exec
    --wasm64-live-generated-exec-no-fallback
    --wasm64-live-generated-exec-preflight
    --wasm64-live-generated-exec-preflight-limit 100
    --wasm64-tcg-summary --wasm64-tcg-summary-interval 1000`. Result JSON:
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-r4s15-x86-preflight-no-fallback-654c133-20260704/wasm-browser-smoke-result.json`
    (SHA256
    `a0c0722b3fe1e5b8963b6042cf11a67e68c5ed1793f7a6a6e7cd989fcc41eac7`);
    screenshot SHA256
    `a7be2872147f43c98abccce966befc8bf1e10ffc6a999218a602a3492e7aea8c`.
    The generic marker was not reached: `markerSeen=false`, phase `timeout`,
    elapsed `60189` ms, final line `Pthread ... Uncaught RuntimeError:
    Aborted(native code called abort())`. The no-silent summary at `2075` ms
    reported `reason=chain-target-unsupported`, `preflight_ready=false`,
    `compat_fallback=false`, `no_silent_fallback=true`, attempts `1`,
    successes `0`, rejects `1`, skips `0`, generated guest instructions `0`,
    generated run entries `0`, generated chain length `0`, generated coverage
    `0 / 1`, hotset probe attempts `1`, hotset goto sources `1`, hotset
    target slots read `1`, hotset target stale `1`, and
    `chain-target-unsupported=1`. The x86 metrics gate without `--require-tcg`
    reported `runloop.ok=true` but `runloop.acceptanceAllowed=false`; with
    `--require-tcg` it also failed because no `wasm64Tcg` summary was emitted.
    Therefore R4s15 remains rejected for the no-hidden-fallback acceptance
    clause, R4l remains blocked, no speed claim is made, and no Bus Engine OS
    browser proof was run.

- [ ] R4s22 - Expand supported x86 live SoftMMU MemOp families only after
    R4s19/R4s20 identify memory rejects as a remaining dominant blocker.
    DoD: admit alignment flags only with explicit QEMU-equivalent alignment
    checks, add generic `MO_16` load/store lowering, add signed-load
    sign-extension for supported sizes, and keep byte/word/dword/qword RAM
    hits helper-free. Fail closed for unaligned guarded accesses, page
    crossing, TLB miss/fault, MMIO, slow flags, unsupported atomics/endian
    flags, unmirrored state, and unproven `mmu_idx`. Multi-access support
    requires a guard-before-commit design: no guest RAM, env store, register
    flush, counter increment, or dispatch target may commit until every
    guard on the executed path has passed. R4s18 memory rejects were material
    but not dominant (`selected-body-memop-unsupported-alignment=2436`,
    `selected-body-softmmu-multi-access-unsupported=2223`, size `256`,
    sign `126`), so this item is not the next speed-gate driver unless new
    evidence changes that ordering. Fresh R4s21c evidence after the x86
    env-direct work shows alignment `2964` and size `2521` are now material,
    but direct-memory `10986` and multi-access `8301` still outrank them.
    Therefore R4s22 should be batched with the direct-memory/multi-access
    all-or-nothing guard work instead of being run as a narrow MemOp-only
    browser experiment.

- [ ] R4s23 - Apply the reusable RISC-V accelerator lessons to x86
      through guarded x86 implementation slices, not by copying RISC-V timing
      or promoting the rejected env-direct branch. DoD: start from current
      `develop` and implement only the measured x86 blocker that can be made
      generic and fail-closed: direct-memory/multi-access all-or-nothing
      bodies, `MO_16` and alignment-checked ordinary load/store MemOps, or
      precise MMIO/runtime-exit attribution. Before any browser run, add
      deterministic fixtures proving guard-before-commit, no partial RAM/env
      writes on later guard failure, zero helper/`qemu_ld`/`qemu_st` calls on
      clean RAM hits, exact C/header-backed layout constants, and rejection
      for unsafe atomics, unproven alignment, page crossing, MMIO, TLB
      miss/fault, stale metadata, unsupported helper/control flow, and
      unapproved x86 CPU state. Browser proof is limited to a bounded x86
      Chromium preflight that reports generated coverage and the new blocker
      distribution; R4l remains blocked until this materially raises x86
      generated guest-instruction coverage.
      Current crash-analysis input from the rejected env-direct branch:
      the leading suspect is the newly admitted 64-bit direct env store to
      `CPUX86State.segs[R_DS].base` at offset `0x188`, not the visible
      rejected `st32 [r14+0x138]` tail in the result. Current `develop`
      rejects both `st32 [r14+0x130]` and `st [r14+0x188]` and runs to a
      clean timeout; the env-direct branch admits both and crashes after two
      generated bodies. Therefore the first R4s23 implementation branch
      should split this broad widening: keep `DS.base` direct env stores
      fail-closed, test `hflags st32 @0x130` separately, and only re-enable
      `DS.base st64 @0x188` after a field-specific deterministic fixture and
      bounded Chromium proof. The proof command should include generated
      trace flags so a successful body containing `st [r14+0x188]` can be
      correlated with the early `RuntimeError` if it reproduces.

      RISC-V parity review input: the shared accelerator mechanisms needed
      by x86 are already present or partially present on `develop`:
      `TCGWasm64RunContext`, `TCGWasm64RunCounters`,
      `TCGWasm64RunExitReason`, translation metadata lookup/availability,
      `tcg_wasm64_live_generated_exec_try()`, `tcg_wasm64_live_generated_exec_js`,
      `TCGWasm64TLBMirror`, generic SoftMMU/TLB-hit lowering, deterministic
      two-TB chaining fixtures, and invalidation token fixtures. The remaining
      x86 gaps are target-specific coverage and correctness: broader but
      field-exact env/direct memory support, all-or-nothing multi-access
      direct-memory bodies, `MO_16`/signed/alignment MemOp handling, and
      still-fail-closed x86 op/state families such as `movcond`, lazy CC,
      segment, and helper-sensitive state. The first implementation branch
      should therefore target measured R4s21c blockers with deterministic
      fixtures for `SSS`, `SS`, `LS`, `SL`, `SSLS`, and `LSS` access orders,
      especially `st [r14+0x100] size 8`, plus field-split tests for
      `hflags st32 @0x130` and `DS.base st64 @0x188`.

      Follow-up crash-analysis input: the Chromium
      `operation does not support unaligned accesses` error is most likely a
      WASM atomic-alignment trap in static Emscripten-compiled QEMU code after
      generated execution published unsafe x86 CPU state, not a trap from the
      dynamic generated plain load/store itself. `DS.base` is part of the
      x86 segment-cache invariant: QEMU updates selector, base, limit, flags,
      and derived `hflags` together through `cpu_x86_load_seg_cache()`.
      Therefore raw direct env stores to `hflags`, `segs[R_DS].base`, or
      adjacent segment-cache fields must stay rejected until a semantic
      update path is modeled. Add negative regression fixtures for
      `st32 [r14+0x130]`, `st [r14+0x188]`, `st32 [r14+0x138]`, and other
      segment-cache raw stores before taking non-env coverage work. The next
      coverage implementation should prefer ordinary SoftMMU RAM paths:
      `MO_16`, explicit alignment-checked RAM loads/stores, and
      multi-access all-or-nothing RAM/direct-memory guard work that never
      commits RAM, env, register, counter, or dispatch state before every
      later guard passes. Continue rejecting all `MO_ATOM_*` modes except the
      already proven ordinary `MO_ATOM_NONE` subset.

- [ ] R5x - Run the x86_64 Bus Engine OS proof for the x86 supervisor lane
  only after R4l passes. DoD: the accepted package-built Bus Engine OS
  `x86_64` `virtual-server` kernel/rootfs boots cold in browser-hosted
  QEMU/WASM with the x86_64 accelerator and reaches `Reached target
  Multi-User System.` plus login prompt or `QEMU_WASM_SERVICE_READY` within
  `300000` ms, with current artifact hashes, browser version, result JSON,
  screenshot, serial log, and milestone timings archived. This item must not
  use RISC-V smoke measurements to estimate or accept x86_64 progress.

Historical x86_64/WASM evidence below remains useful for rejected mechanisms,
measurement discipline, and non-regression checks. Do not execute the old W2
items as the active implementation path unless they are explicitly rewritten
for the current checked goal lane.

- [ ] W2 - Implement the real browser-Wasm accelerator path behind the
  existing wasm64 QEMU/WASM gate. Do not continue optimizing the rejected
  direct-boundary path as the W2 performance candidate.
  DoD, all required:
  - The backend is selectable and buildable: the Emscripten build with
    `--enable-tcg-wasm64-backend` (or the wasm32 equivalent if W1 selects
    wasm32-first) configures, compiles, and links a runnable
    `qemu-system-x86_64` artifact instead of failing closed.
  - The accelerator exposes a long-running `wasmjit_run()`-style run/exit
    entrypoint. One call into the generated run loop must execute at least
    `1000000` counted guest-instruction-equivalent operations before returning
    for budget expiry in deterministic tests.
  - Generated hot paths chain or dispatch internally inside WebAssembly. They
    must not return to the QEMU main loop after every TB on the measured hot
    path.
  - Common RAM load/store TLB hits use an inline SoftMMU/TLB fast path and do
    not call `qemu_ld`/`qemu_st` helpers on the hit path.
  - Strict compatibility fallback is preserved for unsupported or failed
    generated paths. Performance-proof mode must report and fail unsupported
    hot paths loudly instead of silently treating fallback as accelerator
    success.
  - The accelerator reports dynamic instruction and wall-time metrics in the
    browser result JSON: generated/fallback guest instruction retirement,
    generated-body wall time, TCI dispatch time, TB lookup/main-loop time,
    helper/`qemu_ld`/`qemu_st` counts or time, compile/instantiate time,
    internal chain length or hotset residency, and synthetic exits by reason.
  - Deterministic run-loop, ABI-contract, module-emitter, and generated-output
    equivalence tests pass, plus `node scripts/ci/wasm-browser-smoke-runner-test.mjs`
    and `git diff --check`.
  - The generic Linux Chromium smoke boots to `QEMU_WASM_LINUX_BOOT_OK` with
    the accelerator enabled, records real generated execution and rare
    synthetic exits, and then passes W3's same-commit speed gate.
  This item may land as several commits, but it is not done until all of
  the above hold on one recorded artifact pair.

- [ ] W2l - Prove and batch the next broad lowering family only after W2j and
  W2k. DoD: prove WebAssembly memory-barrier lowering in the deterministic
  emitter first, using the threads `atomic.fence` encoding
  `0xFE 0x03 0x00` in a module that validates in Node and Chromium; then
  batch `mb` with any other structurally enabled high-coverage lowering
  family that W2k exposes. Do not run Chrome/Chromium for a single opcode.
  The browser measurement is accepted only if it records generated coverage
  share and compiled-block count and plausibly answers whether W3 can pass.

- [ ] W2m - Re-plan the backend around true translation-time generated output
  instead of runtime TCI-bytecode compilation. DoD: name and implement the
  smallest structural patch that moves generated byte/function creation into
  the wasm64 translation path before runtime TCI bytecode revalidation, proves
  the per-TB fallback marker still preserves TCI correctness, and produces a
  deterministic test that can fail before any browser run if translated
  generated bytes are absent. Do not add another opcode-specific lowering
  browser measurement until this structural boundary exists and the predicted
  generated coverage share change is written down.

- [ ] W2m-b - Compile from translation-time output material through the
  existing C-callable generated-function boundary. DoD: generated compilation
  for the wasm64 backend reads the per-TB translation output buffer recorded
  by W2m-a, while resolving TCI relative operands against the original TB
  base; strict fallback remains active if generated output is absent,
  truncated, unsupported, or fails to compile; deterministic tests prove the
  emitted compiler path uses separate code and relative-base pointers before
  any browser run. Prediction: this should not be measured with W3 until
  local checks show the compiler consumes translation-time output and a
  focused backend smoke reports nonzero generated execution. The intended
  gate effect is an order-of-magnitude generated coverage increase only after
  this path executes generated blocks broadly; the first local slice may still
  have `0` browser-measured speed change.
  Attempt 2026-07-02 is not accepted as W2m-b complete. It changed the
  generated compiler to consume the translation-time output buffer and added
  bounded generated-block trace diagnostics, but the browser evidence showed
  only `34` generated executions/cache hits out of `53,900,000` to
  `73,820,000` eligible TB entries (`0` ppm in 150 s summaries). A 30 s
  generated-only trace run and a 150 s fallback-enabled run both timed out
  before `QEMU_WASM_LINUX_BOOT_OK`. The generated path compiled only `12`
  blocks and had `fallback_runtime=1`; that is useful failure evidence, not
  meaningful generated coverage. The pointer-width ABI correction from
  `addFunction(..., "ii")` to `addFunction(..., "jj")` was useful evidence
  at the time, but the generated-subset runtime path is not retained because
  later W2m-j evidence disproved the direct-boundary shape as a performance
  fix. The final opt-in-guarded artifact hashes for the historical attempt
  were JS
  `d02596846580898d9a062dd1bf3a0ee04b727447e669733e3662283fb458846`,
  WASM `b70c7ec5bda838094487700cd766197283cb796af723d9e1675ce68dcd541342`,
  manifest `b1d667d55fff5be892a609f833bb9a5b2a1bfad52705ee0785d5e863b20a1c49`.
  The generic Chromium `149.0.7827.55` smoke reached
  `QEMU_WASM_LINUX_BOOT_OK` in `93186` ms with `tci.wasmSubset.enabled=false`,
  `wasm64Tcg.summaryCount=0`, and no generated attempts; result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-subset-optin-final-default-smoke/wasm-browser-smoke-result.json`
  SHA-256 `5f833d7f8002b2e7046ead6359eb089963ffb9eefc4546c7de68baa501147b19`,
  screenshot SHA-256
  `7790c1602b7fc002de8c3020befa4d332828fe041dec420dbda28caa83284ff5`.
  Against the prior native generic TuxBoot time of `1968` ms, this is about
  `47.4x` native. Applied to Bus Engine OS native evidence, it estimates
  about `34.7` minutes to multi-user/login from the `44` second native boot
  and about `45.8` minutes through the `58` second boot-audit marker. The
  five-minute goal still needs roughly a `6.9x` to `9.2x` improvement from
  the current safe fallback path.

- [ ] W3 - Pass the generic speed gate before any long Bus Engine OS proof.
  DoD: same-commit default-TCI artifact and backend artifact run the
  identical generic Chromium smoke back to back on the same host and
  browser build. The backend artifact must reach
  `QEMU_WASM_LINUX_BOOT_OK` at least `25%` faster than the default-TCI
  run. Record both hashes, both timings, and the percentage in this file
  and `docs/devel/wasm-support-plan.rst`. If the gate fails, the next
  lowering/optimization work item must be added here with the measured
  blocker named before more implementation; do not spend a long Bus Engine
  OS run on a failed gate. Attempt 2026-07-02 from QEMU commit
  `5f6431526d412aecf36f9d25d6f0a5450f3dc6ca` failed the gate. Default TCI
  artifact hashes: JS
  `2e4f82e69af410f5eef63fea7def6eb118fb8b3b0bfbe37867feb482382e89d0`,
  WASM `819b89f3e4655c49ab826d5760be07a51b29168aadaa7ad6e1967c0655a6fc6c`,
  manifest
  `2266d95988c96fdab4cbba6ff5a73677f678ab2074baf92bac06225331c68bb2`.
  Backend artifact hashes: JS
  `07dfe2c64a7626d9107a0778094eff428d0a26de99849ff442deb2e15f458846`,
  WASM `e8d48e5a64cedf342549d5cfd84f036752ba2275c35132804a69a5f3cb540418`,
  manifest
  `d0fee6ae386cb3607c11ef74064efc92369b3ceca5a2f22cf17ad4287b425e7c`.
  Both ran in Chromium `141.0.7390.37` using the same Playwright Noble
  container and generic TuxBoot smoke. Default TCI reached
  `QEMU_WASM_LINUX_BOOT_OK` in `91207` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-default-tci-smoke/wasm-browser-smoke-result.json`.
  The backend reached the same marker in `100142` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-backend-context-smoke/wasm-browser-smoke-result.json`.
  That is about `9.8%` slower, not `25%` faster. The backend exported
  nonzero generated counters (`generated_compiled=5`,
  `generated_executed=15363`, `generated_cache_hits=15358`,
  `fallback_unsupported=2510`), but coverage is too small to improve
  wall-clock boot. Current live attribution now points to W2g.

- [ ] W4 - Run the Bus Engine OS `virtual-server` browser proof from the
  gated backend artifact.
  DoD: Chrome/Chromium proof with the accepted `virtual-server` kernel and
  rootfs (current accepted hashes at planning time: kernel
  `3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920`,
  rootfs
  `5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e`;
  use newer accepted hashes if the Bus Engine OS lane publishes them),
  recording result JSON, screenshot, boot milestone timings (kernel,
  `/dev/vda`, rootfs mount, init, hostname, journald, basic target,
  multi-user target, login prompt), final serial state, and artifact
  hashes. Success means the Exact Definition of Done above. A run that
  times out is still recorded evidence: it must name the last milestone
  reached, the milestone-to-milestone deltas against the recorded baseline
  (hostname at about `110000`-`125000` ms), and the next concrete work
  item.

- [ ] W5 - Promote accepted work: commit and push QEMU `develop`, run BusDK
  `./scripts/sync-submodules.sh`, and commit/push the required BusDK and
  supervisor pins with the memo update.
