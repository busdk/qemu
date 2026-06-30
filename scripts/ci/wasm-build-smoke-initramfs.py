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

    def finish(self):
        self._add_entry("TRAILER!!!", 0, 1, b"")

    def _add_entry(self, name, mode, nlink, data):
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
            "00000000",
            "00000000",
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
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
poweroff -f 2>/dev/null || /bin/busybox poweroff -f 2>/dev/null || sleep 5
""".encode("utf-8")


def shell_quote(value):
    return "'" + value.replace("'", "'\"'\"'") + "'"


def main():
    args = parse_args()

    with open(args.busybox, "rb") as busybox_file:
        busybox = busybox_file.read()

    extra_files = []
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
            archive.add_dir("proc")
            archive.add_dir("sys")
            archive.add_file("init", build_init(args.marker))
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
