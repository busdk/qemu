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

The same local artifact path is now available as a repeatable helper command::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /tmp/qemu-wasm64-tci-artifacts \
    --build-image

The helper checks for Docker, optionally builds
``qemu/emsdk-wasm64-cross:latest``, copies the source tree into the container,
configures the CI-equivalent ``x86_64-softmmu`` wasm64 TCI/SDL build, copies
``qemu-system-x86_64.js`` and ``qemu-system-x86_64.wasm`` to the requested
output directory, writes ``qemu-system-wasm-artifacts.json`` with
``scripts/ci/wasm-artifact-manifest.py``, verifies the x86_64 target pair, and
writes ``SHA256SUMS``.  ``--dry-run`` prints the exact Docker commands without
running them.

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
  * ``node scripts/ci/wasm-native-persistent-disk-proof-test.mjs`` validates
    the native emulator-level proof predicate and option checks.
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

  ``scripts/ci/wasm-native-persistent-disk-proof.mjs`` provides an
  emulator-level proof for the same guest-visible block-device contract when
  browser artifacts are unavailable.  It runs native
  ``qemu-system-x86_64`` twice with the same write/verify initramfs pair,
  attaches the rootfs as a read-only virtio block device, attaches a separate
  writable raw disk as the persistent device, verifies that the write run
  starts from an empty disk and the verify run reloads the existing disk file,
  and compares SHA-256 hashes for both the immutable rootfs and persistent
  disk.  This proof does not replace OPFS browser evidence, but it gives
  deterministic local coverage for the virtio-blk/rootfs immutability contract
  while the stronger browser OPFS proof depends on wasm64 build artifacts.

  Local emulator-level proof on 2026-07-01 used native QEMU 11.0.1 on macOS
  with ``-cpu Nehalem`` and ``microvm,acpi=off``.  The proof command prepared
  the pinned TuxBoot guest in a disposable Debian container because the macOS
  host lacked ``debugfs``, generated write and verify initramfs images with
  ``wasm-build-smoke-initramfs.py --persistent-disk-smoke write|verify``, and
  ran::

    node scripts/ci/wasm-native-persistent-disk-proof.mjs \
      --qemu-system /opt/homebrew/bin/qemu-system-x86_64 \
      --cpu Nehalem \
      --kernel /private/tmp/qemu-wasm-smoke-cache/tuxboot-x86_64-bzImage \
      --rootfs /private/tmp/qemu-native-persistent-disk-guest/tuxboot-x86_64-rootfs.ext4 \
      --write-initrd /private/tmp/qemu-native-persistent-disk-guest/persistent-disk-write.cpio.gz \
      --verify-initrd /private/tmp/qemu-native-persistent-disk-guest/persistent-disk-verify.cpio.gz \
      --persistent-disk-path /private/tmp/qemu-native-persistent-disk-guest/persistent-nehalem-4.raw \
      --persistent-disk-size-bytes 1048576 \
      --out /private/tmp/qemu-native-persistent-disk-guest/native-persistent-disk-proof-nehalem-4.json \
      --timeout-ms 180000

  Result
  ``/private/tmp/qemu-native-persistent-disk-guest/native-persistent-disk-proof-nehalem-4.json``
  passed.  The write boot observed
  ``QEMU_WASM_PERSISTENT_DISK_WRITE_OK`` and
  ``QEMU_WASM_LINUX_BOOT_OK`` in 1194 ms; the verify boot observed
  ``QEMU_WASM_PERSISTENT_DISK_VERIFY_OK`` and
  ``QEMU_WASM_LINUX_BOOT_OK`` in 1139 ms.  Linux detected the immutable root
  disk as ``/dev/vda`` and the persistent disk as ``/dev/vdb`` in both boots.
  The immutable rootfs SHA-256 stayed
  ``1d426a6b31f1a9da8476e3b106bedf854840863b9ca0823e513a2ac2ab64e699`` before
  and after the two boots.  The persistent disk SHA-256 changed from the empty
  1 MiB raw image
  ``30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`` to
  ``caf7bb1ce5ac1017d29704166f8f24c77b1e975b31ac0c9e94a75c515f944d7e`` after
  write and remained that value after verify.

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

An O3/no-LTO/no-debug-info artifact was measured as a final compiler-flag
sanity check before spending more time on generated execution.  The build kept
QEMU assertions enabled because upstream QEMU rejects ``NDEBUG``, disabled QOM
cast debugging, disabled debug info, and used Meson ``-Doptimization=3``
without LTO.  The resulting artifact produced ``qemu-system-x86_64.js``
SHA-256
``088c177d4e2099d187052008ee32203f4b5a8fc481cb6ce4d2eb7659ddfc04a4`` and
``qemu-system-x86_64.wasm`` SHA-256
``cbf01416613890e67629a642bfbcb41266f095f8d33bd991c524966133dbe9db``.
Generic Chromium ``149.0.7827.55`` smoke wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-o3-nodebug-nohot.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``98467`` ms.  The same-browser O2
comparison from the branch-to-terminal experiment reached the marker in
``95502`` ms, and the earlier O3/LTO result reached it in ``79973`` ms.
Therefore O3/no-LTO compiler flags are rejected as the current performance
solution and do not justify a long Bus Engine OS proof run.

An O3/LTO/no-debug-info artifact was then measured to verify whether the
earlier O3/LTO generic result could be combined with the supported no-debug
artifact shape.  The build used Meson ``-Doptimization=3``, ``--enable-lto``,
``--disable-debug-info``, and ``--disable-qom-cast-debug``.  It produced
``qemu-system-x86_64.js`` SHA-256
``ba64e96e2b1422a38e5c03142995e1896217b1ec33b0cb0cb7fa1327af67ec4a`` and
``qemu-system-x86_64.wasm`` SHA-256
``a5e36ff9cd8d831bee410b1d9e504956553a541e9662480b597ca982f630bb84``.
Generic Chromium ``149.0.7827.55`` smoke wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-o3-lto-nodebug.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``101664`` ms.  This is slower than
the current strict-TCI generic baseline around ``81626`` ms, so this
compiler-flag shape is rejected and no long Bus Engine OS proof was run.
Compiler-flag tuning is no longer a useful path for this goal unless new
profiling evidence identifies a specific compiler or runtime bottleneck.

Generated-block cache safety and observability
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

After the generated-memory and branch experiments, the opt-in generated-block
path still needed a safer cache boundary before larger native wasm64 TCG work.
The live generated path now keys entries by the TCI bytecode pointer plus a
64-bit signature of the current bytecode and terminal target, caps the browser
module cache at 4096 entries with FIFO eviction, recompiles stale
pointer/signature entries, and reports ``generated_cache_hits`` plus
``generated_cache_stale`` in the existing TCI subset summary.  Deterministic
Node coverage in ``scripts/ci/wasm-generated-block-prototype-test.mjs`` checks
cache hit, miss, stale replacement, eviction, invalid keys, invalid
signatures, and missing compile callbacks.

The rebuilt wasm64 artifact
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/cache-signature`` produced:

* ``qemu-system-x86_64.js`` SHA-256
  ``14cdafd3e03999d458b64c8afa5200d656fd512f26741e2b09058b2bc6581ef1``
* ``qemu-system-x86_64.wasm`` SHA-256
  ``4810087084f0d1ad3fa32752675deb4d871e03344b9caa2e359bfc16e2af66e0``

Generic Chromium ``149.0.7827.55`` smoke with the default path wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-cache-signature-default.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``94207`` ms.  The same artifact
with the opt-in subset wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-cache-signature-subset.json``
and reached the same marker in ``96794`` ms with ``generated_compiled=3``,
``generated_executed=2394``, ``generated_cache_hits=2391``,
``generated_cache_stale=0``, and dominant generated fallback still ``ld32u``.
This result is accepted as cache correctness and observability foundation, but
not as the Bus Engine OS performance fix.  No long Bus Engine OS proof was run
because the cheap generic opt-in gate remained slower than the default path.

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
``scripts/ci/wasm-generated-block-prototype-test.mjs``.  It first emitted a
68-byte WebAssembly module with two exported functions: ``add64(i64, i64) ->
i64`` to prove JavaScript ``BigInt`` result handling, and ``mix32(i32) ->
i32`` to exercise a tiny straight-line integer block repeatedly.  It now emits
a 267-byte module that adds structured control-flow proofs: conditional exits
to dispatch, an internal loop with a dispatch exit, and an explicit imported
helper-fallback path.  This is not yet a QEMU execution path; it is the
browser/runtime proof that generated modules can be produced, validated,
compiled, instantiated, measured, and represented as machine-readable evidence
before TCG integration.

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

Accepted control-flow model evidence on 2026-07-01:

* ``node scripts/ci/wasm-generated-block-prototype-test.mjs`` passed with
  coverage for signed LEB immediates, generated branch exits, loop exits,
  helper fallback counters, accepted label/branch/dispatch shapes, and
  rejection of missing labels, raw/internal TCI pointer returns, helper calls
  without TCI fallback, and non-dispatch exits.
* ``node scripts/ci/wasm-generated-block-prototype.mjs --runtime node
  --iterations 10000 --out
  /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-control-flow-node.json``
  passed on Node.js ``v22.19.0``.  The 267-byte module validated, compiled in
  about 0.77 ms, instantiated in about 0.08 ms, and executed 10,000 ``mix32``
  calls in about 1.41 ms while also proving ``branchExit``,
  ``countdownExit``, and ``helperGate`` results.
* ``QEMU_WASM_CHROMIUM_EXECUTABLE=/home/coding-agent/coding-agent/.cache/ms-playwright/chromium-1194/chrome-linux/chrome
  NODE_PATH=/tmp/qemu-playwright/node_modules
  node scripts/ci/wasm-generated-block-prototype.mjs --runtime browser
  --iterations 10000 --timeout-ms 30000 --out
  /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-control-flow-browser.json``
  passed in Chromium ``141.0.7390.37``.  The same module validated, compiled
  in about 1.40 ms, instantiated in about 0.10 ms, and executed 10,000 calls
  in about 2.30 ms.

Accepted subset differential evidence on 2026-07-01:

* The prototype now exports ``subsetBlock(i32, i32) -> i64``.  It covers a
  small generated opcode/control-flow subset: ``i32.add``, ``i32.eqz``,
  dispatch-style conditional exit selection, ``i32.xor``, ``i32.and``, and the
  same explicit helper fallback import model used by ``helperGate``.
* The JavaScript reference path ``interpretGeneratedSubset()`` computes the
  same packed dispatch result as a TCI-like interpreter for five signed and
  wrapping input cases, including ``-1 + 1`` and ``0x7fffffff + 1``.
* ``node scripts/ci/wasm-generated-block-prototype.mjs --runtime node
  --iterations 10000 --out
  /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-subset-differential-node.json``
  passed on Node.js ``v22.19.0`` with ``subsetDifferentialMismatches=0``.
  The 328-byte module validated, compiled in about 0.78 ms, instantiated in
  about 0.08 ms, and executed 10,000 ``mix32`` calls in about 1.34 ms.
* ``QEMU_WASM_CHROMIUM_EXECUTABLE=/home/coding-agent/coding-agent/.cache/ms-playwright/chromium-1194/chrome-linux/chrome
  NODE_PATH=/tmp/qemu-playwright/node_modules
  node scripts/ci/wasm-generated-block-prototype.mjs --runtime browser
  --iterations 10000 --timeout-ms 30000 --out
  /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-subset-differential-browser.json``
  passed in Chromium ``141.0.7390.37`` with
  ``subsetDifferentialMismatches=0``.  The same module validated, compiled in
  about 0.80 ms, instantiated in about 0.10 ms, and executed 10,000 calls in
  about 1.00 ms.

This still is not a QEMU guest execution hook.  The next implementation step
is to wire a matching opt-in subset into QEMU's wasm64 browser execution path
and prove the generic Chromium Linux smoke with nonzero generated execution
counters before using it for Bus Engine OS evidence.

Current QEMU hook evidence on 2026-07-01:

* The branch contains an opt-in ``QEMU_TCI_WASM_SUBSET=1`` proof path in
  ``tcg/tci.c`` with matching browser smoke runner flags and result parsing.
  It is disabled by default, threshold-gated, and reports
  ``qemu-tci-wasm-subset`` summary lines.
* The hook prevalidates the accepted TCI block shape before executing
  side-effectful helper-backed memory operations.  Unsupported blocks still
  fall back to normal TCI.
* A rebuilt wasm64 ``x86_64-softmmu`` artifact produced hashes
  ``b9c1b4294196c2666ebe415b0034b230ad0cb3f49f74585e13d3217fe3bd7807``
  for ``qemu-system-x86_64.js`` and
  ``b105c4af963b90b85a1bf3af39185faaa53ba2d074f4af3fba5e30e521d760f3``
  for ``qemu-system-x86_64.wasm``.
* The default disabled-path regression smoke reached
  ``QEMU_WASM_LINUX_BOOT_OK``:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-subset-default-regression.json``.
* The enabled subset smoke also reached ``QEMU_WASM_LINUX_BOOT_OK``:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-current-full.json``.
  It is not accepted acceleration yet.  With threshold ``1`` it reported
  ``executed=0``, ``fallback_unsupported=339999``, and top unsupported
  blockers ``goto_tb``, ``call``, and ``brcond``.
* A diagnostic run with direct TB chaining disabled reached the marker and
  finally executed accepted complete blocks:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-nochain.json``
  reported ``executed=12787``.  That run was slower than the normal smoke
  path, so ``-d nochain`` is not a product performance fix.  It proves the
  current subset machinery can execute complete blocks and that normal
  execution is blocked first by ``goto_tb``/TB-dispatch semantics.
* A follow-up added helper-call and remaining arithmetic support.  The rebuilt
  artifact hashes were
  ``dedd3fe899335ade5f5b1b571c28f144d26a3f0fb7f8fe61e07133bd244908e9``
  for ``qemu-system-x86_64.js`` and
  ``e3bcabb190970983a1abeac60a5c96411b4b0d56e562cd76e18fbc3b087c202b``
  for ``qemu-system-x86_64.wasm``.
* The default disabled-path smoke reached ``QEMU_WASM_LINUX_BOOT_OK``:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-subset-extra-ops-default.json``.
* The normal subset-enabled smoke also reached ``QEMU_WASM_LINUX_BOOT_OK``
  without ``-d nochain``:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-extra-ops.json``.
  It reported ``executed=84850`` and ``fallback_unsupported=255064``.
  Remaining top fallback opcodes were ``goto_tb``, ``goto_ptr``, ``brcond``,
  ``tci_movcond32``, ``rotr``, and ``tci_rotl32``.

The next proof step is now downstream timing, not more generic-smoke
plumbing.  Run the Bus Engine OS ``virtual-server`` browser proof with the
opt-in subset enabled and compare marker-to-marker timing against the current
baseline.  If it still does not reach multi-user/service readiness, promote
the next measured blocker into the plan.  The generic smoke suggests the
likely remaining QEMU execution boundary is ``goto_tb``/``goto_ptr`` plus
remaining branch/control-flow shapes, but the Bus Engine OS proof must confirm
that before more implementation work.

Rejected tiny TCI bytecode shortcut
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

An initial local experiment tried to avoid a full control-flow model by
inspecting TCI bytecode from ``tcg/tci.c`` and compiling only tiny hot blocks
or straight-line prefixes into standalone WebAssembly modules through an
Emscripten ``EM_JS`` helper.  This was deliberately kept opt-in and was tested
against the generic Chromium Linux smoke before any Bus Engine OS proof.

The result rejected that shortcut:

* ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-fast-current.json``
  reached ``QEMU_WASM_LINUX_BOOT_OK`` in Chromium, but generated execution
  counters stayed at zero.  The top unsupported TCI opcodes were
  ``tci_setcond32`` followed by ``mb`` and ``tci_movl``.
* After adding ``tci_setcond32`` decoding, the generic smoke still reached the
  marker with zero generated execution.  The next unsupported opcode was
  ``brcond``.
* A prefix-return variant that executed register-only work and returned an
  internal TCI pointer for the interpreter to continue was not safe enough.
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-fast-prefix.json``
  aborted, and
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-fast-prefix-nomem.json``
  timed out with an unaligned-access trap before the generic marker.

This proves two useful constraints for the next implementation:

* The first useful generated execution path must understand proper
  translated-block control flow.  Returning arbitrary internal TCI bytecode
  addresses to the interpreter is not an accepted boundary.
* Direct host-memory ``ld``/``st`` shortcuts through JavaScript are not part of
  the first safe slice.  Memory work needs helper-backed semantics or a later
  validated RAM-only path with explicit alignment, fault, and invalidation
  handling.

The next CPU acceleration patch should therefore implement a real generated
block control-flow model with deterministic differential tests before it is
measured against the generic Chromium smoke again.  If later attribution shows
a paravirtual device boundary rather than CPU execution as the blocker, the
optimization should move behind the matching QEMU device/backend instead of
reopening this EM_JS prefix shortcut.

Generated-block control-flow model gate
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The first accepted follow-up is a deterministic model gate for generated
block control flow, implemented in the standalone generated-block prototype
rather than in the live QEMU execution path.  The gate records the semantics
that the rejected shortcut lacked:

* branch targets must resolve to internal labels known to the generated block;
* generated exits must leave through a TB-dispatch boundary, not through an
  arbitrary TCI bytecode pointer;
* helper calls are accepted only when the block shape records explicit
  fallback to the existing TCI path;
* missing labels, raw pointer exits, helper calls without fallback, and
  unknown operation kinds reject the generated block before execution.

The model is intentionally small.  It does not claim to be the final wasm64
TCG backend, and it does not wire generated execution into QEMU.  Its purpose
is to make the next implementation step testable before another browser smoke
run can regress.  `scripts/ci/wasm-generated-block-prototype.mjs` exports
``GENERATED_BLOCK_CONTROL_FLOW_MODEL_VERSION`` and
``validateGeneratedBlockControlFlow()``.  The focused test file
``scripts/ci/wasm-generated-block-prototype-test.mjs`` covers:

* a valid branch-to-label block ending at TB dispatch;
* a helper-call shape that falls back to TCI;
* rejection for a missing branch target;
* rejection for returned internal TCI pointers;
* rejection for helper calls without explicit TCI fallback;
* rejection for exits that do not use TB dispatch.

The accepted local validation command is::

  node --check scripts/ci/wasm-generated-block-prototype.mjs
  node scripts/ci/wasm-generated-block-prototype-test.mjs

Both commands passed on 2026-07-01 after the model gate was added.

Differential subset proof
~~~~~~~~~~~~~~~~~~~~~~~~~

The next prerequisite before wiring generated execution into QEMU is a small
differential subset that compares a generated WebAssembly block against an
independent JavaScript oracle.  This keeps the proof outside live QEMU
execution while exercising the control-flow shape that the rejected shortcut
did not have.

The prototype now exports ``packDispatchResult(status, value)`` and
``interpretGeneratedSubset(arg0, arg1)``.  The generated WebAssembly module
exports ``subsetBlock(arg0, arg1)`` with the same behavior:

* add two signed 32-bit inputs with i32 wraparound;
* if the sum is zero, return dispatch status ``1`` with value ``100``;
* otherwise return dispatch status ``2`` with the low byte of
  ``sum ^ 0x55``;
* encode dispatch status and value in the same 64-bit packed result shape as
  the rest of the prototype.

The focused test covers five cases: normal positive inputs, a zero-sum path,
byte wraparound, larger inputs, and signed overflow.  The accepted local
validation commands are::

  node --check scripts/ci/wasm-generated-block-prototype.mjs
  node scripts/ci/wasm-generated-block-prototype-test.mjs
  node scripts/ci/wasm-generated-block-prototype.mjs --runtime node \
    --iterations 10000 --out \
    /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-differential-node.json
  NODE_PATH=/tmp/qemu-playwright/node_modules \
  QEMU_WASM_CHROMIUM_EXECUTABLE=/home/coding-agent/coding-agent/.cache/ms-playwright/chromium-1194/chrome-linux/chrome \
  node scripts/ci/wasm-generated-block-prototype.mjs --runtime browser \
    --iterations 10000 --timeout-ms 30000 --out \
    /tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-differential-browser.json

Both runtime probes passed on 2026-07-01 with
``subsetDifferentialMismatches=0``.  Node.js ``v22.19.0`` compiled the
328-byte module in about 0.89 ms and Chromium ``141.0.7390.37`` compiled it
in about 1.10 ms.  This is not yet live QEMU acceleration.  It is the
deterministic differential gate that the next opt-in QEMU execution hook must
preserve before the generic Chromium Linux smoke can be used as the runtime
regression gate.

Context-pointer TB ABI prototype
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The failed live generated-block experiments showed that passing sixteen
``BigInt`` register arguments and receiving eighteen ``BigInt`` results is not
the right long-term execution boundary.  The reference ``qemu-wasm``
``wasm64-tcg-b`` branch uses a small context pointer passed into a generated
TB function.  QEMU state is shared through memory, and the TB function returns
through a direct dispatcher boundary.

The standalone prototype now includes that shape without changing live QEMU
execution.  The generated module imports linear memory from ``env.memory`` and
exports ``contextBlock(ctxPtr)``.  The function:

* reads two 64-bit register slots at ``ctxPtr + 0`` and ``ctxPtr + 8``;
* adds them in generated WebAssembly;
* stores the 64-bit result at ``ctxPtr + 16``;
* returns a packed dispatch result with status ``5`` and the low 32 bits of
  the result.

Accepted evidence on 2026-07-01:

* ``node --check scripts/ci/wasm-generated-block-prototype.mjs`` passed.
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs`` passed.
* Node.js ``v22.19.0`` proof
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-context-node.json``
  passed with ``moduleBytes=399``, ``contextBlockResult=21474836522``, and
  ``contextBlockStored=42``.
* Chromium ``141.0.7390.37`` proof
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-block-context-browser.json``
  passed with the same context result and stored value.

This is not a Bus Engine OS performance fix yet.  It is the accepted ABI
prototype for replacing the EM_JS generated-block helper shape with a native
TB function boundary that can later be wired into an opt-in wasm64 backend or
QEMU-side generated-TB path while preserving strict TCI fallback.

Opt-in wasm64 TCI subset execution evidence
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The first live QEMU execution hook is intentionally still conservative.  It is
not the final generated WebAssembly backend.  It is an opt-in wasm64 TCI
subset proof inside the QEMU WebAssembly binary, selected with
``QEMU_TCI_WASM_SUBSET=1`` through the browser smoke runner
``--tci-wasm-subset`` option.  Cold translation blocks remain on normal TCI,
unsupported blocks are permanently marked for fallback, and the subset
validates reachable forward paths before executing blocks that can perform
local or MMU helper-backed memory operations.

The current supported live subset covers straight-line and forward-branching
TCI blocks using moves, local loads/stores, MMU ``qemu_ld``/``qemu_st``
helpers, libffi helper calls, common integer ALU operations, selected count,
rotate, movcond, and byte-swap operations, memory barriers, ``exit_tb``, and
terminal ``goto_tb``/``goto_ptr`` dispatch.  The dispatch path deliberately
does not return raw linked-TB code pointers to ``cpu_tb_exec``.  Instead it
returns an internal ``tcg_qemu_tb_exec`` status so the TCI frame can continue
at the linked target, preserving the existing TCI control-flow boundary.

Accepted local validation for this slice on 2026-07-01:

* ``node --check scripts/ci/wasm-browser-smoke.mjs`` passed.
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs`` passed.
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` passed.
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs`` passed.
* ``git diff --check`` passed.
* The wasm64 ``x86_64-softmmu`` artifact rebuilt successfully with
  ``docker run --rm -v ... qemu/emsdk-wasm64-cross:latest emmake make -j20
  qemu-system-x86_64.js`` in ``build-wasm64-nodebug-nohot``.

The rebuilt artifact hashes are:

* ``qemu-system-x86_64.js`` =
  ``dedd3fe899335ade5f5b1b571c28f144d26a3f0fb7f8fe61e07133bd244908e9``
* ``qemu-system-x86_64.wasm`` =
  ``98f615687766cfb27477af6e6a0d989084d92987dea509dd1dd0faf888c7ed09``

The generic Chromium smoke with the subset disabled reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-dispatch-ops-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-dispatch-ops-default.png``
* elapsed: ``80039`` ms

The generic Chromium smoke with the subset enabled reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-dispatch-ops.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-dispatch-ops.png``
* Chromium: ``141.0.7390.37``
* elapsed: ``91534`` ms
* final subset counters: ``attempts=72000000``, ``executed=56973162``,
  ``fallback_cold=6444667``, ``fallback_unsupported=8577811``
* remaining top unsupported operation: ``brcond``

The downstream Bus Engine OS ``virtual-server`` microvm proof still timed out
before ``Reached target Multi-User System.`` and
``QEMU_WASM_SERVICE_READY``, so the full goal is not complete:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-dispatch-ops.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-dispatch-ops.png``
* elapsed: ``420237`` ms
* final subset counters: ``attempts=236000000``, ``executed=152524448``,
  ``fallback_cold=64768794``, ``fallback_unsupported=18694499``
* remaining top unsupported operation: ``brcond``

This is still not sufficient for the full Bus Engine OS readiness goal.  It is
useful progress because the measured blocker moved: ``goto_tb`` and
``goto_ptr`` no longer appear in the top unsupported operations after terminal
dispatch support, and the remaining top unsupported operation is ``brcond``.
The next QEMU-side work is therefore not OPFS, networking, display, input, or
WebCrypto.  It is side-effect-safe ``brcond`` support for hot subset blocks,
with validation strict enough that QEMU does not restart normal TCI after
partially executing side-effectful operations.

Follow-up evidence with a wider validation window on 2026-07-01 kept the
subset opt-in but changed the default ``QEMU_TCI_WASM_SUBSET_MAX_OPS`` and
browser harness default from ``64`` to ``512``.  This is the maximum accepted
window already enforced by the runner and validator, and the previous result
showed no ``max_ops_rejected`` pressure.

The rebuilt artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``700ae01fe2a06ce86cdd7989556245dc664c5cdf83ba0755b4af11f23399ba66``
* ``qemu-system-x86_64.wasm`` =
  ``de11a3fed950420dfc1871bbca88e5a27b667505ab83e08474fe09373f546703``

Validation commands passed:

* ``git diff --check``
* ``node --check scripts/ci/wasm-browser-smoke.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``

Generic Chromium ``141.0.7390.37`` smoke with the subset disabled reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-max512-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-max512-default.png``
* elapsed: ``81626`` ms

Generic Chromium smoke with ``--tci-wasm-subset`` and no explicit
``--tci-wasm-subset-max-ops`` override also reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-max512-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-max512-default.png``
* elapsed: ``86959`` ms
* final subset counters: ``attempts=72000000``, ``executed=65159611``,
  ``fallback_cold=6680304``, ``fallback_unsupported=147287``,
  ``brcond_bad_target=7481``, ``brcond_backward=761``
* remaining top unsupported operation: ``brcond``

The downstream Bus Engine OS ``virtual-server`` microvm proof with the same
artifact and default ``512``-op subset window still timed out before
``Reached target Multi-User System.`` and ``QEMU_WASM_SERVICE_READY``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-max512-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-max512-default.png``
* elapsed: ``420333`` ms
* last serial line:
  ``systemd[1]: Load Kernel Module fuse skipped, unmet condition check ConditionKernelModuleLoaded=!fuse``
* final subset counters: ``attempts=241000000``, ``executed=174939800``,
  ``fallback_cold=65979484``, ``fallback_unsupported=73921``,
  ``brcond_bad_target=700``, ``brcond_backward=5479``
* remaining top unsupported operation: ``brcond``

This wider window is accepted as a small opt-in acceleration-path improvement
because it reduces unsupported fallback by orders of magnitude compared with
the previous ``64``-op default.  It is not the full Bus Engine OS boot
solution because the downstream guest still times out before readiness.

A conservative side-effect-free backward-``brcond`` experiment was built and
tested, then removed.  It kept generic Chromium smoke passing, but it did not
accept any useful safe loop body:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-brcond-safe.json``
* elapsed: ``93182`` ms
* final subset counters: ``attempts=72000000``, ``executed=65063722``,
  ``fallback_cold=6768273``, ``fallback_unsupported=156066``,
  ``brcond_backward_safe=0``, ``brcond_backward_unsafe=1860``
* top unsupported operations: ``brcond`` and ``st8``

That result rejects the shortcut: the remaining loop shapes include
side-effectful operations, so the next valid branch-control implementation
needs a proper generated-block loop/control-flow model or fresh evidence that
another QEMU-side boundary has become dominant.

A follow-up RAM-only replay experiment on 2026-07-01 used ``probe_access()``
for ``qemu_ld`` and ``qemu_st`` operations and a bounded store journal for
local and RAM stores before falling back to TCI.  This proved that QEMU can
classify many real backward branches as replay-safe without committing device
or MMIO side effects, but it did not solve the measured boot problem.

The rebuilt artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``abcdad6c42b0c384b18e5c1cb932ca2a61161c67a2e7beb1fb2c47338a94676a``
* ``qemu-system-x86_64.wasm`` =
  ``a842e329148b46717692c93134d04a3eb97c2eb16d02dbe3fc129f0fda43b688``

Generic Chromium ``141.0.7390.37`` smoke with the subset disabled reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-store-journal-qemu-ram-default.json``
* elapsed: ``85201`` ms

Generic Chromium smoke with the subset enabled also reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-store-journal-qemu-ram.json``
* elapsed: ``90688`` ms
* final subset counters: ``attempts=72000000``, ``executed=65137365``,
  ``fallback_cold=6822219``, ``fallback_unsupported=28663``,
  ``brcond_backward_safe=4217``, ``brcond_backward_unsafe=1``

A threshold-``1`` generic run removed cold fallbacks but was slower, reaching
the same marker in ``95473`` ms:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-tci-wasm-subset-store-journal-qemu-ram-threshold1.json``
* final subset counters: ``attempts=72000000``, ``executed=71933868``,
  ``fallback_cold=0``, ``fallback_unsupported=49794``,
  ``brcond_backward_safe=11497``

The downstream Bus Engine OS ``virtual-server`` microvm proof still timed out
before ``Reached target Multi-User System.`` and
``QEMU_WASM_SERVICE_READY``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-subset-store-journal-qemu-ram.json``
* elapsed: ``420228`` ms
* final subset counters: ``attempts=240000000``, ``executed=173584564``,
  ``fallback_cold=66385502``, ``fallback_unsupported=24048``,
  ``brcond_backward_safe=4304``, ``brcond_backward_unsafe=20``
* progress sample evidence showed early systemd mount setup, but not
  multi-user readiness.

This rejects committing the RAM replay-journal path as the current performance
fix.  It is useful diagnostic evidence because it proves loop replay can be
made precise for RAM-only accesses, but the C interpreter replay path still
does not produce the required downstream boot-readiness improvement.  The next
implementation must either provide actual generated WebAssembly execution for
hot TBs, or add fresh attribution proving that another QEMU-side boundary has
become dominant.

Generated WebAssembly straight-line slice
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted step on 2026-07-01 added the first live generated
WebAssembly execution path inside the opt-in TCI subset gate.  This is still
not a full TCG backend.  It is a narrow generated-block proof for hot,
straight-line, side-effect-free TCI blocks that end at ``exit_tb`` or
``goto_tb``.  Unsupported shapes continue through the existing C subset path
and then normal TCI fallback.

The implementation builds a small WebAssembly module per accepted TB in the
browser worker, caches unsupported generated shapes in C after the first
classification, and records generated-specific counters in the existing
``qemu-tci-wasm-subset`` summary JSON.  The default path remains unchanged
unless ``QEMU_TCI_WASM_SUBSET=1`` is enabled.

The final rebuilt artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``3c0cf09128f97248346d180b843f3b20f714fa4ceef4c422de1a369fa5071e68``
* ``qemu-system-x86_64.wasm`` =
  ``678a2c5a805afb684b45feccdb4583c3048c285cf7872a0536dd415f5c590900``

Validation commands passed:

* ``git diff --check``
* ``node --check scripts/ci/wasm-browser-smoke.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``

Generic Chromium ``141.0.7390.37`` smoke with the subset disabled reached
``QEMU_WASM_LINUX_BOOT_OK``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-opcounters-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-opcounters-default.png``
* elapsed: ``82256`` ms

Generic Chromium smoke with ``--tci-wasm-subset`` also reached the marker:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-opcounters-subset.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-opcounters-subset.png``
* elapsed: ``89034`` ms
* final subset counters: ``attempts=72000000``, ``executed=64993772``,
  ``fallback_cold=6899614``, ``fallback_unsupported=94420``
* generated counters: ``generated_compiled=38``,
  ``generated_executed=27657``, ``generated_compile_failed=0``
* generated-specific blockers: ``ld32u`` with ``690150`` classifications and
  ``st8`` with ``386``
* broader subset blocker: ``brcond`` with ``10624`` unsupported fallbacks

The downstream Bus Engine OS ``virtual-server`` microvm proof with the same
artifact still timed out before ``Reached target Multi-User System.`` and
``QEMU_WASM_SERVICE_READY``:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-generated-opcounters-subset.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-tci-wasm-generated-opcounters-subset.png``
* elapsed: ``420223`` ms
* last serial line: ``systemd[1]: Mounting Huge Pages File System...``
* generated counters: ``generated_compiled=135``,
  ``generated_executed=1301928``, ``generated_compile_failed=0``
* generated-specific blockers: ``ld32u`` with ``5018171`` classifications and
  ``st8`` with ``69``
* broader subset blocker: ``brcond`` with ``7968`` unsupported fallbacks

This is accepted as the first real generated WebAssembly execution slice
because the generated path executed in both generic Chromium smoke and the
downstream Bus Engine OS proof while preserving fallback.  It does not close
the full Bus Engine OS boot-readiness goal.  The next generated-execution
implementation should add a safe linear-memory access model for the measured
``ld32u`` blocker, with explicit fallback for unsupported, faulting, or
side-effectful memory cases.  The broader control-flow path still needs
``brcond`` support before the C subset fallback can shrink substantially.

On the same day, a follow-up experiment tested whether a narrow memory helper
would make that next step useful.  The experiment was not promoted.  A rebuilt
``build-wasm64-nodebug-nohot`` artifact first added a generated-block import
for host-memory ``ld32u``.  Generic Chromium ``149.0.7827.55`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` with the subset enabled and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-memory-subset.json``,
but elapsed time was ``105717`` ms.  The same rebuilt artifact with the subset
disabled wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-memory-default.json``
and reached the marker in ``99884`` ms.  The helper removed ``ld32u`` from the
dominant generated fallback list, but the run was slower and the next generated
blocker became ``tci_setcond32``.

A second unpromoted variant added native generated ``tci_setcond32`` WebAssembly
comparisons.  It reached the generic marker and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-memory-setcond-subset.json``,
but took ``108723`` ms.  Generated fallback then shifted to ``brcond`` and
``st8`` while generated execution did not increase.  This evidence rejects
per-operation JavaScript memory helper calls as the next performance fix unless
new measurements contradict the result.  Future CPU work should either use a
lower-overhead shared-memory import model or attack the measured control-flow
boundary directly, with default and subset runs captured from the same rebuilt
artifact and browser version.

A narrower follow-up first tried to avoid the per-load JavaScript callback by
importing ``Module.wasmMemory`` into each generated ``ld32u`` block.  That
experiment was also rejected.  The rebuilt artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``50aef5028941ce4eedabbe6675d485e810b1c4b7d8be7db4c9602e4431b0ae25``
* ``qemu-system-x86_64.wasm`` =
  ``280fee79206958044aeb98d544e6b1ab7753d6b26ce778413ad3629b80ebebac``

Default Chromium ``141.0.7390.37`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``81075`` ms and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-native-ld32u-default-fresh.json``.
The subset run also reached the marker, but took ``113677`` ms and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-native-ld32u-subset.json``.
Its final counters had ``generated_compiled=0``, ``generated_executed=0``,
and ``generated_compile_failed=27627``.  The generated Emscripten JavaScript
showed why: ``wasmMemory`` is an internal runtime variable in this artifact
shape, while ``Module.wasmMemory`` is listed as unexported.  The generated
submodules therefore did not receive the real QEMU memory object.

This proves ``Module.wasmMemory`` is not the right ABI for generated memory
loads in the current artifact shape.

A second direct-memory variant imported the internal Emscripten ``wasmMemory``
object into generated wasm64 blocks.  That fixed the compile-failure mode, but
still did not produce a performance win.  The rebuilt artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``18f690b5dcb99d4cff6fe6caa78e89af5aec87770f2ee06c5a84c4f9160919b7``
* ``qemu-system-x86_64.wasm`` =
  ``2bce0f78365aae4d6a08af09c29cfc78a7f425892c1758f2d7d20875f14f788b``

Default Chromium ``141.0.7390.37`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``81487`` ms and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-native-ld32u-wasmmemory-default.json``.
The subset run also reached the marker, but took ``115358`` ms and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-native-ld32u-wasmmemory-subset.json``.
Its final counters had ``generated_compiled=26153``,
``generated_executed=54146``, and ``generated_compile_failed=0``.  That proves
the internal ``wasmMemory`` import can instantiate and execute generated
memory-load blocks, but the extra generated-module overhead still regressed
wall-clock time and the dominant generated fallback remained
``tci_setcond32``.  The live ``ld32u`` patch was removed.  Do not promote
generated memory loads as the current performance solution unless new
evidence removes this overhead and improves the same-artifact generic smoke.

One more unpromoted direct-memory variant tested the broader host-memory
opcode set directly inside the live generated path.  It added generated
support for ``ld8u``, ``ld8s``, ``ld16u``, ``ld16s``, ``ld32u``, ``ld32s``,
``ld``, ``st8``, ``st16``, ``st32``, and ``st`` and added deterministic
signed/unsigned direct-memory prototype coverage.  The rebuilt artifact
``/tmp/qemu-wasm64-generated-direct-memory`` had hashes:

* ``qemu-system-x86_64.js`` =
  ``5e789189fbf0d251a63578d0b2b866997b22411437cbec3518d3a4c6a57de1ed``
* ``qemu-system-x86_64.wasm`` =
  ``ab3d385c4e2745e26c7f3eba9fbe9148816cd6c5968e217fb56fef6987a0fbaf``

Default Chromium ``149.0.7827.55`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``79106`` ms and wrote
``/tmp/qemu-wasm64-generated-direct-memory/generic-browser-smoke-default.json``.
The opt-in generated subset reached the same marker in ``109920`` ms and
wrote
``/tmp/qemu-wasm64-generated-direct-memory/generic-browser-smoke-subset.json``.
It compiled generated blocks (``generated_compiled=30271``), executed some
generated blocks (``generated_executed=59544``), and had no generated compile
failures, but the new direct-memory counters stayed at
``generated_direct_load_ops=0`` and ``generated_direct_store_ops=0``.  The
dominant generated fallback was ``tci_setcond32`` with ``5348494``
classifications, followed by ``mb``.

The patch was removed.  This confirms that direct host-memory opcode support
is not the current performance fix for the generic smoke gate.  The next
CPU-side speed work should continue through the broader backend/control-flow
boundary and should not reintroduce direct-memory shortcuts without fresh hot
block evidence showing that they are selected and can beat strict TCI.

The next unpromoted variant changed the generated-block ABI from many
JavaScript ``BigInt`` arguments and result values to direct register-memory
access.  Generated blocks imported QEMU's shared wasm64 memory and accepted
``(regsPtr, retPtr) -> i32``.  The goal was to remove the expensive JS
argument/result array crossing while keeping the opt-in generated path behind
``QEMU_TCI_WASM_SUBSET=1``.

This ABI was valid but still not fast enough.  The rebuilt artifact
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-reg-memory`` had hashes:

* ``qemu-system-x86_64.js`` =
  ``89e592ef6362274edca161ff27022119de381f6af97b4b5ec74e189c360014e2``
* ``qemu-system-x86_64.wasm`` =
  ``9519be1f6e0abb732c28578962d6df80590df01140b55ba9eb2b61bf5e5e7bb1``

Default Chromium ``149.0.7827.55`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``95836`` ms.  The opt-in subset smoke reached
the marker in ``97142`` ms with ``generated_compiled=3``,
``generated_executed=1528``, ``generated_cache_hits=1525``, and dominant
generated fallback still at ``ld32u``.  This proved direct register-memory
access but did not improve wall-clock time, so no Bus Engine OS long proof was
run.

Extending the same ABI to generated ``ld32u`` and ``st8`` was rejected more
strongly because it destabilized the default artifact.  The rebuilt artifact
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-reg-memory-ld32u`` had
hashes:

* ``qemu-system-x86_64.js`` =
  ``23bcb1c1fd1876426a03061404798f499b7e14d878ff65770ed7ad383a92a991``
* ``qemu-system-x86_64.wasm`` =
  ``32f57a5aec19db059c42e7f4102473c59511c98303fe7ca117b8a4bdf77af650``

Two default Chromium smoke runs timed out after ``240000`` ms with
``page.evaluate: Target crashed`` before guest boot milestones were reported.
Because the default strict-TCI path must remain stable even when generated
execution is disabled, the ``ld32u``/``st8`` direct-memory patch was removed.
The next native wasm64 TCG attempt must pass the default generic Chromium gate
first, then show an opt-in generic speedup before it is measured against the
downstream Bus Engine OS boot path.

A separate control-flow experiment then tested a narrower generated
``brcond`` shape without any JavaScript memory helper.  The unpromoted patch
accepted only forward branches whose target was an in-block ``exit_tb`` or
``goto_tb`` terminal, emitted an early WebAssembly ``return`` for the taken
branch, and rejected every other branch before execution.  Generic Chromium
``149.0.7827.55`` smoke passed, but did not produce a speedup.  The default
same-artifact run wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-brcond-terminal-default.json``
and reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``95502`` ms.  The subset run wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-brcond-terminal-subset.json``
and reached the marker in ``104833`` ms.  Generated counters still reported
``ld32u`` as the dominant generated fallback with ``854356`` classifications.
This rejects the narrow branch-to-terminal generated path as the current
performance fix; a useful generated path needs to cover the measured memory
and control-flow shapes together without adding per-operation helper overhead.
It also means opcode coverage alone is not sufficient evidence for the next
implementation patch.  A CPU-side acceleration patch must either improve the
generic Chromium smoke path or be backed by fresh attribution showing why the
generic slowdown is not relevant to the Bus Engine OS boot path.  A
paravirtual or browser-API patch must be tied to a measured QEMU device or
backend boundary rather than to plausible browser technology alone.

Coverage Gate For Backend Proofs
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The branch now includes a small machine-readable coverage gate for deciding
whether a wasm64 backend profile covers enough measured hot-block work to
justify a browser proof.  ``scripts/ci/wasm-tcg-coverage-gate.mjs`` reads a
browser smoke result JSON file, extracts the latest ``qemu-tcg-hotblocks``
summary, compares ``top_tci_ops`` against a named lowering profile, and reports
supported and unsupported top-op counts plus a supported ratio.

Two profiles are currently defined:

* ``deterministic`` tracks the executable backend-shaped lowering probe in
  ``wasm-tb-module-emitter.mjs``.
* ``planned-hotblock`` tracks the broader operation family from the recorded
  Bus Engine OS hot-block evidence: ``tci_movi``, ``st``, ``ld``, ``add``,
  ``brcond``, ``mb``, related load/store and set-condition operations, and QEMU
  load/store fallback operations.  This profile is a planning gate, not a
  claim that the live backend already lowers every operation.

Verification on 2026-07-02:

.. code-block:: console

  node --check scripts/ci/wasm-tcg-coverage-gate.mjs
  node --check scripts/ci/wasm-tcg-coverage-gate-test.mjs
  node scripts/ci/wasm-tcg-coverage-gate-test.mjs

This utility does not accelerate QEMU by itself.  It prevents the next browser
proof from being selected by intuition alone: a backend slice should first show
that its named lowering profile covers the current measured hot-op family, then
the rebuilt artifact must still pass the strict default generic Chromium smoke
and beat the opt-in generic speed gate before a long Bus Engine OS proof is
meaningful.

The helper also supports repeated ``--require-op`` arguments.  A proof can use
that to require individual measured hot operations such as ``ld``, ``st``,
``mb``, and ``tci_setcond32`` even when the aggregate coverage ratio would
otherwise pass.  Result JSON reports ``requiredOps`` and
``missingRequiredOps`` and fails the gate when any required operation is
missing.

The deterministic emitter also gained executable differential coverage for raw
imported-memory load/store and memory-barrier shapes from the measured hot-op
set.  The generated and interpreted paths now agree for ``ld_mem_i64``,
``st_mem_i64``, and a no-op ``mb`` lowering in both existing branch cases.  The
probe stores and reloads ``0x1122334455667788`` and reports
``directLoadOps=2``, ``directStoreOps=2``, and ``memoryBarrierOps=2``.
Follow-up coverage added ``setcond_i32`` lowering for the measured
``tci_setcond32`` family.  The probe compares ``0x100000001`` with ``1`` to
prove 32-bit truncation and reports ``setcond32Ops=2``.  That is why the
deterministic coverage profile can count measured hot ``ld``, ``st``, ``mb``,
and ``tci_setcond32`` operations.  Verification:

.. code-block:: console

  node --check scripts/ci/wasm-tb-module-emitter.mjs
  node --check scripts/ci/wasm-tb-module-emitter-test.mjs
  node scripts/ci/wasm-tb-module-emitter-test.mjs
  node --check scripts/ci/wasm-tcg-coverage-gate-test.mjs
  node scripts/ci/wasm-tcg-coverage-gate-test.mjs

A later opt-in C interpreter peephole fused the adjacent
``tci_setcond32``/``brcond`` shape because that pair was known to be hot.  The
experiment preserved the ``tci_setcond32`` destination register, skipped only
the immediately following branch dispatch when the branch source register
matched, and otherwise fell back to normal TCI.  It was active but slower.  The
rebuilt artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``9167e1c7dc95b99c4da48210f22fa0c55dfb8a4a14ddcbf0e03239dc91561911``
* ``qemu-system-x86_64.wasm`` =
  ``dc922919841e83a438f523caf42ce0413eb75395b2b83ba453e2a2fa81e123f4``

Default Chromium ``149.0.7827.55`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``87638`` ms.  The fused path reached the same
marker in ``91578`` ms with ``attempts=72400000``, ``executed=72399999``, and
``reg_mismatch=0``.  A summary-interval-``1`` diagnostic timed out from
excessive logging after proving the path active with ``2481138`` attempts and
``2481137`` executions.  The patch was removed.  This hot pattern exists, but
single-op C interpreter fusion does not beat default TCI.  Do not spend more
work on narrow adjacent-op interpreter peepholes unless a measurement first
shows they can improve the generic Chromium smoke gate.

Two refreshed Bus Engine OS runs then used the accepted max-512 artifact
(``qemu-system-x86_64.js`` SHA-256
``700ae01fe2a06ce86cdd7989556245dc664c5cdf83ba0755b4af11f23399ba66`` and
``qemu-system-x86_64.wasm`` SHA-256
``de11a3fed950420dfc1871bbca88e5a27b667505ab83e08474fe09373f546703``), the
accepted downstream kernel SHA-256
``3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920``, and the
accepted rootfs SHA-256
``5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e``.
The first run wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-current-attribution-20260701.json``
and timed out after ``420194`` ms.  The last guest-origin line was
``systemd[1]: Load Kernel Module fuse skipped, unmet condition check ConditionKernelModuleLoaded=!fuse``.
The TCI subset summary reported ``attempts=244000000``,
``executed=174460225``, ``fallback_cold=69414765``,
``fallback_unsupported=110081``, and top unsupported op ``brcond``.  The second
run lowered the performance-attribution interval and wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-current-attribution-interval1000-20260701.json``.
It timed out after ``420165`` ms with last guest-origin line
``Mountpoint-cache hash table entries: 1024 (order: 1, 8192 bytes, linear)``
and TCI subset counters ``attempts=110000000``, ``executed=98857540``,
``fallback_cold=483940``, ``fallback_unsupported=37461``, and top unsupported
op ``brcond``.  Both runs recorded zero performance-attribution summaries.
This is not enough to close the attribution item.  It keeps the known evidence
pointing at CPU/interpreter progress, but the next attribution proof must use
an artifact or interval that actually emits device/backend summaries, or
explicitly prove that no measured QEMU device boundary is active before the
guest stalls.

The attribution gap was then fixed by adding a time-based
``qemu_perf_attrib_poll()`` path.  The poll is called from the low-frequency
TCI wasm-subset summary path, so CPU-bound browser runs can emit attribution
summaries even when device event counts stay below the event interval and QEMU
does not exit before the browser harness timeout.  The browser harness was
also corrected to treat ``qemu-wasm-perf-attrib:`` lines as instrumentation
rather than guest-origin progress.

The rebuilt artifact produced ``qemu-system-x86_64.js`` SHA-256
``f890fb7cb7b6469df6b21ffc0e129a4f2e35d166e2aac34a77a096dd5ce1a412`` and
``qemu-system-x86_64.wasm`` SHA-256
``d869e74146dbd4fe0b89aa6ce1b476dfa7ea0b003175850c6bb2c795a422f0d3``.
Generic Chromium ``149.0.7827.55`` smoke wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-perf-time-poll.json``,
reached ``QEMU_WASM_LINUX_BOOT_OK``, and recorded three time-based
performance-attribution summaries.

The downstream Bus Engine OS proof wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-attribution-time-poll-20260701.json``
and still timed out after ``420211`` ms before multi-user/service readiness.
It recorded ``perfCount=13``.  The final attribution summary at QEMU elapsed
``391824`` ms reported ``events=0``, ``virtio_notifies=0``, and zero block,
RNG, serial, network, display, input, and other device counters.  The final
TCI subset summary reported ``attempts=232000000``,
``executed=231826121``, ``fallback_cold=147870``,
``fallback_unsupported=12026``, top unsupported op ``brcond``, and generated
fallbacks ``ld32u=18058`` plus ``st8=16``.  This closes the attribution gap:
current evidence says the next implementation remains CPU execution
acceleration, not OPFS, networking, graphics, input, WebCrypto, or another
device/browser backend.

Timeout-only proof runs are not enough to accept performance changes, because
they do not show whether the guest reached the same boot phase earlier or
later.  The browser smoke harness therefore records first-seen boot
milestones in result JSON.  The current milestone set covers the Linux kernel
version line, root block device discovery, root filesystem mount, init/systemd
start, hostname configuration, journald, udev, systemd basic target,
multi-user target, login prompt, and the service readiness marker.  The
result contains both ordered entries and a by-id map so long Bus Engine OS
runs can compare marker-to-marker timing even when the final readiness marker
is not reached.  Any future QEMU execution optimization must compare these
milestones against the accepted 420 second timeout baseline before claiming a
speedup or regression.

The first milestone comparison used Chromium ``149.0.7827.55`` with
``qemu-system-x86_64.js`` SHA-256
``d2f298574e0b504cb497582121c660a1180247b6f74ba2b675ad5e3731bc2cb3``
and ``qemu-system-x86_64.wasm`` SHA-256
``9753379b4acc70b597a2ba8e893993a9b1eea0450792a1fd1dae51cd1a31d750``.
The strict TCI run
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-milestones-nosubset-20260701.json``
timed out after ``420212`` ms, but reached the Linux kernel line at
``50379`` ms, the ``/dev/vda`` root block device at ``73455`` ms, rootfs
mount at ``91960`` ms, init at ``93323`` ms, systemd hostname setup at
``104290`` ms, the udev control socket at ``341751`` ms, and journald start
at ``392463`` ms.

The same fixture with the opt-in TCI wasm subset enabled wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-milestones-20260701.json``
and timed out after ``420218`` ms.  It reached the kernel at ``51991`` ms,
``/dev/vda`` at ``78095`` ms, rootfs mount at ``99131`` ms, init at
``100719`` ms, hostname setup at ``112798`` ms, the udev socket at
``368029`` ms, and journald start at ``419497`` ms.  Forcing threshold ``1``
in
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-milestones-threshold1-20260701.json``
was worse: it reached only hostname setup by ``181391`` ms and the last
guest line was ``systemd[1]: Freezing execution.``.  The current subset and
generated-block path is therefore diagnostic infrastructure, not an accepted
performance fix.  The fastest measured path for this Bus Engine OS fixture is
still strict TCI, and the largest measured delay is between systemd hostname
setup and early udev/journald progress.

An extended strict-TCI run then wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-strict-tci-long-20260701.json``
and timed out after ``900211`` ms in Chromium ``149.0.7827.55``.  It still did
not reach ``Reached target Multi-User System.`` or
``QEMU_WASM_SERVICE_READY``.  The milestones were stable relative to the
shorter strict-TCI run: kernel at ``50102`` ms, ``/dev/vda`` at ``74689`` ms,
rootfs mount at ``94953`` ms, init at ``96404`` ms, hostname at ``108319`` ms,
udev socket at ``348413`` ms, and journald start at ``397506`` ms.  The final
guest line was ``systemd-journald[75]: Received client request to flush
runtime journal.`` and progress samples showed no further guest-origin output
through the final ``900218`` ms sample.  This changes the next investigation:
the current fixture is not merely slightly slower than the five-minute target;
it fails to reach multi-user within 15 minutes.  The next proof needs more
guest-phase visibility after journald, before another opcode-coverage
experiment is justified.

A broad systemd console-debug run was rejected as a diagnostic shape because
it changed the guest behavior: with
``systemd.log_level=debug systemd.log_target=console`` and related console
logging arguments, the guest idled immediately after ``Run /sbin/init as init
process`` and never reached the normal hostname milestone.  More focused
unit-masking diagnostics were more useful.

Masking only ``systemd-journal-flush.service`` wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-strict-tci-mask-journal-flush-20260701.json``
and timed out after ``600217`` ms.  That run got past the previous final
journald flush line and ended at ``systemd[1]:
systemd-hwdb-update.service: Consumed 15.668s CPU time over 1min 27.096s
wall clock time, 1.3M memory peak.``.  Masking both
``systemd-journal-flush.service`` and ``systemd-hwdb-update.service`` wrote
``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-strict-tci-mask-journal-hwdb-20260701.json``
and still timed out after ``600197`` ms, ending at ``systemd[1]: Listening on
System Extension Image Management.``.

These diagnostics point at ordinary guest boot workload under slow
browser-hosted TCI rather than a single stuck root filesystem mount.  Journal
flush, hwdb update, and sysext-related startup are visible expensive phases.
The next useful work should either define a downstream browser-hosted Bus
Engine OS boot profile that prebuilds or disables unnecessary one-shot
preparation services, or produce a QEMU CPU execution improvement that beats
strict TCI on the same marker-to-marker measurements.

The next production-shaped baseline used the non-debug artifact from
``/tmp/qemu-wasm-generated-only-isolation``.  The artifact hashes were
``qemu-system-x86_64.js``
``d08902173814be81e8783530e3537177b96fba6267ef01734de5d13b65a040d5`` and
``qemu-system-x86_64.wasm``
``00cd2b141d965607e4836880d4ac8f17014d9178e9115f85466026ba0f1b03a0``.
The Bus Engine OS fixture used microvm kernel
``3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920``,
PC kernel
``cdf8945cfc3cef3bcefbc78fe4b82a4b07af0d04da1ac48a8a0013a27899ee0d``,
and rootfs
``5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e``.

Chromium ``149.0.7827.55`` still did not reach multi-user/service readiness
with that artifact.  The ``microvm,acpi=off`` run
``/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-baseline.json``
reached the kernel line at ``53157`` ms, ``/dev/vda`` at ``74801`` ms, rootfs
mount at ``95878`` ms, init at ``97268`` ms, and systemd hostname at
``109431`` ms, then idled until the run failed at ``290450`` ms.  Adding
``virtio-rng-device`` wrote
``/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-rng-baseline.json``
and kept the same failure shape, with hostname at ``108412`` ms and timeout at
``290448`` ms.  The PC/virtio-pci comparison
``/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-pc-baseline.json``
also idled after hostname, reaching ``/dev/vda`` at ``130119`` ms, rootfs at
``141655`` ms, init at ``143414`` ms, hostname at ``158334`` ms, and timeout at
``340481`` ms.

A final ``microvm`` run with hot-block flags wrote
``/tmp/qemu-wasm-generated-only-isolation/bus-engine-os-virtual-server-current-rng-hotblocks.json``
and reproduced the same post-hostname idle, with hostname at ``106328`` ms and
timeout at ``290420`` ms.  It recorded ``summaryCount=0`` because the
production-shaped artifact does not include the opt-in hot-block
instrumentation path.  This default-path evidence does not justify another
guessed optimization.  The next QEMU-side task is focused post-hostname
progress visibility that works on the non-debug browser artifact and
distinguishes guest CPU progress from a missing interrupt, timer, block,
serial, or virtio event without changing guest boot behavior through broad
systemd console-debug settings.

Guest-progress idle diagnostic
==============================

On 2026-07-01 the browser smoke harness gained a guest-origin progress
channel alongside raw serial output.  The page-side smoke state records
``guestLines``, ``guestOutputBytes``, and ``guestLastLine`` after filtering
out QEMU instrumentation lines such as ``qemu-tci-wasm-subset:`` and
``qemu-tcg-hotblocks:``.  The runner exposes ``--guest-idle-timeout-ms`` and
``--guest-idle-after-text`` so long browser runs can fail when Linux stops
printing guest-origin progress even if QEMU itself continues to emit profiling
or subset summaries.

The focused Bus Engine OS microvm run used the existing safe artifact:

* ``qemu-system-x86_64.js`` =
  ``700ae01fe2a06ce86cdd7989556245dc664c5cdf83ba0755b4af11f23399ba66``
* ``qemu-system-x86_64.wasm`` =
  ``de11a3fed950420dfc1871bbca88e5a27b667505ab83e08474fe09373f546703``

The guest manifest selected ``machine=microvm,acpi=off``,
``rootfsDevice=virtio-mmio``, and ``root=/dev/vda``.  Linux detected the
root filesystem as a virtio-blk disk at ``/dev/vda`` and mounted the ext4
rootfs before systemd started, so this diagnostic does not point at the
rootfs block-device path.

The diagnostic result was:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-guest-idle-diagnostic.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-guest-idle-diagnostic.png``
* outcome: guest-origin serial output idle for ``90001`` ms
* raw serial lines: ``1426``
* guest-origin lines: ``1263``
* final raw line: a ``qemu-tci-wasm-subset`` summary
* final guest-origin line:
  ``systemd[1]: Mounting bpf (bpf) on /sys/fs/bpf (MS_NOSUID|MS_NODEV|MS_NOEXEC "mode=0700")...``

A follow-up run added ``systemd.mask=sys-fs-bpf.mount`` to the kernel command
line, and the result still stopped at the same guest-origin line:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-mask-bpf-guest-idle.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/bus-engine-os-service-microvm-mask-bpf-guest-idle.png``
* outcome: guest-origin serial output idle for ``90002`` ms
* final guest-origin line: the same ``/sys/fs/bpf`` mount message

This evidence changes the immediate blocker classification.  QEMU is still
executing and producing instrumentation summaries, and the virtio-blk rootfs
path has already worked.  The next downstream Bus Engine OS work is to fix or
prove the BPF filesystem mount path, including enabling ``CONFIG_BPF_FS`` in
the virtual kernels and rebuilding the proof kernel.  A separate heartbeat
source is still useful, but the harness must treat heartbeat markers as
liveness evidence rather than boot-progress evidence so a stuck mount or
systemd unit still fails quickly with the last non-heartbeat progress marker.

Heartbeat liveness markers
==========================

On 2026-07-01 the browser smoke harness added explicit accounting for
``bus-engine-os-heartbeat:`` serial markers emitted by downstream Bus Engine
OS diagnostic boots.  The page state records ``guestHeartbeat.count``,
``guestHeartbeat.lastLine``, and ``guestHeartbeat.lastElapsedMs``.  Progress
samples include a ``guestHeartbeatDelta`` so long runs can show that the
guest-side heartbeat is still active.

Heartbeat markers are intentionally excluded from ``guestLines``,
``guestOutputBytes``, and ``guestLastLine``.  That separation is required for
failed boot runs: a kernel or early userspace heartbeat can prove that the
emulated guest is still executing, but it must not reset the boot-progress
idle timer.  A guest stuck at a mount unit such as ``/sys/fs/bpf`` should
still fail quickly with that mount line as the final non-heartbeat progress
marker.

C-side generated-block prevalidation
====================================

On 2026-07-01 the opt-in generated TCI subset path gained C-side
prevalidation before entering the JavaScript ``EM_JS`` helper.  The
prevalidation computes a content-aware signature for the TCI bytecode pointer,
clears stale generated-unsupported decisions when the same pointer receives
different contents, rejects unsupported generated opcodes in C, and preserves
strict TCI fallback.

The rebuilt artifact was produced with
``scripts/ci/wasm-build-artifacts-local.py`` and wrote:

* ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-prevalidate/qemu-system-x86_64.js``
* ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generated-prevalidate/qemu-system-x86_64.wasm``

The artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``14cdafd3e03999d458b64c8afa5200d656fd512f26741e2b09058b2bc6581ef1``
* ``qemu-system-x86_64.wasm`` =
  ``74128a37de5ff666f95fc0413fd5fdae47c66f91f47348c68cb0b89be80ce450``

Generic Chromium ``141.0.7390.37`` smoke with the default path reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``81611`` ms:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-prevalidate-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-prevalidate-default.png``

The same smoke with ``--tci-wasm-subset`` reached the marker in ``90736`` ms:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-prevalidate-subset.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-generated-prevalidate-subset.png``
* final counters: ``generated_compiled=4``, ``generated_executed=16774``,
  ``generated_cache_hits=16770``, ``generated_compile_failed=0``
* remaining generated fallbacks: ``ld32u=2431`` and ``st8=1``

This patch is accepted as safe instrumentation and fallback cleanup, but it is
rejected as a performance solution.  The opt-in generated path remained slower
than the default path on the generic smoke gate, so no Bus Engine OS long proof
was run from this artifact.

Direct C-callable generated block boundary
==========================================

The next measured experiment moved the live opt-in generated path away from a
per-execution ``EM_JS`` helper call.  Accepted register-only TCI blocks are
compiled once into a generated WebAssembly function, the function-table pointer
is cached in the C-side subset entry, and C calls the generated function with a
single context pointer containing the register-array and return-slot pointers.
Unsupported blocks, validation failures, compile failures, and disabled
execution still fall back to strict TCI.

The rebuilt artifact was produced with
``scripts/ci/wasm-build-artifacts-local.py`` and wrote:

* ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-tb-func/qemu-system-x86_64.js``
* ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/direct-tb-func/qemu-system-x86_64.wasm``

The artifact hashes were:

* ``qemu-system-x86_64.js`` =
  ``2d06ef25db9698c4815ec274f67c450db7fc4c73ff982e1bd746a36eebf1ef84``
* ``qemu-system-x86_64.wasm`` =
  ``b167b063c5345d33cf3ebb8a0347f2bde611d6458bb5fc1c73bbff5f8f9a4d10``

Generic Chromium ``141.0.7390.37`` smoke with the default path reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``78079`` ms:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-direct-tb-func-default.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-direct-tb-func-default.png``

The same smoke with ``--tci-wasm-subset`` reached the marker in ``90199`` ms:

* result:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-direct-tb-func-subset.json``
* screenshot:
  ``/tmp/qemu-wasm64-tci-hotblocks-artifacts/generic-browser-smoke-direct-tb-func-subset.png``
* final counters: ``generated_compiled=6``, ``generated_executed=14501``,
  ``generated_cache_hits=14495``, ``generated_compile_failed=0``
* remaining generated fallbacks: ``ld32u=2538`` and ``st8=1``

This proves that the direct C-callable function-table boundary is viable, but
it is not a performance solution.  The opt-in path remained slower than the
default path on the generic smoke gate, so no Bus Engine OS long proof was run
from this artifact.  Further generated-execution work should not add another
isolated opcode shortcut until coverage evidence shows that the generated path
can cover enough hot execution to beat strict TCI.

Generated-subset coverage decision
==================================

The live generated-subset experiments now have enough evidence to close the
tiny TCI-subset expansion lane.  The direct C-callable proof compiled and
executed generated WebAssembly functions, but in the generic Chromium smoke it
covered only ``17040`` generated attempts out of ``72400000`` subset attempts
(``0.0235%``), and only ``14501`` generated executions out of ``53808998``
executed subset blocks (``0.0269%``).  That coverage is too small to offset
the generated-module and dispatch overhead.

The earlier downstream Bus Engine OS proof with the first live generated-WASM
slice had more generated execution, with ``generated_executed=1301928``, but it
still timed out before multi-user readiness and left ``ld32u`` as the dominant
generated fallback with ``5018171`` classifications.  Later memory, branch,
direct register-memory, and direct C-callable variants kept the default path
safe but failed the generic speed gate.

The next CPU-side implementation must therefore move beyond isolated TCI
opcode shortcuts.  A useful follow-up needs broader generated-block or
backend-shaped execution that covers the memory and control-flow shapes seen
in hot blocks, preserves strict TCI fallback, and beats the strict-TCI generic
Chromium smoke before any Bus Engine OS long proof is meaningful.  If a fresh
measurement points away from CPU execution, the next optimization must sit
behind the matching QEMU device or browser-backend boundary.

Next backend-shaped implementation path
=======================================

The reference ``ktock/qemu-wasm`` ``origin/wasm64-tcg-b`` branch was inspected
as research material for the next implementation step.  The useful pieces are
not the exact forked code shape, but the execution boundary:

* ``tcg/wasm64.c`` provides a runtime that keeps a TCI fallback path for cold
  or unsupported translation blocks.
* ``tcg/wasm64.h`` defines a ``WasmContext`` passed to generated TB functions
  and a ``WasmTBHeader`` that stores the TCI pointer, generated WebAssembly
  bytes, helper imports, execution counters, and per-thread instance records.
* ``tcg/wasm64/tcg-target.c.inc`` emits WebAssembly modules with
  ``env.memory``, a ``start(ctx)`` function, helper imports, global register
  state, label/block patching, memory64-aware load/store encoding, helper-call
  lowering, and terminal TB dispatch.
* Hot TBs are instantiated only after a threshold.  The runtime calls them
  through the browser function table and evicts old instances with
  ``removeFunction()`` plus GC tracking.

This confirms that the next upstreamable BusDK/QEMU step should be a gated
``tcg/wasm64`` backend skeleton, not another live TCI-subset opcode shortcut.
The skeleton should first carry the context/header/lifetime model and
deterministic module-emitter tests.  Instruction lowering should then advance
in testable slices: integer ALU and moves, labels and terminal exits,
host-memory loads/stores for measured hot shapes, helper-call imports, and
QEMU load/store helper fallback for MMU or fault paths.  The backend remains
experimental until default generic Chromium smoke is unchanged and the opt-in
backend path beats the strict-TCI generic smoke gate.

Gated wasm64 backend skeleton
=============================

The first backend-shaped implementation step adds a fail-closed skeleton.  A
new Meson option, ``tcg_wasm64_backend``, defaults to ``false``.  The option is
accepted only for wasm64 hosts, is mutually exclusive with
``tcg_interpreter``, and currently stops configuration with an explicit error:
the backend has no instruction lowering yet.  This preserves the existing
Emscripten requirement that wasm64 builds use TCI until the backend is made
runnable.

The skeleton files are:

* ``tcg/wasm64.h`` for the generated-TB context, TB function pointer,
  instance record, and TB header.
* ``tcg/wasm64.c`` for the placeholder runtime boundary.
* ``tcg/wasm64/tcg-target*.h`` and ``tcg/wasm64/tcg-target.c.inc`` for the
  target include directory.

The target source intentionally fails closed if it is included before lowering
exists.  The next accepted step is not a browser boot proof; it is a
deterministic module-emitter test that validates the minimal
``env.memory``/``start(ctx)`` module shape without requiring a full QEMU boot.

Validation on 2026-07-02:

* ``_meson_option_parse --enable-tcg-wasm64-backend`` emits
  ``-Dtcg_wasm64_backend=true``.
* ``python3 scripts/ci/wasm-build-artifacts-local.py --out
  /tmp/qemu-wasm64-backend-skeleton-guard --jobs 1
  --configure-arg=--enable-tcg-wasm64-backend`` fails during Meson setup with
  ``The experimental wasm64 TCG backend and TCG interpreter are mutually
  exclusive``.
* ``python3 scripts/ci/wasm-build-artifacts-local.py --out
  /tmp/qemu-wasm64-backend-skeleton-tci --jobs auto`` built the unchanged
  default wasm64 TCI artifact.
* ``qemu-system-x86_64.wasm`` from that build has SHA-256
  ``b167b063c5345d33cf3ebb8a0347f2bde611d6458bb5fc1c73bbff5f8f9a4d10``.
* Chromium 141 browser smoke reached ``QEMU_WASM_LINUX_BOOT_OK`` in
  ``/tmp/qemu-wasm64-backend-skeleton-tci/generic-browser-smoke-default.json``
  at 80436 ms.  The same run recorded the kernel banner at 31397 ms and init
  at 78824 ms.

Deterministic TB module emitter
===============================

The next backend-shaped step adds a small deterministic module emitter test
without making the backend runnable.  ``scripts/ci/wasm-tb-module-emitter.mjs``
emits a 155-byte generated-TB module with the contract required by the first
real lowering slice:

* import ``env.memory``;
* import helper function ``h.helper0``;
* import guest-memory fallback helpers ``h.qemu_ld_i64`` and
  ``h.qemu_st_i64``;
* export ``start(ctx)``;
* load two i64 fields from the context;
* store their sum back to the context;
* call the helper import;
* store and return the helper dispatch result.

This test is intentionally independent from a full QEMU boot.  It verifies the
module shape and context/helper boundary that the eventual wasm64 backend
should emit for supported translation-block fragments, while strict TCI remains
the only runnable QEMU path.

Validation on 2026-07-02:

* ``node --check scripts/ci/wasm-tb-module-emitter.mjs`` passed.
* ``node --check scripts/ci/wasm-tb-module-emitter-test.mjs`` passed.
* ``node scripts/ci/wasm-tb-module-emitter-test.mjs`` passed.
* ``node scripts/ci/wasm-tb-module-emitter.mjs`` reported ``ok: true``, module
  size 155 bytes, imports ``h.helper0``, ``h.qemu_ld_i64``,
  ``h.qemu_st_i64``, and ``env.memory``, export ``start``, stored sum ``42``,
  helper opcode ``7`` with value ``42``, and helper dispatch result
  ``25769803818``.

The same helper now includes the first executable lowering-subset spec.  It
lowers a small TB operation list to WebAssembly and compares the generated
module against a local interpreter.  The covered operations are ``const_i64``,
``mov_i64``, ``ld_ctx_i64``, ``st_ctx_i64``, ``add_i64``, ``xor_i64``,
``setcond_i64`` for ``eq`` and ``ne``, structured ``block``, ``brcond_i64``,
``end_block``, ``pack_dispatch_i64``, ``helper_i64``, and ``exit_i64`` through
the ``tb-dispatch`` boundary.  The generated lowering-subset module remains
independent from the real QEMU backend; it is an executable contract for the
next C lowering slice.

Validation on 2026-07-02:

* ``node scripts/ci/wasm-tb-module-emitter.mjs`` reported lowering probe
  ``ok: true``.
* The lowering probe module size was 249 bytes and the lowered operation list
  contained 22 operations.
* The lowering probe recorded structured counters:
  ``generatedBlocks=2``, ``helperFallbacks=1``, ``qemuLoadFallbacks=2``, and
  ``qemuStoreFallbacks=2``.
* In the ``branch-taken-skip-helper`` case, generated and interpreted paths
  both returned ``25769803818``, wrote context offsets 16, 24, and 32 as
  ``42``, ``25769803818``, and ``1``, wrote qemu-load fallback result
  ``4294967314`` to offset 40, made no generic helper call, called
  ``qemu_ld_i64`` with address ``4294967296`` and operation index ``18``, and
  called ``qemu_st_i64`` with the same address, result ``25769803818``, and
  operation index ``19``.
* In the ``branch-not-taken-helper`` case, generated and interpreted paths both
  returned ``25769803819``, wrote context offsets 16, 24, and 32 as ``43``,
  ``25769803819``, and ``0``, wrote qemu-load fallback result ``4294967314``
  to offset 40, made helper call opcode ``7`` with value ``43``, called
  ``qemu_ld_i64`` with address ``4294967296`` and operation index ``18``, and
  called ``qemu_st_i64`` with the same address, result ``25769803819``, and
  operation index ``19``.

The C-side skeleton now carries the matching counter boundary for live backend
integration.  ``tcg/wasm64.h`` defines ``TCGWasm64Counters`` for generated
attempts, compiled blocks, executed blocks, cache hits, unsupported fallbacks,
helper fallbacks, QEMU load/store fallbacks, and runtime fallbacks.  It also
defines ``TCGWasm64FallbackReason`` and adds a counter pointer to
``TCGWasm64Context`` so generated TB calls can report execution and fallback
paths through the same one-pointer context ABI.  ``tcg/wasm64.c`` provides
reset, aggregate-add, and fallback-count helpers.  This does not make the
backend selectable yet; it is the C contract needed before helper imports and
memory fallback calls can produce nonzero counters in a browser artifact.

This is still not a runnable wasm64 TCG backend and not a speed improvement.
C backend integration remains required before an opt-in generic smoke speed
gate is meaningful.  The default Chromium smoke gate must be re-run from a
QEMU artifact once the C backend starts affecting runtime builds.

TCI Fallback Architecture Note
==============================

Strict TCI fallback is an execution invariant, not only a Meson dependency.
The current fallback path depends on selecting ``tcg_arch = 'tci'`` so QEMU
generates TCI bytecode and uses the TCI ``tcg_qemu_tb_exec`` ABI.  Selecting
the experimental ``tcg/wasm64`` target directory changes the TCG target ABI and
does not by itself preserve the bytecode stream that the current interpreter
executes.

Therefore, the next runnable acceleration slice must not claim fallback merely
by compiling ``tcg_wasm64_backend`` and ``tcg_interpreter`` together.  A safe
incremental path has two viable shapes:

* keep ``tcg_arch = 'tci'`` and add a generated WebAssembly side path for
  selected validated TCI bytecode blocks, with all unsupported blocks falling
  back to normal TCI; or
* implement a full wasm64 TCG target with its own precise fallback boundary,
  invalidation rules, helper behavior, and generated-block execution ABI.

Until the full backend exists, the performance work should remain on the
first path: TCI bytecode remains the correctness source of truth, and generated
WebAssembly execution is an opt-in acceleration path for measured hot block
families.

Live Generated Lowering Rejection
---------------------------------

On 2026-07-02, an unpromoted runtime slice wired more of the deterministic
lowering subset into the existing live ``tcg/tci.c`` generated-Wasm path.  The
slice added forward non-crossing ``brcond``, local host-memory ``ld``/``st``,
``ld32u``, ``st32``, ``tci_setcond32``, and ``mb`` only when
``QEMU_TCI_RELAXED_MB=1`` was explicitly enabled.  Unsupported branch and
memory shapes still fell back to TCI.

The artifact built successfully with ``scripts/ci/wasm-build-artifacts-local.py``
and produced:

* ``qemu-system-x86_64.js`` =
  ``c0a5e66e96103172c61e6677de99370a535c67070ae461662c17ef813f481b60``
* ``qemu-system-x86_64.wasm`` =
  ``508cbeea55f3561a66066d4c733ce771e5bd53b38f187c52062b6baa0807b8b9``

Generic Chromium smoke with the subset disabled reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``92557`` ms:

* ``/tmp/qemu-wasm-generated-hot-subset/generic-browser-smoke-default.json``
* ``/tmp/qemu-wasm-generated-hot-subset/generic-browser-smoke-default.png``

The opt-in run with ``--tci-wasm-subset --tci-relaxed-mb`` reached the same
marker in ``102346`` ms:

* ``/tmp/qemu-wasm-generated-hot-subset/generic-browser-smoke-subset-relaxed-mb.json``
* ``/tmp/qemu-wasm-generated-hot-subset/generic-browser-smoke-subset-relaxed-mb.png``

The final subset summary recorded ``executed=76978971``,
``generated_compiled=4``, ``generated_executed=933``,
``generated_compile_failed=0``, and remaining generated fallback ``st8=9690``.
The runtime patch was removed because it regressed the generic smoke and did
not create enough generated-Wasm coverage to justify a downstream Bus Engine
OS proof.

The next runtime measurement should isolate generated-Wasm execution from the
slower C subset interpreter.  In that mode, generated-unsupported blocks should
fall back directly to normal TCI.  If generated-only execution still does not
beat default TCI with nonzero generated counters, the current per-block EM_JS
generated-module path should stop expanding and a different measured QEMU-side
acceleration approach should be promoted into ``PLAN.md``.

Generated-Only Isolation Rejection
----------------------------------

On 2026-07-02, the generated-only measurement mode was implemented behind
``QEMU_TCI_WASM_GENERATED_ONLY=1`` and the browser runner flag
``--tci-wasm-generated-only``.  The mode still allows generated-Wasm eligible
blocks to run, but generated-unsupported blocks return directly to the normal
TCI interpreter instead of using the slower C subset path.

The non-debug wasm64 artifact was rebuilt with
``scripts/ci/wasm-build-artifacts-local.py`` and produced:

* ``qemu-system-x86_64.js`` =
  ``d08902173814be81e8783530e3537177b96fba6267ef01734de5d13b65a040d5``
* ``qemu-system-x86_64.wasm`` =
  ``00cd2b141d965607e4836880d4ac8f17014d9178e9115f85466026ba0f1b03a0``

Three generic Chromium smokes used the same artifact, Linux kernel,
initramfs, machine, CPU, memory, and marker:

* default TCI reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``100787`` ms:
  ``/tmp/qemu-wasm-generated-only-isolation/generic-browser-smoke-default.json``
* current subset reached the same marker in ``117284`` ms:
  ``/tmp/qemu-wasm-generated-only-isolation/generic-browser-smoke-subset.json``
* generated-only isolation reached the same marker in ``110353`` ms:
  ``/tmp/qemu-wasm-generated-only-isolation/generic-browser-smoke-generated-only.json``

Generated-only isolation recorded ``generated_compiled=3``,
``generated_executed=1979``, ``generated_cache_hits=1976``, and
``generated_compile_failed=0``.  This proves the isolated generated path can
execute safely with fallback, but it still regresses the default smoke.  The
per-block EM_JS generated-module path should not be expanded as the current
performance solution.  The next QEMU/WASM performance step should re-baseline
the Bus Engine OS ``virtual-server`` guest with the current non-debug artifact
and select the next optimization from measured QEMU/browser attribution rather
than from additional opcode-lowering guesses.

Default-Path TCI Progress Evidence
----------------------------------

On 2026-07-02, the default wasm64 TCI path gained opt-in progress summaries
for production-shaped browser diagnostics.  ``QEMU_TCI_PROGRESS=1`` enables
``qemu-tci-progress`` JSON lines and ``QEMU_TCI_PROGRESS_INTERVAL`` controls
the translation-block entry interval between summaries.  The browser smoke
runner exposes this through ``--tci-progress`` and
``--tci-progress-interval`` and stores bounded summaries under
``result.tci.progress``.  The switch is disabled by default and is separate
from hot-block instrumentation.

The rebuilt non-debug artifact produced:

* ``qemu-system-x86_64.js`` =
  ``b50a8bd1e3be815af1f8e4de8d9cfaa223b3c34bd06b90cd6fb651e8b962a1ae``
* ``qemu-system-x86_64.wasm`` =
  ``58bcbd70d7dae0947a9ee0bb4201b2adf22cb060288f2081733a7db347b5eed7``

Generic Chromium ``149.0.7827.55`` smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``84703`` ms with
``summaryCount=7379``:
``/tmp/qemu-wasm-tci-progress/generic-browser-smoke-tci-progress.json``.
The last summary reported ``tb_entries=73790000`` and
``dispatches=73445713``.

The Bus Engine OS ``virtual-server`` microvm proof used kernel
``3169668b74ef4fae4ca6a54bc5ad334a47e4eaf0c63c236248c9301af1c17920`` and
rootfs ``5452bcc0c6fe0cab89f187e80572bc52174456cc60ed3cb723a8531519a0d22e``.
The strict run wrote
``/tmp/qemu-wasm-tci-progress/bus-engine-os-virtual-server-tci-progress.json``.
It reached the kernel at ``53646`` ms, discovered ``/dev/vda`` at
``76129`` ms, mounted rootfs at ``98146`` ms, started init at ``99593`` ms,
set the hostname at ``111493`` ms, and then failed the guest-origin idle
timeout at ``300460`` ms.  The last TCI progress summary reported
``tb_entries=194000000`` and ``dispatches=192308504`` while the last
guest-origin line remained ``systemd[1]: Hostname set to <bus-engine-os>.``.

The relaxed-memory-barrier comparison wrote
``/tmp/qemu-wasm-tci-progress/bus-engine-os-virtual-server-relaxed-mb-tci-progress.json``.
It reached the same early milestones about six seconds faster and the same
``194000000`` TB-entry count about ``10.3`` seconds earlier, but it still
failed after hostname before multi-user readiness.

This evidence rules out a missing virtio block, RNG, serial, display, timer,
or interrupt event as the immediate post-hostname blocker.  QEMU is still
executing guest CPU work through TCI while guest-origin serial output is
silent.  The next accepted performance patch must therefore improve CPU
execution throughput for this workload, preserve strict TCI fallback, and beat
the strict-TCI generic smoke gate before it is treated as a Bus Engine OS boot
solution.

Opt-In TCI Fast Feature Gates
-----------------------------

On 2026-07-02, the TCI loop gained an opt-in Emscripten-only fast-gate mode.
``QEMU_TCI_FAST_GATES=1`` caches the disabled/enabled state for optional
translation-block boundary diagnostics and generated-subset probes before
entering the interpreter loop.  With the flag disabled, the default path keeps
the previous behavior and still calls the existing default-off feature probes
at each translation-block boundary.  With the flag enabled, disabled optional
features are skipped without repeatedly checking their environment-backed
guards.  The browser smoke runner exposes this through ``--tci-fast-gates``.

The measured artifact was built with Emscripten 4.0.10, wasm64,
``x86_64-softmmu``, TCI, ``-Doptimization=2``, and ``-Ddebug=false``:

* ``qemu-system-x86_64.js`` =
  ``e462c4f543062b271dfca8f7a50f2e6576f1be490b6c558281541e510847c9c6``
* ``qemu-system-x86_64.wasm`` =
  ``f29ecf0bf72cdb5d5fd32bb832d2fb06389bea6d0d1cf5527818fece5a398989``
* manifest =
  ``ee222826732a2887d9d0f3a578e05fc09fbe85c3f61e4f26a5bb749ffae0f0f6``

The same-artifact generic Chromium ``149.0.7827.55`` smoke comparison used
the existing tiny Linux initramfs proof:

* default path:
  ``/tmp/qemu-wasm-fast-gates/generic-browser-smoke-default.json`` reached
  ``QEMU_WASM_LINUX_BOOT_OK`` in ``91269`` ms;
* fast-gates path:
  ``/tmp/qemu-wasm-fast-gates/generic-browser-smoke-fast-gates.json`` reached
  the same marker in ``89291`` ms.

This is a small generic CPU-boundary win, so the opt-in fast-gate plumbing is
kept.  It is not the Bus Engine OS readiness fix.  The downstream Bus Engine
OS ``virtual-server`` proof with the same artifact and ``--tci-fast-gates``
wrote
``/tmp/qemu-wasm-fast-gates/bus-engine-os-virtual-server-fast-gates.json``.
It reached the kernel at ``59737`` ms, discovered ``/dev/vda`` at ``82765``
ms, mounted rootfs at ``110854`` ms, started init at ``112311`` ms, set the
hostname at ``124940`` ms, and then failed the guest-origin idle timeout at
``310470`` ms with the same final guest line:
``systemd[1]: Hostname set to <bus-engine-os>.``  The remaining performance
work is still the post-hostname systemd CPU-throughput gap.

Wasm64 Address-Limited Memory Measurement
-----------------------------------------

On 2026-07-02, the active five-minute Bus Engine OS boot plan measured the
available Emscripten address-limited comparison mode before starting larger
backend work.  QEMU's current WebAssembly host support exposes ``wasm64`` as
the supported CPU family.  The available comparison flag is
``--wasm64-32bit-address-limit``, which configures Emscripten with
``-sMEMORY64=2`` while keeping an 8-byte ``void *`` ABI.  This is useful
memory-mode evidence, but it is not a true ``-sMEMORY64=0`` wasm32 host port.

Two TCI artifacts were built from the same QEMU commit with
``scripts/ci/wasm-build-artifacts-local.py``:

* default wasm64 artifacts in ``/tmp/qemu-w1-wasm64-current``:

  * ``qemu-system-x86_64.js`` =
    ``4dcf436f15651d3b06a350636fa6c480399ea41ab9865c4b17547e8beeb650d0``
  * ``qemu-system-x86_64.wasm`` =
    ``df7a62f60f8baba2c2440c01aa476c69e511191d42a688c8ae91ed22081a7cf3``

* wasm64 address-limited artifacts in
  ``/tmp/qemu-w1-wasm64-32bit-address``:

  * ``qemu-system-x86_64.js`` =
    ``021b10a1aba4417defd1e96fb6e076756fcc7b5da3279b5a7f6d3b0148428dfa``
  * ``qemu-system-x86_64.wasm`` =
    ``42c284fb963e36403a33f5298c6c14ec419486651177225e6962fa78a5565a2e``

Both artifacts were run through the same CI-shaped Chromium browser smoke in
the ``mcr.microsoft.com/playwright:v1.56.1-noble`` image.  Chromium reported
version ``141.0.7390.37`` and ``crossOriginIsolated: true``.  The browser
memory probe accepted the same memory cases for both artifacts: ``22`` passed
and ``10`` failed as expected at the default-address and i64 upper bounds.

The generic Linux smoke used the pinned TuxBoot x86_64 kernel, helper-built
initramfs, ``Nehalem`` CPU, ``512M`` guest memory, no network, and marker
``QEMU_WASM_LINUX_BOOT_OK``.  The default wasm64 artifact reached the marker
in ``97316`` ms and wrote
``/tmp/qemu-w1-smoke-current/wasm-browser-smoke-result.json``.  The
address-limited artifact reached the marker in ``91639`` ms and wrote
``/tmp/qemu-w1-smoke-32bit-address/wasm-browser-smoke-result.json``.

The address-limited mode improved the generic smoke by about ``5.8%``.  That
is below the active plan's ``20%`` decision gate, so the next backend work
continues wasm64-first.  This result does not justify a separate wasm32 host
port as the next step toward the Bus Engine OS five-minute multi-user target,
and it does not change the default artifact family.

Wasm64 Backend Fallback Boundary Build Proof
--------------------------------------------

On 2026-07-02, the experimental ``tcg_wasm64_backend`` path was opened far
enough to build and run through the existing TCI correctness fallback.  The
Meson selection now accepts ``--enable-tcg-wasm64-backend`` on a wasm64 host
without also enabling the public ``tcg_interpreter`` option.  The target uses
the TCI bytecode emitter as its fallback format while native generated-block
lowering grows behind the ``tcg/wasm64.c`` runtime boundary.

The first backend build attempt configured successfully as
``TCG backend: experimental wasm64 with TCI fallback`` but failed while
compiling ``tcg/tci.c`` and ``tcg/tcg.c`` because the reused TCI emitter
referenced TCI target-private opcodes such as ``INDEX_op_tci_movi`` without
the TCI target opcode list being visible to the wasm64 target.  The fix added
``tcg/wasm64/tcg-target-opc.h.inc`` as a thin include of the existing
``tcg/tci/tcg-target-opc.h.inc``.  No duplicate opcode definitions were added.

The accepted build command was::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /tmp/qemu-w2-backend-fallback \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

It produced:

* ``qemu-system-x86_64.js`` =
  ``5dd87847bcfd34019a2c846bf223646d17a23130191789f880dd5bfcba5c3e8a``
* ``qemu-system-x86_64.wasm`` =
  ``20183a4dcd3d577aa62ecc439f9883c977a4d06fa9ba17e7f0b713681d258a40``
* manifest =
  ``66e2e7260e576153f8914f99564d1c28041348808a9e260cff65a56250329987``

The backend-owned ``tcg_qemu_tb_exec()`` now calls a C-visible
``tcg_wasm64_tb_exec()`` boundary with a ``TCGWasm64Context`` shape and then
falls back through a renamed TCI entrypoint for unsupported blocks.  This is a
strict fallback proof, not a native generated-block proof: the current
artifact intentionally records generated attempts and unsupported fallback, but
does not yet instantiate or execute compiled WebAssembly translation blocks.

Verification for this slice:

* ``git diff --check`` passed.
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs`` passed.
* ``node --check scripts/ci/wasm-browser-smoke.mjs`` passed.
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` passed outside the
  sandbox; inside the sandbox, child-process ``spawnSync`` fails with
  ``EPERM`` and leaves stdout/stderr empty.
* The backend artifact passed the CI-shaped Chromium generic Linux smoke in
  ``mcr.microsoft.com/playwright:v1.56.1-noble``.  Chromium reported
  ``141.0.7390.37`` and ``crossOriginIsolated: true``.  The pinned TuxBoot
  kernel/initramfs, ``Nehalem`` CPU, ``512M`` memory, and marker
  ``QEMU_WASM_LINUX_BOOT_OK`` were used.  The marker was reached in
  ``92692`` ms, with result JSON at
  ``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2-smoke-backend-fallback/wasm-browser-smoke-result.json``.

This evidence proves backend selectability, compile/link viability, and
generic smoke preservation with strict fallback.  It does not satisfy the full
backend goal: the next required step is a real generated WebAssembly TB
instance path with nonzero generated execution counters in the browser result
JSON, followed by the same-commit W3 speed gate.

Wasm64 Backend Generated-Context Counter Proof
----------------------------------------------

On 2026-07-02, the backend-gated build gained the first live generated-block
context path behind the W2a fallback boundary.  The wasm64 backend now exposes
the active ``TCGWasm64Counters`` pointer to the fallback TCI executor.  The
live generated-block path uses the backend ``TCGWasm64Context`` shape for the
C-callable generated function boundary and reports generated/fallback counters
through ``qemu-wasm64-tcg`` JSON summaries that the browser smoke runner
stores under ``result.wasm64Tcg``.

This slice intentionally keeps TCI as the correctness fallback.  Unsupported
or failed generated blocks still execute through normal TCI; generated blocks
that pass the existing TCI bytecode validation can execute through the
C-callable context boundary.

The accepted build command was::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2b-context-counters \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

It produced:

* ``qemu-system-x86_64.js`` =
  ``07dfe2c64a7626d9107a0778094eff428d0a26de99849ff442deb2e15f458846``
* ``qemu-system-x86_64.wasm`` =
  ``e8d48e5a64cedf342549d5cfd84f036752ba2275c35132804a69a5f3cb540418``
* manifest =
  ``d0fee6ae386cb3607c11ef74064efc92369b3ceca5a2f22cf17ad4287b425e7c``

Verification for this slice:

* ``git diff --check`` passed.
* ``node --check scripts/ci/wasm-browser-smoke.mjs`` passed.
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs`` passed.
* ``node --check scripts/ci/wasm-browser-smoke-runner-test.mjs`` passed.
* ``node --check scripts/ci/wasm-tb-module-emitter.mjs`` passed.
* ``node --check scripts/ci/wasm-generated-block-prototype.mjs`` passed.
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` passed outside the
  sandbox; inside the sandbox, child-process ``spawnSync`` returns ``EPERM``.
* ``node scripts/ci/wasm-tb-module-emitter-test.mjs`` passed.
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs`` passed.
* The backend artifact passed the CI-shaped Chromium generic Linux smoke in
  ``mcr.microsoft.com/playwright:v1.56.1-noble``.  Chromium reported
  ``141.0.7390.37`` and ``crossOriginIsolated: true``.  The pinned TuxBoot
  kernel/initramfs, ``Nehalem`` CPU, ``512M`` memory, and marker
  ``QEMU_WASM_LINUX_BOOT_OK`` were used.  The marker was reached in
  ``101122`` ms, with result JSON at
  ``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2b-context-counters-smoke/wasm-browser-smoke-result.json``.

The final exported ``wasm64Tcg`` summary in that browser result reported:

* ``generated_attempts=18469``
* ``generated_compiled=3``
* ``generated_executed=16023``
* ``generated_cache_hits=16020``
* ``fallback_unsupported=2446``
* ``fallback_helper=0``
* ``fallback_qemu_load=0``
* ``fallback_qemu_store=0``
* ``fallback_runtime=0``

This completes the W2b slice only.  The full backend item remains open until
the lowering coverage gate and the same-commit generic speed gate are accepted.

Same-Commit Backend Speed Gate Failure
--------------------------------------

On 2026-07-02, W3 was attempted from QEMU commit
``5f6431526d412aecf36f9d25d6f0a5450f3dc6ca`` using back-to-back generic
Chromium smoke runs in the same ``mcr.microsoft.com/playwright:v1.56.1-noble``
container.  Chromium reported ``141.0.7390.37`` for both runs.

The same-commit default TCI artifact was built with::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-default-tci \
    --jobs auto

It produced:

* ``qemu-system-x86_64.js`` =
  ``2e4f82e69af410f5eef63fea7def6eb118fb8b3b0bfbe37867feb482382e89d0``
* ``qemu-system-x86_64.wasm`` =
  ``819b89f3e4655c49ab826d5760be07a51b29168aadaa7ad6e1967c0655a6fc6c``
* manifest =
  ``2266d95988c96fdab4cbba6ff5a73677f678ab2074baf92bac06225331c68bb2``

The default TCI generic TuxBoot smoke reached ``QEMU_WASM_LINUX_BOOT_OK`` in
``91207`` ms and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-default-tci-smoke/wasm-browser-smoke-result.json``

The backend artifact from W2b produced:

* ``qemu-system-x86_64.js`` =
  ``07dfe2c64a7626d9107a0778094eff428d0a26de99849ff442deb2e15f458846``
* ``qemu-system-x86_64.wasm`` =
  ``e8d48e5a64cedf342549d5cfd84f036752ba2275c35132804a69a5f3cb540418``
* manifest =
  ``d0fee6ae386cb3607c11ef74064efc92369b3ceca5a2f22cf17ad4287b425e7c``

The backend generic TuxBoot smoke reached ``QEMU_WASM_LINUX_BOOT_OK`` in
``100142`` ms and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w3-backend-context-smoke/wasm-browser-smoke-result.json``

The backend run was about ``9.8%`` slower than default TCI, so W3 failed.  The
backend did execute generated blocks: the final ``wasm64Tcg`` summary reported
``generated_attempts=17873``, ``generated_compiled=5``,
``generated_executed=15363``, ``generated_cache_hits=15358``, and
``fallback_unsupported=2510``.  That is enough to prove the generated context
path works, but not enough coverage to improve wall-clock boot time.

No Bus Engine OS long browser proof should be started from this artifact.  The
next accepted step is a fresh backend hot-block run with
``--enable-tcg-hotblocks`` and the coverage gate so the next lowering work is
chosen from current backend evidence rather than guessed.

Backend Hot-Block Coverage Gate
-------------------------------

On 2026-07-02, the backend was rebuilt with hot-block instrumentation so the
coverage gate could use fresh backend evidence instead of old TCI-only data.
The build command was::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2c-backend-hotblocks \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend \
    --configure-arg=--enable-tcg-hotblocks

It produced:

* ``qemu-system-x86_64.js`` =
  ``3325c226fc1d2e53382d7b8f366d372d9bd1a023beedbd2fa832d7a4716f8b64``
* ``qemu-system-x86_64.wasm`` =
  ``5a06b0ddf68387fcdb22cddccefcacd1016ee7bdd97695aac44d3f3f00ffdf5f``
* manifest =
  ``68737c61a3014fa753e0d8f680ed0aed45b512b856ae880199325cac80f9686c``

The first smoke attempt failed before QEMU boot because the temporary runner
used invalid ``--tcg-hotblocks-op-limit 0``.  The corrected runner used the
default positive opcode-sampling limit.  Chromium ``141.0.7390.37`` reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``121568`` ms and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2c-backend-hotblocks-smoke2/wasm-browser-smoke-result.json``

The final hot-block summary recorded ``tci_ops=134217728``,
``helper_calls=509064``, ``qemu_loads=4670379``, and
``qemu_stores=4578049``.  The corresponding coverage-gate output was written
to:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2c-backend-hotblocks-smoke2/wasm-tcg-coverage-gate.json``

The gate passed the current deterministic model with supported ratio
``0.922023319087302`` and all required W2 operations present.  The top
unsupported sampled operations were:

* ``st8=3419640``
* ``ld32u=1858720``
* ``st32=1445667``
* ``extract=1257956``
* ``call=509064``
* ``goto_ptr=432366``
* ``sub=373326``
* ``shr=336241``
* ``shl=273473``
* ``and=250887``

The same run's live backend counters still showed a narrow generated path:
``generated_attempts=18829``, ``generated_compiled=5``,
``generated_executed=16100``, ``generated_cache_hits=16095``, and
``fallback_unsupported=2729``.

The important result is that the model gate is no longer the only blocker.
The live backend still compiles too few blocks.  The next step is to export
live generated rejection opcodes from backend runs and then implement the first
confirmed lowering set, likely starting with ``st8``, ``ld32u``, ``st32``, and
``extract`` if live rejection counters match the hot-block profile.

Live Generated Rejection Attribution
------------------------------------

On 2026-07-02, the W2b backend artifact was rerun with the existing
generated-only subset reporting flags so live generated rejection could be
measured directly instead of inferred from aggregate fallback counts.  The
smoke used Chromium ``141.0.7390.37`` and the generic TuxBoot guest with:

* ``--tci-wasm-subset``
* ``--tci-wasm-generated-only``
* ``--tci-wasm-subset-threshold 1024``
* ``--tci-wasm-subset-max-ops 512``
* ``--tci-wasm-subset-interval 10000``

The smoke reached ``QEMU_WASM_LINUX_BOOT_OK`` in ``108966`` ms and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2d-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``b85d14ec14afc1c9cce376cff3dad70929162e7cc8383b507822fc3693bb01e3``.

The final ``top_generated_unsupported_ops`` list contained only
``ld32u=2292``.  This selected ``ld32u`` as the first live generated lowering
target.

Live ``ld32u`` and ``tci_setcond32`` Lowering
---------------------------------------------

The first follow-up artifact added generated ``ld32u`` support.  It was built
at:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2e-ld32u``

Hashes:

* ``qemu-system-x86_64.js`` =
  ``b0580c89612c11aaaea3fe8fcb44bd084911ed3b7db19f1c17845de3c66d7abf``
* ``qemu-system-x86_64.wasm`` =
  ``1e3b70085556db0621dd8a81535b18c522bcf1595a33c231d774ef21a593bcdd``
* manifest =
  ``6fdcbd6fa1e35f5a683c41bebe66fc387a352b1af5af7b1aa2176dc91ada7a9e``

The generated-only Chromium smoke reached ``QEMU_WASM_LINUX_BOOT_OK`` in
``108293`` ms and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2e-ld32u-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``922ef5764bcd7246ee911550d2b0521fe7ce61a5c067d8e38a73dc3699387cd8``.

The final live rejection list moved to ``tci_setcond32=2425`` and ``st8=1``.
That selected ``tci_setcond32`` as the next generated lowering target.

The next artifact added generated ``tci_setcond32`` support on top of
``ld32u``.  It was built at:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2f-ld32u-setcond32``

Hashes:

* ``qemu-system-x86_64.js`` =
  ``b92c6e7c869bebc0e20b3b85221971d6127df32194124fe634c9c1a3bb5f3463``
* ``qemu-system-x86_64.wasm`` =
  ``e2f25be24972127c2e69976c1cb3345becf07fca31546d66104cfd5da618b4cc``
* manifest =
  ``b5ef7cd5fbbd0c46b823cb83bb24959b77e6f01d0b66b4ed1d3a1ee055499353``

The generated-only Chromium smoke reached ``QEMU_WASM_LINUX_BOOT_OK`` in
``110052`` ms and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2f-ld32u-setcond32-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``6dbce0cee236654a7942cd63cbdd1836922eec4deb140ef9f0edced1451520db``.

The final live rejection list moved to ``brcond=2934`` and ``st8=1``.  The
artifact still did not improve generic smoke wall-clock time, so W3 remains
closed to Bus Engine OS long proof.  The next generated lowering target is
``brcond``, limited to branch shapes that can be represented safely in the
generated WebAssembly block while preserving TCI fallback for every unsupported
or complex case.

Forward brcond generated lowering
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted slice added conservative generated ``brcond`` lowering for
forward branch shapes that can be represented as structured WebAssembly
``block``/``br_if`` control flow.  Backward, malformed, and out-of-range branch
targets continue to fall back to the TCI interpreter before code generation.

The artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2g-brcond \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Hashes:

* ``qemu-system-x86_64.js`` =
  ``9e947c2eefeb5c1cc4ce1e46493bd49c7b39cce52c0b49fbcdd5a004a429350b``
* ``qemu-system-x86_64.wasm`` =
  ``128b432fdf4c4304372af8f6317ebfaf3fcb1cf0d7c3dc54d0967fa1d3cfca29``
* manifest =
  ``e356c7050b6e11e5acab057a8cf7b42d83ad08fe36aa45cd0fb1557eafdaeefe``

The generated-only Chromium smoke used Chromium ``141.0.7390.37`` and reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``106628`` ms.  Result JSON:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2g-brcond-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``f1079cc23fd69d35d334368bc62bf5a765047d12353d878ad761b265c0cff7bd``.

The final generated summary reported ``generated_compiled=4``,
``generated_executed=15519``, ``generated_cache_hits=15515``, and
``generated_compile_failed=0``.  Live generated rejection moved from
``brcond=2934`` to ``st8=2273`` plus ``brcond=2``.  This confirms the forward
``brcond`` slice is safe enough for the generic smoke, but W2 and W3 remain
open.  The next measured lowering target is ``st8``.

Byte-store generated lowering
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted slice added generated ``st8`` lowering for the direct-memory
byte-store form used by TCI host-memory operations.  The generated block emits
``i32.store8`` with the existing wasm-memory address path and wraps the source
register to ``i32`` for the stored byte.  Other store families remained on
strict fallback until separately measured.

The artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2h-st8 \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Hashes:

* ``qemu-system-x86_64.js`` =
  ``d1e4865debf52a52e80b854d09f4ca365977a9fd84bb93ab9d574613d9e765fe``
* ``qemu-system-x86_64.wasm`` =
  ``596d22c1c9c13d3d2b028b4143bfdb1905460786ec200079394e1f7907c158eb``
* manifest =
  ``e6c20a3b1e1e080bff4eee7e53fc843052d1ce48bf66d743ef0ec99ba49051b9``

The generated-only Chromium smoke used Chromium ``141.0.7390.37`` and reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``108476`` ms.  Result JSON:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2h-st8-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``912f08b23181016cdf1d945aee035ff39f7a8829951a55abb72d1f835e8b7c93``.

The final generated summary reported ``generated_compiled=6``,
``generated_executed=14264``, ``generated_cache_hits=14258``, and
``generated_compile_failed=0``.  The live generated rejection list moved to
``ld=1606``, ``mb=443``, ``st=155``, ``st32=6``, and ``brcond=1``.  This
selected direct target-long load/store and memory-barrier lowering as the next
work before rerunning W3.

Direct target-long load/store generated lowering
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted slice added generated ``ld``, ``st``, and ``st32`` support
for direct host-memory forms.  It deliberately did not lower ``mb`` because
that needs a real WebAssembly memory-fence representation or must remain on
fallback.

The artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2i-direct-memory \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Hashes:

* ``qemu-system-x86_64.js`` =
  ``725f5ebc5623b777c1b2bbce86178d4556d1fe059020df72da9d11dcf50373d3``
* ``qemu-system-x86_64.wasm`` =
  ``e1dc0ce19a3b784f8890d6d21acf596ea0af9fda7ecbd158bdfd0b3d82819d0e``
* manifest =
  ``26848775127626efac019f8c58af83ef84a3f9c35bd348b241dc30d530acac06``

The generated-only Chromium smoke used Chromium ``141.0.7390.37`` and reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``112738`` ms.  Result JSON:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2i-direct-memory-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``8fae44f75ad68b2bf60343ddb8e02fa977ec6a0eb7ab490b6ee693aa9da2c298``.

The final generated summary reported ``generated_compiled=6``,
``generated_executed=14505``, ``generated_cache_hits=14499``, and
``generated_compile_failed=72``.  Direct memory blockers dropped out of the
live rejection list, but the run still regressed in wall-clock time.  The next
live rejection list was ``mb=1435``, ``setcond=366``, ``extract=283``,
``call=75``, ``shl=39``, ``shr=15``, ``movcond=14``, and ``sextract=7``.
This is not enough to rerun W3.  The next work must either prove and lower a
real WebAssembly memory fence for ``mb`` or leave ``mb`` on fallback and lower
the next safe non-barrier blockers.

Register and extract generated lowering
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted slice left ``mb`` on strict fallback because no verified
WebAssembly memory-fence encoding was found locally.  It instead lowered the
next safe non-barrier blockers seen in the live generated rejection profile:
``setcond``, ``movcond``, ``shl``, ``shr``, ``extract``, and ``sextract``.
The emitted WebAssembly uses ``i32`` shift-count operands for ``i64``
shift/extract instructions.

The artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-register-blockers-fixed \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Hashes:

* ``qemu-system-x86_64.js`` =
  ``7366a91e196510ec7c4e9e18fbe1cb104c186673f78a7b4c76f79c80e2282804``
* ``qemu-system-x86_64.wasm`` =
  ``05ba2b602eec59ea99653d9260febbfbb2669c13984bee103b9f81bc564fa5d2``
* manifest =
  ``18d7d3f1d658f1f08ac9645ec3c71fffa8bce1f9bd5eac2a6879a1cde680e807``

The generated-only Chromium smoke used Chromium ``141.0.7390.37`` and reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``111130`` ms.  Result JSON:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-register-blockers-fixed-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``48a9acb95004fdc95879081bce96ee71369004a8243f347e81caca198a5871c7``.

The final generated summary reported ``generated_compiled=6``,
``generated_executed=15192``, ``generated_cache_hits=15186``, and
``generated_compile_failed=755``.  The live unsupported generated op list was
``mb=1819``, ``call=63``, ``sar=3``, ``tci_movcond32=3``, ``deposit=2``,
``muls2=2``, ``brcond=1``, and ``ld32s=1``.  This does not justify a
W3 speed-gate rerun: the generic smoke still took longer than the earlier W3
default-TCI baseline, ``mb`` remains dominant, and generated compile/runtime
fallback now needs reason-level attribution before the backend can be judged
again.

Fallback reason and coverage diagnostics
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted slice added reason-level accounting for the existing
generated compile-failure paths and added generated coverage fields to both
``qemu-tci-wasm-subset`` and ``qemu-wasm64-tcg`` summaries.  This was a
diagnostic accounting slice only: it did not lower another opcode and did not
rerun the W3 speed gate.

The artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-fallback-reasons \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Hashes:

* ``qemu-system-x86_64.js`` =
  ``6cf78909d8fe7092216e9667b0057c3d6e432d7960e7563c20ea04951e7f406a``
* ``qemu-system-x86_64.wasm`` =
  ``496ec3451c5a957036cfe2d42e152c4a3f4701e9408f345703d976ffe4043162``
* manifest =
  ``a23bad762fee26da34f8bd8bbef13d0cdde8656bf7131a903a13a63b46cb32dd``

Checks passed:

* ``git diff --check``
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner-test.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` outside the sandbox,
  because sandboxed child-process spawning returns ``EPERM``
* ``node --check scripts/ci/wasm-tb-module-emitter-test.mjs``
* ``node scripts/ci/wasm-tb-module-emitter-test.mjs``
* ``node --check scripts/ci/wasm-generated-block-prototype-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``

The generated-only Chromium smoke used Chromium ``149.0.7827.55`` and reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``104757`` ms.  Result JSON:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2j-fallback-reasons-subset-live/wasm-browser-smoke-result.json``

Result SHA-256:
``acb26aae9c4a0f89100107093e19ae3b10d0e0cc9fca6f5f7d905b9329082d85``.

The final generated summary reported ``generated_compiled=4``,
``generated_executed=15131``, ``generated_cache_hits=15127``,
``generated_compile_failed=677``, ``generated_compile_zero=677``,
``generated_status_nonpositive=0``, and ``generated_status_unknown=0``.
Generated coverage was ``30258 / 73080000`` eligible subset attempts, or
``414`` ppm.

This result makes the next path narrower.  The backend still compiles only a
handful of blocks, and generated execution covers roughly ``0.0414%`` of
eligible attempts.  W2 should continue by moving generation toward
translation-time lowering with per-TB fallback metadata, not by spending
another browser run on the next live rejection entry.

W2k: translation-time fallback metadata
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next accepted slice moved the wasm64 backend structure toward
translation-time lowering without adding another opcode-at-a-time browser
measurement.  The expected immediate generated coverage share change is
``0``: execution still falls back through TCI, but the decision point for
whether a TB is generatable now has a translation-time metadata slot.

The wasm64 target wraps the TCI fallback emitter:

* ``tcg_out_tb_start()`` calls ``tcg_wasm64_translate_begin()`` with the TB
  code pointer before fallback bytecode emission starts.
* ``tcg_out32()`` is routed through ``tcg_wasm64_out32()``, which records each
  emitted TCI bytecode word in side-band ``TCGWasm64TBMetadata`` before
  delegating to the unchanged fallback bytecode emitter.
* The current metadata marks every TB with
  ``TCG_WASM64_TB_METADATA_FALLBACK`` and
  ``TCG_WASM64_TRANSLATE_FALLBACK_NO_WASM_EMITTER``.  Future lowering should
  replace that fallback marker with generated WebAssembly bytes for supported
  TBs.

This removes the need for the threshold-hot runtime TCI-bytecode revalidation
loop to decide whether a TB is generatable, while preserving strict fallback
semantics for this slice.

Checks passed:

* ``git diff --check``
* ``node --check scripts/ci/wasm64-translate-metadata-test.mjs``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner-test.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` outside the sandbox,
  because the sandboxed child-process validation path returned empty output
* a full Docker Emscripten build of the wasm64 backend artifact

The artifact build command was:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2k-translate-metadata \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

It configured as ``TCG backend: experimental wasm64 with TCI fallback``,
compiled, linked, and wrote artifacts to:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2k-translate-metadata``

Hashes:

* ``qemu-system-x86_64.js`` =
  ``b23de585246226886ea328e20bed98ca379241456ea7757da37f2e1442cc1dbe``
* ``qemu-system-x86_64.wasm`` =
  ``502463d1bc124e0d4153b00a5e7abab73df417a741850f04989818bf5496c916``
* manifest =
  ``b42ebb3f6c1baefa728e4b02fd258c74295c43462bee6f0bb4eee5377c4c76c9``
* ``SHA256SUMS`` =
  ``7cd5af188bc618118345d503a4850c65f9646cc0798d0b130771b13c0e858c40``

This completes W2k only.  W2 remains open until generated TBs execute through
the translation-time backend, exported counters show meaningful generated
coverage, and the generic W3 speed gate passes.

W2l-a: deterministic ``atomic.fence`` lowering proof
----------------------------------------------------

On 2026-07-02, the deterministic generated-TB module emitter gained an
explicit WebAssembly threads ``atomic.fence`` byte emitter for the QEMU memory
barrier lowering operation.  The emitted bytes are ``0xFE 0x03 0x00``.  This
replaces the previous no-op representation in the deterministic model only;
it does not by itself complete W2l, move generated coverage share, or justify
a browser speed-gate run.

Checks:

* ``git diff --check``
* ``node --check scripts/ci/wasm-tb-module-emitter.mjs``
* ``node --check scripts/ci/wasm-tb-module-emitter-test.mjs``
* ``node scripts/ci/wasm-tb-module-emitter-test.mjs``
* ``node --check scripts/ci/wasm-generated-block-prototype-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``
* ``node scripts/ci/wasm-tb-module-emitter.mjs``

The test asserts the exact ``atomic.fence`` bytes and asserts that the
generated lowering-subset module contains one fence per ``mb`` op.  The module
validated and executed under Node with ``memoryBarrierOps=2`` and module size
``321`` bytes.  The emitted probe JSON is:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-a/wasm-tb-module-emitter.json``

Chromium validation and batched backend lowering remain open before W2l can be
accepted.

W2l-b: translation-time lowerability profile metadata
-----------------------------------------------------

On 2026-07-02, the wasm64 backend metadata gained translation-time
lowerability profiling for the planned hotblock family.  This is not generated
execution yet.  The goal of this slice is to make the translation-time backend
able to report how many translated TBs and TCI ops are already covered by the
planned broad lowering profile before spending a browser speed run.

``TCGWasm64TBMetadata`` now records:

* lowering profile id,
* profile-supported op count,
* unsupported op count,
* whether the translated TB is fully covered by the planned profile.

The profile covers the broad W2 hotblock family: ``add``, ``and``,
``brcond``, ``exit_tb``, ``goto_tb``, ``ld``, ``ld8*``, ``ld16*``,
``ld32*``, ``mb``, ``mov``, ``or``, ``qemu_ld``, ``qemu_st``, ``setcond``,
``st``, ``st8``, ``st16``, ``st32``, ``sub``, ``tci_movi``, ``tci_movl``,
``tci_qemu_ld_rrr``, ``tci_qemu_st_rrr``, ``tci_setcond32``, and ``xor``.

Runtime summary JSON now exports:

* ``translated_profiled_tbs``
* ``translated_lowerable_tbs``
* ``translated_profile_supported_ops``
* ``translated_profile_unsupported_ops``

Strict fallback is still preserved for every TB because generated bytes and
functions are not attached yet.

Checks:

* ``git diff --check``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner-test.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` outside the sandbox,
  because the sandboxed run hit the known empty-stderr child-process assertion

Build command:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-b-profile-metadata \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

It configured as ``TCG backend: experimental wasm64 with TCI fallback``,
compiled, linked, and wrote artifacts to:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-b-profile-metadata``

Hashes:

* ``qemu-system-x86_64.js`` =
  ``432dafdff489c90c979b0ed90f768f9c0990992a49bd0c508c3a55eefb17284a``
* ``qemu-system-x86_64.wasm`` =
  ``5ccf2a3575eda027b45ce0f5d81e9c1552152b8f219725a8b8f562c624c6cb35``
* manifest =
  ``b2f3354f0fb3d993771cc01de56b4866a478f2beed74ace57aab168d57c32709``
* ``SHA256SUMS`` =
  ``f8493d236ad7a53b296211d5c9e985c2054efe51e6aae7ad1fa5da669d9651ef``

This completes W2l-b only.  W2l and W2 remain open until generated
bytes/functions are attached to translation-time metadata and browser evidence
shows nonzero generated execution, meaningful generated coverage, and the W3
speed gate passes.

W2l-c: op-based translation metadata and negative generated-coverage result
--------------------------------------------------------------------------

On 2026-07-02, the wasm64 backend metadata path was changed to classify
emitted TCI operations through an explicit TCI target hook instead of reading
raw emitted 32-bit words.  The previous raw-word path could treat operands or
immediates as opcodes.  The shared TCI emitter now calls
``tcg_out_tci_note_op()`` from the operation-emission helpers, and the wasm64
target implements that hook with ``tcg_wasm64_translate_note_tci_op()``.

This slice also aggregates translation metadata counters into the runtime
``qemu-wasm64-tcg`` summary so browser evidence can report generated-candidate
translation counts after the per-TB execution context has gone out of scope.

Checks:

* ``git diff --check``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``
* ``node scripts/ci/wasm-tb-module-emitter-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` outside the sandbox

Build command:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-c-op-metadata \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Artifact hashes:

* ``qemu-system-x86_64.js`` =
  ``44f7cf8aab5c23c82efe46114b68d8fd6a8b5e60ba56d9d247a9c6bf554351f7``
* ``qemu-system-x86_64.wasm`` =
  ``db318270301acfc5f724c6e6a033e79d8fac64983e4b8ba6d1d0f301bc9c1305``
* manifest =
  ``ec620fa811163f71c99ef1bfbe4f295aceff8dab630798a5a84328455e2d6671``
* ``SHA256SUMS`` =
  ``35a8f7f579818547a10dc5069120ce6282e97023bdd9a2247b9597e0d863010d``

The Chromium ``149.0.7827.55`` generic smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``100472`` ms.  The result JSON is:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2l-c-op-metadata-smoke/wasm-browser-smoke-result.json``

Result JSON SHA-256:

``bc209165f672fec30141d95fece1853ff10e719a5bba90622915e127032f9e99``

The run is a negative generated-coverage result.  The last summary reported
``generated_compiled=0``, ``generated_executed=0``,
``generated_cache_hits=0``, and generated coverage ``0 / 73140000``.  It also
reported ``translated_generated_candidate_tbs=65920``, which shows that the
metadata path is now visible but generated byte/function creation remains in
the wrong place for W2.

The next accepted work is a structural backend re-plan: generated output must
be created from the wasm64 translation path before runtime TCI-bytecode
revalidation, with strict per-TB fallback preserved.  Another opcode-specific
browser measurement is not justified by this result.

W2m data-first option ranking
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The remaining five-minute Bus Engine OS boot work is steered by measured gate
impact, not by the most recent rejection counter.

The current browser TCI path is about ``51x`` slower than native QEMU for the
same generic TuxBoot marker: the W2l-c browser run reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``100472`` ms, while the matching native QEMU
command reached the same marker in ``1968`` ms.  Applying that ratio to the
accepted downstream Bus Engine OS native boot evidence, ``44`` seconds to
multi-user/login and ``58`` seconds through the boot-audit service, predicts a
browser TCI boot in the ``37`` to ``49`` minute range.  The five-minute goal
therefore requires a multiple-times execution-throughput improvement, with
guest-side boot trimming as a useful parallel lane but not a substitute.

The already-measured alternatives are too small:

* W1's address-limited Memory64 comparison improved generic smoke by only
  ``5.8%``.
* Device/browser API attribution has been below one second while TCI dispatch
  remains active at timeout.
* The opcode-at-a-time generated-subset path compiled only ``3`` to ``6``
  generated blocks, reached at most ``414`` ppm generated coverage in the
  measured runs that exposed coverage, and did not beat the W3 same-commit
  default TCI baseline.

The high-leverage boundary exposed by W2l-c is translation-time generated
output.  Translation metadata already sees ``65920`` generated-candidate TBs
and ``102077`` lowerable TBs out of ``251212`` translated TBs, and the W2c
hot-block model showed ``92.2%`` supported dynamic op coverage.  The next W2m
implementation must therefore prove a deterministic translation-time
generated-output boundary before any further browser measurement.

W2m-a: translation-time generated-output material
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

W2m-a adds the first deterministic generated-output boundary in the wasm64
target.  The target pairs the existing ``tcg_out_tci_note_op()`` hook with the
next emitted TCI instruction word through an op-paired ``tcg_out32`` wrapper.
That avoids the earlier raw-word classifier problem: generated-output material
is recorded only when an opcode note immediately precedes the emitted
instruction word.

The runtime stores the translation-time output material in per-TB metadata and
exports summary fields for ``translated_generated_output_tbs``,
``translated_generated_output_bytes``, ``translated_generated_output_ops``,
and ``translated_generated_output_truncated``.  Execution remains strict TCI
fallback.  This slice does not claim a speed improvement and does not justify
a browser W3 run by itself; it makes absence of translated generated output a
deterministic test failure before browser measurement.

Checks:

* ``git diff --check``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``
* ``node scripts/ci/wasm-tb-module-emitter-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` outside the sandbox
  because sandboxed child-process assertions return empty stderr

Build command:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --build-image \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-translate-output-artifacts \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

The build configured as ``TCG backend: experimental wasm64 with TCI fallback``,
compiled, linked, and wrote:

* ``qemu-system-x86_64.js`` =
  ``f19bac59e8c353a254e0a620c3cbc496fd5877eafd36646a9f1951cd689a888f``
* ``qemu-system-x86_64.wasm`` =
  ``7c4603c99224cdec56b0d6188061079a4e7591abc5da10a734c3f4b9932fc53b``
* manifest =
  ``3caa22a54f8dc3f66ba68d42ec3c6d5298f24f9092443b0eb9073915d4915982``
* ``SHA256SUMS`` =
  ``5b921b24c00462dd441cfa5634ca46ca490e2fba85e468b6c552d27bfd82c5c2``

The next W2m slice must convert this translation-time output into a callable
generated WebAssembly module/function with strict fallback and nonzero
generated execution.  A browser W3 speed gate remains premature until that
local execution evidence exists.

W2m-b negative generated-execution result and opt-in guard
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The next W2m-b attempt made the generated compiler consume the
translation-time generated-output buffer instead of the original TCI stream.
It also changed the generated function table signature from ``"ii"`` to
``"jj"`` for the wasm64 pointer-width ABI and added bounded generated-block
trace records under ``QEMU_TCI_WASM_GENERATED_TRACE=1``.

Checks:

* ``git diff --check``
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs``
* ``node --check scripts/ci/wasm-browser-smoke.mjs``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``
* ``node scripts/ci/wasm-generated-block-prototype-test.mjs``
* ``node scripts/ci/wasm-browser-smoke-runner-test.mjs`` outside the sandbox
  because sandboxed child-process assertions return empty stderr

The first backend artifact for this attempt wrote:

* ``qemu-system-x86_64.js`` =
  ``d02596846580898d9a062dd1bf3a0ee04b727447e669733e3662283fb4588470``
* ``qemu-system-x86_64.wasm`` =
  ``5f7f12c0c66fd491ce509e8c4763f0f875567cd353d13b598c48b1d90fbc105d``
* manifest =
  ``56288937e5ed50f4ae9dd26ec617eb299ed0f26d20ffd1624d907b56a788897c``
* ``SHA256SUMS`` =
  ``b544c54404354e1a116ee3dcf25d4cb91040be9b3c171d6033d38c0e72636470``

The generated-only trace smoke used Chromium ``149.0.7827.55`` and timed out
after ``30255`` ms before ``QEMU_WASM_LINUX_BOOT_OK``:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-jj-signature-smoke/wasm-browser-smoke-result.json``

Result JSON SHA-256:

``2999525b1803275dd20f0050096e10b6a3a8d8e0a78402c7fc02870e3debb215``

The fallback-enabled trace smoke used the same artifact and Chromium build,
and timed out after ``150215`` ms:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-jj-signature-fallback-smoke/wasm-browser-smoke-result.json``

Result JSON SHA-256:

``ce8d341169a7b60bd07cff3c6ec028d91c828a54bb1c3c1999b2fad2ed50b81a``

The last summaries showed ``generated_compiled=12``,
``generated_executed=23``, ``generated_cache_hits=11``, and generated coverage
of only ``34 / 13,320,000`` in the 30 s run and ``34 / 73,820,000`` in the
150 s run.  This is effectively zero coverage, so the attempt does not
complete W2m-b and cannot proceed to the W3 speed gate.

The same attempt also exposed a safety issue in the measurement shape:
backend builds enabled the generated/subset path when ``QEMU_TCI_WASM_SUBSET``
was unset.  That made backend default smokes run a tiny generated subset even
when the runner configuration said the subset was disabled.  The default is
now fail-closed: generated/subset execution requires
``QEMU_TCI_WASM_SUBSET=1``.

The opt-in-guarded backend artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-subset-optin-final-artifacts \
    --jobs auto \
    --build-image \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Artifact hashes:

* ``qemu-system-x86_64.js`` =
  ``d02596846580898d9a062dd1bf3a0ee04b727447e669733e3662283fb4588470``
* ``qemu-system-x86_64.wasm`` =
  ``b70c7ec5bda838094487700cd766197283cb796af723d9e1675ce68dcd541342``
* manifest =
  ``b1d667d55fff5be892a609f833bb9a5b2a1bfad52705ee0785d5e863b20a1c49``
* ``SHA256SUMS`` =
  ``c2640d5e733ebaf6aca7acd2a554519f71177bef7110c78ead66984e077f83df``

The opt-in-guarded generic Chromium smoke reached
``QEMU_WASM_LINUX_BOOT_OK`` in ``93186`` ms with subset execution disabled,
``wasm64Tcg.summaryCount=0``, no generated attempts, and Chromium
``149.0.7827.55``:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-subset-optin-final-default-smoke/wasm-browser-smoke-result.json``

Result JSON SHA-256:

``5f833d7f8002b2e7046ead6359eb089963ffb9eefc4546c7de68baa501147b19``

Screenshot SHA-256:

``7790c1602b7fc002de8c3020befa4d332828fe041dec420dbda28caa83284ff5``

This restores a trustworthy default-TCI fallback measurement for backend
artifacts.  Using the prior native generic TuxBoot time of ``1968`` ms, the
new browser/native ratio is about ``47.4x``.  Applying that rough ratio to
the accepted Bus Engine OS native evidence predicts about ``34.7`` minutes to
multi-user/login from the ``44`` second native boot and about ``45.8`` minutes
through the ``58`` second boot-audit service marker.  The five-minute target
therefore still needs roughly a ``6.9x`` to ``9.2x`` throughput improvement
from the current fallback path.

The next accepted W2 work must add a deterministic generated-output
equivalence gate before another browser run.  The trace shapes from this
attempt are enough to build a local check for early terminal ``goto_tb`` and
``exit_tb`` blocks; a browser measurement is not justified until that gate
passes and the generated coverage prediction moves from tens of executions to
thousands of executed generated TBs.

W2m-c generated-output equivalence gate
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The deterministic generated-output equivalence gate is now
``scripts/ci/wasm-generated-output-equivalence-test.mjs``.  It embeds
trace-shaped TCI instruction words from the W2m-b run, runs a small reference
interpreter over the same register and memory state, compiles the generated
output shape into a local WebAssembly function, and compares:

* generated status;
* return target;
* the 16 TCI registers;
* representative memory touched by the trace-shaped block.

This is intentionally a local gate, not a browser benchmark.  It catches
encoding, ABI, register, memory, and dispatch semantic errors before another
Chromium run is justified.

Checks:

* ``node --check scripts/ci/wasm-generated-output-equivalence-test.mjs``
* ``node scripts/ci/wasm-generated-output-equivalence-test.mjs``

The test passed with ``6`` fixture executions: ``4`` ``goto_tb`` terminal
cases and ``2`` ``exit_tb`` terminal cases.  This completes the deterministic
safety gate from W2m-c, but it does not improve the current browser estimate.
The accepted fallback baseline remains the final W2m-b opt-in-guarded
Chromium smoke at ``93186`` ms, which projects Bus Engine OS browser
multi-user readiness at roughly ``34.7`` to ``45.8`` minutes until generated
coverage increases by orders of magnitude.

W2m-d generated-output availability attribution
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The wasm64 backend summary now reports why generated output is unavailable:

* ``translated_generated_output_unavailable_tbs``
* ``translated_generated_output_missing_candidate_tbs``
* ``translated_generated_output_incomplete_tbs``
* ``translated_generated_first_unsupported_ops``

The compile-check artifact was built with:

.. code-block:: console

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-gap-attribution-artifacts \
    --jobs auto \
    --build-image \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Artifact hashes:

* ``qemu-system-x86_64.js`` =
  ``d60558aadfddbf06347e01353fad4056c8da44ff74d8d26f8657e3c14dd52b3c``
* ``qemu-system-x86_64.wasm`` =
  ``6d6dd5984e03b08dea502aabaecae6322f82f18236c56aa4b767de59e5364200``
* manifest =
  ``1b5b86a5d71bc8af754fcd40a81173e9fef457ce15621729243fe701d2d2812b``
* ``SHA256SUMS`` =
  ``53ea99b6a5795bfca37ce7628682b90b9a96c3cd87644cdbec9bc83348a15608``

A bounded Chromium ``149.0.7827.55`` diagnostic run timed out after
``30195`` ms, as expected, but produced the required attribution:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-gap-attribution-smoke/wasm-browser-smoke-result.json``

Result JSON SHA-256:

``4b6df1b486ce8916fcf629fc6994109fcd0b091cea1b469a4a728f7916efaaad``

The summary reported:

* ``translated_tbs=315``
* ``translated_generated_output_tbs=13``
* ``translated_generated_output_unavailable_tbs=302``
* ``translated_generated_output_missing_candidate_tbs=302``
* ``translated_generated_output_incomplete_tbs=0``
* ``translated_generated_output_truncated=0``

The top first generated-unsupported opcodes were:

* ``tci_qemu_st_rrr=148``
* ``tci_qemu_ld_rrr=145``
* ``call=6``
* ``deposit=3``

The QEMU load/store pair explains ``293 / 302`` unavailable TBs, or about
``97.0%`` of the measured generated-output availability gap.  Supporting that
pair correctly could move early generated-output candidate coverage from
``13 / 315`` TBs, or ``4.1%``, to roughly ``306 / 315`` TBs, or ``97.1%``,
subject to helper correctness and fallback behavior.  This is the next
high-leverage mechanism.  Further single-opcode arithmetic lowering remains
rejected by the standing rules.

The next accepted slice must add a deterministic generated helper boundary
for ``tci_qemu_ld_rrr`` and ``tci_qemu_st_rrr`` before any Chromium
measurement.  The local test should compare generated helper calls with a
reference interpreter for trace-shaped qemu memory blocks, including helper
call counts, register updates, memory side effects, and fallback results.

W2m-e deterministic qemu memory helper boundary
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The deterministic generated-output gate now models the qemu memory helper
boundary used by ``tci_qemu_ld_rrr`` and ``tci_qemu_st_rrr``.  The local
generated WebAssembly module imports two helper functions,
``qemu_ld_rrr`` and ``qemu_st_rrr``, and calls them with the translated
``env`` pointer, guest address, store value when applicable, ``MemOpIdx``,
and TB return address.  The reference interpreter uses the same helper model.

The local gate compares:

* generated status;
* return target;
* the 16 TCI registers;
* helper call traces;
* helper load/store counts;
* helper-modeled memory side effects;
* representative memory touched by the block.

The same test also includes a mixed unsupported block so unsupported helper
output fails closed before execution.

Checks:

.. code-block:: console

  node --check scripts/ci/wasm-generated-output-equivalence-test.mjs
  node scripts/ci/wasm-generated-output-equivalence-test.mjs

Accepted output:

.. code-block:: json

  {
    "format": 1,
    "event": "generated-output-equivalence",
    "fixtures": 8,
    "unsupportedFixtures": 1,
    "helperBoundaryFixtures": 2,
    "helperCalls": {
      "loads": 2,
      "stores": 2
    },
    "terminals": {
      "goto_tb": 4,
      "exit_tb": 4
    }
  }

This slice is a semantic safety gate, not a speed result.  The runtime
prediction remains the W2m-d attribution: qemu load/store helper support is
the measured blocker for ``293 / 302`` unavailable generated-output TBs.
If the runtime implementation preserves this boundary and fallback behavior,
early generated-output candidate coverage can plausibly move from
``13 / 315`` TBs, or ``4.1%``, toward roughly ``306 / 315`` TBs, or
``97.1%``.  The accepted fallback baseline remains ``93186`` ms for the
generic smoke, projecting Bus Engine OS browser multi-user readiness at
roughly ``34.7`` to ``45.8`` minutes until runtime generated coverage
actually increases.

W2m-f runtime qemu helper boundary diagnostic
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The runtime qemu load/store helper boundary now compiles and executes through
the generated-output path with strict fallback preserved.  The accepted
diagnostic artifact was built with::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-fwcfg-exec-counters2-artifacts \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Artifact hashes:

* ``qemu-system-x86_64.js``:
  ``47a2d6420be9aebad4d90dddfa90445e715486280a89e5c2094b42f21953b06c``
* ``qemu-system-x86_64.wasm``:
  ``dfd36c222faef6c2dcbca69df9b27d4ba89433831a56bfc6660c14538012e14a``
* manifest:
  ``5d68f476dc8896b5e2aa00cc560bb6d74fe756c7d90a5c1cae24857f55cf0004``

The pre-browser checks were:

* ``git diff --check``
* ``node --check scripts/ci/wasm-browser-smoke.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner.mjs``
* ``node --check scripts/ci/wasm-browser-smoke-runner-test.mjs``
* ``node scripts/ci/wasm-generated-output-equivalence-test.mjs``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``

The generated-output equivalence test reported ``10`` fixtures, ``1``
unsupported fail-closed fixture, ``2`` helper-boundary fixtures, ``2`` modeled
qemu loads, and ``2`` modeled qemu stores.

The short Chromium diagnostic used Chromium ``149.0.7827.55`` and the generic
TuxBoot manifest with ``--timeout-ms 8000``, ``--tci-wasm-subset``,
``--tci-wasm-generated-trace``, and ``--fw-cfg-trace``.  It intentionally
timed out before ``QEMU_WASM_LINUX_BOOT_OK`` and wrote:

``/home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-fwcfg-exec-counters2-smoke/wasm-browser-smoke-result.json``

Result JSON hash:

``ace1c5b0c06116455ef8d814e53bcfd0e9e58c3d0d4c9dcbb17de8c13edff1a7``

The last summary at ``5274`` ms reported ``generated_compiled=103``,
``generated_executed=123``, ``generated_cache_hits=20``, and generated
coverage ``143 / 433`` subset attempts, or ``330254`` ppm.  The new
execution-side generated-output counters showed
``exec_generated_output_lookup_tbs=220``,
``exec_generated_output_available_tbs=110``, and
``exec_generated_output_unavailable_tbs=110``.  Every unavailable execution
lookup was missing generated-candidate metadata; none were missing byte output
after candidate acceptance.

The same diagnostic also proved that fw_cfg tracing is visible through the
browser harness and small in this window: ``11`` events, ending with a
``file_dir`` read at ``5126`` ms.  That rules out fw_cfg environment plumbing
as the current material stall.

The remaining measured candidate blocker is generic helper-call and simple
deterministic-op coverage, not qemu load/store helper plumbing.  The first
unsupported generated ops were ``call=72``, ``deposit=32``, ``ld32s=5``, and
``neg=1``.  The next W2m work must batch deterministic evidence for those
shapes before any further browser measurement.

W2m-g simple deterministic gap ops
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The measured simple generated-output blockers ``deposit``, ``ld32s``, and
``neg`` now lower through the generated compiler and are included in the
generated-output support predicate.  The deterministic equivalence gate adds a
``simple-gap-ops-validate`` fixture that compares these operations against the
reference interpreter before any browser run.

Checks:

* ``git diff --check``
* ``node --check scripts/ci/wasm-generated-output-equivalence-test.mjs``
* ``node scripts/ci/wasm-generated-output-equivalence-test.mjs``
* ``node scripts/ci/wasm64-translate-metadata-test.mjs``

The equivalence test reported:

.. code-block:: json

  {
    "format": 1,
    "event": "generated-output-equivalence",
    "fixtures": 12,
    "unsupportedFixtures": 1,
    "helperBoundaryFixtures": 2,
    "simpleGapFixtures": 2,
    "helperCalls": {
      "loads": 2,
      "stores": 2
    },
    "terminals": {
      "goto_tb": 4,
      "exit_tb": 8
    }
  }

The backend artifact built with::

  python3 scripts/ci/wasm-build-artifacts-local.py \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-simple-gap-ops-artifacts \
    --jobs auto \
    --configure-arg=--disable-tcg-interpreter \
    --configure-arg=--enable-tcg-wasm64-backend

Artifact hashes:

* ``qemu-system-x86_64.js``:
  ``6df4acbdb2a09ee976007e6c9a5b62749fec2bbf5aaaacd5f0f4d9d07c5341f2``
* ``qemu-system-x86_64.wasm``:
  ``95d39dee08afe39e19d6d0e4d06c04fa501ef4735d7a347f8d032130debde93c``
* manifest:
  ``e8d81788f895fce9aa01ddc9c3a93e6484417b8fa80ed744f6652e8ebc1e99fd``

No Chromium run was started for this slice.  The W2m-f diagnostic showed that
the simple ops explain ``38 / 110`` execution-side unavailable
generated-output TBs, while generic ``call`` explains ``72 / 110``.  That does
not predict an order-of-magnitude generated-coverage change, so a browser run
would not answer the speed-gate question.

The current generated compiler also cannot safely generate generic
``INDEX_op_call`` directly.  TCI helper calls use libffi with arbitrary helper
signatures, stack slot layout, helper return arity, ``TCG_CALL_NO_RETURN``
flags, and ``tci_tb_ptr`` return-address state.  WebAssembly imports require a
typed function boundary, so generic calls need a deliberately designed C
trampoline or must remain fallback.  The next W2m step is helper-call
classification and boundary design, not another opcode-only browser
measurement.

W2m-h helper-call classification
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The generic helper-call boundary was classified before adding more generated
lowering or starting another browser run.  The new helper-call classifier reads
the retained generated trace from a browser smoke result and groups
``ffi-call-enter`` events by helper name, TCG call flags, argument count, TCI
return length, return shape, elapsed range, and dynamic share.

Checks:

* ``node --check scripts/ci/wasm-helper-call-classify.mjs``
* ``node --check scripts/ci/wasm-helper-call-classify-test.mjs``
* ``node scripts/ci/wasm-helper-call-classify-test.mjs``
* ``git diff --check``

The W2m-f Chromium ``149.0.7827.55`` trace was classified with::

  node scripts/ci/wasm-helper-call-classify.mjs \
    --result /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-fwcfg-exec-counters2-smoke/wasm-browser-smoke-result.json \
    --out /home/coding-agent/coding-agent/git/busdk/agent-supervisor/tmp/qemu-w2m-helper-call-boundary/wasm-helper-call-classification.json \
    --top 16

Classification SHA-256:

``7db15d976ae1811006a6ddf4ad681ec8e34731b4e24c8d8842c3da7b81ef67f8``

The retained trace contained ``1024`` events, ``154`` helper-call entries,
``153`` helper returns, and ``10`` helper groups.  The dominant helper is
``lookup_tb_ptr``:

.. code-block:: text

  lookup_tb_ptr count=95 share=0.6169 flags=6(NO_WRITE_GLOBALS|NO_SIDE_EFFECTS) nargs=1 return=uint64
  outl          count=19 share=0.1234 flags=0(none) nargs=3 return=void
  outb          count=18 share=0.1169 flags=0(none) nargs=3 return=void
  inb           count=7  share=0.0455 flags=0(none) nargs=2 return=uint64
  load_seg      count=5  share=0.0325 flags=0(none) nargs=3 return=void

This rejects broad generic helper-call generation as the next speed path.  The
non-dispatch helpers are mostly device I/O, segment, jump, or control-register
helpers with side effects that must preserve the existing TCI/libffi ABI and
CPU/device state semantics.  A generic libffi trampoline would also still
cross into C for arbitrary helper signatures, so it would not make generated
block execution the default.

The measured next structural target was a generated-block dispatch boundary
around the ``lookup_tb_ptr`` helper shape.  Follow-up W2m-j evidence rejected
that family as the performance solution: it can produce high boundary-entry
coverage while still returning to QEMU too often and running slower than
default TCI.

Rejected TCI subset and direct-boundary paths
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The opt-in TCI wasm subset, generated-only subset, relaxed TCI memory-barrier,
and direct generated-boundary experiments are retained in this document as
negative evidence only.  They are not active performance options in the live
runner or TCI interpreter.

The strongest rejection evidence is the W2m-j direct-boundary diagnostic.  It
reported near-total boundary coverage:

.. code-block:: text

  direct_tb_entries=44,000,001
  direct_generated_executed=43,960,181
  direct_generated_dispatches=1,664
  direct_tci_fallbacks=39,820

The same run failed to reach ``QEMU_WASM_LINUX_BOOT_OK`` within ``180252`` ms,
while default TCI generic smokes in the same family reached the marker around
``100`` seconds.  The true compiled generated-block counters remained zero:
``generated_compiled=0``, ``generated_executed=0``, and
``generated_cache_hits=0``.

Conclusion: boundary-entry coverage is not a performance success metric.  It
only proves that QEMU entered a generated wrapper frequently.  It does not
prove optimized guest instruction retirement, internal TB chaining, inline
RAM/SoftMMU TLB hits, or rare synthetic exits.

The live tree therefore removes:

* ``QEMU_TCI_RELAXED_MB`` and the browser runner's ``--tci-relaxed-mb`` flag.
* ``QEMU_TCI_WASM_SUBSET`` and the browser runner's ``--tci-wasm-subset``
  flag.
* ``QEMU_TCI_WASM_GENERATED_ONLY`` and the browser runner's
  ``--tci-wasm-generated-only`` flag.
* the TCI generated-subset compiler/executor and the direct-boundary dispatch
  branch in ``tcg/tci.c``.

The remaining generated trace support is diagnostic only.  It records TCI
block/helper shapes for future accelerator design and does not change guest
execution.

The next W2 implementation shape is a browser-Wasm accelerator run/exit model:
a long-running ``wasmjit_run()``-style entrypoint, internal TB chaining or
hotset dispatch, inline common RAM/TLB-hit load/store paths, and synthetic
exits for MMIO, TLB miss/page fault, interrupt, halt, invalidation,
unsupported helper, or budget expiry.  The first acceptance gate is not Linux
boot; it is a deterministic micro-hotset where one entry into generated Wasm
executes a large counted guest-instruction budget before returning, with
multiple-times speedup over TCI on ALU/branch and TLB-hit RAM microbenches.

W2n run/exit model
~~~~~~~~~~~~~~~~~~

The W2n design pivot is to treat generated browser-Wasm execution as an
accelerator run/exit engine, not as a per-TB wrapper around the existing TCI
interpreter.  The minimum useful shape is:

* one exported ``wasmjit_run(ctx, budget)`` entrypoint;
* imported guest/QEMU memory only, with no helper-function imports in the hot
  micro-hotset gate;
* internal dispatch or direct branch flow between generated hot TB bodies;
* inline RAM/TLB-hit load/store operations for ordinary guest RAM;
* counters for generated guest-instruction retirement, generated chain length,
  inline RAM accesses, helper calls, ``qemu_ld`` calls, and ``qemu_st`` calls;
* explicit synthetic exit reasons, starting with budget expiry;
* compatibility fallback outside the performance gate, and no-silent-fallback
  behavior for unsupported hot TBs during performance proof.

The deterministic model lives in
``scripts/ci/wasmjit-runloop-model.mjs`` and is tested by
``scripts/ci/wasmjit-runloop-model-test.mjs``.  It is deliberately not wired
into QEMU execution yet; it is the shape gate that prevents W2 from falling
back to the rejected direct-boundary pattern.

The accepted W2n proof was:

.. code-block:: text

  node --check scripts/ci/wasmjit-runloop-model.mjs
  node --check scripts/ci/wasmjit-runloop-model-test.mjs
  node scripts/ci/wasmjit-runloop-model-test.mjs
  git diff --check

For one call with ``budget=1000000`` the model records:

.. code-block:: text

  generatedGuestInstructions=4000000
  generatedChainLength=1000000
  tlbHitAccesses=2000000
  helperCalls=0
  qemuLoadCalls=0
  qemuStoreCalls=0
  tb0Executions=500000
  tb1Executions=500000

The next W2 step is QEMU-facing integration of this contract plus measured
ALU/branch and TLB-hit RAM microbenches against a TCI-like baseline.  A
generic Linux or Bus Engine OS browser speed gate must not run again until
that microbench gate shows a multiple-times win from the run/exit shape.

W2o-a run/exit ABI and model benchmark
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The QEMU-facing scaffolding now has a run/exit ABI in ``tcg/wasm64.h``:

* ``TCGWasm64RunMode`` separates compatibility mode from performance-proof
  mode.
* ``TCGWasm64RunExitReason`` names the synthetic exits: budget, MMIO,
  TLB miss or fault, interrupt, helper, unsupported, HLT, and invalidation.
* ``TCGWasm64RunExit`` carries the exit payload.
* ``TCGWasm64RunCounters`` carries the W2 metrics: generated and fallback
  guest instructions, generated-body time, TCI dispatch time, TB lookup time,
  helper/``qemu_ld``/``qemu_st`` time and call counts, compile/instantiate
  time, generated chain length, inline TLB-hit loads and stores, and per-exit
  counters.
* ``TCGWasm64RunContext`` is the C-side context for the eventual
  ``wasmjit_run()`` boundary.

The deterministic model benchmark was updated so measured run time excludes
module construction, compilation, instantiation, context initialization, and
expected-value calculation.  The accepted local command was:

.. code-block:: text

  node --input-type=module -e 'import {runWasmjitRunloopBenchmark} from "./scripts/ci/wasmjit-runloop-model.mjs"; console.log(JSON.stringify(await runWasmjitRunloopBenchmark({budget:1000000, rounds:5}), null, 2));'

The result was:

.. code-block:: json

  {
    "format": 1,
    "purpose": "qemu-wasmjit-runloop-model-benchmark",
    "version": 1,
    "budget": 1000000,
    "rounds": 5,
    "wasmBestMs": 4.127262999999999,
    "tciLikeBestMs": 106.78072000000003,
    "bestRatio": 25.87204159269716
  }

This is not a QEMU generic smoke result and not a Bus Engine OS proof.  It is
the deterministic micro-hotset evidence that the run/exit shape can clear the
model-level speed gate when setup and bookkeeping are kept out of the measured
run.  The remaining W2 work is to move this shape into QEMU runtime execution
without falling back to the rejected per-TB generated wrapper.

W2o-b QEMU-facing microbench split
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The deterministic run-loop model now uses the same run-context and exit-frame
offsets declared in ``tcg/wasm64.h``.  The header exposes
``TCG_WASM64_RUN_CTX_*`` and ``TCG_WASM64_RUN_EXIT_*`` offset macros, and
``tcg/wasm64.c`` guards them with ``QEMU_BUILD_BUG_ON()`` checks.  The
JavaScript contract test reads those macros and verifies that the generated
Wasm model uses the same offsets for ``guest_ram``, ``counters``, and
``exit``.  This keeps the deterministic microbench tied to the ABI QEMU will
use instead of a private JS-only layout.

The benchmark now runs two workload families:

* ``alu-branch``: internal two-TB dispatch with arithmetic and branches only.
* ``tlb-hit-ram``: the same dispatch shape plus inline guest-RAM load/store
  operations through the run context's ``guest_ram`` pointer.

The accepted local command was:

.. code-block:: text

  node --input-type=module -e 'import {runWasmjitRunloopBenchmark,WASMJIT_WORKLOAD_ALU_BRANCH,WASMJIT_WORKLOAD_TLB_HIT_RAM} from "./scripts/ci/wasmjit-runloop-model.mjs"; const out=[]; for (const workload of [WASMJIT_WORKLOAD_ALU_BRANCH,WASMJIT_WORKLOAD_TLB_HIT_RAM]) out.push(await runWasmjitRunloopBenchmark({budget:1000000, rounds:5, workload})); console.log(JSON.stringify(out, null, 2));'

Results:

.. code-block:: text

  alu-branch:
    wasmBestMs=0.9502170000000021
    tciLikeBestMs=110.12317500000006
    bestRatio=115.89265925572771

  tlb-hit-ram:
    wasmBestMs=2.4207790000000386
    tciLikeBestMs=189.05584899999997
    bestRatio=78.09711212795425

For both workloads the generated run loop executed one ``1000000``-step
budget before returning for budget expiry, recorded
``generatedGuestInstructions=4000000`` and
``generatedChainLength=1000000``, and recorded zero helper,
``qemu_ld``, and ``qemu_st`` calls.

This is still not a generic Chromium smoke and not a Bus Engine OS proof.  It
does, however, satisfy the deterministic W2 microbench gate for the run/exit
shape.  The next step is to execute this ABI from the actual Emscripten/QEMU
runtime path and export the same metrics in result JSON before attempting the
W3 generic speed gate again.
