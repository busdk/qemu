#!/usr/bin/env python3
#
# Build a tiny initramfs for QEMU WebAssembly Linux boot smoke tests.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import argparse
import gzip
import os
import stat
import sys


DEFAULT_MARKER = "QEMU_WASM_LINUX_BOOT_OK"
DEFAULT_INPUT_READY_MARKER = "QEMU_WASM_LINUX_INPUT_READY"
DEFAULT_INPUT_TEXT = "ab"
DEFAULT_SERVICE_READY_MARKER = "QEMU_WASM_SERVICE_READY"
DEFAULT_SERVICE_REQUEST_PATH = "/dev/virtio-ports/org.qemu.wasm.service.request"
DEFAULT_SERVICE_RESPONSE_PATH = "/dev/virtio-ports/org.qemu.wasm.service.response"


def parse_args():
    parser = argparse.ArgumentParser(
        description="build a deterministic tiny newc initramfs for WASM smoke tests"
    )
    parser.add_argument(
        "--busybox",
        required=True,
        help="path to a BusyBox binary for the guest architecture",
    )
    parser.add_argument(
        "--extra-file",
        action="append",
        default=[],
        metavar="HOST:GUEST",
        help="copy host file HOST to absolute guest path GUEST",
    )
    parser.add_argument(
        "--extra-symlink",
        action="append",
        default=[],
        metavar="GUEST:TARGET",
        help="create absolute guest symlink GUEST pointing to TARGET",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="output initramfs.cpio.gz path",
    )
    parser.add_argument(
        "--marker",
        default=DEFAULT_MARKER,
        help=f"serial-console marker printed by /init (default: {DEFAULT_MARKER})",
    )
    parser.add_argument(
        "--display-input-smoke",
        action="store_true",
        help="generate an init that writes to the VGA console and waits for keyboard input",
    )
    parser.add_argument(
        "--input-ready-marker",
        default=DEFAULT_INPUT_READY_MARKER,
        help="serial marker printed before waiting for keyboard input",
    )
    parser.add_argument(
        "--input-text",
        default=DEFAULT_INPUT_TEXT,
        help="keyboard line expected by --display-input-smoke",
    )
    parser.add_argument(
        "--input-helper",
        help="static guest helper binary that reads Linux input events for --display-input-smoke",
    )
    parser.add_argument(
        "--service-bridge-smoke",
        action="store_true",
        help="generate an init that serves one JSONL health request over virtio ports",
    )
    parser.add_argument(
        "--service-ready-marker",
        default=DEFAULT_SERVICE_READY_MARKER,
        help="serial marker printed when the service bridge is ready",
    )
    parser.add_argument(
        "--service-request-path",
        default=DEFAULT_SERVICE_REQUEST_PATH,
        help="guest path for service bridge request input",
    )
    parser.add_argument(
        "--service-response-path",
        default=DEFAULT_SERVICE_RESPONSE_PATH,
        help="guest path for service bridge response output",
    )
    parser.add_argument(
        "--persistent-disk-smoke",
        choices=("write", "verify"),
        help="generate an init that writes or verifies the persistent virtio disk",
    )
    parser.add_argument(
        "--persistent-disk-device",
        default="/dev/vdb",
        help="guest block device used by --persistent-disk-smoke",
    )
    parser.add_argument(
        "--persistent-disk-payload",
        default="QEMU_WASM_PERSISTENT_DISK_OK",
        help="payload written and verified by --persistent-disk-smoke",
    )
    return parser.parse_args()


def parse_guest_mapping(value, option):
    separator = value.find(":")
    if separator < 1:
        raise SystemExit(f"{option} must use LEFT:RIGHT")
    left = value[:separator]
    right = value[separator + 1:]
    if not left or not right:
        raise SystemExit(f"{option} must use non-empty LEFT:RIGHT")
    return left, right


def archive_name(path):
    if not path.startswith("/"):
        raise SystemExit(f"guest path must be absolute: {path}")
    name = path.strip("/")
    if not name or any(part in {"", ".", ".."} for part in name.split("/")):
        raise SystemExit(f"guest path is not valid: {path}")
    return name


def align4(value):
    return (value + 3) & ~3


class NewcWriter:
    def __init__(self, stream):
        self.stream = stream
        self.ino = 1
        self.dirs = set()

    def add_dir(self, name, mode=0o755):
        if name in self.dirs:
            return
        self._add_entry(name, stat.S_IFDIR | mode, 2, b"")
        self.dirs.add(name)

    def add_parent_dirs(self, name):
        parts = name.split("/")[:-1]
        current = ""
        for part in parts:
            current = part if not current else f"{current}/{part}"
            self.add_dir(current)

    def add_file(self, name, data, mode=0o755):
        self.add_parent_dirs(name)
        self._add_entry(name, stat.S_IFREG | mode, 1, data)

    def add_symlink(self, name, target):
        self.add_parent_dirs(name)
        self._add_entry(name, stat.S_IFLNK | 0o777, 1, target.encode("utf-8"))

    def add_char_device(self, name, major, minor, mode=0o600):
        self.add_parent_dirs(name)
        self._add_entry(name, stat.S_IFCHR | mode, 1, b"", major, minor)

    def finish(self):
        self._add_entry("TRAILER!!!", 0, 1, b"")

    def _add_entry(self, name, mode, nlink, data, rdev_major=0, rdev_minor=0):
        encoded_name = name.encode("utf-8") + b"\0"
        fields = [
            "070701",
            f"{self.ino:08x}",
            f"{mode:08x}",
            "00000000",
            "00000000",
            f"{nlink:08x}",
            "00000000",
            f"{len(data):08x}",
            "00000000",
            "00000000",
            f"{rdev_major:08x}",
            f"{rdev_minor:08x}",
            f"{len(encoded_name):08x}",
            "00000000",
        ]
        header = "".join(fields).encode("ascii")
        self.stream.write(header)
        self.stream.write(encoded_name)
        self.stream.write(b"\0" * (align4(len(header) + len(encoded_name)) - len(header) - len(encoded_name)))
        self.stream.write(data)
        self.stream.write(b"\0" * (align4(len(data)) - len(data)))
        self.ino += 1


def build_init(marker):
    return f"""#!/bin/sh
echo {shell_quote(marker)}
/bin/busybox mkdir -p /proc /sys /dev
/bin/busybox mount -t proc proc /proc 2>/dev/null || true
/bin/busybox mount -t sysfs sysfs /sys 2>/dev/null || true
poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
""".encode("utf-8")


def build_display_input_init(marker, ready_marker, input_text, helper_path):
    helper_command = ""
    if helper_path:
        helper_command = (
            f"if [ -x {shell_quote(helper_path)} ] && "
            f"{shell_quote(helper_path)} /dev/input "
            f"{shell_quote(input_text)} 30 "
            f"{shell_quote(ready_marker)} > \"$serial\" 2>&1; then\n"
            "    input_ok=1\n"
            "else\n"
            "    say 'QEMU_WASM_LINUX_INPUT_EVENT_HELPER_FAILED'\n"
            "fi\n"
            "input_ready=1\n"
        )
    return f"""#!/bin/sh
PATH=/bin
/bin/busybox mkdir -p /proc /sys /dev
/bin/busybox mount -t proc proc /proc 2>/dev/null || true
/bin/busybox mount -t sysfs sysfs /sys 2>/dev/null || true
/bin/busybox mount -t devtmpfs devtmpfs /dev 2>/dev/null || true

serial=/dev/ttyS0
[ -c "$serial" ] || serial=/dev/console
say() {{
    printf '%s\\n' "$1" > "$serial" 2>/dev/null || printf '%s\\n' "$1"
}}

expected={shell_quote(input_text)}

input_ok=0
input_ready=0
{helper_command}
if [ "$input_ready" != 1 ]; then
    say {shell_quote(ready_marker)}
fi
if [ "$input_ok" != 1 ]; then
    input=''
    if IFS= read -r input < /dev/tty1 2>/dev/null; then
        say "QEMU_WASM_LINUX_INPUT_TEXT:$input"
        if [ "$input" = "$expected" ]; then
            input_ok=1
        else
            say "QEMU_WASM_LINUX_INPUT_MISMATCH:$input"
        fi
    else
        say 'QEMU_WASM_LINUX_INPUT_TTY_READ_FAILED'
    fi
fi

if [ "$input_ok" = 1 ]; then
    {{
        printf '\\033[2J\\033[H'
        printf '%s\\n' 'QEMU WASM DISPLAY INPUT OK'
    }} > /dev/tty0 2>/dev/null || true
    say {shell_quote(marker)}
else
    say 'QEMU_WASM_LINUX_INPUT_FAILED'
fi

poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
""".encode("utf-8")


def build_service_bridge_init(marker, ready_marker, request_path, response_path):
    return f"""#!/bin/sh
PATH=/bin
/bin/busybox mkdir -p /proc /sys /dev
/bin/busybox mount -t proc proc /proc 2>/dev/null || true
/bin/busybox mount -t sysfs sysfs /sys 2>/dev/null || true
/bin/busybox mount -t devtmpfs devtmpfs /dev 2>/dev/null || true

serial=/dev/ttyS0
[ -c "$serial" ] || serial=/dev/console
say() {{
    printf '%s\\n' "$1" > "$serial" 2>/dev/null || printf '%s\\n' "$1"
}}

request={shell_quote(request_path)}
response={shell_quote(response_path)}

i=0
while [ ! -e "$request" ] || [ ! -e "$response" ]; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
        say 'QEMU_WASM_SERVICE_PORTS_MISSING'
        poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
        exit 1
    fi
    /bin/busybox sleep 1
done

say {shell_quote(ready_marker)}

if IFS= read -r line < "$request"; then
    id=$(printf '%s\\n' "$line" | /bin/busybox sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
    operation=$(printf '%s\\n' "$line" | /bin/busybox sed -n 's/.*"operation"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
    [ -n "$id" ] || id='health-1'
    if [ "$operation" = health ]; then
        printf '{{"id":"%s","status":"ok","operation":"health"}}\\n' "$id" > "$response"
        say {shell_quote(marker)}
    else
        printf '{{"id":"%s","status":"error","error":"unsupported operation"}}\\n' "$id" > "$response"
        say 'QEMU_WASM_SERVICE_UNSUPPORTED_OPERATION'
    fi
else
    say 'QEMU_WASM_SERVICE_READ_FAILED'
fi

poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
""".encode("utf-8")


def build_persistent_disk_init(marker, mode, device, payload):
    payload_len = len(payload.encode("utf-8"))
    success_marker = "QEMU_WASM_PERSISTENT_DISK_WRITE_OK"
    if mode == "verify":
        success_marker = "QEMU_WASM_PERSISTENT_DISK_VERIFY_OK"
    return f"""#!/bin/sh
PATH=/bin
/bin/busybox mkdir -p /proc /sys /dev
/bin/busybox mount -t proc proc /proc 2>/dev/null || true
/bin/busybox mount -t sysfs sysfs /sys 2>/dev/null || true
/bin/busybox mount -t devtmpfs devtmpfs /dev 2>/dev/null || true

serial=/dev/ttyS0
[ -c "$serial" ] || serial=/dev/console
say() {{
    printf '%s\\n' "$1" > "$serial" 2>/dev/null || printf '%s\\n' "$1"
}}

device={shell_quote(device)}
payload={shell_quote(payload)}
payload_len={payload_len}

i=0
while [ ! -b "$device" ]; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
        say "QEMU_WASM_PERSISTENT_DISK_DEVICE_MISSING:$device"
        poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
        exit 1
    fi
    /bin/busybox sleep 1
done

if [ {shell_quote(mode)} = write ]; then
    if ! printf '%s' "$payload" | /bin/busybox dd of="$device" bs=1 conv=notrunc 2>/dev/null; then
        say 'QEMU_WASM_PERSISTENT_DISK_WRITE_FAILED'
        poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
        exit 1
    fi
    /bin/busybox sync
fi

readback=$(/bin/busybox dd if="$device" bs=1 count="$payload_len" 2>/dev/null)
if [ "$readback" = "$payload" ]; then
    say {shell_quote(success_marker)}
    say {shell_quote(marker)}
else
    say "QEMU_WASM_PERSISTENT_DISK_MISMATCH:$readback"
fi

poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || /bin/busybox sleep 5
""".encode("utf-8")


def shell_quote(value):
    return "'" + value.replace("'", "'\"'\"'") + "'"


def main():
    args = parse_args()

    with open(args.busybox, "rb") as busybox_file:
        busybox = busybox_file.read()

    extra_files = []
    input_helper_guest_path = ""
    if args.input_helper:
        with open(args.input_helper, "rb") as helper_file:
            helper = helper_file.read()
        input_helper_guest_path = "/bin/wasm-display-input-helper"
        extra_files.append((archive_name(input_helper_guest_path), helper, 0o755))

    for spec in args.extra_file:
        host_path, guest_path = parse_guest_mapping(spec, "--extra-file")
        with open(host_path, "rb") as extra_file:
            data = extra_file.read()
        mode = os.stat(host_path).st_mode & 0o777
        extra_files.append((archive_name(guest_path), data, mode))

    extra_symlinks = []
    for spec in args.extra_symlink:
        guest_path, target = parse_guest_mapping(spec, "--extra-symlink")
        extra_symlinks.append((archive_name(guest_path), target))

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(args.output, "wb") as raw_output:
        with gzip.GzipFile(fileobj=raw_output, mode="wb", filename="", mtime=0) as gz:
            archive = NewcWriter(gz)
            archive.add_dir(".")
            archive.add_dir("bin")
            archive.add_dir("dev")
            archive.add_dir("dev/input")
            archive.add_dir("proc")
            archive.add_dir("sys")
            archive.add_char_device("dev/console", 5, 1)
            archive.add_char_device("dev/tty0", 4, 0)
            archive.add_char_device("dev/tty1", 4, 1)
            archive.add_char_device("dev/ttyS0", 4, 64)
            for event_minor in range(64, 96):
                archive.add_char_device(
                    f"dev/input/event{event_minor - 64}",
                    13,
                    event_minor,
                )
            if args.persistent_disk_smoke:
                init = build_persistent_disk_init(
                    args.marker,
                    args.persistent_disk_smoke,
                    args.persistent_disk_device,
                    args.persistent_disk_payload,
                )
            elif args.service_bridge_smoke:
                init = build_service_bridge_init(
                    args.marker,
                    args.service_ready_marker,
                    args.service_request_path,
                    args.service_response_path,
                )
            elif args.display_input_smoke:
                init = build_display_input_init(
                    args.marker,
                    args.input_ready_marker,
                    args.input_text,
                    input_helper_guest_path,
                )
            else:
                init = build_init(args.marker)
            archive.add_file("init", init)
            archive.add_file("bin/busybox", busybox)
            archive.add_symlink("bin/sh", "busybox")
            for name, data, mode in sorted(extra_files):
                archive.add_file(name, data, mode)
            for name, target in sorted(extra_symlinks):
                archive.add_symlink(name, target)
            archive.finish()

    return 0


if __name__ == "__main__":
    sys.exit(main())
