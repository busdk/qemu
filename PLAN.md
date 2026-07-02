# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support needed for the
current 64-bit browser boot proof. Keep Bus Engine product work downstream.
The active working rule is to finish the unchecked `PLAN.md` items first. Only
when the active plan is empty or blocked on a concrete external dependency
should the next highest-value item be moved from `BACKLOG.md` into this
file and then implemented.

## Active Goal

Follow the supervisor-root `GOAL.md` for the active five-minute browser
multi-user boot goal. The current target is no longer the older x86_64 browser
TCI proof; it is an accepted Bus Engine OS `riscv64` `virtual-server` guest
running in browser-hosted QEMU/WASM through an opt-in RISC-V 64 to WebAssembly
accelerator.

The goal is complete only when the real browser-hosted QEMU/WASM path boots
the accepted package-built Bus Engine OS `riscv64` `virtual-server` kernel and
root filesystem to multi-user readiness within `300000` ms. The proof must use
Chrome or Chromium, the QEMU WebAssembly artifacts produced by this branch, and
the standard `virtual-server` boot path. Shell-only init bypasses, synthetic
guests, stale artifacts, native-QEMU-only boots, snapshots, hibernate/restore,
preinitialized RAM, and heavily reduced product profiles do not satisfy this
goal.

Keep unrelated downstream work out of scope. Do not take over bus-pkg, OPFS
persistence, virtio-net, virtual-desktop packaging, Codex packaging, or Engine
OS package/image work except for the narrow Bus Engine OS `riscv64` fixture
work required to prove this boot goal. Existing x86/x86_64, aarch64, and TCI
fallback behavior must keep working unless a regression is explicitly recorded
and accepted.

Every active design note, code change, browser proof, artifact rebuild,
documentation update, commit, push, and BusDK submodule-pin update for this
goal must be represented by a checkbox in this file before it is treated as
accepted work.

## Exact Definition of Done

This goal is done only when all of the following are true:

- [ ] Current `riscv64-softmmu` QEMU WASM artifacts are built from this branch
  and their JavaScript/WebAssembly SHA-256 hashes are recorded.
- [ ] The proof uses the accepted Bus Engine OS `riscv64` `virtual-server`
  kernel and root filesystem, and their SHA-256 hashes are recorded.
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
- [ ] A generic RISC-V Linux browser smoke test still passes with the same QEMU
  WASM artifact family.
- [ ] Existing x86_64 QEMU/WASM TCI smoke behavior remains working or any
  deviation is recorded with an explicit acceptance decision.
- [ ] The accepted evidence is recorded in this file and in
  `docs/devel/wasm-support-plan.rst`.
- [ ] QEMU `develop` is committed and pushed to `origin/develop`.
- [ ] BusDK `./scripts/sync-submodules.sh` has been run after the QEMU push.
- [ ] Required BusDK and supervisor submodule pins and memos are committed and
  pushed.

The goal is not done if the only passing proof is native QEMU, a generic smoke
guest, a shell-only boot, a stale artifact, a snapshot/restore shortcut, or a
run that reaches a weaker marker than normal multi-user readiness.

## Active Work Items

- [x] R0 - Rebase the active QEMU/WASM plan from the older x86_64 throughput
  lane to the RISC-V 64 accelerator lane from `GOAL.md`. DoD: `PLAN.md`
  names `riscv64-softmmu` artifacts and Bus Engine OS `riscv64`
  `virtual-server` proof as the active gate, preserves the older x86_64
  evidence as historical context only, and names the first implementation
  gates for baseline `riscv64-softmmu` WASM boot, RV64 accelerator design, and
  same-commit generic speed proof. Accepted 2026-07-03: this plan now names
  the `riscv64-softmmu` artifact family, Bus Engine OS `riscv64`
  `virtual-server` final proof, strict fallback/non-regression requirements,
  and R1-R5 gates for baseline, design, first accelerator slice, speed proof,
  and final Bus Engine OS proof.
- [ ] R1 - Establish the browser and native RISC-V baselines before
  acceleration. DoD: build or obtain current `qemu-system-riscv64` native and
  WASM artifacts, boot a generic RISC-V Linux smoke in Chromium with default
  TCI, record exact commands, browser version, artifact hashes, result JSON,
  and compare wall time to native RISC-V QEMU and the previous x86_64 browser
  evidence.
- [ ] R2 - Add the RV64-to-WASM accelerator design and fail-closed boundary.
  DoD: document CPU state layout, register residency, synthetic exits
  (`BUDGET`, `MMIO`, `TLB_MISS`, `INTERRUPT`, `CSR`, `INVALID`, `FATAL`),
  inline RAM/TLB-hit handling, invalidation, strict TCI fallback,
  no-silent-fallback performance mode, counters, and non-regression gates
  before the hot path is enabled.
- [ ] R3 - Implement the first selectable `riscv64-softmmu` WASM accelerator
  slice. DoD: generated RV64 execution is opt-in, unsupported or failed
  lowering falls back to TCI with identical guest-visible behavior, deterministic
  tests cover supported integer/branch/load/store/CSR exits, counters report
  generated versus fallback execution, and x86_64 TCI browser smoke is not
  regressed.
- [ ] R4 - Prove performance before Bus Engine OS long runs. DoD: a same-commit
  Chromium generic RISC-V accelerator smoke is at least 25% faster than
  default RISC-V TCI, and microbenchmarks show at least 3x over RISC-V TCI for
  hot ALU/branch and TLB-hit RAM paths with at least 1,000,000
  guest-instruction-equivalent operations per `wasmjit_run()` call.
- [ ] R5 - Run the final Bus Engine OS proof only after R1-R4 pass. DoD: the
  accepted package-built Bus Engine OS `riscv64` `virtual-server` image boots
  cold in browser-hosted QEMU/WASM with the accelerator and reaches
  `Reached target Multi-User System.` plus login prompt or
  `QEMU_WASM_SERVICE_READY` within `300000` ms, with all logs and hashes
  archived.

Historical x86_64/WASM evidence below remains useful for rejected mechanisms,
measurement discipline, and non-regression checks. Do not execute the old W2
items as the active implementation path unless they are explicitly rewritten
for `riscv64-softmmu`.

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
4. Generated-Wasm work is steered by gate metrics, not rejection-list churn.
   Every summary must record generated coverage share as
   `(generated_executed + generated_cache_hits) / total eligible TB
   executions` or the exact raw numerator and denominator used. A lowering
   change that cannot plausibly move coverage share by an order of magnitude
   does not justify a browser run.
5. W2 continues by closing the structural backend gap: translation-time
   lowering through `tcg/wasm64/tcg-target.c.inc`, with TCG ops entering the
   backend before TCI bytecode exists and per-TB fallback metadata attached to
   generated output. Runtime revalidation of TCI bytecode and threshold-hot
   narrow block compilation is diagnostic scaffolding only; it must not remain
   the hot path for W2.
6. A failed W3 gate is a re-plan point. Do not run another same-family
   browser measurement until the plan names the mechanism that should move
   the same-commit wall-clock gate.

- [x] W2m-analysis - Rank the remaining plan options before more
  implementation. DoD: use existing measurements or cheap deterministic
  checks to estimate each option's likely effect on the `300000` ms
  Bus Engine OS gate and the W3 generic speed gate, then record why the next
  implementation item is expected to move generated coverage or wall-clock
  time. Accepted analysis so far:
  - Current default browser TCI is about `51x` slower than native QEMU for
    the same generic TuxBoot marker: W2l-c reached
    `QEMU_WASM_LINUX_BOOT_OK` in `100472` ms, while the matching native QEMU
    command reached the same marker in `1968` ms. Applying that ratio to the
    accepted Bus Engine OS native `virtual-server` boot evidence
    (`44` seconds to multi-user/login, `58` seconds through the boot-audit
    service) predicts roughly `37` to `49` minutes in browser TCI. The
    five-minute goal therefore needs about a `7.5x` to `10x` effective
    improvement from QEMU execution throughput, guest boot trimming, or both.
  - W1 Memory64/address-limit work measured only a `5.8%` improvement. This
    is useful evidence but far below the required multiple-times speedup.
  - Device/browser API attribution remains too small to explain the gap:
    previous measurements put virtio/browser handlers below one second while
    TCI dispatch remains active at timeout. Optimizing device plumbing first
    cannot plausibly move the five-minute gate.
  - The opcode-at-a-time generated-subset path is rejected by W2d through W2j
    and W3 evidence. It compiled only `3` to `6` generated blocks, reached at
    most `414` ppm generated coverage when coverage accounting existed, and
    every generated-only browser smoke was slower than the same-commit W3
    default TCI baseline.
  - Guest-side Bus Engine OS trimming is useful but secondary. Even an
    aggressive native boot reduction from `44` seconds to `20` seconds would
    still project to about `17` minutes at the current browser/native ratio.
    The downstream B2/B3 lane should run in parallel, but it cannot replace a
    QEMU execution-throughput fix.
  - W2l-c shows the remaining high-leverage boundary: translation-time
    metadata sees `65920` generated-candidate TBs and `102077` lowerable TBs
    out of `251212` translated TBs, with `8121286` generated-candidate
    supported ops against `866347` unsupported ops. The W2c hot-block model
    also showed `92.2%` supported dynamic op coverage. The missing piece is
    not the next opcode; it is attaching generated output to translated TBs
    before runtime TCI-bytecode revalidation.
  Prediction for W2m: a structural translation-time generated-output path is
  the only remaining QEMU item in the current plan with enough measured
  leverage to move W3. The first accepted W2m implementation must prove, with
  deterministic tests before any browser run, that translated TB metadata can
  carry concrete generated output or a fallback marker. It should not spend a
  browser run until that local evidence predicts nonzero generated execution
  and materially higher generated coverage share.

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
- [x] W2b - Implement the first real generated WebAssembly TB instance path
  behind the W2a boundary. DoD: a backend artifact executes nonzero generated
  blocks through the C-callable `TCGWasm64Context` boundary, preserves TCI
  fallback for unsupported TBs, and exports nonzero
  `TCGWasm64Counters` generated/fallback fields in the generic browser smoke
  result JSON. Accepted slice evidence: the backend now exposes the active
  `TCGWasm64Counters` to the fallback TCI executor, uses the
  `TCGWasm64Context` pointer shape for the live generated-block call, and
  reports bounded `qemu-wasm64-tcg` summaries into browser result JSON. The
  build command was:
  `python3 scripts/ci/wasm-build-artifacts-local.py --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2b-context-counters --jobs auto --configure-arg=--disable-tcg-interpreter --configure-arg=--enable-tcg-wasm64-backend`.
  Artifact hashes: `qemu-system-x86_64.js`
  `07dfe2c64a7626d9107a0778094eff428d0a26de99849ff442deb2e15f458846`,
  `qemu-system-x86_64.wasm`
  `e8d48e5a64cedf342549d5cfd84f036752ba2275c35132804a69a5f3cb540418`,
  manifest
  `d0fee6ae386cb3607c11ef74064efc92369b3ceca5a2f22cf17ad4287b425e7c`.
  Checks: `git diff --check`,
  `node --check scripts/ci/wasm-browser-smoke.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`,
  `node --check scripts/ci/wasm-tb-module-emitter.mjs`,
  `node --check scripts/ci/wasm-generated-block-prototype.mjs`,
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because sandboxed child-process spawning returns `EPERM`,
  `node scripts/ci/wasm-tb-module-emitter-test.mjs`, and
  `node scripts/ci/wasm-generated-block-prototype-test.mjs`. Chromium
  `141.0.7390.37` reached `QEMU_WASM_LINUX_BOOT_OK` in `101122` ms with
  result JSON at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2b-context-counters-smoke/wasm-browser-smoke-result.json`.
  The last exported `wasm64Tcg` summary reported
  `generated_attempts=18469`, `generated_compiled=3`,
  `generated_executed=16023`, `generated_cache_hits=16020`, and
  `fallback_unsupported=2446`, with runtime/helper/load/store fallback
  counts at zero. This completes W2b only; W2 remains open until the
  lowering coverage gate and the full same-artifact generic smoke evidence
  are accepted.
- [x] W2c - Produce the fresh backend hot-block coverage evidence required
  before expanding generated lowering. DoD: build a backend artifact from
  the current QEMU commit with `--enable-tcg-wasm64-backend` and
  `--enable-tcg-hotblocks`, run the generic Chromium smoke with
  `--tcg-hotblocks`, run `scripts/ci/wasm-tcg-coverage-gate.mjs` against
  that backend result with the W2 required ops, record the artifact hashes,
  browser version, result JSON, coverage-gate JSON, supported ratio, and
  top unsupported ops, then name the next lowering work item from that
  fresh evidence. Accepted evidence: the artifact was built with
  `python3 scripts/ci/wasm-build-artifacts-local.py --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2c-backend-hotblocks --jobs auto --configure-arg=--disable-tcg-interpreter --configure-arg=--enable-tcg-wasm64-backend --configure-arg=--enable-tcg-hotblocks`.
  Artifact hashes: JS
  `3325c226fc1d2e53382d7b8f366d372d9bd1a023beedbd2fa832d7a4716f8b64`,
  WASM `5a06b0ddf68387fcdb22cddccefcacd1016ee7bdd97695aac44d3f3f00ffdf5f`,
  manifest
  `68737c61a3014fa753e0d8f680ed0aed45b512b856ae880199325cac80f9686c`.
  The first smoke attempt failed before QEMU boot because the temporary
  runner passed invalid `--tcg-hotblocks-op-limit 0`; the corrected run used
  the default positive limit. Chromium `141.0.7390.37` reached
  `QEMU_WASM_LINUX_BOOT_OK` in `121568` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2c-backend-hotblocks-smoke2/wasm-browser-smoke-result.json`.
  The final hot-block summary recorded `tci_ops=134217728`,
  `helper_calls=509064`, `qemu_loads=4670379`, and
  `qemu_stores=4578049`. Coverage gate JSON:
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2c-backend-hotblocks-smoke2/wasm-tcg-coverage-gate.json`.
  The gate passed its current deterministic model with supported ratio
  `0.922023319087302` and required ops present. Top unsupported sampled ops
  were `st8=3419640`, `ld32u=1858720`, `st32=1445667`,
  `extract=1257956`, `call=509064`, `goto_ptr=432366`,
  `sub=373326`, `shr=336241`, `shl=273473`, and `and=250887`.
  The same run's live backend counters still showed narrow execution:
  `generated_attempts=18829`, `generated_compiled=5`,
  `generated_executed=16100`, `generated_cache_hits=16095`, and
  `fallback_unsupported=2729`. This means the next work must improve live
  generated eligibility/attribution, not merely pass the current model gate.
- [x] W2d - Attribute live generated rejection reasons from backend runs
  before expanding lowering. DoD: a backend generic Chromium smoke records
  the generated path's top unsupported TCI opcodes in result JSON, not just
  aggregate `fallback_unsupported` counts, and the next lowering task is
  selected from those live rejection counters plus the W2c hot-block profile.
  Accepted evidence: the existing W2b backend artifact was rerun in Chromium
  `141.0.7390.37` with `--tci-wasm-subset`,
  `--tci-wasm-generated-only`, threshold `1024`, max ops `512`, and interval
  `10000`. It reached `QEMU_WASM_LINUX_BOOT_OK` in `108966` ms with result
  JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2d-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `b85d14ec14afc1c9cce376cff3dad70929162e7cc8383b507822fc3693bb01e3`).
  The last `top_generated_unsupported_ops` list contained only
  `ld32u=2292`, so the first live lowering target was `ld32u`.
- [x] W2e - Lower the first two live generated blockers, `ld32u` and
  `tci_setcond32`, while preserving strict TCI fallback. DoD: each lowering
  is selected from a fresh generated-only backend smoke, the artifact builds,
  the generic Chromium smoke still reaches `QEMU_WASM_LINUX_BOOT_OK`, and the
  next live blocker is recorded. Accepted evidence: after adding `ld32u`, the
  backend artifact at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2e-ld32u`
  had hashes JS
  `b0580c89612c11aaaea3fe8fcb44bd084911ed3b7db19f1c17845de3c66d7abf`,
  WASM `1e3b70085556db0621dd8a81535b18c522bcf1595a33c231d774ef21a593bcdd`,
  and manifest
  `6fdcbd6fa1e35f5a683c41bebe66fc387a352b1af5af7b1aa2176dc91ada7a9e`.
  Chromium reached the marker in `108293` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2e-ld32u-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `922ef5764bcd7246ee911550d2b0521fe7ce61a5c067d8e38a73dc3699387cd8`).
  Live rejection moved to `tci_setcond32=2425` and `st8=1`. After adding
  `tci_setcond32`, the backend artifact at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2f-ld32u-setcond32`
  had hashes JS
  `b92c6e7c869bebc0e20b3b85221971d6127df32194124fe634c9c1a3bb5f3463`,
  WASM `e2f25be24972127c2e69976c1cb3345becf07fca31546d66104cfd5da618b4cc`,
  and manifest
  `b5ef7cd5fbbd0c46b823cb83bb24959b77e6f01d0b66b4ed1d3a1ee055499353`.
  Chromium reached the marker in `110052` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2f-ld32u-setcond32-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `6dbce0cee236654a7942cd63cbdd1836922eec4deb140ef9f0edced1451520db`).
  Live rejection moved to `brcond=2934` and `st8=1`; wall-clock time did not
  improve enough for W3, so the next work remains lowering coverage rather
  than a Bus Engine OS proof.
- [x] W2f - Lower live generated `brcond` without weakening fallback
  semantics. DoD: implement only the forward-branch forms that can be
  represented safely in the generated WebAssembly block, keep unsupported or
  complex branch shapes on TCI fallback, run the generated-only generic
  Chromium smoke, and record the next `top_generated_unsupported_ops` list.
  Accepted evidence: the backend artifact at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2g-brcond`
  was built with `--enable-tcg-wasm64-backend` and
  `--disable-tcg-interpreter`. Artifact hashes: JS
  `9e947c2eefeb5c1cc4ce1e46493bd49c7b39cce52c0b49fbcdd5a004a429350b`,
  WASM `128b432fdf4c4304372af8f6317ebfaf3fcb1cf0d7c3dc54d0967fa1d3cfca29`,
  manifest
  `e356c7050b6e11e5acab057a8cf7b42d83ad08fe36aa45cd0fb1557eafdaeefe`.
  Chromium `141.0.7390.37` reached `QEMU_WASM_LINUX_BOOT_OK` in
  `106628` ms with generated-only subset reporting enabled. Result JSON:
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2g-brcond-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `f1079cc23fd69d35d334368bc62bf5a765047d12353d878ad761b265c0cff7bd`).
  The final generated summary reported `generated_compiled=4`,
  `generated_executed=15519`, `generated_cache_hits=15515`,
  `generated_compile_failed=0`, and the next live rejection list moved to
  `st8=2273` plus `brcond=2`. This accepts the forward-branch lowering
  slice but does not complete W2 or W3.
- [x] W2g - Lower live generated `st8` while preserving strict fallback
  semantics. DoD: implement byte-store lowering only for address forms that
  can use the existing generated memory path safely, keep unsupported store
  shapes on TCI fallback, run the generated-only generic Chromium smoke, and
  record the next `top_generated_unsupported_ops` list before deciding
  whether to expand lowering or rerun W3. Accepted evidence: the backend
  artifact at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2h-st8`
  was built with `--enable-tcg-wasm64-backend` and
  `--disable-tcg-interpreter`. Artifact hashes: JS
  `d1e4865debf52a52e80b854d09f4ca365977a9fd84bb93ab9d574613d9e765fe`,
  WASM `596d22c1c9c13d3d2b028b4143bfdb1905460786ec200079394e1f7907c158eb`,
  manifest
  `e6c20a3b1e1e080bff4eee7e53fc843052d1ce48bf66d743ef0ec99ba49051b9`.
  Chromium `141.0.7390.37` reached `QEMU_WASM_LINUX_BOOT_OK` in
  `108476` ms with generated-only subset reporting enabled. Result JSON:
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2h-st8-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `912f08b23181016cdf1d945aee035ff39f7a8829951a55abb72d1f835e8b7c93`).
  The final generated summary reported `generated_compiled=6`,
  `generated_executed=14264`, `generated_cache_hits=14258`,
  `generated_compile_failed=0`, and the next live rejection list moved to
  `ld=1606`, `mb=443`, `st=155`, `st32=6`, and `brcond=1`. This accepts the
  byte-store lowering slice but does not complete W2 or W3.
- [x] W2h - Lower the next live direct-memory blockers, starting with
  generated `ld`, `st`, and `st32`, while preserving strict fallback
  semantics. DoD: implement only direct target-long load/store shapes that can
  be represented safely in generated WebAssembly, keep unsupported shapes on
  TCI fallback, do not turn `mb` into a guessed no-op, run the generated-only
  generic Chromium smoke, and record whether the remaining live blockers
  justify rerunning W3 or require another lowering slice. Accepted evidence:
  the backend artifact at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2i-direct-memory`
  was built with `--enable-tcg-wasm64-backend` and
  `--disable-tcg-interpreter`. Artifact hashes: JS
  `725f5ebc5623b777c1b2bbce86178d4556d1fe059020df72da9d11dcf50373d3`,
  WASM `e1dc0ce19a3b784f8890d6d21acf596ea0af9fda7ecbd158bdfd0b3d82819d0e`,
  manifest
  `26848775127626efac019f8c58af83ef84a3f9c35bd348b241dc30d530acac06`.
  Chromium `141.0.7390.37` reached `QEMU_WASM_LINUX_BOOT_OK` in
  `112738` ms with generated-only subset reporting enabled. Result JSON:
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2i-direct-memory-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `8fae44f75ad68b2bf60343ddb8e02fa977ec6a0eb7ab490b6ee693aa9da2c298`).
  The final generated summary reported `generated_compiled=6`,
  `generated_executed=14505`, `generated_cache_hits=14499`,
  `generated_compile_failed=72`, and the direct memory blockers dropped out.
  The next live rejection list moved to `mb=1435`, `setcond=366`,
  `extract=283`, `call=75`, `shl=39`, `shr=15`, `movcond=14`, and
  `sextract=7`. This accepts the direct load/store slice but does not
  justify rerunning W3 because wall-clock time regressed and compile-failed
  fallbacks appeared.
- [x] W2i - Investigate and lower the next blocker without guessing memory
  semantics. DoD: either prove a WebAssembly memory-fence encoding for `mb`
  with a deterministic module test and then lower `mb`, or leave `mb` on
  fallback and lower the next safe non-barrier blockers (`setcond` and
  `extract`). The generated-only Chromium smoke must pass and record
  `generated_compile_failed`, `top_generated_unsupported_ops`, and whether
  W3 can be rerun. Accepted evidence: no local verified WebAssembly
  memory-fence encoding was found, so `mb` stayed on strict fallback. The
  slice added generated support for the next safe non-barrier blockers:
  `setcond`, `movcond`, `shl`, `shr`, `extract`, and `sextract`, with
  WebAssembly `i64` shift/extract counts emitted as `i32` operands. The
  backend artifact at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-register-blockers-fixed`
  was built with `--enable-tcg-wasm64-backend` and
  `--disable-tcg-interpreter`. Artifact hashes: JS
  `7366a91e196510ec7c4e9e18fbe1cb104c186673f78a7b4c76f79c80e2282804`,
  WASM `05ba2b602eec59ea99653d9260febbfbb2669c13984bee103b9f81bc564fa5d2`,
  manifest
  `18d7d3f1d658f1f08ac9645ec3c71fffa8bce1f9bd5eac2a6879a1cde680e807`.
  Chromium `141.0.7390.37` reached `QEMU_WASM_LINUX_BOOT_OK` in
  `111130` ms with generated-only subset reporting enabled. Result JSON:
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-register-blockers-fixed-subset-live/wasm-browser-smoke-result.json`
  (SHA-256
  `48a9acb95004fdc95879081bce96ee71369004a8243f347e81caca198a5871c7`).
  The final generated summary reported `generated_compiled=6`,
  `generated_executed=15192`, `generated_cache_hits=15186`,
  `generated_compile_failed=755`, and live unsupported generated ops
  `mb=1819`, `call=63`, `sar=3`, `tci_movcond32=3`, `deposit=2`,
  `muls2=2`, `brcond=1`, and `ld32s=1`. W3 should not be rerun yet:
  wall-clock time is still not better than the prior W3 baseline, `mb`
  remains dominant, and compile-failed/runtime fallback is now large enough
  to require reason-level attribution.
- [x] W2j - Classify generated compile/runtime fallback and record generated
  coverage share before any more lowering. DoD: add reason-level diagnostics
  for the existing `generated_compile_failed` paths (`compile_zero`,
  `status_nonpositive`, `status_unknown`, and any newly found runtime
  fallback reason), add generated coverage numerator/denominator/ppm to both
  `qemu-tci-wasm-subset` and `qemu-wasm64-tcg` summaries, and prove the JSON
  shape with deterministic tests. If the diagnostics identify an encoding or
  validation bug in the already-added lowerings, fix that bug and rerun only
  the deterministic emitter/module tests first. A browser run is allowed only
  after the deterministic tests show the failing shape is fixed or after the
  diagnostics are needed to classify a still-unknown runtime fallback. This
  item does not lower new opcodes and does not rerun W3.
  Accepted evidence: the diagnostics build configured as
  `TCG backend: experimental wasm64 with TCI fallback`, compiled, linked, and
  wrote artifacts to
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-fallback-reasons`.
  Artifact hashes were `qemu-system-x86_64.js`
  `6cf78909d8fe7092216e9667b0057c3d6e432d7960e7563c20ea04951e7f406a`,
  `qemu-system-x86_64.wasm`
  `496ec3451c5a957036cfe2d42e152c4a3f4701e9408f345703d976ffe4043162`,
  and `qemu-system-wasm-artifacts.json`
  `a23bad762fee26da34f8bd8bbef13d0cdde8656bf7131a903a13a63b46cb32dd`.
  Checks passed: `git diff --check`,
  `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`,
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because sandboxed child-process spawning returns `EPERM`,
  `node --check scripts/ci/wasm-tb-module-emitter-test.mjs`,
  `node scripts/ci/wasm-tb-module-emitter-test.mjs`,
  `node --check scripts/ci/wasm-generated-block-prototype-test.mjs`, and
  `node scripts/ci/wasm-generated-block-prototype-test.mjs`.
  The generated-only Chromium smoke used Chromium `149.0.7827.55` and reached
  `QEMU_WASM_LINUX_BOOT_OK` in `104757` ms, writing
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-fallback-reasons-subset-live/wasm-browser-smoke-result.json`
  with SHA-256
  `acb26aae9c4a0f89100107093e19ae3b10d0e0cc9fca6f5f7d905b9329082d85`.
  The summary reported `generated_compiled=4`,
  `generated_executed=15131`, `generated_cache_hits=15127`,
  `generated_compile_failed=677`, `generated_compile_zero=677`,
  `generated_status_nonpositive=0`, `generated_status_unknown=0`, and
  generated coverage `30258 / 73080000` (`414` ppm). This completes W2j but
  not W2: generated coverage remains far too small, and the next accepted
  work is W2k translation-time lowering, not another opcode-at-a-time browser
  run.
- [x] W2k - Move the backend toward translation-time lowering instead of the
  runtime TCI-bytecode subset. DoD: introduce a small translation-time
  wasm64 lowering skeleton in the backend path, fed from `tcg/wasm64/
  tcg-target.c.inc` or the equivalent selected target lowering hook, that
  receives TCG ops before TCI bytecode execution, emits per-TB generated
  metadata or a per-TB fallback marker, preserves strict fallback semantics,
  and has deterministic tests for the metadata/fallback contract. This item
  may leave execution on fallback, but it must remove the current need for a
  threshold-hot runtime TCI-bytecode revalidation loop for deciding whether a
  TB is generatable. Record the expected effect on generated coverage share
  before any browser run. Accepted evidence: the wasm64 target now wraps the
  TCI fallback emitter at translation time. `tcg_out_tb_start()` calls
  `tcg_wasm64_translate_begin()` with the TB code pointer before bytecode
  emission, `tcg_out32()` is routed through `tcg_wasm64_out32()`, and each
  emitted TCI bytecode word records side-band `TCGWasm64TBMetadata`. The
  current skeleton deliberately marks every TB with
  `TCG_WASM64_TB_METADATA_FALLBACK` and
  `TCG_WASM64_TRANSLATE_FALLBACK_NO_WASM_EMITTER`, preserving strict TCI
  execution while giving the future WebAssembly emitter a translation-time
  metadata slot instead of deciding generatability through the threshold-hot
  runtime TCI-bytecode subset. The expected immediate generated coverage share
  change is `0`: this slice moves the decision point and metadata contract; it
  does not lower new operations or justify a browser speed run. Deterministic
  checks passed: `git diff --check`,
  `node --check scripts/ci/wasm64-translate-metadata-test.mjs`,
  `node scripts/ci/wasm64-translate-metadata-test.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`, and
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because sandboxed child-process handling returned empty validation output.
  The backend artifact compile check used:
  `python3 scripts/ci/wasm-build-artifacts-local.py --out
  /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2k-translate-metadata
  --jobs auto --configure-arg=--disable-tcg-interpreter
  --configure-arg=--enable-tcg-wasm64-backend`. It configured as
  `TCG backend: experimental wasm64 with TCI fallback`, compiled, linked, and
  wrote artifact hashes: JS
  `b23de585246226886ea328e20bed98ca379241456ea7757da37f2e1442cc1dbe`,
  WASM `502463d1bc124e0d4153b00a5e7abab73df417a741850f04989818bf5496c916`,
  manifest `b42ebb3f6c1baefa728e4b02fd258c74295c43462bee6f0bb4eee5377c4c76c9`,
  and `SHA256SUMS`
  `7cd5af188bc618118345d503a4850c65f9646cc0798d0b130771b13c0e858c40`.
  This completes W2k only; W2 remains open until generated TBs execute through
  the translation-time backend and pass the W2/W3 gates.
- [ ] W2l - Prove and batch the next broad lowering family only after W2j and
  W2k. DoD: prove WebAssembly memory-barrier lowering in the deterministic
  emitter first, using the threads `atomic.fence` encoding
  `0xFE 0x03 0x00` in a module that validates in Node and Chromium; then
  batch `mb` with any other structurally enabled high-coverage lowering
  family that W2k exposes. Do not run Chrome/Chromium for a single opcode.
  The browser measurement is accepted only if it records generated coverage
  share and compiled-block count and plausibly answers whether W3 can pass.
- [x] W2l-a - Prove the `mb` memory-barrier encoding in the deterministic
  module emitter under Node before any browser speed run. Accepted slice
  evidence: `scripts/ci/wasm-tb-module-emitter.mjs` now emits the WebAssembly
  threads `atomic.fence` instruction bytes `0xFE 0x03 0x00` for `mb` instead
  of a no-op. `scripts/ci/wasm-tb-module-emitter-test.mjs` asserts the exact
  bytes and asserts that the generated lowering-subset module contains one
  fence per `mb` lowering op. Checks: `git diff --check`,
  `node --check scripts/ci/wasm-tb-module-emitter.mjs`,
  `node --check scripts/ci/wasm-tb-module-emitter-test.mjs`,
  `node scripts/ci/wasm-tb-module-emitter-test.mjs`,
  `node --check scripts/ci/wasm-generated-block-prototype-test.mjs`,
  `node scripts/ci/wasm-generated-block-prototype-test.mjs`, and
  `node scripts/ci/wasm-tb-module-emitter.mjs`. The lowering subset validates
  and executes under Node with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-a/wasm-tb-module-emitter.json`,
  `memoryBarrierOps=2`, and module size `321` bytes. This does not complete
  W2l because Chromium validation and batched backend lowering with generated
  coverage evidence remain open.
- [x] W2l-b - Add translation-time lowerability profiling for the broad
  planned-hotblock family before runtime code generation. Accepted slice
  evidence: `TCGWasm64TBMetadata` now records the lowering profile id,
  profile-supported op count, unsupported op count, and whether the translated
  TB is fully covered by the planned profile. The profile covers the broad
  W2 hotblock family (`add`, `and`, `brcond`, `exit_tb`, `goto_tb`, `ld`,
  `ld8*`, `ld16*`, `ld32*`, `mb`, `mov`, `or`, `qemu_ld`, `qemu_st`,
  `setcond`, `st`, `st8`, `st16`, `st32`, `sub`, `tci_movi`, `tci_movl`,
  `tci_qemu_ld_rrr`, `tci_qemu_st_rrr`, `tci_setcond32`, and `xor`) rather
  than a single opcode. Runtime summary JSON now exports
  `translated_profiled_tbs`, `translated_lowerable_tbs`,
  `translated_profile_supported_ops`, and
  `translated_profile_unsupported_ops`, while preserving strict fallback for
  every TB because generated bytes are not attached yet. Checks:
  `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`, and
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because the sandboxed run hit the known empty-stderr child-process
  assertion. The Emscripten backend build command was:
  `python3 scripts/ci/wasm-build-artifacts-local.py --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-b-profile-metadata --jobs auto --configure-arg=--disable-tcg-interpreter --configure-arg=--enable-tcg-wasm64-backend`.
  It configured as `TCG backend: experimental wasm64 with TCI fallback`,
  compiled, linked, and wrote artifact hashes: JS
  `432dafdff489c90c979b0ed90f768f9c0990992a49bd0c508c3a55eefb17284a`,
  WASM `5ccf2a3575eda027b45ce0f5d81e9c1552152b8f219725a8b8f562c624c6cb35`,
  manifest `b2f3354f0fb3d993771cc01de56b4866a478f2beed74ace57aab168d57c32709`,
  and `SHA256SUMS`
  `f8493d236ad7a53b296211d5c9e985c2054efe51e6aae7ad1fa5da669d9651ef`.
  This does not complete W2l or W2: the next required work is attaching
  generated bytes/functions to translation-time metadata and proving nonzero
  generated execution and coverage.
- [x] W2l-c - Replace raw TCI-word candidate classification with op-based
  translation metadata and aggregate translation counters into the browser
  summary before the next broad backend measurement. Accepted slice evidence:
  the shared TCI emitter now calls `tcg_out_tci_note_op()` from the TCI
  operation emission helpers, and the wasm64 target uses that hook instead of
  intercepting raw `tcg_out32()` words where operands and immediates could be
  misread as opcodes. Translation metadata now records generated-candidate
  supported/unsupported op counts, terminal markers, and aggregates those
  translated counters into `qemu-wasm64-tcg` summaries. The deterministic
  checks passed: `git diff --check`,
  `node scripts/ci/wasm64-translate-metadata-test.mjs`,
  `node scripts/ci/wasm-tb-module-emitter-test.mjs`,
  `node scripts/ci/wasm-generated-block-prototype-test.mjs`, and
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox.
  The Emscripten backend build command was:
  `python3 scripts/ci/wasm-build-artifacts-local.py --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-c-op-metadata --jobs auto --configure-arg=--disable-tcg-interpreter --configure-arg=--enable-tcg-wasm64-backend`.
  It configured, compiled, linked, and wrote artifact hashes: JS
  `44f7cf8aab5c23c82efe46114b68d8fd6a8b5e60ba56d9d247a9c6bf554351f7`,
  WASM `db318270301acfc5f724c6e6a033e79d8fac64983e4b8ba6d1d0f301bc9c1305`,
  manifest `ec620fa811163f71c99ef1bfbe4f295aceff8dab630798a5a84328455e2d6671`,
  and `SHA256SUMS`
  `35a8f7f579818547a10dc5069120ce6282e97023bdd9a2247b9597e0d863010d`.
  The Chromium `149.0.7827.55` generic smoke command used the same TuxBoot
  kernel/initramfs as W2c and wrote result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-c-op-metadata-smoke/wasm-browser-smoke-result.json`
  with SHA-256
  `bc209165f672fec30141d95fece1853ff10e719a5bba90622915e127032f9e99`.
  It reached `QEMU_WASM_LINUX_BOOT_OK` in `100472` ms. The result is negative
  for W2/W3: `generated_compiled=0`, `generated_executed=0`,
  `generated_cache_hits=0`, and generated coverage was `0 / 73140000`
  (`0` ppm), even though translation metadata reported
  `translated_generated_candidate_tbs=65920`. This completes W2l-c as
  diagnostic plumbing only; W2l and W2 remain open.
- [ ] W2m - Re-plan the backend around true translation-time generated output
  instead of runtime TCI-bytecode compilation. DoD: name and implement the
  smallest structural patch that moves generated byte/function creation into
  the wasm64 translation path before runtime TCI bytecode revalidation, proves
  the per-TB fallback marker still preserves TCI correctness, and produces a
  deterministic test that can fail before any browser run if translated
  generated bytes are absent. Do not add another opcode-specific lowering
  browser measurement until this structural boundary exists and the predicted
  generated coverage share change is written down.
- [x] W2m-a - Add translation-time generated-output material before runtime
  TCI-bytecode revalidation. Accepted slice evidence: the wasm64 target now
  pairs the existing `tcg_out_tci_note_op()` hook with the next emitted TCI
  instruction word through an op-paired `tcg_out32` wrapper. The runtime
  stores that concrete translation-time output material in per-TB metadata,
  records output byte/op/checksum fields, and exports
  `translated_generated_output_tbs`, `translated_generated_output_bytes`,
  `translated_generated_output_ops`, and
  `translated_generated_output_truncated` in `qemu-wasm64-tcg` summaries.
  This is deliberately not a generated execution path yet: every TB still
  runs through strict TCI fallback until the generated output is converted
  into a callable WebAssembly module/function. The expected immediate W3
  speed change is `0`; the value of this slice is that deterministic tests can
  now fail before any browser run if translated generated output is absent.
  Checks: `git diff --check`,
  `node scripts/ci/wasm64-translate-metadata-test.mjs`,
  `node scripts/ci/wasm-tb-module-emitter-test.mjs`,
  `node scripts/ci/wasm-generated-block-prototype-test.mjs`, and
  `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox
  because sandboxed child-process assertions return empty stderr. The backend
  artifact build command was:
  `python3 scripts/ci/wasm-build-artifacts-local.py --build-image --out
  /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-translate-output-artifacts
  --jobs auto --configure-arg=--disable-tcg-interpreter
  --configure-arg=--enable-tcg-wasm64-backend`. It configured as
  `TCG backend: experimental wasm64 with TCI fallback`, compiled, linked, and
  wrote artifacts with hashes: JS
  `f19bac59e8c353a254e0a620c3cbc496fd5877eafd36646a9f1951cd689a888f`,
  WASM `7c4603c99224cdec56b0d6188061079a4e7591abc5da10a734c3f4b9932fc53b`,
  manifest `3caa22a54f8dc3f66ba68d42ec3c6d5298f24f9092443b0eb9073915d4915982`,
  and `SHA256SUMS`
  `5b921b24c00462dd441cfa5634ca46ca490e2fba85e468b6c552d27bfd82c5c2`.
  W2m remains open: the next accepted slice must turn this translation-time
  output into a C-callable generated WebAssembly module/function with strict
  fallback and nonzero generated execution before any W3 browser speed gate.
- [ ] W2m-b - Compile from translation-time output material through the
  existing C-callable generated-function boundary. DoD: generated compilation
  for the wasm64 backend reads the per-TB translation output buffer recorded
  by W2m-a, while resolving TCI relative operands against the original TB
  base; strict fallback remains active if generated output is absent,
  truncated, unsupported, or fails to compile; deterministic tests prove the
  emitted compiler path uses separate code and relative-base pointers before
  any browser run. Prediction: this should not be measured with W3 until
  local checks show the compiler consumes translation-time output and a
  focused backend smoke reports nonzero generated execution. The intended
  gate effect is an order-of-magnitude generated coverage increase only after
  this path executes generated blocks broadly; the first local slice may still
  have `0` browser-measured speed change.
  Attempt 2026-07-02 is not accepted as W2m-b complete. It changed the
  generated compiler to consume the translation-time output buffer and added
  bounded generated-block trace diagnostics, but the browser evidence showed
  only `34` generated executions/cache hits out of `53,900,000` to
  `73,820,000` eligible TB entries (`0` ppm in 150 s summaries). A 30 s
  generated-only trace run and a 150 s fallback-enabled run both timed out
  before `QEMU_WASM_LINUX_BOOT_OK`. The generated path compiled only `12`
  blocks and had `fallback_runtime=1`; that is useful failure evidence, not
  meaningful generated coverage. The pointer-width ABI correction from
  `addFunction(..., "ii")` to `addFunction(..., "jj")` is retained, and
  deterministic tests now guard it. Because generated execution is still too
  narrow and unsafe for the gate, backend builds now keep
  `QEMU_TCI_WASM_SUBSET` opt-in instead of enabling generated/subset
  execution by default. The final opt-in-guarded artifact hashes are JS
  `d02596846580898d9a062dd1bf3a0ee04b727447e669733e3662283fb458846`,
  WASM `b70c7ec5bda838094487700cd766197283cb796af723d9e1675ce68dcd541342`,
  manifest `b1d667d55fff5be892a609f833bb9a5b2a1bfad52705ee0785d5e863b20a1c49`.
  The generic Chromium `149.0.7827.55` smoke reached
  `QEMU_WASM_LINUX_BOOT_OK` in `93186` ms with `tci.wasmSubset.enabled=false`,
  `wasm64Tcg.summaryCount=0`, and no generated attempts; result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-subset-optin-final-default-smoke/wasm-browser-smoke-result.json`
  SHA-256 `5f833d7f8002b2e7046ead6359eb089963ffb9eefc4546c7de68baa501147b19`,
  screenshot SHA-256
  `7790c1602b7fc002de8c3020befa4d332828fe041dec420dbda28caa83284ff5`.
  Against the prior native generic TuxBoot time of `1968` ms, this is about
  `47.4x` native. Applied to Bus Engine OS native evidence, it estimates
  about `34.7` minutes to multi-user/login from the `44` second native boot
  and about `45.8` minutes through the `58` second boot-audit marker. The
  five-minute goal still needs roughly a `6.9x` to `9.2x` improvement from
  the current safe fallback path.
- [x] W2m-c - Add a deterministic generated-output equivalence gate before
  broad generated execution. DoD: use the W2m-b trace shapes to build a local
  semantic check that compares generated-block register, memory, and dispatch
  effects against the existing TCI interpreter for at least the early
  terminal `goto_tb` and `exit_tb` block family, with no browser run required
  for encoding/ABI failures. The next browser measurement is allowed only
  after this deterministic gate passes and the generated coverage prediction
  names how the change can plausibly move from tens of executions to thousands
  of executed generated TBs. Accepted slice evidence:
  `scripts/ci/wasm-generated-output-equivalence-test.mjs` now embeds
  W2m-b trace-shaped TCI instruction words, runs a reference interpreter over
  the same register/memory state, compiles the generated-output shape into a
  local WebAssembly function, and compares status, return target, registers,
  and memory. The local gate passed with `6` fixture executions:
  `4` `goto_tb` terminal cases and `2` `exit_tb` terminal cases. Checks:
  `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs` and
  `node scripts/ci/wasm-generated-output-equivalence-test.mjs`. This completes
  the deterministic safety gate only; it does not move the current browser
  estimate of about `34.7` to `45.8` minutes.
- [x] W2m-d - Quantify the generated-output availability gap before more
  backend lowering. DoD: add or extract reason-level data that explains why
  the W2m-b browser run translated hundreds of TBs but exposed only `13`
  generated-output TBs and `24` generated attempts, then record a coverage
  prediction for the next implementation item. A browser run is not allowed
  for W2m-d unless the local data names a mechanism that can plausibly move
  generated coverage from tens of executions to thousands. Accepted evidence:
  the wasm64 backend summary now reports generated-output unavailable,
  missing-candidate, incomplete-output, and top first-generated-unsupported
  opcode fields. The compile-check artifact was built successfully at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-gap-attribution-artifacts`
  with JS
  `d60558aadfddbf06347e01353fad4056c8da44ff74d8d26f8657e3c14dd52b3c`,
  WASM `6d6dd5984e03b08dea502aabaecae6322f82f18236c56aa4b767de59e5364200`,
  manifest `1b5b86a5d71bc8af754fcd40a81173e9fef457ce15621729243fe701d2d2812b`,
  and `SHA256SUMS`
  `53ea99b6a5795bfca37ce7628682b90b9a96c3cd87644cdbec9bc83348a15608`.
  The bounded Chromium `149.0.7827.55` diagnostic run timed out at `30195`
  ms as expected, but produced the required attribution at
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-gap-attribution-smoke/wasm-browser-smoke-result.json`
  with result SHA-256
  `4b6df1b486ce8916fcf629fc6994109fcd0b091cea1b469a4a728f7916efaaad`.
  Summary: `315` translated TBs, `13` generated-output TBs, `302`
  unavailable TBs, all `302` unavailable because the TB missed the generated
  candidate condition, `0` incomplete-output TBs, and `0` truncations. The top
  first unsupported generated opcodes were `tci_qemu_st_rrr=148`,
  `tci_qemu_ld_rrr=145`, `call=6`, and `deposit=3`. The qemu load/store pair
  explains `293 / 302` unavailable TBs (`97.0%`) and can plausibly move early
  generated-output candidate coverage from `13 / 315` TBs (`4.1%`) to roughly
  `306 / 315` TBs (`97.1%`) if implemented with correct fallback. That is the
  next high-leverage mechanism; single-opcode arithmetic work remains
  rejected.
- [x] W2m-e - Add a deterministic generated QEMU memory helper boundary for
  `tci_qemu_ld_rrr` and `tci_qemu_st_rrr` before runtime browser execution.
  DoD: a local generated-output equivalence test models generated calls to
  qemu load/store helpers, compares the resulting registers, memory side
  effects, helper-call counts, and fallback behavior against the reference
  interpreter for trace-shaped qemu memory blocks, and records the predicted
  candidate coverage increase from the W2m-d data. No Chromium run is allowed
  until this deterministic helper boundary passes. Accepted evidence:
  `scripts/ci/wasm-generated-output-equivalence-test.mjs` now imports
  generated `qemu_ld_rrr` and `qemu_st_rrr` helper functions into the local
  generated WebAssembly module, executes a trace-shaped qemu memory block,
  and compares helper call traces, helper call counts, register state, memory
  side effects, terminal status, and return target against the reference
  interpreter. The test also verifies an unsupported mixed helper block fails
  closed before execution. Checks:
  `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs` and
  `node scripts/ci/wasm-generated-output-equivalence-test.mjs`. The accepted
  output was `8` positive fixture executions, `1` unsupported fail-closed
  fixture, `2` helper-boundary executions, `2` modeled qemu loads, and `2`
  modeled qemu stores. This is a deterministic safety gate only. The runtime
  prediction remains from W2m-d: qemu load/store helper support is the
  measured blocker for `293 / 302` unavailable generated-output TBs, so the
  next runtime slice can plausibly move early generated-output candidate
  coverage from `13 / 315` TBs (`4.1%`) toward roughly `306 / 315` TBs
  (`97.1%`), subject to compile/runtime fallback.
- [x] W2m-f - Wire the runtime generated qemu load/store helper boundary.
  DoD: the Emscripten generated compiler accepts `tci_qemu_ld_rrr` and
  `tci_qemu_st_rrr` by calling a narrow helper boundary with
  `env`, guest address, value for stores, `MemOpIdx`, and TB return address;
  unsupported helper compilation or runtime failures still fall back through
  the interpreter with counters. The implementation must pass the
  deterministic generated-output equivalence test, metadata tests, syntax
  checks, and a build artifact check before any Chromium run. A Chromium
  diagnostic run is allowed only after those gates pass and must report
  generated coverage share, compiled block count, and fallback counts.
  Accepted diagnostic evidence: the backend artifact built with
  `--disable-tcg-interpreter --enable-tcg-wasm64-backend` and wrote artifacts
  to
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-fwcfg-exec-counters2-artifacts`.
  Artifact hashes: JS
  `47a2d6420be9aebad4d90dddfa90445e715486280a89e5c2094b42f21953b06c`,
  WASM
  `dfd36c222faef6c2dcbca69df9b27d4ba89433831a56bfc6660c14538012e14a`,
  manifest
  `5d68f476dc8896b5e2aa00cc560bb6d74fe756c7d90a5c1cae24857f55cf0004`.
  Checks before the browser run:
  `git diff --check`,
  `node --check scripts/ci/wasm-browser-smoke.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
  `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`,
  `node scripts/ci/wasm-generated-output-equivalence-test.mjs`, and
  `node scripts/ci/wasm64-translate-metadata-test.mjs`. The deterministic
  equivalence test reported `10` fixtures, `1` unsupported fixture, `2`
  helper-boundary fixtures, `2` modeled qemu loads, and `2` modeled qemu
  stores. The short Chromium `149.0.7827.55` diagnostic command used the
  generic TuxBoot manifest, `--timeout-ms 8000`,
  `--tci-wasm-subset`, `--tci-wasm-generated-trace`, and
  `--fw-cfg-trace`; it intentionally timed out before
  `QEMU_WASM_LINUX_BOOT_OK` and wrote
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-fwcfg-exec-counters2-smoke/wasm-browser-smoke-result.json`
  with result hash
  `ace1c5b0c06116455ef8d814e53bcfd0e9e58c3d0d4c9dcbb17de8c13edff1a7`.
  The last 5.274 s summary reported `generated_compiled=103`,
  `generated_executed=123`, `generated_cache_hits=20`, and generated
  coverage `143 / 433` subset attempts (`330254` ppm). The runtime metadata
  split showed `exec_generated_output_lookup_tbs=220`,
  `exec_generated_output_available_tbs=110`, and
  `exec_generated_output_unavailable_tbs=110`; all unavailable execution
  lookups were missing generated-candidate metadata rather than incomplete
  byte output. The fw_cfg trace was now visible and small (`11` events), so
  fw_cfg is not the material stall. The next measured blocker is generic
  helper-call and remaining deterministic-op candidate loss: first unsupported
  generated ops were `call=72`, `deposit=32`, `ld32s=5`, and `neg=1`.
  W2 remains open because this slice is a runtime attribution and safety
  gate, not a W3 speed improvement.
- [x] W2m-g - Batch the next generated-output coverage step from the W2m-f
  evidence. DoD: before another browser run, deterministic tests must model
  the simple measured ops (`deposit`, `ld32s`, and `neg`) and a generic
  helper-call boundary or must record why generic calls cannot be safely
  generated. The browser run is allowed only if local evidence predicts a
  coverage-share order-of-magnitude change; the accepted result must record
  generated-output availability, generated executions, helper-call fallback
  counts, and whether generic helper calls still dominate candidate loss.
  Accepted deterministic/build evidence: `deposit`, `ld32s`, and `neg` are
  now part of the generated-output support predicate and the generated
  compiler. `scripts/ci/wasm-generated-output-equivalence-test.mjs` adds a
  `simple-gap-ops-validate` fixture covering those operations against the
  reference interpreter. Checks:
  `git diff --check`,
  `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`,
  `node scripts/ci/wasm-generated-output-equivalence-test.mjs`, and
  `node scripts/ci/wasm64-translate-metadata-test.mjs`. The equivalence test
  reported `12` fixtures, `1` unsupported fixture, `2` helper-boundary
  fixtures, `2` simple-gap fixtures, `2` qemu loads, and `2` qemu stores.
  The backend artifact built with
  `--disable-tcg-interpreter --enable-tcg-wasm64-backend` and wrote artifacts
  to
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-simple-gap-ops-artifacts`.
  Artifact hashes: JS
  `6df4acbdb2a09ee976007e6c9a5b62749fec2bbf5aaaacd5f0f4d9d07c5341f2`,
  WASM
  `95d39dee08afe39e19d6d0e4d06c04fa501ef4735d7a347f8d032130debde93c`,
  manifest
  `e8d81788f895fce9aa01ddc9c3a93e6484417b8fa80ed744f6652e8ebc1e99fd`.
  No Chromium run was started for this slice because the W2m-f local data
  predicts only a moderate candidate increase: the simple ops explain
  `38 / 110` execution-side unavailable generated-output TBs, while
  `call` explains `72 / 110`. A browser run before solving or classifying
  generic helper calls would not satisfy the order-of-magnitude coverage
  rule. Generic `INDEX_op_call` is not safely generated by the current
  compiler because the TCI path uses libffi with arbitrary helper signatures,
  stack slot layout, helper return arity, `TCG_CALL_NO_RETURN` flags, and
  `tci_tb_ptr` return-address state; WebAssembly imports require typed
  function boundaries. W2 remains open.
- [x] W2m-h - Design and prove the generic helper-call boundary or reject it
  with stronger attribution. DoD: classify the measured helper-call sites by
  helper name, flags, argument count, return shape, and dynamic frequency from
  the browser trace; then either add a deterministic generated-output test for
  a safe C trampoline that exactly preserves TCI libffi helper semantics, or
  record why helper calls must stay fallback and move to the next structural
  backend item. No browser run is allowed until the local evidence predicts
  an order-of-magnitude generated coverage change or names a different
  measured gate-moving mechanism. Accepted classification evidence:
  `scripts/ci/wasm-helper-call-classify.mjs` and
  `scripts/ci/wasm-helper-call-classify-test.mjs` classify retained
  generated-trace helper calls by helper name, TCG call flags, argument count,
  TCI return length, return shape, elapsed range, and dynamic share. Checks:
  `node --check scripts/ci/wasm-helper-call-classify.mjs`,
  `node --check scripts/ci/wasm-helper-call-classify-test.mjs`,
  `node scripts/ci/wasm-helper-call-classify-test.mjs`, and
  `git diff --check`. The real W2m-f trace classification was written to
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-helper-call-boundary/wasm-helper-call-classification.json`
  with SHA-256
  `7db15d976ae1811006a6ddf4ad681ec8e34731b4e24c8d8842c3da7b81ef67f8`.
  It classified `154` helper-call entries and `153` returns across `10`
  groups from Chromium `149.0.7827.55`. The dominant helper is
  `lookup_tb_ptr` with `95 / 154` entries (`61.69%`), flags
  `NO_WRITE_GLOBALS|NO_SIDE_EFFECTS`, one argument, and `uint64` return.
  The remaining helper calls are mostly side-effectful device or x86 state
  helpers: `outl=19`, `outb=18`, `inb=7`, `load_seg=5`, `inl=3`,
  `ljmp_protected=3`, `outw=2`, `cc_compute_c=1`, and `write_crN=1`.
  A generic helper-call trampoline is rejected for this slice because it
  would still have to preserve TCI's libffi helper ABI, arbitrary helper
  signatures, stack slot layout, return arity, `TCG_CALL_NO_RETURN`, mutable
  CPU/device side effects, and `tci_tb_ptr` return-address state. The
  measured gate-moving target is not broad helper flattening; it is the
  generated-block dispatch boundary around `lookup_tb_ptr`.
- [ ] W2m-i - Implement or reject a generated-block dispatch boundary around
  the measured `lookup_tb_ptr` helper shape. DoD: use the W2m-h classifier
  output and QEMU TCI dispatch semantics to design the narrow boundary before
  code. Either implement deterministic tests showing generated blocks can
  return the same next-TB decision as the TCI `lookup_tb_ptr` path without
  re-entering the generic libffi helper on the hot path, or record why the
  dispatch helper must remain fallback. A browser run is allowed only if the
  local evidence predicts at least an order-of-magnitude generated coverage
  share increase or removes the dominant `lookup_tb_ptr` candidate loss.
- [ ] W3 - Pass the generic speed gate before any long Bus Engine OS proof.
  DoD: same-commit default-TCI artifact and backend artifact run the
  identical generic Chromium smoke back to back on the same host and
  browser build. The backend artifact must reach
  `QEMU_WASM_LINUX_BOOT_OK` at least `25%` faster than the default-TCI
  run. Record both hashes, both timings, and the percentage in this file
  and `docs/devel/wasm-support-plan.rst`. If the gate fails, the next
  lowering/optimization work item must be added here with the measured
  blocker named before more implementation; do not spend a long Bus Engine
  OS run on a failed gate. Attempt 2026-07-02 from QEMU commit
  `5f6431526d412aecf36f9d25d6f0a5450f3dc6ca` failed the gate. Default TCI
  artifact hashes: JS
  `2e4f82e69af410f5eef63fea7def6eb118fb8b3b0bfbe37867feb482382e89d0`,
  WASM `819b89f3e4655c49ab826d5760be07a51b29168aadaa7ad6e1967c0655a6fc6c`,
  manifest
  `2266d95988c96fdab4cbba6ff5a73677f678ab2074baf92bac06225331c68bb2`.
  Backend artifact hashes: JS
  `07dfe2c64a7626d9107a0778094eff428d0a26de99849ff442deb2e15f458846`,
  WASM `e8d48e5a64cedf342549d5cfd84f036752ba2275c35132804a69a5f3cb540418`,
  manifest
  `d0fee6ae386cb3607c11ef74064efc92369b3ceca5a2f22cf17ad4287b425e7c`.
  Both ran in Chromium `141.0.7390.37` using the same Playwright Noble
  container and generic TuxBoot smoke. Default TCI reached
  `QEMU_WASM_LINUX_BOOT_OK` in `91207` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-default-tci-smoke/wasm-browser-smoke-result.json`.
  The backend reached the same marker in `100142` ms with result JSON
  `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-backend-context-smoke/wasm-browser-smoke-result.json`.
  That is about `9.8%` slower, not `25%` faster. The backend exported
  nonzero generated counters (`generated_compiled=5`,
  `generated_executed=15363`, `generated_cache_hits=15358`,
  `fallback_unsupported=2510`), but coverage is too small to improve
  wall-clock boot. Current live attribution now points to W2g.
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
