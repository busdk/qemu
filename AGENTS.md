# AGENTS.md

This QEMU checkout is being used for upstreamable WebAssembly host support
work. Keep changes generic to QEMU unless a task explicitly says otherwise.

## WebAssembly Goal

The active target is making the 64-bit Bus Engine OS `virtual-server` guest
reach normal multi-user boot in browser-hosted QEMU/WASM within five minutes.
Keep the scope narrow:

- Emscripten `wasm64` host builds.
- `riscv64-softmmu` system emulation as the active browser target.
- Chrome or Chromium as the first browser acceptance target.
- TCI console boot must keep working as the regression gate.
- Browser execution through modern APIs with cross-origin isolation.
- Generic QEMU changes only; downstream Bus Engine product work stays
  downstream.

Existing `x86_64-softmmu` QEMU/WASM smoke behavior remains a non-regression
gate. Do not remove or weaken it while adding the RISC-V path.

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

Size work to the active goal's critical path, not to the current session
length. It is acceptable for a session to end with an unfinished large item
and no commit when that large item is the real path to the goal. Do not
substitute a small off-path experiment because it is easier to finish and
commit.

Before starting a QEMU/WASM performance experiment, write down the expected
effect on the gate metric and the mechanism that should produce it. For this
goal, the gate metrics are same-commit wall-clock time against the default TCI
baseline and generated translation-block coverage share. If a change cannot
plausibly move one of those metrics enough to matter, do not spend a browser
run on it.

Match verification cost to the question being answered. Deterministic emitter
and parser tests prove byte encodings, module validity, fallback accounting,
and local semantics. Chrome/Chromium runs are reserved for gate decisions or
batched changes large enough to answer a meaningful performance question.

Check planned work against the engineering rules by mechanism, not by label.
Renaming an opcode-at-a-time generated-subset experiment as backend work does
not make it a different approach. A failed speed gate is a stop point: record
what would have to be true to pass, compare the current approach against that
requirement, and re-plan before iterating.

Do not leave independent goal lanes idle while a long build or browser proof
runs. If QEMU is building or waiting on a browser measurement, advance the
Bus Engine OS measurement lane or another explicitly independent item from
the active plan.

When an environment workaround repeats, promote it to guidance or a runbook
instead of rediscovering it in memo prose. Known examples for this checkout:
sandboxed Node child-process spawning may return `EPERM`, `/tmp` space can be
exhausted by Emscripten artifacts, and submodule/fetch quirks must be handled
through the repository's normal sync flow.

Use the supervisor/workspace `./tmp` area for large WebAssembly artifacts,
browser smoke outputs, guest images, and evidence bundles. Host `/tmp` is a
small partition and should only hold small throwaway files. If an artifact may
later be inspected, archived, or promoted from the supervisor workspace, write
it under workspace `./tmp` from the start instead of staging it in host `/tmp`.

## Evidence

Record browser/runtime evidence in `docs/devel/wasm-support-plan.rst` with:

- exact browser or runtime version;
- exact command or CI-shaped invocation;
- artifact inputs and hashes when relevant;
- result status, marker, timeout, and final serial state;
- whether the result is upstream QEMU evidence or downstream Bus Engine
  integration evidence.

For generated-Wasm execution work, every summary must include generated
coverage share or the raw numerator and denominator needed to compute it:
generated executions plus generated cache hits over total eligible TB
executions for the measured path. Rejection lists are diagnostics only; they
must not steer another one-opcode browser loop.

Do not report the goal complete from a generic Linux smoke alone. The generic
smoke proves QEMU infrastructure; Bus Engine OS remains the downstream guest
proof target.
