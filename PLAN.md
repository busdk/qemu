# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support for the 64-bit
browser MVP. Keep Bus Engine product work downstream.

## Current Direction

- [x] Use upstream QEMU's existing Emscripten/wasm64 baseline.
- [x] Prove `x86_64-softmmu` can build for wasm64 with TCI.
- [x] Prove a tiny 64-bit Linux console guest reaches a serial readiness
  marker under Node.js.
- [x] Prove the same generic smoke guest reaches the marker in Chromium.
- [ ] Diagnose Firefox boot progress enough to either make it pass or document
  the concrete Firefox-specific blocker.
- [ ] Keep WebKit out of the first MVP unless wasm64 instantiation becomes
  reliable in the tested runtime.

## Generic QEMU Work

- [x] Add artifact capture for `qemu-system-x86_64.js` and
  `qemu-system-x86_64.wasm`.
- [x] Add machine-readable artifact metadata.
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
- [ ] Add optional browser harness support for a raw rootfs/disk image after a
  suitably small proof image is available.
- [ ] Keep the accepted smoke profile stable while diagnostic arguments vary.
- [ ] Continue recording browser/runtime versions, commands, results, and
  failure modes in `docs/devel/wasm-support-plan.rst`.

## Bus Engine OS Downstream Proof

- [ ] Treat Bus Engine OS as the downstream proof guest, not as upstream QEMU
  test data.
- [ ] Define the Bus Engine OS browser-lab guest artifact contract:
  kernel, initramfs or rootfs/disk image, firmware inputs, checksums, memory
  size, CPU model, boot arguments, readiness marker, and expected serial text.
- [ ] Use the existing Bus Engine OS `virtual-server` profile as the first
  downstream input path because it is already the accepted console-oriented
  QEMU image profile.
- [ ] Document the expected downstream build command:
  `bus engine os build image --profile virtual-server`, with the default host
  architecture selected automatically.
- [ ] Build or consume a minimal x86_64 Bus Engine OS console artifact that can
  boot without networking or graphics.
- [ ] Boot that Bus Engine OS artifact through the generic QEMU/WASM browser
  harness in Chromium.
- [ ] Capture serial evidence proving Bus Engine OS identity, for example
  `/etc/os-release` plus a deterministic `BUS_ENGINE_OS_BROWSER_LAB_OK`
  marker.
- [ ] Capture a screenshot-like browser preview suitable for the
  `busdk.com/engine/` product page.
- [ ] Keep the website preview code and product presentation outside upstream
  QEMU.

## Later Work

- [ ] Design native wasm64 TCG before implementation.
- [ ] Prototype wasm64 TCG in small instruction-family patches.
- [ ] Add QMP or structured browser-control integration only after the
  console MVP is stable.
- [ ] Treat networking, persistence, WebGPU, and graphical desktop support as
  later research tracks.

## Definition Of Done

- [ ] Upstream QEMU branch has reviewable incremental patches for the generic
  64-bit WebAssembly host path.
- [ ] Developer documentation explains exact upstream baseline, browser
  requirements, runtime limits, tests, and known gaps.
- [ ] Generic QEMU smoke tests prove a 64-bit Linux serial boot in Node.js and
  at least one browser.
- [ ] Downstream Bus Engine OS proof boots through the generic QEMU/WASM
  browser harness and produces serial evidence plus a website-preview artifact.
- [ ] No Bus Engine product logic is added to upstream QEMU code.
