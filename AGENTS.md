# AGENTS.md

This QEMU checkout is being used for upstreamable WebAssembly host support
work. Keep changes generic to QEMU unless a task explicitly says otherwise.

## WebAssembly Goal

The active target is making the 64-bit Bus Engine OS `virtual-server` guest
reach normal multi-user boot in browser-hosted QEMU/WASM within five minutes.
Keep the scope narrow:

- Emscripten `wasm64` host builds.
- `x86_64-softmmu` system emulation.
- Chrome or Chromium as the first browser acceptance target.
- TCI console boot must keep working as the regression gate.
- Browser execution through modern APIs with cross-origin isolation.
- Generic QEMU changes only; downstream Bus Engine product work stays
  downstream.

Graphics, keyboard input, native WebAssembly TCG, persistence, networking, and
other browser runtime features belong in `BACKLOG.md` unless `PLAN.md`
explicitly promotes them as required for the active boot goal.

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

## Work Ordering

Finish unchecked `PLAN.md` items before taking new work. If the active plan is
empty or blocked on a concrete external dependency, move the next
highest-value item from `BACKLOG.md` into `PLAN.md` before implementing it.

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
