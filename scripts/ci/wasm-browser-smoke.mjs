/*
 * Browser harness for QEMU WebAssembly smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const DEFAULT_MARKER = "QEMU_WASM_LINUX_BOOT_OK";
const OPTIONAL_FIRMWARE_FILES = [
  "bios-256k.bin",
  "kvmvapic.bin",
  "vgabios.bin",
  "vgabios-stdvga.bin",
  "efi-virtio.rom",
];

function option(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value === "" ? fallback : value;
}

function pathOption(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null ? fallback : value;
}

function listOption(name) {
  return new URLSearchParams(window.location.search).getAll(name);
}

function numberOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function text(id) {
  return document.getElementById(id);
}

function appendLine(target, line) {
  target.textContent += `${line}\n`;
  target.scrollTop = target.scrollHeight;
}

async function fetchBytes(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchOptionalBytes(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createParentPaths(module, path) {
  const parts = path.split("/").filter(Boolean).slice(0, -1);
  let current = "/";
  for (const part of parts) {
    module.FS_createPath(current, part, true, true);
    current = `${current === "/" ? "" : current}/${part}`;
  }
}

function mountFiles(module, mounts) {
  for (const mount of mounts) {
    createParentPaths(module, mount.path);
    module.FS.writeFile(mount.path, mount.data);
  }
}

function programExitStatus(line) {
  const match = /^program exited \(with status: ([0-9]+)\)/.exec(line);
  return match === null ? null : Number(match[1]);
}

export function qemuArgs(config) {
  const defaultKernelAppend = config.initrd
    ? "console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1"
    : "console=ttyS0 earlyprintk=serial,ttyS0,115200 root=/dev/vda rw init=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1";
  const kernelAppend = [
    config.kernelAppend === null ? defaultKernelAppend : config.kernelAppend,
    config.appendExtra,
  ].filter(Boolean).join(" ");
  const args = [
    "-M",
    config.machine,
    "-m",
    config.memory,
  ];
  if (config.cpu) {
    args.push("-cpu", config.cpu);
  }
  args.push(
    "-accel",
    "tcg,thread=single",
    "-nographic",
    "-serial",
    "mon:stdio",
    "-monitor",
    "none",
    "-kernel",
    "/kernel",
  );
  if (config.initrd) {
    args.push("-initrd", "/initramfs.cpio.gz");
  }
  args.push("-append", kernelAppend);
  if (config.rootfs) {
    if (config.rootfsDevice === "virtio-mmio") {
      args.push(
        "-drive",
        "file=/rootfs.raw,format=raw,if=none,id=hd0",
        "-device",
        "virtio-blk-device,drive=hd0",
      );
    } else {
      args.push("-drive", "file=/rootfs.raw,format=raw,if=virtio");
    }
  }
  if (config.network === "none") {
    args.push("-nic", "none");
  }
  args.push("-L", "/firmware");
  args.push(...config.qemuArgs);
  return args;
}

function buildConfig() {
  return {
    appendExtra: option("appendExtra", ""),
    cpu: option("cpu", "Nehalem"),
    expectText: listOption("expectText"),
    initrd: pathOption("initrd", "/guest/initramfs.cpio.gz"),
    kernel: option("kernel", "/guest/kernel"),
    kernelAppend: option("kernelAppend", null),
    linuxboot: option("linuxboot", "/firmware/linuxboot_dma.bin"),
    machine: option("machine", "microvm,acpi=off"),
    marker: option("marker", DEFAULT_MARKER),
    maxOutputBytes: numberOption("maxOutputBytes", 60000),
    memory: option("memory", "512M"),
    network: option("network", "none"),
    program: option("program", "/artifacts/qemu-system-x86_64.js"),
    qemuArgs: listOption("qemuArg"),
    qboot: option("qboot", "/firmware/qboot.rom"),
    rootfs: pathOption("rootfs", ""),
    rootfsDevice: option("rootfsDevice", "virtio-mmio"),
    timeoutMs: numberOption("timeoutMs", 180000),
    wasm: option("wasm", "/artifacts/qemu-system-x86_64.wasm"),
  };
}

async function run() {
  const status = text("status");
  const output = text("output");
  const config = buildConfig();
  if (!["virtio-mmio", "virtio-pci"].includes(config.rootfsDevice)) {
    throw new Error("rootfsDevice must be virtio-mmio or virtio-pci");
  }
  if (!["none", "default"].includes(config.network)) {
    throw new Error("network must be none or default");
  }
  const programUrl = new URL(config.program, window.location.href);
  const wasmUrl = new URL(config.wasm, window.location.href);
  const generatedQemuArgs = qemuArgs(config);
  const startTime = performance.now();
  const smokeState = {
    lines: 0,
    outputBytes: 0,
    outputSuppressed: false,
    phase: "init",
    phases: [],
    startedAtMs: startTime,
    qemuArgs: generatedQemuArgs,
    markerSeen: false,
    expectedTextSeen: config.expectText.map((text) => ({ text, seen: false })),
    lastLine: "",
    programExitStatus: null,
  };
  globalThis.qemuWasmSmokeState = smokeState;
  const setPhase = (phase, message = phase) => {
    smokeState.phase = phase;
    smokeState.phases.push({
      phase,
      elapsedMs: Math.round(performance.now() - startTime),
      message,
    });
    status.textContent = message;
  };
  setPhase("init", "initializing smoke harness");
  const mounts = [
    { url: config.kernel, path: "/kernel" },
    { url: config.qboot, path: "/firmware/qboot.rom" },
    { url: config.linuxboot, path: "/firmware/linuxboot_dma.bin" },
  ];
  for (const name of OPTIONAL_FIRMWARE_FILES) {
    mounts.push({
      optional: true,
      path: `/firmware/${name}`,
      url: `/firmware/${name}`,
    });
  }
  if (config.initrd) {
    mounts.push({ url: config.initrd, path: "/initramfs.cpio.gz" });
  }
  if (config.rootfs) {
    mounts.push({ url: config.rootfs, path: "/rootfs.raw" });
  }

  setPhase("validate-browser", "validating browser WebAssembly features");
  if (!crossOriginIsolated) {
    throw new Error("cross-origin isolation is required for pthread WebAssembly");
  }
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("SharedArrayBuffer is not available");
  }

  const timeout = setTimeout(() => {
    if (!smokeState.markerSeen || !allExpectedTextSeen()) {
      const missing = smokeState.expectedTextSeen
        .filter((expected) => !expected.seen)
        .map((expected) => expected.text);
      setPhase("timeout", missing.length === 0
        ? `timeout waiting for marker: ${config.marker}`
        : `timeout waiting for marker or expected text: ${missing.join(", ")}`);
    }
  }, config.timeoutMs);

  const allExpectedTextSeen = () =>
    smokeState.expectedTextSeen.every((expected) => expected.seen);

  const maybeComplete = () => {
    if (smokeState.markerSeen && allExpectedTextSeen()) {
      clearTimeout(timeout);
      setPhase("success", `marker reached: ${config.marker}`);
    }
  };

  const emit = (line) => {
    smokeState.lines += 1;
    smokeState.lastLine = line;
    if (smokeState.outputBytes < config.maxOutputBytes) {
      const encoded = new TextEncoder().encode(`${line}\n`);
      const remaining = config.maxOutputBytes - smokeState.outputBytes;
      if (encoded.length <= remaining) {
        appendLine(output, line);
        smokeState.outputBytes += encoded.length;
      } else {
        appendLine(output, new TextDecoder().decode(encoded.slice(0, remaining)));
        smokeState.outputBytes += remaining;
      }
    }
    if (smokeState.outputBytes >= config.maxOutputBytes && !smokeState.outputSuppressed) {
      smokeState.outputSuppressed = true;
      appendLine(output, `wasm-browser-smoke: output suppressed after ${config.maxOutputBytes} bytes`);
    }
    if (line.includes(config.marker)) {
      smokeState.markerSeen = true;
    }
    for (const expected of smokeState.expectedTextSeen) {
      if (!expected.seen && line.includes(expected.text)) {
        expected.seen = true;
      }
    }
    maybeComplete();
    const exitStatus = programExitStatus(line);
    if (
      exitStatus !== null &&
      (!smokeState.markerSeen || !allExpectedTextSeen())
    ) {
      smokeState.programExitStatus = exitStatus;
      clearTimeout(timeout);
      setPhase("program-exit", `program exited before marker: status ${exitStatus}`);
    }
  };

  setPhase("fetch-guest-inputs", "loading smoke guest inputs");
  for (const mount of mounts) {
    mount.data = mount.optional
      ? await fetchOptionalBytes(mount.url)
      : await fetchBytes(mount.url);
  }
  const availableMounts = mounts.filter((mount) => mount.data !== null);

  setPhase("import-qemu-module", "loading QEMU WebAssembly module");
  const moduleFactory = (await import(programUrl.href)).default;
  setPhase("start-qemu", "starting QEMU");
  await moduleFactory({
    arguments: generatedQemuArgs,
    locateFile(path) {
      if (path === "qemu-system-x86_64.wasm") {
        return wasmUrl.href;
      }
      return new URL(path, programUrl).href;
    },
    mainScriptUrlOrBlob: programUrl.href,
    preRun: [
      (module) => {
        mountFiles(module, availableMounts);
      },
    ],
    print: emit,
    printErr: emit,
  });
  if (!smokeState.markerSeen || !allExpectedTextSeen()) {
    setPhase("guest-boot", "QEMU started; waiting for marker");
  }
}

if (typeof window !== "undefined") {
  run().catch((error) => {
    const state = globalThis.qemuWasmSmokeState;
    if (state) {
      state.failurePhase = state.phase;
      state.phase = "failed";
      state.failure = error && error.message ? error.message : String(error);
      state.phases.push({
        phase: "failed",
        elapsedMs: typeof state.startedAtMs === "number"
          ? Math.round(performance.now() - state.startedAtMs)
          : 0,
        failedDuring: state.failurePhase,
        message: state.failure,
      });
    }
    text("status").textContent = "failed";
    appendLine(text("output"), error && error.stack ? error.stack : String(error));
  });
}
