# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support for the 64-bit
browser MVP. Keep Bus Engine product work downstream.

## Current Direction

- [x] Use upstream QEMU's existing Emscripten/wasm64 baseline.
- [x] Prove `x86_64-softmmu` can build for wasm64 with TCI.
- [x] Prove a tiny 64-bit Linux console guest reaches a serial readiness
  marker under Node.js.
- [x] Prove the same generic smoke guest reaches the marker in Chrome or
  Chromium.
- [x] Keep the browser MVP focused on Chrome/Chromium. Treat Firefox and
  WebKit as compatibility tracking after the accepted Bus Engine OS proof.

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
- [x] Define the Bus Engine OS browser-lab guest artifact contract:
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
  SDL canvas and types through Playwright only when `--display=sdl`, rejects
  keyboard injection in default `display=none` mode, and records non-secret
  input evidence in the result JSON.
- [x] Verify the wasm64 SDL build path enough to choose the next graphics
  implementation step: DoD is container evidence that Emscripten's SDL2 port
  works with `-sUSE_SDL=2`, QEMU configure reports `SDL support: YES 2.32.0`
  for `--enable-sdl`, and the `qemu-system-x86_64.js` target compiles through
  the QEMU SDL 2D/input sources and reaches the final link step.
- [ ] Define the generic browser graphics/input MVP boundary: DoD is a
  developer note that makes browser graphics and keyboard input part of the
  MVP expansion, keeps WebGPU and accelerated 3D out of scope, selects the
  first QEMU display/input device path to expose in a browser, and records why
  the implementation stays generic QEMU infrastructure rather than Bus Engine
  product code.
- [ ] Add a browser display backend proof for QEMU/WASM: DoD is a generic
  display path that receives QEMU surface updates from the selected emulated
  display device and renders them into a browser canvas or equivalent 2D
  browser surface, with no guest-specific assumptions.
- [ ] Add deterministic display harness coverage: DoD is a non-guest or tiny
  guest test path that produces a known visual frame, captures the browser
  canvas output, and compares stable pixels or a stable image hash while
  preserving the screenshot artifact on failure.
- [ ] Add browser keyboard input mapping: DoD is a browser-side input bridge
  that captures focused keyboard events, maps printable keys, modifiers,
  Enter, Backspace, Tab, Escape, arrows, and function keys to the selected QEMU
  input path, and avoids stealing browser shortcuts that cannot safely be
  captured.
- [ ] Add deterministic keyboard harness coverage: DoD is a browser test that
  focuses the emulator surface, sends a known key sequence through Playwright
  or an equivalent runner, and observes the expected guest-visible response
  through serial output, display output, or a structured test hook.
- [ ] Add pointer/focus policy for the interactive surface: DoD is a minimal
  browser UI policy for focus, blur, keyboard capture, paste handling, pointer
  lock if used, and visible input state, with accessibility-safe escape
  behavior so the browser tab remains controllable.
- [ ] Extend the generic guest manifest for graphics/input requirements: DoD is
  manifest metadata for display mode, preferred device, expected resolution,
  keyboard test sequence, expected visual marker, screenshot output, and
  whether serial-only fallback is acceptable for that run.
- [ ] Prove a generic Linux graphical/input smoke before Bus Engine OS desktop:
  DoD is a Chrome/Chromium run where QEMU/WASM boots a small 64-bit Linux guest
  with the selected display/input devices, renders a stable visible marker,
  accepts keyboard input, and records result JSON plus screenshot evidence.
- [ ] Prove Bus Engine OS with graphics and keyboard in the browser: DoD is a
  Chrome/Chromium run where the downstream Bus Engine OS artifact reaches a
  visible graphical or framebuffer-backed state, accepts a deterministic
  keyboard sequence, preserves serial and screenshot evidence, and records any
  limitations separately from the already accepted serial-console proof.
- [ ] Update the browser MVP acceptance definition after graphics/input proof:
  DoD is that the MVP is no longer described as serial-console-only; it
  requires 64-bit QEMU/WASM boot, visible graphics output, keyboard input,
  serial diagnostics, result JSON, screenshot artifacts, and clear fallback
  language for non-interactive runs.

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

## Later Work

- [ ] Add QMP or structured browser-control integration only after the
  console MVP is stable.
- [ ] Treat networking, persistence, WebGPU, accelerated 3D, and richer
  graphical desktop support as later research tracks.

## Definition Of Done

- [x] Upstream QEMU branch has reviewable incremental patches for the generic
  64-bit WebAssembly host path.
- [x] Developer documentation explains exact upstream baseline, browser
  requirements, runtime limits, tests, and known gaps.
- [x] Generic QEMU smoke tests prove a 64-bit Linux serial boot in Node.js and
  at least one browser.
- [x] Downstream Bus Engine OS proof boots through the generic QEMU/WASM
  browser harness and produces serial evidence plus a website-preview artifact.
- [x] No Bus Engine product logic is added to upstream QEMU code.
