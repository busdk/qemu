#!/usr/bin/env python3
#
# Build QEMU WebAssembly system-emulator artifacts with the local Docker image.
#
# SPDX-License-Identifier: GPL-2.0-or-later

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
import re


DEFAULT_IMAGE = "qemu/emsdk-wasm64-cross:latest"
DEFAULT_TARGET = "x86_64"
DEFAULT_CONFIGURE_ARGS = [
    "--disable-docs",
    "--static",
    "--cpu=wasm64",
    "--disable-tools",
    "--enable-sdl",
    "--extra-cflags=-sUSE_SDL=2",
    "--extra-ldflags=-sUSE_SDL=2",
]
DEFAULT_TCG_BACKEND_ARGS = ["--enable-tcg-interpreter"]
WASM64_TCG_BACKEND_ARGS = ["-Dtcg_wasm64_backend=true"]
TARGET_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]*$")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build qemu-system-TARGET.js/.wasm artifacts in the local wasm64 Emscripten Docker image.",
    )
    parser.add_argument("--source-root", type=Path, default=Path.cwd())
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--target", default=DEFAULT_TARGET, help="QEMU system target without -softmmu, for example x86_64 or riscv64")
    parser.add_argument("--image", default=DEFAULT_IMAGE)
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--jobs", default="auto")
    parser.add_argument(
        "--tcg-wasm64-backend",
        action="store_true",
        help="select the experimental wasm64 TCG backend instead of TCI",
    )
    parser.add_argument("--build-image", action="store_true", help="build qemu/emsdk-wasm64-cross first when it is missing")
    parser.add_argument("--no-clean", action="store_true", help="do not remove existing files from the output directory")
    parser.add_argument("--dry-run", action="store_true", help="print the commands that would run")
    parser.add_argument(
        "--configure-arg",
        action="append",
        default=[],
        help="extra configure argument appended after the default wasm64 CI arguments",
    )
    return parser.parse_args(argv)


def docker_image_exists(docker: str, image: str) -> bool:
    return subprocess.run(
        [docker, "image", "inspect", image],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    ).returncode == 0


def image_build_command(docker: str) -> list[str]:
    return ["make", "-f", "Makefile", "docker-image-emsdk-wasm64-cross", f"RUNC={docker}", "V=1"]


def shell_script(configure_args: list[str], jobs: str, clean: bool, target: str) -> str:
    quoted_configure = " ".join(shlex.quote(arg) for arg in configure_args)
    clean_line = 'rm -f /host-out/*' if clean else 'true'
    if jobs == "auto":
        make_jobs = '$(nproc)'
    else:
        make_jobs = shlex.quote(jobs)
    artifact_js = f"qemu-system-{target}.js"
    artifact_wasm = f"qemu-system-{target}.wasm"
    return f"""set -euo pipefail
rm -rf /tmp/src /tmp/build
mkdir -p /tmp/src /tmp/build /host-out
{clean_line}
tar -C /host-src --exclude=.git --exclude=build --exclude=build-wasm64-tci -cf - . | tar -C /tmp/src -xf -
cd /tmp/build
emconfigure /tmp/src/configure {quoted_configure}
make -j{make_jobs}
cp -v {shlex.quote(artifact_js)} {shlex.quote(artifact_wasm)} /host-out/
cd /host-out
python3 /tmp/src/scripts/ci/wasm-artifact-manifest.py --root . --output qemu-system-wasm-artifacts.json
python3 /tmp/src/scripts/ci/wasm-artifact-manifest-check.py --manifest qemu-system-wasm-artifacts.json --target {shlex.quote(target)}
sha256sum {shlex.quote(artifact_js)} {shlex.quote(artifact_wasm)} qemu-system-wasm-artifacts.json > SHA256SUMS
ls -lh
"""


def docker_run_command(args: argparse.Namespace) -> list[str]:
    source_root = args.source_root.resolve()
    out = args.out.resolve()
    tcg_backend_args = WASM64_TCG_BACKEND_ARGS if args.tcg_wasm64_backend else DEFAULT_TCG_BACKEND_ARGS
    configure_args = DEFAULT_CONFIGURE_ARGS + [
        *tcg_backend_args,
        f"--target-list={args.target}-softmmu",
    ] + list(args.configure_arg)
    return [
        args.docker,
        "run",
        "--rm",
        "-v",
        f"{source_root}:/host-src:ro",
        "-v",
        f"{out}:/host-out",
        "-w",
        "/tmp",
        args.image,
        "bash",
        "-lc",
        shell_script(configure_args, args.jobs, not args.no_clean, args.target),
    ]


def validate_inputs(args: argparse.Namespace) -> None:
    source_root = args.source_root.resolve()
    if not TARGET_RE.fullmatch(args.target):
        raise SystemExit(f"invalid QEMU system target: {args.target}")
    if not (source_root / "configure").is_file():
        raise SystemExit(f"QEMU source root is missing configure: {source_root}")
    if not (source_root / "scripts" / "ci" / "wasm-artifact-manifest.py").is_file():
        raise SystemExit(f"QEMU source root is missing wasm CI helpers: {source_root}")
    if shutil.which(args.docker) is None:
        raise SystemExit(f"Docker command not found: {args.docker}")
    args.out.mkdir(parents=True, exist_ok=True)


def run_command(command: list[str], cwd: Path, env=None) -> None:
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    validate_inputs(args)
    source_root = args.source_root.resolve()
    out = args.out.resolve()
    commands = []
    if args.build_image:
        commands.append({
            "name": "build-image",
            "argv": image_build_command(args.docker),
            "cwd": str(source_root),
        })
    commands.append({
        "name": "build-artifacts",
        "argv": docker_run_command(args),
        "cwd": str(source_root),
    })

    if args.dry_run:
        print(json.dumps({"commands": commands}, indent=2))
        return 0

    if not docker_image_exists(args.docker, args.image):
        if not args.build_image:
            raise SystemExit(
                f"Docker image {args.image} is missing; rerun with --build-image or build it with "
                "make -f Makefile docker-image-emsdk-wasm64-cross V=1"
            )
        env = dict(**os.environ, BUILDKIT_PROGRESS="plain")
        run_command(image_build_command(args.docker), source_root, env=env)

    run_command(docker_run_command(args), source_root)
    print(f"wrote QEMU WASM artifacts to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
