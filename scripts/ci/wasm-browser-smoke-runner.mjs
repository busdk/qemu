#!/usr/bin/env node
/*
 * Run the QEMU WebAssembly browser smoke harness with Playwright.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGuestManifest } from "./wasm-guest-manifest.mjs";
import {
  closePlaywrightBrowser,
  installSignalCleanup,
  loadPlaywrightBrowser,
  playwrightLaunchOptions,
} from "./wasm-playwright-loader.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const MAX_DIAGNOSTIC_ENTRIES = 50;
const DEFAULT_PAGE_TEXT_TAIL_BYTES = 8192;
const DEFAULT_PROGRESS_SAMPLE_INTERVAL_MS = 10000;
const DEFAULT_PROGRESS_SAMPLE_LIMIT = 120;
const DEFAULT_IDLE_TIMEOUT_MS = 0;

class UsageError extends Error {
  constructor(status) {
    super("usage");
    this.name = "UsageError";
    this.status = status;
  }
}

function usage(status) {
  const stream = status === 0 ? process.stdout : process.stderr;
  stream.write(`usage: wasm-browser-smoke-runner.mjs --artifact-dir DIR --kernel FILE --initrd FILE [OPTIONS]

Options:
  --append-extra TEXT Extra Linux kernel arguments appended to the default
  --artifact-dir DIR  Directory containing qemu-system-*.js/.wasm artifacts
  --browser NAME      Browser engine to launch (default: chromium)
  --cpu MODEL         Guest CPU model passed to QEMU
  --display MODE     Browser display mode: none, sdl, or wasm (default: none)
  --display-device KIND
                     QEMU display device: default, none, stdvga,
                     virtio-vga, or virtio-gpu-pci
  --expected-resolution WIDTHxHEIGHT
                     Expected browser canvas resolution metadata
  --expect-display-hash HASH
                     Require an exact display pixel hash
  --expect-text TEXT  Additional output text required for success
  --focus-display    Focus the browser display surface before QEMU starts
  --firmware-dir DIR  Directory containing qboot.rom and linuxboot_dma.bin
  --guest-manifest FILE
                     JSON file with guest and runner defaults
  --harness-self-test
                     Run deterministic browser display/input harness proof
                     without launching QEMU
  --harness-expected-key-events N
                     Expected delivered key events in --harness-self-test
  --host HOST         Bind address for the local smoke server
  --idle-timeout-ms MS
                     Fail when serial output is idle for this long
                     after guest output has started (default: disabled)
  --idle-after-text TEXT
                     Only apply --idle-timeout-ms while the last serial line
                     contains this text
  --guest-idle-timeout-ms MS
                     Fail when guest-origin serial output is idle for this
                     long, ignoring QEMU instrumentation lines
                     (default: disabled)
  --guest-idle-after-text TEXT
                     Only apply --guest-idle-timeout-ms while the last
                     guest-origin serial line contains this text
  --initrd FILE       Smoke initramfs image
  --kernel FILE       64-bit Linux bzImage
  --keyboard-after-text TEXT
                     Wait until browser-captured serial output contains TEXT
                     before typing --keyboard-text
  --keyboard-text TEXT
                     Type TEXT into the focused browser display canvas
  --serial-input-after-text TEXT
                     Wait until browser-captured serial output contains TEXT
                     before writing --serial-input-text to primary serial
  --serial-input-text TEXT
                     Write raw text to the browser-backed primary serial port
  --pre-serial-input-wait-ms MS
                     Wait after --serial-input-after-text is observed before
                     writing --serial-input-text
  --pre-keyboard-wait-ms MS
                     Wait after --keyboard-after-text is observed before
                     typing --keyboard-text
  --post-keyboard-wait-ms MS
                     Wait after successful marker detection before capturing
                     final display evidence when --keyboard-text is used
  --power-operation OP
                     Request a power operation after the marker gate:
                     shutdown, reboot, guest-powerdown, force-reset, or
                     force-poweroff
  --power-timeout-ms MS
                     Timeout for guest-acknowledged power operations
  --kernel-append TEXT
                     Full Linux kernel arguments, replacing smoke defaults
  --machine MACHINE  QEMU machine name passed with -M
  --marker TEXT       Output text required for success
  --max-output-bytes N
                     Maximum browser page output bytes to keep
  --memory SIZE       Guest memory size passed to QEMU
  --network MODE      Network mode: none or default (default: none)
  --no-serial-fallback
                     Record that serial-only fallback is not acceptable for
                     this display/input proof
  --out FILE          Write smoke result JSON to FILE
  --page-text-tail-bytes N
                     Maximum page text tail bytes to keep in result JSON
  --perf-attribution
                     Enable QEMU/browser performance attribution summaries
  --perf-attribution-interval N
                     Attribution event interval between summaries
                     (default: 10000)
  --port PORT         Local smoke server port
  --program FILE      JavaScript launcher inside artifact dir
  --wasm FILE         WebAssembly module inside artifact dir
  --target-arch ARCH  Guest target architecture for browser firmware mounts
  --persistent-disk  Add an OPFS-backed writable virtio disk
  --persistent-disk-device KIND
                     Persistent disk device kind: virtio-mmio or virtio-pci
  --persistent-disk-opfs-name NAME
                     OPFS file name used by the persistent disk
  --persistent-disk-path PATH
                     In-guest path used for the persistent raw disk
  --persistent-disk-size-bytes N
                     Persistent disk size when no OPFS image exists
  --persistent-disk-storage MODE
                     Persistent disk storage backend (default: opfs)
  --progress-sample-interval-ms MS
                     Interval for smoke progress samples in result JSON
  --progress-sample-limit N
                     Maximum smoke progress samples to keep
  --perf-attribution-tci-interval N
                     TCI TB-entry interval between CPU attribution summaries
                     (default: 1000000)
  --qemu-arg ARG     Extra QEMU argument appended to the smoke command
  --require-display-output
                     Require non-black browser display pixels before success
  --display-min-nonblack-pixels N
                     Minimum non-black pixels for --require-display-output
  --rootfs FILE       Raw root filesystem image exposed as /dev/vda
  --rootfs-device KIND
                     Rootfs block device kind: virtio-mmio or virtio-pci
  --rootfs-opfs-name NAME
                     OPFS file name used by --rootfs-storage opfs-snapshot
  --rootfs-storage MODE
                     Rootfs browser storage mode: memfs or opfs-snapshot
                     (default: memfs)
  --screenshot FILE  Save a browser page screenshot to FILE
  --screenshot-full-page
                     Capture the full scrollable page instead of the viewport
  --timeout-ms MS     Timeout in milliseconds
  --tcg-hotblocks    Enable QEMU TCG hot-block instrumentation and collect
                     summaries in result JSON
  --tcg-hotblocks-interval N
                     TB execution interval between hotspot summaries
                     (default: 10000)
  --tcg-hotblocks-op-sample N
                     Count one TCI opcode per N interpreted opcodes
                     (default: 1, exact)
  --tcg-hotblocks-op-limit N
                     Stop opcode sampling after approximately N interpreted
                     opcodes; 0 means unlimited (default: 134217728)
  --tcg-hotblocks-top N
                     Maximum hotspot entries per summary (default: 12)
  --tci-fast-gates  Enable opt-in TCI translated-block feature-gate caching
  --tci-progress    Enable opt-in TCI translation-block progress summaries
                    for default-path browser diagnostics
  --tci-progress-interval N
                    TB entries between TCI progress summaries
                    (default: 100000)
  --tci-wasm-generated-trace
                    Emit bounded TCI block and helper trace diagnostics
                    into the smoke result JSON
  --tci-wasm-generated-trace-limit N
                    Maximum generated trace events to keep (default: 64)
  --fw-cfg-trace
                    Emit bounded fw_cfg selector/read trace diagnostics into
                    the smoke result JSON
  --fw-cfg-trace-limit N
                    Maximum fw_cfg trace events to keep (default: 256)
  --user-data-dir DIR
                    Browser profile directory reused for OPFS restart proofs
  --visual-marker TEXT
                     Expected visual marker metadata for display proofs
  --wasm64-one-tb-differential
                     Enable opt-in generated-vs-TCI proof for one live x86 TB
  --wasm64-live-one-tb-differential
                     Enable opt-in generated-vs-reference proof for one real
                     translated x86 TB shape
  --wasm64-live-tb-coverage
                     Enable opt-in generated execution proof for one real
                     live generated-output TB before falling back to TCI
  --wasm64-live-generated-exec
                     Enable opt-in committed live metadata-backed generated TB
                     execution for supported TBs before TCI fallback
  --wasm64-live-generated-exec-no-fallback
                     Fail loudly instead of silently using TCI when live
                     generated execution rejects an enabled TB
  --wasm64-live-generated-exec-preflight
                     Fail before a long browser run when live generated
                     execution reaches the preflight limit without retiring
                     generated guest instructions
  --wasm64-live-generated-exec-preflight-limit N
                     Live generated execution preflight attempts before
                     failing when no generated body executes (default: 10000)
  --wasm64-runloop-smoke
                     Enable opt-in QEMU wasm64 run/exit runtime smoke
  --wasm64-tcg-summary
                     Enable opt-in qemu-wasm64-tcg summary emission
  --wasm64-tcg-summary-interval N
                     Live translated-TB interval between wasm64 TCG summaries
                     (default: 10000)
  --require-wasm64-tcg-coverage
                     Fail unless the final wasm64 TCG summary reports
                     nonzero generated live-TB coverage
  --min-wasm64-tcg-coverage-ppm N
                     Minimum generated coverage ppm for
                     --require-wasm64-tcg-coverage (default: 1)
  --require-wasm64-tcg-fallback-attribution
                     Fail unless the final wasm64 TCG evidence includes
                     unsupported op shapes or hot-block fallback context
  --help              Show this help

Environment:
  QEMU_WASM_BROWSER_EXECUTABLE
                     Browser executable path used for Playwright launch
  QEMU_WASM_CHROMIUM_EXECUTABLE
                     Chromium-specific executable path; overrides the generic
                     executable when --browser chromium
`);
  throw new UsageError(status);
}

export function parseArgs(argv) {
  const options = {
    appendExtra: "",
    artifactDir: null,
    browser: "chromium",
    cpu: "Nehalem",
    display: "none",
    displayDevice: "default",
    expectedResolution: "",
    expectDisplayHash: "",
    expectText: [],
    focusDisplay: false,
    firmwareDir: "pc-bios",
    guestIdleAfterText: "",
    guestIdleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    guestManifest: null,
    harnessExpectedKeyEvents: 0,
    harnessSelfTest: false,
    host: "127.0.0.1",
    idleAfterText: "",
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    initrd: null,
    kernel: null,
    keyboardAfterText: "",
    keyboardText: "",
    preSerialInputWaitMs: 0,
    preKeyboardWaitMs: 0,
    serialInputAfterText: "",
    serialInputText: "",
    postKeyboardWaitMs: 0,
    powerOperation: "",
    powerTimeoutMs: 30000,
    kernelAppend: null,
    machine: "microvm,acpi=off",
    marker: "QEMU_WASM_LINUX_BOOT_OK",
    maxOutputBytes: 60000,
    memory: "512M",
    network: "none",
    allowSerialFallback: true,
    out: null,
    pageTextTailBytes: DEFAULT_PAGE_TEXT_TAIL_BYTES,
    performanceAttribution: false,
    performanceAttributionInterval: 10000,
    performanceAttributionTciInterval: 1000000,
    fwCfgTrace: false,
    fwCfgTraceLimit: 256,
    port: 8010,
    program: "qemu-system-x86_64.js",
    wasm: null,
    progressSampleIntervalMs: DEFAULT_PROGRESS_SAMPLE_INTERVAL_MS,
    progressSampleLimit: DEFAULT_PROGRESS_SAMPLE_LIMIT,
    persistentDisk: false,
    persistentDiskDevice: "virtio-mmio",
    persistentDiskOpfsName: "qemu-wasm-persistent.raw",
    persistentDiskPath: "/persistent.raw",
    persistentDiskSizeBytes: 256 * 1024 * 1024,
    persistentDiskStorage: "opfs",
    qemuArgs: [],
    requireDisplayOutput: false,
    displayMinNonblackPixels: 1,
    rootfs: null,
    rootfsDevice: "virtio-mmio",
    rootfsOpfsName: "qemu-wasm-rootfs.raw",
    rootfsStorage: "memfs",
    screenshot: null,
    screenshotFullPage: false,
    serviceBridge: null,
    targetArch: "x86_64",
    tcgHotblocks: false,
    tcgHotblocksOpLimit: 134217728,
    tcgHotblocksInterval: 10000,
    tcgHotblocksOpSample: 1,
    tcgHotblocksTop: 12,
    tciFastGates: false,
    tciProgress: false,
    tciProgressInterval: 100000,
    tciWasmGeneratedTrace: false,
    tciWasmGeneratedTraceLimit: 64,
    timeoutMs: 180000,
    userDataDir: null,
    visualMarker: "",
    wasm64OneTbDifferential: false,
    wasm64LiveOneTbDifferential: false,
    wasm64LiveTbCoverage: false,
    wasm64LiveGeneratedExec: false,
    wasm64LiveGeneratedExecNoFallback: false,
    wasm64LiveGeneratedExecPreflight: false,
    wasm64LiveGeneratedExecPreflightLimit: 10000,
    wasm64RunloopSmoke: false,
    wasm64TcgSummary: false,
    wasm64TcgSummaryInterval: 10000,
    requireWasm64TcgCoverage: false,
    minWasm64TcgCoveragePpm: 1,
    requireWasm64TcgFallbackAttribution: false,
  };
  const explicit = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--append-extra") {
      options.appendExtra = argv[++i];
      explicit.add("appendExtra");
    } else if (arg === "--artifact-dir") {
      options.artifactDir = argv[++i];
      explicit.add("artifactDir");
    } else if (arg === "--browser") {
      options.browser = argv[++i];
      explicit.add("browser");
    } else if (arg === "--cpu") {
      options.cpu = argv[++i];
      explicit.add("cpu");
    } else if (arg === "--display") {
      options.display = argv[++i];
      explicit.add("display");
    } else if (arg === "--display-device") {
      options.displayDevice = argv[++i];
      explicit.add("displayDevice");
    } else if (arg === "--expected-resolution") {
      options.expectedResolution = argv[++i];
      explicit.add("expectedResolution");
    } else if (arg === "--expect-display-hash") {
      options.expectDisplayHash = argv[++i];
      explicit.add("expectDisplayHash");
    } else if (arg === "--expect-text") {
      options.expectText.push(argv[++i]);
      explicit.add("expectText");
    } else if (arg === "--focus-display") {
      options.focusDisplay = true;
      explicit.add("focusDisplay");
    } else if (arg === "--firmware-dir") {
      options.firmwareDir = argv[++i];
      explicit.add("firmwareDir");
    } else if (arg === "--guest-idle-timeout-ms") {
      options.guestIdleTimeoutMs = Number(argv[++i]);
      explicit.add("guestIdleTimeoutMs");
    } else if (arg === "--guest-idle-after-text") {
      options.guestIdleAfterText = argv[++i];
      explicit.add("guestIdleAfterText");
    } else if (arg === "--guest-manifest") {
      options.guestManifest = argv[++i];
    } else if (arg === "--harness-expected-key-events") {
      options.harnessExpectedKeyEvents = Number(argv[++i]);
      explicit.add("harnessExpectedKeyEvents");
    } else if (arg === "--harness-self-test") {
      options.harnessSelfTest = true;
      explicit.add("harnessSelfTest");
    } else if (arg === "--host") {
      options.host = argv[++i];
      explicit.add("host");
    } else if (arg === "--idle-timeout-ms") {
      options.idleTimeoutMs = Number(argv[++i]);
      explicit.add("idleTimeoutMs");
    } else if (arg === "--idle-after-text") {
      options.idleAfterText = argv[++i];
      explicit.add("idleAfterText");
    } else if (arg === "--initrd") {
      options.initrd = argv[++i];
      explicit.add("initrd");
    } else if (arg === "--kernel") {
      options.kernel = argv[++i];
      explicit.add("kernel");
    } else if (arg === "--keyboard-after-text") {
      options.keyboardAfterText = argv[++i];
      explicit.add("keyboardAfterText");
    } else if (arg === "--keyboard-text") {
      options.keyboardText = argv[++i];
      explicit.add("keyboardText");
    } else if (arg === "--serial-input-after-text") {
      options.serialInputAfterText = argv[++i];
      explicit.add("serialInputAfterText");
    } else if (arg === "--serial-input-text") {
      options.serialInputText = argv[++i];
      explicit.add("serialInputText");
    } else if (arg === "--pre-serial-input-wait-ms") {
      options.preSerialInputWaitMs = Number(argv[++i]);
      explicit.add("preSerialInputWaitMs");
    } else if (arg === "--pre-keyboard-wait-ms") {
      options.preKeyboardWaitMs = Number(argv[++i]);
      explicit.add("preKeyboardWaitMs");
    } else if (arg === "--post-keyboard-wait-ms") {
      options.postKeyboardWaitMs = Number(argv[++i]);
      explicit.add("postKeyboardWaitMs");
    } else if (arg === "--power-operation") {
      options.powerOperation = argv[++i];
      explicit.add("powerOperation");
    } else if (arg === "--power-timeout-ms") {
      options.powerTimeoutMs = Number(argv[++i]);
      explicit.add("powerTimeoutMs");
    } else if (arg === "--kernel-append") {
      options.kernelAppend = argv[++i];
      explicit.add("kernelAppend");
    } else if (arg === "--machine") {
      options.machine = argv[++i];
      explicit.add("machine");
    } else if (arg === "--marker") {
      options.marker = argv[++i];
      explicit.add("marker");
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(argv[++i]);
      explicit.add("maxOutputBytes");
    } else if (arg === "--memory") {
      options.memory = argv[++i];
      explicit.add("memory");
    } else if (arg === "--network") {
      options.network = argv[++i];
      explicit.add("network");
    } else if (arg === "--no-serial-fallback") {
      options.allowSerialFallback = false;
      explicit.add("allowSerialFallback");
    } else if (arg === "--out") {
      options.out = argv[++i];
      explicit.add("out");
    } else if (arg === "--page-text-tail-bytes") {
      options.pageTextTailBytes = Number(argv[++i]);
      explicit.add("pageTextTailBytes");
    } else if (arg === "--perf-attribution") {
      options.performanceAttribution = true;
      explicit.add("performanceAttribution");
    } else if (arg === "--perf-attribution-interval") {
      options.performanceAttributionInterval = Number(argv[++i]);
      explicit.add("performanceAttributionInterval");
    } else if (arg === "--perf-attribution-tci-interval") {
      options.performanceAttributionTciInterval = Number(argv[++i]);
      explicit.add("performanceAttributionTciInterval");
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
      explicit.add("port");
    } else if (arg === "--program") {
      options.program = argv[++i];
      explicit.add("program");
    } else if (arg === "--wasm") {
      options.wasm = argv[++i];
      explicit.add("wasm");
    } else if (arg === "--persistent-disk") {
      options.persistentDisk = true;
      explicit.add("persistentDisk");
    } else if (arg === "--persistent-disk-device") {
      options.persistentDiskDevice = argv[++i];
      explicit.add("persistentDiskDevice");
    } else if (arg === "--persistent-disk-opfs-name") {
      options.persistentDiskOpfsName = argv[++i];
      explicit.add("persistentDiskOpfsName");
    } else if (arg === "--persistent-disk-path") {
      options.persistentDiskPath = argv[++i];
      explicit.add("persistentDiskPath");
    } else if (arg === "--persistent-disk-size-bytes") {
      options.persistentDiskSizeBytes = Number(argv[++i]);
      explicit.add("persistentDiskSizeBytes");
    } else if (arg === "--persistent-disk-storage") {
      options.persistentDiskStorage = argv[++i];
      explicit.add("persistentDiskStorage");
    } else if (arg === "--progress-sample-interval-ms") {
      options.progressSampleIntervalMs = Number(argv[++i]);
      explicit.add("progressSampleIntervalMs");
    } else if (arg === "--progress-sample-limit") {
      options.progressSampleLimit = Number(argv[++i]);
      explicit.add("progressSampleLimit");
    } else if (arg === "--qemu-arg") {
      options.qemuArgs.push(argv[++i]);
      explicit.add("qemuArgs");
    } else if (arg === "--require-display-output") {
      options.requireDisplayOutput = true;
      explicit.add("requireDisplayOutput");
    } else if (arg === "--display-min-nonblack-pixels") {
      options.displayMinNonblackPixels = Number(argv[++i]);
      explicit.add("displayMinNonblackPixels");
    } else if (arg === "--rootfs") {
      options.rootfs = argv[++i];
      explicit.add("rootfs");
    } else if (arg === "--rootfs-device") {
      options.rootfsDevice = argv[++i];
      explicit.add("rootfsDevice");
    } else if (arg === "--rootfs-opfs-name") {
      options.rootfsOpfsName = argv[++i];
      explicit.add("rootfsOpfsName");
    } else if (arg === "--rootfs-storage") {
      options.rootfsStorage = argv[++i];
      explicit.add("rootfsStorage");
    } else if (arg === "--screenshot") {
      options.screenshot = argv[++i];
      explicit.add("screenshot");
    } else if (arg === "--screenshot-full-page") {
      options.screenshotFullPage = true;
      explicit.add("screenshotFullPage");
    } else if (arg === "--target-arch") {
      options.targetArch = argv[++i];
      explicit.add("targetArch");
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
      explicit.add("timeoutMs");
    } else if (arg === "--tcg-hotblocks") {
      options.tcgHotblocks = true;
      explicit.add("tcgHotblocks");
    } else if (arg === "--tcg-hotblocks-interval") {
      options.tcgHotblocksInterval = Number(argv[++i]);
      explicit.add("tcgHotblocksInterval");
    } else if (arg === "--tcg-hotblocks-op-sample") {
      options.tcgHotblocksOpSample = Number(argv[++i]);
      explicit.add("tcgHotblocksOpSample");
    } else if (arg === "--tcg-hotblocks-op-limit") {
      options.tcgHotblocksOpLimit = Number(argv[++i]);
      explicit.add("tcgHotblocksOpLimit");
    } else if (arg === "--tcg-hotblocks-top") {
      options.tcgHotblocksTop = Number(argv[++i]);
      explicit.add("tcgHotblocksTop");
    } else if (arg === "--tci-fast-gates") {
      options.tciFastGates = true;
      explicit.add("tciFastGates");
    } else if (arg === "--tci-progress") {
      options.tciProgress = true;
      explicit.add("tciProgress");
    } else if (arg === "--tci-progress-interval") {
      options.tciProgressInterval = Number(argv[++i]);
      explicit.add("tciProgressInterval");
    } else if (arg === "--tci-wasm-generated-trace") {
      options.tciWasmGeneratedTrace = true;
      explicit.add("tciWasmGeneratedTrace");
    } else if (arg === "--tci-wasm-generated-trace-limit") {
      options.tciWasmGeneratedTraceLimit = Number(argv[++i]);
      explicit.add("tciWasmGeneratedTraceLimit");
    } else if (arg === "--fw-cfg-trace") {
      options.fwCfgTrace = true;
      explicit.add("fwCfgTrace");
    } else if (arg === "--fw-cfg-trace-limit") {
      options.fwCfgTraceLimit = Number(argv[++i]);
      explicit.add("fwCfgTraceLimit");
    } else if (arg === "--user-data-dir") {
      options.userDataDir = argv[++i];
      explicit.add("userDataDir");
    } else if (arg === "--visual-marker") {
      options.visualMarker = argv[++i];
      explicit.add("visualMarker");
    } else if (arg === "--wasm64-one-tb-differential") {
      options.wasm64OneTbDifferential = true;
      explicit.add("wasm64OneTbDifferential");
    } else if (arg === "--wasm64-live-one-tb-differential") {
      options.wasm64LiveOneTbDifferential = true;
      explicit.add("wasm64LiveOneTbDifferential");
    } else if (arg === "--wasm64-live-tb-coverage") {
      options.wasm64LiveTbCoverage = true;
      explicit.add("wasm64LiveTbCoverage");
    } else if (arg === "--wasm64-live-generated-exec") {
      options.wasm64LiveGeneratedExec = true;
      explicit.add("wasm64LiveGeneratedExec");
    } else if (arg === "--wasm64-live-generated-exec-no-fallback") {
      options.wasm64LiveGeneratedExec = true;
      options.wasm64LiveGeneratedExecNoFallback = true;
      explicit.add("wasm64LiveGeneratedExec");
      explicit.add("wasm64LiveGeneratedExecNoFallback");
    } else if (arg === "--wasm64-live-generated-exec-preflight") {
      options.wasm64LiveGeneratedExec = true;
      options.wasm64LiveGeneratedExecPreflight = true;
      explicit.add("wasm64LiveGeneratedExec");
      explicit.add("wasm64LiveGeneratedExecPreflight");
    } else if (arg === "--wasm64-live-generated-exec-preflight-limit") {
      options.wasm64LiveGeneratedExecPreflightLimit = Number(argv[++i]);
      explicit.add("wasm64LiveGeneratedExecPreflightLimit");
    } else if (arg === "--wasm64-runloop-smoke") {
      options.wasm64RunloopSmoke = true;
      explicit.add("wasm64RunloopSmoke");
    } else if (arg === "--wasm64-tcg-summary") {
      options.wasm64TcgSummary = true;
      explicit.add("wasm64TcgSummary");
    } else if (arg === "--wasm64-tcg-summary-interval") {
      options.wasm64TcgSummaryInterval = Number(argv[++i]);
      explicit.add("wasm64TcgSummaryInterval");
    } else if (arg === "--require-wasm64-tcg-coverage") {
      options.requireWasm64TcgCoverage = true;
      explicit.add("requireWasm64TcgCoverage");
    } else if (arg === "--min-wasm64-tcg-coverage-ppm") {
      options.minWasm64TcgCoveragePpm = Number(argv[++i]);
      explicit.add("minWasm64TcgCoveragePpm");
    } else if (arg === "--require-wasm64-tcg-fallback-attribution") {
      options.requireWasm64TcgFallbackAttribution = true;
      explicit.add("requireWasm64TcgFallbackAttribution");
    } else if (arg === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage(2);
    }
  }

  applyGuestManifest(options, explicit, {
    booleanFields: [
      "allowSerialFallback",
      "focusDisplay",
      "harnessSelfTest",
      "persistentDisk",
      "performanceAttribution",
      "requireDisplayOutput",
      "screenshotFullPage",
      "tcgHotblocks",
      "tciFastGates",
      "tciProgress",
      "tciWasmGeneratedTrace",
      "wasm64OneTbDifferential",
      "wasm64LiveOneTbDifferential",
      "wasm64LiveTbCoverage",
      "wasm64LiveGeneratedExec",
      "wasm64LiveGeneratedExecNoFallback",
      "wasm64LiveGeneratedExecPreflight",
      "wasm64RunloopSmoke",
      "wasm64TcgSummary",
      "requireWasm64TcgCoverage",
      "requireWasm64TcgFallbackAttribution",
    ],
    checksumFields: ["kernel", "initrd", "rootfs"],
    integerFields: [
      "maxOutputBytes",
      "displayMinNonblackPixels",
      "harnessExpectedKeyEvents",
      "guestIdleTimeoutMs",
      "idleTimeoutMs",
      "pageTextTailBytes",
      "persistentDiskSizeBytes",
      "performanceAttributionInterval",
      "performanceAttributionTciInterval",
      "minWasm64TcgCoveragePpm",
      "wasm64LiveGeneratedExecPreflightLimit",
      "wasm64TcgSummaryInterval",
      "port",
      "preSerialInputWaitMs",
      "preKeyboardWaitMs",
      "postKeyboardWaitMs",
      "powerTimeoutMs",
      "progressSampleIntervalMs",
      "progressSampleLimit",
      "tcgHotblocksInterval",
      "tcgHotblocksOpLimit",
      "tcgHotblocksOpSample",
      "tcgHotblocksTop",
      "tciWasmGeneratedTraceLimit",
      "timeoutMs",
    ],
    pathFields: [
      "artifactDir",
      "firmwareDir",
      "initrd",
      "kernel",
      "out",
      "rootfs",
      "screenshot",
      "userDataDir",
    ],
    stringFields: [
      "appendExtra",
      "artifactDir",
      "browser",
      "cpu",
      "display",
      "displayDevice",
      "expectedResolution",
      "expectDisplayHash",
      "firmwareDir",
      "guestIdleAfterText",
      "host",
      "idleAfterText",
      "initrd",
      "kernel",
      "keyboardAfterText",
      "keyboardText",
      "kernelAppend",
      "machine",
      "marker",
      "memory",
      "network",
      "out",
      "persistentDiskDevice",
      "persistentDiskOpfsName",
      "persistentDiskPath",
      "persistentDiskStorage",
      "powerOperation",
      "program",
      "rootfs",
      "rootfsDevice",
      "rootfsOpfsName",
      "rootfsStorage",
      "screenshot",
      "serialInputAfterText",
      "serialInputText",
      "targetArch",
      "visualMarker",
      "wasm",
    ],
    stringListFields: ["expectText", "qemuArgs"],
    serviceBridgeField: "serviceBridge",
  });
  if (options.initrd === "") {
    options.initrd = null;
  }

  if (options.harnessSelfTest) {
    if (!explicit.has("display")) {
      options.display = "wasm";
    }
    if (!explicit.has("focusDisplay")) {
      options.focusDisplay = true;
    }
    if (!explicit.has("marker")) {
      options.marker = "QEMU_WASM_BROWSER_HARNESS_OK";
    }
    if (!explicit.has("requireDisplayOutput")) {
      options.requireDisplayOutput = true;
    }
  }

  if (!options.harnessSelfTest && options.artifactDir === null) {
    console.error("--artifact-dir is required");
    usage(2);
  }
  if (!options.harnessSelfTest && options.kernel === null) {
    console.error("--kernel is required");
    usage(2);
  }
  if (!["memfs", "opfs-snapshot"].includes(options.rootfsStorage)) {
    console.error("--rootfs-storage must be memfs or opfs-snapshot");
    usage(2);
  }
  if (options.rootfsStorage === "opfs-snapshot" && options.rootfs === null) {
    console.error("--rootfs-storage opfs-snapshot requires --rootfs");
    usage(2);
  }
  if (!options.harnessSelfTest && options.initrd === null && options.rootfs === null) {
    console.error("either --initrd or --rootfs is required");
    usage(2);
  }
  if (!Number.isInteger(options.harnessExpectedKeyEvents) || options.harnessExpectedKeyEvents < 0) {
    console.error("--harness-expected-key-events must be a non-negative integer");
    usage(2);
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    console.error("--port must be an integer from 1 to 65535");
    usage(2);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    console.error("--timeout-ms must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.tcgHotblocksInterval) || options.tcgHotblocksInterval <= 0) {
    console.error("--tcg-hotblocks-interval must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.tcgHotblocksOpSample) || options.tcgHotblocksOpSample <= 0) {
    console.error("--tcg-hotblocks-op-sample must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.tcgHotblocksOpLimit) || options.tcgHotblocksOpLimit < 0) {
    console.error("--tcg-hotblocks-op-limit must be a non-negative integer");
    usage(2);
  }
  if (
    !Number.isInteger(options.tcgHotblocksTop) ||
    options.tcgHotblocksTop <= 0 ||
    options.tcgHotblocksTop > 64
  ) {
    console.error("--tcg-hotblocks-top must be an integer from 1 to 64");
    usage(2);
  }
  if (!Number.isInteger(options.tciWasmGeneratedTraceLimit) ||
      options.tciWasmGeneratedTraceLimit < 0 ||
      options.tciWasmGeneratedTraceLimit > 1024) {
    console.error("--tci-wasm-generated-trace-limit must be an integer from 0 to 1024");
    usage(2);
  }
  if (!Number.isInteger(options.fwCfgTraceLimit) ||
      options.fwCfgTraceLimit < 0 ||
      options.fwCfgTraceLimit > 8192) {
    console.error("--fw-cfg-trace-limit must be an integer from 0 to 8192");
    usage(2);
  }
  if (!Number.isInteger(options.tciProgressInterval) ||
      options.tciProgressInterval <= 0) {
    console.error("--tci-progress-interval must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
    console.error("--max-output-bytes must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.idleTimeoutMs) || options.idleTimeoutMs < 0) {
    console.error("--idle-timeout-ms must be a non-negative integer");
    usage(2);
  }
  if (!Number.isInteger(options.guestIdleTimeoutMs) || options.guestIdleTimeoutMs < 0) {
    console.error("--guest-idle-timeout-ms must be a non-negative integer");
    usage(2);
  }
  if (!Number.isInteger(options.pageTextTailBytes) || options.pageTextTailBytes <= 0) {
    console.error("--page-text-tail-bytes must be a positive integer");
    usage(2);
  }
  if (
    !Number.isInteger(options.performanceAttributionInterval) ||
    options.performanceAttributionInterval <= 0
  ) {
    console.error("--perf-attribution-interval must be a positive integer");
    usage(2);
  }
  if (
    !Number.isInteger(options.performanceAttributionTciInterval) ||
    options.performanceAttributionTciInterval <= 0
  ) {
    console.error("--perf-attribution-tci-interval must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.progressSampleIntervalMs) || options.progressSampleIntervalMs <= 0) {
    console.error("--progress-sample-interval-ms must be a positive integer");
    usage(2);
  }
  if (!Number.isInteger(options.progressSampleLimit) || options.progressSampleLimit <= 0) {
    console.error("--progress-sample-limit must be a positive integer");
    usage(2);
  }
  if (
    !Number.isInteger(options.minWasm64TcgCoveragePpm) ||
    options.minWasm64TcgCoveragePpm <= 0 ||
    options.minWasm64TcgCoveragePpm > 1000000
  ) {
    console.error("--min-wasm64-tcg-coverage-ppm must be an integer from 1 to 1000000");
    usage(2);
  }
  if (
    !Number.isInteger(options.displayMinNonblackPixels) ||
    options.displayMinNonblackPixels <= 0
  ) {
    console.error("--display-min-nonblack-pixels must be a positive integer");
    usage(2);
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.rootfsDevice)) {
    console.error("--rootfs-device must be virtio-mmio or virtio-pci");
    usage(2);
  }
  if (!["virtio-mmio", "virtio-pci"].includes(options.persistentDiskDevice)) {
    console.error("--persistent-disk-device must be virtio-mmio or virtio-pci");
    usage(2);
  }
  if (
    !Number.isInteger(options.persistentDiskSizeBytes) ||
    options.persistentDiskSizeBytes <= 0
  ) {
    console.error("--persistent-disk-size-bytes must be a positive integer");
    usage(2);
  }
  if (options.persistentDiskOpfsName === "" || /[\\/]/.test(options.persistentDiskOpfsName)) {
    console.error("--persistent-disk-opfs-name must be a non-empty file name without path separators");
    usage(2);
  }
  if (!options.persistentDiskPath.startsWith("/")) {
    console.error("--persistent-disk-path must be an absolute in-guest path");
    usage(2);
  }
  if (options.persistentDiskStorage !== "opfs") {
    console.error("--persistent-disk-storage must be opfs");
    usage(2);
  }
  if (options.rootfsOpfsName === "" || /[\\/]/.test(options.rootfsOpfsName)) {
    console.error("--rootfs-opfs-name must be a non-empty file name without path separators");
    usage(2);
  }
  if (!["none", "sdl", "wasm"].includes(options.display)) {
    console.error("--display must be none, sdl, or wasm");
    usage(2);
  }
  if (!["default", "none", "stdvga", "virtio-vga", "virtio-gpu-pci"].includes(options.displayDevice)) {
    console.error("--display-device must be default, none, stdvga, virtio-vga, or virtio-gpu-pci");
    usage(2);
  }
  if (!["sdl", "wasm"].includes(options.display) && !["default", "none"].includes(options.displayDevice)) {
    console.error("--display-device requires --display sdl or --display wasm");
    usage(2);
  }
  if (
    options.expectedResolution !== "" &&
    /^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/.test(options.expectedResolution) === false
  ) {
    console.error("--expected-resolution must use WIDTHxHEIGHT");
    usage(2);
  }
  if (options.keyboardText !== "" && !["sdl", "wasm"].includes(options.display)) {
    console.error("--keyboard-text requires --display sdl or --display wasm");
    usage(2);
  }
  if (options.keyboardAfterText !== "" && options.keyboardText === "") {
    console.error("--keyboard-after-text requires --keyboard-text");
    usage(2);
  }
  if (options.serialInputAfterText !== "" && options.serialInputText === "") {
    console.error("--serial-input-after-text requires --serial-input-text");
    usage(2);
  }
  if (!Number.isInteger(options.preSerialInputWaitMs) || options.preSerialInputWaitMs < 0) {
    console.error("--pre-serial-input-wait-ms must be a non-negative integer");
    usage(2);
  }
  if (options.preSerialInputWaitMs > 0 && options.serialInputText === "") {
    console.error("--pre-serial-input-wait-ms requires --serial-input-text");
    usage(2);
  }
  if (!Number.isInteger(options.preKeyboardWaitMs) || options.preKeyboardWaitMs < 0) {
    console.error("--pre-keyboard-wait-ms must be a non-negative integer");
    usage(2);
  }
  if (options.preKeyboardWaitMs > 0 && options.keyboardText === "") {
    console.error("--pre-keyboard-wait-ms requires --keyboard-text");
    usage(2);
  }
  if (!Number.isInteger(options.postKeyboardWaitMs) || options.postKeyboardWaitMs < 0) {
    console.error("--post-keyboard-wait-ms must be a non-negative integer");
    usage(2);
  }
  if (options.postKeyboardWaitMs > 0 && options.keyboardText === "") {
    console.error("--post-keyboard-wait-ms requires --keyboard-text");
    usage(2);
  }
  if (options.requireDisplayOutput && !["sdl", "wasm"].includes(options.display)) {
    console.error("--require-display-output requires --display sdl or --display wasm");
    usage(2);
  }
  if (options.harnessSelfTest && !["sdl", "wasm"].includes(options.display)) {
    console.error("--harness-self-test requires --display sdl or --display wasm");
    usage(2);
  }
  if (!["none", "default"].includes(options.network)) {
    console.error("--network must be none or default");
    usage(2);
  }
  if (!["", "shutdown", "reboot", "guest-powerdown", "force-reset", "force-poweroff"].includes(options.powerOperation)) {
    console.error("--power-operation must be shutdown, reboot, guest-powerdown, force-reset, force-poweroff, or empty");
    usage(2);
  }
  if (!Number.isInteger(options.powerTimeoutMs) || options.powerTimeoutMs <= 0) {
    console.error("--power-timeout-ms must be a positive integer");
    usage(2);
  }
  if (options.wasm === null) {
    options.wasm = defaultWasmForProgram(options.program);
  }
  if (
    options.requireWasm64TcgCoverage ||
    options.requireWasm64TcgFallbackAttribution
  ) {
    options.wasm64TcgSummary = true;
    if (options.requireWasm64TcgCoverage) {
      options.wasm64LiveTbCoverage = true;
    }
  }

  return options;
}

function baseName(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || String(path);
}

function artifactUrlPath(path) {
  return `/artifacts/${baseName(path)}`;
}

function defaultWasmForProgram(program) {
  return String(program).endsWith(".js")
    ? `${String(program).slice(0, -3)}.wasm`
    : `${program}.wasm`;
}

function appendBounded(list, entry) {
  appendBoundedLimit(list, entry, MAX_DIAGNOSTIC_ENTRIES);
}

export function appendBoundedLimit(list, entry, limit) {
  list.push(entry);
  if (list.length > limit) {
    list.shift();
  }
}

export function isTerminalPageStatus(status, marker) {
  return status === `marker reached: ${marker}` ||
    status === "Bus Engine OS is ready" ||
    status.startsWith("program exited before marker:") ||
    status.startsWith("Bus Engine OS stopped before becoming ready:") ||
    status.startsWith("timeout waiting for ") ||
    status.startsWith("Startup timed out waiting for ") ||
    status === "failed";
}

export function isSuccessfulPageStatus(status, marker) {
  return status === `marker reached: ${marker}` ||
    status === "Bus Engine OS is ready";
}

function safeDiagnosticValue(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function requestInitiatorDiagnostic(request) {
  const frame = safeDiagnosticValue(() => request.frame(), null);
  return {
    frameUrl: frame ? safeDiagnosticValue(() => frame.url(), null) : null,
    resourceType: safeDiagnosticValue(() => request.resourceType(), null),
  };
}

function recentResourceError(resourceErrors) {
  if (!Array.isArray(resourceErrors) || resourceErrors.length === 0) {
    return null;
  }
  const entry = resourceErrors[resourceErrors.length - 1];
  return {
    elapsedMs: entry.elapsedMs,
    event: entry.event,
    method: entry.method,
    url: entry.url,
    status: entry.status ?? null,
    statusText: entry.statusText ?? null,
    failureText: entry.failureText ?? null,
    initiator: entry.initiator || null,
  };
}

function consoleLooksLikeResourceError(text) {
  return /Failed to load resource|Cross-Origin-Embedder-Policy|COEP|CORS|404|403|net::ERR_/i.test(text);
}

export function consoleMessageDiagnostic(message, elapsedMs, resourceErrors = []) {
  const text = message.text();
  return {
    elapsedMs,
    type: message.type(),
    text,
    location: message.location ? message.location() : null,
    resourceError: consoleLooksLikeResourceError(text)
      ? recentResourceError(resourceErrors)
      : null,
  };
}

export function pageErrorDiagnostic(error, elapsedMs, state = null) {
  return {
    elapsedMs,
    name: error && error.name ? error.name : "Error",
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null,
    state,
  };
}

export function requestFailureDiagnostic(request, elapsedMs) {
  const failure = request.failure();
  return {
    elapsedMs,
    method: request.method(),
    url: request.url(),
    failureText: failure && failure.errorText ? failure.errorText : null,
    initiator: requestInitiatorDiagnostic(request),
  };
}

export function responseErrorDiagnostic(response, elapsedMs) {
  const request = response.request();
  return {
    elapsedMs,
    method: request.method(),
    url: response.url(),
    status: response.status(),
    statusText: response.statusText(),
    initiator: requestInitiatorDiagnostic(request),
  };
}

export function progressSampleDiagnostic(result, elapsedMs, reason, state) {
  const previous = result.progressSamples.length > 0
    ? result.progressSamples[result.progressSamples.length - 1]
    : null;
  const previousState = previous ? previous.state : null;
  return {
    elapsedMs,
    reason,
    state,
    lineDelta: state && previousState ? state.lines - previousState.lines : null,
    outputByteDelta: state && previousState
      ? state.outputBytes - previousState.outputBytes
      : null,
    guestLineDelta: state && previousState &&
        Number.isInteger(state.guestLines) &&
        Number.isInteger(previousState.guestLines)
      ? state.guestLines - previousState.guestLines
      : null,
    guestOutputByteDelta: state && previousState &&
        Number.isInteger(state.guestOutputBytes) &&
        Number.isInteger(previousState.guestOutputBytes)
      ? state.guestOutputBytes - previousState.guestOutputBytes
      : null,
    guestHeartbeatDelta: state && previousState &&
        state.guestHeartbeat &&
        previousState.guestHeartbeat &&
        Number.isInteger(state.guestHeartbeat.count) &&
        Number.isInteger(previousState.guestHeartbeat.count)
      ? state.guestHeartbeat.count - previousState.guestHeartbeat.count
      : null,
    lastLineChanged: state && previousState
      ? state.lastLine !== previousState.lastLine
      : null,
    guestLastLineChanged: state && previousState
      ? state.guestLastLine !== previousState.guestLastLine
      : null,
    previousElapsedMs: previous ? previous.elapsedMs : null,
  };
}

function serialProgressSignature(sample, {
  bytesField = "outputBytes",
  linesField = "lines",
  lastLineField = "lastLine",
} = {}) {
  const state = sample && sample.state ? sample.state : null;
  if (state === null || !Number.isInteger(state[bytesField])) {
    return null;
  }
  if (state[bytesField] <= 0) {
    return null;
  }
  return {
    lines: Number.isInteger(state[linesField]) ? state[linesField] : null,
    outputBytes: state[bytesField],
    lastLine: typeof state[lastLineField] === "string" ? state[lastLineField] : "",
  };
}

function sameSerialProgress(left, right) {
  return left !== null &&
    right !== null &&
    left.lines === right.lines &&
    left.outputBytes === right.outputBytes &&
    left.lastLine === right.lastLine;
}

export function serialIdleDiagnostic(samples, idleTimeoutMs, idleAfterText = "") {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    return null;
  }
  const current = lastEntry(samples);
  const currentSignature = serialProgressSignature(current);
  if (current === null || currentSignature === null) {
    return null;
  }
  if (
    idleAfterText !== "" &&
    !currentSignature.lastLine.includes(idleAfterText)
  ) {
    return null;
  }

  let idleSinceElapsedMs = current.elapsedMs;
  for (let index = samples.length - 2; index >= 0; index--) {
    const previous = samples[index];
    const previousSignature = serialProgressSignature(previous);
    if (!sameSerialProgress(currentSignature, previousSignature)) {
      break;
    }
    idleSinceElapsedMs = previous.elapsedMs;
  }

  const idleMs = current.elapsedMs - idleSinceElapsedMs;
  if (idleMs < idleTimeoutMs) {
    return null;
  }
  return {
    idle: true,
    idleAfterText,
    idleMs,
    idleSinceElapsedMs,
    idleTimeoutMs,
    lastLine: currentSignature.lastLine,
    outputBytes: currentSignature.outputBytes,
    outputLines: currentSignature.lines,
  };
}

export function guestSerialIdleDiagnostic(samples, idleTimeoutMs, idleAfterText = "") {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    return null;
  }
  const current = lastEntry(samples);
  const currentSignature = serialProgressSignature(current, {
    bytesField: "guestOutputBytes",
    linesField: "guestLines",
    lastLineField: "guestLastLine",
  });
  if (current === null || currentSignature === null) {
    return null;
  }
  if (
    idleAfterText !== "" &&
    !currentSignature.lastLine.includes(idleAfterText)
  ) {
    return null;
  }

  let idleSinceElapsedMs = current.elapsedMs;
  for (let index = samples.length - 2; index >= 0; index--) {
    const previous = samples[index];
    const previousSignature = serialProgressSignature(previous, {
      bytesField: "guestOutputBytes",
      linesField: "guestLines",
      lastLineField: "guestLastLine",
    });
    if (!sameSerialProgress(currentSignature, previousSignature)) {
      break;
    }
    idleSinceElapsedMs = previous.elapsedMs;
  }

  const idleMs = current.elapsedMs - idleSinceElapsedMs;
  if (idleMs < idleTimeoutMs) {
    return null;
  }
  return {
    idle: true,
    idleAfterText,
    idleMs,
    idleSinceElapsedMs,
    idleTimeoutMs,
    lastLine: currentSignature.lastLine,
    outputBytes: currentSignature.outputBytes,
    outputLines: currentSignature.lines,
  };
}

async function loadPlaywright(browserName) {
  try {
    return loadPlaywrightBrowser(browserName);
  } catch (error) {
    console.error(
      "Playwright is required. Run with, for example: npm exec --yes --package=playwright -- node scripts/ci/wasm-browser-smoke-runner.mjs ...",
    );
    throw error;
  }
}

function startServer(options) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(scriptDir, "wasm-browser-smoke-server.mjs");
  const args = [
    serverScript,
    "--host",
    options.host,
    "--port",
    String(options.port),
  ];
  if (options.harnessSelfTest) {
    args.push("--harness-self-test");
  } else {
    args.push(
      "--artifact-dir",
      options.artifactDir,
      "--firmware-dir",
      options.firmwareDir,
      "--kernel",
      options.kernel,
      "--program",
      options.program,
      "--wasm",
      options.wasm,
    );
  }
  if (options.initrd !== null) {
    args.push("--initrd", options.initrd);
  }
  if (options.rootfs !== null) {
    args.push("--rootfs", options.rootfs);
  }
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (data) => process.stderr.write(data));

  return new Promise((resolveReady, rejectReady) => {
    let ready = false;
    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      if (text.includes("serving QEMU WASM browser smoke test")) {
        ready = true;
        resolveReady(child);
      }
    });
    child.on("exit", (code, signal) => {
      if (!ready) {
        rejectReady(new Error(`smoke server exited before ready: code=${code} signal=${signal}`));
      }
    });
  });
}

async function stopServer(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolveDone) => {
    child.once("exit", resolveDone);
    setTimeout(resolveDone, 1000);
  });
}

function firstEntry(entries) {
  return entries && entries.length > 0 ? entries[0] : null;
}

function lastEntry(entries) {
  return entries && entries.length > 0 ? entries[entries.length - 1] : null;
}

function compactPageError(error) {
  if (error === null) {
    return null;
  }
  return {
    elapsedMs: error.elapsedMs,
    name: error.name,
    message: error.message,
    phase: error.state && error.state.phase ? error.state.phase : null,
    lastLine: error.state && error.state.lastLine ? error.state.lastLine : null,
  };
}

function compactRequestFailure(failure) {
  if (failure === null) {
    return null;
  }
  return {
    event: failure.event || null,
    elapsedMs: failure.elapsedMs,
    method: failure.method,
    url: failure.url,
    failureText: failure.failureText,
    status: failure.status ?? null,
    statusText: failure.statusText ?? null,
    initiator: failure.initiator || null,
  };
}

function compactProgressSample(sample) {
  if (sample === null) {
    return null;
  }
  return {
    elapsedMs: sample.elapsedMs,
    reason: sample.reason,
    lineDelta: sample.lineDelta,
    outputByteDelta: sample.outputByteDelta,
    guestLineDelta: sample.guestLineDelta ?? null,
    guestOutputByteDelta: sample.guestOutputByteDelta ?? null,
    guestHeartbeatDelta: sample.guestHeartbeatDelta ?? null,
    lastLineChanged: sample.lastLineChanged,
    guestLastLineChanged: sample.guestLastLineChanged ?? null,
    lastLine: sample.state && sample.state.lastLine ? sample.state.lastLine : null,
    guestLastLine: sample.state && sample.state.guestLastLine ? sample.state.guestLastLine : null,
  };
}

export function smokeResultSummary(result) {
  const firstPageError = compactPageError(firstEntry(result.pageErrors || []));
  const lastPageError = compactPageError(lastEntry(result.pageErrors || []));
  const firstRequestFailure = compactRequestFailure(firstEntry(result.requestFailures || []));
  const firstResourceError = compactRequestFailure(firstEntry(result.resourceErrors || []));
  const lastProgressSample = compactProgressSample(lastEntry(result.progressSamples || []));
  const primaryError = result.errorMessage
    ? {
        name: result.errorName || "Error",
        message: result.errorMessage,
      }
    : firstPageError;

  return {
    success: Boolean(result.success),
    phase: result.phase || null,
    pageStatus: result.pageStatus || null,
    markerSeen: Boolean(result.markerSeen),
    lastLine: result.lastLine || "",
    outputLines: Number.isInteger(result.outputLines) ? result.outputLines : null,
    primaryError,
    pageErrorCount: (result.pageErrors || []).length,
    firstPageError,
    lastPageError,
    requestFailureCount: (result.requestFailures || []).length,
    firstRequestFailure,
    resourceErrorCount: (result.resourceErrors || []).length,
    firstResourceError,
    idleTimeout: result.idleTimeout || null,
    guestIdleTimeout: result.guestIdleTimeout || null,
    progressSampleCount: (result.progressSamples || []).length,
    lastProgressSample,
    bootMilestones: result.bootMilestones || null,
  };
}

export function displayPixelSummary(data, width, height) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("display width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("display height must be a positive integer");
  }
  if (!data || data.length !== width * height * 4) {
    throw new Error("display pixel data length does not match dimensions");
  }

  let nonZeroPixels = 0;
  let nonTransparentPixels = 0;
  let nonBlackPixels = 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
      nonZeroPixels += 1;
    }
    if (a !== 0) {
      nonTransparentPixels += 1;
    }
    if (r !== 0 || g !== 0 || b !== 0) {
      nonBlackPixels += 1;
    }
    hash ^= r;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= g;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= b;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return {
    hash: `fnv1a32:${hash.toString(16).padStart(8, "0")}`,
    height,
    nonBlackPixels,
    nonTransparentPixels,
    nonZeroPixels,
    totalPixels: width * height,
    width,
  };
}

export function displayContextErrorEvidence(error) {
  const name = error && error.name ? error.name : "Error";
  const message = error && error.message ? error.message : String(error);
  const controlTransferredOffscreen =
    name === "InvalidStateError" &&
    /transferred.*offscreen/i.test(message);
  return {
    contextErrorName: name,
    controlTransferredOffscreen,
    pixelError: controlTransferredOffscreen
      ? "canvas control was transferred to OffscreenCanvas; main-thread pixel sampling is unavailable"
      : message,
  };
}

function numericMetric(object, field) {
  const value = object && object[field];
  return Number.isFinite(value) ? value : 0;
}

export function wasm64TcgMetricGate(result, {
  minCoveragePpm = 1,
  requireFallbackAttribution = false,
} = {}) {
  const failures = [];
  const wasm64Tcg = result && result.wasm64Tcg ? result.wasm64Tcg : null;
  const summary = wasm64Tcg && wasm64Tcg.lastSummary
    ? wasm64Tcg.lastSummary
    : null;

  if (summary === null) {
    return {
      ok: false,
      failures: ["missing wasm64Tcg.lastSummary"],
      metrics: null,
    };
  }

  const generatedExecutions =
    numericMetric(summary, "generated_executed") +
    numericMetric(summary, "generated_cache_hits");
  const coverageNumerator =
    numericMetric(summary, "generated_coverage_numerator");
  const coverageDenominator =
    numericMetric(summary, "generated_coverage_denominator");
  const coveragePpm = numericMetric(summary, "generated_coverage_ppm");
  const generatedGuestInstructions =
    numericMetric(summary, "generated_guest_instructions");
  const fallbackGuestInstructions =
    numericMetric(summary, "fallback_guest_instructions");
  const generatedBodyTimeNs =
    numericMetric(summary, "generated_body_time_ns");
  const generatedRunEntries =
    numericMetric(summary, "generated_run_entries");
  const generatedChainLength =
    numericMetric(summary, "generated_chain_length");
  const generatedGuestInstructionsPerEntry =
    numericMetric(summary, "generated_guest_instructions_per_entry");
  const translatedTbs = numericMetric(summary, "translated_tbs");
  const unsupportedOps = Array.isArray(
    summary.translated_generated_first_unsupported_ops,
  )
    ? summary.translated_generated_first_unsupported_ops
    : [];
  const hotBlocks =
    result &&
    result.hotBlocks &&
    result.hotBlocks.lastSummary &&
    Array.isArray(result.hotBlocks.lastSummary.top_blocks)
      ? result.hotBlocks.lastSummary.top_blocks
      : [];

  if (translatedTbs <= 0) {
    failures.push("wasm64 TCG summary did not report live translated TBs");
  }
  if (coverageDenominator <= 0) {
    failures.push("generated coverage denominator is zero");
  }
  if (coverageNumerator <= 0) {
    failures.push("generated coverage numerator is zero");
  }
  if (generatedExecutions <= 0) {
    failures.push("generated execution/cache-hit count is zero");
  }
  if (coveragePpm < minCoveragePpm) {
    failures.push(
      `generated coverage ${coveragePpm} ppm is below required ${minCoveragePpm} ppm`,
    );
  }
  if (
    requireFallbackAttribution &&
    unsupportedOps.length === 0 &&
    hotBlocks.length === 0
  ) {
    failures.push(
      "missing fallback attribution: no unsupported op shapes or hot blocks",
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      generatedExecutions,
      coverageNumerator,
      coverageDenominator,
      coveragePpm,
    generatedGuestInstructions,
    fallbackGuestInstructions,
    generatedBodyTimeNs,
    generatedRunEntries,
    generatedChainLength,
    generatedGuestInstructionsPerEntry,
    translatedTbs,
      unsupportedOpShapes: unsupportedOps.length,
      hotBlocks: hotBlocks.length,
    },
  };
}

function validateWasm64TcgMetricGate(options, result) {
  if (
    !options.requireWasm64TcgCoverage &&
    !options.requireWasm64TcgFallbackAttribution
  ) {
    return;
  }

  const gate = wasm64TcgMetricGate(result, {
    minCoveragePpm: options.minWasm64TcgCoveragePpm,
    requireFallbackAttribution: options.requireWasm64TcgFallbackAttribution,
  });
  result.wasm64TcgMetricGate = gate;
  if (!gate.ok) {
    throw new Error(`wasm64 TCG metric gate failed: ${gate.failures.join("; ")}`);
  }
}

function displayPixelSummarySource() {
  return `(${displayPixelSummary.toString()})`;
}

function displayContextErrorEvidenceSource() {
  return `(${displayContextErrorEvidence.toString()})`;
}

async function writeResult(options, result) {
  if (options.out === null) {
    return;
  }
  result.summary = smokeResultSummary(result);
  await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`);
}

const VCPU_LIVENESS_PHASES = new Set([
  "main-loop",
  "tci-dispatch",
  "generated-attempt-js",
]);

const WASM64_RUNLOOP_EVENTS = new Set([
  "runtime-smoke",
  "live-generated-exec-summary",
]);

const WASM64_RUNLOOP_NUMERIC_FIELDS = [
  "elapsedMs",
  "generated_run_entries",
  "generated_guest_instructions",
  "generated_body_time_ns",
  "generated_coverage_numerator",
  "generated_coverage_denominator",
  "generated_coverage_ppm",
];

function boundedNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

function boundedBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

/*
 * T42 additive vCPU liveness diagnostic. This is bounded last-entered
 * evidence from a cooperative dispatch hook. Every field is enum-checked or
 * range-checked before it enters the result; the whole object is omitted
 * fail-closed when a required field is missing or invalid.
 */
export function sanitizeVcpuLiveness(lastSummary) {
  const raw = lastSummary && typeof lastSummary === "object"
    ? lastSummary.vcpu_liveness
    : null;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const phase = typeof raw.phase === "string" &&
    VCPU_LIVENESS_PHASES.has(raw.phase)
    ? raw.phase
    : null;
  const iteration = boundedNonNegativeInteger(raw.iteration);
  const lastGuestPc = boundedNonNegativeInteger(raw.last_guest_pc);

  if (
    phase === null || iteration === null || lastGuestPc === null ||
    Object.keys(raw).some((key) => ![
      "phase", "iteration", "last_guest_pc",
    ].includes(key))
  ) {
    return null;
  }

  return {
    phase,
    iteration,
    lastGuestPc,
  };
}

/*
 * Same bounded-validation treatment for the runloop summary's
 * "pending_causes" object (T42): exact per-cause counts recorded every
 * time the generated-exec main-loop-exit-pending predicate observed a
 * pending interrupt, exit request, or exception.
 */
export function sanitizePendingCauses(lastSummary) {
  const raw = lastSummary && typeof lastSummary === "object"
    ? lastSummary.pending_causes
    : null;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const interrupt = boundedNonNegativeInteger(raw.interrupt);
  const exit = boundedNonNegativeInteger(raw.exit);
  const exception = boundedNonNegativeInteger(raw.exception);

  if (
    interrupt === null || exit === null || exception === null ||
    Object.keys(raw).some((key) => ![
      "interrupt", "exit", "exception",
    ].includes(key))
  ) {
    return null;
  }

  return { interrupt, exit, exception };
}

/*
 * The browser parser retains raw runloop JSON for its in-page diagnostics,
 * but the written runner result only exposes this fixed, bounded projection.
 * Unknown keys and non-integer values never cross this boundary.
 */
export function sanitizeWasm64Runloop(runloop) {
  if (!runloop || typeof runloop !== "object") {
    return null;
  }

  const enabled = boundedBoolean(runloop.enabled);
  const summaryCount = boundedNonNegativeInteger(runloop.summaryCount);
  const rawSummary = runloop.lastSummary;
  if (enabled === null || summaryCount === null ||
      !rawSummary || typeof rawSummary !== "object") {
    return null;
  }

  if (typeof rawSummary.event !== "string" ||
      !WASM64_RUNLOOP_EVENTS.has(rawSummary.event)) {
    return null;
  }

  const lastSummary = { event: rawSummary.event };
  for (const field of WASM64_RUNLOOP_NUMERIC_FIELDS) {
    const value = boundedNonNegativeInteger(rawSummary[field]);
    if (value !== null) {
      lastSummary[field] = value;
    }
  }
  return { enabled, summaryCount, lastSummary };
}

export function promoteSmokeState(result, smokeState) {
  if (smokeState === null) {
    return;
  }
  result.phase = smokeState.phase || null;
  result.failurePhase = smokeState.failurePhase || null;
  result.phases = smokeState.phases || [];
  result.qemuCommand = smokeState.qemuArgs || [];
  result.markerSeen = Boolean(smokeState.markerSeen);
  result.expectedTextSeen = smokeState.expectedTextSeen || [];
  result.programExitStatus = smokeState.programExitStatus;
  result.outputSuppressed = Boolean(smokeState.outputSuppressed);
  result.outputLines = smokeState.lines;
  result.outputBytes = smokeState.outputBytes;
  result.lastLine = smokeState.lastLine;
  result.guestOutputLines = smokeState.guestLines;
  result.guestOutputBytes = smokeState.guestOutputBytes;
  result.guestLastLine = smokeState.guestLastLine;
  result.guestHeartbeat = smokeState.guestHeartbeat || null;
  result.bootMilestones = smokeState.bootMilestones || null;
  result.browserRuntime = smokeState.runtime || null;
  result.displayState = smokeState.display || null;
  result.powerControlState = smokeState.powerControl || null;
  result.persistentDiskState = smokeState.persistentDisk || null;
  result.rootfsStorageState = smokeState.rootfsStorage || null;
  result.vmstateRestoreState = smokeState.vmstateRestore || null;
  result.serviceBridgeState = smokeState.serviceBridge || null;
  result.hotBlocks = smokeState.hotBlocks || null;
  result.performanceAttribution = smokeState.performanceAttribution || null;
  result.fwCfgTrace = smokeState.fwCfgTrace || null;
  result.wasm64Tcg = smokeState.wasm64Tcg || null;
  const lastRunloopSummary = smokeState.wasm64Runloop &&
    smokeState.wasm64Runloop.lastSummary;
  result.wasm64Runloop = sanitizeWasm64Runloop(smokeState.wasm64Runloop);
  result.vcpuLiveness = sanitizeVcpuLiveness(
    lastRunloopSummary,
  );
  result.pendingCauses = sanitizePendingCauses(
    lastRunloopSummary,
  );
  result.tci = smokeState.tci || null;
}

export function browserSmokeUrl(options) {
  const url = new URL(`http://${options.host}:${options.port}/`);
  const persistentDiskStorage = options.persistentDiskStorage || "opfs";
  const rootfsStorage = options.rootfsStorage || "memfs";
  const rootfsOpfsName = options.rootfsOpfsName || "qemu-wasm-rootfs.raw";
  const tcgHotblocks = Boolean(options.tcgHotblocks);
  const tcgHotblocksInterval = Number.isInteger(options.tcgHotblocksInterval)
    ? options.tcgHotblocksInterval
    : 10000;
  const tcgHotblocksOpSample = Number.isInteger(options.tcgHotblocksOpSample)
    ? options.tcgHotblocksOpSample
    : 1;
  const tcgHotblocksOpLimit = Number.isInteger(options.tcgHotblocksOpLimit)
    ? options.tcgHotblocksOpLimit
    : 134217728;
  const tcgHotblocksTop = Number.isInteger(options.tcgHotblocksTop)
    ? options.tcgHotblocksTop
    : 12;
  url.searchParams.set("appendExtra", options.appendExtra);
  url.searchParams.set("allowSerialFallback", options.allowSerialFallback ? "1" : "0");
  url.searchParams.set("cpu", options.cpu);
  url.searchParams.set("display", options.display);
  url.searchParams.set("displayDevice", options.displayDevice);
  url.searchParams.set("expectedResolution", options.expectedResolution);
  url.searchParams.set("focusDisplay", options.focusDisplay ? "1" : "0");
  if (options.harnessSelfTest) {
    url.searchParams.set("harnessExpectedKeyEvents", String(options.harnessExpectedKeyEvents));
    url.searchParams.set("harnessSelfTest", "1");
  }
  url.searchParams.set("marker", options.marker);
  url.searchParams.set("maxOutputBytes", String(options.maxOutputBytes));
  url.searchParams.set("memory", options.memory);
  url.searchParams.set("machine", options.machine);
  url.searchParams.set("network", options.network);
  url.searchParams.set("program", artifactUrlPath(options.program || "qemu-system-x86_64.js"));
  url.searchParams.set("wasm", artifactUrlPath(options.wasm || defaultWasmForProgram(options.program || "qemu-system-x86_64.js")));
  if (options.persistentDisk) {
    url.searchParams.set("persistentDisk", "1");
    url.searchParams.set("persistentDiskDevice", options.persistentDiskDevice);
    url.searchParams.set("persistentDiskOpfsName", options.persistentDiskOpfsName);
    url.searchParams.set("persistentDiskPath", options.persistentDiskPath);
    url.searchParams.set("persistentDiskSizeBytes", String(options.persistentDiskSizeBytes));
    url.searchParams.set("persistentDiskStorage", persistentDiskStorage);
  }
  url.searchParams.set("powerOperation", options.powerOperation);
  url.searchParams.set("powerTimeoutMs", String(options.powerTimeoutMs));
  if (options.targetArch) {
    url.searchParams.set("targetArch", options.targetArch);
  }
  if (options.performanceAttribution) {
    url.searchParams.set("performanceAttribution", "1");
    url.searchParams.set(
      "performanceAttributionInterval",
      String(options.performanceAttributionInterval),
    );
    url.searchParams.set(
      "performanceAttributionTciInterval",
      String(options.performanceAttributionTciInterval),
    );
  }
  if (tcgHotblocks) {
    url.searchParams.set("tcgHotblocks", "1");
    url.searchParams.set("tcgHotblocksInterval", String(tcgHotblocksInterval));
    url.searchParams.set("tcgHotblocksOpLimit", String(tcgHotblocksOpLimit));
    url.searchParams.set("tcgHotblocksOpSample", String(tcgHotblocksOpSample));
    url.searchParams.set("tcgHotblocksTop", String(tcgHotblocksTop));
  }
  if (options.tciFastGates) {
    url.searchParams.set("tciFastGates", "1");
  }
  if (options.tciProgress) {
    url.searchParams.set("tciProgress", "1");
    url.searchParams.set(
      "tciProgressInterval",
      String(options.tciProgressInterval),
    );
  }
  if (options.tciWasmGeneratedTrace) {
    url.searchParams.set("tciWasmGeneratedTrace", "1");
    url.searchParams.set(
      "tciWasmGeneratedTraceLimit",
      String(options.tciWasmGeneratedTraceLimit),
    );
  }
  if (options.wasm64RunloopSmoke) {
    url.searchParams.set("wasm64RunloopSmoke", "1");
  }
  if (options.wasm64OneTbDifferential) {
    url.searchParams.set("wasm64OneTbDifferential", "1");
  }
  if (options.wasm64LiveOneTbDifferential) {
    url.searchParams.set("wasm64LiveOneTbDifferential", "1");
  }
  if (options.wasm64LiveTbCoverage) {
    url.searchParams.set("wasm64LiveTbCoverage", "1");
  }
  if (options.wasm64LiveGeneratedExec) {
    url.searchParams.set("wasm64LiveGeneratedExec", "1");
  }
  if (options.wasm64LiveGeneratedExecNoFallback) {
    url.searchParams.set("wasm64LiveGeneratedExecNoFallback", "1");
  }
  if (options.wasm64LiveGeneratedExecPreflight) {
    url.searchParams.set("wasm64LiveGeneratedExecPreflight", "1");
    url.searchParams.set(
      "wasm64LiveGeneratedExecPreflightLimit",
      String(options.wasm64LiveGeneratedExecPreflightLimit),
    );
  }
  if (options.wasm64TcgSummary) {
    url.searchParams.set("wasm64TcgSummary", "1");
    url.searchParams.set(
      "wasm64TcgSummaryInterval",
      String(options.wasm64TcgSummaryInterval),
    );
  }
  url.searchParams.set("rootfsDevice", options.rootfsDevice);
  if (rootfsStorage !== "memfs") {
    url.searchParams.set("rootfsStorage", rootfsStorage);
    url.searchParams.set("rootfsOpfsName", rootfsOpfsName);
  }
  if (options.kernelAppend !== null) {
    url.searchParams.set("kernelAppend", options.kernelAppend);
  }
  if (options.fwCfgTrace) {
    url.searchParams.set("fwCfgTrace", "1");
    url.searchParams.set("fwCfgTraceLimit", String(options.fwCfgTraceLimit));
  }
  for (const text of options.expectText) {
    url.searchParams.append("expectText", text);
  }
  if (options.initrd === null) {
    url.searchParams.set("initrd", "");
  }
  if (options.rootfs !== null) {
    url.searchParams.set("rootfs", "/guest/rootfs.raw");
  }
  for (const qemuArg of options.qemuArgs) {
    url.searchParams.append("qemuArg", qemuArg);
  }
  if (options.serviceBridge != null) {
    url.searchParams.set("serviceBridge", JSON.stringify(options.serviceBridge));
  }
  if ((options.serialInputText || "") !== "") {
    url.searchParams.set("primarySerialInput", "1");
  }
  url.searchParams.set("timeoutMs", String(options.timeoutMs));
  url.searchParams.set("visualMarker", options.visualMarker);
  return url;
}

export function initialSmokeResult(options, browserVersion) {
  return {
    format: 1,
    appendExtra: options.appendExtra,
    allowSerialFallback: options.allowSerialFallback,
    browser: options.browser,
    browserVersion,
    cpu: options.cpu,
    display: options.display,
    displayDevice: options.displayDevice,
    expectedResolution: options.expectedResolution,
    expectDisplayHash: options.expectDisplayHash,
    expectText: options.expectText,
    focusDisplay: options.focusDisplay,
    harnessExpectedKeyEvents: options.harnessExpectedKeyEvents || 0,
    harnessSelfTest: Boolean(options.harnessSelfTest),
    keyboardAfterText: options.keyboardAfterText,
    keyboardTextLength: options.keyboardText.length,
    preSerialInputWaitMs: options.preSerialInputWaitMs || 0,
    preKeyboardWaitMs: options.preKeyboardWaitMs,
    serialInputAfterText: options.serialInputAfterText || "",
    serialInputTextLength: (options.serialInputText || "").length,
    postKeyboardWaitMs: options.postKeyboardWaitMs,
    powerOperation: options.powerOperation,
    powerTimeoutMs: options.powerTimeoutMs,
    kernelAppend: options.kernelAppend,
    machine: options.machine,
    maxDiagnosticEntries: MAX_DIAGNOSTIC_ENTRIES,
    marker: options.marker,
    memory: options.memory,
    network: options.network,
    idleAfterText: options.idleAfterText,
    idleTimeoutMs: options.idleTimeoutMs,
    timeoutMs: options.timeoutMs,
    pageTextTailBytes: options.pageTextTailBytes,
    performanceAttribution: Boolean(options.performanceAttribution),
    performanceAttributionInterval: Number.isInteger(options.performanceAttributionInterval)
      ? options.performanceAttributionInterval
      : 10000,
    performanceAttributionTciInterval: Number.isInteger(options.performanceAttributionTciInterval)
      ? options.performanceAttributionTciInterval
      : 1000000,
    fwCfgTrace: Boolean(options.fwCfgTrace),
    fwCfgTraceLimit: Number.isInteger(options.fwCfgTraceLimit)
      ? options.fwCfgTraceLimit
      : 256,
    guestIdleAfterText: options.guestIdleAfterText,
    guestIdleTimeoutMs: options.guestIdleTimeoutMs,
    progressSampleIntervalMs: options.progressSampleIntervalMs,
    progressSampleLimit: options.progressSampleLimit,
    program: options.program,
    persistentDisk: options.persistentDisk,
    persistentDiskDevice: options.persistentDiskDevice,
    persistentDiskOpfsName: options.persistentDiskOpfsName,
    persistentDiskPath: options.persistentDiskPath,
    persistentDiskSizeBytes: options.persistentDiskSizeBytes,
    qemuArgs: options.qemuArgs,
    wasm: options.wasm,
    requireDisplayOutput: options.requireDisplayOutput,
    displayMinNonblackPixels: options.displayMinNonblackPixels,
    rootfs: options.rootfs,
    rootfsDevice: options.rootfsDevice,
    rootfsOpfsName: options.rootfsOpfsName,
    rootfsStorage: options.rootfsStorage,
    serviceBridge: options.serviceBridge,
    targetArch: options.targetArch,
    tcgHotblocks: Boolean(options.tcgHotblocks),
    tcgHotblocksInterval: Number.isInteger(options.tcgHotblocksInterval)
      ? options.tcgHotblocksInterval
      : 10000,
    tcgHotblocksOpLimit: Number.isInteger(options.tcgHotblocksOpLimit)
      ? options.tcgHotblocksOpLimit
      : 134217728,
    tcgHotblocksOpSample: Number.isInteger(options.tcgHotblocksOpSample)
      ? options.tcgHotblocksOpSample
      : 1,
    tcgHotblocksTop: Number.isInteger(options.tcgHotblocksTop)
      ? options.tcgHotblocksTop
      : 12,
    tciFastGates: Boolean(options.tciFastGates),
    tciProgress: Boolean(options.tciProgress),
    tciProgressInterval: Number.isInteger(options.tciProgressInterval)
      ? options.tciProgressInterval
      : 100000,
    tciWasmGeneratedTrace: Boolean(options.tciWasmGeneratedTrace),
    tciWasmGeneratedTraceLimit:
      Number.isInteger(options.tciWasmGeneratedTraceLimit)
        ? options.tciWasmGeneratedTraceLimit
        : 64,
    wasm64RunloopSmoke: Boolean(options.wasm64RunloopSmoke),
    wasm64OneTbDifferential: Boolean(options.wasm64OneTbDifferential),
    wasm64LiveOneTbDifferential:
      Boolean(options.wasm64LiveOneTbDifferential),
    wasm64LiveTbCoverage: Boolean(options.wasm64LiveTbCoverage),
    wasm64LiveGeneratedExec: Boolean(options.wasm64LiveGeneratedExec),
    wasm64LiveGeneratedExecNoFallback:
      Boolean(options.wasm64LiveGeneratedExecNoFallback),
    wasm64LiveGeneratedExecPreflight:
      Boolean(options.wasm64LiveGeneratedExecPreflight),
    wasm64LiveGeneratedExecPreflightLimit:
      Number.isInteger(options.wasm64LiveGeneratedExecPreflightLimit)
        ? options.wasm64LiveGeneratedExecPreflightLimit
        : 10000,
    wasm64TcgSummary: Boolean(options.wasm64TcgSummary),
    wasm64TcgSummaryInterval: Number.isInteger(options.wasm64TcgSummaryInterval)
      ? options.wasm64TcgSummaryInterval
      : 10000,
    requireWasm64TcgCoverage: Boolean(options.requireWasm64TcgCoverage),
    minWasm64TcgCoveragePpm: Number.isInteger(options.minWasm64TcgCoveragePpm)
      ? options.minWasm64TcgCoveragePpm
      : 1,
    requireWasm64TcgFallbackAttribution:
      Boolean(options.requireWasm64TcgFallbackAttribution),
    userDataDir: options.userDataDir,
    visualMarker: options.visualMarker,
    success: false,
    consoleMessages: [],
    pageErrors: [],
    progressSampleErrors: [],
    progressSamples: [],
    resourceErrors: [],
    requestFailures: [],
  };
}

async function capturePageText(page, result, tailBytes) {
  if (!page) {
    return;
  }
  try {
    result.pageStatus = await page.evaluate(() => document.querySelector("#status")?.textContent || "");
    const smokeState = await page.evaluate(
      () => globalThis.qemuWasmSmokeState || null,
    );
    promoteSmokeState(result, smokeState);
    const text = await page.evaluate(() => document.body.textContent || "");
    result.pageTextTail = text.slice(-tailBytes);
  } catch (error) {
    result.pageTextError = error && error.message ? error.message : String(error);
  }
}

async function captureScreenshot(page, options, result) {
  if (!page || options.screenshot === null) {
    return;
  }
  try {
    await page.screenshot({
      path: options.screenshot,
      fullPage: options.screenshotFullPage,
    });
    result.screenshot = options.screenshot;
    result.screenshotFullPage = options.screenshotFullPage;
  } catch (error) {
    result.screenshotError = error && error.message ? error.message : String(error);
  }
}

async function captureDisplayEvidence(page, result) {
  if (!page) {
    return;
  }
  try {
    result.displayEvidence = await page.evaluate((sources) => {
      const contextErrorEvidence = eval(sources.contextErrorEvidence);
      const summarizePixels = eval(sources.pixelSummary);
      const canvas = document.querySelector("#canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        return {
          present: false,
        };
      }
      const style = getComputedStyle(canvas);
      const visible = !canvas.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        canvas.width > 0 &&
        canvas.height > 0;
      const evidence = {
        active: canvas.dataset.inputActive === "true",
        present: true,
        focused: document.activeElement === canvas,
        height: canvas.height,
        hidden: canvas.hidden,
        visible,
        width: canvas.width,
      };
      if (!visible) {
        return evidence;
      }
      let context;
      try {
        context = canvas.getContext("2d", { willReadFrequently: true });
      } catch (error) {
        return {
          ...evidence,
          ...contextErrorEvidence(error),
        };
      }
      if (context) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          ...evidence,
          contextType: "2d",
          ...summarizePixels(pixels, canvas.width, canvas.height),
        };
      }
      let gl;
      try {
        gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true }) ||
          canvas.getContext("webgl", { preserveDrawingBuffer: true }) ||
          canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true });
      } catch (error) {
        return {
          ...evidence,
          ...contextErrorEvidence(error),
        };
      }
      if (!gl) {
        return {
          ...evidence,
          pixelError: "2D or WebGL canvas context is not available",
        };
      }
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      return {
        ...evidence,
        contextType: gl.constructor && gl.constructor.name
          ? gl.constructor.name
          : "webgl",
        ...summarizePixels(pixels, canvas.width, canvas.height),
      };
    }, {
      contextErrorEvidence: displayContextErrorEvidenceSource(),
      pixelSummary: displayPixelSummarySource(),
    });
  } catch (error) {
    result.displayEvidenceError = error && error.message ? error.message : String(error);
  }
}

function validateDisplayEvidence(options, result) {
  if (!options.requireDisplayOutput) {
    return;
  }
  const evidence = result.displayEvidence;
  if (!evidence || !evidence.present) {
    throw new Error("required display canvas was not present");
  }
  if (!evidence.visible) {
    throw new Error("required display canvas was not visible");
  }
  if (evidence.pixelError) {
    throw new Error(`required display pixels were not readable: ${evidence.pixelError}`);
  }
  const nonBlackPixels = Number.isInteger(evidence.nonBlackPixels)
    ? evidence.nonBlackPixels
    : 0;
  if (nonBlackPixels < options.displayMinNonblackPixels) {
    throw new Error(
      `required display output had ${nonBlackPixels} non-black pixels; ` +
      `expected at least ${options.displayMinNonblackPixels}`,
    );
  }
  if (options.expectDisplayHash !== "" && evidence.hash !== options.expectDisplayHash) {
    throw new Error(
      `required display hash was ${evidence.hash}; expected ${options.expectDisplayHash}`,
    );
  }
}

async function sampleSmokeProgress(page, result, startTime, reason, limit) {
  if (!page) {
    return null;
  }
  try {
    const state = await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
    const sample = progressSampleDiagnostic(
      result,
      Date.now() - startTime,
      reason,
      state,
    );
    appendBoundedLimit(
      result.progressSamples,
      sample,
      limit,
    );
    return sample;
  } catch (error) {
    appendBounded(result.progressSampleErrors, {
      elapsedMs: Date.now() - startTime,
      reason,
      message: error && error.message ? error.message : String(error),
    });
    return null;
  }
}

async function typeKeyboardText(page, options, result) {
  if (options.keyboardText === "") {
    return;
  }
  await page.waitForFunction(
    (afterText) => {
      const state = globalThis.qemuWasmSmokeState || null;
      const display = document.querySelector("#canvas");
      if (!state || !display || display.hidden) {
        return false;
      }
      if (afterText === "") {
        return ["harness-self-test", "start-qemu", "guest-boot", "success"].includes(state.phase);
      }
      const output = document.querySelector("#output")?.textContent || "";
      return output.includes(afterText);
    },
    options.keyboardAfterText,
    { timeout: options.timeoutMs },
  );
  if (options.preKeyboardWaitMs > 0) {
    await page.waitForTimeout(options.preKeyboardWaitMs);
  }
  await page.locator("#canvas").focus();
  await page.keyboard.type(options.keyboardText);
  result.keyboardInput = {
    afterText: options.keyboardAfterText,
    preKeyboardWaitMs: options.preKeyboardWaitMs,
    target: "#canvas",
    textLength: options.keyboardText.length,
  };
}

async function writePrimarySerialInputText(page, options, result) {
  if (options.serialInputText === "") {
    return;
  }
  await page.waitForFunction(
    (afterText) => {
      const state = globalThis.qemuWasmSmokeState || null;
      const input = globalThis.qemuWasmPrimarySerialInput || null;
      if (!state || !input || !input.state || !input.state.moduleAttached) {
        return false;
      }
      if (afterText === "") {
        return ["start-qemu", "guest-boot", "success"].includes(state.phase);
      }
      const output = document.querySelector("#output")?.textContent || "";
      return output.includes(afterText);
    },
    options.serialInputAfterText,
    { timeout: options.timeoutMs },
  );
  if (options.preSerialInputWaitMs > 0) {
    await page.waitForTimeout(options.preSerialInputWaitMs);
  }
  const status = await page.evaluate((text) => {
    return globalThis.qemuWasmPrimarySerialInput.writeText(text);
  }, options.serialInputText);
  result.serialInput = {
    afterText: options.serialInputAfterText,
    preSerialInputWaitMs: options.preSerialInputWaitMs,
    target: "primary-serial",
    textLength: options.serialInputText.length,
    writeStatus: status,
  };
}

async function currentSmokeState(page) {
  if (!page) {
    return null;
  }
  try {
    return await page.evaluate(() => globalThis.qemuWasmSmokeState || null);
  } catch {
    return null;
  }
}

export async function requestPowerOperation(page, options, result) {
  if (options.powerOperation === "") {
    return;
  }
  const state = await page.evaluate(async ({ operation, timeoutMs }) => {
    if (!globalThis.qemuWasmPowerControl ||
        typeof globalThis.qemuWasmPowerControl.request !== "function") {
      throw new Error("QEMU WebAssembly power control is not available");
    }
    await globalThis.qemuWasmPowerControl.request(operation, { timeoutMs });
    return globalThis.qemuWasmPowerControl.state;
  }, {
    operation: options.powerOperation,
    timeoutMs: options.powerTimeoutMs,
  });
  result.powerOperation = {
    operation: options.powerOperation,
    state,
  };
}

async function run() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      process.exitCode = error.status;
      return;
    }
    throw error;
  }
  const browserType = await loadPlaywright(options.browser);
  let server = null;
  let context = null;
  let browser = null;
  const cleanup = async () => {
    await closePlaywrightBrowser({ browser, context });
    browser = null;
    context = null;
    await stopServer(server);
    server = null;
  };
  const uninstallSignalCleanup = installSignalCleanup(cleanup);
  try {
    server = await startServer(options);
    const launchOptions = playwrightLaunchOptions(options.browser);
    context = options.userDataDir === null
      ? null
      : await browserType.launchPersistentContext(options.userDataDir, launchOptions);
    browser = context === null
      ? await browserType.launch(launchOptions)
      : context.browser();
  } catch (error) {
    uninstallSignalCleanup();
    await cleanup();
    throw error;
  }
  const startTime = Date.now();
  const result = initialSmokeResult(options, browser ? browser.version() : "unknown");
  let page = null;
  let progressTimer = null;
  let rejectIdle = null;
  const idleFailure = new Promise((resolve, reject) => {
    rejectIdle = reject;
  });
  const pendingDiagnostics = new Set();
  const trackDiagnostic = (promise) => {
    pendingDiagnostics.add(promise);
    promise.then(
      () => pendingDiagnostics.delete(promise),
      () => pendingDiagnostics.delete(promise),
    );
  };
  const flushDiagnostics = async () => {
    await Promise.allSettled([...pendingDiagnostics]);
  };
  try {
    page = context === null ? await browser.newPage() : await context.newPage();
    await page.addInitScript({
      content: `${isTerminalPageStatus.toString()}\n` +
        "globalThis.qemuWasmIsTerminalPageStatus = isTerminalPageStatus;\n",
    });
    page.on("console", (message) => {
      const entry = consoleMessageDiagnostic(
        message,
        Date.now() - startTime,
        result.resourceErrors,
      );
      appendBounded(result.consoleMessages, entry);
      console.log(`browser ${entry.type}: ${entry.text}`);
    });
    page.on("pageerror", (error) => {
      trackDiagnostic((async () => {
        const entry = pageErrorDiagnostic(
          error,
          Date.now() - startTime,
          await currentSmokeState(page),
        );
        appendBounded(result.pageErrors, entry);
        await sampleSmokeProgress(
          page,
          result,
          startTime,
          "page-error",
          options.progressSampleLimit,
        );
      })());
    });
    page.on("requestfailed", (request) => {
      const entry = requestFailureDiagnostic(
        request,
        Date.now() - startTime,
      );
      appendBounded(result.requestFailures, entry);
      appendBounded(result.resourceErrors, {
        ...entry,
        event: "requestfailed",
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400) {
        return;
      }
      appendBounded(result.resourceErrors, {
        ...responseErrorDiagnostic(response, Date.now() - startTime),
        event: "response",
      });
    });
    const url = browserSmokeUrl(options);
    result.smokeUrl = url.href;
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    result.userAgent = await page.evaluate(() => navigator.userAgent);
    result.crossOriginIsolated = await page.evaluate(() => Boolean(globalThis.crossOriginIsolated));
    const sampleAndCheckIdle = async (reason) => {
      await sampleSmokeProgress(
        page,
        result,
        startTime,
        reason,
        options.progressSampleLimit,
      );
      const idle = serialIdleDiagnostic(
        result.progressSamples,
        options.idleTimeoutMs,
        options.idleAfterText,
      );
      if (idle !== null) {
        result.idleTimeout = idle;
        rejectIdle(new Error(
          `serial output idle for ${idle.idleMs} ms after: ${idle.lastLine}`,
        ));
      }
      const guestIdle = guestSerialIdleDiagnostic(
        result.progressSamples,
        options.guestIdleTimeoutMs,
        options.guestIdleAfterText,
      );
      if (guestIdle !== null) {
        result.guestIdleTimeout = guestIdle;
        rejectIdle(new Error(
          `guest serial output idle for ${guestIdle.idleMs} ms after: ${guestIdle.lastLine}`,
        ));
      }
    };
    progressTimer = setInterval(() => {
      if (result.progressSamples.length >= options.progressSampleLimit) {
        clearInterval(progressTimer);
        progressTimer = null;
        return;
      }
      sampleAndCheckIdle("interval");
    }, options.progressSampleIntervalMs);
    await sampleAndCheckIdle("after-load");
    await writePrimarySerialInputText(page, options, result);
    await typeKeyboardText(page, options, result);
    await Promise.race([
      page.waitForFunction(
        (marker) => {
          const status = document.querySelector("#status")?.textContent || "";
          return globalThis.qemuWasmIsTerminalPageStatus(status, marker);
        },
        options.marker,
        { timeout: options.timeoutMs },
      ),
      idleFailure,
    ]);
    const pageStatus = await page.evaluate(() => document.querySelector("#status")?.textContent || "");
    result.pageStatus = pageStatus;
    if (!isSuccessfulPageStatus(pageStatus, options.marker)) {
      throw new Error(pageStatus);
    }
    if (options.postKeyboardWaitMs > 0) {
      await page.waitForTimeout(options.postKeyboardWaitMs);
      await sampleSmokeProgress(
        page,
        result,
        startTime,
        "post-keyboard-wait",
        options.progressSampleLimit,
      );
    }
    await requestPowerOperation(page, options, result);
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    result.elapsedMs = Date.now() - startTime;
    await flushDiagnostics();
    await sampleSmokeProgress(page, result, startTime, "final", options.progressSampleLimit);
    await capturePageText(page, result, options.pageTextTailBytes);
    validateWasm64TcgMetricGate(options, result);
    await captureDisplayEvidence(page, result);
    validateDisplayEvidence(options, result);
    await captureScreenshot(page, options, result);
    result.success = true;
    await writeResult(options, result);
    console.log(`wasm-browser-smoke-runner: ${pageStatus}`);
  } catch (error) {
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    result.elapsedMs = Date.now() - startTime;
    result.errorName = error && error.name ? error.name : "Error";
    result.errorMessage = error && error.message ? error.message : String(error);
    await flushDiagnostics();
    await sampleSmokeProgress(page, result, startTime, "final", options.progressSampleLimit);
    await capturePageText(page, result, options.pageTextTailBytes);
    await captureDisplayEvidence(page, result);
    await captureScreenshot(page, options, result);
    await writeResult(options, result);
    console.error(error && error.stack ? error.stack : String(error));
    throw error;
  } finally {
    uninstallSignalCleanup();
    await cleanup();
  }
}

if (process.argv[1] === THIS_FILE) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
