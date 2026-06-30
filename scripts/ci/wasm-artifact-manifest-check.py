#!/usr/bin/env python3
#
# Verify QEMU WebAssembly build artifact manifest handoff.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import argparse
import json
from pathlib import Path


def load_manifest(path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"failed to read artifact manifest {path}: {exc}")
    if not isinstance(manifest, dict):
        raise SystemExit(f"artifact manifest must be a JSON object: {path}")
    return manifest


def target_pair(manifest: dict, target: str) -> dict:
    targets = manifest.get("targets")
    if not isinstance(targets, list):
        raise SystemExit("artifact manifest does not contain a targets list")
    for entry in targets:
        if isinstance(entry, dict) and entry.get("target") == target:
            return entry
    raise SystemExit(f"artifact manifest does not contain target {target}")


def require_artifact(root: Path, path: str, label: str) -> None:
    if not isinstance(path, str) or path == "":
        raise SystemExit(f"artifact manifest target is missing {label}")
    artifact = root / path
    if not artifact.is_file():
        raise SystemExit(f"artifact manifest {label} does not exist: {artifact}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify a QEMU WebAssembly artifact manifest target pair."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        required=True,
        help="qemu-system-wasm-artifacts.json path",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="artifact root directory, defaulting to the manifest directory",
    )
    parser.add_argument(
        "--target",
        required=True,
        help="QEMU system target to require, for example x86_64",
    )
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    pair = target_pair(manifest, args.target)
    if pair.get("complete") is not True:
        raise SystemExit(f"artifact manifest target {args.target} is incomplete")

    root = args.root if args.root is not None else args.manifest.parent
    require_artifact(root, pair.get("javascript"), "JavaScript launcher")
    require_artifact(root, pair.get("wasm"), "WebAssembly module")

    print(
        f"verified QEMU WebAssembly target {args.target}: "
        f"{pair['javascript']} + {pair['wasm']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
