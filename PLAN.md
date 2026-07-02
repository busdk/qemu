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
- [ ] W2j - Classify and reduce generated compile/runtime fallback before
  rerunning W3. DoD: add reason-level diagnostics for generated compile
  failures and runtime fallback, run the generated-only Chromium smoke, and
  either fix a proven lowering/encoding bug or record that the remaining
  accepted blocker is the unsupported `mb` memory-barrier path. Do not lower
  `mb` unless a deterministic module test proves the exact WebAssembly fence
  encoding and browser support.
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
