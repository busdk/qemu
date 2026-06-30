# AGENTS.md

This QEMU checkout is being used for upstreamable WebAssembly host support
work. Keep changes generic to QEMU unless a task explicitly says otherwise.

## WebAssembly Goal

The active target is a 64-bit browser MVP:

- Emscripten `wasm64` host builds.
- `x86_64-softmmu` system emulation.
- TCI console boot must keep working as the regression gate.
- Browser graphics and keyboard input are part of the active MVP expansion.
- Native WebAssembly TCG later.
- Browser execution through modern APIs with cross-origin isolation.
- Chrome or Chromium as the first browser acceptance target. Treat Firefox
  and WebKit as compatibility tracking unless maintainers explicitly widen
  the MVP browser matrix.

Bus Engine OS is the downstream proof guest. Do not add Bus Engine product
logic, branding, release policy, package selection, or website UI to upstream
QEMU code.

## Boundary

QEMU changes may provide generic build support, browser smoke harnesses,
artifact manifests, serial-console proof paths, 2D browser display/input
surfaces, diagnostics, documentation, and future generic browser integration
points.

Downstream Bus Engine work owns:

- building the Bus Engine OS kernel and root filesystem;
- selecting packages and profiles;
- producing website preview artifacts for `busdk.com/engine/`;
- product UI, commercial release, and support boundaries.

The intended downstream acceptance shape is a browser-runnable Bus Engine OS
demo with serial diagnostics, visible graphics, and keyboard input that can
appear on the Bus Engine product website as a screenshot-like or live-preview
item. Upstream QEMU should only provide the generic WebAssembly emulator
capability needed by that proof.

## Evidence

Record browser/runtime evidence in `docs/devel/wasm-support-plan.rst` with:

- exact browser or runtime version;
- exact command or CI-shaped invocation;
- artifact inputs and hashes when relevant;
- result status, marker, timeout, and final serial state;
- whether the result is upstream QEMU evidence or downstream Bus Engine
  integration evidence.

Do not report the goal complete from a generic Linux smoke alone. The generic
smoke proves QEMU infrastructure; Bus Engine OS remains the downstream guest
proof target.
