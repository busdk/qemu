=========================
WebAssembly support plan
=========================

Goal
====

Implement official QEMU WebAssembly host support incrementally, starting with
the parts that are already settled enough to build and test while continuing to
refine the implementation plan from evidence.

The target MVP is a browser-hosted QEMU system emulator that can boot a
64-bit Linux guest, including Bus Engine OS, through modern browser APIs.  The
downstream Bus Engine acceptance target is a browser-runnable Bus Engine OS
demo with serial diagnostics, visible graphics, and keyboard input that can be
embedded on ``busdk.com/engine/`` as a screenshot-like or live-preview item.
The QEMU work remains generic and product-neutral.  The accepted console boot
proof remains the regression gate, but the active browser MVP expansion now
includes a basic 2D graphics path and keyboard input.  The MVP does not
require WebGPU, accelerated 3D, production networking, or durable browser
storage.  The experimental
``ktock/qemu-wasm`` code is research material only; the upstreamable work must
be designed as native QEMU support rather than importing the fork wholesale.

Settled MVP decisions
=====================

The Bus Engine browser target needs 64-bit guest environments only.  The MVP
therefore uses the upstream ``wasm64`` Emscripten host baseline and the
``x86_64-softmmu`` system emulator.  ``wasm32`` compatibility is not an MVP
goal.  Existing ``wasm32`` material in experimental forks remains useful only
as historical design input for browser packaging, JavaScript integration, and
TCG-to-WebAssembly ideas.

The first executable milestone is the TCI boot path.  A native WebAssembly TCG
backend remains a later performance and maintainability milestone after the
TCI path can boot a 64-bit Linux guest in a browser-controlled runtime.
Chromium or Chrome is the preferred browser target for the MVP acceptance
path.  Firefox remains compatibility tracking, not a first-MVP requirement,
unless Chromium stops being a viable proof browser.

Strict definition of done
=========================

This implementation line is complete only when the feature branch contains
reviewable, incremental patches and developer documentation that:

* identifies the exact upstream QEMU baseline for Emscripten/WebAssembly host
  support;
* identifies the exact experimental QEMU/WASM source areas that should be
  studied and which parts should not be copied directly;
* defines the minimum browser MVP needed to boot a 64-bit Linux guest through
  QEMU/WASM;
* lists every QEMU subsystem that must change before the MVP is acceptable;
* defines per-subsystem work items with expected files, acceptance tests, and
  non-goals;
* distinguishes upstreamable QEMU work from downstream Bus Engine integration
  work;
* defines licensing and corresponding-source requirements for a shipped
  QEMU/WASM binary;
* defines browser runtime requirements, including WebAssembly, workers,
  SharedArrayBuffer, and cross-origin isolation headers;
* includes a staged path from TCI-only support to a native WebAssembly TCG
  backend;
* describes the active browser graphics/input MVP expansion and the later path
  for networking, persistence, WebGPU, accelerated 3D, and QMP integration;
* implements settled MVP infrastructure only when it has a local proof,
  repeatable command, or CI-shaped test;
* records browser/runtime limits and failure modes with the tested runtime
  version, command, and observed result;
* keeps Bus Engine-specific integration downstream from the upstream QEMU
  support work.

Current upstream baseline
=========================

Upstream QEMU already contains an Emscripten/WebAssembly host baseline:

* ``supported_oses`` includes ``emscripten`` in ``meson.build``.
* ``supported_cpus`` includes ``wasm64`` in ``meson.build``.
* ``configs/meson/emscripten.txt`` defines Emscripten link flags for pthreads,
  Asyncify, filesystem support, WebAssembly BigInt, ES module output, and
  exported runtime methods.
* Emscripten hosts use the ``wasm`` coroutine backend.
* WebAssembly hosts currently require ``--enable-tcg-interpreter``.
* CI contains manual ``wasm64`` Emscripten build jobs.
* Emscripten builds skip normal QEMU tests because many tests rely on fork,
  Unix sockets, or other host features unavailable in the browser runtime.

This means the plan must improve an existing upstream host target.  It must
not assume QEMU has no WebAssembly support.

Build and runtime evidence
==========================

Evidence collected on 2026-06-29 and 2026-06-30 from the local QEMU branch:

* Local ``emcc`` was not installed, so development used QEMU's Docker-based
  Emscripten image.
* The QEMU source-tree target
  ``make -f Makefile docker-image-emsdk-wasm64-cross V=1`` successfully built
  ``qemu/emsdk-wasm64-cross:latest`` as image ID ``a597fc7fd202``.  The image
  uses Emscripten SDK ``4.0.10`` and produces a ``wasm64`` cross environment
  with ``-sMEMORY64=1``.
* A source tree copied into the container configured successfully for
  ``--target-list=x86_64-softmmu --static --cpu=wasm64 --disable-tools
  --enable-debug --enable-tcg-interpreter``.
* The configure summary reported ``Host CPU: wasm64``, ``void * size: 8``,
  Emscripten ``4.0.10``, TCI as the TCG backend, the ``wasm`` coroutine
  backend, and ``x86_64-softmmu`` as the only target.
* The TCI build linked ``qemu-system-x86_64.js`` successfully inside the
  container.
* A read-only mounted QEMU source tree is not sufficient for this configure
  path because the Python editable install writes ``qemu.egg-info`` into the
  source directory.  The repeatable local workaround is to copy the source
  tree into a container-local directory and build from there.
* The build produced warning evidence worth turning into early cleanup tasks:
  wasm64 ``printf`` format mismatches for 64-bit constants and ``ram_addr_t``,
  plus unused Emscripten-specific code paths in a few host files.
* The first implementation cleanup removed the observed wasm64 warnings by
  making constant casts explicit at format-call sites and avoiding
  Emscripten-unreachable POSIX helpers.  A follow-up Docker build completed
  and linked ``qemu-system-x86_64.js`` with those cleanups applied.
* A repeatable artifact-capture build copied the generated browser artifacts
  out of the container.  The current TCI configuration emits
  ``qemu-system-x86_64.js`` and ``qemu-system-x86_64.wasm``.  It did not emit a
  separate ``.worker.js`` file; the generated JavaScript contains the pthread
  worker startup code and loads ``qemu-system-x86_64.wasm`` relative to the
  module URL.
* The browser graphics investigation verified the SDL build path in the
  Docker-based Emscripten image.  A tiny SDL probe showed that SDL2 requires
  ``-sUSE_SDL=2`` for both compile and link; without that flag Emscripten's
  fake SDL header stops the build.  A copied QEMU tree then configured with
  ``--enable-sdl --extra-cflags=-sUSE_SDL=2 --extra-ldflags=-sUSE_SDL=2`` and
  reported ``SDL support: YES 2.32.0``.  A Ninja build of
  ``qemu-system-x86_64.js`` compiled QEMU's SDL 2D and input sources for the
  wasm64 host and reached the final link, producing
  ``qemu-system-x86_64.js`` and ``qemu-system-x86_64.wasm`` before the
  artifact copy failed because the host ``/tmp`` filesystem was full.  This is
  build-path evidence for the SDL frontend, not yet browser-visible graphics
  proof.
* The ``build-wasm64-64bit`` CI job now uses the same SDL-enabled configure
  shape for produced artifacts: ``--enable-sdl``,
  ``--extra-cflags=-sUSE_SDL=2``, and ``--extra-ldflags=-sUSE_SDL=2``.  The
  browser smoke runner still defaults to ``display=none`` so the serial marker
  gate remains unchanged until an explicit graphics proof opts in to
  ``display=sdl``.
* The captured artifact sizes were approximately ``607 KiB`` for
  ``qemu-system-x86_64.js`` and ``72 MiB`` for
  ``qemu-system-x86_64.wasm``.  The captured SHA-256 values were
  ``7f1760c7944f251709ac501c2014a8684299ddb66b4be2fa00ca7137037b3834`` for
  the JavaScript launcher and
  ``0ef7ba1d7e9de45816a0918708c653c25e87bb8c2a197d4e6e1460d8f9c958f9`` for
  the WebAssembly module.
* The wasm CI template now preserves ``build/qemu-system-*.js``,
  ``build/qemu-system-*.wasm``, and ``build/qemu-system-wasm.SHA256SUMS`` as
  job artifacts.  This makes the build output available to later browser
  harness and boot-test jobs without re-running the compiler.
* The wasm CI template now also emits
  ``build/qemu-system-wasm-artifacts.json``.  The manifest format starts at
  version ``1`` and records each generated QEMU WebAssembly artifact path,
  artifact kind, target name, byte size, and SHA-256 hash.  It also records a
  ``targets`` list that groups each ``qemu-system-$target`` JavaScript
  launcher with the matching WebAssembly module and marks whether the pair is
  complete.  The manifest deliberately does not include guest kernel, rootfs,
  or product metadata; those belong to the later harness or downstream
  integration layer.
  ``scripts/ci/wasm-artifact-manifest-test.py`` verifies the manifest contract
  with synthetic complete and incomplete JavaScript/WebAssembly target pairs
  before the smoke jobs run browser or guest boot work.
  ``scripts/ci/wasm-artifact-manifest-check.py`` verifies that a requested
  target has a complete JavaScript/WebAssembly pair and that both paths exist
  relative to the manifest with matching SHA-256 values.  Both wasm64 smoke
  jobs now run that checker for ``x86_64`` before guest preparation or browser
  launch, so a broken artifact handoff fails before the expensive boot paths.
* The generated JavaScript is ``MODULARIZE`` ES module output.  Directly
  running ``node qemu-system-x86_64.js --version`` only loads the module
  factory and is not a QEMU startup test.  A real Node startup test must import
  the default module factory and pass arguments explicitly, for example
  ``await Module({ arguments: ["--version"] })``.
* A Node startup attempt with the captured artifacts failed before QEMU started
  because the generated Emscripten output requires Node.js ``v23.0.0`` or
  newer.  The supervisor host had Node.js ``v22.19.0`` and the
  ``qemu/emsdk-wasm64-cross:latest`` image had Node.js ``v22.16.0``.  This is
  a toolchain/runtime mismatch for Node-based smoke tests, not evidence that
  the QEMU emulator itself failed.
  ``scripts/ci/wasm-node-smoke.mjs`` now performs this as an explicit
  preflight and writes ``preflight: "node-version"`` plus the required and
  actual Node.js versions into result JSON before any QEMU module import.
* A Node.js ``v24.18.0`` container successfully ran the generated
  ``qemu-system-x86_64.js`` module with ``--version`` using
  ``scripts/ci/wasm-node-smoke.mjs``.  The proof saw
  ``QEMU emulator version 11.0.50`` and exited successfully after matching the
  marker.
* The Node.js ``v24.18.0`` startup proof emitted Emscripten warnings for
  unsupported ``__syscall_prlimit64``, ``__syscall_mprotect``, and
  ``__syscall_pipe2`` before printing the QEMU version.  These warnings do not
  block the version smoke test, but they need explicit audit before the Linux
  boot path can be considered healthy.
* The first syscall-warning cleanup made ``os_setup_limits()`` a no-op on
  Emscripten hosts and skipped optional TCG guard-page protection under
  Emscripten.  A rebuilt artifact still passed the Node.js ``v24.18.0``
  ``--version`` smoke test, and the ``__syscall_prlimit64`` warning
  disappeared.  The remaining startup warnings were ``__syscall_mprotect`` and
  ``__syscall_pipe2``.
* A native QEMU control boot used local ``/boot/vmlinuz-7.1.0`` and a tiny
  BusyBox initramfs that prints ``QEMU_WASM_LINUX_BOOT_OK`` from ``/init``.
  Native ``qemu-system-x86_64`` reached the marker with both the default PC
  machine and ``-M microvm``.  This proves the kernel/initramfs/command-line
  inputs are valid before involving WebAssembly.
* ``scripts/ci/wasm-node-smoke.mjs`` now supports ``--mount-file HOST:WASM``.
  The helper copies host files into Emscripten MEMFS during ``preRun`` using
  the generated module's exported ``FS_createPath`` and ``FS.writeFile``
  methods.  This provides a Node proof path for kernel, initrd, and firmware
  inputs without requiring ``NODEFS`` support in the generated artifact.
* The first wasm Linux boot attempt with the default PC machine progressed to
  firmware loading and failed because ``bios-256k.bin`` was absent from MEMFS.
  Supplying ``-L /firmware`` and mounting ``bios-256k.bin`` moved the failure
  forward to missing ``kvmvapic.bin`` and ``linuxboot_dma.bin`` messages, then
  timed out without reaching the Linux marker.
* A wasm ``-M microvm`` boot attempt with ``bios-microvm.bin`` and
  ``linuxboot_dma.bin`` mounted under ``/firmware`` produced no missing
  firmware errors, but did not produce guest serial output or the
  ``QEMU_WASM_LINUX_BOOT_OK`` marker before the 240 second timeout.  This is
  not yet a Linux boot proof; it narrows the next work to diagnosing the
  pre-serial boot path under wasm64 TCI.
* The Node smoke helper now supports ``--dump-file PATH[:N]``.  This prints a
  MEMFS file on timeout and can cap the output to ``N`` bytes, which allows
  QEMU ``-D`` logs and instruction traces to be collected without flooding CI
  logs.
* The second syscall-warning cleanup made ``qemu_madvise()`` and
  ``qemu_mprotect_*()`` explicit no-ops on Emscripten hosts for valid advisory
  calls and skipped the POSIX coroutine stack guard page under Emscripten.
  A rebuilt artifact still passed the Node.js ``v24.18.0`` ``--version``
  smoke test.  Startup warnings were reduced to ``__syscall_pipe2``.
* The remaining ``__syscall_pipe2`` warning came from the POSIX event notifier
  fallback.  Emscripten does not provide ``eventfd()``, so QEMU falls back to a
  pipe-backed notifier.  GLib's ``g_unix_open_pipe()`` attempts ``pipe2()``
  first, which emits an unsupported-syscall warning before falling back.  The
  Emscripten-specific QEMU path now calls ``pipe()`` directly, keeps the
  existing nonblocking setup, and avoids changing normal POSIX hosts.
  Rebuilding the wasm64 TCI artifact after this change produced a clean
  Node.js ``v24.18.0`` ``--version`` smoke test with no unsupported syscall
  warnings.  The remaining runtime message is Emscripten's post-exit
  ``keepRuntimeAlive()`` notice, which the smoke helper handles by exiting
  after the marker.
* The cleaned artifact hashes were:
  ``qemu-system-x86_64.js`` =
  ``6fc7fb8d9fb3354203222bedb149a5f5d84a56a86298e3a4eeabcb57b8b3e987`` and
  ``qemu-system-x86_64.wasm`` =
  ``bb1c732c79d8006f4297575d2d883591722be44342a8428b7575a7d1fee36873``.
  The wasm module size was ``74820239`` bytes.
* After the event-notifier cleanup, the artifact hashes were:
  ``qemu-system-x86_64.js`` =
  ``6fc7fb8d9fb3354203222bedb149a5f5d84a56a86298e3a4eeabcb57b8b3e987`` and
  ``qemu-system-x86_64.wasm`` =
  ``ee17a1764e7d64ff9250031fced621caa020a8c56134e8a54d744f498b8996de``.
  The wasm module size was ``74820177`` bytes.
* The cleaned ``-M microvm`` boot attempt no longer crashed, but still timed
  out after 120 seconds before the Linux marker.  ``-d cpu_reset,guest_errors``
  showed two CPU resets and no guest errors.  Forcing
  ``-accel tcg,thread=single`` did not change the reset-only timeout result.
* A short capped run with ``-d in_asm,exec,cpu_reset`` proved the CPU does
  execute BIOS instructions under wasm64 TCI after reset.  The trace moved
  from ``0xfffffff0`` into firmware addresses such as ``0x000fe05b`` and
  ``0x000fd45d`` and then spent the captured window in firmware translation
  blocks.  The remaining boot issue is therefore not "CPU never starts"; it is
  a firmware/TCI progress, performance, or event-loop issue before Linux
  serial output.
* The apparent pre-serial timeout was partly a command-line capture problem:
  ``-nographic -monitor none`` did not expose the guest serial stream to the
  Node smoke helper.  Using ``-nographic -serial mon:stdio`` with mounted
  ``bios-microvm.bin`` and ``linuxboot_dma.bin`` prints SeaBIOS output and
  Linux early console output under wasm64 TCI.
* A non-debug wasm64 TCI build without ``--enable-debug`` configured with
  ``-O2``, no TCG debug, and no mutex debug.  The artifact still passed the
  Node.js ``v24.18.0`` ``--version`` smoke test.  Its
  ``qemu-system-x86_64.wasm`` size was ``45337376`` bytes, compared with
  roughly ``74.8 MiB`` for the previous debug artifact.
* The optimized artifact hashes were:
  ``qemu-system-x86_64.js`` =
  ``fa08cfb87919282e9dc3e77cb0a747826a721e4e620be2915b63d14d5620719f`` and
  ``qemu-system-x86_64.wasm`` =
  ``11dd31075965ea6aba206e4cd2400dadbed8a77c09b4df14799753e6212f290e``.
* The optimized ``-M microvm`` wasm64 TCI run with explicit serial routing
  reached Linux early boot, but timed out before the
  ``QEMU_WASM_LINUX_BOOT_OK`` init marker after 120 seconds.  The default
  kernel command line reported failed fast TSC calibration and no PIT/HPET/PM
  timer reference before stalling around delay-loop calibration.
* Adding ``tsc=unstable lpj=1000000 clocksource=jiffies`` to the guest command
  line moved the optimized wasm64 TCI run beyond delay-loop calibration and
  through later kernel initialization, including ``VFS: Finished mounting
  rootfs on nullfs``.  A quiet 240 second run still did not reach the
  ``QEMU_WASM_LINUX_BOOT_OK`` marker, so the next blocker is post-early-kernel
  progress rather than firmware entry or serial capture.
* The same boot path still emits one ``__syscall_pipe2`` warning.  Avoiding
  ``g_unix_open_pipe()`` in the signalfd compatibility and event-notifier
  paths removed two known QEMU-owned warning sources, but the optimized
  artifact still warns during generic system-mode startup.  The warning appears
  with ``-M none -nodefaults -nographic -S`` before any guest firmware or
  kernel payload is loaded, so the remaining source is QEMU host runtime or
  GLib/main-loop initialization, not Bus Engine OS, Linux boot, firmware, or
  serial routing.
* Emscripten hosts now skip POSIX signal-fd setup in ``qemu_signal_init()``.
  Browser and Node WebAssembly runtimes do not deliver Unix signals through
  host ``signalfd``/pipe file descriptors, so this is a platform boundary
  rather than a missing emulation feature for the browser MVP.  Normal POSIX
  hosts keep the existing signalfd or compatibility-pipe path.
  The rebuilt artifact after this change had ``qemu-system-x86_64.js`` =
  ``1eb87363b7a7d347638bef7a1943e2f9323269ec1a7e880dcf3554585fe26eb2`` and
  ``qemu-system-x86_64.wasm`` =
  ``e7a7a07f73eaad655ecda99848b417208b2b3573fc6d5d8d39423524362e7e7a``.
  The ``--version`` smoke test passed.  A short Linux boot check still emitted
  the generic ``__syscall_pipe2`` warning and did not reach the Linux banner
  within 45 seconds, so this change is not sufficient to close the startup
  pipe-warning task.
* A standalone Emscripten ``pipe()`` diagnostic compiled with
  ``-sMEMORY64=1 -sWASM_BIGINT`` and run under Node.js ``v24`` created a pipe
  without warnings.  The same diagnostic compiled with
  ``-pthread -sPROXY_TO_PTHREAD=1 -sMEMORY64=1 -sWASM_BIGINT`` also created a
  pipe without warnings, although the runtime stayed alive after process exit.
  Therefore the remaining QEMU warning is not explained by plain Emscripten
  ``pipe()`` or pthread proxying alone.
* A temporary attempt to rebuild QEMU with
  ``--extra-ldflags=-sSYSCALL_DEBUG=1`` did not change the generated artifact;
  the SHA-256 values matched the previous signal-noop artifact and the
  generated JavaScript did not contain syscall-debug support.  Future syscall
  diagnostics need a verified build-hook or cross-file change that proves the
  Emscripten flag reached the final link.
* The reason ``--extra-ldflags`` did not work is configure/Meson ordering:
  configure emits ``config-meson.cross`` with ``--extra-ldflags`` first and
  then adds ``configs/meson/emscripten.txt`` second.  The later Emscripten
  cross file provides its own ``c_link_args`` and overrides the generated cross
  file's linker arguments.  Passing Meson ``-Dc_link_args=...`` does override
  both cross files, but it replaces the complete Emscripten linker argument
  list.  Diagnostic builds must therefore pass the full default Emscripten
  linker argument list plus the diagnostic flag.
* A verified syscall-debug diagnostic artifact was built with full Emscripten
  linker arguments plus ``-sSYSCALL_DEBUG=1`` using ``-Dc_link_args``.  The
  configure summary reported that exact ``LDFLAGS`` value.  The generated
  ``qemu-system-x86_64.js`` hash changed to
  ``0c6c125206e82d5531e63416cb3ef1b70cbdf2fce4aeba2166a884aaa20df36d`` while
  ``qemu-system-x86_64.wasm`` remained
  ``e7a7a07f73eaad655ecda99848b417208b2b3573fc6d5d8d39423524362e7e7a``,
  which is consistent with changing Emscripten JavaScript syscall glue rather
  than QEMU object code.
* Running the verified syscall-debug artifact with the minimal
  ``-M none -nodefaults -display none -monitor none -serial none -parallel none
  -S`` reproducer showed the remaining ``__syscall_pipe2`` warning coming from
  a pthread worker's ``printErr`` path.  Main-thread QEMU pipe creation was
  visible as successful ``__syscall_pipe`` plus ``__syscall_fcntl64`` calls.
  This narrows the remaining warning away from the already-cleaned direct QEMU
  ``pipe()`` call paths and toward pthread-worker, GLib wakeup, or another
  library/runtime pipe2 call made from a worker.
* A standalone GLib main-context diagnostic compiled for Emscripten with
  ``-pthread -sPROXY_TO_PTHREAD=1 -sMEMORY64=1 -sWASM_BIGINT
  -sFORCE_FILESYSTEM`` reproduced the same ``__syscall_pipe2`` warning before
  QEMU, any machine model, or any guest image was involved.  The program only
  created a ``GMainContext``, attached an idle source, and then released it.
  This maps the remaining warning to the Emscripten/GLib wakeup path used by
  QEMU's main-loop dependencies rather than to Bus Engine OS, firmware,
  direct QEMU event-notifier calls, or Linux boot state.
* A QEMU-local Emscripten JavaScript-library shim for ``__syscall_pipe2`` was
  tested against the same standalone GLib diagnostic and did not suppress the
  warning.  The effective local fix is a strong C definition of
  ``__syscall_pipe2`` that overrides Emscripten's weak libc stub and delegates
  to Emscripten's existing ``__syscall_pipe`` implementation.  The shim treats
  ``O_CLOEXEC`` as a no-op, matching Emscripten's single-process semantics, and
  applies ``O_NONBLOCK`` with ``fcntl()`` when requested.
* Adding that source only to ``libqemuutil.a`` was not sufficient: because no
  QEMU object referenced the symbol directly, the final static link did not
  pull the archive member and the generated artifact hashes were unchanged.
  The working build keeps the source in ``libqemuutil.a`` and also extracts
  that object into the ``qemuutil`` dependency for Emscripten hosts.
* The rebuilt wasm64 TCI artifact with the extracted object has
  ``qemu-system-x86_64.js`` =
  ``57ea9090acad40b3587c2648df233e1c3560cc20d10d1884b26226c3a23ce3f9`` and
  ``qemu-system-x86_64.wasm`` =
  ``10ee623fc6ddb4c49a1b61bb97a0e77d6a06edfccf297d679a8ce1b0ef0287a8``.
  ``strings`` no longer finds ``unsupported syscall: __syscall_pipe2`` in the
  wasm module.  A Node.js ``v24`` ``--version`` smoke test passed, and the
  minimal ``-M none -nodefaults -display none -monitor none -serial none
  -parallel none -S`` reproducer timed out quietly with no ``pipe2`` warning.
* ``scripts/ci/wasm-node-smoke.mjs`` now accepts ``--max-output-bytes`` so
  syscall-debug builds and failed boot probes can keep scanning for their
  success marker while suppressing unbounded stdout/stderr after a chosen
  byte limit.  This keeps future evidence runs repeatable without turning
  diagnostic logging into an accidental transcript dump.
* The same proof showed that the Emscripten pthread runtime can keep async
  state alive after QEMU exits.  The smoke helper therefore waits for an
  expected output marker and then exits explicitly.  Long-running boot tests
  need their own shutdown path instead of assuming Node will exit naturally.
* The first post-``pipe2`` Linux boot probes confirmed that the original
  ``-M microvm`` command reached Linux early console and ``VFS: Finished
  mounting rootfs on nullfs`` but timed out before the initramfs marker.  A
  qboot probe using ``-M microvm,acpi=off`` plus ``noapic nolapic`` moved
  farther through kernel initialization, but a native control showed that
  those ``noapic`` flags are a bad smoke baseline: native QEMU reached
  ``Run /init as init process`` but did not print the marker, even with an
  initramfs that echoes before mounting ``proc`` or ``sysfs``.
* The canonical 64-bit TCI smoke path is now ``-M microvm,acpi=off`` with
  APIC left enabled, ``qboot.rom`` and ``linuxboot_dma.bin`` mounted in
  ``/firmware``, explicit ``-serial mon:stdio``, and the kernel arguments
  ``console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off
  hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1``.
  Native QEMU with that profile reached ``QEMU_WASM_LINUX_BOOT_OK``.
* The same APIC-enabled qboot profile booted the cleaned wasm64 TCI artifact
  under Node.js ``v24`` in Docker.  The run reached Linux, unpacked the
  initramfs, registered ``ttyS0``, ran ``/init``, and printed
  ``QEMU_WASM_LINUX_BOOT_OK`` before the 180 second timeout.  No
  ``__syscall_pipe2`` warning appeared.  The passing run used the artifact set
  ``/tmp/qemu-wasm64-tci-artifacts-pipe2-final`` with the hashes recorded
  above.
* ``scripts/ci/wasm-linux-boot-smoke.mjs`` now wraps the canonical boot
  profile.  It requires explicit kernel, initrd, firmware, and artifact
  inputs, then delegates to ``wasm-node-smoke.mjs`` with the APIC-enabled
  qboot command line.  Running the wrapper under ``node:24-alpine`` with the
  same artifact set reached ``QEMU_WASM_LINUX_BOOT_OK``.
* ``scripts/ci/wasm-build-smoke-initramfs.py`` now builds the tiny smoke
  initramfs deterministically from an explicit statically linked BusyBox
  binary.  It writes a fixed-metadata ``newc`` archive compressed with gzip
  ``mtime=0``.  Two local builds using ``/usr/bin/busybox`` produced identical
  bytes with SHA-256
  ``2b666d118642bb24da2019f88b4019387fedc3e402803f84c06ebaa1c1ef2544``.
  Native QEMU and the Node.js ``v24`` wasm64 TCI wrapper both booted that
  generated initramfs to ``QEMU_WASM_LINUX_BOOT_OK``.  This resolves the
  initramfs construction part of ``WASM-017``; the remaining guest-input
  decision is a declared upstream source for the 64-bit Linux kernel and the
  statically linked BusyBox binary or package used by CI.
* QEMU's functional-test documentation says tests that download Linux kernels,
  initrds, firmware, or similar guest assets should use ``qemu_test.Asset``
  with a URL and SHA-256, and that downloaded-asset tests should not run in
  default quick checks.  The existing ``tests/functional/x86_64/test_tuxrun.py``
  already pins a TuxBoot x86_64 Buildroot ``bzImage`` at
  ``https://storage.tuxboot.com/buildroot/20241119/x86_64/bzImage`` with
  SHA-256
  ``f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8``.
  That kernel is the first candidate for upstream WASM smoke CI because it is
  already referenced by QEMU tests.  It still needs a direct proof with the
  generated initramfs and the ``wasm-linux-boot-smoke.mjs`` command line before
  it can replace the local ``/boot/vmlinuz-7.1.0`` proof.
* The TuxBoot x86_64 kernel candidate was downloaded to ``/tmp`` and verified
  against its existing QEMU SHA-256.  Native QEMU with the canonical qboot
  command line and the generated initramfs reached
  ``QEMU_WASM_LINUX_BOOT_OK``.  The Node.js ``v24`` wasm64 TCI wrapper also
  reached ``QEMU_WASM_LINUX_BOOT_OK`` with the same kernel and initramfs.
  This proves the kernel side of ``WASM-017a`` and removes the dependency on
  the local ``/boot/vmlinuz-7.1.0`` proof input.  The remaining upstream CI
  guest-input decision is the source for the statically linked BusyBox binary
  used to generate the initramfs.
* The existing x86_64 TuxBoot rootfs asset was also downloaded and verified
  against the SHA-256 already pinned by
  ``tests/functional/x86_64/test_tuxrun.py``:
  ``4b8b2a99117519c5290e1202cb36eb6c7aaba92b357b5160f5970cf5fb78a751``.
  Extracting ``/bin/busybox`` from that rootfs with ``debugfs`` produced
  SHA-256
  ``e64c01b7c461edeb5a1b42cdc5865f2b805a55821413ae9bf7d86ba46ce59e22``.
  That BusyBox is dynamically linked, with interpreter
  ``/lib/ld64-uClibc.so.0`` and ``DT_NEEDED`` entries for
  ``libtirpc.so.3`` and ``libc.so.0``.  Therefore it cannot be used directly
  with the current static-only initramfs builder.  Reusing it would require a
  dynamic-library initramfs mode or a separate static BusyBox source.
* ``scripts/ci/wasm-build-smoke-initramfs.py`` now supports explicit
  ``--extra-file HOST:GUEST`` and ``--extra-symlink GUEST:TARGET`` entries.
  The original static-local-BusyBox output remains byte-for-byte stable at
  SHA-256
  ``2b666d118642bb24da2019f88b4019387fedc3e402803f84c06ebaa1c1ef2544``.
  The current helper-generated dynamic TuxBoot archive made from extracted
  ``/bin/busybox``, ``/lib/ld64-uClibc-1.0.45.so``,
  ``/lib/libuClibc-1.0.45.so``, and ``/usr/lib/libtirpc.so.3.0.0`` plus the
  required symlinks has SHA-256
  ``9f94a297a5da2399a3ffb06853779bb3b5ce4f398aaa3cfd5ced162ad17c885d``.
  ``debugfs`` writes dumped files with host-created modes, so the helper
  normalizes the BusyBox closure to executable ``0755`` modes before building
  the initramfs.  Without that normalization, the kernel reaches ``Run /init``
  but fails with ``EACCES`` before the marker.
* The dynamic TuxBoot archive reached ``Run /init`` with QEMU's default CPU
  model, then trapped with an invalid opcode inside ``libuClibc-1.0.45.so``.
  This matched the need for the existing x86_64 TuxRun test's explicit
  ``Nehalem`` CPU model.  ``scripts/ci/wasm-linux-boot-smoke.mjs`` now accepts
  ``--cpu MODEL``.  Native QEMU and the Node.js ``v24`` wasm64 TCI wrapper
  both reached ``QEMU_WASM_LINUX_BOOT_OK`` with ``--cpu Nehalem``, the pinned
  TuxBoot kernel, and the dynamic TuxBoot initramfs.  This closes the
  implementation proof for ``WASM-017b``.  The later ``WASM-017c`` CI path
  supplies the pinned TuxBoot kernel and rootfs files through
  ``scripts/ci/wasm-prepare-tuxboot-smoke-guest.py`` before invoking the boot
  smoke wrapper.
* A follow-up Node.js ``v24`` wasm64 TCI probe with ``--cpu qemu64`` ruled out
  that simpler CPU model for the current TuxBoot smoke guest.  The guest
  reached ``Run /init as init process`` but then trapped with an invalid opcode
  in ``libuClibc-1.0.45.so`` and timed out without the marker.  The Firefox
  browser gap should therefore not be chased by switching the current smoke
  guest from ``Nehalem`` to ``qemu64``.
* The Node and browser smoke wrappers now accept ``--append-extra`` so
  diagnostic runs can append Linux kernel arguments without copying or
  hand-editing the canonical smoke command line.  A Node.js ``v24`` wasm64 TCI
  proof appended ``qemu_wasm_append_probe=1`` to the pinned TuxBoot smoke
  guest, and the guest printed that value in both the early ``Command line``
  and later ``Kernel command line`` records before reaching
  ``QEMU_WASM_LINUX_BOOT_OK``.  This gives the Firefox and browser-matrix
  investigation a safe way to add temporary kernel diagnostics such as
  initcall tracing while keeping the default smoke path stable.
* The Node and browser smoke wrappers now also accept repeated ``--qemu-arg``
  arguments for QEMU-level diagnostics without editing the canonical smoke
  command line.  A Node.js ``v24`` proof appended ``-name wasm-smoke`` to the
  QEMU invocation and reached ``QEMU_WASM_LINUX_BOOT_OK``.  A Chromium
  ``141.0.7390.37`` browser proof with the same extra QEMU arguments reached
  the marker after roughly ``80`` seconds, and its result JSON recorded
  ``qemuArgs`` as ``["-name", "wasm-smoke"]``.  This gives Firefox and future
  browser-matrix probes a stable way to test QEMU timer, interrupt, tracing,
  or naming options while leaving the accepted smoke profile unchanged.
* The browser smoke runner now accepts ``--screenshot FILE``.  When supplied,
  the runner captures a viewport screenshot after the success marker is reached
  or after failure diagnostics are collected, and records the screenshot path
  in result JSON.  ``--screenshot-full-page`` is available for diagnostic runs
  that need the complete scrollable serial log.  This is generic QEMU evidence
  infrastructure; downstream Bus Engine can use the same path to produce a
  product-page preview after its own OS artifact boots through the harness.
  A Chromium ``141.0.7390.37`` proof with the cleaned wasm64 TCI artifact,
  pinned TuxBoot kernel, and helper-generated initramfs reached
  ``QEMU_WASM_LINUX_BOOT_OK`` after roughly ``80`` seconds and wrote a
  viewport PNG at ``1280x720``.  The result JSON recorded ``screenshot`` and
  ``screenshotFullPage: false``.
* The browser smoke runner now records the final page status and supports
  ``--page-text-tail-bytes`` so browser failures can preserve a larger bounded
  serial-output tail in JSON without changing the page output cap.  A Chromium
  ``141.0.7390.37`` proof with ``--append-extra qemu_wasm_append_probe=1``
  reached ``QEMU_WASM_LINUX_BOOT_OK`` after roughly ``81`` seconds.  Its
  result JSON recorded ``pageStatus`` as
  ``marker reached: QEMU_WASM_LINUX_BOOT_OK`` and the captured page tail
  contained both kernel command-line records with the appended probe.
* The browser smoke page now exposes ``qemuWasmSmokeState`` and the runner
  records it in result JSON.  The state includes emitted serial line count,
  captured output bytes, whether output was suppressed, whether the marker was
  seen, and the last emitted line.  A Chromium ``141.0.7390.37`` proof reached
  the marker after roughly ``79`` seconds and recorded ``170`` emitted lines,
  ``8601`` captured output bytes, ``outputSuppressed: false``, and
  ``lastLine`` as ``QEMU_WASM_LINUX_BOOT_OK``.  This gives timeout artifacts a
  compact progress summary without parsing the full page-text tail.
* The browser smoke runner now also records a bounded ``progressSamples``
  timeline.  The default sampling interval is ``10000`` ms and the default
  limit is ``120`` samples; both can be changed with runner options.  A
  sampled Chromium ``141.0.7390.37`` proof reached the marker after roughly
  ``79`` seconds.  Its timeline showed no progress past the FPU line at
  roughly ``40`` and ``50`` seconds, then progress to ``io scheduler kyber
  registered`` by roughly ``60`` seconds, and finally the marker.
* The browser smoke harness now records a structured phase timeline in
  ``qemuWasmSmokeState.phases``.  The current phases distinguish browser
  feature validation, guest input fetches, QEMU module import, QEMU startup,
  guest boot wait, timeout, early QEMU exit, success, and page-level failure.
  The Playwright runner treats page-level ``failed`` and
  ``timeout waiting...`` states as terminal outcomes, so those failures can be
  captured in result JSON without waiting for the runner's own timeout.  This
  patch has JavaScript syntax-check evidence in the local development
  environment; a follow-up Chromium run should record a missing-input
  negative proof and a success proof with the phase timeline present in
  ``build/wasm-browser-smoke-result.json``.
* The browser smoke harness now makes the MVP no-network boundary explicit.
  The page and Playwright runner default to ``network=none``, which appends
  ``-nic none`` to the generated QEMU command line.  Future networking
  diagnostics can opt into ``--network default`` without changing the MVP
  smoke default.  The setting is recorded in the runner result JSON.
* ``scripts/ci/wasm-browser-smoke-args-test.mjs`` now imports the pure browser
  smoke QEMU argument builder and verifies the deterministic command shape for
  initrd boot, default no-network mode, rootfs boot through ``virtio-mmio``,
  rootfs boot through ``virtio-pci``, appended kernel arguments, and extra
  trailing QEMU arguments.  The Node Linux smoke job and the browser CI job
  run this test before the boot smoke so command-line regressions fail before
  the expensive guest boot or Chromium paths start.
* ``scripts/ci/wasm-browser-smoke-runner-test.mjs`` now verifies the browser
  runner's terminal page-status predicate.  It covers success, early QEMU
  exit, timeout, page-level failure, active startup phases, and marker
  mismatches.  The runner injects the same helper into the Playwright page
  before navigation, so the browser wait condition and the deterministic Node
  test share one predicate.  The Node Linux smoke job and browser CI job both
  run this test.  The same test also verifies the pure result-promotion helper
  that copies browser smoke state into top-level JSON fields such as
  ``phase``, ``failurePhase``, ``qemuCommand``, output counters, marker state,
  expected-text state, and the last serial line.  It also covers the runner's
  URL/query mapping into the browser page, including repeated expected-text
  and QEMU-argument parameters, rootfs mode, omitted initrd mode, network mode,
  timeout, and kernel append parameters.  It verifies the initial result JSON
  shape as well, including browser identity, timeout, network mode, diagnostic
  list defaults, expected-text entries, and extra QEMU arguments.  It also
  verifies that bounded diagnostic lists keep the newest entries when the
  configured limit is reached.
* The Node.js smoke wrapper now fails before importing the generated
  Emscripten module when the local runtime is too old for the wasm64 smoke
  path.  On Node.js ``v22.19.0`` it writes structured JSON with
  ``preflight: "node-version"``, ``requiredNodeMajor: 23``, and the detected
  ``nodeVersion``.  This turns an otherwise opaque Emscripten launcher error
  into deterministic runtime evidence.
  ``scripts/ci/wasm-node-preflight-test.mjs`` covers the version parser and
  both pass and fail preflight result shapes with synthetic Node.js versions,
  so CI keeps the JSON contract stable even on newer smoke runners.
* A current local CI-shaped Chromium proof was re-run in the cached
  Playwright ``v1.56.1`` Noble container with Chromium ``141.0.7390.37`` and
  Node.js ``v22.20.0``.  The run used the existing cleaned wasm64 TCI
  artifacts with SHA-256
  ``a072f5c3280a7d832dd7511c8ef7a961a43a2ce009f0658702965553298ba697`` for
  ``qemu-system-x86_64.js`` and
  ``7666234b6325366b4ff9fc0e0bb91f08d1ad71803e5ee12da4531022017f2a33`` for
  ``qemu-system-x86_64.wasm``.  The TuxBoot kernel SHA-256 was
  ``f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8`` and
  the helper initramfs SHA-256 was
  ``9f94a297a5da2399a3ffb06853779bb3b5ce4f398aaa3cfd5ced162ad17c885d``.
  With the current default ``network=none`` command, the browser passed
  cross-origin isolation and reached QEMU guest boot, but timed out after
  ``240181`` ms with ``107`` serial lines, ``5585`` captured bytes,
  ``lastLine`` equal to ``x86/fpu: x87 FPU will use FXSAVE``, and one page
  error: ``RuntimeError: memory access out of bounds``.  A comparison run with
  ``--network default`` removed ``-nic none`` from the QEMU command but also
  timed out after ``240274`` ms at the same final serial line, without page
  errors.  This means the current failure is not explained solely by the
  explicit no-network command shape; the next Chrome/Chromium diagnostic
  should target the wasm64 TCI execution path around post-FPU kernel progress
  and the intermittent browser memory exception.
  The browser smoke runner now preserves console source locations, page-error
  stack traces, request-failure details, elapsed time, and the current smoke
  state in result JSON, so follow-up Chromium runs can associate a
  ``RuntimeError: memory access out of bounds`` with the last serial line and
  browser-side stack context.  The browser harness also records failure name,
  message, stack, and failed phase directly in ``qemuWasmSmokeState`` when its
  own startup or module-import path rejects.  Progress samples now also record
  line-count deltas, output-byte deltas, previous sample time, and whether the
  last serial line changed, so a follow-up run can distinguish a quiet stall
  from slow but continuing guest output without manually diffing samples.
  Page-error handling now waits for the smoke-state snapshot before appending
  the diagnostic, records a ``page-error`` progress sample, and flushes
  pending page-error diagnostics before writing result JSON.  This keeps the
  intermittent Chromium ``RuntimeError: memory access out of bounds`` evidence
  tied to the guest phase and last serial line observed by the page.
  Browser smoke result JSON now also includes a compact ``summary`` object
  with the primary runner error, page status, marker state, last serial line,
  page-error count, request-failure count, and final progress sample.  The
  deterministic helper test covers the current Chromium timeout shape so the
  next run can be triaged from the summary before inspecting the full arrays.
  The browser page now also records a ``browserRuntime`` snapshot in the smoke
  state and result JSON.  It includes cross-origin isolation, SharedArrayBuffer
  and WebAssembly availability, a tiny ``address: "i64"``
  ``WebAssembly.Memory`` constructor probe, user-agent, hardware concurrency,
  device memory when reported, and JavaScript heap limit when exposed by the
  runtime.  This is per-run context for smoke artifacts, not a replacement for
  the separate browser memory-probe matrix.
  A detached old-harness comparison using commit ``ae212bc74a`` with the same
  cleaned wasm64 TCI artifacts, TuxBoot kernel, helper initramfs, Playwright
  ``v1.56.1`` Noble container, and Chromium ``141.0.7390.37`` also timed out
  after ``240152`` ms.  It passed browser setup and cross-origin isolation,
  recorded no page errors or request failures, and its final samples stayed at
  ``107`` serial lines with ``lastLine`` equal to
  ``x86/fpu: x87 FPU will use FXSAVE``.  This rules out the recent browser
  runner diagnostic changes, result-promotion changes, and explicit
  no-network default as the sole cause of the current stall.
  A current-harness Chromium probe with reduced guest memory
  ``--memory 256M`` also timed out after ``240158`` ms at the same final
  serial line, with no page errors or request failures.  The new progress
  deltas showed ``lineDelta: 0``, ``outputByteDelta: 0``, and
  ``lastLineChanged: false`` for the final repeated samples.  This rules out
  simple 512 MiB guest-memory size pressure and confirms that the failure is a
  quiet guest-execution stall after the FPU line in the tested browser
  runtime.
  A current-harness Chromium probe with ``--cpu qemu64`` also timed out after
  ``240178`` ms at the same final serial line, with no page errors or request
  failures.  It emitted ``103`` serial lines and the summary's final progress
  sample again recorded ``lineDelta: 0``, ``outputByteDelta: 0``, and
  ``lastLineChanged: false``.  This means the simpler CPU model that works in
  the Node.js smoke path is not sufficient to make the current Chromium TCI
  browser run progress beyond the FPU line.
  The same current artifacts were then run through Node.js ``v24.18.0`` in
  both the cached ``node:24-alpine`` image and the pinned
  ``/opt/node-qemu-wasm-smoke`` runtime inside
  ``qemu/emsdk-wasm64-cross:latest``.  Both Node runs timed out at
  ``240000`` ms with ``107`` serial lines, ``markerSeen: false``, and
  ``lastLine`` equal to ``x86/fpu: x87 FPU will use FXSAVE``.  This meant the
  failure was no longer proven to be browser-only; the next diagnostic was to
  compare that cleaned artifact against an earlier known-good
  artifact or rebuild from the current source to determine whether the
  regression is in the artifact, the guest inputs, or the shared wasm64 TCI
  execution path.
  That comparison resolved the stall as artifact-specific rather than a
  current harness or guest-input failure.  The failing artifact set was
  ``/tmp/qemu-wasm64-tci-artifacts-after-syscall-cleanup`` with
  ``qemu-system-x86_64.js`` SHA-256
  ``a072f5c3280a7d832dd7511c8ef7a961a43a2ce009f0658702965553298ba697`` and
  ``qemu-system-x86_64.wasm`` SHA-256
  ``7666234b6325366b4ff9fc0e0bb91f08d1ad71803e5ee12da4531022017f2a33``.
  Running the same TuxBoot kernel, helper initramfs, firmware directory,
  ``Nehalem`` CPU model, and Node.js ``v24.18.0`` runtime with
  ``/tmp/qemu-wasm64-tci-artifacts-optimized`` reached
  ``QEMU_WASM_LINUX_BOOT_OK`` after ``80088`` ms.  Running the same command
  with ``/tmp/qemu-wasm64-tci-artifacts-pipe2-final`` reached the marker after
  ``76632`` ms.  The ``pipe2-final`` artifact hashes were
  ``57ea9090acad40b3587c2648df233e1c3560cc20d10d1884b26226c3a23ce3f9`` for
  ``qemu-system-x86_64.js`` and
  ``10ee623fc6ddb4c49a1b61bb97a0e77d6a06edfccf297d679a8ce1b0ef0287a8`` for
  ``qemu-system-x86_64.wasm``.
  A headless Chromium proof in the Playwright ``v1.56.1`` Noble image with
  Chromium ``141.0.7390.37`` also reached
  ``QEMU_WASM_LINUX_BOOT_OK`` with the ``pipe2-final`` artifact after
  ``83625`` ms.  The browser result recorded ``crossOriginIsolated: true``,
  ``phase: success``, ``170`` serial lines, ``8601`` captured bytes, no page
  errors, no request failures, and a viewport screenshot at
  ``/tmp/qemu-wasm-browser-pipe2-final.png`` with SHA-256
  ``c6b0f2f12dcd89facd5e6ac1d4fe4de36a6a9eeb15e434cafff6c06e49fd20b0``.
  A fresh rerun in the same cached Playwright image with the same artifact
  hashes reached the marker after ``78781`` ms, again with ``phase:
  success``, ``170`` serial lines, ``8601`` captured bytes, no page errors,
  no request failures, ``idleTimeout: null``, result JSON SHA-256
  ``858a3cd87d753cfbc9700662c73ddaaec8bcd97fe99fbc4246f33d127ce108f2``,
  and screenshot SHA-256
  ``c6b0f2f12dcd89facd5e6ac1d4fe4de36a6a9eeb15e434cafff6c06e49fd20b0``.
  Future post-FPU stall investigations should first confirm the artifact
  source and SHA-256 values before changing the browser runner or guest
  command line.
  The browser smoke CI job now exposes
  ``QEMU_WASM_BROWSER_APPEND_EXTRA``, ``QEMU_WASM_BROWSER_CPU``,
  ``QEMU_WASM_BROWSER_MEMORY``, and ``QEMU_WASM_BROWSER_TIMEOUT_MS`` so the
  same Chromium job can replay kernel-argument, CPU-model, memory-size, and
  timeout probes without changing the committed YAML.  The defaults preserve
  the canonical ``Nehalem``/``512M`` smoke shape.
  The job also requests a default viewport screenshot at
  ``build/wasm-browser-smoke.png`` and archives it with the JSON artifacts, so
  both successful and timed-out browser runs preserve the visible terminal
  page state for review.
  The browser smoke runner now also accepts ``--idle-timeout-ms`` and the
  GitLab browser job exposes it as ``QEMU_WASM_BROWSER_IDLE_TIMEOUT_MS``.
  The default is ``0`` so canonical smoke behavior is unchanged.  When a
  diagnostic run enables it, repeated progress samples with unchanged serial
  output produce an ``idleTimeout`` result summary containing the idle
  duration, the last serial line, output byte count, and line count.
  ``--idle-after-text`` and ``QEMU_WASM_BROWSER_IDLE_AFTER_TEXT`` can further
  restrict the watchdog to samples whose current last serial line contains a
  chosen diagnostic string, such as ``x87 FPU will use FXSAVE``.  This lets
  Chrome/Chromium stall probes target a known stop point without changing
  canonical smoke behavior.
* A Firefox ``142.0.1`` diagnostic run with
  ``--append-extra "initcall_debug ignore_loglevel"`` timed out after
  ``420000`` ms.  The result had ``crossOriginIsolated: true`` and no browser
  console, page, or request errors.  The guest printed the appended kernel
  arguments and progressed through timer setup, skipped delay-loop
  calibration, ``random: crng init done``, TLB reporting, and Spectre
  mitigation output, but did not reach ``Run /init`` or the marker.  This
  narrows the Firefox gap to guest execution progress after early kernel CPU
  initialization rather than harness setup, cross-origin isolation, resource
  loading, kernel argument forwarding, or marker detection.
* A follow-up Firefox ``142.0.1`` diagnostic run with
  ``--append-extra "mitigations=off pti=off random.trust_cpu=on"`` also timed
  out after ``420000`` ms.  The result recorded ``pageStatus`` as
  ``QEMU started; waiting for marker``, ``crossOriginIsolated: true``, and no
  browser console, page, or request errors.  The guest showed the appended
  command-line arguments, disabled kernel/user page-table isolation on the
  command line, reached APIC timer setup, skipped delay-loop calibration, and
  printed ``random: crng init done``, but still did not reach ``Run /init``.
  This rules out the broad x86 mitigation and page-table-isolation path as a
  sufficient explanation for the Firefox-only browser boot gap.
* A longer Firefox ``142.0.1`` baseline run with the canonical smoke command
  timed out after ``900000`` ms.  The result recorded ``pageStatus`` as
  ``QEMU started; waiting for marker``, ``crossOriginIsolated: true``, no
  browser console, page, or request errors, and ``smokeState`` with ``94``
  emitted serial lines, ``4929`` captured bytes, ``markerSeen: false``,
  ``outputSuppressed: false``, and ``lastLine`` as
  ``x86/fpu: x87 FPU will use FXSAVE``.  This rules out the previous
  ``420000`` ms timeout as the primary explanation for Firefox failing to
  reach ``Run /init``.
* A sampled Firefox ``142.0.1`` baseline run with the canonical smoke command
  timed out after ``420000`` ms.  Its progress timeline showed the guest
  sitting at the early blank line from roughly ``12`` seconds through
  ``222`` seconds, then progressing through memory setup, APIC timer setup,
  and delay-loop calibration.  It reached ``random: crng init done`` at
  roughly ``342`` seconds and emitted no more serial lines through the final
  sample at roughly ``422`` seconds.  This makes the current Firefox
  difference more specific than "slow": Chromium pauses near the FPU line and
  resumes, while Firefox can spend much longer before timer/calibration
  progress and then stalls after entropy initialization in the sampled run.
* A Firefox ``142.0.1`` timer-parameter probe with
  ``--append-extra "nohz=off highres=off clockevents.no_timer_check=1"`` also
  timed out after ``420000`` ms.  The guest command line contained the
  appended arguments, but the kernel reported ``nohz=off`` and ``highres=off``
  as unknown parameters to pass to userspace, so that run does not prove those
  two timer settings changed kernel behavior.  The sampled timeline still
  reached ``random: crng init done`` at roughly ``372`` seconds and emitted no
  more serial lines through timeout.  Future kernel-command-line diagnostics
  must check the guest log for accepted versus ignored parameters before using
  the result to rule out a subsystem.
* A Firefox ``142.0.1`` uniprocessor-path probe with
  ``--append-extra "nosmp maxcpus=1"`` also timed out after ``420000`` ms.  The
  guest command line contained the appended parameters, the guest reported one
  processor, and the log did not report those parameters as unknown.  The run
  changed the kernel path enough to print ``Not enabling interrupt remapping
  due to skipped IO-APIC setup``, but still reached ``random: crng init done``
  at roughly ``352`` seconds and emitted no more serial lines through timeout.
  This makes the Firefox gap unlikely to be fixed merely by forcing the smoke
  guest away from the SMP/IO-APIC setup used by the canonical run.
* ``scripts/ci/wasm-prepare-tuxboot-smoke-guest.py`` now provides that
  CI-shaped guest-preparation path.  It downloads or reuses the existing
  x86_64 TuxBoot kernel and rootfs assets, verifies them against the SHA-256
  values already pinned by ``tests/functional/x86_64/test_tuxrun.py``,
  decompresses the rootfs with ``zstd``, extracts the dynamic BusyBox closure
  with ``debugfs``, builds the deterministic initramfs, writes a JSON
  manifest, and prints the matching ``wasm-linux-boot-smoke.mjs`` command.
  A local no-download run using the cached TuxBoot assets wrote
  ``/tmp/qemu-wasm-tuxboot-smoke-helper-proof3/tuxboot-smoke-guest.json``;
  the printed boot command reached ``QEMU_WASM_LINUX_BOOT_OK`` under
  ``node:24-alpine`` with the cleaned wasm64 TCI artifact.  This provides the
  reusable command path for ``WASM-017c``.  The helper is now wired into the
  ``smoke-wasm64-64bit-linux`` and ``smoke-wasm64-64bit-browser`` jobs; the
  remaining evidence is execution in the accepted upstream CI environment.
* The current local ``qemu/emsdk-wasm64-cross:latest`` image reports Node.js
  ``v22.16.0``.  That image can build the wasm64 artifact, but it cannot run
  the generated Emscripten module because the module requires Node.js
  ``v23.0.0`` or newer.  The passing smoke proof used ``node:24-alpine`` with
  the built artifacts bind-mounted read-only.  An official CI job therefore
  needs either a separate Node.js ``v24`` smoke-test image with ``python3``,
  ``zstd``, and ``debugfs`` available, or an update to the QEMU wasm64 CI
  image that supplies those runtime tools.
* The wasm64 CI image path was updated locally to include a checksum-verified
  Node.js ``v24.18.0`` runtime at ``/opt/node-qemu-wasm-smoke`` and ``zstd``.
  The normal image ``PATH`` still resolves ``node`` to Emscripten's bundled
  Node.js ``v22.16.0`` for build compatibility.  Rebuilding
  ``docker-image-emsdk-wasm64-cross`` produced local image
  ``e42ced33233a26fa977ca7805569c9627fb9ce1ec16c29749fe68269027e62fb``.
  Inside that image, ``/opt/node-qemu-wasm-smoke/bin/node --version`` reports
  ``v24.18.0``, ``zstd`` and ``debugfs`` are available, and the full helper
  plus ``wasm-linux-boot-smoke.mjs`` flow reaches
  ``QEMU_WASM_LINUX_BOOT_OK`` with the cleaned wasm64 TCI artifact.
* ``.gitlab-ci.d/buildtest.yml`` now contains an optional
  ``smoke-wasm64-64bit-linux`` test job.  It depends on
  ``build-wasm64-64bit`` artifacts, adds ``/opt/node-qemu-wasm-smoke/bin`` to
  ``PATH``, prepares the pinned TuxBoot smoke guest, caches the downloaded
  TuxBoot inputs under ``wasm-smoke-cache``, and runs the Linux boot wrapper.
  The job records structured Node smoke evidence in
  ``build/wasm-smoke-result.json`` and archives it next to the guest manifest
  so CI keeps the same marker, output-tail, and early-exit state that local
  smoke runs produce.
* ``.gitlab-ci.d/buildtest.yml`` also contains an optional
  ``smoke-wasm64-64bit-browser`` test job.  It uses the same
  ``build-wasm64-64bit`` artifacts, prepares the pinned TuxBoot smoke guest in
  a disposable Playwright ``v1.56.1`` browser image, installs the missing
  ``zstd`` tool and the matching ``playwright@1.56.1`` Node package, records
  ``build/wasm-browser-memory-probe.json`` with
  ``scripts/ci/wasm-browser-memory-probe-runner.mjs``, then runs
  ``scripts/ci/wasm-browser-smoke-runner.mjs`` and records
  ``build/wasm-browser-smoke-result.json``.  The memory probe uses an explicit
  page-list variable covering 1, 2, 3, 4, 6, 8, 16, and 32 GiB equivalent
  page counts so CI artifacts keep the same boundary shape as local browser
  investigations.  The job defaults to ``QEMU_WASM_BROWSER=chromium`` but can
  be replayed with another Playwright browser name, such as ``firefox``, for
  matrix investigation.  The smoke result keeps a bounded 60 KiB page-text
  tail and an explicit 10 second, 120-entry progress-sample timeline so
  timeout artifacts preserve enough serial output and progress state for
  guest-progress diagnosis without flooding the job log.  The job is optional
  because the acceptable upstream browser image, browser matrix, and runtime
  cost policy still need maintainer review.
  A corrected local Chromium job-shaped run using copied wasm artifacts and a
  pre-populated TuxBoot cache exercised the same memory-probe, guest-helper,
  and browser-runner path in that Playwright image.  The run wrote
  ``build/wasm-browser-memory-probe.json``,
  ``build/wasm-browser-smoke-guest/tuxboot-smoke-guest.json``, and
  ``build/wasm-browser-smoke-result.json``.  Chromium ``141.0.7390.37``
  reported ``crossOriginIsolated: true``; the memory probe had ``14`` accepted
  memory cases and ``2`` expected default-address 8 GiB failures; the smoke
  result recorded ``success: true`` after roughly ``78`` seconds and the page
  text tail ended with ``Run /init as init process`` followed by
  ``QEMU_WASM_LINUX_BOOT_OK``.  The proof used the pinned TuxBoot kernel and
  rootfs SHA-256 values already recorded in the guest manifest.

The preferred product-neutral smoke guest preparation path is::

  python3 scripts/ci/wasm-prepare-tuxboot-smoke-guest.py \
    --output-dir /tmp/qemu-wasm-tuxboot-smoke-guest \
    --artifact-dir /artifacts \
    --firmware-dir pc-bios

For offline diagnostics with already cached assets, use::

  python3 scripts/ci/wasm-prepare-tuxboot-smoke-guest.py \
    --kernel /tmp/qemu-wasm-tuxboot-x86_64-bzImage \
    --rootfs /tmp/qemu-wasm-tuxboot-x86_64-rootfs.ext4.zst \
    --output-dir /tmp/qemu-wasm-tuxboot-smoke-guest \
    --artifact-dir /artifacts \
    --firmware-dir pc-bios \
    --no-download

The helper prints a command equivalent to::

  node scripts/ci/wasm-linux-boot-smoke.mjs \
    --artifact-dir /artifacts \
    --cpu Nehalem \
    --kernel /tmp/qemu-wasm-tuxboot-x86_64-bzImage \
    --initrd /tmp/qemu-wasm-tuxboot-smoke-guest/tuxboot-smoke-initramfs.cpio.gz \
    --firmware-dir pc-bios

For manual diagnostics only, a tiny local initramfs can be generated with::

  python3 scripts/ci/wasm-build-smoke-initramfs.py \
    --busybox /usr/bin/busybox \
    --output /tmp/qemu-wasm-smoke-initramfs.cpio.gz

A dynamic-library initramfs can be generated by adding explicit files and
symlinks, for example::

  python3 scripts/ci/wasm-build-smoke-initramfs.py \
    --busybox /tmp/qemu-wasm-tuxboot-busybox \
    --extra-file /tmp/qemu-wasm-tuxboot-dyn/lib/ld64-uClibc-1.0.45.so:/lib/ld64-uClibc-1.0.45.so \
    --extra-file /tmp/qemu-wasm-tuxboot-dyn/lib/libuClibc-1.0.45.so:/lib/libuClibc-1.0.45.so \
    --extra-file /tmp/qemu-wasm-tuxboot-dyn/usr/lib/libtirpc.so.3.0.0:/usr/lib/libtirpc.so.3.0.0 \
    --extra-symlink /lib/ld64-uClibc.so.0:ld64-uClibc.so.1 \
    --extra-symlink /lib/ld64-uClibc.so.1:ld64-uClibc-1.0.45.so \
    --extra-symlink /lib/libc.so.0:libuClibc-1.0.45.so \
    --extra-symlink /usr/lib/libtirpc.so.3:libtirpc.so.3.0.0 \
    --output /tmp/qemu-wasm-smoke-initramfs-tuxboot-dynamic.cpio.gz

The underlying command shape is::

  docker run --rm \
    -v "$PWD:/qemu:ro" \
    -v /tmp/qemu-wasm64-tci-artifacts-pipe2-final:/artifacts:ro \
    -v /boot:/host-boot:ro \
    -v /tmp/qemu-wasm-guest:/guest:ro \
    -w /qemu node:24-alpine \
    node scripts/ci/wasm-node-smoke.mjs \
      --artifact-dir /artifacts \
      --max-output-bytes 60000 \
      --timeout-ms 180000 \
      --marker QEMU_WASM_LINUX_BOOT_OK \
      --mount-file /host-boot/vmlinuz-7.1.0:/kernel \
      --mount-file /guest/initramfs.cpio.gz:/initramfs.cpio.gz \
      --mount-file pc-bios/qboot.rom:/firmware/qboot.rom \
      --mount-file pc-bios/linuxboot_dma.bin:/firmware/linuxboot_dma.bin \
      -- -M microvm,acpi=off -m 512M -accel tcg,thread=single \
        -nographic -serial mon:stdio -monitor none \
        -kernel /kernel -initrd /initramfs.cpio.gz \
        -append 'console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1' \
        -L /firmware

* A local Node.js ``v22.19.0`` memory-constructor probe accepted shared and
  unshared ``WebAssembly.Memory`` at ``32768`` pages and ``65536`` pages, then
  rejected ``131072`` pages with ``RangeError: WebAssembly.Memory(): Property
  'initial': value 131072 is above the upper bound 65536``.  With 64 KiB
  WebAssembly pages, this means the local V8 runtime accepted 2 GiB and 4 GiB
  memories and rejected 8 GiB.  This is useful runtime evidence, but it is not
  a browser compatibility guarantee and does not satisfy the later
  browser-memory matrix task.
* ``scripts/ci/wasm-memory-probe.mjs`` now makes that memory-constructor probe
  repeatable.  It emits JSON with the JavaScript runtime, page size, tested
  page counts, byte sizes, shared/unshared mode, optional ``address: "i64"``
  mode, buffer type, and any constructor failure.  The local command
  ``node scripts/ci/wasm-memory-probe.mjs --memory64`` confirmed that Node.js
  ``v22.19.0`` accepts default-address shared and unshared memories at 1, 2,
  and 4 GiB, rejects default-address 8 GiB, and rejects the ``address: "i64"``
  constructor form with ``TypeError: Cannot convert a BigInt value to a
  number``.  ``scripts/ci/wasm-memory-probe-test.mjs`` covers the page-list
  parser, memory descriptor construction, and a minimal Node.js probe so CI can
  catch contract regressions without allocating the full browser matrix.
* The same probe under the ``node:24-alpine`` runtime used for the WASM boot
  smoke tests reported Node.js ``v24.18.0`` with V8
  ``13.6.233.17-node.50``.  Default-address shared and unshared memories
  still accepted 1, 2, and 4 GiB and rejected 8 GiB.  The ``address: "i64"``
  form accepted shared and unshared memories at 1, 2, 4, 8, and 16 GiB, then
  rejected 32 GiB with an upper bound of ``262144`` WebAssembly pages
  (16 GiB).  This is useful evidence for the Node.js smoke runtime, but it is
  not browser compatibility evidence.
* ``scripts/ci/wasm-browser-memory-probe.html`` and
  ``scripts/ci/wasm-memory-probe-server.mjs`` now provide the matching browser
  probe path.  The server only exposes the probe page and its module, and sets
  ``Cross-Origin-Opener-Policy: same-origin``,
  ``Cross-Origin-Embedder-Policy: require-corp``, and
  ``Cross-Origin-Resource-Policy: same-origin`` so shared WebAssembly memory
  probes run in the same security shape required by Emscripten pthread builds.
  Start it with ``node scripts/ci/wasm-memory-probe-server.mjs`` and open the
  printed local URL in each browser under test.  The resulting JSON must be
  recorded with the browser name, version, host OS, available memory, and
  whether the page reported ``crossOriginIsolated``.
* ``scripts/ci/wasm-browser-memory-probe-runner.mjs`` now drives that browser
  memory probe through Playwright.  It starts the cross-origin-isolated probe
  server, launches the selected browser engine, applies the requested page
  counts and ``address: "i64"`` setting, prints the JSON result, and can write
  the result to a CI artifact.  The result now records runner metadata,
  including the selected Playwright browser name, browser version, requested
  pages, ``--memory64`` setting, and timeout.
  ``scripts/ci/wasm-browser-memory-probe-runner-test.mjs`` covers the
  runner's pure page-list parsing, probe URL generation, and result-annotation
  helpers so CI can catch contract regressions before launching Playwright.
* A Playwright ``v1.56.1`` browser matrix tested 1, 2, 3, 4, 6, 8, 16, and
  32 GiB equivalent page counts for shared and unshared memories.  All tested
  browsers reported ``crossOriginIsolated: true``.  HeadlessChrome
  ``141.0.7390.37`` and Firefox ``142.0.1`` accepted default-address memory
  through 4 GiB and rejected 6 GiB and larger.  With ``address: "i64"``, both
  accepted shared and unshared memories through 16 GiB and rejected 32 GiB.
  Chromium reported an upper bound of ``262144`` WebAssembly pages for the
  32 GiB ``address: "i64"`` case, while Firefox reported
  ``RuntimeError: too many memory pages``.
* The same matrix using the Safari-compatible WebKit ``26.0`` runtime accepted
  default-address shared and unshared memories through 4 GiB and rejected
  6 GiB and larger.  Every ``address: "i64"`` constructor failed, including
  the 1 GiB case, with ``TypeError: Conversion from 'BigInt' to 'number' is
  not allowed.``  WebKit therefore cannot be treated as ready for the wasm64
  QEMU browser MVP from this evidence alone.
* ``scripts/ci/wasm-browser-smoke.html``,
  ``scripts/ci/wasm-browser-smoke.mjs``, and
  ``scripts/ci/wasm-browser-smoke-server.mjs`` now provide a generic browser
  boot harness for the same 64-bit TuxBoot smoke guest used by the Node.js
  wrapper.  The harness imports the generated Emscripten module, verifies that
  the page is cross-origin isolated and has ``SharedArrayBuffer``, fetches the
  kernel, initramfs, and qboot firmware inputs before module startup, mounts
  them into Emscripten MEMFS during synchronous ``preRun``, uses
  ``locateFile`` for ``qemu-system-x86_64.wasm``, sets
  ``mainScriptUrlOrBlob`` for pthread workers, and routes QEMU stdout/stderr
  into the page.
* The browser smoke server maps explicit local inputs to
  ``/artifacts/qemu-system-x86_64.js``,
  ``/artifacts/qemu-system-x86_64.wasm``, ``/guest/kernel``,
  ``/guest/initramfs.cpio.gz``, ``/firmware/qboot.rom``, and
  ``/firmware/linuxboot_dma.bin``.  A local server route check confirmed
  ``200`` responses for the page, JavaScript module, WebAssembly artifact,
  kernel, and initramfs routes, with
  ``Cross-Origin-Opener-Policy: same-origin``,
  ``Cross-Origin-Embedder-Policy: require-corp``, and
  ``Cross-Origin-Resource-Policy: same-origin`` on each response.
* ``scripts/ci/wasm-browser-smoke-runner.mjs`` now starts the browser smoke
  server, launches a Playwright browser, waits for the explicit page status
  ``marker reached: MARKER``, optionally writes a JSON result containing the
  browser name, browser version, marker, elapsed time, cross-origin isolation
  state, bounded console diagnostics, request failures, page errors, page text,
  and error text, and stops the server.  It forwards the selected marker,
  CPU model, guest memory size, timeout, and page-output byte cap into the
  browser page as query parameters so the Playwright wait and browser harness
  use the same smoke-test settings.  The runner originally searched all page
  text for the marker; that was a false-positive risk because failure messages
  can quote the marker.  The corrected runner no longer treats ``timeout
  waiting for marker: MARKER`` or ``QEMU returned before marker: MARKER`` as
  success.  A disposable
  ``mcr.microsoft.com/playwright:v1.56.1-noble`` image
  (digest
  ``sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a``)
  with ``playwright@1.56.1`` installed in a temporary directory ran the
  browser harness under headless Chromium ``141.0.7390.37``.  With the
  corrected explicit-status predicate, Chromium reached
  ``QEMU_WASM_LINUX_BOOT_OK`` with the same cleaned wasm64 TCI artifact,
  TuxBoot kernel, and helper-generated initramfs used by the Node.js smoke
  path.  The JSON result recorded ``success: true``,
  ``crossOriginIsolated: true``, the browser version, marker, timeout, user
  agent, elapsed time, and a page-text tail containing Linux boot output and
  the marker.  This is the first corrected browser execution proof for the
  console-first 64-bit TCI boot path.  Browser memory-limit evidence remains
  separate.
* The same Playwright image also ran the browser smoke runner under Firefox
  ``142.0.1`` after the explicit-status predicate fix.  Firefox did not reach
  the marker within a 420 second timeout.  With ``--max-output-bytes 200000``,
  the captured page text showed progress beyond the decompressor and into
  normal kernel initialization, ending after ``random: crng init done`` without
  reaching ``/init``.  Firefox therefore remains an incomplete browser-boot
  investigation, even though its separate memory probe accepted the tested
  wasm64 memory sizes.
* Re-running Firefox ``142.0.1`` with ``--memory 256M`` and the same 420 second
  timeout produced the same failure shape.  The page text again reached normal
  kernel initialization and ended after ``random: crng init done`` without
  reaching ``/init``.  Reducing guest RAM from ``512M`` to ``256M`` therefore
  did not resolve the Firefox browser-boot gap.
* A WebKit boot-smoke attempt in the same Playwright image did not reach guest
  execution.  The browser console repeatedly reported that the runtime was
  still waiting on the ``wasm-instantiate`` dependency, and the runner timed
  out.  The JSON result recorded bounded console diagnostics, ``success:
  false``, the timeout error, and a page-text stack pointing at
  ``WebAssembly.Memory`` construction in the generated QEMU launcher.  This
  matches the separate WebKit memory-probe evidence that ``address: "i64"``
  construction is not available in the tested WebKit runtime.  WebKit remains
  out of scope for the first proven browser MVP until the wasm64 instantiation
  issue is understood.

The browser smoke server can be started with the same prepared guest inputs::

  scripts/ci/wasm-browser-smoke-server.mjs \
    --artifact-dir /tmp/qemu-wasm64-tci-artifacts-pipe2-final \
    --kernel /tmp/qemu-wasm-tuxboot-x86_64-bzImage \
    --initrd /tmp/qemu-wasm-tuxboot-smoke-helper-proof3/tuxboot-smoke-initramfs.cpio.gz \
    --firmware-dir pc-bios \
    --port 8010

Open the printed URL in a browser with SharedArrayBuffer support available
under cross-origin isolation.  The page is successful only when it reaches
``QEMU_WASM_LINUX_BOOT_OK``.

The headless browser proof can be run with Playwright available to Node.js::

  node scripts/ci/wasm-browser-smoke-runner.mjs \
    --artifact-dir /tmp/qemu-wasm64-tci-artifacts-pipe2-final \
    --kernel /tmp/qemu-wasm-tuxboot-x86_64-bzImage \
    --initrd /tmp/qemu-wasm-tuxboot-smoke-helper-proof3/tuxboot-smoke-initramfs.cpio.gz \
    --firmware-dir pc-bios \
    --timeout-ms 180000

The local artifact proof used this source-copy build shape from the QEMU
source root::

  mkdir -p /tmp/qemu-wasm64-tci-artifacts
  docker run --rm \
    -v "$PWD:/host-src:ro" \
    -v /tmp/qemu-wasm64-tci-artifacts:/host-out \
    -w /tmp qemu/emsdk-wasm64-cross \
    bash -lc 'set -euo pipefail
      rm -rf /tmp/src /tmp/build
      mkdir -p /tmp/src /tmp/build /host-out
      rm -f /host-out/*
      tar -C /host-src --exclude=.git --exclude=build \
        --exclude=build-wasm64-tci -cf - . | tar -C /tmp/src -xf -
      cd /tmp/build
      emconfigure /tmp/src/configure --disable-docs \
        --target-list=x86_64-softmmu --static --cpu=wasm64 \
        --disable-tools --enable-debug --enable-tcg-interpreter
      make -j$(nproc)
      find . -maxdepth 1 -type f \
        \( -name "qemu-system-x86_64*" -o -name "*.wasm" \) \
        -print -exec cp -v "{}" /host-out/ \;
      cd /host-out
      sha256sum * > SHA256SUMS
      ls -lh'

The current upstream Emscripten link configuration is intentionally browser
oriented.  It enables pthreads, Asyncify, ``PROXY_TO_PTHREAD``, filesystem
support, table growth, a 2 GiB initial memory, WebAssembly BigInt, ES module
output, and Emscripten runtime methods including ``TTY`` and ``FS``.

Browser runtime notes from primary documentation:

* Emscripten pthreads require ``-pthread`` at compile and link time, and
  deployed browser pthread builds require SharedArrayBuffer availability behind
  COOP/COEP cross-origin isolation headers.
* Emscripten recommends ``PROXY_TO_PTHREAD`` to move ``main()`` off the browser
  main thread and avoid blocking the UI thread.
* MDN documents that shared ``WebAssembly.Memory`` uses ``SharedArrayBuffer``
  and that SharedArrayBuffer sharing requires a secure, cross-origin-isolated
  context.
* MDN documents JavaScript creation of 64-bit-address WebAssembly memory with
  ``address: "i64"`` and ``BigInt`` sizes.
* MDN documents ``WebAssembly.Memory.grow()`` in 64 KiB pages.  Runtime memory
  reporting and limit tests should record pages as well as byte sizes.
* Emscripten's default maximum memory is not a browser guarantee.  The
  generated artifact's ``INITIAL_MEMORY``/``TOTAL_MEMORY``,
  ``MAXIMUM_MEMORY``, ``ALLOW_MEMORY_GROWTH``, ``MEMORY64``, pthread, and
  shared-memory settings must be recorded with every browser-memory result.
* V8's 4 GiB WebAssembly memory note is still useful as a conservative
  ``wasm32`` contrast: ``wasm32`` can address at most 4 GiB, while QEMU's
  Bus Engine MVP deliberately targets ``wasm64`` so the practical limit shifts
  to browser support, device memory, Emscripten, and configured initial or
  maximum memory.

These notes are not a compatibility guarantee.  The next proof must run the
generated artifacts in a browser or browser-equivalent runtime and record the
tested browser, headers, memory settings, and observed failure modes.  The
browser memory probe is intentionally separate from QEMU startup: it answers
whether the runtime can construct the shared linear memories QEMU/Emscripten
will need.  A passing memory probe is required evidence for a browser target,
but it does not prove that QEMU can boot a guest in that browser.

Runtime references used for this evidence:

* Emscripten pthreads:
  ``https://emscripten.org/docs/porting/pthreads.html``
* Emscripten ``MEMORY64`` setting:
  ``https://emscripten.org/docs/tools_reference/settings_reference.html``
* MDN ``SharedArrayBuffer``:
  ``https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer``
* MDN ``Cross-Origin-Embedder-Policy``:
  ``https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy``
* MDN ``WebAssembly.Memory``:
  ``https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory``
* V8 WebAssembly 4 GiB memory note:
  ``https://v8.dev/blog/4gb-wasm-memory``

Reference implementation material
=================================

Use the following experimental sources as reference material:

* ``ktock/qemu-wasm`` master for browser packaging, Emscripten module startup,
  xterm terminal integration, networking experiments, virtfs experiments, and
  the historical ``tcg/wasm32`` backend.
* ``ktock/qemu-wasm`` ``wasm64-tcg-b`` branch for the ``tcg/wasm64`` backend,
  wasm64 memory handling, and CI structure.
* ``ktock/qemu-wasm-sample`` for the minimal direct-kernel boot flow:
  ``qemu-system-x86_64.wasm`` plus ``-nographic``, ``-kernel``,
  ``-drive if=virtio,format=raw,file=...``, and
  ``console=ttyS0 root=/dev/vda``.
* Upstream QEMU ``configs/meson/emscripten.txt`` and Emscripten CI jobs for the
  official baseline.

The experimental fork is mixed-license at the file level.  The shipped QEMU
emulator as a whole remains GPL-covered, even when some new TCG target files
carry MIT-style notices.  Any shipped QEMU/WASM binary therefore needs exact
corresponding source, build scripts, toolchain versions, license texts, and
notices.

Pinned source inputs for this plan
==================================

The first planning branch was prepared from these local source revisions:

* upstream QEMU: ``30e8a06b64``;
* ``ktock/qemu-wasm`` master: ``0ef7b4e281``;
* ``ktock/qemu-wasm-sample`` main: ``599da71``;
* ``ktock/qemu-wasm`` ``wasm64-tcg-b`` branch: reviewed as reference for the
  experimental ``tcg/wasm64`` backend.

The exact commits must be rechecked before implementation starts.  If any
reference branch moves, the first implementation task is to refresh this audit
and record the new commit IDs.

MVP acceptance target
=====================

The MVP is accepted when an upstream-style QEMU build can:

* build ``qemu-system-x86_64`` for an Emscripten/WebAssembly host from a pinned
  Emscripten SDK;
* run in a browser worker or pthread-compatible runtime with cross-origin
  isolation enabled;
* boot a 64-bit Linux kernel with a raw root filesystem through virtio block;
* expose a serial console through a browser terminal bridge;
* run with no network by default;
* expose a browser-visible 2D display surface for opt-in interactive runs;
* accept focused browser keyboard input through the selected QEMU input path;
* emit enough structured logs to diagnose host startup, guest boot, and
  shutdown failures;
* provide a repeatable browser or headless-browser boot test that proves the
  Linux guest reaches a declared readiness marker and, for interactive runs,
  preserves result JSON plus screenshot evidence;
* package QEMU/WASM artifacts and guest inputs without requiring ad hoc manual
  JavaScript edits.

Bus Engine OS is the downstream proof guest.  The upstream QEMU work should
not contain Bus-specific code.  The generic QEMU smoke guest proves the
upstream emulator and browser harness; it is not the final Bus Engine product
proof.

Incremental task backlog
========================

The implementation plan must be executed as small reviewable changes.  Each
task below is intentionally narrow enough to become one patch or one small
patch series.

WASM-001: Refresh source audit
------------------------------

Scope:
  Re-read upstream QEMU and the experimental references at exact commits.

Touches:
  Documentation only.

Proof:
  The audit records commit IDs, branch names, reference files, and the reason
  each reference is relevant.

Non-goals:
  No QEMU behavior changes.

WASM-002: Document current upstream Emscripten baseline
------------------------------------------------------

Scope:
  Document what upstream QEMU already supports for Emscripten and wasm64.

Touches:
  ``docs/devel`` only.

Proof:
  The document points to ``meson.build``, ``configs/meson/emscripten.txt``,
  the wasm64 CI jobs, and the TCI requirement.

Non-goals:
  No new build options.

WASM-003: Define browser MVP command line
-----------------------------------------

Scope:
  Define the canonical console-first command line for a 64-bit Linux boot.

Touches:
  Documentation only.

Proof:
  The documented command line includes ``-nographic``, memory size,
  ``-kernel``, raw virtio block rootfs, and ``console=ttyS0 root=/dev/vda``.

Non-goals:
  No browser harness yet.

WASM-004: Pin Emscripten SDK policy
-----------------------------------

Scope:
  Decide and document how QEMU pins the Emscripten SDK for CI and
  reproducible development builds.

Touches:
  ``tests/docker/dockerfiles/emsdk-wasm64-cross.docker`` and CI docs.

Proof:
  CI uses one declared SDK version and the docs say how to update it.

Non-goals:
  No native TCG backend.

WASM-005: Split TCI and native-WASM-TCG build variants
-----------------------------------------------------

Scope:
  Define separate configure/CI variants for the TCI baseline and the later
  native WebAssembly TCG backend.

Touches:
  ``meson.build``, ``meson_options.txt`` if needed, CI configuration, and docs.

Proof:
  CI names make clear which variant is TCI and which is native WebAssembly
  TCG.

Non-goals:
  Native WebAssembly TCG may remain unimplemented in this task.

WASM-006: Centralize browser link flags
---------------------------------------

Scope:
  Keep Emscripten pthreads, Asyncify, filesystem, BigInt, ES module, and
  runtime-method exports in one cross-build configuration point.

Touches:
  ``configs/meson/emscripten.txt``.

Proof:
  Build logs show browser flags are not duplicated in ad hoc scripts.

Non-goals:
  No terminal UI.

WASM-007: Define WebAssembly host support matrix
------------------------------------------------

Scope:
  Document supported browser/runtime features.

Touches:
  Documentation only.

Proof:
  The matrix covers WebAssembly, wasm64, Web Workers, pthreads,
  SharedArrayBuffer, COOP, COEP, CORP, memory limits, and fallback to TCI.
  Each tested runtime row should include the browser or Node version, the
  headers or flags used, shared-memory support, maximum accepted
  ``WebAssembly.Memory`` pages, and whether the QEMU module starts.

Non-goals:
  No browser compatibility guarantee beyond tested runtimes.

WASM-007a: Add runtime memory probe helper
------------------------------------------

Scope:
  Provide a small JavaScript helper that records
  ``WebAssembly.Memory`` constructor behavior for the current JavaScript
  runtime.

Touches:
  ``scripts/ci/wasm-memory-probe.mjs``,
  ``scripts/ci/wasm-memory-probe-test.mjs``, CI helper-test wiring, and
  documentation.

Proof:
  ``node scripts/ci/wasm-memory-probe.mjs --memory64`` emits JSON with the
  runtime version, page size, tested memory sizes, shared/unshared mode,
  optional ``address: "i64"`` mode, and exact constructor failures.  The
  helper can also be imported by a later browser harness.  The deterministic
  Node helper test verifies page parsing, descriptor shape, and minimal probe
  result structure.

Non-goals:
  No claim that Node.js memory behavior represents browser compatibility.

WASM-007b: Add browser memory probe runner
------------------------------------------

Scope:
  Make browser memory-limit evidence repeatable without manual copy/paste from
  a browser window.

Touches:
  ``scripts/ci/wasm-browser-memory-probe-runner.mjs``,
  ``scripts/ci/wasm-browser-memory-probe-runner-test.mjs``,
  ``.gitlab-ci.d/buildtest.yml``, and documentation.

Proof:
  ``node scripts/ci/wasm-browser-memory-probe-runner.mjs --memory64`` starts
  the isolated probe server, drives a Playwright browser, prints JSON with
  browser runner metadata, and can save the JSON as a CI artifact.  Local
  Playwright runs recorded Chromium, Firefox, and WebKit behavior for
  default-address memory and ``address: "i64"`` memory.  The deterministic
  Node helper test verifies the page-list parser, generated probe URL, and
  runner metadata shape without requiring Playwright.

Non-goals:
  No guarantee that constructor success proves QEMU boot success in the same
  browser.  No claim that every WebKit or Safari build supports wasm64.

WASM-008: Audit host POSIX assumptions
--------------------------------------

Scope:
  Identify every host API used by the MVP boot path that is absent or
  different under Emscripten.

Touches:
  Audit document first; later patches may touch ``system/os-wasm.*``,
  ``include/qemu/osdep.h``, ``util/mmap-alloc.c``, ``util/cacheflush.c``,
  atomics, timers, and thread code.

Proof:
  The audit lists each unsupported call and the intended behavior: implement,
  stub with clear error, or mark non-MVP.

Non-goals:
  No large compatibility shim without per-call justification.

WASM-009: Make unsupported host APIs fail clearly
-------------------------------------------------

Scope:
  Replace silent or confusing Emscripten host failures in the MVP path with
  deterministic errors.

Touches:
  ``system/os-wasm.*`` and adjacent host utility files as needed.

Proof:
  Host smoke tests or startup logs identify the unsupported operation by name.

Non-goals:
  No emulation of non-MVP host features.

WASM-010: Verify wasm coroutine backend
---------------------------------------

Scope:
  Prove that the existing wasm coroutine backend is adequate for the
  console-first Linux boot path.

Touches:
  Coroutine tests or documentation; code only if the audit finds a blocker.

Proof:
  The browser or headless-browser boot test reaches the same readiness marker
  with the wasm coroutine backend.

Non-goals:
  No alternate coroutine backend.

WASM-011: Produce browser-loadable TCI artifacts
------------------------------------------------

Scope:
  Ensure a TCI build creates and preserves the generated browser-loadable
  Emscripten artifacts.

Touches:
  Build scripts, CI artifact configuration, and docs.

Proof:
  CI or a documented local build produces named artifacts from upstream QEMU.
  The observed 64-bit TCI build currently produces
  ``qemu-system-x86_64.js`` and ``qemu-system-x86_64.wasm``.  If a future
  Emscripten configuration starts emitting a separate worker file, the artifact
  rules and harness documentation must be updated at the same time.  CI also
  emits ``qemu-system-wasm.SHA256SUMS`` for deterministic handoff to later
  harness, packaging, and browser boot-test steps.

Non-goals:
  No WebAssembly TCG backend.

WASM-011a: Align JavaScript runtime for smoke tests
---------------------------------------------------

Scope:
  Make the build or test environment provide a JavaScript runtime that can
  execute the generated wasm64 Emscripten module.

Touches:
  ``tests/docker/dockerfiles/emsdk-wasm64-cross.docker``, CI configuration,
  and documentation.

Proof:
  A documented command imports ``qemu-system-x86_64.js`` as an ES module and
  runs ``await Module({ arguments: ["--version"] })`` successfully.  The test
  environment must report Node.js ``v23.0.0`` or newer, or use a browser
  runtime that supports the required wasm64, pthread, BigInt, worker, and
  shared-memory features.

Non-goals:
  No Linux guest boot requirement in this task.  It only proves that the
  JavaScript runtime can start the generated QEMU module.

WASM-011b: Add Node smoke helper for generated artifacts
--------------------------------------------------------

Scope:
  Provide a small Node.js helper that imports the generated Emscripten ES
  module, passes QEMU arguments, captures stdout and stderr, waits for a
  required output marker, and exits deterministically.

Touches:
  ``scripts/ci/wasm-node-smoke.mjs`` and documentation.

Proof:
  ``node scripts/ci/wasm-node-smoke.mjs --artifact-dir /artifacts`` reports
  ``QEMU emulator version`` and exits with status ``0`` when run with
  Node.js ``v24.18.0`` against the captured ``x86_64-softmmu`` artifacts.
  The helper can also copy files into MEMFS with ``--mount-file HOST:WASM``,
  which is required for Node-based kernel/initrd/firmware boot attempts.

Non-goals:
  No browser proof, guest kernel boot, QMP transport, or product-specific
  integration.

WASM-012: Define artifact manifest format
-----------------------------------------

Scope:
  Define a small manifest for generated QEMU/WASM build artifacts.

Touches:
  ``scripts/ci/wasm-artifact-manifest.py``,
  ``scripts/ci/wasm-artifact-manifest-test.py``, CI artifact configuration,
  and documentation.

Proof:
  The CI job writes ``qemu-system-wasm-artifacts.json`` with format version,
  artifact paths, artifact kinds, target names, byte sizes, SHA-256 hashes,
  and a target-pair list that identifies complete or incomplete
  ``qemu-system-$target`` JavaScript/WebAssembly pairs.  Later harness
  manifests may reference guest kernel, rootfs, optional initrd, firmware
  paths, memory size, and boot arguments, but those inputs are not part of
  this QEMU build-artifact manifest.  The deterministic unit test verifies
  JavaScript and WebAssembly artifact entries, complete pair metadata,
  incomplete pair metadata, missing-file checker failures, and the
  no-artifacts error path.  The checker tests also cover stale artifact bytes
  and target pairs whose manifest entries have been dropped.  Both wasm64
  smoke jobs run the checker for ``x86_64`` before preparing the guest.

Non-goals:
  No package manager or product release format.

WASM-012a: Audit unsupported startup syscalls
---------------------------------------------

Scope:
  Determine whether the remaining Emscripten warnings for
  ``__syscall_mprotect`` and ``__syscall_pipe2`` are harmless for the
  console-first Linux boot path or need QEMU-side configuration, stubs, or
  clearer diagnostics.  ``__syscall_prlimit64`` was traced to wasm host
  ``os_setup_limits()`` and removed by making that setup a no-op.

Touches:
  Audit documentation first; code only if the warning maps to a boot-path
  failure or misleading behavior.

Proof:
  The audit identifies the QEMU or dependency caller for each syscall warning,
  explains whether it affects ``--version`` only, the TCI boot path, or later
  features, and defines the exact follow-up patch if one is needed.

Non-goals:
  No broad POSIX emulation layer.

WASM-013: Package kernel and rootfs through Emscripten FS
--------------------------------------------------------

Scope:
  Make the browser boot proof load declared guest files through Emscripten FS.

Touches:
  Example harness or packaging helper.

Proof:
  QEMU opens the kernel and raw rootfs using documented in-browser paths.
  The Node smoke helper has proven the first part of this for MEMFS-hosted
  kernel, initrd, and firmware files.  The browser smoke server now exposes
  explicit kernel, initramfs, firmware, JavaScript, and WebAssembly artifact
  routes with the required cross-origin isolation headers.  Headless Chromium
  reached the marker through those routes with the corrected explicit-status
  predicate, proving QEMU opened the browser MEMFS-mounted kernel, initramfs,
  and firmware inputs.
  The corrected job-shaped Chromium run also wrote the smoke guest manifest
  with pinned TuxBoot kernel SHA-256
  ``f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8`` and
  rootfs SHA-256
  ``4b8b2a99117519c5290e1202cb36eb6c7aaba92b357b5160f5970cf5fb78a751``.
  A native QEMU ``microvm`` probe with the 1 GiB TuxBoot ext4 rootfs verified
  the root-disk command-line shape for the future browser-rootfs harness:
  ``-drive file=...,format=raw,if=none,id=hd0`` plus
  ``-device virtio-blk-device,drive=hd0`` exposed the image as ``/dev/vda``.
  The guest mounted the ext4 filesystem and reached the TuxTest login prompt
  within a 30 second host timeout.  The current browser proof still uses the
  smaller helper-generated initramfs; browser raw-rootfs support should be
  added with a suitably small proof image before it is treated as accepted.
  That smaller proof image was then created as a 32 MiB ext4 root filesystem
  from the helper-generated smoke initramfs contents.  Native QEMU reached
  ``QEMU_WASM_LINUX_BOOT_OK`` from that image with ``root=/dev/vda rw
  init=/init``.  ``scripts/ci/wasm-linux-boot-smoke.mjs`` now accepts either
  ``--initrd`` or ``--rootfs``; the rootfs path mounts the image at
  ``/rootfs.raw`` and adds ``virtio-blk-device`` as ``/dev/vda``.  The browser
  smoke server, page, and runner expose the same optional rootfs path.  A
  Node.js ``v24`` wasm64 TCI proof reached the marker with the 32 MiB ext4
  rootfs, and a Chromium ``141.0.7390.37`` browser proof reached the marker
  after roughly ``74`` seconds with ``crossOriginIsolated: true``, no request
  failures, ``174`` emitted serial lines, and a ``1280x720`` screenshot.
  ``scripts/ci/wasm-linux-boot-smoke.mjs`` and
  ``scripts/ci/wasm-browser-smoke-runner.mjs`` now also accept
  ``--guest-manifest FILE``.  The manifest is a generic JSON object with flat
  fields such as ``kernel``, ``initrd`` or ``rootfs``, ``firmwareDir``,
  ``machine``, ``rootfsDevice``, ``cpu``, ``memory``, ``kernelAppend``,
  ``marker``, ``expectText``, ``appendExtra``, ``qemuArgs``, and timeout or
  capture settings.  Explicit command-line options override manifest values,
  and repeated command-line ``--qemu-arg`` values are appended after manifest
  ``qemuArgs``.  Manifest path fields are resolved
  relative to the manifest file when they are not absolute, so a downstream
  bundle can carry local artifact paths without requiring the caller's current
  directory to match.  A manifest may also include a ``sha256`` object keyed by
  input field name; QEMU smoke helpers verify ``kernel``, ``initrd``, and
  ``rootfs`` checksums before starting the emulator.  A Node.js ``v24`` rootfs
  proof and a Chromium ``141.0.7390.37`` browser proof both reached
  ``QEMU_WASM_LINUX_BOOT_OK`` using a relative-path manifest with SHA-256
  checksums for the kernel and rootfs; the Chromium run again recorded
  ``crossOriginIsolated: true``, no request failures, ``174`` serial lines, and
  a ``1280x720`` screenshot.  A negative Node.js proof with a deliberately
  wrong rootfs SHA-256 exited with status ``2`` and reported a checksum
  mismatch before QEMU startup.
  ``scripts/ci/wasm-guest-manifest-test.mjs`` now covers relative path
  resolution, SHA-256 normalization and verification, explicit command-line
  override behavior, manifest ``qemuArgs`` ordering, and the checksum-mismatch
  failure path without running QEMU.  The smoke helpers also accept repeated
  ``--expect-text TEXT`` arguments, or a manifest ``expectText`` array, so a
  downstream guest proof can require serial identity text in addition to the
  readiness marker.  A Node.js ``v24`` positive proof required
  ``virtio_blk virtio0: [vda]`` and reached
  ``QEMU_WASM_LINUX_BOOT_OK``.  A negative Node.js proof with missing expected
  text exited with status ``124`` and reported the missing string after the
  timeout.  A Chromium ``141.0.7390.37`` browser proof with the same expected
  text recorded ``expectedTextSeen: true``, ``crossOriginIsolated: true``, no
  request failures, no page errors, ``174`` serial lines, and a ``1280x720``
  screenshot at ``/tmp/qemu-wasm-rootfs-proof/chromium-expect.png``.  This
  manifest is the generic handoff shape that downstream Bus Engine OS can
  populate without adding Bus-specific code to upstream QEMU.
  Normal Linux root filesystems can override the smoke-test boot arguments with
  ``--kernel-append`` or manifest ``kernelAppend``.  The root-disk helper
  defaults to the qboot ``microvm`` plus ``virtio-mmio`` block-device shape used
  by the tiny smoke rootfs, and also supports ``--machine`` plus
  ``--rootfs-device virtio-pci`` for ordinary PC-machine images.  The harness
  mounts standard PC firmware files such as ``bios-256k.bin`` when present
  under ``firmwareDir``.
  The Node and browser smoke harnesses now also treat Emscripten's
  ``program exited (with status: N)`` line as terminal failure evidence when
  the marker and expected text have not been satisfied.  This avoids waiting
  for the full timeout after early QEMU startup failures while preserving the
  existing success path.  A Node.js ``v24`` negative proof with ``-M pc`` and a
  missing ``bios-256k.bin`` exited in roughly ``3`` seconds with status ``1``.
  A Chromium ``141.0.7390.37`` negative proof with qboot/linuxboot present but
  the PC BIOS absent wrote result JSON with
  ``pageStatus: program exited before marker: status 1``,
  ``programExitStatus: 1``, no request failures, no page errors, and
  ``elapsedMs: 3240``.
  The Node smoke runner and Linux boot wrapper accept ``--out FILE`` to write
  machine-readable result JSON.  The result records success, exit status,
  marker state, expected text state, elapsed time, output truncation state, the
  last emitted line, and a stable snapshot of the QEMU argument vector before
  Emscripten mutates it.  A direct Node.js ``v24`` ``--version`` proof wrote
  ``/tmp/qemu-node-json-proof/version.json`` with ``success: true``,
  ``status: 0``, ``markerSeen: true``, first QEMU argument ``--version``, one
  emitted line, and ``elapsedMs: 833``.  A wrapped early-failure proof wrote
  ``/tmp/qemu-node-json-proof/wrapper-early-fail.json`` with ``success:
  false``, ``status: 1``, ``markerSeen: false``, first QEMU argument ``-M``,
  two emitted lines, and ``elapsedMs: 1587``.
  ``scripts/ci/wasm-node-smoke-result.mjs`` now centralizes the result
  evidence for early QEMU exits, runtime errors, and timeouts.  Node smoke
  failures record whether the marker is still missing, which expected serial
  texts are still missing, the QEMU program-exit status when present, and the
  runtime error stack when module import or startup fails.  The deterministic
  ``scripts/ci/wasm-node-smoke-result-test.mjs`` helper test covers those
  shapes without requiring a generated QEMU WebAssembly artifact or a guest
  boot run.

  Example generic manifest shape for a root-disk proof::

    {
      "format": 1,
      "artifactDir": "/artifacts",
      "kernel": "/kernel",
      "rootfs": "/rootfs.ext4",
      "firmwareDir": "pc-bios",
      "machine": "microvm,acpi=off",
      "rootfsDevice": "virtio-mmio",
      "cpu": "Nehalem",
      "memory": "512M",
      "marker": "QEMU_WASM_LINUX_BOOT_OK",
      "expectText": ["virtio_blk virtio0: [vda]"],
      "maxOutputBytes": 90000,
      "pageTextTailBytes": 120000,
      "timeoutMs": 180000,
      "sha256": {
        "kernel": "f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8",
        "rootfs": "sha256:8abbea06dcb29a2edbdda27d682d021b8cdd8bae68fa7b296476e6ce9dd514a5"
      }
    }

Non-goals:
  No persistent storage.

Follow-up persistent disk proof:
  The generic browser harness now has an opt-in persistent raw disk path that
  is separate from the rootfs image.  ``persistentDisk=1`` creates or restores
  an OPFS-backed raw image, attaches it as a second virtio block device, records
  OPFS/quota state in ``persistentDiskState``, and writes the disk back to OPFS
  after the success marker.  ``scripts/ci/wasm-build-smoke-initramfs.py`` can
  now generate write and verify guests for this disk, and
  ``scripts/ci/wasm-browser-persistent-disk-proof.mjs`` runs the browser smoke
  harness twice with the same persistent browser profile: first to write a
  payload to the second disk, then after browser restart to verify the payload
  loads from OPFS.  The proof wrapper also hashes the immutable rootfs before
  and after both runs.

  Deterministic coverage added with this path:

  * ``node scripts/ci/wasm-browser-persistent-disk-proof-test.mjs`` validates
    the proof result predicate and option checks.
  * ``python3 scripts/ci/wasm-build-smoke-initramfs-test.py`` validates the
    persistent-disk guest init script shape.
  * ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` validates
    persistent browser profile metadata and ``persistentDiskState`` promotion
    into result JSON.

  The ``smoke-wasm64-64bit-persistent-disk`` GitLab job wires this into the
  existing wasm64 artifact flow.  It consumes ``build-wasm64-64bit`` artifacts,
  prepares the pinned TuxBoot guest, builds write/verify initramfs images,
  attaches the immutable TuxBoot ext4 rootfs as ``/dev/vda``, attaches the
  OPFS-backed persistent disk as ``/dev/vdb``, and archives the write, verify,
  and combined proof JSON.  A local proof run was not completed in the
  supervisor checkout at the time this plumbing was added because no
  ``qemu-system-x86_64.js``/``.wasm`` artifacts or
  ``qemu/emsdk-wasm64-cross:latest`` image were present locally.

WASM-014: Add minimal browser harness
-------------------------------------

Scope:
  Provide the smallest generic harness needed to load QEMU artifacts, start
  QEMU, and expose serial output.

Touches:
  ``tests`` or ``docs`` examples, not QEMU core UI.

Proof:
  The harness boots the smoke guest without product-specific code.

Current status:
  ``scripts/ci/wasm-browser-smoke.html`` and
  ``scripts/ci/wasm-browser-smoke.mjs`` provide the generic harness, and
  ``scripts/ci/wasm-browser-smoke-server.mjs`` serves it with explicit input
  routes and cross-origin isolation headers.  Node syntax checks, local
  ``curl`` route/header checks, and a headless Chromium run through
  ``scripts/ci/wasm-browser-smoke-runner.mjs`` pass with the corrected
  explicit-status predicate.  Firefox reached normal kernel initialization but
  timed out before the marker within 420 seconds at both ``512M`` and ``256M``
  guest RAM.  WebKit timed out during WebAssembly instantiation and remains
  unproven for the wasm64 MVP.

Non-goals:
  No branded UI, no WebGPU, no graphical desktop.

WASM-015: Add serial-console bridge
-----------------------------------

Scope:
  Connect QEMU serial I/O to JavaScript in a library-neutral way.

Touches:
  Chardev/Emscripten TTY integration or example harness, depending on audit
  outcome.

Proof:
  Automated input reaches the guest console and guest output reaches the test
  runner.

Non-goals:
  No dependency on one terminal UI package in QEMU core.

WASM-016: Add readiness-marker boot test
----------------------------------------

Scope:
  Add an automated browser or headless-browser test that waits for a known
  serial marker from the guest.

Touches:
  Test harness and CI configuration.

Proof:
  The test fails on timeout, kernel panic, missing rootfs, or QEMU startup
  failure, and passes only when the page reports explicit ``marker reached``
  status.  When ``--out`` is used, the runner writes a compact JSON result for
  CI artifact collection.

Current status:
  ``scripts/ci/wasm-browser-smoke-runner.mjs`` provides the first automated
  headless-browser readiness-marker test.  With the corrected explicit-status
  predicate, it passed locally under Chromium ``141.0.7390.37`` in the
  Playwright ``v1.56.1`` image.  Firefox ``142.0.1`` reached normal kernel
  initialization but timed out before the marker within 420 seconds at both
  ``512M`` and ``256M`` guest RAM.  A follow-up Firefox run with
  ``initcall_debug ignore_loglevel`` proved kernel argument forwarding and
  narrowed the timeout to guest execution progress after early kernel CPU
  initialization.  A WebKit attempt timed out before QEMU startup while
  waiting on ``wasm-instantiate``.
  ``smoke-wasm64-64bit-browser`` wires that path into GitLab as an optional
  job.  A corrected local job-shaped Chromium container run passed with copied
  wasm artifacts and a pre-populated TuxBoot cache, writing the memory probe,
  smoke guest manifest, and smoke result artifacts.  The job still needs real
  GitLab execution evidence and maintainer review of the external browser
  image and runtime cost.

Non-goals:
  No full distribution test suite.

WASM-016a: Diagnose wasm64 TCI serial and early boot progress
-------------------------------------------------------------

Scope:
  Explain why the Node.js wasm64 TCI ``-M microvm`` boot attempt with mounted
  kernel, initramfs, ``bios-microvm.bin``, and ``linuxboot_dma.bin`` does not
  produce guest serial output before timeout.

Touches:
  QEMU tracing, boot harness options, firmware packaging notes, and only the
  specific QEMU subsystems implicated by the diagnosis.

Proof:
  The diagnostic run produces a concrete failure earlier than the timeout or
  narrows the timeout to a specific execution phase.  Current evidence shows
  wasm64 TCI executes BIOS instructions after reset and reaches Linux early
  console when the command line uses explicit ``-serial mon:stdio`` routing.
  The remaining issue is post-early-kernel progress, not missing firmware,
  missing serial output, or CPU-start failure.

Non-goals:
  No browser UI, networking, graphics, or Bus Engine-specific artifact.

WASM-016b: Measure wasm64 TCI firmware progress
-----------------------------------------------

Scope:
  Determine whether the firmware loop observed under Node.js is simply too
  slow for the current timeout, stuck on an emulated hardware/event path, or
  blocked by the remaining ``pipe2``/event-notifier warning.

Touches:
  QEMU trace options, optional capped log extraction in the smoke helper,
  firmware selection, and documented boot-test timeouts.

Proof:
  A run shows Linux serial output after explicit serial routing and optimized
  TCI build settings.  Follow-up runs should now measure post-kernel-entry
  progress, timer behavior, and initramfs handoff.

Non-goals:
  No wasm TCG/JIT backend implementation.

WASM-016c: Build a profiling-symbol wasm diagnostic variant
-----------------------------------------------------------

Scope:
  Add or document a debug-only build variant that keeps enough wasm function
  names or source information to map Node.js ``wasm-function[...]`` frames to
  QEMU source during assertion failures.

Touches:
  Build documentation, optional CI helper flags, and artifact-handling notes.

Proof:
  A known assertion or forced abort can be mapped to a QEMU function/source
  location from the generated wasm artifacts.

Non-goals:
  No requirement that release artifacts carry full debug names.

WASM-016d: Audit Emscripten event notifier path
-----------------------------------------------

Scope:
  Explain and, if needed, replace the POSIX ``g_unix_open_pipe`` notifier path
  that currently emits ``__syscall_pipe2`` warnings under Node.js.

Touches:
  ``util/event_notifier-posix.c`` or an Emscripten-specific notifier backend,
  plus main-loop proof.

Proof:
  The Node.js ``--version`` smoke test starts without unsupported ``pipe2``
  warnings, the boot path no longer emits unsupported pipe warnings, and
  normal POSIX builds still use the existing GLib pipe helper.  Emscripten
  signal handling is documented as a no-op host boundary, not as a pipe-backed
  signalfd emulation.

Non-goals:
  No browser networking implementation.

WASM-016g: Remove generic startup pipe2 warning
-----------------------------------------------

Scope:
  Find and replace the remaining ``pipe2`` call path that appears during
  generic Emscripten system-mode startup.  The reproducer is smaller than a
  Linux boot and should be used before guest debugging:
  ``-M none -nodefaults -nographic -S``.

Touches:
  Host runtime, main-loop, chardev, GLib integration, or Emscripten-specific
  platform glue as identified by the diagnostic.

Proof:
  The ``-M none`` startup smoke test and the 64-bit Linux boot smoke both start
  without ``__syscall_pipe2`` warnings, while normal POSIX builds keep their
  existing close-on-exec pipe behavior.

Non-goals:
  No guest boot-progress fix, networking, graphics, or browser storage work.

WASM-016h: Add verified Emscripten diagnostic link flags
--------------------------------------------------------

Scope:
  Provide a repeatable way to build temporary QEMU/WASM diagnostic artifacts
  with explicit Emscripten link flags such as ``-sSYSCALL_DEBUG=1`` and prove
  that those flags reach the final generated JavaScript/WebAssembly output.

Touches:
  Build documentation, optional CI helper scripts, or an Emscripten diagnostic
  cross-file variant.

Proof:
  A diagnostic build produces artifacts whose JavaScript visibly contains the
  requested diagnostic support, whose SHA-256 differs from the non-diagnostic
  artifact for a known reason, and whose minimal ``-M none`` startup output
  provides more detail than the plain unsupported-syscall warning.

Non-goals:
  No permanent debug flags in release artifacts.

WASM-016i: Diagnose pthread-worker pipe2 warning
------------------------------------------------

Scope:
  Keep QEMU's Emscripten-only strong ``__syscall_pipe2`` override small and
  maintainable.  The override avoids Emscripten's weak unsupported-syscall
  warning for GLib main-context wakeups by delegating to Emscripten's existing
  ``__syscall_pipe`` path and then applying supported ``pipe2`` flags.

Touches:
  Emscripten diagnostic build flags, GLib integration, pthread startup,
  QEMU thread creation, or library wakeup paths as identified by the next
  diagnostic.

Proof:
  The standalone GLib diagnostic produces no ``__syscall_pipe2`` warning, the
  Emscripten configure check passes, the rebuilt wasm64 TCI artifact hashes
  change, ``strings`` no longer finds the unsupported ``pipe2`` warning in the
  wasm module, the Node.js ``--version`` smoke passes, and the minimal startup
  reproducer times out without the previous warning.

Non-goals:
  No guest boot-progress fix, networking, graphics, or browser storage work.

WASM-016j: Diagnose Firefox browser guest progress
--------------------------------------------------

Scope:
  Explain why Firefox reaches early Linux kernel output but does not reach the
  smoke initramfs marker with the same wasm64 TCI artifact, guest inputs, CPU
  model, memory size, and kernel command line that pass under Chromium and
  Node.js.

Touches:
  Browser smoke diagnostics, bounded serial-output capture, kernel
  command-line probes, Firefox JavaScript/WebAssembly runtime behavior, QEMU
  timer/interrupt progress, and only the Emscripten/browser host glue needed
  to identify the difference.

Proof:
  The diagnosis either makes Firefox reach ``QEMU_WASM_LINUX_BOOT_OK`` with
  the canonical smoke guest or records a concrete Firefox-specific blocker
  with browser version, command, result JSON, final page status, serial-output
  tail, and the QEMU subsystem or browser runtime behavior implicated by the
  stall.  Current evidence has already ruled out missing cross-origin
  isolation, failed resource loading, marker predicate mismatch, memory size
  at ``512M`` versus ``256M``, CPU model simplification to ``qemu64``, and
  kernel argument forwarding.  A Firefox run with broad x86 mitigations and
  page-table isolation disabled still timed out before ``Run /init``, so that
  mitigation path is not sufficient to explain the gap.  A ``900000`` ms
  baseline run also timed out, which rules out the original ``420000`` ms
  timeout as the primary explanation.  The sampled Firefox baseline reached
  ``random: crng init done`` at roughly ``342`` seconds and then emitted no
  more serial lines before timeout.  A timer-parameter probe with
  ``nohz=off highres=off clockevents.no_timer_check=1`` did not change that
  timeout shape, but the guest reported ``nohz=off`` and ``highres=off`` as
  unknown parameters, so future timer probes must first verify accepted kernel
  parameters.  A ``nosmp maxcpus=1`` probe changed the guest CPU/interrupt
  setup path but still timed out after ``random: crng init done``.
  A Firefox ``142.0.1`` probe with QEMU arguments ``-icount
  shift=auto,align=off,sleep=off`` also timed out after ``420000`` ms.  It
  recorded ``crossOriginIsolated: true`` and no progress-sample errors, but
  stalled earlier than the baseline at ``x86/fpu: x87 FPU will use FXSAVE``
  after roughly ``282`` seconds.  That QEMU timer mode is therefore not a
  Firefox fix for the current wasm64 TCI smoke guest.

Non-goals:
  No requirement to support Firefox in the first accepted MVP if Chromium is
  selected as the initial browser target by maintainers.

WASM-016e: Define canonical TCI smoke-boot command line
-------------------------------------------------------

Scope:
  Update the smoke-boot recipe so it uses the command-line details proven by
  the wasm64 TCI diagnostics.

Touches:
  Test harness documentation, boot-test command construction, and CI notes.

Proof:
  The documented command line uses ``-M microvm,acpi=off`` with APIC enabled,
  ``-serial mon:stdio`` for marker capture, an optimized TCI build for
  runtime tests, mounted ``qboot.rom`` and ``linuxboot_dma.bin`` firmware, and
  explicit timer/calibration arguments when the smoke guest needs them.
  ``scripts/ci/wasm-linux-boot-smoke.mjs`` provides the same profile as a
  repeatable Node.js smoke wrapper.

Non-goals:
  No product-specific Bus Engine OS arguments in upstream QEMU.

WASM-016f: Diagnose post-early-kernel TCI progress
--------------------------------------------------

Scope:
  Explain why the optimized wasm64 TCI run reaches Linux early boot but does
  not reach the initramfs marker within the current bounded timeout.

Touches:
  Kernel command-line experiments, QEMU timer/interrupt traces, serial log
  capture, and optional smoke guest changes.

Proof:
  The passing run reaches ``QEMU_WASM_LINUX_BOOT_OK`` under Node.js ``v24``
  with the cleaned wasm64 TCI artifact.  The failed ``noapic nolapic`` probe
  is documented as an invalid smoke baseline because native QEMU with the same
  profile also reaches ``Run /init`` without printing the marker.

Non-goals:
  No native WebAssembly TCG backend implementation.

WASM-017: Choose upstream smoke guest
-------------------------------------

Scope:
  Select or build a tiny Linux guest suitable for QEMU upstream testing.

Touches:
  Test documentation and optional artifact builder.

Proof:
  The initramfs builder produces deterministic output from an explicit
  statically linked BusyBox input, and the generated archive reaches the
  readiness marker under native QEMU and wasm64 TCI.  The pinned x86_64
  TuxBoot kernel already used by QEMU functional tests also reaches the
  marker under native QEMU and wasm64 TCI.  The builder can also create a
  deterministic dynamic-library initramfs from the existing TuxBoot rootfs
  BusyBox and its required uClibc and ``libtirpc`` files; that dynamic archive
  reaches the marker under native QEMU and wasm64 TCI with the same
  ``Nehalem`` CPU model used by QEMU's x86_64 TuxRun functional test.
  CI wiring now downloads or reuses the pinned TuxBoot assets with SHA-256
  verification and caches them under the smoke jobs.  Remaining work is
  maintainer acceptance and update policy for the pinned TuxBoot
  kernel/rootfs assets.

Non-goals:
  Bus Engine OS is not bundled into upstream QEMU tests.

Guest input policy:
  The upstream QEMU smoke guest must stay product-neutral.  It may use QEMU's
  existing functional-test asset model for downloaded inputs, but it must not
  depend on the developer host's ``/boot`` directory or on Bus Engine OS
  artifacts.  A local host kernel or ``/usr/bin/busybox`` is acceptable for
  manual diagnostics only, because those inputs are not reproducible across
  CI runners.

  The preferred kernel candidate is the x86_64 TuxBoot ``bzImage`` already
  pinned by ``tests/functional/x86_64/test_tuxrun.py``.  If that kernel boots
  with the generated initramfs and the WASM smoke wrapper, reuse its
  ``qemu_test.Asset`` URL and SHA-256 rather than introducing another x86_64
  Linux binary.

  The preferred initramfs path is to generate it during the smoke job with
  ``scripts/ci/wasm-build-smoke-initramfs.py`` from explicit guest input
  files.  A static BusyBox input is sufficient when available.  A dynamic
  BusyBox input is also supported when the smoke job provides the matching
  loader, shared libraries, and symlinks explicitly.

  The existing TuxBoot x86_64 rootfs asset provides a working dynamic BusyBox
  source when bundled with its required uClibc and ``libtirpc`` files.  This
  keeps the smoke guest on the same pinned x86_64 TuxBoot asset family already
  used by QEMU's functional tests.

WASM-017a: Prove TuxBoot kernel with generated initramfs
-------------------------------------------------------

Scope:
  Replace the local ``/boot/vmlinuz-7.1.0`` proof input with the existing
  x86_64 TuxBoot kernel asset candidate and the generated smoke initramfs.

Touches:
  Smoke-test documentation, optional fetch helper, and CI notes.

Proof:
  Native QEMU and the Node.js ``v24`` wasm64 TCI wrapper both reached
  ``QEMU_WASM_LINUX_BOOT_OK`` using the TuxBoot ``bzImage`` and the generated
  initramfs.

Non-goals:
  No Bus Engine OS root filesystem, browser UI, networking, or native
  WebAssembly TCG backend work.

WASM-017b: Choose static or dynamic BusyBox input
------------------------------------------------

Scope:
  Resolve the remaining initramfs input source for upstream CI.

Touches:
  Smoke-test documentation, initramfs builder options, optional asset fetch
  helper, and CI notes.

Proof:
  The initramfs builder gained an explicit dynamic-library bundle mode that
  can use the existing TuxBoot rootfs BusyBox plus its required uClibc and
  ``libtirpc`` files.  The selected path reaches
  ``QEMU_WASM_LINUX_BOOT_OK`` under native QEMU and wasm64 TCI when run with
  ``--cpu Nehalem``.

Non-goals:
  No full TuxBoot rootfs boot, package manager, networking, browser UI, or
  Bus Engine OS artifact work.

WASM-017c: Wire pinned TuxBoot assets into WASM smoke CI
-------------------------------------------------------

Scope:
  Add product-neutral CI or test harness wiring that fetches the existing
  pinned x86_64 TuxBoot kernel and rootfs assets, extracts the dynamic BusyBox
  closure, builds the smoke initramfs, and runs the Node.js WASM Linux boot
  wrapper.

Touches:
  CI configuration, optional asset-fetch helper, smoke-test documentation, and
  cache/update notes.

Proof:
  A CI-shaped command path downloads or reuses cached TuxBoot assets by URL
  and SHA-256, generates the dynamic initramfs, and reaches
  ``QEMU_WASM_LINUX_BOOT_OK`` under Node.js ``v24`` with the wasm64 TCI
  artifact.

Current status:
  ``scripts/ci/wasm-prepare-tuxboot-smoke-guest.py`` provides the reusable
  command path.  ``smoke-wasm64-64bit-linux`` wires it into an optional
  GitLab test job that consumes ``build-wasm64-64bit`` artifacts.  The job
  shape was locally reproduced in the rebuilt wasm64 CI image and reached the
  readiness marker.

Non-goals:
  No new guest binary source, Bus Engine OS artifact, browser UI, networking,
  or native WebAssembly TCG backend work.

WASM-017d: Provide a Node 24+ smoke runtime image
------------------------------------------------

Scope:
  Make the GitLab smoke runtime explicit before enabling a wasm Linux boot
  job.

Touches:
  The wasm CI container definition or a separate CI smoke job image, plus
  documentation of required runtime tools.

Proof:
  The selected CI smoke runtime reports Node.js ``v23.0.0`` or newer and has
  ``python3``, ``zstd``, and ``debugfs`` available.  It can run
  ``scripts/ci/wasm-prepare-tuxboot-smoke-guest.py`` and then
  ``scripts/ci/wasm-linux-boot-smoke.mjs`` against artifacts from
  ``build-wasm64-64bit``.

Current status:
  The wasm64 CI image now carries a checksum-verified Node.js ``v24.18.0``
  runtime at ``/opt/node-qemu-wasm-smoke`` plus ``zstd``.  The default
  Emscripten Node.js remains first on the image ``PATH`` until a smoke job
  explicitly exports the Node.js ``v24`` runtime.  A local rebuild and smoke
  run proved the helper and Linux boot wrapper in that image.

Non-goals:
  No browser UI, native WebAssembly TCG backend, networking, or graphics work.

WASM-018: Add Bus Engine OS downstream proof recipe
--------------------------------------------------

Scope:
  Document how downstream Bus Engine can provide kernel/rootfs artifacts to
  the generic QEMU browser harness, then use that recipe as the product proof
  path for a Bus Engine OS browser preview.

Touches:
  Downstream documentation and Bus Engine OS build/profile configuration only,
  outside upstream QEMU if implemented.  Upstream QEMU may only receive generic
  harness improvements that are useful for any 64-bit Linux guest.

Proof:
  The QEMU side remains product-neutral.  Downstream Bus Engine produces a
  64-bit Bus Engine OS kernel/rootfs or disk image, runs it through the generic
  browser QEMU harness in Chromium or Chrome, reaches a deterministic serial
  readiness marker, proves expected serial identity text, and captures a
  browser preview suitable for a ``busdk.com/engine/`` screenshot-like or
  live-preview item.

Current status:
  Bus Engine OS currently documents ``bus engine os build image`` as the normal
  full-system build command and ``virtual-server`` as the accepted
  console-oriented QEMU image profile.  The first downstream proof should
  consume that x86_64 profile, or a browser-hosted derivative with the same
  console-first boundary, and define the artifact handoff as kernel image,
  root filesystem or raw disk, firmware inputs, checksums, boot arguments,
  memory size, CPU model, readiness marker, and expected serial identity text.
  The QEMU-side generic handoff format is now ``--guest-manifest FILE`` for
  the Node and browser smoke runners.  Bus Engine OS should generate or export
  such a manifest with product-owned artifacts and a Bus Engine OS readiness
  marker plus expected serial identity text; QEMU should keep validating the
  manifest only as generic guest input metadata.
  The expected downstream build command is
  ``bus engine os build image --profile virtual-server``.  Bus Engine OS
  selects the host architecture by default, so x86_64 browser-hosted artifacts do
  not require an explicit ``--target-arch`` on an x86_64 build host.  The
  downstream artifact export should provide the kernel, raw root filesystem or
  disk image, checksums, kernel arguments, machine model, rootfs device mode,
  marker, and expected serial identity text as a manifest or equivalent
  machine-readable bundle.
  An accepted x86_64 ``virtual-server`` artifact set was consumed from Docker
  volume ``bus-engine-os-x86_64-minimal-qemu-20260629T051004Z-4062057`` and
  copied to ``/tmp/bus-engine-os-wasm-proof``.  The copied artifacts were
  ``bzImage`` SHA-256
  ``b37cc4f821877ef34d468eeb9504fb6c0738114cff9bb18e030d88a2f4b76943`` and
  ``rootfs.raw`` SHA-256
  ``6d2222e0f5c8a1ff2d40808e682ffa5f0995e53c28a0f0af98ed0a96c9d49eae``.
  The accepted native QEMU metadata for that image used kernel arguments
  ``console=ttyS0 root=/dev/vda rw`` and the ``virtual-server`` profile with
  27 existing runtime packages.

  Node.js ``v24`` first proved the artifact could reach the Bus Engine OS
  kernel identity text under QEMU/WASM.  A second Node run with
  ``--kernel-append 'console=ttyS0 root=/dev/vda rw'``, ``--machine pc``,
  ``--rootfs-device virtio-pci``, and ``--qemu-arg -nic --qemu-arg none``
  reached ``Run /sbin/init as init process`` while requiring
  ``bus@bus-engine-os`` as expected serial text.  A Chromium ``141.0.7390.37``
  run with the same artifact and options reached the same init handoff marker
  in ``130611`` ms, recorded ``crossOriginIsolated: true``, no request
  failures, no page errors, ``258`` serial lines, and wrote a ``1280x720``
  screenshot at ``/tmp/bus-engine-os-wasm-proof/chromium-bus-engine-os.png``.
  A Node.js probe for ``Reached target Login Prompts`` without networking did
  not reach that target before the ``300000`` ms timeout, but it did emit
  userspace identity evidence: ``systemd 261.1``,
  ``Welcome to Bus Engine OS 0.1.0``, and hostname ``bus-engine-os``.  A
  Chromium ``141.0.7390.37`` run then used ``Bus Engine OS 0.1.0`` as the
  readiness marker and required both ``bus@bus-engine-os`` and
  ``systemd 261.1`` as expected serial text.  It reached the marker in
  ``145651`` ms, recorded ``crossOriginIsolated: true``, no request failures,
  no page errors, ``268`` serial lines, and wrote a ``1280x720`` screenshot at
  ``/tmp/bus-engine-os-wasm-proof/chromium-bus-engine-os-userspace.png``.
  This is an accepted browser userspace-identity proof for the downstream
  artifact.  It is not yet a full browser multi-user proof because the
  no-network run did not reach the login prompt target before timeout.

Non-goals:
  No Bus-specific source code in upstream QEMU.  No requirement for WebGPU,
  graphical desktop, production networking, durable browser storage, or package
  builds inside the browser.

WASM-019: Design native wasm64 TCG backend
------------------------------------------

Scope:
  Write the backend design before code: register model, helper-call ABI,
  memory model, TB format, module instantiation, invalidation, threading,
  fallback, and test coverage.

Touches:
  Design docs only.

Proof:
  The design references QEMU TCG requirements and compares the experimental
  ``tcg/wasm64`` approach without copying it blindly.

Non-goals:
  No backend code in the design task.

WASM-020: Add wasm64 TCG build skeleton
---------------------------------------

Scope:
  Add only enough build plumbing for a future ``tcg/wasm64`` backend to be
  selected.

Touches:
  ``tcg/meson.build`` and related build files.

Proof:
  The skeleton either compiles with placeholder-disabled behavior or is gated
  behind an explicit unavailable option.

Non-goals:
  No instruction lowering.

WASM-021: Implement wasm64 TCG arithmetic subset
------------------------------------------------

Scope:
  Lower basic integer operations needed by tests.

Touches:
  Future ``tcg/wasm64`` backend files.

Proof:
  TCG backend unit tests pass for arithmetic operations.

Non-goals:
  No Linux boot requirement in this task.

WASM-022: Implement wasm64 TCG branches and calls
-------------------------------------------------

Scope:
  Lower control-flow operations, helper calls, and exits.

Touches:
  Future ``tcg/wasm64`` backend files.

Proof:
  Backend tests pass for branches, calls, helper returns, and TB exits.

Non-goals:
  No full memory subsystem.

WASM-023: Implement wasm64 TCG guest memory access
--------------------------------------------------

Scope:
  Lower loads, stores, TLB lookup, and fault paths.

Touches:
  Future ``tcg/wasm64`` backend files and TCG load/store integration.

Proof:
  Backend tests pass for loads, stores, and guest memory faults.

Non-goals:
  No multi-threaded TCG.

WASM-024: Implement wasm64 TCG TB lifecycle
-------------------------------------------

Scope:
  Handle translation block allocation, instantiation, caching, invalidation,
  and flushing for browser WebAssembly modules.

Touches:
  Future ``tcg/wasm64`` backend files and TCG region integration.

Proof:
  A long-running smoke test does not leak unbounded translation state and can
  invalidate modified code paths.

Non-goals:
  No performance tuning beyond correctness.

WASM-025: Add native TCG Linux boot proof
-----------------------------------------

Scope:
  Re-run the serial Linux smoke test with native wasm64 TCG.

Touches:
  Test and CI configuration.

Proof:
  The same readiness marker appears with native wasm64 TCG and with TCI.

Non-goals:
  No performance claims without measured data.

WASM-026: Add structured browser startup logs
---------------------------------------------

Scope:
  Make failures understandable across QEMU startup, artifact loading, guest
  boot, and shutdown.

Touches:
  Harness and QEMU logging integration as needed.

Proof:
  A missing kernel, missing rootfs, unsupported browser feature, and guest
  timeout each produce different messages.

Current status:
  The browser page now records ``qemuWasmSmokeState.phase`` and a
  ``qemuWasmSmokeState.phases`` timeline for feature validation, guest input
  loading, QEMU module import, QEMU startup, guest boot, timeout, early QEMU
  exit, success, and page-level failure.  The runner now exits promptly when
  the page reports ``failed`` or ``timeout waiting...``.  The runner also
  promotes the browser state summary into top-level JSON fields including
  ``phase``, ``failurePhase``, ``phases``, ``markerSeen``,
  ``expectedTextSeen``, ``programExitStatus``, ``outputLines``,
  ``outputBytes``, ``outputSuppressed``, ``lastLine``, ``qemuCommand``, and
  ``smokeUrl`` so CI artifacts can be inspected without parsing the full page
  text.  ``phase`` is the terminal page state, while ``failurePhase`` records
  the startup phase that was active before a page-level failure.  The
  runner also has an opt-in serial-idle watchdog via ``--idle-timeout-ms``.
  It classifies repeated progress samples with unchanged serial output as an
  ``idleTimeout`` result summary, which lets Chrome/Chromium stall probes fail
  with the last serial line and idle duration instead of only a generic marker
  timeout.  The
  remaining proof work is to run the negative cases under Chromium or Chrome
  and preserve the resulting JSON artifacts.
  ``wasm-browser-smoke-runner-test.mjs`` provides deterministic coverage for
  the terminal page-status predicate that decides when those result artifacts
  should be captured, and for the result-promotion helper that makes the page
  state visible at top level in the JSON artifact.

Non-goals:
  No product-specific telemetry.

WASM-027: Define QMP browser bridge
-----------------------------------

Scope:
  Design a JavaScript-accessible QMP bridge after serial boot works.

Touches:
  Design docs first; QMP/chardev transport later.

Proof:
  The design preserves QMP JSON semantics and does not describe QMP as REST.

Non-goals:
  QMP is not required for MVP boot.

WASM-028: Add QMP query-status proof
------------------------------------

Scope:
  Prove the browser QMP bridge with ``query-status`` and controlled shutdown.

Touches:
  QMP transport and tests.

Proof:
  The browser test can query status and stop QEMU without serial-console
  commands.

Non-goals:
  No downstream QMP extensions.

WASM-029: Document no-network MVP
---------------------------------

Scope:
  State that the initial browser target runs with networking disabled.

Touches:
  Browser smoke harness, runner, manifest-compatible options, and
  documentation.

Proof:
  MVP examples omit network devices unless explicitly testing networking.

Current status:
  The browser smoke page and Playwright runner default to ``network=none`` and
  append ``-nic none`` to the generated QEMU command line.  The runner exposes
  ``--network none|default`` for later networking probes and records the
  selected mode in result JSON.  The page also stores the exact generated QEMU
  argv in ``qemuWasmSmokeState.qemuArgs``, and the runner promotes that array
  to top-level ``qemuCommand`` in result JSON.  The deterministic
  ``wasm-browser-smoke-args-test.mjs`` test verifies that the generated
  command uses ``-nic none`` by default and omits it only for
  ``network=default``.  A follow-up Chromium or Chrome run should preserve a
  result artifact proving the default no-network command line still reaches
  the expected serial marker.

Non-goals:
  No TAP, slirp, arbitrary TCP, or UDP support.

WASM-030: Design staged browser networking
------------------------------------------

Scope:
  Plan fetch-proxy and WebSocket-delegate networking without making it MVP.

Touches:
  Design docs.

Proof:
  CORS, forbidden headers, and raw-socket limitations are documented.

Non-goals:
  No production networking promise.

WASM-031: Add opt-in browser SDL/canvas harness path
----------------------------------------------------

Scope:
  Add an opt-in browser display mode and deterministic keyboard sender that
  expose a focusable canvas to the Emscripten module while preserving the
  serial-console boot marker path.

Touches:
  ``scripts/ci/wasm-browser-smoke.html``,
  ``scripts/ci/wasm-browser-smoke.mjs``,
  ``scripts/ci/wasm-browser-smoke-runner.mjs``,
  ``scripts/ci/wasm-browser-smoke-args-test.mjs``, and
  ``scripts/ci/wasm-browser-smoke-runner-test.mjs``.

Proof:
  Deterministic Node tests verify that the default browser smoke command still
  uses ``display=none`` with ``-nographic`` and ``-serial mon:stdio``, while
  opt-in ``display=sdl`` removes ``-nographic``, adds
  ``-display sdl,gl=off``, exposes a canvas, and keeps serial output available
  for the boot marker.  The runner also accepts ``--keyboard-text`` only with
  ``display=sdl``, can wait for guest serial output using
  ``--keyboard-after-text``, focuses the canvas, types through Playwright, and
  records non-secret keyboard-input evidence in the result JSON.  The generic
  guest manifest also accepts display/input metadata for the same opt-in path:
  ``display``, ``displayDevice``, ``expectedResolution``, ``keyboardText``,
  ``keyboardAfterText``, ``visualMarker``, ``screenshot``,
  ``screenshotFullPage``, ``requireDisplayOutput``,
  ``displayMinNonblackPixels``, ``focusDisplay``, and
  ``allowSerialFallback``.  Downstream proofs can therefore declare their
  graphics/input gate without product-specific QEMU code, and CLI arguments
  can still override manifest defaults for one-off diagnostics.

  The browser display surface has a minimal input policy for the opt-in SDL
  path.  Pointer-down focuses the canvas, focus and blur update smoke-state
  evidence, Escape releases focus back to the browser, common browser
  shortcuts such as Ctrl-L and Cmd-L are left to the browser, and navigation
  keys that normally scroll or move focus are prevented from escaping the
  focused canvas while still being delivered to SDL.  Paste events are captured
  as metadata and not silently treated as proven guest input.  Pointer lock is
  deliberately disabled for the MVP path.

Current status:
  The harness and runner plumbing is implemented.  Emscripten SDL2 was also
  verified as a viable wasm64 build dependency with ``-sUSE_SDL=2``: QEMU
  configured with ``SDL support: YES 2.32.0`` and compiled through the SDL 2D
  and input sources to the final link.  The accepted browser display/input
  path now uses the generic ``display=wasm`` backend described below.

Non-goals:
  No claim that a guest has rendered a frame until a Chrome/Chromium graphics
  proof captures the canvas output.

WASM-032: Prove framebuffer-to-canvas display output
----------------------------------------------------

Scope:
  Prove that the selected QEMU display path can produce browser-visible 2D
  output in Chrome/Chromium.

Touches:
  Browser smoke harness, QEMU display arguments, and result artifacts.

Proof:
  A generic Linux or tiny graphical guest produces a stable visible marker on
  the browser canvas, the harness captures screenshot evidence, and the
  existing serial marker still proves the guest boot path.

Current status:
  The browser smoke runner can now sample the opt-in SDL canvas and record
  display evidence in result JSON: canvas presence, dimensions, visibility,
  focus state, non-zero pixel count, non-transparent pixel count, non-black
  pixel count, total pixels, context type, and a ``fnv1a32`` pixel hash.  The
  sampler supports 2D canvases and WebGL-backed SDL canvases.  The
  ``--require-display-output`` runner option turns that evidence into an
  explicit non-black-pixel gate for ``display=sdl`` runs.  The default
  ``display=none`` smoke path still uses the serial marker as its only success
  oracle.

  A Chrome/Chromium run against the existing Bus Engine browser-hosted artifacts
  was captured in ``build/wasm-browser-proof/stdvga-webgl-sampler-result.json``
  with ``--display sdl --display-device stdvga --require-display-output``.
  That run reached QEMU startup and created the SDL canvas, but it did not
  reach the serial marker.  The display sampler observed a
  ``WebGLRenderingContext`` and zero non-black pixels.  The failure was an
  Emscripten WebGL context error:
  ``Cannot read properties of undefined (reading 'createShader')``.  This is
  consistent with a pthreaded SDL/WebGL build that lacks OffscreenCanvas
  transfer support.  The Emscripten cross file now enables
  ``-sOFFSCREENCANVAS_SUPPORT=1`` and ``-sOFFSCREEN_FRAMEBUFFER=1`` so rebuilt
  artifacts can transfer WebGL canvases to the pthreaded QEMU main loop.

  A rebuilt current artifact was produced under
  ``build/wasm-artifacts-display-current`` with SHA-256 values
  ``243cd2133934f3677b38a4c60795f35a81d90caeb5dcfaf42b9ef5d38c70de9b``
  for ``qemu-system-x86_64.js`` and
  ``69b471147626fc031416aca6f60c569c96eeb8d13f643142ad7242b968e0510c``
  for ``qemu-system-x86_64.wasm``.  The configure summary reported
  ``SDL support: YES 2.0.10`` and the link flags included
  ``-sOFFSCREENCANVAS_SUPPORT=1`` and ``-sOFFSCREEN_FRAMEBUFFER=1``.  Running
  that artifact in Chromium ``149.0.0.0`` against the Bus Engine OS browser-hosted
  inputs wrote ``build/wasm-browser-proof/display-current-result.json`` and
  ``build/wasm-browser-proof/display-current-page.png``.  It reached QEMU
  startup and created the focused SDL canvas, but the page reported
  ``InvalidStateError: Failed to execute 'getContext' on 'HTMLCanvasElement':
  Cannot get context from a canvas that has transferred its control to
  offscreen.``  No serial lines were emitted before timeout.

  A temporary generated-JavaScript probe changed the Emscripten default
  transferred canvas set from ``#canvas`` to empty in
  ``build/wasm-artifacts-display-no-transfer``.  This is not a source fix, but
  it separated the two failure modes.  The corresponding Chromium run wrote
  ``build/wasm-browser-proof/display-no-transfer-result.json`` and
  ``build/wasm-browser-proof/display-no-transfer-page.png``.  It avoided the
  transferred-canvas ``getContext`` exception, drew into the browser page
  through a ``WebGLRenderingContext``, and recorded non-zero/non-transparent
  display pixels, but then the pthread reported
  ``RuntimeError: operation does not support unaligned accesses`` through a
  ``dynCall_vfi`` trampoline before guest serial boot progressed.  The next
  implementation step is therefore a source-level wasm64 SDL/canvas ownership
  fix that avoids both the eager canvas-transfer context failure and the
  no-transfer pthread unaligned-access trap.

  A follow-up implementation moved the browser proof path away from SDL by
  adding a generic ``-display wasm`` backend.  The backend is Emscripten-only,
  registers a QEMU display listener, copies 2D display surfaces into RGBA, and
  presents them through a browser 2D canvas.  The browser smoke harness accepts
  ``display=wasm``, keeps ``display=none`` as the default serial gate, and maps
  focused canvas keyboard events to QEMU Linux key events through an exported
  Emscripten symbol.  A wasm64 container build reached the
  ``qemu-system-x86_64.js`` final link and produced
  ``build/wasm-artifacts-wasm-display-check`` with SHA-256 values
  ``2084cbf630360a60f2ad8c8536006ebec3af0b9c3cf32dfe3133bbf968617dc7`` for
  ``qemu-system-x86_64.js`` and
  ``eb64b63a5e6980df5a66de156a4371ce34931dc6aff7bc04f726798279c7b37a`` for
  ``qemu-system-x86_64.wasm``.

  The optimized rebuilt artifact with the ``display=wasm`` backend preserved
  the default serial regression gate when run with the accepted Bus Engine OS
  browser-hosted command shape.  The artifact was produced from the current
  branch in ``/tmp/qemu-wasm-opt-src`` without ``--enable-debug`` and copied
  to ``build/wasm-artifacts-wasm-display-optimized``.  Its SHA-256 values are
  ``f0cd3996a1139a697fddc76bd58a90b967e6565ee4e5f3edbd23fdd72b7ecd89`` for
  ``qemu-system-x86_64.js`` and
  ``605bb9ebcd71e0febb79864d8f91091673547941265aadb692d1331b2f356287`` for
  ``qemu-system-x86_64.wasm``.  A Chromium ``141.0.7390.37`` run with
  ``display=none``, ``--machine pc``, ``--rootfs-device virtio-pci``,
  ``--kernel-append 'console=ttyS0 root=/dev/vda rw'``, the Bus Engine OS
  ``bzImage`` SHA-256
  ``b37cc4f821877ef34d468eeb9504fb6c0738114cff9bb18e030d88a2f4b76943``, and
  ``rootfs.raw`` SHA-256
  ``6d2222e0f5c8a1ff2d40808e682ffa5f0995e53c28a0f0af98ed0a96c9d49eae``
  reached marker ``bus@bus-engine-os`` and the expected ``systemd 261.1`` text
  in ``148901`` ms.  The run wrote
  ``build/wasm-browser-proof-current/default-serial-optimized-worker-canvas-result.json``
  and
  ``build/wasm-browser-proof-current/default-serial-optimized-worker-canvas-page.png``.
  It recorded ``crossOriginIsolated: true``, no page errors, no request
  failures, and ``263`` serial lines.  The screenshot SHA-256 was
  ``3e4cd507987aea57cf63722daaf20d327333d02304786eebf81f7aa372a11a5f``.

  The same optimized artifact also passed the opt-in browser display proof
  using ``display=wasm`` and ``-vga std``.  A Chromium ``141.0.7390.37`` run
  with ``--require-display-output`` reached marker ``bus@bus-engine-os`` and
  ``systemd 261.1`` in ``154241`` ms.  It wrote
  ``build/wasm-browser-proof-current/wasm-display-optimized-worker-canvas-result.json``
  and
  ``build/wasm-browser-proof-current/wasm-display-optimized-worker-canvas-page.png``.
  The result recorded an active ``720x400`` 2D browser canvas, backend
  ``wasm``, ``10599`` display frames, pixel hash ``fnv1a32:fbea30fd``,
  ``2175`` non-black pixels, ``288000`` non-transparent pixels, no page
  errors, no request failures, and ``263`` serial lines.  This proves the
  generic QEMU/WASM canvas backend can receive QEMU display surface updates
  from an emulated VGA device while the downstream Bus Engine OS serial marker
  remains reachable.  The screenshot SHA-256 was
  ``9bb9d7e95195b31016c56949f2b1dba19450b54b5c6c5cae243c19b85d28ac4d``.

  A keyboard-hook proof using the same artifact, ``display=wasm``, ``-vga
  std``, ``--focus-display``, ``--keyboard-after-text 'systemd 261.1'``, and
  ``--keyboard-text 'help\n'`` also reached marker ``bus@bus-engine-os``.  It
  wrote ``build/wasm-browser-proof-current/wasm-display-keyboard-hook-result.json``
  and ``build/wasm-browser-proof-current/wasm-display-keyboard-hook-page.png``.
  The result recorded ``12`` delivered key events through the focused browser
  canvas and exported QEMU input hook, plus ``2157`` non-black display pixels.
  This proves browser-to-QEMU key delivery metadata.

  A later downstream Bus Engine OS run with the committed ``display=wasm``
  artifact used ``console=tty0 console=ttyS0 root=/dev/vda rw`` to make the
  virtual VGA console visible while preserving serial diagnostics.  Chromium
  ``141.0.7390.37`` ran with ``display=wasm``, ``-vga std``,
  ``--focus-display``, ``--keyboard-after-text 'bus@bus-engine-os'``, and
  ``--keyboard-text 'help\n'``.  It reached the configured marker in
  ``160347`` ms and wrote
  ``build/wasm-browser-proof-current/bus-engine-os-display-input-tty0-qkbd-result.json``
  and
  ``build/wasm-browser-proof-current/bus-engine-os-display-input-tty0-qkbd-page.png``.
  The screenshot SHA-256 was
  ``5c8f25f6ead4eda149603fd4e95ddc6f608e379ba65b8ded2a5ede12188aa8ed`` and
  the result JSON SHA-256 was
  ``345c41412083d855cf4cab562963a5cf3975b727408fec5cbe40a346d5a9d7c3``.
  The browser canvas was active and focused at ``720x400`` with pixel hash
  ``fnv1a32:5ca46c9d`` and ``26161`` non-black pixels.  QEMU reported the
  focused canvas key sequence as ``received=12``, ``dropped=0``,
  ``drained=12``, and ``sent=12``.

  That run is still partial downstream evidence.  The string
  ``bus@bus-engine-os`` appears in the kernel compiler identity, so it is too
  weak to use as a userspace-readiness marker by itself.  The result did not
  show guest-visible output from the typed ``help`` sequence.  The current Bus
  Engine OS browser artifact remains a serial-first runtime; completing the
  downstream graphics/input proof needs either a VGA/tty getty, a graphical
  profile, or another guest-visible input test path in the Bus Engine OS
  artifact.

  Deterministic browser harness coverage now exercises the same focusable
  display surface without launching QEMU.  A Chromium ``141.0.7390.37`` run
  used ``--harness-self-test``, ``--display wasm``, ``--keyboard-text
  'ab\n'``, ``--harness-expected-key-events 6``, and ``--expect-display-hash
  fnv1a32:2a8cd5c5``.  It wrote
  ``/tmp/qemu-wasm-harness-proof/harness-self-test-hash-result.json`` and
  ``/tmp/qemu-wasm-harness-proof/harness-self-test-hash-page.png``.  The
  browser captured a ``64x32`` 2D canvas, stable pixel hash
  ``fnv1a32:2a8cd5c5``, ``1280`` non-black pixels, ``2048``
  non-transparent pixels, and six structured key events:
  ``KeyA`` down/up as Linux key ``30``, ``KeyB`` down/up as Linux key ``48``,
  and Enter down/up as Linux key ``28``.  This closes the deterministic
  display and keyboard harness coverage gaps while keeping guest-visible boot
  proofs separate from browser-side harness self-tests.

  A generic Linux guest-visible display/input proof passed with the rebuilt
  ``display=wasm`` artifact in
  ``build/wasm-artifacts-wasm-display-qkbd-20260630T192949Z-3665554``.  The
  artifact SHA-256 values are
  ``eb9b11953222b2d0ac271220a82ef6c94c28ec03c7964d8959f2c2ac174d1b8f`` for
  ``qemu-system-x86_64.js`` and
  ``37b1933264ea0c85d4e18ebd82478838912e51d7c3d0e04724b199db733572ea`` for
  ``qemu-system-x86_64.wasm``.  Chromium ``149.0.7827.55`` ran
  ``display=wasm`` with ``-vga std``, ``--focus-display``,
  ``--keyboard-after-text QEMU_WASM_LINUX_INPUT_READY``, and
  ``--keyboard-text 'ab\n'`` against the local ``/boot/vmlinuz-7.1.0``
  kernel.  The display/input initramfs SHA-256 was
  ``6b619902c9abfb76ff66d8d693fec8ea067cd615ee64686bfe4ac3d690fb5a0f`` and
  the kernel SHA-256 was
  ``5e701f3daaaff8f36a235d55d6f68a18a747b39f7b435cca5894a2d9e7a7f1d3``.
  The run wrote
  ``build/wasm-browser-proof-current/generic-display-input-qkbd-result.json``
  and
  ``build/wasm-browser-proof-current/generic-display-input-qkbd-page.png``.
  It reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``103029`` ms, observed expected
  serial text ``QEMU_WASM_LINUX_INPUT_TEXT:ab\n``, recorded a focused
  ``720x400`` 2D canvas, ``7141`` display frames, pixel hash
  ``fnv1a32:04d5901d``, ``861`` non-black pixels, and six browser key events
  that QEMU reported as ``received=6``, ``dropped=0``, ``drained=6``, and
  ``sent=6``.  This proves guest-visible keyboard input for the generic Linux
  smoke path, not merely browser-side hook invocation.

  The same rebuilt artifact preserved the mandatory default serial-console
  regression gate.  Chromium ``149.0.7827.55`` ran ``display=none`` with the
  serial initramfs SHA-256
  ``2a12aedec5fe8d3e0fa9eb5d8974f38d8dcf0fbc06d8e9f2c24f34fd45eae3b6`` and
  reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``97526`` ms.  That run wrote
  ``build/wasm-browser-proof-current/default-serial-qkbd-result.json`` and
  ``build/wasm-browser-proof-current/default-serial-qkbd-page.png``.

  A downstream Bus Engine OS browser run with the same rebuilt artifact passed
  the visible display and QEMU-side keyboard delivery gates.  The accepted
  Bus Engine OS artifacts were recovered from Docker volume
  ``bus-engine-os-x86_64-minimal-qemu-20260629T051004Z-4062057`` with the
  previously recorded SHA-256 values: ``bzImage``
  ``b37cc4f821877ef34d468eeb9504fb6c0738114cff9bb18e030d88a2f4b76943`` and
  ``rootfs.raw``
  ``6d2222e0f5c8a1ff2d40808e682ffa5f0995e53c28a0f0af98ed0a96c9d49eae``.
  Chromium ``149.0.7827.55`` ran ``display=wasm`` with ``-vga std``,
  ``--rootfs-device virtio-pci``, ``--kernel-append 'console=ttyS0
  root=/dev/vda rw'``, ``--keyboard-after-text 'systemd 261.1'``, and
  ``--keyboard-text 'help\n'``.  The run reached marker
  ``Bus Engine OS 0.1.0`` in ``143831`` ms and observed expected serial text
  ``systemd 261.1``.  It wrote
  ``build/wasm-browser-proof-current/bus-engine-os-display-keyboard-qkbd-result.json``
  and
  ``build/wasm-browser-proof-current/bus-engine-os-display-keyboard-qkbd-page.png``.
  The screenshot SHA-256 was
  ``3794ff2f92c64c2209a793544f7c16faba5aed5ca48b944a898e33079e9da20c``.
  The result recorded a focused ``720x400`` 2D canvas, backend ``wasm``,
  ``9977`` frames, pixel hash ``fnv1a32:fbea30fd``, ``2175`` non-black pixels,
  ten delivered browser key events, and QEMU key counters
  ``received=10``, ``dropped=0``, ``drained=10``, and ``sent=10``.  This proves
  the downstream Bus Engine OS browser-visible graphics path and QEMU-side
  input delivery.  That run did not prove a guest-visible response to the typed
  sequence, so the follow-up proof below uses a controlled shell handoff to
  exercise guest-visible keyboard input directly.

  A controlled downstream Bus Engine OS guest-visible keyboard proof now closes
  that input gap for the QEMU/WASM graphics path.  The run used the same
  accepted x86_64 Bus Engine OS kernel and rootfs artifacts as the earlier
  downstream proof: ``bzImage`` SHA-256
  ``b37cc4f821877ef34d468eeb9504fb6c0738114cff9bb18e030d88a2f4b76943`` and
  ``rootfs.raw`` SHA-256
  ``6d2222e0f5c8a1ff2d40808e682ffa5f0995e53c28a0f0af98ed0a96c9d49eae``.
  Chromium ``149.0.7827.55`` ran with ``display=wasm``, ``-vga std``,
  ``--rootfs-device virtio-pci``, and ``--kernel-append 'console=ttyS0
  console=tty0 root=/dev/vda rw init=/bin/sh'``.  The runner waited for serial
  marker ``Run /bin/sh as init process``, then used ``--pre-keyboard-wait-ms
  5000`` before typing ``echo ok\n`` into the focused browser canvas and
  ``--post-keyboard-wait-ms 20000`` before final evidence capture.  The run
  wrote
  ``build/wasm-browser-proof-current/bus-engine-os-display-init-shell-keyboard-prewait-result.json``
  and
  ``build/wasm-browser-proof-current/bus-engine-os-display-init-shell-keyboard-prewait-page.png``.
  Result JSON SHA-256 was
  ``cecb9503cf258b1375bd075aa4cca31ba033129c513b57758cb30fbaea148164`` and
  screenshot SHA-256 was
  ``5e0e5af816c8155d9913e8e2c6e584aa2c414f9cbba319e95918d9a1cb685923``.
  The result recorded a focused ``720x400`` 2D canvas, backend ``wasm``, pixel
  hash ``fnv1a32:190259fd``, and ``24725`` non-black pixels.  Visual inspection
  of the screenshot shows the Bus Engine OS shell prompt receiving ``echo ok``,
  printing ``ok``, and returning to ``sh-5.3#``.

  This is a controlled keyboard acceptance run for the downstream Bus Engine OS
  artifact.  It intentionally uses ``init=/bin/sh`` so the proof can exercise a
  guest-visible framebuffer shell without depending on the normal systemd login
  stack.  The normal Bus Engine OS systemd/userspace boot path remains covered
  by the earlier serial evidence, visible canvas evidence, and ``systemd 261.1``
  runs.  ``wasm-browser-smoke-runner.mjs`` now has ``--pre-keyboard-wait-ms``
  for this kind of readiness gap without weakening the serial marker gate.

  The mandatory default serial-console regression gate was rerun with the same
  QEMU/WASM artifact and the current browser runner after the pre-keyboard
  timing support landed.  The regenerated serial initramfs SHA-256 was
  ``2a12aedec5fe8d3e0fa9eb5d8974f38d8dcf0fbc06d8e9f2c24f34fd45eae3b6``.
  Chromium ``149.0.7827.55`` ran ``display=none`` and reached
  ``QEMU_WASM_LINUX_BOOT_OK`` in ``89120`` ms.  It wrote
  ``build/wasm-browser-proof-current/default-serial-current-runner-result.json``
  and
  ``build/wasm-browser-proof-current/default-serial-current-runner-page.png``.
  Result JSON SHA-256 was
  ``7156659390fabc8e19114b0b35bf8176f550f08bff19c39f926bed7bd935363a`` and
  screenshot SHA-256 was
  ``83f6c571a3bcce3577d4df0bedf10936457e47d58d13283772f857eb2c8ea43c``.

Non-goals:
  No WebGPU, accelerated 3D, or full desktop support.

WASM-033: Add license/source bundle checklist
---------------------------------------------

Scope:
  Define distribution requirements for QEMU/WASM artifacts.

Touches:
  Documentation and release checklist.

Proof:
  The checklist requires exact source, fork or upstream commit, patches, build
  scripts, Emscripten version, license texts, firmware notices, and checksums.

Non-goals:
  No legal conclusions beyond license text obligations.

WASM-034: Split upstream patch series
-------------------------------------

Scope:
  Define the patch-series order for upstream review.

Touches:
  Documentation only.

Proof:
  Series are separated into audit/docs, build/toolchain, host ABI, TCI boot,
  browser harness, tests, native TCG backend, QMP, networking, and graphics.

Non-goals:
  No monolithic browser-hosted Engine OS patch.

WASM-035: Keep downstream integration separate
----------------------------------------------

Scope:
  Document which work belongs in Bus Engine instead of QEMU.

Touches:
  Documentation only.

Proof:
  Bus Engine OS build, product UI, release artifacts, commercial support, and
  evidence storage are listed as downstream responsibilities.

Non-goals:
  No Bus-specific code or branding in QEMU.

Subsystem work packages
=======================

1. Baseline audit
-----------------

Scope:
  Produce a source-level audit of upstream Emscripten support and the
  experimental fork.

Files to inspect:
  ``meson.build``, ``configs/meson/emscripten.txt``,
  ``tests/docker/dockerfiles/emsdk-wasm64-cross.docker``,
  ``.gitlab-ci.d/buildtest.yml``, ``system/os-wasm.*``,
  ``util/coroutine-*``, ``tcg/tci.*``, ``tcg/wasm64*``,
  historical ``tcg/wasm32*`` reference files, browser sample startup files,
  and browser packaging
  scripts.

Acceptance:
  The audit records which upstream pieces are already accepted, which fork
  pieces are candidate designs, which fork pieces are unsuitable for direct
  upstreaming, and which runtime assumptions are browser-specific.

2. Toolchain and build reproducibility
--------------------------------------

Scope:
  Make the WebAssembly host build deterministic enough for development and CI.

Expected QEMU areas:
  Emscripten cross file, Docker build image, configure options, Meson host
  detection, CI jobs, and generated artifact naming.

Work items:
  * Pin the Emscripten SDK version used by the QEMU build image.
  * Keep the Bus Engine MVP on wasm64 only.  Treat wasm32 compatibility as a
    separate upstream discussion outside this MVP.
  * Use Chromium or Chrome as the first browser acceptance target.  Keep
    Firefox and WebKit as compatibility tracking until the Chromium proof path
    is accepted.
  * Define build variants for TCI baseline and native WebAssembly TCG.
  * Keep browser-specific link flags centralized in the Emscripten cross file.
  * Document required browser headers for pthreads and SharedArrayBuffer.

Acceptance:
  CI can build a TCI-based ``qemu-system-x86_64`` WebAssembly artifact and
  publish the generated ``.js``, ``.wasm``, worker, and metadata files as test
  artifacts.

3. Host ABI and platform layer
------------------------------

Scope:
  Make QEMU's Emscripten host platform layer explicit and testable.

Expected QEMU areas:
  ``system/os-wasm.*``, ``include/qemu/osdep.h``, file APIs, mmap allocation,
  atomics, cache flush, timers, signals, thread creation, and coroutine
  backend selection.

Work items:
  * Define the supported host feature subset for browser WebAssembly.
  * Replace hidden POSIX assumptions with Emscripten-specific stubs or errors.
  * Decide which filesystem operations map to Emscripten FS and which are not
    supported.
  * Keep unavailable features failing early with clear errors.
  * Document all browser security headers and memory limits.

Acceptance:
  A WebAssembly host build fails unsupported host operations deterministically
  and has unit or smoke coverage for the host-layer functions that QEMU uses
  during the MVP boot path.

4. TCI baseline boot path
-------------------------

Scope:
  Keep the first upstream MVP independent from the native WASM TCG backend by
  proving the boot flow with TCI first.

Expected QEMU areas:
  TCG interpreter configuration, x86_64 system emulator build, ``-nographic``,
  serial chardev, virtio block, direct kernel boot, and browser terminal
  bridge.

Work items:
  * Make the TCI build produce browser-loadable artifacts.
  * Define the canonical console-first command line.
  * Ensure direct-kernel boot and raw rootfs input paths work from Emscripten
    FS.
  * Add a small Linux guest smoke image for QEMU CI or an opt-in acceptance
    test.

Acceptance:
  A browser or headless-browser test proves that a 64-bit Linux guest reaches
  a serial-console readiness marker using TCI.

5. Native WebAssembly TCG backend
---------------------------------

Scope:
  Add an upstreamable native TCG backend for WebAssembly hosts after the TCI
  boot path is proven.

Expected QEMU areas:
  ``tcg/meson.build``, ``tcg/wasm64.*``, TCG code generation, helper calls,
  memory access, TLB access, register allocation, call ABI, TB lifecycle,
  flushing, invalidation, and multi-threaded TCG integration.

Work items:
  * Use wasm64 as the Bus Engine MVP backend target.
  * Re-derive the backend design from QEMU TCG requirements and the fork's
    implementation, preserving QEMU style and review boundaries.
  * Support hot translation blocks through WebAssembly modules where browser
    APIs permit it.
  * Keep fallback to TCI available for unsupported browsers or debug builds.
  * Add backend-specific tests for arithmetic, branches, calls, loads/stores,
    atomic behavior, and guest memory access.

Acceptance:
  Native WASM TCG boots the same Linux smoke guest as the TCI baseline, passes
  selected TCG tests, and has a clear fallback path to TCI.

6. Browser chardev and terminal bridge
--------------------------------------

Scope:
  Provide a maintainable browser serial-console path without embedding a
  product-specific terminal UI in QEMU core.

Expected QEMU areas:
  Chardev backend selection, Emscripten TTY integration, worker messaging, and
  example browser harness.

Work items:
  * Define a browser chardev interface that can connect serial I/O to
    JavaScript without tying QEMU to a specific terminal library.
  * Provide a minimal example harness for stdin/stdout and serial output.
  * Keep terminal UI libraries outside QEMU core unless QEMU maintainers accept
    vendoring them.

Acceptance:
  The Linux guest serial console is interactive through a browser page and can
  be driven by automated tests.

7. Browser block and file packaging
-----------------------------------

Scope:
  Make guest inputs explicit and repeatable.

Expected QEMU areas:
  Emscripten FS, block file backend, direct kernel file loading, packaged data
  files, and optional browser file import/export.

Work items:
  * Define a manifest for kernel, initrd if present, rootfs image, firmware,
    and checksums.
  * Support read-only packaged input first.
  * Keep persistent browser storage out of the MVP.
  * Document how Emscripten FS paths map to QEMU command-line file paths.

Acceptance:
  The MVP browser harness loads kernel and rootfs inputs from a declared
  manifest and verifies their checksums before QEMU starts.

8. Browser control plane and QMP
--------------------------------

Scope:
  Define the control interface without blocking the console MVP.

Expected QEMU areas:
  QMP transport, worker messaging, monitor startup, and event forwarding.

Work items:
  * Keep QMP out of the first boot proof unless the serial path requires it.
  * Design a JavaScript-accessible QMP bridge after the serial boot proof.
  * Preserve QMP JSON semantics; do not describe QMP as REST.
  * Avoid downstream QMP extensions for browser-hosted Engine OS unless a generic QEMU
    extension is accepted.

Acceptance:
  A later phase can issue ``query-status`` and shutdown through a browser QMP
  bridge, while the MVP remains valid without QMP.

9. Networking stages
--------------------

Scope:
  Avoid over-promising browser networking.

Work items:
  * MVP: no network.
  * Stage 2: HTTP(S)-limited fetch proxy for demos if CORS permits.
  * Stage 3: optional WebSocket delegate for fuller networking.
  * Stage 4: documented production networking only after repeatable tests.

Acceptance:
  The MVP boots with networking disabled and the documentation states that
  browser networking is not equivalent to native TAP, slirp, or host sockets.

10. Graphics stages
-------------------

Scope:
  Add basic browser graphics and keyboard input to the MVP expansion while
  keeping accelerated graphics as later work.

Work items:
  * Keep the serial console boot marker as the regression gate.
  * MVP expansion: opt-in SDL/canvas display mode.
  * MVP expansion: deterministic browser keyboard input path.
  * MVP expansion: framebuffer or 2D display proof suitable for simple
    graphical guests.
  * Research: WebGPU-backed acceleration and virtio-gpu integration.

Acceptance:
  Chrome/Chromium boots a 64-bit guest, preserves serial diagnostics, captures
  browser-visible graphics, and accepts a deterministic keyboard sequence.

11. Automated acceptance
------------------------

Scope:
  Add tests that are meaningful for upstream QEMU and downstream users.

Work items:
  * Build-only CI for wasm64 TCI.
  * Browser or headless-browser smoke test for Linux serial boot.
  * Optional native WASM TCG smoke test once that backend exists.
  * Artifact manifest verification test.
  * License/source bundle check for QEMU/WASM distribution artifacts.

Acceptance:
  A maintainer can run one documented command or CI job to prove the MVP boot
  path and inspect serial output.

12. Documentation and upstream review shape
-------------------------------------------

Scope:
  Make the support boundary clear before patches are proposed.

Work items:
  * Add WebAssembly host build documentation.
  * Add browser runtime requirements.
  * Add examples for direct-kernel serial boot.
  * Add troubleshooting for cross-origin isolation, SharedArrayBuffer, memory
    limits, worker startup, missing files, and guest boot failures.
  * Split patch series by subsystem: build/toolchain, host ABI, TCI boot,
    browser I/O, tests, native TCG backend, optional networking, optional
    graphics.

Acceptance:
  The plan can be converted into reviewable upstream patch series without
  mixing browser UI, downstream product code, and core QEMU changes.

Downstream Bus Engine integration
=================================

The following work belongs outside upstream QEMU:

* building the Bus Engine OS kernel and root filesystem;
* selecting Bus Engine OS package contents;
* exposing a Bus Engine product UI;
* storing Bus Engine build evidence;
* publishing Bus Engine release artifacts;
* deciding Bus Engine commercial support boundaries.

The downstream integration may use the upstream QEMU browser artifact as:

* a browser-hosted Engine OS runtime;
* a documentation and support reproduction environment;
* a serial-console test target;
* the emulator behind a Bus Engine OS product-page preview on
  ``busdk.com/engine/``;
* a later graphical or networking research platform.

Non-goals for the MVP
=====================

The MVP does not require:

* WebGPU;
* accelerated graphical desktop support;
* arbitrary TCP/UDP networking;
* durable browser disk persistence;
* production hosting guarantees;
* package builds inside the browser;
* modifying the Linux kernel to run directly as WebAssembly;
* downstream Bus Engine code inside QEMU.

Open decisions
==============

* Whether upstream QEMU should keep wasm64+TCI as the only official baseline
  until a native WebAssembly TCG backend is accepted.
* Whether QEMU should provide a minimal browser harness in-tree or only
  document how an external harness loads the generated artifacts.
* Which headless browser test runner is acceptable for QEMU CI.
* Which guest smoke image can be used in upstream CI without licensing,
  download, or runtime cost problems.
* Whether browser QMP should be a generic chardev/transport feature or an
  example harness feature.

Current browser input invariant
===============================

The browser-hosted Engine OS harness must not use browser modal dialogs as an input path.
Emscripten's generated fallback can call ``window.prompt("Input: ")`` when
stdin is read in a browser, and some abort paths can request an
abort/retry/ignore decision through ``window.prompt``.  The harness now passes
a non-interactive stdin handler that returns EOF and suppresses browser
``alert``, ``confirm``, and ``prompt`` calls while recording counts in the
smoke state.  Guest keyboard input must enter through the display canvas and
the QEMU display key event path.

Current browser startup indication invariant
============================================

The browser harness must draw an explicit startup frame on the display canvas
before guest graphics or serial output become visible.  The current harness
shows status frames while guest files load, the QEMU WebAssembly runtime loads,
and QEMU starts.  This keeps browser-hosted Engine OS iframe users from seeing a blank black
display during large WASM/rootfs fetches and early emulator startup.

Browser-to-guest service bridge design
======================================

The next browser-hosted QEMU milestone is a structured service bridge for
frontend code that needs to talk to software running inside the guest.  This is
not a network stack, not a REST server, and not a product-specific agent API.
The QEMU side should provide a generic transport that a downstream guest can
bind to its own service adapter.

The MVP channel is:

.. code-block:: text

   parent page or frontend app
       -> iframe postMessage or direct harness JavaScript API
       -> browser worker message
       -> QEMU WebAssembly browser chardev
       -> virtio-console or virtserialport device
       -> guest service adapter

This selects browser ``postMessage`` only as the outer browser API.  The guest
does not see ``postMessage`` directly.  The guest-visible side should be a
dedicated QEMU character device attached to a virtio console or virtio serial
port.  The first message format should be newline-delimited JSON frames with a
small bounded payload, an opaque request id, operation name, timeout, and
structured error response.  Binary payloads, streaming, file transfer, and
arbitrary sockets are out of scope for the first bridge.

Transport comparison
--------------------

Serial console messages
  The serial console already works and is useful for diagnostics, but it mixes
  kernel logs, login prompts, shell output, and automation markers.  It is not
  the right default for frontend service calls because unrelated boot output
  can interleave with request/response traffic.  Serial remains the regression
  and failure-evidence path.

QMP
  QMP is the structured machine-control protocol for QEMU.  It is appropriate
  for VM status, reset, power operations, and later monitor integration.  It is
  not a guest application service channel and should not be extended with
  downstream guest-service methods.  The bridge design preserves QMP JSON
  semantics and does not describe QMP as REST.

virtio-console or virtserialport
  A dedicated virtio character port is the selected MVP guest channel.  Linux
  guests can expose it as a device separate from the serial console, QEMU
  already has chardev plumbing, and the browser-hosted implementation can
  remain a generic character backend rather than a Bus Engine-specific device.
  This also works naturally with automated smoke tests because the test can
  wait for a readiness marker on serial, then send a service request over the
  dedicated channel.

virtio-vsock
  Vsock is a good native VM service pattern, but it is a larger first browser
  target because it implies socket semantics, address families, and more
  guest-side networking assumptions.  It should remain a later option for
  native QEMU and richer browser-hosted integrations after the chardev bridge
  proves the request/response contract.

9p or virtfs request files
  A shared filesystem can be useful for importing and exporting files, but it
  is awkward for interactive service calls.  It introduces file lifecycle,
  polling or notification, persistence, and cleanup behavior before the bridge
  has proven basic request/response semantics.  It remains a later file
  exchange mechanism, not the MVP service channel.

Browser networking
  Browser WebAssembly code does not get raw host sockets, TAP, or arbitrary
  TCP/UDP access.  Fetch is HTTP(S)-shaped and constrained by CORS and
  forbidden-header rules; WebSocket delegate networking requires a separate
  host-side service.  Therefore the service bridge must not claim arbitrary
  host or Internet networking.  Any network-like path remains opt-in and
  separately documented.

Worker ``postMessage``
  Worker messages are the right browser-side control surface between the page,
  iframe, harness, and QEMU WebAssembly worker.  They are not a guest device by
  themselves.  They should carry typed bridge frames to the browser chardev
  backend, plus lifecycle events and diagnostics back to the harness.

MVP security and browser assumptions
------------------------------------

The browser-hosted service bridge assumes Chrome or Chromium with the same
cross-origin isolation requirements as the existing pthreaded WebAssembly
runtime.  The parent page must validate origins before accepting iframe
messages.  The harness must expose only named bridge operations declared in the
guest manifest, reject oversized payloads before forwarding them to QEMU, apply
per-request timeouts, and report errors without logging secrets.

QEMU must not embed downstream product credentials or model-provider
configuration.  Guest services that need credentials must receive them through
downstream policy-controlled mechanisms, not through static QEMU artifacts or
query strings.  The QEMU result JSON should record bridge kind, readiness,
request id, operation name, status, timeout, and diagnostics, but not request
payloads by default.

Manifest metadata
-----------------

The guest manifest may describe a future service bridge with a generic
``serviceBridge`` object.  The object is metadata until the browser transport
implementation lands; it lets downstream artifacts declare the intended bridge
shape without product-specific QEMU code.

The supported metadata fields are:

``kind``
  The guest channel framing.  The first accepted values are
  ``serial-jsonl``, ``virtio-console-jsonl``, and
  ``virtio-serial-jsonl``.  ``serial-jsonl`` is a compatibility proof path
  for minimal kernels that do not expose virtio console ports.

``requestChannel`` and ``responseChannel``
  Stable channel names for browser-to-guest requests and guest-to-browser
  responses.

``readinessMarker``
  Serial or bridge-visible text indicating that the guest service adapter is
  ready for requests.

``healthRequest``
  A small JSON object the harness can later send as the first deterministic
  request.

``timeoutMs`` and ``maxPayloadBytes``
  Per-request timeout and maximum payload size.  The manifest helper rejects
  invalid limits before a smoke run.

``interactiveOnly``
  ``false`` means the bridge is intended for deterministic automated smoke
  checks.  ``true`` reserves the bridge for manual interaction until a
  deterministic proof exists.

Browser harness integration
---------------------------

When ``serviceBridge`` metadata is present, the browser smoke harness exposes a
generic ``qemuWasmServiceBridge`` object.  Same-page callers can use
``qemuWasmServiceBridge.request(object)``.  Iframe callers can send a
same-origin ``postMessage`` with type ``qemu-wasm-service-request`` and receive
a ``qemu-wasm-service-response`` message.  Cross-origin messages are ignored by
default.

Requests are encoded as newline-delimited JSON frames with generated request
IDs when the caller does not supply one.  The harness tracks pending requests,
applies the manifest timeout, rejects payloads larger than ``maxPayloadBytes``,
and resolves responses by matching response ``id`` fields.  The smoke state
records bridge kind, channels, readiness, request and response counters,
timeouts, IDs, and status strings.  It does not record request or response
payloads by default.

QEMU WebAssembly chardev backend
--------------------------------

The browser bridge uses an Emscripten-only QEMU chardev backend:

.. code-block:: text

   -chardev wasm,id=qemu-wasm-service-request,channel=...
   -chardev wasm,id=qemu-wasm-service-response,channel=...
   -device virtio-serial-pci
   -device virtserialport,chardev=qemu-wasm-service-request,name=...
   -device virtserialport,chardev=qemu-wasm-service-response,name=...

For the pinned x86_64 TuxBoot smoke kernel, the deterministic proof uses the
same wasm chardev backend attached to additional serial ports instead:

.. code-block:: text

   -chardev wasm,id=qemu-wasm-service-request,channel=...
   -chardev wasm,id=qemu-wasm-service-response,channel=...
   -serial chardev:qemu-wasm-service-request
   -serial chardev:qemu-wasm-service-response

This keeps the smoke proof independent of virtio-console kernel support while
preserving the same browser chardev request/response contract.

The browser side writes a pending JSON frame into the request channel through
the exported ``qemu_wasm_chardev_write_pending`` function.  Guest output from
the response channel is copied back into the browser and delivered to
``qemuWasmChardevReceive``.  The backend is generic QEMU infrastructure; guest
policy, service names, credentials, and product-specific adapters remain
downstream responsibilities.

Power-control integration
-------------------------

The browser harness also exposes a generic ``qemuWasmPowerControl`` object for
power operations requested by test runners or frontend code.  Power control is
kept separate from guest service calls:

* ``shutdown`` prefers a guest service-bridge request with
  ``{ "operation": "power", "action": "shutdown" }`` when a bridge is
  configured.  Without a service bridge, it falls back to QEMU's guest-visible
  power button path through ``qemu_system_powerdown_request()``.
* ``reboot`` is guest-acknowledged only and requires a configured service
  bridge request with ``{ "operation": "power", "action": "reboot" }``.
  Forced reset remains a separate operation.
* ``guest-powerdown`` directly sends QEMU's guest-visible power button request.
* ``force-reset`` calls QEMU's host reset request.
* ``force-poweroff`` calls QEMU's host shutdown request.

The wasm-only QEMU export is ``qemu_wasm_power_request(action)``.  It accepts a
small numeric action selected by the browser harness and maps that action to
existing QEMU runstate requests.  The JavaScript API keeps stable operation
names at the browser boundary so downstream products do not need to know the
numeric action values or QEMU runstate internals.

The browser smoke runner accepts ``--power-operation`` with the values above
and ``--power-timeout-ms`` for guest-acknowledged operations.  Guest manifests
may also provide ``powerOperation`` and ``powerTimeoutMs``.  The default is an
empty operation, so existing boot, display, keyboard, and service-bridge smoke
runs are unchanged unless a power operation is explicitly requested.

Runner result JSON records ``powerControlState`` and, when a power operation
was requested, a top-level ``powerOperation`` object.  The state includes the
stable operation name, delivery path, guest acknowledgement when available,
QEMU action/status for direct QEMU requests, timeout, completion flag, and
non-secret error text.  It does not expose monitor commands, raw transport
frames, guest filesystem paths, or product-specific service names.

Suspend and resume planning
---------------------------

Suspend and resume must be treated as VM-state compatibility work, not as a
browser storage promise.  The first acceptance target should remain native QEMU
managed save or migration-style state save under a normal host runtime, because
that path exercises QEMU's existing VMState machinery before adding browser
storage constraints.

Browser-hosted state can only be restored when every compatibility input still
matches the saved state.  A browser-hosted save manifest should record at
least:

* QEMU JavaScript and WebAssembly artifact digests;
* QEMU target, machine, CPU model, accelerator mode, memory size, display
  device, rootfs device model, and extra QEMU arguments;
* guest architecture, kernel digest, initrd digest if present, rootfs digest
  if present, and kernel command line;
* firmware file digests and firmware directory identity;
* service-bridge channel kind and channel names;
* browser harness format version and storage schema version.

Restore must reject saved state when any compatibility field differs.  The
error should name the first incompatible field and keep the old saved state
available for export or deletion rather than trying a best-effort restore into
a different emulator or guest image.

The browser storage candidates are:

``IndexedDB``
  The first realistic browser-local storage target for manifest metadata and
  moderate binary chunks.  It is asynchronous and quota-managed by the browser,
  so it must report quota failures clearly and must not be described as durable
  production storage.

``Origin Private File System``
  Useful for larger local files when supported by the browser.  It still
  inherits origin quota and user-agent eviction behavior, so it needs the same
  compatibility and export story as IndexedDB.

``File System Access API``
  Useful for explicit user-selected import/export of state bundles.  It is
  better for manual evidence and support cases than for automatic restore
  because it requires user-mediated file handles in supported browsers.

The browser-hosted MVP should first expose enough metadata to say why a save is
compatible or incompatible.  Actual browser persistence should wait until a
native QEMU managed-save proof and a browser quota/error proof both exist.
Until then, screenshots, serial logs, result JSON, and guest artifact manifests
remain the accepted browser evidence.

First proof shape
-----------------

The generic proof uses a tiny Linux guest service generated by
``scripts/ci/wasm-build-smoke-initramfs.py --service-bridge-smoke``.  The
fixture waits for the configured request and response character devices,
prints the configured service readiness marker, reads one JSON line from the
request device, and writes one JSON response on the response device.

For the pinned TuxBoot x86_64 smoke guest, the CI-shaped preparation command
is::

  python3 scripts/ci/wasm-prepare-tuxboot-smoke-guest.py \
    --output-dir build/wasm-service-bridge-smoke-guest \
    --service-bridge-smoke

That command writes ``tuxboot-browser-smoke-guest.json`` for
``scripts/ci/wasm-browser-smoke-runner.mjs --guest-manifest`` and records the
matching browser-runner command in ``tuxboot-smoke-guest.json``.
The GitLab ``smoke-wasm64-64bit-service-bridge`` job uses the same manifest
shape with the bridge-enabled WebAssembly artifact from ``build-wasm64-64bit``
and archives the service bridge result JSON plus screenshot.

The browser smoke runner should:

* boot the guest using the existing serial marker gate;
* wait for the service bridge readiness marker;
* send the manifest ``healthRequest`` through the browser bridge API;
* receive a structured ``ok`` response with the same request id;
* write result JSON with ``serviceBridgeState`` covering bridge readiness,
  request id, response status, timeout, last serial line, and screenshot path.

The downstream Bus Engine OS proof can then replace the tiny echo service with
a governed in-guest service adapter without adding product-specific code to
QEMU.

Downstream guest service proof handoff
--------------------------------------

A downstream guest such as Bus Engine OS should hand QEMU only generic guest
inputs and bridge metadata.  The QEMU manifest should identify:

* kernel, initrd or rootfs, firmware, memory, machine, CPU, display, and
  device choices;
* expected serial readiness text and any additional expected serial identity
  strings;
* ``serviceBridge.kind``, request and response channel names, readiness
  marker, health request, timeout, payload limit, and whether the bridge is
  automated or interactive-only;
* optional ``powerOperation`` and ``powerTimeoutMs`` values when a proof must
  exercise shutdown, reboot, guest power button, or forced QEMU control;
* screenshot, display-output, keyboard-input, and visual-marker expectations
  when the proof includes graphics.

Frontend applications should discover the bridge through the browser harness,
not by parsing QEMU command lines.  Same-page code can check
``globalThis.qemuWasmServiceBridge`` and read the non-secret
``qemuWasmSmokeState.serviceBridge`` status.  Iframe callers can use the
same-origin ``qemu-wasm-service-request`` and ``qemu-wasm-service-response``
messages.  Frontends should treat bridge status as unavailable until the
manifest readiness marker has been observed and should handle timeout and
structured error responses as normal outcomes.

The downstream guest owns the service adapter and policy.  QEMU does not
define product service names, model-provider configuration, approval rules,
audit storage, identity, secrets, guest filesystem policy, or arbitrary shell
access.  A downstream Codex App Server proof should expose only the reviewed
health/status/request shapes through its in-guest adapter, keep credentials out
of static browser-hosted artifacts, and report service readiness with stable
serial or bridge-visible markers.

Accepted downstream evidence should include the exact manifest, result JSON,
serial tail, screenshot, browser/runtime version, QEMU artifact digests, guest
kernel/rootfs digests, bridge readiness state, request id, response status, and
any display or keyboard evidence required by that proof.  A successful generic
QEMU bridge smoke does not by itself prove a downstream Bus Engine OS service;
the downstream proof must boot that guest and exercise its adapter.

Accepted local proof on 2026-06-30 used Chromium 141.0.7390.37 in the
Playwright container with ``serial-jsonl``.  The result JSON recorded
``success=true``, ``phase=success``, readiness source ``serial``,
``sent=1``, ``received=1``, ``resolved=1``, request id ``health-1``,
response id ``health-1``, response status ``ok``, and screenshot
``build/wasm-service-bridge-proof-local/screenshot.png``.

TCI hot-block instrumentation
-----------------------------

The first performance evidence path is opt-in TCG/TCI hot-block
instrumentation.  It is disabled by default.  Browser smoke runs enable it
with::

  scripts/ci/wasm-browser-smoke-runner.mjs \
    --tcg-hotblocks \
    --tcg-hotblocks-interval 10000 \
    --tcg-hotblocks-op-sample 1024 \
    --tcg-hotblocks-op-limit 134217728 \
    --tcg-hotblocks-top 12 \
    ...

The runner forwards these values to the WebAssembly module environment as
``QEMU_TCG_HOTBLOCKS=1``, ``QEMU_TCG_HOTBLOCKS_INTERVAL``,
``QEMU_TCG_HOTBLOCKS_OP_SAMPLE``, ``QEMU_TCG_HOTBLOCKS_OP_LIMIT``, and
``QEMU_TCG_HOTBLOCKS_TOP``.  The browser harness also writes the same
configuration into ``/qemu-tcg-hotblocks-env`` before QEMU starts, because the
WebAssembly pthread that runs QEMU ``main()`` cannot rely on arbitrary
JavaScript module properties being visible as process environment variables.
QEMU then emits bounded JSON lines on stderr with the prefix
``qemu-tcg-hotblocks:``.  Each summary records:

* total translation-block executions;
* unique and dropped translation-block counter slots;
* top translation blocks by execution count, including guest PC, code segment
  base, flags, cflags, translated size, guest instruction count, and exit
  reason counters;
* total interpreted TCI operations;
* opcode sample rate, opcode collection limit, and whether opcode collection
  remains active;
* aggregate helper-call, QEMU load, and QEMU store counters;
* top TCI opcode counters by TCG opcode name.

The browser harness parses those lines into
``qemuWasmSmokeState.hotBlocks`` and the runner copies that field into result
JSON as ``hotBlocks``.  The same mechanism applies to the generic Linux smoke
guest and downstream Bus Engine OS browser-hosted service proofs because it is
QEMU-side instrumentation rather than guest-specific code.

This instrumentation is a measurement step, not a performance fix.  The first
accepted use is to compare generic Linux smoke and Bus Engine OS systemd boot
profiles, identify hot guest PC ranges and TCI opcode families, and choose the
first narrow generated-WASM fast path.  TCI remains the correctness fallback.
The counters are intended for the single-threaded wasm64 TCI browser path used
by these smoke proofs.  They are not a replacement for QEMU's plugin-based
profiling interfaces for native or multi-threaded accelerator work.

Accepted local hot-block evidence on 2026-07-01 used
``qemu-system-x86_64.js`` SHA-256
``bd04d14a196f3126c074c5cb0f22f56aabef1f0034275f0b5e2375c674c73895`` and
``qemu-system-x86_64.wasm`` SHA-256
``66066b05e99b666ed41f2899c9f713b57ad2d829ad138d54be9c4c51a4915dbc``.
The Chromium browser reported version ``149.0.7827.55`` and user agent
``HeadlessChrome/149.0.0.0``.

The generic browser smoke proof wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-hotblocks-current.json``
and
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-hotblocks-current.png``.
It reached ``QEMU_WASM_LINUX_BOOT_OK`` with ``success=true``,
``markerSeen=true``, ``summaryCount=10``, ``op_sample=1024``,
``op_limit=134217728``, ``op_active=false``, and representative
``top_blocks`` plus ``top_tci_ops``.

The downstream Bus Engine OS service proof wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-hotblocks.json``
and
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-hotblocks.png``.
It used the existing Bus Engine OS service manifest and did not modify any
downstream guest files.  The run timed out before
``QEMU_WASM_SERVICE_READY`` and ``Reached target Multi-User System.``, which
matches the known wasm64 TCI service-readiness gap for the full downstream
guest, but it captured QEMU-side evidence with ``summaryCount=15``,
``op_sample=1024``, ``op_limit=134217728``, ``op_active=false``, and
representative ``top_blocks`` plus ``top_tci_ops``.

Lean x86 microvm evidence
-------------------------

The first non-TCG performance-reduction probe was the x86 ``microvm`` machine
with direct kernel boot, ACPI disabled, and ``virtio-mmio`` devices instead of
the default PC/i440FX/PCI path.  This is still QEMU-generic evidence; the Bus
Engine OS kernel/rootfs are downstream proof payloads.

The initial Chromium run with the accepted Bus Engine OS x86_64 kernel reached
Linux but panicked before mounting root because the kernel could not discover
the ``virtio-blk-device`` root disk.  QEMU's x86 ``microvm`` machine exposes
MMIO devices to direct-boot kernels through auto-appended
``virtio_mmio.device=`` command-line descriptors, and that downstream kernel
had ``CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES`` disabled.

After the downstream Bus Engine OS x86_64 virtual kernel enabled
``CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y`` and rebuilt the Linux package,
Chromium proof
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-new-kernel-2.json``
used refreshed kernel SHA-256
``3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920`` with the
existing rootfs SHA-256
``5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e``.  The
QEMU command used ``-M microvm,acpi=off``, ``virtio-blk-device``,
``virtio-serial-device``, and ``virtio-rng-device``.

That run proved the lean machine can register ``virtio-mmio`` devices, expose
``/dev/vda``, mount the ext4 root filesystem, and start systemd.  It still
timed out after 420 seconds before ``Reached target Multi-User System.`` and
before the service bridge readiness marker.  The conclusion is that ``microvm``
removes the root-device blocker and avoids unnecessary PC firmware/ACPI/PCI
setup, but it does not by itself solve the wasm64 TCI slowness for the full
Bus Engine OS systemd guest.  The remaining active performance work is a real
execution acceleration path with TCI fallback.

A follow-up Chromium diagnostic masked only
``systemd-udev-trigger.service`` through the guest command line while keeping
the same kernel, rootfs, machine, and QEMU artifact.  It wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-mask-udev-trigger.json``
and still timed out before multi-user after 300 seconds.  The last serial
state advanced only into early systemd socket setup.  This rules out treating
one masked coldplug unit as the performance solution.  It remains useful
downstream evidence that the virtual kernel profile should avoid unnecessary
PC-era probing such as absent PCI configuration space and absent i8042
controllers, but the accepted QEMU goal still needs a faster execution path.

An O3/LTO wasm64 TCI build was tested as a bounded production-speed artifact
experiment.  The Emscripten toolchain accepted Meson ``-Doptimization=3`` and
LTO, and generic Chromium smoke still reached ``QEMU_WASM_LINUX_BOOT_OK``.
The fair no-hot-blocks generic comparison did not improve: the existing O2
artifact reached the marker in about 75 seconds, while the O3/LTO artifact
reached it in about 80 seconds.  The Bus Engine OS microvm proof still timed
out before multi-user.  Therefore O3/LTO is not the accepted performance
solution and is not enabled in the normal CI artifact.

The next production-artifact cleanup is to compile hot-block instrumentation
out of normal builds.  Profiling builds can opt into the existing JSON
hot-block evidence path, but the default browser artifact should not pay a
per-interpreted-opcode branch for instrumentation that is disabled at runtime.

That cleanup is implemented as the default build behavior.  Profiling builds
can pass ``--enable-tcg-hotblocks`` to keep ``tcg/hotblocks.c`` and the TCI
opcode sampling path.  Normal TCI builds compile the inline hot-block hooks to
no-ops and do not include the hot-block source file.  A rebuilt O2 wasm64 TCI
artifact without default hot-block instrumentation produced
``qemu-system-x86_64.js`` SHA-256
``818a5ae872e67081771d3dead252f1c12ac8e1d8c2184975cc201069c4ff70cb`` and
``qemu-system-x86_64.wasm`` SHA-256
``fb315ef7180443d6aecc9c622db1f4d6a958d4110ea0707f55d2c12d9364dae2``.
The artifact manifest check passed.  Generic Chromium smoke wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-nohot.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in 73.3 seconds.  The Bus Engine OS
microvm proof wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-nohot.json``
and still timed out after 420 seconds at
``systemd[1]: Starting Coldplug All udev Devices...``.  This cleanup is safe
and removes measurement overhead from production artifacts, but it is not the
full boot-speed solution.

The first hot-opcode acceleration experiment targeted ``INDEX_op_mb`` because
the accepted hot-block sample recorded about 5.6 million sampled ``mb``
operations during the Bus Engine OS proof.  QEMU cannot remove system-mode
barriers unconditionally: ``tcg_gen_mb()`` deliberately emits them even for
one guest CPU because I/O threads and devices can observe virtio queues.
Therefore the experiment is Emscripten/TCI-only, explicit, and default-off via
``QEMU_TCI_RELAXED_MB=1`` or the browser runner's ``--tci-relaxed-mb`` flag.
The strict TCI path remains the fallback.

A rebuilt artifact with the explicit relaxed-barrier switch available produced
``qemu-system-x86_64.js`` SHA-256
``c197af639082d71084d7c78421e2ce5b80de12c83afdd5d270f4fd67b1245e2c`` and
``qemu-system-x86_64.wasm`` SHA-256
``74c0578dd65d50e4e1e4570bdb21197b2f24fb17ffb571a418bdb3ab2d7515bb``.
Generic Chromium smoke with ``--tci-relaxed-mb`` wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-relaxed-mb-2.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in 68.2 seconds with result JSON
recording ``tci.relaxedMb=true``.  The Bus Engine OS
microvm proof with the same flag wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-relaxed-mb.json``
and still timed out after 420 seconds, although it advanced slightly farther
than the strict run, from ``Coldplug All udev Devices`` to the ext4 rootfs
remount message.  This result shows that memory-barrier overhead is measurable
but too small to satisfy the Bus Engine OS browser boot goal.  The remaining
required work is a real generated-WASM or equivalent execution acceleration
path with strict TCI fallback.

A stricter release-shaped TCI artifact was also measured before starting a
larger execution change.  Upstream QEMU intentionally rejects ``NDEBUG`` builds
from ``include/qemu/osdep.h``, so the supported artifact kept QEMU assertions
enabled while disabling debug info and QOM cast debugging.  The resulting
artifact produced ``qemu-system-x86_64.js`` SHA-256
``c197af639082d71084d7c78421e2ce5b80de12c83afdd5d270f4fd67b1245e2c`` and
``qemu-system-x86_64.wasm`` SHA-256
``8a401965634474d98786aef6cd8958bab118e170994ba14f284a2b79a135be77``.
Generic Chromium smoke wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-nodebug-nohot.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in 81.2 seconds.  The Bus Engine OS
microvm proof wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-nodebug-nohot.json``
and still timed out after 420 seconds at
``systemd[1]: Starting Journal Service...``.  Adding Emscripten
``-sASSERTIONS=0`` to the same supported configuration produced the same
JavaScript and WebAssembly hashes, so it was not repeated as a separate
runtime proof.  Build-shape cleanup therefore does not solve the boot
performance gap.

Acceleration work must remain evidence-backed.  Two classes of work are valid
for this goal:

* CPU execution acceleration, where the prior art is ``ktock/qemu-wasm``:
  it adds a WebAssembly TCG backend, translates hot translation blocks into
  browser ``WebAssembly.Module`` / ``WebAssembly.Instance`` objects, imports
  QEMU memory and helper functions, and keeps TCI for cold or unsupported
  blocks because compiling every block is too expensive.
* Paravirtual device acceleration, where the measured boot trace or device
  profile shows that browser-hosted QEMU is spending time in emulated devices
  or slow host-device adaptation.  Existing evidence already supports
  direct-kernel ``microvm``, ``virtio-mmio`` block, ``virtio-rng``, and
  virtio-serial service channels as better browser-hosted defaults than a full
  PC/BIOS/PCI path.  Future browser APIs such as OPFS, WebSocket/fetch-backed
  networking, WebGL/WebGPU display presentation, and WebCrypto-backed entropy
  or crypto helpers should be used only where they match a measured QEMU
  device boundary and keep the guest-visible device model explicit.

This rules out speculative one-off TCI opcode rewrites as the next accepted
optimization.  A new execution patch must cite either the hot-block evidence
and QEMU-on-WASM prior art, or a measured paravirtual device bottleneck.

For the current Bus Engine OS boot gap, the next implementation step must
first attribute time to CPU execution or to a paravirtual device boundary.
The active browser proof already uses the lean ``microvm`` machine, direct
kernel boot, ``virtio-mmio`` block, ``virtio-rng``, and virtio serial/channel
plumbing.  The guest gets past kernel/rootfs handoff and continues through
ordinary early systemd work, but does not reach multi-user within the 420
second proof window.  There is no current evidence that a browser
WebGL/WebGPU/WebCrypto mapping is the next boot blocker, but that absence of
evidence is not enough to hard-code the CPU path as the only acceptable
answer.  The next proof must record enough QEMU-side counters to distinguish
TCI interpreter cost from virtio block, virtio RNG, virtio serial, display,
input, network, storage, and browser-adapter waits.

If that attribution shows a device boundary is dominant, the first
optimization should be paravirtual: keep the guest-visible device model
explicit and implement the matching browser API behind a QEMU backend, such
as OPFS-backed virtio block, WebSocket/fetch-backed networking,
WebGL/WebGPU display presentation, or WebCrypto-backed entropy/crypto.  If
the attribution continues to show CPU interpreter cost as dominant, the
immediate execution slice should follow the proven ``ktock/qemu-wasm``
pattern: keep TCI as the correctness fallback, count hot translation blocks,
and compile only hot eligible blocks into WebAssembly modules.

The first combined attribution proof used Chromium ``141.0.7390.37`` with the
hot-block-enabled profiling artifact ``build-wasm64-attrib-hotblocks``.
Artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``78502d331dd6bb18f2d9fea9f70b744a2bed33069d2858bdb06cc61b63fd54db``.
* ``qemu-system-x86_64.wasm`` =
  ``19bac0a51a684bcea2f161ffe05966e3aca1689d9bd7b1669c2dbc2cdb86e1d8``.

The Bus Engine OS microvm proof wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-perf-attribution-hotblocks.json``
and screenshot
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-perf-attribution-hotblocks.png``.
It timed out after 420 seconds before ``Reached target Multi-User System.``,
but collected both CPU and device-side attribution.  The final hot-block
summary reported ``tb_execs=2100000``, ``unique_tbs=4096``,
``dropped_tbs=2043592``, ``tci_ops=134217728``,
``helper_calls=60332``, ``qemu_loads=3210491``, and
``qemu_stores=3533877``.  The top sampled TCI operations were normal
interpreter work: ``tci_movi``, ``st``, ``ld``, ``add``, ``brcond``,
``mb``, and related load/store/set-condition operations.

The final device attribution summary in the same run reported 463 block
kicks, 10 RNG kicks, 70 serial kicks, no network, display, or input activity,
and approximately 133 milliseconds of measured virtio handler time across the
long proof window.  A release-shaped no-hotblocks run gave the same device
shape and timed out at early journal startup.  This evidence does not justify
OPFS-backed block I/O, WebSocket/fetch networking, WebGL/WebGPU display, or
WebCrypto entropy work as the first performance patch.  The next accepted
implementation slice is CPU execution acceleration through hot translation
blocks compiled to WebAssembly, with strict fallback to TCI for cold,
unsupported, invalidated, or failed blocks.

The same profiling artifact also passed the generic Chromium Linux smoke:
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-attrib-hotblocks.json``
reached ``QEMU_WASM_LINUX_BOOT_OK`` in 92.7 seconds and wrote screenshot
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-attrib-hotblocks.png``.
That run collected 33 hot-block summaries, with the final summary reporting
``tb_execs=330000`` and ``tci_ops=134217728``.  It did not collect
performance-attribution summaries because the tiny initramfs smoke path did
not exercise the instrumented virtio block, RNG, serial, display, input, or
network paths before reaching the marker.

Generated WebAssembly Execution Design
--------------------------------------

The next acceleration lane is to compile selected TCG translation blocks into
small WebAssembly functions at browser runtime while keeping TCI as the
correctness baseline.  The generated path must be opt-in until it repeatedly
proves the generic Linux smoke and the downstream Bus Engine OS boot proof.

The intended execution shape is:

* TCG still translates guest instructions into QEMU TCG IR.
* The normal TCI bytecode remains available for every translation block.
* A wasm64 browser acceleration layer inspects a translated block and accepts
  only a small supported opcode subset.
* Accepted blocks are emitted as standalone WebAssembly functions.
* Generated functions receive a compact execution context: register storage,
  guest RAM access hooks or memory views, helper-call trampolines, and exit
  metadata.
* Unsupported opcodes, helper calls, fault-prone memory paths, runtime
  compilation failure, validation failure, cache mismatch, or disabled
  acceleration return to the existing TCI bytecode.

The first production acceleration must therefore start with a narrow block
class rather than a whole backend.  Hot-block evidence points at integer moves,
loads, stores, arithmetic, branches, extraction, and barriers.  The safe first
candidate is a pure-register straight-line block or a block whose memory
accesses can be routed through the same checked QEMU load/store helpers as
TCI.  Direct guest RAM access may be added only after the cache key and memory
invalidation rules are explicit.

Generated blocks call back into QEMU only through explicit imports.  Helper
imports must be typed, bounded, and counted so the browser proof can report
how many blocks used generated execution and how many fell back to TCI.  The
generated code must not bypass QEMU's existing exception, interrupt, MMU,
watchpoint, or device-memory behavior.  If a block cannot preserve those
semantics, it is not eligible for generated execution.

Guest RAM access has two acceptable early forms:

* checked helper calls that delegate to QEMU's existing TCI load/store helpers;
* later, a validated fast path for RAM-only pages after the TB cache key tracks
  page identity, permissions, dirty/invalidation state, and memory-region
  generation.

Block lookup and invalidation must be conservative.  A generated block cache
key must include at least target architecture, QEMU build/runtime ABI, TCG
opcode subset version, guest PC, code segment base, flags, cflags, translated
size, instruction count, page identity or invalidation generation, and the
helper/import ABI version.  Any mismatch rejects the generated block and runs
TCI.  A QEMU TB flush must make matching generated blocks unreachable before
they can execute again.

The browser APIs required by the first implementation are deliberately small:

* ``WebAssembly.validate`` for rejecting malformed generated modules;
* ``WebAssembly.compile`` or ``WebAssembly.instantiate`` for compiling a
  standalone function module;
* JavaScript ``BigInt`` for ``i64`` parameters and results;
* later, worker-local caching so module compilation does not block the browser
  UI thread.

TCI fallback invariant:

* acceleration is disabled unless an explicit option enables it;
* every TB has a TCI representation before a generated block may be attempted;
* unsupported IR, validation errors, browser runtime errors, helper ABI
  mismatches, cache misses, stale invalidation generations, or execution
  exceptions increment fallback counters and run TCI;
* generic serial boot, service-bridge smoke, display/input plumbing, and
  downstream Bus Engine OS proof must keep working with acceleration disabled.

Before wiring generated execution into QEMU, the branch carries a standalone
prototype that emits and executes tiny generated WebAssembly functions in
Node.js and Chromium.  That prototype proves browser support, result typing,
compile latency measurement, and result JSON shape without affecting normal
guest execution.

The first standalone prototype is
``scripts/ci/wasm-generated-block-prototype.mjs`` with focused helper tests in
``scripts/ci/wasm-generated-block-prototype-test.mjs``.  It emits a 68-byte
WebAssembly module with two exported functions: ``add64(i64, i64) -> i64`` to
prove JavaScript ``BigInt`` result handling, and ``mix32(i32) -> i32`` to
exercise a tiny straight-line integer block repeatedly.  This is not yet a
QEMU execution path; it is the browser/runtime proof that generated modules
can be produced, validated, compiled, instantiated, measured, and represented
as machine-readable evidence before TCG integration.

Accepted prototype evidence on 2026-07-01:

* ``node scripts/ci/wasm-generated-block-prototype-test.mjs`` passed.
* ``node scripts/ci/wasm-generated-block-prototype.mjs --runtime node
  --iterations 10000 --out
  /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-prototype-node.json``
  passed on Node.js ``v22.19.0``.  The 68-byte module validated, compiled in
  about 0.60 ms, instantiated in about 0.05 ms, and executed 10,000 ``mix32``
  calls in about 1.60 ms.
* ``QEMU_WASM_CHROMIUM_EXECUTABLE=/home/coding-agent/coding-agent/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
  node scripts/ci/wasm-generated-block-prototype.mjs --runtime browser
  --iterations 10000 --timeout-ms 30000 --out
  /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-prototype-browser.json``
  passed in Chromium ``149.0.7827.55``.  The same module validated, compiled
  in about 1.20 ms, instantiated in about 0.10 ms, and executed 10,000 calls
  in about 1.30 ms.

The next step is to move from this standalone proof to the first QEMU
execution hook: a tiny opt-in generated-block path selected from hot-block
evidence, with counters for generated execution, rejection, and fallback to
TCI.
