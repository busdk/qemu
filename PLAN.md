# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support for the 64-bit
browser MVP. Keep Bus Engine product work downstream.
The active working rule is to finish the unchecked `PLAN.md` items first. Only
when the active plan is empty or blocked on a concrete external dependency
should the next highest-value item be moved from `FUTURE_WORK.md` into this
file and then implemented.

## Active Goal

Implement QEMU/WASM hot-block instrumentation for the wasm64 TCI browser path.
QEMU must emit structured, opt-in translation-block and interpreter-hotspot
evidence for the generic browser smoke and the downstream Bus Engine OS
browser-hosted service proof while preserving existing TCI behavior when the
instrumentation is disabled. This lane must not take over the downstream
bus-pkg, OPFS persistence, virtio-net, virtual-desktop packaging, Codex
packaging, or Engine OS environment work owned by the parallel agent. Work from
this plan before taking any new backlog item. If every active `PLAN.md` item is
complete or blocked on a concrete external dependency, promote the
highest-value useful work item from the future plan backlog in
`FUTURE_WORK.md` into `PLAN.md` before implementing more work.

Current-goal tracking rule: every code change, browser proof, artifact rebuild,
documentation update, commit, push, and BusDK submodule-pin update for this
hot-block instrumentation lane must be represented by a checkbox in this file
before it is treated as accepted work.

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

- [ ] Define the wasm64 TCG/backend acceleration design before implementation:
  DoD is a developer note that explains how QEMU TCG IR can map to generated
  WebAssembly, how translated blocks call back into QEMU helpers, how guest
  RAM is accessed, how block lookup and invalidation work, which browser APIs
  are required, which part can be implemented first, and why TCI remains the
  correctness fallback for unsupported or disabled paths.
- [ ] Add a TCI fallback invariant to every generated-WASM execution
  milestone: DoD is that unsupported opcodes, helper paths, browser/runtime
  failures, validation failures, disabled optimization flags, or cache
  rejection fall back to TCI without removing the already accepted 64-bit
  browser console boot path or the generic service-bridge API.
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
- [ ] Add a minimal generated-Wasm block prototype outside the full backend:
  DoD is a tiny QEMU test harness that emits, validates, compiles,
  instantiates, and executes one or more simple generated WebAssembly
  functions in Node.js and Chrome/Chromium without participating in normal
  guest execution, plus documentation of browser compile latency and memory
  behavior.
- [ ] Prototype integer ALU translation as the first wasm64 generated-WASM
  fast path: DoD is a small patch set for a narrow, named instruction or TCG
  op family with TCI fallback, deterministic TCG tests, differential
  comparison against native QEMU TCG where practical, and no regression in the
  accepted TCI browser boot or generic service-bridge smoke.
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
