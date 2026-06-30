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
                    "size_bytes": len(js_data),
                    "sha256": sha256(js_data),
                },
                {
                    "path": "qemu-system-x86_64.wasm",
                    "kind": "webassembly-module",
                    "size_bytes": len(wasm_data),
                    "sha256": sha256(wasm_data),
                },
            ],
        }


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
    test_missing_artifacts()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
