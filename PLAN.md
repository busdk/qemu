# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support for the 64-bit
browser MVP. Keep Bus Engine product work downstream.
The active working rule is to finish the unchecked `PLAN.md` items first. Only
when the active plan is empty or blocked on a concrete external dependency
should the next highest-value item be moved from `FUTURE_WORK.md` into this
file and then implemented.

## Active Goal

Implement the next browser-hosted Bus Engine WebAssembly MVP by finishing the
active `PLAN.md` work first: QEMU must provide a generic browser-to-guest
service bridge with graphics, keyboard, power-control, and suspend/resume
planning hooks suitable for a 64-bit Bus Engine OS guest; Bus Engine OS and
Bus Engine layers remain downstream consumers that package and run the
in-guest services. If every active `PLAN.md` item is complete or blocked on a
concrete external dependency, promote the highest-value item from the future
plan backlog in `FUTURE_WORK.md` into `PLAN.md` before implementing more work.

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
