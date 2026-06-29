#!/usr/bin/env python3
#
# Record QEMU WebAssembly build artifacts for later browser/runtime tests.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_kind(path: Path) -> str:
    suffix = path.suffix
    if suffix == ".js":
        return "emscripten-javascript"
    if suffix == ".wasm":
        return "webassembly-module"
    return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a JSON manifest for QEMU WebAssembly artifacts."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="directory containing generated qemu-system-* artifacts",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("qemu-system-wasm-artifacts.json"),
        help="manifest path to write",
    )
    args = parser.parse_args()

    root = args.root
    patterns = ("qemu-system-*.js", "qemu-system-*.wasm")
    paths = []
    for pattern in patterns:
        paths.extend(root.glob(pattern))
    paths = sorted(set(path for path in paths if path.is_file()))
    if not paths:
        parser.error(f"no qemu-system WebAssembly artifacts found under {root}")

    manifest = {
        "format": 1,
        "artifacts": [
            {
                "path": str(path.relative_to(root)),
                "kind": artifact_kind(path),
                "size_bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in paths
        ],
    }

    args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
