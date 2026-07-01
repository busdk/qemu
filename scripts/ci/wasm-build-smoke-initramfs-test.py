#!/usr/bin/env python3
#
# Test the deterministic WASM smoke initramfs builder.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import gzip
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("wasm-build-smoke-initramfs.py")


def align4(value):
    return (value + 3) & ~3


def parse_newc(path):
    entries = {}
    with gzip.open(path, "rb") as stream:
        data = stream.read()
    offset = 0
    while True:
        header = data[offset:offset + 110]
        if len(header) != 110:
            raise AssertionError("truncated cpio header")
        offset += 110
        if header[:6] != b"070701":
            raise AssertionError(f"bad cpio magic at offset {offset - 110}")
        fields = [
            int(header[start:start + 8], 16)
            for start in range(6, 110, 8)
        ]
        mode = fields[1]
        filesize = fields[6]
        rdev_major = fields[9]
        rdev_minor = fields[10]
        namesize = fields[11]
        name_data = data[offset:offset + namesize]
        offset += namesize
        offset = align4(offset)
        name = name_data.rstrip(b"\0").decode("utf-8")
        file_data = data[offset:offset + filesize]
        offset += filesize
        offset = align4(offset)
        if name == "TRAILER!!!":
            break
        entries[name] = {
            "mode": mode,
            "data": file_data,
            "rdev_major": rdev_major,
            "rdev_minor": rdev_minor,
        }
    return entries


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def test_display_input_smoke_initramfs():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        busybox = root / "busybox"
        helper = root / "input-helper"
        output = root / "initramfs.cpio.gz"
        busybox.write_bytes(b"busybox")
        helper.write_bytes(b"helper")
        busybox.chmod(0o755)
        helper.chmod(0o755)

        subprocess.run([
            sys.executable,
            str(SCRIPT),
            "--busybox",
            str(busybox),
            "--output",
            str(output),
            "--display-input-smoke",
            "--input-helper",
            str(helper),
            "--input-text",
            "ab",
        ], check=True)

        entries = parse_newc(output)
        init = entries["init"]["data"]
        assert_true(b"QEMU_WASM_LINUX_INPUT_READY" in init,
                    "display input init should print the input ready marker")
        assert_true(b"read -r input < /dev/tty1" in init,
                    "display input init should fall back to the first virtual terminal")
        assert_true(b"QEMU WASM DISPLAY INPUT OK" in init,
                    "display input init should draw the visual marker")
        assert_true(b"/bin/wasm-display-input-helper" in init,
                    "display input init should run the input-event helper")
        assert_true(b"/dev/input " in init,
                    "display input init should let the helper scan input events")
        assert_true(b"'QEMU_WASM_LINUX_INPUT_READY' > \"$serial\"" in init,
                    "input helper should emit readiness after opening input fds")
        assert_true(b"input_ready=1" in init,
                    "display input init should not emit fallback readiness after helper use")
        assert_true(entries["bin/wasm-display-input-helper"]["data"] == b"helper",
                    "input helper should be copied into the initramfs")
        assert_true(stat.S_ISDIR(entries["dev/input"]["mode"]),
                    "dev/input should be a directory")
        assert_true(stat.S_ISCHR(entries["dev/tty0"]["mode"]),
                    "dev/tty0 should be a character device")
        assert_true(entries["dev/tty0"]["rdev_major"] == 4,
                    "dev/tty0 major should be 4")
        assert_true(entries["dev/tty0"]["rdev_minor"] == 0,
                    "dev/tty0 minor should be 0")
        assert_true(stat.S_ISCHR(entries["dev/tty1"]["mode"]),
                    "dev/tty1 should be a character device")
        assert_true(entries["dev/tty1"]["rdev_major"] == 4,
                    "dev/tty1 major should be 4")
        assert_true(entries["dev/tty1"]["rdev_minor"] == 1,
                    "dev/tty1 minor should be 1")
        assert_true(stat.S_ISCHR(entries["dev/ttyS0"]["mode"]),
                    "dev/ttyS0 should be a character device")
        assert_true(entries["dev/ttyS0"]["rdev_major"] == 4,
                    "dev/ttyS0 major should be 4")
        assert_true(entries["dev/ttyS0"]["rdev_minor"] == 64,
                    "dev/ttyS0 minor should be 64")
        assert_true(stat.S_ISCHR(entries["dev/input/event0"]["mode"]),
                    "dev/input/event0 should be a character device")
        assert_true(entries["dev/input/event0"]["rdev_major"] == 13,
                    "dev/input/event0 major should be 13")
        assert_true(entries["dev/input/event0"]["rdev_minor"] == 64,
                    "dev/input/event0 minor should be 64")
        assert_true(stat.S_ISCHR(entries["dev/input/event31"]["mode"]),
                    "dev/input/event31 should be a character device")
        assert_true(entries["dev/input/event31"]["rdev_major"] == 13,
                    "dev/input/event31 major should be 13")
        assert_true(entries["dev/input/event31"]["rdev_minor"] == 95,
                    "dev/input/event31 minor should be 95")


def test_service_bridge_smoke_initramfs():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        busybox = root / "busybox"
        output = root / "service-initramfs.cpio.gz"
        busybox.write_bytes(b"busybox")
        busybox.chmod(0o755)

        subprocess.run([
            sys.executable,
            str(SCRIPT),
            "--busybox",
            str(busybox),
            "--output",
            str(output),
            "--service-bridge-smoke",
        ], check=True)

        entries = parse_newc(output)
        init = entries["init"]["data"]
        assert_true(b"/dev/virtio-ports/org.qemu.wasm.service.request" in init,
                    "service bridge init should use the default request port")
        assert_true(b"/dev/virtio-ports/org.qemu.wasm.service.response" in init,
                    "service bridge init should use the default response port")
        assert_true(b"QEMU_WASM_SERVICE_READY" in init,
                    "service bridge init should print readiness marker")
        assert_true(b"QEMU_WASM_SERVICE_PORTS_MISSING" in init,
                    "service bridge init should diagnose missing virtio ports")
        assert_true(b'"operation"[[:space:]]*:[[:space:]]*"' in init,
                    "service bridge init should parse operation from JSON")
        assert_true(b'"id"[[:space:]]*:[[:space:]]*"' in init,
                    "service bridge init should parse request id from JSON")
        assert_true(b'{"id":"%s","status":"ok","operation":"health"}' in init,
                    "service bridge init should return a health response")
        assert_true(b"QEMU_WASM_LINUX_BOOT_OK" in init,
                    "service bridge init should print the success marker")


def test_persistent_disk_smoke_initramfs():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        busybox = root / "busybox"
        output = root / "persistent-disk-initramfs.cpio.gz"
        busybox.write_bytes(b"busybox")
        busybox.chmod(0o755)

        subprocess.run([
            sys.executable,
            str(SCRIPT),
            "--busybox",
            str(busybox),
            "--output",
            str(output),
            "--persistent-disk-smoke",
            "verify",
            "--persistent-disk-device",
            "/dev/vdb",
            "--persistent-disk-payload",
            "BUS_ENGINE_OS_DISK_PROOF",
        ], check=True)

        entries = parse_newc(output)
        init = entries["init"]["data"]
        assert_true(b"/dev/vdb" in init,
                    "persistent disk init should use the requested disk device")
        assert_true(b"BUS_ENGINE_OS_DISK_PROOF" in init,
                    "persistent disk init should include the proof payload")
        assert_true(b"QEMU_WASM_PERSISTENT_DISK_VERIFY_OK" in init,
                    "verify init should print the verify success marker")
        assert_true(b"QEMU_WASM_PERSISTENT_DISK_WRITE_OK" not in init,
                    "verify init should not print the write success marker")
        assert_true(b"QEMU_WASM_PERSISTENT_DISK_DEVICE_MISSING" in init,
                    "persistent disk init should diagnose missing disk devices")
        assert_true(b"dd if=\"$device\" bs=1 count=\"$payload_len\"" in init,
                    "persistent disk init should read back the exact proof payload")
        assert_true(b"conv=notrunc" in init,
                    "persistent disk init should preserve the rest of the raw disk on writes")
        assert_true(b"QEMU_WASM_LINUX_BOOT_OK" in init,
                    "persistent disk init should print the success marker")


def main():
    test_display_input_smoke_initramfs()
    test_service_bridge_smoke_initramfs()
    test_persistent_disk_smoke_initramfs()
    print("wasm-build-smoke-initramfs-test: ok")


if __name__ == "__main__":
    main()
