# QEMU fork: WebAssembly (wasm64) TCG backend + browser accelerator

This fork adds a **wasm64 TCG backend** so full-system QEMU runs inside a
web browser, plus an in-progress **generated-execution accelerator** that
translates hot guest code (riscv64) to WebAssembly instead of interpreting
TCI opcodes. Target product: Bus Engine OS booting and running multi-user
in the browser. Upstream documentation: [README.rst](README.rst).

## Real measured numbers (as of 2026-07-05)

Boot of the real accepted Bus Engine OS riscv64 image (Chrome, unaccelerated
wasm TCI, virtio-pci, per-marker gates; native = same image, same fork,
qemu-system-riscv64 TCG on an 8-core host):

| Marker | Browser | Native | Ratio |
| --- | ---: | ---: | ---: |
| Linux kernel banner | 9.1s | 2.0s | 4.56x |
| Network is Online | 427.3s | 32.0s | 13.35x |
| Multi-user ready (guest heartbeat) | **463.8s** | 63.0s | **7.36x** |

- Native boot after the first guest-side optimization (hwdb bake): multi-user
  in **14s**; its browser re-measure is pending.
- Interpreter-bound by measurement: one profiling window recorded 2.1M TB
  executions / 134M TCI ops, while total virtio device-handler time was
  ~133ms - hence a CPU accelerator, not device work, is the speed lever.
- Accelerator engagement status: generated execution engages under
  load+store admission (generated_run_entries=10) but store commit currently
  trips the spec-mandated unaligned-atomic trap; the alignment-safe commit
  design is settled (see
  `docs/docs/research/wasm-store-commit-strategies.md` in the BusDK docs)
  and is being implemented. Goal: >=1.55x effective speedup for a sub-5-min
  browser boot (463.8s -> <300s); test-guest evidence when engaged: ~1.65x.
- x86_64 status: current fixed-cache backend artifacts build cleanly and a
  bounded Chromium preflight reports generated coverage `10424 / 366409`
  (~2.84%) with zero helper/`qemu_ld`/`qemu_st` calls on clean inline hits.
  The next x86 work is coverage and safety, not a speed claim yet.
- Developer loop: warm wasm rebuilds use workspace ccache, Emscripten cache,
  and incremental build directories; the latest x86 rebuild reported ~80%
  ccache hits after the source-mtime refresh fix.

Numbers here are only ever updated from accepted, evidence-backed
measurements (acceptance JSONs / marker gates), never projections.
