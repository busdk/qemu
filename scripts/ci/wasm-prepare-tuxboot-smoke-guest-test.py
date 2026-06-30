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

        manifest = module.browser_guest_manifest(kernel, initramfs, True)

        assert manifest["kernel"] == str(kernel)
        assert manifest["initrd"] == str(initramfs)
        assert manifest["marker"] == module.MARKER
        assert manifest["cpu"] == "Nehalem"
        assert manifest["network"] == "none"
        assert manifest["sha256"]["kernel"] == sha256(b"kernel\n")
        assert manifest["sha256"]["initrd"] == sha256(b"initramfs\n")
        assert manifest["serviceBridge"] == {
            "kind": "virtio-serial-jsonl",
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

        plain = module.browser_guest_manifest(kernel, initramfs, False)
        assert "serviceBridge" not in plain


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
    test_browser_command()
    print("wasm-prepare-tuxboot-smoke-guest-test: ok")


if __name__ == "__main__":
    main()
