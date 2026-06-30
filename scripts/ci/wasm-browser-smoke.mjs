/*
 * Browser harness for QEMU WebAssembly smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const DEFAULT_MARKER = "QEMU_WASM_LINUX_BOOT_OK";

function option(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value === "" ? fallback : value;
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

function qemuArgs(config) {
  const kernelAppend = [
    "console=ttyS0 earlyprintk=serial,ttyS0,115200 rdinit=/init acpi=off hpet=disable tsc=unstable lpj=1000000 clocksource=jiffies panic=-1",
    config.appendExtra,
  ].filter(Boolean).join(" ");
  const args = [
    "-M",
    "microvm,acpi=off",
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
    "-initrd",
    "/initramfs.cpio.gz",
    "-append",
    kernelAppend,
    "-L",
    "/firmware",
  );
  return args;
}

function buildConfig() {
  return {
    appendExtra: option("appendExtra", ""),
    cpu: option("cpu", "Nehalem"),
    initrd: option("initrd", "/guest/initramfs.cpio.gz"),
    kernel: option("kernel", "/guest/kernel"),
    linuxboot: option("linuxboot", "/firmware/linuxboot_dma.bin"),
    marker: option("marker", DEFAULT_MARKER),
    maxOutputBytes: numberOption("maxOutputBytes", 60000),
    memory: option("memory", "512M"),
    program: option("program", "/artifacts/qemu-system-x86_64.js"),
    qboot: option("qboot", "/firmware/qboot.rom"),
    timeoutMs: numberOption("timeoutMs", 180000),
    wasm: option("wasm", "/artifacts/qemu-system-x86_64.wasm"),
  };
}

async function run() {
  const status = text("status");
  const output = text("output");
  const config = buildConfig();
  const programUrl = new URL(config.program, window.location.href);
  const wasmUrl = new URL(config.wasm, window.location.href);
  const smokeState = {
    lines: 0,
    outputBytes: 0,
    outputSuppressed: false,
    markerSeen: false,
    lastLine: "",
  };
  globalThis.qemuWasmSmokeState = smokeState;
  const mounts = [
    { url: config.kernel, path: "/kernel" },
    { url: config.initrd, path: "/initramfs.cpio.gz" },
    { url: config.qboot, path: "/firmware/qboot.rom" },
    { url: config.linuxboot, path: "/firmware/linuxboot_dma.bin" },
  ];

  if (!crossOriginIsolated) {
    throw new Error("cross-origin isolation is required for pthread WebAssembly");
  }
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("SharedArrayBuffer is not available");
  }

  const timeout = setTimeout(() => {
    if (!smokeState.markerSeen) {
      status.textContent = `timeout waiting for marker: ${config.marker}`;
    }
  }, config.timeoutMs);

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
      clearTimeout(timeout);
      status.textContent = `marker reached: ${config.marker}`;
    }
  };

  status.textContent = "loading smoke guest inputs";
  for (const mount of mounts) {
    mount.data = await fetchBytes(mount.url);
  }

  status.textContent = "loading QEMU WebAssembly module";
  const moduleFactory = (await import(programUrl.href)).default;
  status.textContent = "starting QEMU";
  await moduleFactory({
    arguments: qemuArgs(config),
    locateFile(path) {
      if (path === "qemu-system-x86_64.wasm") {
        return wasmUrl.href;
      }
      return new URL(path, programUrl).href;
    },
    mainScriptUrlOrBlob: programUrl.href,
    preRun: [
      (module) => {
        mountFiles(module, mounts);
      },
    ],
    print: emit,
    printErr: emit,
  });
  if (!smokeState.markerSeen) {
    status.textContent = "QEMU started; waiting for marker";
  }
}

run().catch((error) => {
  text("status").textContent = "failed";
  appendLine(text("output"), error && error.stack ? error.stack : String(error));
});
