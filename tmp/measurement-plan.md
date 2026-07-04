# RISC-V wasm64 Generated-Exec Measurement Plan

Branch: `worker/qemu-measure-share-20260704a`
Commit inspected: `e26d9f2aa2` (`wasm64: report normal generated retirement`)

This is a deterministic/analysis handoff only.  No browser run and no artifact
build was performed in this worktree.

## Stock Runner Reporting Check

The stock runner path already carries the generated-retirement fields through
to its result JSON when `--wasm64-tcg-summary` is enabled:

- `scripts/ci/wasm-browser-smoke-runner.mjs` parses
  `--wasm64-live-generated-exec` and `--wasm64-tcg-summary`, forwards them as
  browser URL parameters, then writes the promoted browser smoke state to
  `--out`.
- `scripts/ci/wasm-browser-smoke.mjs` turns those URL parameters into
  `QEMU_WASM64_LIVE_GENERATED_EXEC=1` and `QEMU_WASM64_TCG_SUMMARY=1` in
  `/qemu-tci-env`, parses `qemu-wasm64-tcg: {...}` JSON lines, and stores them
  under `globalThis.qemuWasmSmokeState.wasm64Tcg`.
- `promoteSmokeState()` copies `smokeState.wasm64Tcg` to
  `result.wasm64Tcg`.
- `tcg/wasm64.c` emits the requested fields in each `qemu-wasm64-tcg`
  summary: `generated_guest_instructions`, `fallback_guest_instructions`, and
  `generated_body_time_ns`.  It also emits `generated_coverage_numerator`,
  `generated_coverage_denominator`, and `generated_coverage_ppm`.

The JSON fields to inspect after the stock run are:

- `wasm64Tcg.lastSummary.generated_guest_instructions`
- `wasm64Tcg.lastSummary.fallback_guest_instructions`
- `wasm64Tcg.lastSummary.generated_body_time_ns`
- `wasm64Tcg.lastSummary.generated_coverage_ppm`
- `wasm64Runloop.lastSummary.generated_guest_instructions`
  when `--wasm64-live-generated-exec` is enabled

For the generated retirement share, use either:

```text
wasm64Tcg.lastSummary.generated_coverage_ppm
```

or cross-check it from the raw retirement counters:

```text
generated_retirement_share_ppm =
  1000000 * generated_guest_instructions /
  (generated_guest_instructions + fallback_guest_instructions)
```

Do not use boundary-entry counts as the performance metric.

## Exact Stock-Runner Commands

These commands assume the supervisor's same-commit `e26d9f2aa2`
`riscv64-softmmu` wasm64 backend artifacts are available at:

```text
/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-measure-share-20260704a
```

The pinned generic RISC-V TuxBoot inputs are:

```text
/Users/test/git/busdk/agent-supervisor/tmp/qemu-wasm-smoke-assets/tuxboot-riscv64-Image
/Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-official-guest/tuxboot-riscv64-rootfs.ext4
```

Plain generated-exec boot with retirement reporting:

```sh
node scripts/ci/wasm-browser-smoke-runner.mjs \
  --browser chromium \
  --artifact-dir /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-measure-share-20260704a \
  --firmware-dir pc-bios \
  --program qemu-system-riscv64.js \
  --wasm qemu-system-riscv64.wasm \
  --kernel /Users/test/git/busdk/agent-supervisor/tmp/qemu-wasm-smoke-assets/tuxboot-riscv64-Image \
  --rootfs /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-official-guest/tuxboot-riscv64-rootfs.ext4 \
  --machine virt \
  --cpu '' \
  --memory 512M \
  --network none \
  --rootfs-device virtio-pci \
  --kernel-append 'printk.time=0 root=/dev/vda console=ttyS0 panic=-1' \
  --marker 'Welcome to TuxTest' \
  --timeout-ms 180000 \
  --wasm64-live-generated-exec \
  --wasm64-tcg-summary \
  --wasm64-tcg-summary-interval 10000 \
  --out /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-measure-share-20260704a-generated-exec-stock-runner.json
```

Same-commit generated-exec-OFF baseline with the same summary reporting:

```sh
node scripts/ci/wasm-browser-smoke-runner.mjs \
  --browser chromium \
  --artifact-dir /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-wasm-measure-share-20260704a \
  --firmware-dir pc-bios \
  --program qemu-system-riscv64.js \
  --wasm qemu-system-riscv64.wasm \
  --kernel /Users/test/git/busdk/agent-supervisor/tmp/qemu-wasm-smoke-assets/tuxboot-riscv64-Image \
  --rootfs /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-official-guest/tuxboot-riscv64-rootfs.ext4 \
  --machine virt \
  --cpu '' \
  --memory 512M \
  --network none \
  --rootfs-device virtio-pci \
  --kernel-append 'printk.time=0 root=/dev/vda console=ttyS0 panic=-1' \
  --marker 'Welcome to TuxTest' \
  --timeout-ms 180000 \
  --wasm64-tcg-summary \
  --wasm64-tcg-summary-interval 10000 \
  --out /Users/test/git/busdk/agent-supervisor/tmp/qemu-riscv64-measure-share-20260704a-exec-off-stock-runner.json
```

The exec-OFF command intentionally omits `--wasm64-live-generated-exec` while
keeping `--wasm64-tcg-summary`; that makes the baseline result report TCI
fallback guest instructions and a zero generated retirement count from the
same artifact family.

## Expected Generated Share From Code

At this commit the normal boot path should be expected to retire a small,
not large, share of guest instructions in generated WebAssembly.

The main code-level reasons are:

1. The committed live-generated-exec path is still a single-TB body path.
   `tcg_wasm64_live_generated_exec_try()` sets `context.budget = guest_insns`
   and accepts success only when `run_counters.generated_chain_length == 1`.
   There is hotset target probing, but no committed internal TB chaining or
   long generated run-loop residency.  Even successful generated TBs return to
   QEMU at every TB boundary, so per-TB lookup, validation, JS/Wasm dispatch,
   and summary overhead can dominate a short Linux boot marker.

2. The selected live body must pass a narrow supported-shape gate before it can
   run.  `tcg_wasm64_live_generated_exec_op_supported()` excludes helper calls
   and the `tci_qemu_ld_rrr`/`tci_qemu_st_rrr` helper-backed memory shapes that
   remain common in real boot code.  The JS emitter also only lowers bounded
   env-relative direct memory with base register 14 in the `[-16, 0x120)` env
   window.  Guest RAM/TLB-hit SoftMMU memory is therefore not yet a broad
   generated path, so many normal boot TBs fall back to TCI.

The next optimization lane should target useful guest work inside generated
bodies: helper/SoftMMU load-store clean-hit handling, internal TB chaining or
hotset dispatch, and enough run-loop residency that `generated_guest_instructions`
becomes a material fraction of
`generated_guest_instructions + fallback_guest_instructions`.
