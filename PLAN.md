# QEMU WebAssembly Host Support Plan

This branch tracks upstreamable QEMU WebAssembly host support needed for the
current 64-bit browser boot proof. Keep Bus Engine product work downstream.
The active working rule is to finish the unchecked `PLAN.md` items first. Only
when the active plan is empty or blocked on a concrete external dependency
should the next highest-value item be moved from `BACKLOG.md` into this
file and then implemented.

## Active Goal

Follow the supervisor-root `GOAL.md` for the active five-minute browser
multi-user boot goal. This shared plan contains both the separate RISC-V
accelerator lane and the Linux-supervisor `x86_64-softmmu` accelerator lane.
The supervisor-root `GOAL.md` selects which lane the current executor owns.

This file is shared by the x86_64 and RISC-V supervisor environments. RISC-V
items remain valid for the separate RISC-V lane. The current executor lane in
the Linux supervisor environment owns only the `x86_64-softmmu` accelerator
items, currently R4f-R4l and the x86 final proof item. Do not project x86_64
boot timing from RISC-V measurements, and do not remove RISC-V items merely
because they are out of scope for the x86_64 lane.

Each lane is complete only against its own accepted Bus Engine OS
`virtual-server` kernel/rootfs pair. The proof must use Chrome or Chromium,
the QEMU WebAssembly artifacts produced by this branch, and the standard
`virtual-server` boot path. Shell-only init bypasses, synthetic guests, stale
artifacts, native-QEMU-only boots, snapshots, hibernate/restore,
preinitialized RAM, and heavily reduced product profiles do not satisfy either
lane.

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

This boot goal is expected to close through cumulative, deterministic
improvements rather than one isolated speedup. Smaller QEMU/WASM wins may be
accepted as progress when they are measured on the active lane, preserve
correctness and fallback behavior, and improve the real cold-boot execution
path or the generic gate that guards it. Record the before/after timings,
generated-vs-fallback counters, artifact hashes, browser version, commands,
and remaining gap here. Such wins do not satisfy the final proof until the
accepted Bus Engine OS image reaches normal multi-user readiness within
`300000` ms.

## Exact Definition of Done

The current executor lane is done only when all of the following are true for
that lane's target architecture. For this Linux-supervisor goal, read these as
the `x86_64-softmmu` accelerator and accepted Bus Engine OS `x86_64`
`virtual-server` kernel/rootfs. The RISC-V environment owns the equivalent
`riscv64-softmmu` checklist.

- [ ] Current QEMU WASM artifacts for the lane target are built from this
  branch and their JavaScript/WebAssembly SHA-256 hashes are recorded.
- [ ] The proof uses the accepted Bus Engine OS `virtual-server` kernel and
  root filesystem for the lane target, and their SHA-256 hashes are recorded.
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
- [ ] A generic Linux browser smoke test for the lane target still passes with
  the same QEMU WASM artifact family.
- [ ] Existing QEMU/WASM TCI smoke behavior for the non-owned target remains
  working or any deviation is recorded with an explicit acceptance decision.
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
- [x] R1 - Establish the browser and native RISC-V baselines before
  acceleration. DoD: build or obtain current `qemu-system-riscv64` native and
  WASM artifacts, boot a generic RISC-V Linux smoke in Chromium with default
  TCI, record exact commands, browser version, artifact hashes, result JSON,
  and compare wall time to native RISC-V QEMU and the previous x86_64 browser
  evidence.
  - [x] R1a - Make the existing QEMU WASM artifact builder and browser smoke
    harness target-selectable before measuring `riscv64-softmmu`. DoD:
    `scripts/ci/wasm-build-artifacts-local.py` can request
    `--target riscv64`, the browser smoke server/page/runner can serve and
    load `qemu-system-riscv64.js` plus `qemu-system-riscv64.wasm`, and the
    existing x86_64 defaults remain covered by deterministic tests. Accepted
    2026-07-03: `python3 scripts/ci/wasm-build-artifacts-local-test.py`,
    `node --check` on the browser runner/page/server and Linux boot smoke
    scripts, `node scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasm-browser-smoke-args-test.mjs`,
    `python3 scripts/ci/wasm-artifact-manifest-test.py`, `git diff --check`,
    and `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-dry-run --target
    riscv64 --dry-run` all passed. The dry run produced a Docker command with
    `--target-list=riscv64-softmmu`, copied `qemu-system-riscv64.js` plus
    `qemu-system-riscv64.wasm`, validated manifest target `riscv64`, and
    wrote SHA256SUMS for those artifact names. No full artifact build or
    browser boot was run in this slice.
  - [x] R1b - Establish a generic RISC-V Linux native control and record the
    current browser blockers before using the guest for accelerator evidence.
    DoD: a real RISC-V Linux disk guest reaches login under native
    `qemu-system-riscv64`, the browser harness can serve the needed RISC-V
    firmware, and failed browser runs record exact artifact/result paths and
    final failure lines. Accepted 2026-07-03: TuxBoot RISC-V assets were stored
    under `/Users/test/git/busdk/agent-supervisor/tmp/qemu-wasm-smoke-assets`.
    Kernel SHA256:
    `2bd8132a3bf21570290042324fff48c987f42f2a00c08de979f43f0662ebadba`;
    compressed rootfs SHA256:
    `aa4736a9872651dfc0d95e709465eedf1134fd19d42b8cb305bfd776f9801004`;
    decompressed 1 GiB ext4 rootfs SHA256:
    `bdae7f7e022592800442b73eb32ec7631f43a4c13dd8621051204f7e482fbd2b`.
    Native command `qemu-system-riscv64 -M virt -m 512M -nographic -serial
    mon:stdio -monitor none -kernel <Image> -append 'console=ttyS0
    root=/dev/vda rw panic=-1' -drive
    file=<rootfs.ext4>,format=raw,if=none,id=hd0 -device
    virtio-blk-device,drive=hd0 -nic none` reached `Welcome to TuxTest` and
    `tuxtest login:` inside a 30 second capture. A `-bios none` native control
    produced no serial output in 10 seconds, so the browser smoke server and
    runners now preserve optional OpenSBI firmware files
    `opensbi-riscv32-generic-fw_dynamic.bin` and
    `opensbi-riscv64-generic-fw_dynamic.bin`. Checks:
    `node --check scripts/ci/wasm-browser-smoke-server.mjs`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-linux-boot-smoke.mjs`, and
    `git diff --check` passed. Browser evidence used Chrome `149.0.7827.201`.
    The R3c generated artifact browser run wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-backend-r3c-generated-flag/browser-riscv64-tuxboot-generated-cdp.json`
    and aborted with `operation does not support unaligned accesses`; the R3c
    default no-generated control wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-backend-r3c-generated-flag/browser-riscv64-tuxboot-default-cdp.json`
    and reached OpenSBI/Linux/`virtio_blk` before aborting at
    `Assertion failed: p_rcu_reader->depth != 0`. This completes the native
    control and blocker capture only; R1 remains open until a generic RISC-V
    browser smoke reaches its marker with default TCI.
  - [x] R1c - Correct the RISC-V browser smoke shape and capture the current
    default-TCI browser blocker without the ad hoc `-cpu rv64` option. DoD:
    `scripts/ci/wasm-prepare-tuxboot-smoke-guest.py --target riscv64`
    produces a browser manifest for `machine=virt`, blank `cpu`, raw ext4
    rootfs on `virtio-blk-device`, and marker `Welcome to TuxTest`; the
    browser page preserves the blank CPU query parameter; tests cover the
    omitted `-cpu` command shape; and a current `riscv64-softmmu` default-TCI
    artifact is run in Chrome/Chromium with result JSON. Accepted
    2026-07-03: `python3 scripts/ci/wasm-prepare-tuxboot-smoke-guest-test.py`,
    `node scripts/ci/wasm-browser-smoke-args-test.mjs`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`, and
    `node --check scripts/ci/wasm-linux-boot-smoke.mjs` passed. The guest
    manifest was written to
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-official-guest/tuxboot-browser-smoke-guest.json`
    with kernel SHA256
    `2bd8132a3bf21570290042324fff48c987f42f2a00c08de979f43f0662ebadba`
    and raw rootfs SHA256
    `bdae7f7e022592800442b73eb32ec7631f43a4c13dd8621051204f7e482fbd2b`.
    The artifact build command
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-default-r1b-current
    --target riscv64 --build-image` passed and produced
    `qemu-system-riscv64.js`
    `09661031708135586564f43d6bf879ef49442124b4811eb0c8244943af96a2bf`,
    `qemu-system-riscv64.wasm`
    `0e3fc5b40c0f1a319f6eb0c856f9aee0d5b6c0472d377dbf0193722bfbacbab6`,
    and manifest
    `54f668e44a602a6e85c2dc963f0de66182e0d6ea573a063717df18a6841b73a0`.
    A local headless Chrome/CDP proof using Chrome `149.0.7827.201` wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-tci-current/wasm-browser-smoke-result.json`
    and screenshot
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-tci-current/wasm-browser-smoke.png`.
    It used `-M virt -m 512M -accel tcg,thread=single -nographic -kernel
    /kernel -append 'printk.time=0 root=/dev/vda console=ttyS0 panic=-1'
    -drive file=/rootfs.raw,format=raw,if=none,id=hd0 -device
    virtio-blk-device,drive=hd0 -nic none -L /firmware`, loaded the full
    1073741824 byte MEMFS rootfs, imported QEMU in `2956` ms, started QEMU in
    `2974` ms, printed the Linux kernel version at `13958` ms, reached
    `virtio_blk virtio0`, and timed out at `180321` ms without
    `Welcome to TuxTest`. The final line was `Pthread ... Uncaught Infinity`.
    Generated JS maps that value to Emscripten's
    `__emscripten_throw_longjmp`, so that artifact's corrected generic RISC-V
    browser blocker was an escaped Emscripten JS SJLJ longjmp in the block I/O
    path, not the earlier ad hoc-shape RCU assertion. R1 remained open from
    this slice until the R1d cleanup artifact reached `Welcome to TuxTest` in
    browser default TCI.
  - [x] R1d - Accept the generic RISC-V default-TCI browser baseline after
    removing stale TCI subset/direct-boundary experiments from the live tree.
    DoD: rebuild a current `riscv64-softmmu` default-TCI artifact from this
    branch, rerun the official blank-CPU TuxBoot browser manifest in Chrome,
    record native and browser marker timings, and make clear that this is a
    generic baseline, not the final Bus Engine OS proof. Accepted 2026-07-03:
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
    `node --check scripts/ci/wasm-helper-call-classify.mjs`,
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasm-helper-call-classify-test.mjs`,
    `node scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `git diff --cached --check` passed. The artifact build command
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-cleanup-r1
    --target riscv64 --build-image` passed. Artifact hashes:
    `qemu-system-riscv64.js`
    `cbf0836c26df510e1eae6ede43b86d30195975e477e0a2b5f8ca3d65181225f6`,
    `qemu-system-riscv64.wasm`
    `e8f8a97d5ee1c463ed7f3c39e31f29870ebb470becb1518d8e8602ee0fae8fd8`,
    manifest
    `111c7fe0d1666bdd6793061340c875f6625b9754ba6bd4fa9d032aed5ab7fb97`.
    Local Chrome/CDP proof using Chrome `149.0.7827.201` wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-cleanup-r1/wasm-browser-smoke-result.json`
    (SHA256
    `ac0e0af85018108651df3783c9830810bbd1161bac941a9f981c907e890a1450`)
    and screenshot
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-cleanup-r1/wasm-browser-smoke.png`
    (SHA256
    `e2ee07da8b466fc2ac318f98bd5384c59539e23f34a2adc9f9ba554f2a464d38`).
    The browser run imported QEMU at `2055` ms, started QEMU at `2074` ms,
    printed Linux at `11895` ms, discovered `/dev/vda` at `12832` ms, mounted
    rootfs at `16272` ms, started init at `16457` ms, and reached
    `Welcome to TuxTest` at `40041` ms; the final sampled elapsed time was
    `50242` ms. A same-host native command
    `qemu-system-riscv64 -M virt -m 512M -nographic -serial mon:stdio
    -monitor none -kernel <Image> -append 'printk.time=0 root=/dev/vda
    console=ttyS0 panic=-1' -drive file=<rootfs.ext4>,format=raw,if=none,id=hd0
    -device virtio-blk-device,drive=hd0 -nic none` reached the same marker in
    `1609` ms. The browser/native ratio for this generic TuxBoot marker is
    therefore about `24.9x`. This accepts the RISC-V generic baseline and
    disproves the earlier `Uncaught Infinity` result as the current default
    path blocker after cleanup; it does not satisfy the final Bus Engine OS
    multi-user proof or identify a precise Emscripten longjmp root cause.
- [x] R2 - Add the RV64-to-WASM accelerator design and fail-closed boundary.
  DoD: document CPU state layout, register residency, synthetic exits
  (`BUDGET`, `MMIO`, `TLB_MISS`, `INTERRUPT`, `CSR`, `INVALID`, `FATAL`),
  inline RAM/TLB-hit handling, invalidation, strict TCI fallback,
  no-silent-fallback performance mode, counters, and non-regression gates
  before the hot path is enabled. Accepted 2026-07-03:
  `docs/devel/wasm-support-plan.rst` now names the active
  `riscv64-softmmu` accelerator lane, preserves `x86_64-softmmu` as a
  non-regression gate, and documents the guarded translator boundary,
  `TCGWasm64Context`/`CPUArchState` state model, RISC-V state offset rule,
  exit classes, inline RAM/TLB-hit limits, invalidation rule, explicit TCI
  fallback/no-silent-fallback behavior, required counters, and performance
  gates. `git diff --check` passed. No generated hot path was enabled by this
  design-only slice.
- [ ] R3 - Implement the first selectable `riscv64-softmmu` WASM accelerator
  slice. DoD: generated RV64 execution is opt-in, unsupported or failed
  lowering falls back to TCI with identical guest-visible behavior, deterministic
  tests cover supported integer/branch/load/store/CSR exits, counters report
  generated versus fallback execution, and x86_64 TCI browser smoke is not
  regressed.
  - [x] R3a - Add the fail-closed generated-exit taxonomy to the wasm64
    backend counter contract before enabling any generated RISC-V execution.
    DoD: `TCGWasm64Counters` exposes the R2 exit classes, summaries report
    per-exit counts, parser tests cover the JSON shape, and no execution flow
    changes or generated hot path are enabled. Accepted 2026-07-03:
    `tcg/wasm64.h` exposes `TCGWasm64ExitReason` and per-exit counters,
    `tcg/wasm64.c` reports `generated_exits`, the browser smoke parser test
    covers the JSON shape, and `tcg/tci.c` keeps helper-name lookup guarded
    for TCI-only Emscripten builds. Checks:
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `git diff --check`, and
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-r3a
    --target riscv64` passed. Artifact hashes:
    `qemu-system-riscv64.js`
    `09661031708135586564f43d6bf879ef49442124b4811eb0c8244943af96a2bf`,
    `qemu-system-riscv64.wasm`
    `3caa09ef368be264c1989c0e72fb7a14b67bb6c2bb2ab234b5c5e903e8686b07`,
    manifest
    `5b9b0f594e0f85ed6c604a221124c0e0b10114c7bae2d7f8cf546a757868b288`.
  - [x] R3b - Make local RISC-V WASM artifacts selectable between the default
    TCI backend and the experimental wasm64 TCG backend without layering both
    backend choices together. DoD: default artifact builds still use
    `--enable-tcg-interpreter`, backend-mode builds use
    `-Dtcg_wasm64_backend=true` and omit `--enable-tcg-interpreter`, tests
    cover the generated Docker command, Meson reports
    `TCG backend: experimental wasm64 with TCI fallback`, and a full
    `riscv64-softmmu` backend-mode artifact build passes. Accepted
    2026-07-03: `scripts/ci/wasm-build-artifacts-local.py` now has
    `--tcg-wasm64-backend`; default behavior is unchanged, while backend mode
    selects `-Dtcg_wasm64_backend=true`. The parser/unit test
    `test_tcg_wasm64_backend_command_replaces_interpreter()` verifies the
    backend command shape. Checks:
    `python3 scripts/ci/wasm-build-artifacts-local-test.py`,
    `git diff --check`,
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-backend-r3b-clean
    --target riscv64 --tcg-wasm64-backend` passed. The clean build produced:
    `qemu-system-riscv64.js`
    `0e40cc3de971cfd5a06e24e438f1cbed8110f87df5a452bc2c216c0b441d6cac`,
    `qemu-system-riscv64.wasm`
    `e908866db0b00206d1f2e5ff408b036311298f17da5e18538d7a16acd32c709a`,
    manifest
    `c455ba71fbac1c911b77183810b354959b180455a4e8d2d8ef8d9bf43c6b1cad`.
    The slice does not enable generated guest execution yet; it creates the
    clean selectable artifact path required before running backend smokes.
  - [x] R3c - Add an explicit backend-generated execution gate for browser
    smoke runs. DoD: backend-built artifacts can request generated wasm64 TCG
    attempts with a backend-named option instead of relying on the older
    TCI-subset flag shape, default TCI behavior remains unchanged, the browser
    smoke result records the requested mode, and a full backend artifact build
    compiles the C path. Accepted 2026-07-03:
    `QEMU_WASM64_TCG_GENERATED=1` now makes `CONFIG_TCG_WASM64_BACKEND`
    artifacts take the fast-gated generated-output attempt path; non-backend
    builds ignore the gate. `scripts/ci/wasm-browser-smoke-runner.mjs` exposes
    `--wasm64-tcg-generated`, the browser smoke page forwards
    `QEMU_WASM64_TCG_GENERATED=1`, and the result JSON records
    `wasm64TcgGenerated`. Checks:
    `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasm-browser-smoke-args-test.mjs`,
    `python3 scripts/ci/wasm-build-artifacts-local-test.py`,
    `git diff --check`, and
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-backend-r3c-generated-flag
    --target riscv64 --tcg-wasm64-backend` passed. Meson reported
    `TCG backend: experimental wasm64 with TCI fallback`; `tcg_tci.c`
    compiled cleanly. Artifact hashes: `qemu-system-riscv64.js`
    `17ee104776f21e46a6ab83ca7f9fd1f7052df625ad1f2b0931ccba7f97201b39`,
    `qemu-system-riscv64.wasm`
    `7d0cb03fa22115c019684f09ea21feabf85fb071f37bd26f7f78dfa10183afcd`,
    manifest
    `c69bce1a579501c6f306487f3c1453a5b9264cb53d08be273926cc4333db70d0`.
    This slice does not prove speed or nonzero generated execution in a guest;
    the next R3 slice must run a backend browser smoke with this gate and
    inspect generated/fallback counters.
  - [x] R3d - Keep the generated path off unsafe direct TCI host-memory ops
    after the R3c RISC-V browser crash. DoD: direct host-memory `ld`/`st`
    opcodes are no longer accepted by
    `tcg_wasm64_translate_op_generated_supported()`, helper-backed QEMU
    load/store ops remain accepted, deterministic metadata tests enforce that
    boundary, a fresh backend artifact builds, and the generated browser proof
    no longer fails with the unaligned-access trap. Accepted 2026-07-03:
    `tcg/wasm64.c` now excludes `INDEX_op_ld`, `INDEX_op_ld32u`,
    `INDEX_op_ld32s`, `INDEX_op_st`, `INDEX_op_st8`, and `INDEX_op_st32` from
    the generated-support predicate, while keeping `INDEX_op_tci_qemu_ld_rrr`
    and `INDEX_op_tci_qemu_st_rrr`. Checks:
    `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, the three
    browser-smoke `node --check` commands from R1b, and `git diff --check`
    passed. Full artifact build:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-backend-r3d-no-host-memory
    --target riscv64 --tcg-wasm64-backend --build-image` passed. Artifact
    hashes: `qemu-system-riscv64.js`
    `17ee104776f21e46a6ab83ca7f9fd1f7052df625ad1f2b0931ccba7f97201b39`,
    `qemu-system-riscv64.wasm`
    `7195c1ac1c6e0f54e1042a029c1ca2b1f44344731cd260c724eebc4caeb6bded`,
    manifest
    `cba994d459de19bb0cc3f36e1aabb1402fbd5d6bbedbc6f02ffb22c0ff99f489`.
    Chrome `149.0.7827.201` generated browser proof wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-backend-r3d-no-host-memory/browser-riscv64-tuxboot-generated-cdp.json`
    and loaded the full 1 GiB rootfs. It did not reach `Welcome to TuxTest`;
    it produced `1554` wasm64 summaries, `generated_coverage_ppm=0`,
    `generated_attempts=0`, `translated_generated_candidate_tbs=0`,
    first unsupported generated ops `ld32u=46085` and `st8=23158`, then
    converged with the default path by aborting at
    `Assertion failed: p_rcu_reader->depth != 0`. This is a safety fix and
    blocker clarification, not a speed win. The next accepted R3 work must
    either implement a validated aligned generated-memory model or resolve the
    shared RCU assertion before another speed-gate run.
  - [x] R3e - Accept the first selectable backend runtime-smoke browser proof
    and isolate the remaining block-device failure to the `virtio-mmio` rootfs
    path. DoD: a current `riscv64-softmmu` backend artifact runs the
    QEMU-owned runtime smoke from the real Emscripten/QEMU path, records the
    runloop counters in browser result JSON, reaches the generic RISC-V Linux
    marker through a supported root block device, and records the failing
    storage shape as a named blocker instead of treating all block I/O as
    broken. Accepted 2026-07-03: checks
    `git diff --check`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner.mjs`, and
    `node scripts/ci/wasm64-runloop-contract-test.mjs` passed before the
    runtime proofs. Artifact build:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-runtime-smoke-r3
    --target riscv64 --tcg-wasm64-backend --build-image`; hashes:
    `qemu-system-riscv64.js`
    `fe0090ac02ab2cb335543f96830d235572c0da46fb6222bb36343c1cf64a4a0c`,
    `qemu-system-riscv64.wasm`
    `d28d2b6ab3cee9cbd12af522b3f180568dc5ab5efa3f709624523a097f15ef7d`,
    manifest
    `009ee5e354ff5c38fb86a0d3903346cd5f5514457331aaafb3ddcad3bf3b3a9d`.
    Chrome `149.0.7827.201` with `rootfsDevice=virtio-pci` and
    `wasm64RunloopSmoke=1` wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-rootfs-pci-runloop-result.json`
    (SHA256
    `ebbc14705ba04622c5be6bb5840025834b4da53fdd16023da216211dc6c83637`)
    and screenshot
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-rootfs-pci-runloop.png`
    (SHA256
    `20f5cb1b7c0e8e713d398fff403bea6f8391896f49c207127ab80ada5a0efab5`).
    The run reached `Welcome to TuxTest` in `40194` ms. Its
    `wasm64Runloop.lastSummary` was `ok=true`, budget `1000000`,
    generated guest-instruction equivalents `4000000`, generated body time
    `2470000` ns, compile time `140000` ns, instantiate time `20000` ns,
    generated chain length `1000000`, inline TLB-hit loads/stores
    `1000000`/`1000000`, zero helper/`qemu_ld`/`qemu_st` calls, and one
    budget exit. A `virtio-pci` no-smoke control also reached the marker in
    `44606` ms with result
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-rootfs-pci-result.json`
    (SHA256
    `32985a3a993dbefea33d7557d7ff5837a26f67e2534b7f7ecfae67f4a376e4a4`).
    The same backend artifact with no root block device reached the expected
    VFS kernel panic in `13134` ms using an empty initramfs SHA256
    `f06e8dc9202babc3500d801b84c655787ce44245b618131707c070cd1ced5bcf`,
    result
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-initrd-isolation-result.json`
    SHA256
    `89a285bb33a0abe2244bd16c78b1665cdcdddb04d9dc3d79ec962529cdfcfe33`.
    The remaining negative proof is `rootfsDevice=virtio-mmio`: result
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-backend-control-result.json`
    SHA256
    `c2ba6f0966c71cb1681665ed41c15026dc8bdb586d522d7eca6c81e71ee05b50`
    timed out after `90634` ms and aborted after `virtio_blk virtio0` with
    `Assertion failed: p_rcu_reader->depth != 0`. Therefore the current RISC-V
    browser baseline for backend artifacts should use `virtio-pci` rootfs on
    `virt` while the `virtio-mmio`/RCU assertion remains a named QEMU blocker.
- [ ] R4 - Prove performance before Bus Engine OS long runs. DoD: a same-commit
  Chromium generic RISC-V accelerator smoke is at least 25% faster than
  default RISC-V TCI, and microbenchmarks show at least 3x over RISC-V TCI for
  hot ALU/branch and TLB-hit RAM paths with at least 1,000,000
  guest-instruction-equivalent operations per `wasmjit_run()` call.
  - [x] R4a - Add a deterministic preflight gate for the generated run-loop
    microbenchmarks before spending another browser run. Accepted 2026-07-03:
    `scripts/ci/wasmjit-runloop-benchmark-gate.mjs` runs both current
    accelerator micro-workloads, requires a configurable minimum
    TCI-like/wasm best-time ratio, and can archive machine-readable JSON with
    `--out`. Command:
    `node scripts/ci/wasmjit-runloop-benchmark-gate.mjs --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-r4-wasmjit-preflight-local/runloop-benchmark-gate.json`.
    The archived result hash was
    `8deed1a988f7f778792a93f7e9db06fc1a5ea512e472246a97addc1f22861849`.
    The `alu-branch` workload used budget `1000000`, rounds `7`, wasm best
    `0.38574999999999804` ms, TCI-like best `34.14274999999998` ms, ratio
    `88.51004536617019`. The `tlb-hit-ram` workload used budget `1000000`,
    rounds `7`, wasm best `1.9760410000000093` ms, TCI-like best
    `64.48566600000004` ms, ratio `32.6337692385936`. The full
    `riscv64-softmmu` backend artifact compile gate also passed with
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-runloop-preflight
    --target riscv64 --tcg-wasm64-backend --build-image`. Artifact hashes:
    `qemu-system-riscv64.js`
    `c398c19673c3de5c3d4331cda83ba48b14470627c582072385e751cf75e9ff3f`,
    `qemu-system-riscv64.wasm`
    `60ea302e6600f4dfd0637a7ca5df9dbff30fedd3e2de655f7a709cb978b46959`,
    and manifest
    `c0d15b7d992acfbb49e79f7f31bbdf7a7deeffd24826838dcf3b50a0a96ea82a`.
    This is a deterministic preflight over the local TCI-like model plus a
    compile-checked artifact, not the R4 browser speed gate and not proof that
    Linux boot is accelerated.
  - [x] R4b - Add a same-artifact Emscripten runtime microbench that compares
    `wasmjit_run()` against the C/TCI-like hotset interpreter path inside the
    QEMU/WASM binary and records both ALU/branch and TLB-hit RAM ratios in the
    browser result JSON. DoD: both paths execute the same hotset semantics,
    report instruction counts and wall time, and the generated path is at
    least 3x faster for both workloads. Accepted 2026-07-03:
    `tcg/wasm64.c` now runs the opt-in runtime smoke as two named workloads
    from the same Emscripten QEMU binary: `alu-branch` and `tlb-hit-ram`.
    Each generated workload is compared with the matching C/TCI-like dispatch
    loop, checks matching generated/fallback instruction counts, exit values,
    RAM values, zero helper/`qemu_ld`/`qemu_st` calls, and requires
    `generated_vs_tci_speedup_ppm >= 3000000`. The browser result JSON now
    records a top-level aggregate plus a `workloads[]` array.
    Verification before the browser run: `git diff --check`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasm64-runloop-contract-test.mjs`, and
    `node scripts/ci/wasmjit-runloop-model-test.mjs`. Artifact build command:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-runtime-ratio-r2
    --target riscv64 --tcg-wasm64-backend --build-image`. Artifact hashes:
    `qemu-system-riscv64.js`
    `64f5c1aaab099fd5340971359f2d84c79d1f3933f4c7cf89d2276c56fbcc1b0a`,
    `qemu-system-riscv64.wasm`
    `c7395de68e9cfde1e1648dbc4656044cfc7caaeb5135ab90509af25830c9b7c2`,
    and manifest
    `22308952901e5978f2fa4fef282404bc7328b4a41161938352faf34e0bbf2714`.
    Browser proof used Chrome `149.0.7827.201`, `machine=virt`,
    `rootfsDevice=virtio-pci`, `wasm64RunloopSmoke=1`, and the pinned
    TuxBoot RISC-V kernel/rootfs. Commands: serve with
    `node scripts/ci/wasm-browser-smoke-server.mjs --artifact-dir
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-runtime-ratio-r2
    --kernel
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-wasm-smoke-assets/tuxboot-riscv64-Image
    --rootfs
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-official-guest/tuxboot-riscv64-rootfs.ext4
    --port 8109 --program qemu-system-riscv64.js --wasm
    qemu-system-riscv64.wasm`, launch Chrome with remote debugging on
    port `9229`, and run
    `node
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv-rootfs-pci-cdp-runner.mjs`.
    Result JSON:
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-ratio-r2/cdp-rootfs-pci-runloop-result.json`
    SHA256
    `973d059db97d3f514ed8e761dfef8e780b7bb94c32ce59f74a82fc3f57b97fb6`.
    Screenshot:
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-ratio-r2/cdp-rootfs-pci-runloop.png`
    SHA256
    `d5246dccb7b53bf8582a825d077299fc08d263e2b13af63d57d3d94600b9adee`.
    The run reached `Welcome to TuxTest` in `41503` ms. Runtime summary
    emitted at `4063` ms with `ok=true`, budget `1000000` per workload,
    aggregate generated/fallback guest-instruction equivalents
    `8000000`/`8000000`, aggregate generated body time `4740000` ns,
    aggregate C/TCI-like dispatch time `36395000` ns, aggregate speedup
    `7678270` ppm, and zero helper/`qemu_ld`/`qemu_st` calls. Per workload:
    `alu-branch` generated `4000000` and fallback `4000000` guest-instruction
    equivalents, generated body `2610000` ns, C/TCI-like dispatch
    `15765000` ns, speedup `6040229` ppm, inline TLB loads/stores `0`/`0`,
    and matching exit/RAM values; `tlb-hit-ram` generated `4000000` and
    fallback `4000000`, generated body `2130000` ns, C/TCI-like dispatch
    `20630000` ns, speedup `9685446` ppm, inline TLB loads/stores
    `1000000`/`1000000`, and matching exit/RAM values.
  - [ ] R4c - Run the same-commit generic Chromium RISC-V speed gate only
    after R4b passes. DoD: build one default-TCI artifact and one accelerator
    artifact from the same commit, run the same generic guest/marker, record
    hashes/browser/result JSON/timings, and show the accelerator marker time
    is at least 25% faster. Attempt 2026-07-03 from QEMU commit
    `3bb1593ad0` did not pass the gate. The default-TCI artifact was built
    with `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-r4c-default-tci
    --target riscv64 --build-image`; hashes: `qemu-system-riscv64.js`
    `cbf0836c26df510e1eae6ede43b86d30195975e477e0a2b5f8ca3d65181225f6`,
    `qemu-system-riscv64.wasm`
    `d7919529b2f7f44e61edbaa8b6b3a70ec42e7107acea64945437dbbbd5b62149`,
    manifest
    `35f69d9924ae12a587dd65b483b41d985f0d6f422ff9cc1ec216e6ef96d641c3`,
    and `SHA256SUMS`
    `e3195fb1df814ce8faf5f47036ee7535d3e45c76cbc6b104e111c465e3dcdb61`.
    The same-commit accelerator artifact was the accepted R4b artifact:
    `qemu-system-riscv64.js`
    `64f5c1aaab099fd5340971359f2d84c79d1f3933f4c7cf89d2276c56fbcc1b0a`,
    `qemu-system-riscv64.wasm`
    `c7395de68e9cfde1e1648dbc4656044cfc7caaeb5135ab90509af25830c9b7c2`,
    and manifest
    `22308952901e5978f2fa4fef282404bc7328b4a41161938352faf34e0bbf2714`.
    Both runs used Chrome `149.0.7827.201`, `machine=virt`, blank CPU,
    `rootfsDevice=virtio-pci`, kernel append `printk.time=0 root=/dev/vda
    console=ttyS0 panic=-1`, marker `Welcome to TuxTest`, network `none`,
    and the pinned TuxBoot RISC-V kernel/rootfs. The default run wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-r4c-default-tci/result.json`
    (SHA256
    `b4966aa9bcf62520f257c4f6a3533a35126d9010092400e082b4968110d0afb6`)
    and screenshot
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-r4c-default-tci/screenshot.png`
    (SHA256
    `addafcc0b27012e824d035a013a13b3a2cf2e2753b7bf27188f83d90ba180642`),
    reaching the marker in `43329` ms. The accelerator run wrote
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-r4c-accelerator/result.json`
    (SHA256
    `8462847618a0fa315c659fb1ee480dcb08aef3fc1d2cf437271a7c0c54266083`)
    and screenshot
    `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-r4c-accelerator/screenshot.png`
    (SHA256
    `d5246dccb7b53bf8582a825d077299fc08d263e2b13af63d57d3d94600b9adee`),
    reaching the marker in `36629` ms. That is a `15.46%` marker-time
    improvement, below the required `25%`; the accelerator would have needed
    `32497` ms or faster against this default run. This is rejected R4c
    evidence, not accepted progress toward R5.
  - [ ] R4d - Move from the opt-in runtime smoke to generated execution that
    covers real guest translation blocks in the generic RISC-V boot path. DoD:
    before another R4c attempt, browser result JSON must show nonzero generated
    execution coverage from actual guest TBs before `Welcome to TuxTest`, top
    fallback PCs/TBs or unsupported op shapes for the remaining hot path, and a
    deterministic test proving strict TCI fallback remains the default. The
    next R4c attempt must use the same-commit default/accelerator comparison
    and beat the `25%` marker-time gate before any Bus Engine OS browser proof
    is run. Progress 2026-07-03: added an opt-in browser harness metric gate
    for the next R4d/R4c run. `scripts/ci/wasm-browser-smoke-runner.mjs` now
    accepts `--require-wasm64-tcg-coverage`,
    `--min-wasm64-tcg-coverage-ppm`, and
    `--require-wasm64-tcg-fallback-attribution`; the require flags
    automatically enable wasm64 TCG summary collection and fail the run if the
    final result lacks nonzero generated execution/cache-hit coverage, live
    coverage numerator/denominator/ppm, translated TBs, or requested fallback
    attribution from unsupported op shapes or hot-block summaries.
    Deterministic coverage in `scripts/ci/wasm-browser-smoke-runner-test.mjs`
    exercises passing coverage, zero-coverage failure, hot-block fallback
    attribution, missing-summary failure, CLI option parsing, and invalid
    coverage threshold rejection. Verification passed: `node --check
    scripts/ci/wasm-browser-smoke-runner.mjs`; `node --check
    scripts/ci/wasm-browser-smoke-runner-test.mjs`; `git diff --check --
    scripts/ci/wasm-browser-smoke-runner.mjs
    scripts/ci/wasm-browser-smoke-runner-test.mjs`; and `node
    scripts/ci/wasm-browser-smoke-runner-test.mjs`. No browser run, artifact
    build, or real RV64 generated-coverage proof was run in this harness slice,
    so R4d remains open.
  - [ ] R4d-a - Re-audit previously rejected positive-speed QEMU/WASM
    experiments under the cumulative-improvement strategy. DoD: review the
    supervisor memos and this plan for experiments that were measurably faster
    but rejected only because they did not close the whole five-minute gap;
    classify each as already on `develop`, intentionally rejected, or
    unpromoted; for each unpromoted candidate, rebase or recreate it on current
    `develop`, run deterministic checks and a same-commit browser comparison
    before promotion, and record commands, artifact hashes, timings, percentage
    change, and non-regression evidence. Only promote a candidate if current
    evidence still shows an improvement on an active gate or final cold-boot
    path. Initial classification from 2026-07-03: the RISC-V R4c `15.46%`
    same-commit improvement is already reachable from current `develop` but
    remains below the R4c `25%` gate; opt-in TCI fast gates commit
    `484370d4d2` is already on `develop`; W1 address-limited Memory64 evidence
    was a `5.8%` comparison but did not change the selected artifact family;
    `origin/qemu-r4-wasmjit-speed-gate` remains the main unpromoted branch
    requiring review and current retest before any integration.
  - [x] R4e - Preserve the target-neutral accelerator pieces so the RISC-V
    runtime work can be reused by an x86_64 accelerator lane without copying
    or re-inventing the proof contract. DoD: document and test that the
    reusable surface is target-neutral: `TCGWasm64RunContext`, synthetic exit
    reasons, `TCGWasm64RunCounters`, the `wasmjit_run(ctx,budget)` C/Wasm
    boundary, the Emscripten module-instantiation path, browser result JSON
    parsing, and the `alu-branch`/`tlb-hit-ram` runtime smoke workloads. The
    item is not accepted if it introduces x86_64 lowering or claims any x86_64
    Linux speedup; it is only the shared contract that both `riscv64-softmmu`
    and future `x86_64-softmmu` accelerator work must use. Accepted
    2026-07-03: the shared contract is now covered by deterministic tests
    rather than by any x86 lowering or live R4i work. Checks:
    `node scripts/ci/wasm64-runloop-contract-test.mjs`,
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasmjit-runloop-model-test.mjs`, and
    `git diff --check` passed. The contract test covers
    `TCGWasm64RunContext`, `TCGWasm64RunCounters`, synthetic exit reasons,
    `wasmjit_run(ctx,budget)` ABI strings, and the `alu-branch` /
    `tlb-hit-ram` workload names. The model test covers the shared module
    import/export path and workload semantics. The browser smoke runner test
    covers browser result JSON parsing for the shared runloop summary shape
    and keeps the runner validation diagnostics testable in-process under
    piped Node execution.
  - [ ] R4f - Add an x86_64 reuse and gap map before implementing x86_64
    generated execution. DoD: using current `x86_64-softmmu` browser smoke
    evidence or a fresh bounded smoke, record which parts are reusable from
    R4b/R4e and which are x86-specific. The reusable list must include the
    run/exit ABI, counters, browser harness parser, module-instantiation
    path, runtime ratio smoke, no-silent-fallback mode, and same-commit speed
    gate shape. The x86-specific list must include CPU state/register mapping,
    flags and condition-code handling, segmentation/privilege-sensitive state,
    x86 helper exits, x86 TCG op lowering, real x86 SoftMMU/TLB-hit
    load/store lowering, TB chaining/hotset dispatch, and invalidation rules.
    The output must name the first deterministic x86_64 tests to write and
    the first top hot TB/op shapes that would block real generated coverage.
    Started 2026-07-03 from existing evidence only; no code or browser run was
    performed. Reusable from R4b/current x86 evidence: the
    `wasmjit_run(ctx,budget)` run/exit ABI and budget-exit loop shape; runtime
    counters for generated/fallback instruction-equivalent counts, body time,
    C/TCI-like dispatch time, inline TLB-hit loads/stores, helpers, `qemu_ld`,
    `qemu_st`, chain length, compile/instantiate time, and exit reason; the
    browser parser/result JSON paths for `wasm64Runloop` and `wasm64Tcg`
    summaries; the Emscripten module-instantiation path used by the
    same-artifact runtime smoke; the `alu-branch` and `tlb-hit-ram` runtime
    ratio smoke workloads; the strict/no-silent-fallback performance contract;
    and the same-commit default-versus-accelerator Chromium speed-gate shape.
    X86-specific before real generated execution: map `CPUX86State` general
    registers, `eip/rip`, segment bases/limits/selectors, control registers,
    privilege-sensitive state, and lazy flags/condition-code state; define
    helper exits for x86 architectural helpers and side-effectful helpers;
    lower only the measured real x86 TCG op shapes; add real x86 SoftMMU
    TLB-hit load/store lowering for safe RAM hits; preserve exits for misses,
    MMIO, page faults, page-crossing and permission-sensitive cases; attach
    internal TB chaining or hotset dispatch without returning to QEMU per TB;
    and prove generated code cannot outlive TB or address-space invalidation.
    First deterministic tests to write: x86 CPU-state offset/register flush
    fixture; lazy-flags/setcond/brcond equivalence fixture; segmentation and
    privilege-sensitive fallback fixture; x86 helper-exit classification
    fixture; SoftMMU TLB-hit load/store equivalence with miss/MMIO/page-fault
    exits; TB invalidation/stale-code rejection fixture; and same-input
    live-TB differential fixture that records TB identity, `TranslationBlock`
    `icount`, register checksum, memory writes, and dispatch target. Current
    top blockers from R4h/R4i-a evidence are the stable unsupported-op family
    `ld32u=43978` plus `st8=22`, with the first attachable fixture shape
    `ld32u, tci_movi, tci_setcond32, brcond, tci_movi, st8, ld, tci_movi,
    add, st, goto_tb, exit_tb, exit_tb`; `call`-heavy TBs remain fallback
    until a helper-exit design exists. R4f remains open because current x86
    evidence does not record a real hot TB PC/identity plus
    `TranslationBlock.icount` for the `ld32u`-first family; the pre-R4i
    fixture explicitly reports `real_live_state_capture=false`.
  - [ ] R4g - Record the current x86_64 baseline and shared accelerator
    contract evidence without accepting it as real x86 acceleration. DoD:
    build current default-TCI and backend-gated `x86_64-softmmu` Emscripten
    artifacts, run the deterministic runloop/parser/contract tests, run the
    opt-in runtime smoke in Chrome/Chromium, verify default x86_64 TCI smoke
    behavior, and explicitly record that real x86 guest TB generated coverage
    remains zero until R4i. Evidence captured 2026-07-03 from QEMU commit
    `b4bc035facc9956f9a81bf4ef9649d83e8a627bf`: default artifact
    `qemu-system-x86_64.js`
    `105d0404f8f105be8604cff8f4f094c665a663c9696bd5dab3f7ab7e20e69870`,
    `qemu-system-x86_64.wasm`
    `6fe1613185bcbdb0fdfd7fddfac6c1ea384a0ebb92893887c1081c5d6af7c50e`,
    manifest
    `d9c96709f2984502d92097397efcbf7c05dc695de05be9e9dd5e86e35190cad0`;
    backend-gated artifact `qemu-system-x86_64.js`
    `f2cd3daf6f04af351f23316de5156d7a3d1bd94a14526c40a0a4ae7c8e0c39b4`,
    `qemu-system-x86_64.wasm`
    `183fee2e9a51e1870e60384d32ba8fd07a3e84f8b0cc0718fa8e42331c47de01`,
    manifest
    `e2304da4745f1d92f13a380e2e39098325ba81289152124b6aa4197f4d34e6a9`.
    Chrome/Chromium `149.0.7827.55` default TuxBoot smoke reached
    `QEMU_WASM_LINUX_BOOT_OK` in `86715` ms with result JSON
    `tmp/qemu-x86_64-current-guest-20260703-06/wasm-browser-smoke-result.json`
    SHA256
    `096401f6c8ffa05aa55705daeae059f6690935842a7d4e8fb6040cfffd01ed7f`.
    The backend-gated run with `wasm64RunloopSmoke=1` reached the same marker
    in `86074` ms with result JSON
    `tmp/qemu-x86_64-current-backend-smoke-20260703-06/wasm-browser-smoke-result.json`
    SHA256
    `c92ec0621522245a390faa033bf2002507783013df58d901ea3a4d0e42f88930`.
    The runtime smoke reported aggregate generated/fallback
    guest-instruction-equivalent counts `8000000`/`8000000`, generated body
    time `9125000` ns, TCI-like dispatch time `89932000` ns, and zero
    helper/`qemu_ld`/`qemu_st` calls for synthetic micro-workloads. Live x86
    TB summaries remained empty (`wasm64Tcg.summaryCount=0`), so this is
    baseline/contract evidence only, not a performance pass.
  - [x] R4h - Fix x86_64 live-TB instrumentation correctness before relying
    on generated-coverage counters. DoD: reproduce and fix, or prove absent
    on the current x86_64 lane, both correctness signals from the supervisor
    review: the RCU unlock abort (`p_rcu_reader->depth != 0`) during an
    attach-probe run, and counter instability where
    `translated_generated_output_tbs` can fall from about `22000` to `0`
    between adjacent near-identical runs. The accepted result must include
    deterministic tests or a bounded browser/fixture proof showing stable
    translated-output counters for the same artifact and no guest-crashing
    diagnostic path. Accepted 2026-07-03: live translation metadata counting
    now happens once per valid metadata record through
    `TCG_WASM64_TB_METADATA_TRANSLATION_COUNTED`, and interval summaries are
    emitted from the live x86_64 backend path through the browser smoke
    harness. Checks: `git diff --check`,
    `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm64-runloop-contract-test.mjs`,
    `node scripts/ci/wasmjit-runloop-model-test.mjs`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`, and
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs` passed; the final
    runner test was outside the sandbox because sandboxed `spawnSync` returns
    `EPERM`. Backend artifact build command:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86_64-r4h-summary-20260703
    --target x86_64 --jobs 20 --tcg-wasm64-backend --build-image`.
    Artifact hashes: `qemu-system-x86_64.js`
    `04bf7aabf5c108c7da990c6b8545cc6a1c5913ea4fdf90b7ef96345caf751e2f`,
    `qemu-system-x86_64.wasm`
    `fb4b2b989776e034099efd9199f096b1336e177ff695d3c494fe5315f4700943`,
    manifest
    `78bd3ca1af4c6a6c1e97ab9f3a6e4ca952478cc72dc2484d69b6db7acac10653`.
    An initial Chromium run reached `QEMU_WASM_LINUX_BOOT_OK` in `86261` ms
    but recorded `summaryCount=0`; this exposed and fixed that
    `wasm64TcgSummary` did not cause `/qemu-tci-env` to be written unless
    another diagnostic mode was also enabled. Two adjacent runs with the same
    artifact and `QEMU_WASM64_TCG_SUMMARY_INTERVAL=1000` then reached the
    marker without the RCU abort: run 2 wrote
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86_64-r4h-summary-run2-20260703/wasm-browser-smoke-result.json`
    SHA256
    `4c43c94a95a6a91ecc59ef6eb0acfdb42e078c8184ed0fb45d7071ad1107b8ce`
    and reached the marker in `90679` ms; run 3 wrote
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86_64-r4h-summary-run3-20260703/wasm-browser-smoke-result.json`
    SHA256
    `3b7cffcdc73714b5761d79e6c053552bc82b80c58cd6da31fe2a6c16e664221e`
    with screenshot SHA256
    `42173b91ea8fd92405f08e4a53f3124a134480437283e70c81e0252ec3b20e64`
    and reached the marker in `89035` ms. Both summary-enabled runs used
    Chromium `149.0.7827.55`, recorded `summaryCount=44`, and retained stable
    monotonic summaries from `translated_tbs=29000` through `44000`; in both
    final summaries `translated_generated_output_tbs=0`,
    `translated_generated_output_unavailable_tbs=44000`,
    `exec_generated_output_lookup_tbs=44000`,
    `exec_generated_output_available_tbs=0`, and the first unsupported
    generated ops were `ld32u=43978` and `st8=22`. This accepts R4h as
    instrumentation stability only. It is not acceleration evidence:
    `generated_compiled=0`, `generated_executed=0`, and R4i remains the next
    x86 implementation gate.
  - [x] R4i - Prove one real translated x86 Linux TB through
    `wasmjit_run()` before any more structural accelerator widening. DoD:
    choose one highest-frequency attachable live x86_64 TB shape from a real
    generic Linux or Bus Engine OS boot; use the measured `ld32u`-first family
    unless fresh attribution proves a better attachable target. Capture the
    same input state for generated execution and TCI, execute the TB through a
    generated Wasm body reached from `wasmjit_run()`, and differentially
    verify guest-visible register state, memory writes, and exit/dispatch
    target against TCI. The standard metrics must record nonzero generated
    guest-instruction retirement for that real TB. `call`-heavy TBs stay on
    fallback until a helper-exit design exists. Descriptor fields may be added
    only when required by this single TB proof. Accepted 2026-07-03: branch
    `qemu/r4i-live-x86-tb-20260703-09` proved one live translated
    `x86_64-softmmu` generic Linux TB with shape `ld32u, tci_movi,
    tci_setcond32, brcond, tci_movi, st8, ld, tci_movi, add, st, goto_tb`.
    Focused deterministic checks passed:
    `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox,
    and `git diff --check`. Artifact build:
    `python3 scripts/ci/wasm-build-artifacts-local.py --out
    tmp/qemu-x86_64-r4i-live-one-tb-20260703-schema --target x86_64 --jobs
    20 --tcg-wasm64-backend --build-image`. Artifact hashes:
    `qemu-system-x86_64.js`
    `765bc4f3c4d76699adba49429fcf39fadaac99e5653d2d0ad167fa3d0a34bc10`,
    `qemu-system-x86_64.wasm`
    `66a05708ede65968c08c03cd0d1d58ccf19c3bac741a96f7f8c27478f2c96d55`,
    manifest
    `7013c88806b3255319908f3404df835c2d49b4b43bdf1722baaa58620b36f5d4`.
    The single bounded Chromium `149.0.7827.55` proof used
    `--wasm64-live-one-tb-differential --wasm64-tcg-summary`, reached
    `QEMU_WASM_LINUX_BOOT_OK` in `91175` ms, and wrote
    `tmp/qemu-x86_64-r4i-live-one-tb-guest-20260703/wasm-browser-smoke-live-one-tb-schema-result.json`
    SHA256
    `91c4c3466bfd5d65e7a61196bd3af4bc13a03a130d70e26f0a990a2abbf290ff`;
    screenshot SHA256
    `ce23ee51209b585cc07d071ec6e406a4fb3f2dde8f2f8d34f987981a269e0024`.
    The result contained 24 `live-one-tb-differential` events, all `ok=true`.
    The selected live event had `real_live_state_capture=true`,
    `live_shape_fixture=false`, `tb_ptr=0x78700c0`, `tb_pc=0x0`,
    `tb_cs_base=0xffff0000`, `tb_flags=64`, `tb_cflags=4278321152`,
    `tb_size=3`, `tb_icount=1`, `metadata_op_count=13`,
    `generated_guest_instructions=1`, `reference_guest_instructions=1`,
    matching generated/reference dispatch target `126288108`, register
    checksum `407154517823240700`, memory checksum `8033238923928634000`,
    and memory writes `2`. It reported `inline_tlb_hit_loads=2`,
    `inline_tlb_hit_stores=2`, and zero `helper_calls`, `qemu_ld_calls`, and
    `qemu_st_calls`. The normal guest path stayed on TCI: final summary
    `generated_attempts=0`, `generated_compiled=0`, `generated_executed=0`,
    `generated_coverage_numerator=0`, `generated_coverage_denominator=0`,
    `translated_tbs=40000`, and `exec_generated_output_available_tbs=0`.
  - [x] R4i-a - Add a pre-R4i deterministic one-TB fixture scaffold without
    claiming real live-state R4i completion. DoD: the measured non-`call`
    `ld32u`-first x86 shape is represented as an opt-in generated
    `wasmjit_run()` fixture, compared against a reference interpreter from the
    same deterministic state, and the emitted metrics explicitly name
    TCI-op-equivalent counts rather than guest-instruction retirement. Accepted
    2026-07-03: branch `r4i-x86-one-tb-differential` added
    `QEMU_WASM64_ONE_TB_DIFFERENTIAL` and fixture
    `live-x86-pre-r4i-ld32u-goto-tb-13`, with JSON fields
    `live_shape_fixture=true`, `real_live_state_capture=false`,
    `generated_tci_op_equivalents=11`, and
    `reference_tci_op_equivalents=11`. Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm-browser-smoke.mjs`,
    `node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`,
    `node scripts/ci/wasm64-runloop-contract-test.mjs`,
    `node scripts/ci/wasmjit-runloop-model-test.mjs`,
    `node scripts/ci/wasm-browser-smoke-runner-test.mjs` outside the sandbox,
    and `python3 scripts/ci/wasm-build-artifacts-local.py --out
    /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86_64-pre-r4i-fixture-20260703
    --target x86_64 --jobs 20 --tcg-wasm64-backend --build-image` passed.
    Artifact hashes: `qemu-system-x86_64.js`
    `c717b25cee9899c9630f5ec5b425dc24941d6118968d31d162c3fe57c64cb5c2`,
    `qemu-system-x86_64.wasm`
    `3f2a0af94dca5d469297d698d3a7d83550e5863a4c328028f3cfb764141b301c`,
    manifest
    `75923af90d077d43b359f2a28f3a0eaac1de747d398f6e41a1e89263914b52f2`.
    Chromium `149.0.7827.55` browser proof with
    `--wasm64-one-tb-differential` reached `QEMU_WASM_LINUX_BOOT_OK` in
    `88954` ms and wrote
    `/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-x86_64-pre-r4i-fixture-run-20260703/wasm-browser-smoke-result.json`
    SHA256
    `9233a829fc6fd2563332dc94e792e37eac4932436816c652e5934a24233fe467`;
    screenshot SHA256
    `0061a54bdf99a141e64c195d1db08e4e7c04a355089f9832132c584083f6edf3`.
    The event reported `ok=true`, matching generated/reference dispatch target
    `20552`, register checksum `4806450183793710000`, memory checksum
    `16094818889002498000`, and two memory writes with no helper,
    `qemu_ld`, or `qemu_st` calls. This is useful scaffold evidence only:
    `R4i` remains open until a real live TB instance has TB identity,
    `TranslationBlock.icount`, same-input CPU/TB state, and nonzero generated
    guest-instruction retirement.
  - [x] R4j - Decide whether the bespoke descriptor ABI remains viable or the
    x86 lane switches to a reference-shaped per-TB generated function body.
    DoD: after R4i, record whether the descriptor ABI expressed the dominant
    real TB shape without per-shape special cases. Continue the descriptor ABI
    only with that evidence. Otherwise switch the emission strategy to a
    per-TB generated function body modeled on the `ktock/qemu-wasm`
    `wasm64-tcg-b` reference while preserving this branch's run/exit loop,
    internal chaining/hotset target, no-silent-fallback mode, and metrics
    contract. Do not accept sunk-cost arguments as evidence. Accepted
    2026-07-03: switch the x86 R4k implementation vehicle to a
    reference-shaped per-TB generated function body. R4i proved one live
    translated `x86_64-softmmu` TB with shape `ld32u, tci_movi,
    tci_setcond32, brcond, tci_movi, st8, ld, tci_movi, add, st, goto_tb`
    through generated Wasm reached from `wasmjit_run()`, differentially
    verified against TCI. That proof did not show that the bespoke descriptor
    ABI can naturally express R4k. The C/JS implementation of the proof still
    hard-codes the selected shape's scratch layout, register locals
    (`r4`, `r5`, `r13`, `r14`), branch form, inline TLB-hit access sequence,
    `goto_tb` slot delta, dispatch target, status, expected writes, and
    counter increments. The side-band descriptor/metadata ABI currently
    records TCI words, counts, first unsupported opcodes, and availability
    flags; it does not encode a general per-TB body with CPU-state layout,
    guest-instruction retirement, internal chaining/hotset dispatch, inline
    SoftMMU/TLB-hit guards for arbitrary load/store shapes, helper/synthetic
    exit sites, invalidation generation, or no-silent-fallback hot-path
    policy. Continuing it would require another descriptor field or
    shape-specific case for each R4k requirement, which is the
    sunk-cost/one-shape pattern R4j was meant to reject. The existing
    deterministic `scripts/ci/wasm-generated-output-equivalence-test.mjs`
    body compiler is the design model for R4k: decode each TB's recorded TCI
    words into one generated function body, fail closed for unsupported
    shapes, and keep this branch's `TCGWasm64RunContext`/`wasmjit_run()`
    run-exit loop, metrics, strict fallback mode, and future hotset/chaining
    table.
  - [ ] R4k - Expand from the one-TB proof to x86_64 generated bodies with
    internal chaining and inline SoftMMU/TLB-hit RAM load/store fast paths.
    DoD: generated x86_64 bodies retire counted guest instructions inside
    Wasm, avoid returning to the QEMU main loop per TB on deterministic hot
    paths, keep hot CPU state in Wasm locals where safe, and do not call
    `qemu_ld`/`qemu_st` helpers on common TLB-hit RAM loads/stores. Miss,
    MMIO, permission fault, page-crossing, unsupported helper, invalidation,
    interrupt, and budget expiry must exit or fall back with precise reason
    counters. No-silent-fallback performance mode must fail loudly for
    unsupported hot x86 paths. Ordered implementation slices after R4j:
    (1) add a deterministic per-TB function-body emitter scaffold for the R4i
    TCI-word shape that compiles the recorded words into a body instead of
    the hard-coded one-TB path; prove byte/module validity and differential
    equivalence locally with `wasm-generated-output-equivalence-test.mjs`
    extended to cover the selected emitter path; (2) define and test the x86
    CPU-state contract for general registers, RIP/EIP, lazy condition-code
    inputs, and required flush points, with no browser run; (3) connect one
    live translated TB to the per-TB body path through `wasmjit_run()` and
    require nonzero generated guest-instruction retirement plus precise
    no-silent-fallback failure when the selected hot shape is unsupported;
    (4) add a deterministic two-TB hotset/`goto_tb` dispatch fixture that
    stays inside generated Wasm for chained hits and exits only for missing,
    invalidated, interrupt, helper, unsupported, or budget cases; (5) replace
    shape-specific load/store handling with guarded x86 SoftMMU/TLB-hit RAM
    load and store fast paths, with deterministic hit/miss/MMIO/page-fault/
    page-crossing tests and zero `qemu_ld`/`qemu_st` calls on proven hits;
    (6) add stale-TB/address-space invalidation rejection and metrics tests.
    Browser smokes remain blocked until these deterministic slices pass.
    Slice 1 accepted 2026-07-03 on branch
    `qemu-r4k-per-tb-emitter-20260703-10`: the deterministic
    `scripts/ci/wasm-generated-output-equivalence-test.mjs` gate now routes
    fixture execution through named emitter
    `r4k-per-tb-function-body-emitter`, validates generated module bytes with
    `WebAssembly.validate`, and covers the accepted R4i live word shape
    `ld32u, tci_movi, tci_setcond32, brcond, tci_movi, st8, ld, tci_movi,
    add, st, goto_tb` from recorded TCI words rather than the hard-coded
    one-TB body. Unsupported shapes fail closed with explicit reason data; the
    R4i fixture also records a fail-closed runtime guard for the taken
    out-of-recorded-range `brcond` target. Local evidence reported
    `fixtures=13`, `unsupportedFixtures=1`, `emittedModuleFixtures=13`,
    `r4iPerTBEmitterFixtures=1`, register and memory state matched, dispatch
    target `20618`, `r4iPerTBEmitterGeneratedGuestInstructions=1`,
    `r4iPerTBEmitterGeneratedTciOpEquivalents=11`,
    `r4iPerTBEmitterInlineTlbHitLoads=2`,
    `r4iPerTBEmitterInlineTlbHitStores=2`,
    `r4iPerTBEmitterMemoryWrites=2`, and zero helper, `qemu_ld`, and
    `qemu_st` calls. Checks: `git diff --check`,
    `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    No browser smoke, live guest routing, broad chaining, x86 CPU-state
    contract, no-silent-fallback performance mode, or generic SoftMMU/TLB
    lowering was run or enabled; R4k remains open for slices 2-6.
    Slice 2 accepted 2026-07-03 on branch
    `qemu-r4k-x86-cpu-state-20260703-10`: the deterministic per-TB emitter
    gate now records `r4iX86CpuStateContract` for the accepted R4i word shape.
    The contract names QEMU's x86 TCG globals and backing `CPUX86State`
    fields: general register input `CPUX86State.regs[R_R14]`,
    dirty/required flush registers `CPUX86State.regs[R_ESP]`,
    `CPUX86State.regs[R_EBP]`, and `CPUX86State.regs[R_R13]`,
    `CPUX86State.eip`/`cpu_eip` as not read or written by the generated body
    with dispatch target supplied by the recorded `goto_tb` slot, and lazy
    condition-code fields `CPUX86State.cc_dst`, `cc_src`, `cc_src2`, and
    `cc_op` as unmodeled except for the explicit `tci_setcond32` comparison
    inputs from the TCI register operands. The test requires all generated
    register locals to flush before `goto_tb`/`exit_tb` terminal return and
    before a runtime `STATUS_UNSUPPORTED` return; the taken
    out-of-recorded-range `brcond` guard returns status `6` with dirty locals
    flushed (`R_ESP=4294967295`, `R_EBP=0`, `R_R13=1`). Explicit negative
    fixtures fail closed for direct RIP/EIP write
    (`unmodeled-rip-eip-write`), lazy CC state read
    (`unmodeled-lazy-condition-code-state`), segment state read
    (`unmodeled-segment-state`), and helper-sensitive state
    (`unmodeled-helper-sensitive-state`). Local evidence reported
    `fixtures=13`, `unsupportedFixtures=1`, `r4iPerTBEmitterFixtures=1`,
    `r4iPerTBEmitterGeneratedGuestInstructions=1`,
    `r4iPerTBEmitterGeneratedTciOpEquivalents=11`, zero helper, `qemu_ld`,
    and `qemu_st` calls, and the contract fields above. Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    No browser smoke, live guest routing, broad chaining,
    no-silent-fallback performance mode, or generic SoftMMU/TLB lowering was
    run or enabled; R4k remains open for slices 3-6.
    Slice 3 accepted 2026-07-03 on branch
    `qemu-r4k-live-tb-body-20260703-11`: the opt-in live one-TB differential
    path still enters through `tcg_wasm64_tb_exec()` and still returns to the
    normal TCI fallback for guest execution, but the generated `wasmjit_run`
    body for the accepted R4i live TB is now sourced from
    `metadata->generated_output` and `metadata->generated_output_size` instead
    of the removed hard-coded `tcg_wasm64_live_one_tb_words[]` body source.
    The live gate fails closed with explicit JSON/status reporting for missing
    metadata, generated output unavailable for the selected hot shape,
    selected hot shape unsupported by the live per-TB emitter, metadata output
    versus TB code drift, module emission failure, and module validation
    failure. Unsupported selected hot shapes report
    `generated_guest_instructions=0` and are not counted as successful
    generated work. Successful selected live execution can still record
    nonzero generated guest-instruction retirement for the single TB
    (`guestInsns`, `1` for the accepted R4i fixture) plus the existing
    `11` generated TCI-op equivalents, two inline TLB-hit loads, two inline
    TLB-hit stores, two memory writes, and zero helper, `qemu_ld`, and
    `qemu_st` calls. The deterministic equivalence gate now records
    `r4kLiveMetadataRouting` cases: `metadata-missing`,
    `generated-output-unavailable`, `selected-hot-shape-unsupported`,
    `unsupported-shape` mapped to `module-emission-failed`, and a successful
    R4i metadata-backed route with `generatedGuestInstructions=1`,
    `moduleValid=true`, and module byte length `564`. Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`,
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`,
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    No browser smoke, speed claim, two-TB chaining, broad SoftMMU/TLB
    lowering, helper exits, RISC-V work, BusDK work, or Bus Engine OS proof
    was run or enabled; R4k remains open for slices 4-6.
    Slice 4 accepted 2026-07-03 on branch
    `qemu/r4k-two-tb-hotset-20260703-11`: the deterministic equivalence gate
    now includes a `r4k-two-tb-hotset-dispatch-fixture` module that exports a
    single `wasmjit_run` entry, executes TB A from the accepted R4i recorded
    `ld32u, tci_movi, tci_setcond32, brcond, tci_movi, st8, ld, tci_movi,
    add, st, goto_tb` shape, reads A's recorded `goto_tb` slot, and dispatches
    to a second generated TB body without returning to JavaScript/QEMU for the
    chained-hit case. The successful fixture
    `r4k-two-tb-chained-hit` reported one generated module call,
    `moduleValid=true`, module byte length `1142`, matching source and target
    dispatch target `29184`, register and memory state matched,
    `generatedGuestInstructions=2`, `generatedChainLength=2`,
    deterministic stand-in `generatedBodyTimeNs=2000`, inline TLB-hit loads
    `2`, inline TLB-hit stores `2`, and zero helper, `qemu_ld`, and
    `qemu_st` calls. Fail-closed deterministic fixtures now cover
    `missing-chain-target`, `unsupported-chain-target-shape`,
    `budget-before-second-tb`, and `invalidated-chain-target`; all four
    negative cases reported `generatedGuestInstructions=0`,
    `generatedChainLength=0`, `generatedBodyTimeNs=0`, matching state after
    TB A only, and the expected exit counter (`exitsUnsupported=1`,
    `exitsBudget=1`, or `exitsInvalidated=1`). Checks:
    `git diff --check`, `node scripts/ci/wasm64-translate-metadata-test.mjs`
    (`wasm64 translate metadata contract: ok`),
    `node scripts/ci/wasm-generated-output-equivalence-test.mjs`
    (JSON event `generated-output-equivalence`, `r4kTwoTBHotset.fixtureCount=5`),
    `node --check scripts/ci/wasm64-translate-metadata-test.mjs`, and
    `node --check scripts/ci/wasm-generated-output-equivalence-test.mjs`.
    This is deterministic local accelerator-shape evidence only, not a
    browser smoke, browser speed claim, same-commit speed gate, broad
    SoftMMU/TLB lowering, RISC-V work, BusDK work, or Bus Engine OS proof;
    R4k remains open for slices 5-6.
  - [ ] R4l - Run the x86_64 same-commit generic Chromium speed gate only
    after R4h-R4k have deterministic evidence. DoD: build one default-TCI
    `x86_64-softmmu` artifact and one accelerator artifact from the same
    commit, run the same generic x86_64 browser guest/marker, record hashes,
    browser version, result JSON paths, generated/fallback instruction counts,
    generated body time, TCI dispatch time, helper/`qemu_ld`/`qemu_st` counts,
    internal chain or hotset residency, and marker timings. The accelerator
    must beat same-commit default TCI by at least `25%`; otherwise record the
    failed gate and re-plan before another x86 browser run.
- [ ] R5 - Run the final Bus Engine OS proof only after R1-R4 pass. DoD: the
  accepted package-built Bus Engine OS `riscv64` `virtual-server` image boots
  cold in browser-hosted QEMU/WASM with the accelerator and reaches
  `Reached target Multi-User System.` plus login prompt or
  `QEMU_WASM_SERVICE_READY` within `300000` ms, with all logs and hashes
  archived.
- [ ] R5x - Run the x86_64 Bus Engine OS proof for the x86 supervisor lane
  only after R4l passes. DoD: the accepted package-built Bus Engine OS
  `x86_64` `virtual-server` kernel/rootfs boots cold in browser-hosted
  QEMU/WASM with the x86_64 accelerator and reaches `Reached target
  Multi-User System.` plus login prompt or `QEMU_WASM_SERVICE_READY` within
  `300000` ms, with current artifact hashes, browser version, result JSON,
  screenshot, serial log, and milestone timings archived. This item must not
  use RISC-V smoke measurements to estimate or accept x86_64 progress.

Historical x86_64/WASM evidence below remains useful for rejected mechanisms,
measurement discipline, and non-regression checks. Do not execute the old W2
items as the active implementation path unless they are explicitly rewritten
for the current checked goal lane.

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
4. Generated-Wasm work is steered by gate metrics, not rejection-list churn or
   boundary-entry coverage. Every summary must record generated/fallback guest
   instruction retirement, wall time in generated bodies, wall time in TCI
   dispatch, wall time in TB lookup/main-loop work, helper/`qemu_ld`/
   `qemu_st` time or counts, internal generated-chain length, and synthetic
   exit reasons. A change that cannot plausibly improve same-commit wall
   clock time or generated run-loop residency does not justify a browser run.
5. W2 now continues by closing the accelerator-shape gap: a long-running
   `wasmjit_run()`-style run/exit loop must execute generated Wasm bodies,
   chain or dispatch hot TBs inside Wasm, inline common SoftMMU/TLB-hit RAM
   load/store operations, and return to QEMU only for synthetic exits such as
   MMIO, page fault/TLB miss, interrupt, halt, invalidation, unsupported
   helper, or budget expiry. TCI stays as the compatibility fallback, but
   performance-proof mode must fail loudly for unsupported hot paths instead
   of hiding work behind silent fallback.
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
  - The direct generated-boundary path is also rejected as a performance
    candidate. The W2m-j diagnostic reached near-total boundary coverage
    (`direct_tb_entries=44,000,001`,
    `direct_generated_executed=43,960,181`), but failed the generic marker
    after `180252` ms while the same family of default TCI smokes reached the
    marker around `100` s. Boundary-entry coverage only proves that QEMU
    crossed a generated wrapper frequently; it does not prove generated
    instruction retirement, internal TB chaining, inline SoftMMU/TLB hits, or
    rare synthetic exits. Treat millions of generated-boundary entries as a
    warning sign, not a success metric.
  - Guest-side Bus Engine OS trimming is out of scope for the current
    accelerator-only goal. Even an aggressive native boot reduction from
    `44` seconds to `20` seconds would still project to about `17` minutes at
    the current browser/native ratio, so it cannot replace a QEMU
    execution-throughput fix.
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
- [ ] W2 - Implement the real browser-Wasm accelerator path behind the
  existing wasm64 QEMU/WASM gate. Do not continue optimizing the rejected
  direct-boundary path as the W2 performance candidate.
  DoD, all required:
  - The backend is selectable and buildable: the Emscripten build with
    `--enable-tcg-wasm64-backend` (or the wasm32 equivalent if W1 selects
    wasm32-first) configures, compiles, and links a runnable
    `qemu-system-x86_64` artifact instead of failing closed.
  - The accelerator exposes a long-running `wasmjit_run()`-style run/exit
    entrypoint. One call into the generated run loop must execute at least
    `1000000` counted guest-instruction-equivalent operations before returning
    for budget expiry in deterministic tests.
  - Generated hot paths chain or dispatch internally inside WebAssembly. They
    must not return to the QEMU main loop after every TB on the measured hot
    path.
  - Common RAM load/store TLB hits use an inline SoftMMU/TLB fast path and do
    not call `qemu_ld`/`qemu_st` helpers on the hit path.
  - Strict compatibility fallback is preserved for unsupported or failed
    generated paths. Performance-proof mode must report and fail unsupported
    hot paths loudly instead of silently treating fallback as accelerator
    success.
  - The accelerator reports dynamic instruction and wall-time metrics in the
    browser result JSON: generated/fallback guest instruction retirement,
    generated-body wall time, TCI dispatch time, TB lookup/main-loop time,
    helper/`qemu_ld`/`qemu_st` counts or time, compile/instantiate time,
    internal chain length or hotset residency, and synthetic exits by reason.
  - Deterministic run-loop, ABI-contract, module-emitter, and generated-output
    equivalence tests pass, plus `node scripts/ci/wasm-browser-smoke-runner-test.mjs`
    and `git diff --check`.
  - The generic Linux Chromium smoke boots to `QEMU_WASM_LINUX_BOOT_OK` with
    the accelerator enabled, records real generated execution and rare
    synthetic exits, and then passes W3's same-commit speed gate.
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
  `addFunction(..., "ii")` to `addFunction(..., "jj")` was useful evidence
  at the time, but the generated-subset runtime path is not retained because
  later W2m-j evidence disproved the direct-boundary shape as a performance
  fix. The final opt-in-guarded artifact hashes for the historical attempt
  were JS
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
- [x] W2m-i - Reject the per-TB generated-block dispatch boundary as the W2
  performance candidate. Accepted evidence: W2m-j proved the narrower
  `lookup_tb_ptr`/direct-boundary family can report near-total boundary
  coverage and still be slower than default TCI. The long diagnostic reported
  `direct_tb_entries=44,000,001`,
  `direct_generated_executed=43,960,181`,
  `direct_generated_dispatches=1664`, and
  `direct_tci_fallbacks=39820`, then failed the generic marker after
  `180252` ms. True compiled generated-block counters remained
  `generated_compiled=0`, `generated_executed=0`, and
  `generated_cache_hits=0`. Conclusion: a generated wrapper that returns to
  QEMU after each TB, flushes CPU state through memory, calls helpers for
  common memory operations, and relies on QEMU main-loop lookup is the wrong
  abstraction. The implementation code for the direct-boundary experiment is
  removed from the live tree; the evidence remains here so the path is not
  reopened under a new name.
- [x] W2n - Design the real browser-Wasm accelerator run/exit path before
  writing another execution optimization. Accepted evidence: the live TCI
  subset/direct-boundary execution paths were removed, the design note below
  records the new accelerator shape, and
  `scripts/ci/wasmjit-runloop-model-test.mjs` proves the deterministic
  prototype shape. The model exports one `wasmjit_run(ctx,budget)` entrypoint,
  imports only `env.memory`, performs internal hot TB dispatch, exits by
  budget, and records `generatedGuestInstructions=4000000`,
  `generatedChainLength=1000000`, `tlbHitAccesses=2000000`,
  `helperCalls=0`, `qemuLoadCalls=0`, and `qemuStoreCalls=0` for one
  `budget=1000000` call. Checks:
  `node --check scripts/ci/wasmjit-runloop-model.mjs`,
  `node --check scripts/ci/wasmjit-runloop-model-test.mjs`,
  `node scripts/ci/wasmjit-runloop-model-test.mjs`, and `git diff --check`.
  Required gates carried forward:
  - Metrics replace boundary-entry coverage with guest instructions retired
    through generated Wasm bodies, guest instructions retired through
    TCI/fallback, wall time in generated bodies, wall time in TCI dispatch,
    wall time in TB lookup/main loop, wall time in helper calls, wall time in
    `qemu_ld`/`qemu_st`, compile/instantiate time, generated-body chain
    length, and synthetic exit reasons.
  - A performance-proof mode exists in the design: unsupported hot TBs fail
    loudly with reason, while compatibility mode may still fall back to TCI.
  - The first prototype target is not Linux boot. It is a deterministic
    micro-hotset where one call into the generated run loop executes at least
    `1,000,000` guest instructions or an equivalent counted instruction
    budget before returning for budget expiry, with no per-TB QEMU main-loop
    return.
  - Common RAM load/store TLB-hit paths are planned as inline generated Wasm
    operations. Calling `qemu_ld`/`qemu_st` for every generated load/store is
    explicitly a failed-performance shape unless measurement later proves
    otherwise.
  - Direct hot branches are planned as intra-module control transfer or
    dispatch-table flow inside the generated run loop. Per-TB function calls
    back through QEMU do not satisfy W2n.
  - No W3 browser speed gate may run from W2n until the deterministic
    micro-hotset gate proves the new shape is multiple-times faster than TCI
    on ALU/branch and TLB-hit RAM microbenches.
- [x] W2o-a - Add the QEMU-facing wasmjit run/exit ABI and deterministic
  model benchmark. Accepted evidence: `tcg/wasm64.h` now defines
  `TCGWasm64RunMode`, `TCGWasm64RunExitReason`, `TCGWasm64RunExit`,
  `TCGWasm64RunCounters`, and `TCGWasm64RunContext`; `tcg/wasm64.c` now has
  run-counter reset/add helpers, per-exit counters, and reason names. The
  deterministic model benchmark separates compile/setup from measured run
  time, while preserving the no-helper-import invariant and the QEMU-facing
  run-context layout. Checks:
  `git diff --check`, `node --check scripts/ci/wasm64-runloop-contract-test.mjs`,
  `node scripts/ci/wasm64-runloop-contract-test.mjs`,
  `node --check scripts/ci/wasmjit-runloop-model.mjs`,
  `node --check scripts/ci/wasmjit-runloop-model-test.mjs`, and
  `node scripts/ci/wasmjit-runloop-model-test.mjs`.
- [x] W2o-b - Replace the model-only run-loop proof with QEMU-facing wasm64
  accelerator scaffolding and two deterministic microbench families. Accepted
  evidence: `TCGWasm64RunContext` and `TCGWasm64RunExit` now have explicit
  offset macros guarded by `QEMU_BUILD_BUG_ON()` in `tcg/wasm64.c`, and the
  deterministic Wasm module uses those same offsets for `guest_ram`,
  `counters`, and `exit`. The model now has separate `alu-branch` and
  `tlb-hit-ram` workloads. Both execute one `1000000`-step budget before
  returning for budget expiry, with `generatedGuestInstructions=4000000`,
  `generatedChainLength=1000000`, zero helper calls, zero `qemu_ld` calls,
  and zero `qemu_st` calls. On this host, the explicit benchmark command
  recorded:
  - `alu-branch`: best Wasm `0.38574999999999804 ms`, best TCI-like
    `34.14274999999998 ms`, ratio `88.51004536617019`.
  - `tlb-hit-ram`: best Wasm `1.9760410000000093 ms`, best TCI-like
    `64.48566600000004 ms`, ratio `32.6337692385936`.
  Checks: `git diff --check`,
  `node --check scripts/ci/wasmjit-runloop-model.mjs`,
  `node --check scripts/ci/wasmjit-runloop-model-test.mjs`,
  `node --check scripts/ci/wasm64-runloop-contract-test.mjs`,
  `node scripts/ci/wasm64-runloop-contract-test.mjs`, and
  `node scripts/ci/wasmjit-runloop-model-test.mjs`. The full backend artifact
  compile gate also passed:
  `python3 scripts/ci/wasm-build-artifacts-local.py --out
  /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-runloop-preflight
  --target riscv64 --tcg-wasm64-backend --build-image`, producing
  `qemu-system-riscv64.js`
  `c398c19673c3de5c3d4331cda83ba48b14470627c582072385e751cf75e9ff3f`,
  `qemu-system-riscv64.wasm`
  `60ea302e6600f4dfd0637a7ca5df9dbff30fedd3e2de655f7a709cb978b46959`,
  and manifest
  `c0d15b7d992acfbb49e79f7f31bbdf7a7deeffd24826838dcf3b50a0a96ea82a`.
  This is still deterministic microbench and compile evidence, not a generic
  smoke or Bus Engine OS proof.
- [x] W2p - Execute the run/exit ABI from the actual Emscripten/QEMU runtime
  path. Accepted 2026-07-03: the runtime smoke is opt-in through
  `QEMU_WASM64_RUNLOOP_SMOKE=1` / browser runner `wasm64RunloopSmoke=1`.
  Current local artifact build:
  `python3 scripts/ci/wasm-build-artifacts-local.py --out
  /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-runtime-smoke-r3
  --target riscv64 --tcg-wasm64-backend --build-image`; artifact hashes:
  `qemu-system-riscv64.js`
  `fe0090ac02ab2cb335543f96830d235572c0da46fb6222bb36343c1cf64a4a0c`,
  `qemu-system-riscv64.wasm`
  `d28d2b6ab3cee9cbd12af522b3f180568dc5ab5efa3f709624523a097f15ef7d`,
  manifest
  `009ee5e354ff5c38fb86a0d3903346cd5f5514457331aaafb3ddcad3bf3b3a9d`.
  Chrome `149.0.7827.201` browser proof with `machine=virt`,
  `rootfsDevice=virtio-pci`, and `wasm64RunloopSmoke=1` wrote
  `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-rootfs-pci-runloop-result.json`
  (SHA256
  `ebbc14705ba04622c5be6bb5840025834b4da53fdd16023da216211dc6c83637`)
  and screenshot
  `/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-browser-runtime-smoke-r3/cdp-rootfs-pci-runloop.png`
  (SHA256
  `20f5cb1b7c0e8e713d398fff403bea6f8391896f49c207127ab80ada5a0efab5`).
  The run reached `Welcome to TuxTest` in `40194` ms and recorded one
  runtime-smoke summary at `2397` ms with `ok=true`, budget `1000000`,
  generated guest-instruction equivalents `4000000`, generated body time
  `2470000` ns, compile time `140000` ns, instantiate time `20000` ns,
  generated chain length `1000000`, inline TLB-hit loads `1000000`, inline
  TLB-hit stores `1000000`, zero helper/`qemu_ld`/`qemu_st` calls, and one
  budget exit. This accepts the actual Emscripten/QEMU runtime ABI smoke only;
  R4b remains open because it must add the same-artifact C/TCI-like comparison
  and ratios before the generic speed gate.
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
