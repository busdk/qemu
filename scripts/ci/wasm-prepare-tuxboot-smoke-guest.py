#!/usr/bin/env python3
#
# Prepare a product-neutral TuxBoot guest for QEMU WebAssembly smoke tests.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request


MARKER = "QEMU_WASM_LINUX_BOOT_OK"
SERVICE_READY_MARKER = "QEMU_WASM_SERVICE_READY"
SERVICE_REQUEST_CHANNEL = "org.qemu.wasm.service.request"
SERVICE_RESPONSE_CHANNEL = "org.qemu.wasm.service.response"
SERVICE_REQUEST_SERIAL = "/dev/ttyS1"
SERVICE_RESPONSE_SERIAL = "/dev/ttyS2"
RISCV64_MARKER = "Welcome to TuxTest"

X86_64_ROOTFS_FILES = (
    ("/bin/busybox", "bin/busybox", 0o755),
    ("/lib/ld64-uClibc-1.0.45.so", "lib/ld64-uClibc-1.0.45.so", 0o755),
    ("/lib/libuClibc-1.0.45.so", "lib/libuClibc-1.0.45.so", 0o755),
    ("/usr/lib/libtirpc.so.3.0.0", "usr/lib/libtirpc.so.3.0.0", 0o755),
)

X86_64_INITRAMFS_SYMLINKS = (
    ("/lib/ld64-uClibc.so.0", "ld64-uClibc.so.1"),
    ("/lib/ld64-uClibc.so.1", "ld64-uClibc-1.0.45.so"),
    ("/lib/libc.so.0", "libuClibc-1.0.45.so"),
    ("/usr/lib/libtirpc.so.3", "libtirpc.so.3.0.0"),
)

TARGETS = {
    "x86_64": {
        "kernel_url": "https://storage.tuxboot.com/buildroot/20241119/x86_64/bzImage",
        "kernel_sha256": "f57bfc6553bcd6e0a54aab86095bf642b33b5571d14e3af1731b18c87ed5aef8",
        "kernel_filename": "tuxboot-x86_64-bzImage",
        "rootfs_url": "https://storage.tuxboot.com/buildroot/20241119/x86_64/rootfs.ext4.zst",
        "rootfs_sha256": "4b8b2a99117519c5290e1202cb36eb6c7aaba92b357b5160f5970cf5fb78a751",
        "rootfs_filename": "tuxboot-x86_64-rootfs.ext4.zst",
        "rootfs_ext4_name": "tuxboot-x86_64-rootfs.ext4",
        "mode": "initramfs",
        "rootfs_files": X86_64_ROOTFS_FILES,
        "initramfs_symlinks": X86_64_INITRAMFS_SYMLINKS,
        "marker": MARKER,
        "program": "qemu-system-x86_64.js",
        "wasm": "qemu-system-x86_64.wasm",
        "cpu": "Nehalem",
        "machine": "microvm,acpi=off",
        "memory": "512M",
        "network": "none",
        "timeout_ms": 180000,
        "rootfs_device": "virtio-mmio",
        "kernel_append": None,
    },
    "riscv64": {
        "kernel_url": "https://storage.tuxboot.com/buildroot/20241119/riscv64/Image",
        "kernel_sha256": "2bd8132a3bf21570290042324fff48c987f42f2a00c08de979f43f0662ebadba",
        "kernel_filename": "tuxboot-riscv64-Image",
        "rootfs_url": "https://storage.tuxboot.com/buildroot/20241119/riscv64/rootfs.ext4.zst",
        "rootfs_sha256": "aa4736a9872651dfc0d95e709465eedf1134fd19d42b8cb305bfd776f9801004",
        "rootfs_filename": "tuxboot-riscv64-rootfs.ext4.zst",
        "rootfs_ext4_name": "tuxboot-riscv64-rootfs.ext4",
        "mode": "rootfs",
        "rootfs_files": (),
        "initramfs_symlinks": (),
        "marker": RISCV64_MARKER,
        "program": "qemu-system-riscv64.js",
        "wasm": "qemu-system-riscv64.wasm",
        "cpu": "",
        "machine": "virt",
        "memory": "512M",
        "network": "none",
        "timeout_ms": 180000,
        "rootfs_device": "virtio-mmio",
        "kernel_append": "printk.time=0 root=/dev/vda console=ttyS0 panic=-1",
    },
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="prepare a pinned TuxBoot guest for WASM smoke tests"
    )
    parser.add_argument(
        "--artifact-dir",
        default="/artifacts",
        help="QEMU WebAssembly artifact directory used in the printed boot command",
    )
    parser.add_argument(
        "--cache-dir",
        default=str(Path.home() / ".cache" / "qemu-wasm-smoke-assets"),
        help="directory used for downloaded or reused TuxBoot input assets",
    )
    parser.add_argument(
        "--firmware-dir",
        default="pc-bios",
        help="QEMU firmware directory used in the printed boot command",
    )
    parser.add_argument(
        "--kernel",
        help="existing TuxBoot kernel path; verified against the pinned SHA-256",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="fail instead of downloading a missing cached asset",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="directory where extracted files, initramfs, and manifest are written",
    )
    parser.add_argument(
        "--rootfs",
        help="existing TuxBoot rootfs.ext4.zst path; verified against the pinned SHA-256",
    )
    parser.add_argument(
        "--service-bridge-smoke",
        action="store_true",
        help="prepare the tiny guest service and browser-runner manifest for service bridge proof",
    )
    parser.add_argument(
        "--target",
        choices=sorted(TARGETS),
        default="x86_64",
        help="TuxBoot architecture target to prepare",
    )
    return parser.parse_args()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_sha256(path, expected, label):
    actual = sha256_file(path)
    if actual != expected:
        raise SystemExit(
            f"{label} SHA-256 mismatch: got {actual}, expected {expected}: {path}"
        )
    return actual


def download(url, destination, expected_sha256, no_download):
    if destination.exists():
        verify_sha256(destination, expected_sha256, destination.name)
        return destination
    if no_download:
        raise SystemExit(f"missing cached asset and --no-download was used: {destination}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=destination.parent, prefix=f".{destination.name}.", delete=False
    ) as temp_file:
        temp_path = Path(temp_file.name)
        try:
            with urllib.request.urlopen(url) as response:
                shutil.copyfileobj(response, temp_file)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    verify_sha256(temp_path, expected_sha256, destination.name)
    temp_path.replace(destination)
    return destination


def resolve_asset(explicit_path, cache_dir, filename, url, expected_sha256, no_download):
    if explicit_path:
        path = Path(explicit_path)
        verify_sha256(path, expected_sha256, filename)
        return path
    return download(url, cache_dir / filename, expected_sha256, no_download)


def require_tool(name):
    path = shutil.which(name)
    if path is None:
        raise SystemExit(f"required tool is missing: {name}")
    return path


def run(argv, stdout=None, quiet=False):
    result = subprocess.run(
        argv,
        stdout=stdout if stdout is not None or not quiet else subprocess.PIPE,
        stderr=subprocess.PIPE if quiet else None,
        text=quiet,
    )
    if result.returncode != 0:
        if quiet:
            if result.stdout:
                sys.stderr.write(result.stdout)
            if result.stderr:
                sys.stderr.write(result.stderr)
        raise subprocess.CalledProcessError(result.returncode, argv)


def decompress_rootfs(zstd, rootfs_zst, rootfs_ext4):
    rootfs_ext4.parent.mkdir(parents=True, exist_ok=True)
    with open(rootfs_ext4, "wb") as output_file:
        run([zstd, "-dc", str(rootfs_zst)], stdout=output_file)


def debugfs_dump(debugfs, rootfs_ext4, guest_path, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()
    run([debugfs, "-R", f"dump {guest_path} {output_path}", str(rootfs_ext4)], quiet=True)


def build_initramfs(output_dir, target_config, extracted_files, service_bridge_smoke):
    script_dir = Path(__file__).resolve().parent
    builder = script_dir / "wasm-build-smoke-initramfs.py"
    output = output_dir / "tuxboot-smoke-initramfs.cpio.gz"
    busybox = extracted_files["/bin/busybox"]["path"]
    argv = [
        sys.executable,
        str(builder),
        "--busybox",
        str(busybox),
        "--output",
        str(output),
        "--marker",
        MARKER,
    ]
    for guest_path, file_info in extracted_files.items():
        if guest_path == "/bin/busybox":
            continue
        argv.extend(["--extra-file", f"{file_info['path']}:{guest_path}"])
    for guest_path, target in target_config["initramfs_symlinks"]:
        argv.extend(["--extra-symlink", f"{guest_path}:{target}"])
    if service_bridge_smoke:
        argv.extend(
            [
                "--service-bridge-smoke",
                "--service-request-path",
                SERVICE_REQUEST_SERIAL,
                "--service-response-path",
                SERVICE_RESPONSE_SERIAL,
            ]
        )
    run(argv)
    return output


def node_boot_command(args, target_config, kernel, initramfs, rootfs):
    command = [
        "node",
        "scripts/ci/wasm-linux-boot-smoke.mjs",
        "--artifact-dir",
        args.artifact_dir,
        "--kernel",
        str(kernel),
        "--firmware-dir",
        args.firmware_dir,
        "--machine",
        target_config["machine"],
        "--marker",
        target_config["marker"],
        "--memory",
        target_config["memory"],
        "--program",
        target_config["program"],
        "--wasm",
        target_config["wasm"],
        "--timeout-ms",
        str(target_config["timeout_ms"]),
    ]
    if target_config["cpu"]:
        command.extend(["--cpu", target_config["cpu"]])
    if target_config["kernel_append"] is not None:
        command.extend(["--kernel-append", target_config["kernel_append"]])
    if initramfs is not None:
        command.extend(["--initrd", str(initramfs)])
    if rootfs is not None:
        command.extend([
            "--rootfs",
            str(rootfs),
            "--rootfs-device",
            target_config["rootfs_device"],
        ])
    return command


def service_bridge_config():
    return {
        "kind": "serial-jsonl",
        "requestChannel": SERVICE_REQUEST_CHANNEL,
        "responseChannel": SERVICE_RESPONSE_CHANNEL,
        "readinessMarker": SERVICE_READY_MARKER,
        "healthRequest": {
            "id": "health-1",
            "operation": "health",
        },
        "timeoutMs": 5000,
        "maxPayloadBytes": 4096,
        "interactiveOnly": False,
    }


def manifest_relative(output_dir, path):
    return os.path.relpath(Path(path), start=output_dir)


def browser_guest_manifest(output_dir, target_config, kernel, initramfs, rootfs, service_bridge_smoke):
    manifest = {
        "kernel": manifest_relative(output_dir, kernel),
        "marker": target_config["marker"],
        "program": target_config["program"],
        "wasm": target_config["wasm"],
        "cpu": target_config["cpu"],
        "machine": target_config["machine"],
        "memory": target_config["memory"],
        "network": target_config["network"],
        "timeoutMs": target_config["timeout_ms"],
        "maxOutputBytes": 60000,
        "sha256": {
            "kernel": sha256_file(kernel),
        },
    }
    if target_config["kernel_append"] is not None:
        manifest["kernelAppend"] = target_config["kernel_append"]
    if initramfs is not None:
        manifest["initrd"] = manifest_relative(output_dir, initramfs)
        manifest["sha256"]["initrd"] = sha256_file(initramfs)
    if rootfs is not None:
        manifest["rootfs"] = manifest_relative(output_dir, rootfs)
        manifest["rootfsDevice"] = target_config["rootfs_device"]
        manifest["sha256"]["rootfs"] = sha256_file(rootfs)
    if service_bridge_smoke:
        manifest["machine"] = "pc"
        manifest["serviceBridge"] = service_bridge_config()
    return manifest


def browser_command(args, guest_manifest_path, output_dir):
    return [
        "node",
        "scripts/ci/wasm-browser-smoke-runner.mjs",
        "--artifact-dir",
        args.artifact_dir,
        "--firmware-dir",
        args.firmware_dir,
        "--guest-manifest",
        str(guest_manifest_path),
        "--out",
        str(output_dir / "wasm-browser-smoke-result.json"),
        "--screenshot",
        str(output_dir / "wasm-browser-smoke.png"),
    ]


def main():
    args = parse_args()
    target_config = TARGETS[args.target]
    if args.service_bridge_smoke and target_config["mode"] != "initramfs":
        raise SystemExit("--service-bridge-smoke is only supported for initramfs targets")
    output_dir = Path(args.output_dir)
    cache_dir = Path(args.cache_dir)
    zstd = require_tool("zstd")
    debugfs = require_tool("debugfs") if target_config["mode"] == "initramfs" else None

    kernel = resolve_asset(
        args.kernel,
        cache_dir,
        target_config["kernel_filename"],
        target_config["kernel_url"],
        target_config["kernel_sha256"],
        args.no_download,
    )
    rootfs_zst = resolve_asset(
        args.rootfs,
        cache_dir,
        target_config["rootfs_filename"],
        target_config["rootfs_url"],
        target_config["rootfs_sha256"],
        args.no_download,
    )

    rootfs_ext4 = output_dir / target_config["rootfs_ext4_name"]
    decompress_rootfs(zstd, rootfs_zst, rootfs_ext4)

    extracted_files = {}
    initramfs = None
    rootfs = None
    if target_config["mode"] == "initramfs":
        extract_dir = output_dir / "tuxboot-rootfs-files"
        for guest_path, relative_output, mode in target_config["rootfs_files"]:
            output_path = extract_dir / relative_output
            debugfs_dump(debugfs, rootfs_ext4, guest_path, output_path)
            output_path.chmod(mode)
            extracted_files[guest_path] = {
                "path": output_path,
                "mode": mode,
            }
        initramfs = build_initramfs(
            output_dir,
            target_config,
            extracted_files,
            args.service_bridge_smoke,
        )
    else:
        rootfs = rootfs_ext4

    node_command = node_boot_command(args, target_config, kernel, initramfs, rootfs)
    browser_manifest_path = output_dir / "tuxboot-browser-smoke-guest.json"
    browser_manifest = browser_guest_manifest(
        output_dir,
        target_config,
        kernel,
        initramfs,
        rootfs,
        args.service_bridge_smoke,
    )
    browser_manifest_path.write_text(
        json.dumps(browser_manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    browser_smoke_command = browser_command(args, browser_manifest_path, output_dir)
    command = browser_smoke_command if args.service_bridge_smoke else node_command
    manifest = {
        "format-version": 1,
        "target": args.target,
        "marker": target_config["marker"],
        "kernel": {
            "path": str(kernel),
            "url": target_config["kernel_url"],
            "sha256": verify_sha256(kernel, target_config["kernel_sha256"], "kernel"),
        },
        "rootfs": {
            "path": str(rootfs_zst),
            "url": target_config["rootfs_url"],
            "sha256": verify_sha256(rootfs_zst, target_config["rootfs_sha256"], "rootfs"),
        },
        "rootfs-ext4": {
            "path": str(rootfs_ext4),
            "sha256": sha256_file(rootfs_ext4),
        },
        "extracted-files": [
            {
                "guest-path": guest_path,
                "path": str(path),
                "mode": f"{file_info['mode']:04o}",
                "sha256": sha256_file(path),
            }
            for guest_path, file_info in sorted(extracted_files.items())
            for path in [file_info["path"]]
        ],
        "required-tools": {
            "debugfs": debugfs,
            "zstd": zstd,
        },
        "boot-command": command,
        "node-boot-command": node_command,
        "browser-guest-manifest": str(browser_manifest_path),
        "browser-command": browser_smoke_command,
    }
    if initramfs is not None:
        manifest["initramfs"] = {
            "path": str(initramfs),
            "sha256": sha256_file(initramfs),
        }
    if args.service_bridge_smoke:
        manifest["service-bridge"] = service_bridge_config()
    manifest_path = output_dir / "tuxboot-smoke-guest.json"
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {manifest_path}")
    print(" ".join(command))
    return 0


if __name__ == "__main__":
    sys.exit(main())
