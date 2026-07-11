#!/usr/bin/env python3
#
# SPDX-License-Identifier: GPL-2.0-or-later

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("wasm-vmstate-native-producer.py")


def load_module():
    spec = importlib.util.spec_from_file_location("wasm_vmstate_native_producer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class FakeProcess:
    def __init__(self, serial_path: Path, qmp_socket_path: Path, marker: bytes) -> None:
        self.serial_path = serial_path
        self.qmp_socket_path = qmp_socket_path
        self.marker = marker
        self.returncode = None
        self.terminated = False
        self.killed = False
        self.wait_timeout = None

    def poll(self):
        if not self.serial_path.exists():
            self.serial_path.write_bytes(b"boot\n" + self.marker + b"\n")
        if not self.qmp_socket_path.exists():
            self.qmp_socket_path.write_text("socket\n", encoding="utf-8")
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True

    def wait(self, timeout=None):
        self.wait_timeout = timeout
        self.returncode = 0
        return 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


class FakeSocketFile:
    def __init__(self, responses: list[dict[str, object]], on_write=None) -> None:
        self._responses = [
            json.dumps(response, separators=(",", ":"), sort_keys=True).encode("utf-8") + b"\n"
            for response in responses
        ]
        self.writes: list[bytes] = []
        self.closed = False
        self.on_write = on_write

    def readline(self, limit: int = -1) -> bytes:
        if not self._responses:
            return b""
        line = self._responses.pop(0)
        if limit >= 0:
            return line[:limit]
        return line

    def write(self, payload: bytes) -> int:
        self.writes.append(payload)
        if self.on_write is not None:
            self.on_write(payload)
        return len(payload)

    def flush(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True


class FakeSocket:
    def __init__(self, stream: FakeSocketFile) -> None:
        self.stream = stream
        self.connected = None
        self.closed = False

    def connect(self, address: str) -> None:
        self.connected = address

    def makefile(self, mode: str, buffering: int = 0):
        return self.stream

    def close(self) -> None:
        self.closed = True


class WasmVmstateNativeProducerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_parse_args_rejects_non_positive_timeout(self) -> None:
        with self.assertRaises(SystemExit):
            self.module.parse_args([
                "--qemu", "/qemu",
                "--serial-log", "/tmp/serial.log",
                "--ready-marker", "READY",
                "--state-output", "/tmp/state",
                "--proof-output", "/tmp/proof.json",
                "--qmp-log", "/tmp/qmp.log",
                "--qmp-socket", "/tmp/qmp.sock",
                "--startup-timeout-seconds", "0",
            ])

    def test_parse_args_rejects_managed_qemu_flags(self) -> None:
        with self.assertRaises(SystemExit):
            self.module.parse_args([
                "--qemu", "/qemu",
                "--qemu-arg=-serial",
                "--serial-log", "/tmp/serial.log",
                "--ready-marker", "READY",
                "--state-output", "/tmp/state",
                "--proof-output", "/tmp/proof.json",
                "--qmp-log", "/tmp/qmp.log",
                "--qmp-socket", "/tmp/qmp.sock",
            ])

    def test_qmp_command_writes_request_and_reads_response(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            qmp_log = Path(tmp) / "qmp.log"
            stream = FakeSocketFile([
                {"event": "BLOCK_JOB_READY"},
                {"return": {"status": "ok"}},
            ])
            session = self.module.QmpSession(stream=stream, qmp_log=qmp_log, max_line_bytes=256)
            response = session.command("query-status")
            self.assertEqual(response, {"return": {"status": "ok"}})
            self.assertEqual(stream.writes, [b'{"execute":"query-status"}\n'])
            log_lines = qmp_log.read_text(encoding="utf-8").splitlines()
            self.assertEqual(log_lines[0], '{"execute":"query-status"}')
            self.assertEqual(log_lines[1], '{"event":"BLOCK_JOB_READY"}')
            self.assertEqual(log_lines[2], '{"return":{"status":"ok"}}')

    def test_query_migration_properties_requires_expected_values(self) -> None:
        qmp = types.SimpleNamespace()
        qmp.command = mock.Mock(side_effect=[
            {"return": "Migration status: setup\nGlobals:\n  send-configuration: on\n  send-section-footer: off\nCapabilities:\n  xbzrle: off\n"},
        ])
        with self.assertRaisesRegex(RuntimeError, "required migration properties not active"):
            self.module.query_migration_properties(qmp)

    def test_run_writes_proof_and_uses_file_migration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            qemu = root / "qemu"
            state = root / "state.vmstate"
            temporary_state = root / "state.vmstate.tmp"
            serial = root / "serial.log"
            proof = root / "proof.json"
            qmp_log = root / "qmp.log"
            qmp_socket = root / "qmp.sock"
            qemu.write_bytes(b"qemu-binary")
            clock = FakeClock()
            def on_write(payload: bytes) -> None:
                request = json.loads(payload.decode("utf-8"))
                if request.get("execute") == "migrate":
                    temporary_state.write_bytes(b"vmstate")
            responses = [
                {"QMP": {"version": {"qemu": {"major": 9}}}},
                {"return": {}},
                {"return": "Migration status: setup\nGlobals:\n  send-configuration: on\n  send-section-footer: on\nParameters:\n  xbzrle-cache-size: 67108864\n"},
                {"return": {}},
                {"return": {"status": "active"}},
                {"return": {"status": "completed", "total-time": 17}},
            ]
            fake_stream = FakeSocketFile(responses, on_write=on_write)
            fake_socket = FakeSocket(fake_stream)
            fake_process = FakeProcess(serial, qmp_socket, b"READY")
            argv = [
                "--qemu", str(qemu),
                "--qemu-arg", "-M",
                "--qemu-arg", "virt",
                "--serial-log", str(serial),
                "--ready-marker", "READY",
                "--state-output", str(state),
                "--proof-output", str(proof),
                "--qmp-log", str(qmp_log),
                "--qmp-socket", str(qmp_socket),
                "--startup-timeout-seconds", "5",
                "--migration-timeout-seconds", "5",
            ]
            with mock.patch.object(self.module.subprocess, "Popen", return_value=fake_process) as popen:
                with mock.patch.object(self.module.socket, "socket", return_value=fake_socket):
                    with mock.patch.object(self.module.time, "monotonic", side_effect=clock.monotonic):
                        with mock.patch.object(self.module.time, "sleep", side_effect=clock.sleep):
                            rc = self.module.run(argv)
            self.assertEqual(rc, 0)
            popen.assert_called_once()
            launched = popen.call_args.args[0]
            self.assertEqual(launched[0:3], [str(qemu), "-M", "virt"])
            self.assertEqual(launched[-4:], [
                "-serial", f"file:{serial}",
                "-qmp", f"unix:{qmp_socket},server=on,wait=off",
            ])
            requests = [json.loads(item.decode("utf-8")) for item in fake_stream.writes]
            self.assertEqual(requests[0], {"execute": "qmp_capabilities"})
            self.assertEqual(requests[1], {
                "execute": "human-monitor-command",
                "arguments": {
                    "command-line": "info migrate -a",
                },
            })
            self.assertEqual(requests[2], {
                "execute": "migrate",
                "arguments": {"uri": f"file:{temporary_state}"},
            })
            self.assertEqual(requests[3], {"execute": "query-migrate"})
            self.assertEqual(requests[4], {"execute": "query-migrate"})
            payload = json.loads(proof.read_text(encoding="utf-8"))
            self.assertTrue(payload["success"])
            self.assertEqual(payload["format"], "qemu-wasm-native-vmstate-proof-v2")
            self.assertEqual(payload["readyMarker"], "READY")
            self.assertEqual(payload["qmpCapabilities"], {"return": {}})
            self.assertEqual(payload["migration"]["status"], "completed")
            self.assertEqual(payload["migrationProperties"]["validated"], {
                "send-configuration": True,
                "send-section-footer": True,
            })
            self.assertIn("send-configuration: on", payload["migrationProperties"]["raw"])
            self.assertEqual(payload["command"], launched)
            self.assertEqual(payload["artifacts"]["qemu"]["bytes"], len(b"qemu-binary"))
            self.assertEqual(payload["artifacts"]["state"]["bytes"], len(b"vmstate"))
            self.assertEqual(payload["artifacts"]["serialLog"]["bytes"], serial.stat().st_size)
            self.assertFalse(temporary_state.exists())
            self.assertIsInstance(payload["timings"]["startupSeconds"], float)
            self.assertIsInstance(payload["timings"]["migrationSeconds"], float)
            self.assertTrue(fake_process.terminated)
            self.assertEqual(fake_process.wait_timeout, 5)
            self.assertTrue(fake_socket.closed)
            self.assertTrue(fake_stream.closed)

    def test_run_fails_when_qmp_greeting_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            qemu = root / "qemu"
            qemu.write_bytes(b"qemu-binary")
            state = root / "state.vmstate"
            state.write_bytes(b"vmstate")
            serial = root / "serial.log"
            proof = root / "proof.json"
            qmp_log = root / "qmp.log"
            qmp_socket = root / "qmp.sock"
            fake_process = FakeProcess(serial, qmp_socket, b"READY")
            fake_stream = FakeSocketFile([{"return": {}}])
            fake_socket = FakeSocket(fake_stream)
            clock = FakeClock()
            argv = [
                "--qemu", str(qemu),
                "--serial-log", str(serial),
                "--ready-marker", "READY",
                "--state-output", str(state),
                "--proof-output", str(proof),
                "--qmp-log", str(qmp_log),
                "--qmp-socket", str(qmp_socket),
            ]
            with mock.patch.object(self.module.subprocess, "Popen", return_value=fake_process):
                with mock.patch.object(self.module.socket, "socket", return_value=fake_socket):
                    with mock.patch.object(self.module.time, "monotonic", side_effect=clock.monotonic):
                        with mock.patch.object(self.module.time, "sleep", side_effect=clock.sleep):
                            with self.assertRaisesRegex(RuntimeError, "invalid QMP greeting"):
                                self.module.run(argv)
            self.assertFalse(proof.exists())
            self.assertTrue(fake_process.terminated)

    def test_run_removes_final_and_partial_state_on_cancelled_migration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            qemu = root / "qemu"
            qemu.write_bytes(b"qemu-binary")
            state = root / "state.vmstate"
            temporary_state = root / "state.vmstate.tmp"
            state.write_bytes(b"stale-final")
            temporary_state.write_bytes(b"stale-temp")
            serial = root / "serial.log"
            proof = root / "proof.json"
            qmp_log = root / "qmp.log"
            qmp_socket = root / "qmp.sock"
            clock = FakeClock()

            def on_write(payload: bytes) -> None:
                request = json.loads(payload.decode("utf-8"))
                if request.get("execute") == "migrate":
                    temporary_state.write_bytes(b"partial-temp")

            responses = [
                {"QMP": {"version": {"qemu": {"major": 9}}}},
                {"return": {}},
                {"return": "Migration status: setup\nGlobals:\n  send-configuration: on\n  send-section-footer: on\n"},
                {"return": {}},
                {"return": {"status": "cancelled"}},
            ]
            fake_stream = FakeSocketFile(responses, on_write=on_write)
            fake_socket = FakeSocket(fake_stream)
            fake_process = FakeProcess(serial, qmp_socket, b"READY")
            argv = [
                "--qemu", str(qemu),
                "--serial-log", str(serial),
                "--ready-marker", "READY",
                "--state-output", str(state),
                "--proof-output", str(proof),
                "--qmp-log", str(qmp_log),
                "--qmp-socket", str(qmp_socket),
            ]
            with mock.patch.object(self.module.subprocess, "Popen", return_value=fake_process):
                with mock.patch.object(self.module.socket, "socket", return_value=fake_socket):
                    with mock.patch.object(self.module.time, "monotonic", side_effect=clock.monotonic):
                        with mock.patch.object(self.module.time, "sleep", side_effect=clock.sleep):
                            with self.assertRaisesRegex(RuntimeError, "migration failed"):
                                self.module.run(argv)
            self.assertFalse(state.exists())
            self.assertFalse(temporary_state.exists())
            self.assertFalse(proof.exists())


if __name__ == "__main__":
    unittest.main()
