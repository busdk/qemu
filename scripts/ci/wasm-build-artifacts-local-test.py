#!/usr/bin/env python3
#
# SPDX-License-Identifier: GPL-2.0-or-later

import importlib.util
from pathlib import Path
import tempfile


SCRIPT = Path(__file__).with_name("wasm-build-artifacts-local.py")


def load_module():
    spec = importlib.util.spec_from_file_location("wasm_build_artifacts_local", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_docker_command():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src"
        out = Path(tmp) / "out"
        (source / "scripts" / "ci").mkdir(parents=True)
        (source / "configure").write_text("#!/bin/sh\n", encoding="utf-8")
        (source / "scripts" / "ci" / "wasm-artifact-manifest.py").write_text("", encoding="utf-8")
        args = module.parse_args(["--source-root", str(source), "--out", str(out)])
        command = module.docker_run_command(args)
        joined = "\n".join(command)
        for want in [
            "qemu/emsdk-wasm64-cross:latest",
            "--target-list=x86_64-softmmu",
            "--cpu=wasm64",
            "--enable-tcg-interpreter",
            "--enable-sdl",
            "--extra-cflags=-sUSE_SDL=2",
            "qemu-system-x86_64.js",
            "qemu-system-x86_64.wasm",
            "qemu-system-wasm-artifacts.json",
            "wasm-artifact-manifest-check.py --manifest qemu-system-wasm-artifacts.json --target x86_64",
        ]:
            assert want in joined, joined


def test_riscv64_docker_command():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src"
        out = Path(tmp) / "out"
        (source / "scripts" / "ci").mkdir(parents=True)
        (source / "configure").write_text("#!/bin/sh\n", encoding="utf-8")
        (source / "scripts" / "ci" / "wasm-artifact-manifest.py").write_text("", encoding="utf-8")
        args = module.parse_args(["--source-root", str(source), "--out", str(out), "--target", "riscv64"])
        command = module.docker_run_command(args)
        joined = "\n".join(command)
        for want in [
            "--target-list=riscv64-softmmu",
            "qemu-system-riscv64.js",
            "qemu-system-riscv64.wasm",
            "wasm-artifact-manifest-check.py --manifest qemu-system-wasm-artifacts.json --target riscv64",
        ]:
            assert want in joined, joined
        assert "--target-list=x86_64-softmmu" not in joined, joined


def test_default_out_dir_uses_source_tmp_target():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src"
        (source / "scripts" / "ci").mkdir(parents=True)
        (source / "configure").write_text("#!/bin/sh\n", encoding="utf-8")
        (source / "scripts" / "ci" / "wasm-artifact-manifest.py").write_text("", encoding="utf-8")
        args = module.parse_args(["--source-root", str(source), "--target", "riscv64"])
        command = module.docker_run_command(args)
        joined = "\n".join(command)
        expected = source.resolve() / "tmp" / "wasm-build-artifacts-riscv64"
        assert f"{expected}:/host-out" in joined, joined


def test_tcg_wasm64_backend_command_replaces_interpreter():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src"
        out = Path(tmp) / "out"
        (source / "scripts" / "ci").mkdir(parents=True)
        (source / "configure").write_text("#!/bin/sh\n", encoding="utf-8")
        (source / "scripts" / "ci" / "wasm-artifact-manifest.py").write_text("", encoding="utf-8")
        args = module.parse_args([
            "--source-root", str(source),
            "--out", str(out),
            "--target", "riscv64",
            "--tcg-wasm64-backend",
        ])
        command = module.docker_run_command(args)
        joined = "\n".join(command)
        assert "-Dtcg_wasm64_backend=true" in joined, joined
        assert "--enable-tcg-interpreter" not in joined, joined
        assert "--target-list=riscv64-softmmu" in joined, joined


def test_dry_run_includes_image_build():
    module = load_module()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "src"
        out = Path(tmp) / "out"
        (source / "scripts" / "ci").mkdir(parents=True)
        (source / "configure").write_text("#!/bin/sh\n", encoding="utf-8")
        (source / "scripts" / "ci" / "wasm-artifact-manifest.py").write_text("", encoding="utf-8")
        args = module.parse_args(["--source-root", str(source), "--out", str(out), "--build-image"])
        commands = [
            module.image_build_command(args.docker),
            module.docker_run_command(args),
        ]
        assert commands[0] == ["make", "-f", "Makefile", "docker-image-emsdk-wasm64-cross", "RUNC=docker", "V=1"]
        assert commands[1][0:2] == ["docker", "run"]


if __name__ == "__main__":
    test_default_docker_command()
    test_riscv64_docker_command()
    test_default_out_dir_uses_source_tmp_target()
    test_tcg_wasm64_backend_command_replaces_interpreter()
    test_dry_run_includes_image_build()
    print("wasm-build-artifacts-local-test: ok")
