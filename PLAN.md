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
  within `300000` ms.
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
- [ ] Build current QEMU WASM artifacts from this branch and record JavaScript/WebAssembly SHA-256 hashes.
- [ ] Run the generic Linux Chrome/Chromium browser smoke with the current artifact family and record the result.
- [ ] Run the Bus Engine OS `virtual-server` Chrome/Chromium browser proof with the accepted kernel/rootfs and record result JSON, screenshot, serial state, and boot milestone timings.
- [ ] If the Bus Engine OS proof does not reach multi-user readiness within `300000` ms, identify the next concrete QEMU-side change needed for that boot target and keep it in this plan before implementation.
- [ ] Commit and push QEMU `develop`, run BusDK `./scripts/sync-submodules.sh`, and commit/push the required BusDK and supervisor pins.
