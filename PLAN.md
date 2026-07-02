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

## Exact Definition of Done

This goal is done only when all of the following are true:

- [ ] The current browser-hosted Bus Engine OS `virtual-server` boot baseline
  is recorded with exact QEMU artifact hashes, guest kernel/rootfs hashes,
  browser version, command line, timeout/readiness state, and final serial
  marker. Current accepted baseline on 2026-07-01: service readiness time is
  unknown and greater than `420000` ms because Chromium proof
  `/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-current-attribution-20260701.json`
  timed out after `420194` ms without `Reached target Multi-User System.` or
  `QEMU_WASM_SERVICE_READY`.
- [ ] QEMU-side attribution identifies the dominant measured bottleneck for
  that baseline. The accepted bottleneck must be backed by counters or timing
  evidence, not by intuition.
- [ ] The implemented optimization matches the measured bottleneck. CPU work
  must improve hot translation-block execution while preserving strict TCI
  fallback. Device or browser API work must sit behind the matching QEMU
  device/backend boundary.
- [ ] The optimization is disabled by default or otherwise guarded until it is
  proven safe for normal smoke usage, and unsupported blocks, runtime errors,
  validation failures, or disabled flags fall back to the existing TCI path.
- [ ] Generic Chromium Linux smoke passes with the default path and with the
  optimized path enabled. The optimized-path result must include nonzero
  acceleration counters when the optimization is CPU-side.
- [ ] The Bus Engine OS `virtual-server` Chromium proof is rerun with the same
  accepted kernel/rootfs fixture and the optimized QEMU artifact.
- [ ] The Bus Engine OS optimized proof reaches normal systemd
  multi-user/service readiness and the downstream `QEMU_WASM_SERVICE_READY`
  bridge marker in Chromium within `300000` ms using the accepted
  `virtual-server` kernel/rootfs fixture. This is the MVP product bar for a
  usable browser-hosted virtual server boot: five minutes, matching the
  operator's stated acceptable normal-server boot range. A run that only beats
  the old `420000` ms timeout is not enough unless it also reaches readiness;
  if readiness remains above `300000` ms or is not reached, the work must
  record a measured marker-to-marker improvement and promote the next concrete
  QEMU-side bottleneck into this plan before any closeout.
- [ ] Result JSON, screenshot, artifact hashes, elapsed timing, fallback or
  device counters, and baseline comparison are recorded in this file and in
  `docs/devel/wasm-support-plan.rst`.
- [ ] The QEMU branch is committed and pushed to `origin/develop`.
- [ ] `projects/busdk/scripts/sync-submodules.sh` has been run after the QEMU
  push, and required BusDK/supervisor submodule pins and memos are committed
  and pushed.

The goal is not done if only the generic Linux smoke passes, if Bus Engine OS
still times out without a measured next bottleneck, if the optimization works
only by bypassing normal Bus Engine OS boot, or if downstream product work is
used to hide a QEMU execution problem.

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
    - [ ] Run the broad backend generic speed gate:
      DoD is a rebuilt wasm64 artifact, default generic Chromium smoke passing,
      opt-in backend Chromium smoke passing with nonzero generated counters,
      and opt-in wall time faster than the strict-TCI generic baseline before
      any Bus Engine OS long proof is attempted.

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
