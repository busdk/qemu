# AGENTS.md

This QEMU checkout is being used for upstreamable WebAssembly host support
work. Keep changes generic to QEMU unless a task explicitly says otherwise.

## WebAssembly Goal

The shared target is making the 64-bit Bus Engine OS `virtual-server` guest
reach normal multi-user boot in browser-hosted QEMU/WASM within five minutes.
This repository is shared by separate executor environments. Read the
supervisor-root `GOAL.md` and this repository's `PLAN.md` before acting, then
advance only the architecture lane assigned to the current executor.

Keep the scope narrow:

- Emscripten `wasm64` host builds.
- `x86_64-softmmu` and `riscv64-softmmu` system emulation lanes as recorded
  in `PLAN.md`.
- Chrome or Chromium as the first browser acceptance target.
- TCI console boot must keep working as the regression gate.
- Browser execution through modern APIs with cross-origin isolation.
- Generic QEMU changes only; downstream Bus Engine product work stays
  downstream.

Do not apply RISC-V smoke-test improvements to x86_64 estimates, or the
reverse. A cross-ISA result may guide reusable accelerator architecture, but
it changes a target's boot estimate only after the same mechanism is enabled
and measured on that target with a comparable same-commit smoke or Bus Engine
OS proof. Existing QEMU/WASM smoke behavior for the non-owned target remains a
non-regression gate. Do not remove or weaken it while advancing the current
lane.

Graphics, keyboard input, native WebAssembly TCG, persistence, networking, and
other browser runtime features belong in `BACKLOG.md` unless `PLAN.md`
explicitly promotes them as required for the active boot goal.

Bus Engine OS is the downstream proof guest. Do not add Bus Engine product
logic, branding, release policy, package selection, or website UI to upstream
QEMU code.

Do not hard-code the accelerator for Bus Engine OS boot. Real Bus Engine OS
and generic Linux traces may prioritize the next translated-block shapes to
support, but the accepted implementation must be generic QEMU accelerator
machinery: reusable lowering for supported x86_64 TCG/TCI operations,
generic SoftMMU/TLB state, documented synthetic exits, and metrics that apply
to arbitrary guests using those supported operations. Reject fixed guest PCs,
fixed boot-stage checks, product-profile branches, and measured-shape-only
live JavaScript paths as performance solutions.

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

Do not treat boundary-entry coverage as a performance metric. Millions of
calls into a generated wrapper usually mean the accelerator is returning to
QEMU too often. A browser-Wasm accelerator proof must show useful guest work
inside generated Wasm bodies: generated instruction retirement, long
run-loop residency, internal TB chaining or hotset dispatch, inline RAM/TLB
hit handling, and rare synthetic exits. If a path crosses the QEMU/generated
boundary once per TB, it is not accepted as the W2 performance shape even if
the boundary counter is near 100%.

Do not report the goal complete from a generic Linux smoke alone. The generic
smoke proves QEMU infrastructure; Bus Engine OS remains the downstream guest
proof target.

Do not apply RISC-V smoke-test improvements to x86_64 estimates, or the
reverse. A cross-ISA result may guide reusable accelerator architecture, but
it changes a target's boot estimate only after the same mechanism is enabled
and measured on that target with a comparable same-commit smoke or Bus Engine
OS proof.

## Research notes (BusDK docs site)

Authoritative, allowlist-sourced findings for this accelerator live under
`../busdk/docs/docs/research/` (public). Reuse them instead of re-researching:
- `wasm-alignment-and-atomics.md` - WASM plain loads/stores never trap on
  misalignment; WASM ATOMICS require natural alignment and trap otherwise (this
  is V8's "operation does not support unaligned accesses"). Emit plain accesses
  for possibly-unaligned guest loads/stores; NEVER emit a raw WASM atomic
  unless the address is provably aligned - fall back instead.
- `riscv64-atomics-alignment.md` - RV64 A-extension atomics require natural
  alignment; only aligned guest atomics are safe to lower to WASM atomics.
