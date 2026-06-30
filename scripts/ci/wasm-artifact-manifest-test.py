#!/usr/bin/env python3
#
# Test QEMU WebAssembly artifact manifest generation.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("wasm-artifact-manifest.py")
CHECK_SCRIPT = Path(__file__).with_name("wasm-artifact-manifest-check.py")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_manifest(root: Path, output: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(root),
            "--output",
            str(output),
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def run_check(manifest: Path, target: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(CHECK_SCRIPT),
            "--manifest",
            str(manifest),
            "--target",
            target,
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def test_manifest() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        js_data = b"console.log('qemu wasm');\n"
        wasm_data = b"\0asmqemu"
        ignored_data = b"not an artifact"

        (root / "qemu-system-x86_64.js").write_bytes(js_data)
        (root / "qemu-system-x86_64.wasm").write_bytes(wasm_data)
        (root / "qemu-img.js").write_bytes(ignored_data)

        output = root / "manifest.json"
        result = run_manifest(root, output)
        assert result.returncode == 0, result.stderr

        manifest = json.loads(output.read_text(encoding="utf-8"))
        assert manifest == {
            "format": 1,
            "artifacts": [
                {
                    "path": "qemu-system-x86_64.js",
                    "kind": "emscripten-javascript",
                    "target": "x86_64",
                    "size_bytes": len(js_data),
                    "sha256": sha256(js_data),
                },
                {
                    "path": "qemu-system-x86_64.wasm",
                    "kind": "webassembly-module",
                    "target": "x86_64",
                    "size_bytes": len(wasm_data),
                    "sha256": sha256(wasm_data),
                },
            ],
            "targets": [
                {
                    "target": "x86_64",
                    "javascript": "qemu-system-x86_64.js",
                    "wasm": "qemu-system-x86_64.wasm",
                    "complete": True,
                },
            ],
        }

        check = run_check(output, "x86_64")
        assert check.returncode == 0, check.stderr
        assert "verified QEMU WebAssembly target x86_64" in check.stdout


def test_incomplete_target_pair() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        js_data = b"console.log('qemu wasm');\n"

        (root / "qemu-system-riscv64.js").write_bytes(js_data)

        output = root / "manifest.json"
        result = run_manifest(root, output)
        assert result.returncode == 0, result.stderr

        manifest = json.loads(output.read_text(encoding="utf-8"))
        assert manifest["targets"] == [
            {
                "target": "riscv64",
                "javascript": "qemu-system-riscv64.js",
                "wasm": None,
                "complete": False,
            },
        ]

        check = run_check(output, "riscv64")
        assert check.returncode == 1
        assert "artifact manifest target riscv64 is incomplete" in check.stderr


def test_missing_target_pair_file() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        js_data = b"console.log('qemu wasm');\n"
        wasm_data = b"\0asmqemu"

        (root / "qemu-system-x86_64.js").write_bytes(js_data)
        wasm = root / "qemu-system-x86_64.wasm"
        wasm.write_bytes(wasm_data)

        output = root / "manifest.json"
        result = run_manifest(root, output)
        assert result.returncode == 0, result.stderr
        wasm.unlink()

        check = run_check(output, "x86_64")
        assert check.returncode == 1
        assert "WebAssembly module does not exist" in check.stderr


def test_target_pair_checksum_mismatch() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        js_data = b"console.log('qemu wasm');\n"
        wasm_data = b"\0asmqemu"

        (root / "qemu-system-x86_64.js").write_bytes(js_data)
        wasm = root / "qemu-system-x86_64.wasm"
        wasm.write_bytes(wasm_data)

        output = root / "manifest.json"
        result = run_manifest(root, output)
        assert result.returncode == 0, result.stderr

        wasm.write_bytes(wasm_data + b"stale")

        check = run_check(output, "x86_64")
        assert check.returncode == 1
        assert "WebAssembly module checksum mismatch" in check.stderr


def test_missing_artifact_entry_for_target_pair() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        js_data = b"console.log('qemu wasm');\n"
        wasm_data = b"\0asmqemu"

        (root / "qemu-system-x86_64.js").write_bytes(js_data)
        (root / "qemu-system-x86_64.wasm").write_bytes(wasm_data)

        output = root / "manifest.json"
        result = run_manifest(root, output)
        assert result.returncode == 0, result.stderr

        manifest = json.loads(output.read_text(encoding="utf-8"))
        manifest["artifacts"] = [
            artifact for artifact in manifest["artifacts"]
            if artifact["path"] != "qemu-system-x86_64.js"
        ]
        output.write_text(json.dumps(manifest), encoding="utf-8")

        check = run_check(output, "x86_64")
        assert check.returncode == 1
        assert "has no entry for JavaScript launcher" in check.stderr


def test_missing_artifacts() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        output = root / "manifest.json"
        result = run_manifest(root, output)

        assert result.returncode == 2
        assert "no qemu-system WebAssembly artifacts found" in result.stderr
        assert not output.exists()


def main() -> int:
    test_manifest()
    test_incomplete_target_pair()
    test_missing_target_pair_file()
    test_target_pair_checksum_mismatch()
    test_missing_artifact_entry_for_target_pair()
    test_missing_artifacts()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
