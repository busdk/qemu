#!/usr/bin/env python3
#
# Test the TuxBoot WASM smoke guest preparation helpers.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import hashlib
import importlib.util
from pathlib import Path
import tempfile


SCRIPT = Path(__file__).with_name("wasm-prepare-tuxboot-smoke-guest.py")


def load_module():
    spec = importlib.util.spec_from_file_location("wasm_prepare_tuxboot", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Args:
    artifact_dir = "/artifacts"
    firmware_dir = "pc-bios"


def test_service_bridge_browser_manifest():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        kernel = root / "bzImage"
        initramfs = root / "initramfs.cpio.gz"
        kernel.write_bytes(b"kernel\n")
        initramfs.write_bytes(b"initramfs\n")

        manifest = module.browser_guest_manifest(
            root,
            module.TARGETS["x86_64"],
            kernel,
            initramfs,
            None,
            True,
        )

        assert manifest["kernel"] == "bzImage"
        assert manifest["initrd"] == "initramfs.cpio.gz"
        assert manifest["marker"] == module.MARKER
        assert manifest["program"] == "qemu-system-x86_64.js"
        assert manifest["wasm"] == "qemu-system-x86_64.wasm"
        assert manifest["cpu"] == "Nehalem"
        assert manifest["machine"] == "pc"
        assert manifest["network"] == "none"
        assert manifest["sha256"]["kernel"] == sha256(b"kernel\n")
        assert manifest["sha256"]["initrd"] == sha256(b"initramfs\n")
        assert manifest["serviceBridge"] == {
            "kind": "serial-jsonl",
            "requestChannel": "org.qemu.wasm.service.request",
            "responseChannel": "org.qemu.wasm.service.response",
            "readinessMarker": "QEMU_WASM_SERVICE_READY",
            "healthRequest": {
                "id": "health-1",
                "operation": "health",
            },
            "timeoutMs": 5000,
            "maxPayloadBytes": 4096,
            "interactiveOnly": False,
        }

        plain = module.browser_guest_manifest(
            root,
            module.TARGETS["x86_64"],
            kernel,
            initramfs,
            None,
            False,
        )
        assert plain["machine"] == "microvm,acpi=off"
        assert "serviceBridge" not in plain


def test_riscv64_browser_manifest():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        kernel = root / "Image"
        rootfs = root / "rootfs.ext4"
        kernel.write_bytes(b"riscv-kernel\n")
        rootfs.write_bytes(b"riscv-rootfs\n")

        manifest = module.browser_guest_manifest(
            root,
            module.TARGETS["riscv64"],
            kernel,
            None,
            rootfs,
            False,
        )

        assert manifest["kernel"] == "Image"
        assert manifest["rootfs"] == "rootfs.ext4"
        assert "initrd" not in manifest
        assert manifest["marker"] == "Welcome to TuxTest"
        assert manifest["program"] == "qemu-system-riscv64.js"
        assert manifest["wasm"] == "qemu-system-riscv64.wasm"
        assert manifest["cpu"] == ""
        assert manifest["machine"] == "virt"
        assert manifest["rootfsDevice"] == "virtio-mmio"
        assert manifest["kernelAppend"] == "printk.time=0 root=/dev/vda console=ttyS0 panic=-1"
        assert manifest["sha256"]["kernel"] == sha256(b"riscv-kernel\n")
        assert manifest["sha256"]["rootfs"] == sha256(b"riscv-rootfs\n")


def test_riscv64_node_command():
    module = load_module()
    command = module.node_boot_command(
        Args,
        module.TARGETS["riscv64"],
        Path("/tmp/Image"),
        None,
        Path("/tmp/rootfs.ext4"),
    )

    assert "--cpu" not in command
    assert command == [
        "node",
        "scripts/ci/wasm-linux-boot-smoke.mjs",
        "--artifact-dir",
        "/artifacts",
        "--kernel",
        "/tmp/Image",
        "--firmware-dir",
        "pc-bios",
        "--machine",
        "virt",
        "--marker",
        "Welcome to TuxTest",
        "--memory",
        "512M",
        "--program",
        "qemu-system-riscv64.js",
        "--wasm",
        "qemu-system-riscv64.wasm",
        "--timeout-ms",
        "180000",
        "--kernel-append",
        "printk.time=0 root=/dev/vda console=ttyS0 panic=-1",
        "--rootfs",
        "/tmp/rootfs.ext4",
        "--rootfs-device",
        "virtio-mmio",
    ]


def test_browser_command():
    module = load_module()
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        guest_manifest = root / "guest.json"
        command = module.browser_command(Args, guest_manifest, root)

        assert command == [
            "node",
            "scripts/ci/wasm-browser-smoke-runner.mjs",
            "--artifact-dir",
            "/artifacts",
            "--firmware-dir",
            "pc-bios",
            "--guest-manifest",
            str(guest_manifest),
            "--out",
            str(root / "wasm-browser-smoke-result.json"),
            "--screenshot",
            str(root / "wasm-browser-smoke.png"),
        ]


def main():
    test_service_bridge_browser_manifest()
    test_riscv64_browser_manifest()
    test_riscv64_node_command()
    test_browser_command()
    print("wasm-prepare-tuxboot-smoke-guest-test: ok")


if __name__ == "__main__":
    main()
