#!/usr/bin/env python3
#
# Verify QEMU WebAssembly build artifact manifest handoff.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import argparse
import hashlib
import json
from pathlib import Path


# Byte markers that exist only when tcg/wasm64.c was compiled into the
# module: the wasm64 runtime control readers and the runloop evidence
# emitter prefix. A TCI-only build contains none of them, so requiring
# them fails closed before a TCI-only artifact reaches a browser run.
WASM64_BACKEND_MARKERS = (
    b"QEMU_WASM64_RUNLOOP_SMOKE",
    b"QEMU_WASM64_LIVE_GENERATED_EXEC",
    b"QEMU_WASM64_LIVE_GENERATED_EXEC_NO_FALLBACK",
    b"QEMU_WASM64_LIVE_GENERATED_EXEC_PREFLIGHT",
    b"qemu-wasm64-runloop:",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def artifact_index(manifest: dict) -> dict:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        raise SystemExit(
            "artifact manifest does not contain an artifacts list"
        )
    result = {}
    for entry in artifacts:
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            result[entry["path"]] = entry
    return result


def require_artifact(
    root: Path, path: str, label: str, artifacts: dict
) -> None:
    if not isinstance(path, str) or path == "":
        raise SystemExit(f"artifact manifest target is missing {label}")
    artifact = root / path
    if not artifact.is_file():
        raise SystemExit(
            f"artifact manifest {label} does not exist: {artifact}"
        )
    entry = artifacts.get(path)
    if not isinstance(entry, dict):
        raise SystemExit(f"artifact manifest has no entry for {label}: {path}")
    expected = entry.get("sha256")
    if not isinstance(expected, str) or expected == "":
        raise SystemExit(
            f"artifact manifest entry is missing {label} SHA-256: {path}"
        )
    actual = sha256(artifact)
    if actual != expected.lower():
        raise SystemExit(
            f"artifact manifest {label} checksum mismatch: "
            f"expected {expected.lower()}, got {actual}"
        )


def require_wasm64_backend(root: Path, path: str) -> None:
    module = root / path
    data = module.read_bytes()
    missing = [
        marker.decode("ascii")
        for marker in WASM64_BACKEND_MARKERS
        if marker not in data
    ]
    if missing:
        raise SystemExit(
            "WebAssembly module does not contain the wasm64 TCG backend; "
            f"missing capability markers in {module}: {', '.join(missing)}"
        )


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
    parser.add_argument(
        "--require-wasm64-backend",
        action="store_true",
        help=(
            "fail unless the WebAssembly module bytes contain the wasm64 "
            "TCG backend runtime controls and runloop evidence emitter"
        ),
    )
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    pair = target_pair(manifest, args.target)
    if pair.get("complete") is not True:
        raise SystemExit(
            f"artifact manifest target {args.target} is incomplete"
        )

    root = args.root if args.root is not None else args.manifest.parent
    artifacts = artifact_index(manifest)
    require_artifact(
        root, pair.get("javascript"), "JavaScript launcher", artifacts
    )
    require_artifact(root, pair.get("wasm"), "WebAssembly module", artifacts)
    backend_note = ""
    if args.require_wasm64_backend:
        require_wasm64_backend(root, pair["wasm"])
        backend_note = " with the wasm64 TCG backend"

    print(
        f"verified QEMU WebAssembly target {args.target}{backend_note}: "
        f"{pair['javascript']} + {pair['wasm']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
