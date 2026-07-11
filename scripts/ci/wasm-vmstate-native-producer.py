#!/usr/bin/env python3
#
# SPDX-License-Identifier: GPL-2.0-or-later

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import time


QMP_MAX_LINE_BYTES = 1024 * 1024
POLL_INTERVAL_SECONDS = 0.1
REQUIRED_MIGRATION_PROPERTIES = (
    ("send-configuration", True),
    ("send-section-footer", True),
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Launch QEMU, wait for a readiness marker, and write a vmstate proof.",
    )
    parser.add_argument("--qemu", type=Path, required=True, help="QEMU binary to launch")
    parser.add_argument(
        "--qemu-arg",
        action="append",
        default=[],
        help="Exact QEMU argument. Repeat once per argv entry, in order.",
    )
    parser.add_argument("--serial-log", type=Path, required=True)
    parser.add_argument("--ready-marker", required=True, help="Opaque serial marker")
    parser.add_argument("--state-output", type=Path, required=True)
    parser.add_argument("--proof-output", type=Path, required=True)
    parser.add_argument("--qmp-log", type=Path, required=True)
    parser.add_argument("--qmp-socket", type=Path, required=True)
    parser.add_argument(
        "--startup-timeout-seconds",
        type=float,
        default=120.0,
        help="Timeout for the serial readiness marker",
    )
    parser.add_argument(
        "--migration-timeout-seconds",
        type=float,
        default=120.0,
        help="Timeout for migration completion",
    )
    args = parser.parse_args(normalize_qemu_arg_argv(argv))
    validate_args(args, parser)
    return args


def validate_args(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    if args.startup_timeout_seconds <= 0:
        parser.error("--startup-timeout-seconds must be greater than zero")
    if args.migration_timeout_seconds <= 0:
        parser.error("--migration-timeout-seconds must be greater than zero")
    if not args.ready_marker:
        parser.error("--ready-marker must not be empty")
    qmp_managed_flags = {"-qmp", "-serial"}
    conflicts = [arg for arg in args.qemu_arg if arg in qmp_managed_flags]
    if conflicts:
        parser.error(
            "caller qemu args must not include managed flags: " + ", ".join(sorted(set(conflicts)))
        )


def normalize_qemu_arg_argv(argv: list[str]) -> list[str]:
    normalized = []
    index = 0
    while index < len(argv):
        token = argv[index]
        if token == "--qemu-arg":
            if index + 1 >= len(argv):
                raise SystemExit("--qemu-arg requires a following value")
            normalized.append(f"--qemu-arg={argv[index + 1]}")
            index += 2
            continue
        normalized.append(token)
        index += 1
    return normalized


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def temporary_state_output(path: Path) -> Path:
    return path.with_name(path.name + ".tmp")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_proof(path: Path) -> dict[str, object]:
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def append_qmp_log(path: Path, payload: bytes) -> None:
    with path.open("ab") as handle:
        handle.write(payload)


class QmpSession:
    def __init__(self, stream, qmp_log: Path, max_line_bytes: int = QMP_MAX_LINE_BYTES):
        self.stream = stream
        self.qmp_log = qmp_log
        self.max_line_bytes = max_line_bytes

    def read_message(self) -> dict[str, object]:
        line = self.stream.readline(self.max_line_bytes + 1)
        if not line:
            raise RuntimeError("QMP closed unexpectedly")
        if len(line) > self.max_line_bytes:
            raise RuntimeError(f"QMP line exceeded {self.max_line_bytes} bytes")
        append_qmp_log(self.qmp_log, line)
        return json.loads(line)

    def command(self, name: str, arguments: dict[str, object] | None = None) -> dict[str, object]:
        request = {"execute": name}
        if arguments is not None:
            request["arguments"] = arguments
        payload = json.dumps(request, separators=(",", ":"), sort_keys=True).encode("utf-8") + b"\n"
        append_qmp_log(self.qmp_log, payload)
        self.stream.write(payload)
        self.stream.flush()
        while True:
            response = self.read_message()
            if "return" in response or "error" in response:
                return response


def wait_for_qmp_socket(path: Path, process, timeout_seconds: float, clock=time.monotonic, sleep=time.sleep) -> None:
    deadline = clock() + timeout_seconds
    while clock() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"QEMU exited before QMP socket was ready: {process.returncode}")
        if path.exists():
            return
        sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError(f"timed out waiting for QMP socket: {path}")


def wait_for_ready_marker(serial_log: Path, marker: bytes, process, timeout_seconds: float, clock=time.monotonic, sleep=time.sleep) -> None:
    deadline = clock() + timeout_seconds
    while clock() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"QEMU exited before ready marker: {process.returncode}")
        if serial_log.exists() and marker in serial_log.read_bytes():
            return
        sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError("timed out waiting for ready marker")


def require_qmp_success(response: dict[str, object], action: str) -> dict[str, object]:
    if "error" in response:
        raise RuntimeError(f"{action} failed: {response}")
    return response


def parse_on_off(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized == "on":
        return True
    if normalized == "off":
        return False
    raise RuntimeError(f"invalid migrate parameter state: {value!r}")


def query_migration_properties(qmp: QmpSession) -> dict[str, object]:
    response = require_qmp_success(
        qmp.command(
            "human-monitor-command",
            {"command-line": "info migrate -a"},
        ),
        "human-monitor-command info migrate -a",
    )
    raw = response.get("return")
    if not isinstance(raw, str):
        raise RuntimeError(f"invalid migrate parameter response: {response}")
    observed = {}
    in_globals = False
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped == "Globals:":
            in_globals = True
            continue
        if not stripped:
            continue
        if in_globals and not line[:1].isspace():
            in_globals = False
        if not in_globals or ":" not in line:
            continue
        name, value = line.split(":", 1)
        observed[name.strip()] = value.strip()
    missing = []
    validated = {}
    for name, expected in REQUIRED_MIGRATION_PROPERTIES:
        if name not in observed:
            missing.append({"property": name, "expected": expected, "actual": None})
            continue
        actual = parse_on_off(observed[name])
        if actual != expected:
            missing.append({"property": name, "expected": expected, "actual": actual})
            continue
        validated[name] = actual
    if missing:
        raise RuntimeError(f"required migration properties not active: {missing}")
    return {
        "source": "QMP human-monitor-command: info migrate -a",
        "raw": raw,
        "validated": validated,
    }


def open_qmp_session(qmp_socket: Path, qmp_log: Path) -> tuple[socket.socket, object, QmpSession, dict[str, object], dict[str, object]]:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(str(qmp_socket))
    stream = client.makefile("rwb", buffering=0)
    session = QmpSession(stream=stream, qmp_log=qmp_log)
    greeting = session.read_message()
    if "QMP" not in greeting:
        raise RuntimeError(f"invalid QMP greeting: {greeting}")
    capabilities = require_qmp_success(session.command("qmp_capabilities"), "qmp_capabilities")
    return client, stream, session, greeting, capabilities


def poll_migration_completion(qmp: QmpSession, timeout_seconds: float, clock=time.monotonic, sleep=time.sleep) -> dict[str, object]:
    deadline = clock() + timeout_seconds
    last = None
    while clock() < deadline:
        response = require_qmp_success(qmp.command("query-migrate"), "query-migrate")
        migration = response.get("return")
        if not isinstance(migration, dict):
            raise RuntimeError(f"invalid migration response: {response}")
        last = migration
        status = migration.get("status")
        if status == "completed":
            return migration
        if status in {"failed", "cancelled"}:
            raise RuntimeError(f"migration failed: {migration}")
        sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError(f"migration did not complete: {last}")


def build_command(args: argparse.Namespace) -> list[str]:
    return [
        str(args.qemu),
        *args.qemu_arg,
        "-serial",
        f"file:{args.serial_log}",
        "-qmp",
        f"unix:{args.qmp_socket},server=on,wait=off",
    ]


def run(argv: list[str]) -> int:
    args = parse_args(argv)
    temporary_state = temporary_state_output(args.state_output)
    for path in (args.serial_log, args.state_output, args.proof_output, args.qmp_log, args.qmp_socket):
        ensure_parent(path)
        path.unlink(missing_ok=True)
    ensure_parent(temporary_state)
    temporary_state.unlink(missing_ok=True)
    marker = args.ready_marker.encode("utf-8")
    command = build_command(args)
    startup_started = time.monotonic()
    process = subprocess.Popen(command)
    startup_completed = None
    migration_started = None
    migration_completed = None
    migration = None
    property_result = None
    qmp_greeting = None
    qmp_capabilities = None
    qmp_client = None
    qmp_stream = None
    try:
        wait_for_ready_marker(
            args.serial_log,
            marker,
            process,
            args.startup_timeout_seconds,
        )
        startup_completed = time.monotonic()
        wait_for_qmp_socket(
            args.qmp_socket,
            process,
            args.startup_timeout_seconds,
        )
        qmp_client, qmp_stream, qmp, qmp_greeting, qmp_capabilities = open_qmp_session(args.qmp_socket, args.qmp_log)
        property_result = query_migration_properties(qmp)
        migration_started = time.monotonic()
        require_qmp_success(
            qmp.command("migrate", {"uri": f"file:{temporary_state}"}),
            "migrate",
        )
        migration = poll_migration_completion(qmp, args.migration_timeout_seconds)
        migration_completed = time.monotonic()
        temporary_state.replace(args.state_output)
    finally:
        if qmp_stream is not None:
            qmp_stream.close()
        if qmp_client is not None:
            qmp_client.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        if not args.state_output.exists():
            temporary_state.unlink(missing_ok=True)
    proof = {
        "format": "qemu-wasm-native-vmstate-proof-v2",
        "success": True,
        "command": command,
        "readyMarker": args.ready_marker,
        "qmpGreeting": qmp_greeting,
        "qmpCapabilities": qmp_capabilities,
        "migrationProperties": property_result,
        "timings": {
            "startupSeconds": None if startup_completed is None else startup_completed - startup_started,
            "migrationSeconds": None if migration_completed is None or migration_started is None else migration_completed - migration_started,
        },
        "migration": migration,
        "artifacts": {
            "qemu": file_proof(args.qemu),
            "state": file_proof(args.state_output),
            "serialLog": file_proof(args.serial_log),
        },
    }
    args.proof_output.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    return 0


def main() -> int:
    return run(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
