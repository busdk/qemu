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
MVP is console-first and does not require WebGPU, a graphical desktop,
production networking, or durable browser storage.  The experimental
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
* describes the later path for browser graphics, networking, persistence, and
  QMP integration without making them MVP requirements;
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
  artifact kind, byte size, and SHA-256 hash.  The manifest deliberately does
  not include guest kernel, rootfs, or product metadata; those belong to the
  later harness or downstream integration layer.
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
  implementation proof for ``WASM-017b``; an official CI job still needs the
  asset-fetch wiring that supplies the pinned TuxBoot kernel and rootfs files
  before invoking these scripts.
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
* The browser smoke runner now records the final page status and supports
  ``--page-text-tail-bytes`` so browser failures can preserve a larger bounded
  serial-output tail in JSON without changing the page output cap.  A Chromium
  ``141.0.7390.37`` proof with ``--append-extra qemu_wasm_append_probe=1``
  reached ``QEMU_WASM_LINUX_BOOT_OK`` after roughly ``81`` seconds.  Its
  result JSON recorded ``pageStatus`` as
  ``marker reached: QEMU_WASM_LINUX_BOOT_OK`` and the captured page tail
  contained both kernel command-line records with the appended probe.
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
  reusable command path for ``WASM-017c``.  The remaining ``WASM-017c`` work is
  deciding where to place the GitLab CI job and cache policy.
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
* ``.gitlab-ci.d/buildtest.yml`` also contains an optional
  ``smoke-wasm64-64bit-browser`` test job.  It uses the same
  ``build-wasm64-64bit`` artifacts, prepares the pinned TuxBoot smoke guest in
  a disposable Playwright ``v1.56.1`` browser image, installs the missing
  ``zstd`` tool and the matching ``playwright@1.56.1`` Node package, records
  ``build/wasm-browser-memory-probe.json`` with
  ``scripts/ci/wasm-browser-memory-probe-runner.mjs``, then runs
  ``scripts/ci/wasm-browser-smoke-runner.mjs`` and records
  ``build/wasm-browser-smoke-result.json``.  The job defaults to
  ``QEMU_WASM_BROWSER=chromium`` but can be replayed with another Playwright
  browser name, such as ``firefox``, for matrix investigation.  The job is
  optional because the acceptable upstream browser image, browser matrix, and
  runtime cost policy still need maintainer review.
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
  number``.
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
* emit enough structured logs to diagnose host startup, guest boot, and
  shutdown failures;
* provide a repeatable browser or headless-browser boot test that proves the
  Linux guest reaches a declared readiness marker;
* package QEMU/WASM artifacts and guest inputs without requiring ad hoc manual
  JavaScript edits.

Bus Engine OS is the downstream proof guest.  The upstream QEMU work should
not contain Bus-specific code.

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
  ``scripts/ci/wasm-memory-probe.mjs`` and documentation.

Proof:
  ``node scripts/ci/wasm-memory-probe.mjs --memory64`` emits JSON with the
  runtime version, page size, tested memory sizes, shared/unshared mode,
  optional ``address: "i64"`` mode, and exact constructor failures.  The
  helper can also be imported by a later browser harness.

Non-goals:
  No claim that Node.js memory behavior represents browser compatibility.

WASM-007b: Add browser memory probe runner
------------------------------------------

Scope:
  Make browser memory-limit evidence repeatable without manual copy/paste from
  a browser window.

Touches:
  ``scripts/ci/wasm-browser-memory-probe-runner.mjs``,
  ``.gitlab-ci.d/buildtest.yml``, and documentation.

Proof:
  ``node scripts/ci/wasm-browser-memory-probe-runner.mjs --memory64`` starts
  the isolated probe server, drives a Playwright browser, prints JSON with
  browser runner metadata, and can save the JSON as a CI artifact.  Local
  Playwright runs recorded Chromium, Firefox, and WebKit behavior for
  default-address memory and ``address: "i64"`` memory.

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
  ``scripts/ci/wasm-artifact-manifest.py``, CI artifact configuration, and
  documentation.

Proof:
  The CI job writes ``qemu-system-wasm-artifacts.json`` with format version,
  artifact paths, artifact kinds, byte sizes, and SHA-256 hashes.  Later
  harness manifests may reference guest kernel, rootfs, optional initrd,
  firmware paths, memory size, and boot arguments, but those inputs are not
  part of this QEMU build-artifact manifest.

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

Non-goals:
  No persistent storage.

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
  kernel argument forwarding.

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
  Remaining work is CI wiring, caching, and update policy for the pinned
  TuxBoot kernel/rootfs assets.

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
  the generic QEMU browser harness.

Touches:
  Downstream documentation only, outside upstream QEMU if implemented.

Proof:
  The QEMU side remains product-neutral.

Non-goals:
  No Bus-specific source code in upstream QEMU.

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
  Documentation only.

Proof:
  MVP examples omit network devices unless explicitly testing networking.

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

WASM-031: Document serial-only graphics boundary
------------------------------------------------

Scope:
  State that MVP has no framebuffer or desktop graphics.

Touches:
  Documentation only.

Proof:
  No MVP test uses WebGPU, Canvas graphics, VGA, or virtio-gpu.

Non-goals:
  No graphical support in MVP.

WASM-032: Design framebuffer-to-canvas path
-------------------------------------------

Scope:
  Plan the first graphical milestone after MVP.

Touches:
  Design docs.

Proof:
  The design distinguishes simple framebuffer presentation from accelerated
  virtio-gpu/WebGPU research.

Non-goals:
  No WebGPU implementation.

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
  No monolithic Browser Lab patch.

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
  * Avoid downstream QMP extensions for Browser Lab unless a generic QEMU
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
  Keep graphics out of the MVP while preserving a later path.

Work items:
  * MVP: serial console only.
  * Later: framebuffer-to-canvas output.
  * Later: 2D display backend suitable for simple graphical guests.
  * Research: WebGPU-backed acceleration and virtio-gpu integration.

Acceptance:
  No MVP acceptance test depends on WebGPU or browser graphics.

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

* a Browser Lab runtime;
* a documentation and support reproduction environment;
* a serial-console test target;
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
