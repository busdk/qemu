# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support needed for the
current 64-bit browser boot proof. Keep Bus Engine product work downstream.
The active working rule is to finish the unchecked `PLAN.md` items first. Only
when the active plan is empty or blocked on a concrete external dependency
should the next highest-value item be moved from `BACKLOG.md` into this
file and then implemented.

## Active Goal

Make the Bus Engine OS `virtual-server` guest reach normal multi-user boot in
browser-hosted WASM QEMU within five minutes.

The goal is complete only when the real browser-hosted QEMU/WASM path boots
the accepted Bus Engine OS `virtual-server` kernel and root filesystem to
multi-user readiness within `300000` ms.  The proof must use Chrome or
Chromium, the QEMU WebAssembly artifacts produced by this branch, and the
standard `virtual-server` boot path.  Shell-only init bypasses, synthetic
guests, stale artifacts, native-QEMU-only boots, and heavily reduced product
profiles do not satisfy this goal.

Keep unrelated downstream work out of scope.  Do not take over bus-pkg, OPFS
persistence, virtio-net, virtual-desktop packaging, Codex packaging, or
Engine OS package/image work unless a narrow fixture is strictly required to
prove this boot goal.

Every active design note, code change, browser proof, artifact rebuild,
documentation update, commit, push, and BusDK submodule-pin update for this
goal must be represented by a checkbox in this file before it is treated as
accepted work.

## Exact Definition of Done

This goal is done only when all of the following are true:

- [ ] Current QEMU WASM artifacts are built from this branch and their
  JavaScript/WebAssembly SHA-256 hashes are recorded.
- [ ] The proof uses the accepted Bus Engine OS `virtual-server` kernel and
  root filesystem, and their SHA-256 hashes are recorded.
- [ ] The proof runs in Chrome or Chromium and records the exact browser
  version, command line, timeout, QEMU arguments, kernel arguments, and result
  JSON path.
- [ ] The browser-hosted QEMU/WASM run reaches normal multi-user readiness
  within `300000` ms of harness start, using the same elapsed-ms clock the
  harness already records for boot milestones. Normal multi-user readiness
  means the guest serial output contains the systemd line
  `Reached target Multi-User System.` followed by a getty login prompt line,
  or the documented `QEMU_WASM_SERVICE_READY` marker. Weaker markers such as
  hostname, journald, or basic target do not satisfy this item.
- [ ] The result JSON records the boot milestone timings, final readiness
  marker, final serial state, screenshot path, and QEMU artifact hashes.
- [ ] A generic Linux browser smoke test still passes with the same QEMU WASM
  artifact family.
- [ ] The accepted evidence is recorded in this file and in
  `docs/devel/wasm-support-plan.rst`.
- [ ] QEMU `develop` is committed and pushed to `origin/develop`.
- [ ] BusDK `./scripts/sync-submodules.sh` has been run after the QEMU push.
- [ ] Required BusDK and supervisor submodule pins and memos are committed and
  pushed.

The goal is not done if the only passing proof is native QEMU, a generic
smoke guest, a shell-only boot, a stale artifact, or a run that reaches a
weaker marker than normal multi-user readiness.

## Active Work Items

- [x] Keep `PLAN.md` limited to the current five-minute multi-user boot goal and keep unrelated work in `BACKLOG.md`.
- [x] Add opt-in TCI CPU attribution counters and smoke-runner plumbing for
  translation-block entries, dispatches, helper calls, and QEMU load/store
  counts. Validated with `git diff --check`,
  `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
  `node --check scripts/ci/wasm-browser-smoke.mjs`, and
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because sandboxed child-process spawning returns `EPERM`.

The evidence so far is settled and must not be re-litigated with new
micro-experiments: device attribution shows virtio/browser handlers account
for well under one second of a full failed run, the guest is still actively
dispatching TCI translation blocks at timeout, and roughly a dozen
interpreter shortcuts (opcode peepholes, generated TCI subsets, EM_JS block
calls, direct-memory helpers, O3/LTO) were each measured and rejected. The
remaining gap is CPU execution throughput and it needs a multiple-times
speedup, not another percent-level tweak.

Engineering rules for this goal:

1. No new single-opcode, peephole, fused-op, or EM_JS-per-block interpreter
   experiment may be started. Rejected experiment families stay rejected
   unless fresh attribution evidence names a new dominant boundary.
2. No Bus Engine OS long proof (over `300000` ms of browser time) may be
   started from an artifact that has not first beaten the same-commit
   default-TCI generic Chromium smoke by the gate defined below.
3. Every measurement must record artifact SHA-256 hashes, browser version,
   the exact runner command, and the result JSON path, in this file or in
   `docs/devel/wasm-support-plan.rst`.

- [x] W1 - Measure the Memory64 cost with the available address-limited
  comparison artifact. Accepted evidence: QEMU's current Emscripten host
  support has `wasm64` as the supported CPU family; the available comparison
  mode is `--wasm64-32bit-address-limit`, which builds with
  `-sMEMORY64=2`, not a true `-sMEMORY64=0` wasm32 host. Two TCI artifacts
  were built from the same QEMU commit with
  `scripts/ci/wasm-build-artifacts-local.py`: default wasm64
  `/tmp/qemu-w1-wasm64-current` and address-limited
  `/tmp/qemu-w1-wasm64-32bit-address`. The default artifact hashes were
  JS `4dcf436f15651d3b06a350636fa6c480399ea41ab9865c4b17547e8beeb650d0`
  and WASM
  `df7a62f60f8baba2c2440c01aa476c69e511191d42a688c8ae91ed22081a7cf3`.
  The address-limited hashes were JS
  `021b10a1aba4417defd1e96fb6e076756fcc7b5da3279b5a7f6d3b0148428dfa`
  and WASM
  `42c284fb963e36403a33f5298c6c14ec419486651177225e6962fa78a5565a2e`.
  Both passed the identical Chromium `141.0.7390.37` generic Linux smoke
  with the pinned TuxBoot kernel/initramfs, `Nehalem` CPU, `512M` memory,
  and marker `QEMU_WASM_LINUX_BOOT_OK`. Default result
  `/tmp/qemu-w1-smoke-current/wasm-browser-smoke-result.json` reached the
  marker in `97316` ms; address-limited result
  `/tmp/qemu-w1-smoke-32bit-address/wasm-browser-smoke-result.json` reached
  it in `91639` ms. The `5.8%` improvement is below the `20%` decision gate,
  so W2 continues wasm64-first and no default artifact family changes from
  this item.
- [ ] W2 - Implement a real TCG-to-WebAssembly backend behind the existing
  `tcg_wasm64_backend` gate, modeled on the `ktock/qemu-wasm`
  `wasm64-tcg-b` reference (`tcg/wasm64.c`, `tcg/wasm64.h`,
  `tcg/wasm64/tcg-target.c.inc`) without wholesale copying.
  DoD, all required:
  - The backend is selectable and buildable: the Emscripten build with
    `--enable-tcg-wasm64-backend` (or the wasm32 equivalent if W1 selects
    wasm32-first) configures, compiles, and links a runnable
    `qemu-system-x86_64` artifact instead of failing closed.
  - Generated translation blocks execute through a C-callable instantiated
    WebAssembly function boundary (`WasmContext *` style), not through a
    per-block `EM_JS`/JavaScript crossing.
  - Strict fallback is preserved: any TB whose lowering is unsupported, or
    whose compile/instantiate step fails at runtime, executes through the
    existing interpreter path with identical guest-visible semantics. The
    already-committed `TCGWasm64Counters` contract reports nonzero
    generated attempts, compiled blocks, executed blocks, cache hits, and
    per-reason fallback counts in the browser smoke result JSON.
  - Lowering coverage passes `scripts/ci/wasm-tcg-coverage-gate.mjs`
    against the measured hot-op profile with
    `--require-op ld --require-op st --require-op mb
    --require-op tci_setcond32 --require-op brcond` (or the documented
    current hot-op equivalents), using a fresh hot-block summary from the
    backend artifact, not from an old TCI run.
  - The deterministic module-emitter differential tests
    (`scripts/ci/wasm-tb-module-emitter-test.mjs`,
    `scripts/ci/wasm-generated-block-prototype-test.mjs`) and
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs` pass, plus
    `git diff --check`.
  - The generic Linux Chromium smoke boots to `QEMU_WASM_LINUX_BOOT_OK`
    with the backend enabled and with nonzero executed generated blocks.
  This item may land as several commits, but it is not done until all of
  the above hold on one recorded artifact pair.
- [x] W2a - Open the wasm64 backend build path with an explicit C-callable
  fallback boundary. Accepted slice evidence: the `--enable-tcg-wasm64-backend`
  Emscripten build now configures as `TCG backend: experimental wasm64 with
  TCI fallback`, compiles, links, and writes artifacts to
  `/tmp/qemu-w2-backend-fallback`. Artifact hashes:
  `qemu-system-x86_64.js`
  `5dd87847bcfd34019a2c846bf223646d17a23130191789f880dd5bfcba5c3e8a`,
  `qemu-system-x86_64.wasm`
  `20183a4dcd3d577aa62ecc439f9883c977a4d06fa9ba17e7f0b713681d258a40`,
  manifest
  `66e2e7260e576153f8914f99564d1c28041348808a9e260cff65a56250329987`.
  The first build attempt exposed that the reused TCI emitter needs TCI
  target-private opcodes; `tcg/wasm64/tcg-target-opc.h.inc` now includes the
  existing TCI opcode list instead of duplicating it. The selected backend
  owns `tcg_qemu_tb_exec()`, increments a generated-attempt counter, and
  falls back through the renamed TCI entrypoint for unsupported TBs. Checks:
  `git diff --check`, `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
  `node --check scripts/ci/wasm-browser-smoke.mjs`, and
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because sandboxed `spawnSync` returns `EPERM`. The backend artifact passed
  the generic Chromium `141.0.7390.37` TuxBoot smoke and reached
  `QEMU_WASM_LINUX_BOOT_OK` in `92692` ms, writing
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2-smoke-backend-fallback/wasm-browser-smoke-result.json`.
  This slice does not complete W2 because generated WebAssembly blocks are
  not compiled or executed yet and backend counters are not exported to the
  browser result JSON.
- [ ] W2b - Implement the first real generated WebAssembly TB instance path
  behind the W2a boundary. DoD: a backend artifact executes nonzero generated
  blocks through the C-callable `TCGWasm64Context` boundary, preserves TCI
  fallback for unsupported TBs, and exports nonzero
  `TCGWasm64Counters` generated/fallback fields in the generic browser smoke
  result JSON.
- [ ] W3 - Pass the generic speed gate before any long Bus Engine OS proof.
  DoD: same-commit default-TCI artifact and backend artifact run the
  identical generic Chromium smoke back to back on the same host and
  browser build. The backend artifact must reach
  `QEMU_WASM_LINUX_BOOT_OK` at least `25%` faster than the default-TCI
  run. Record both hashes, both timings, and the percentage in this file
  and `docs/devel/wasm-support-plan.rst`. If the gate fails, the next
  lowering/optimization work item must be added here with the measured
  blocker named before more implementation; do not spend a long Bus Engine
  OS run on a failed gate.
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
