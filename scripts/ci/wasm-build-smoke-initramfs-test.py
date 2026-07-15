#!/usr/bin/env python3
#
# Test the deterministic WASM smoke initramfs builder.
#
# SPDX-License-Identifier: GPL-2.0-or-later

import gzip
import json
import os
import runpy
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
from pathlib import Path


ROOT = Path(os.environ.get(
    "QEMU_TEST_ROOT",
    Path(__file__).resolve().parents[2],
))
SCRIPT = ROOT / "scripts/ci/wasm-build-smoke-initramfs.py"
SCRIPT_GLOBALS = runpy.run_path(str(SCRIPT))
SERVICE_REQUEST_AWK = SCRIPT_GLOBALS["SERVICE_REQUEST_AWK"]
SHELL_QUOTE = SCRIPT_GLOBALS["shell_quote"]


def align4(value):
    return (value + 3) & ~3


def parse_newc(path):
    entries = {}
    with gzip.open(path, "rb") as stream:
        data = stream.read()
    offset = 0
    while True:
        header = data[offset:offset + 110]
        if len(header) != 110:
            raise AssertionError("truncated cpio header")
        offset += 110
        if header[:6] != b"070701":
            raise AssertionError(f"bad cpio magic at offset {offset - 110}")
        fields = [
            int(header[start:start + 8], 16)
            for start in range(6, 110, 8)
        ]
        mode = fields[1]
        filesize = fields[6]
        rdev_major = fields[9]
        rdev_minor = fields[10]
        namesize = fields[11]
        name_data = data[offset:offset + namesize]
        offset += namesize
        offset = align4(offset)
        name = name_data.rstrip(b"\0").decode("utf-8")
        file_data = data[offset:offset + filesize]
        offset += filesize
        offset = align4(offset)
        if name == "TRAILER!!!":
            break
        entries[name] = {
            "mode": mode,
            "data": file_data,
            "rdev_major": rdev_major,
            "rdev_minor": rdev_minor,
        }
    return entries


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def parse_service_request(line):
    busybox = shutil.which("busybox")
    assert_true(busybox is not None, "BusyBox is required for parser checks")
    translated = subprocess.run(
        [busybox, "tr", r"\000", r"\030"],
        input=line,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    assert_true(translated.returncode == 0,
                f"BusyBox tr failed: {translated.stderr!r}")
    return subprocess.run(
        [busybox, "awk", SERVICE_REQUEST_AWK],
        input=translated.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def check_shell_syntax(script):
    busybox = shutil.which("busybox")
    if busybox:
        command = [busybox, "sh", "-n"]
    else:
        command = [shutil.which("sh"), "-n"]
    assert_true(command[0] is not None, "a shell is required for syntax checks")
    return subprocess.run(
        command,
        input=script,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def shell_bytes(value):
    return SHELL_QUOTE(value).encode("utf-8")


def octal_bytes(value):
    return "".join(f"\\{byte:03o}" for byte in value)


def run_generated_service_shell_details(
    init,
    request_data,
    *,
    request_fifo=False,
    producer_output=None,
    producer_status=0,
    normalizer_status=None,
    timeout=5,
):
    busybox = shutil.which("busybox")
    assert_true(busybox is not None,
                "BusyBox is required for generated service shell checks")
    start_marker = b"say 'QEMU_WASM_SERVICE_READY'\n\n"
    end_marker = b"\npoweroff -f 2>/dev/null"
    start = init.index(start_marker)
    end = init.index(end_marker, start)
    service_shell = init[start:end]

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        request = root / "request"
        response = root / "response"
        script = root / "service-shell"
        wrapper = root / "busybox-wrapper"
        normalizer_pid_file = root / "normalizer.pid"
        wrapper.write_text(
            "#!/bin/sh\n"
            "if [ \"$1\" = tr ] && "
            "[ -n \"$QEMU_WASM_NORMALIZER_PID_FILE\" ]; then\n"
            "    printf '%s\\n' \"$$\" > "
            "\"$QEMU_WASM_NORMALIZER_PID_FILE\"\n"
            "fi\n"
            f"exec {SHELL_QUOTE(busybox)} \"$@\"\n",
            encoding="utf-8",
        )
        wrapper.chmod(0o755)
        wrapper_bytes = str(wrapper).encode("utf-8")
        service_shell = service_shell.replace(b"/bin/busybox", wrapper_bytes)

        awk_command = (
            b"LC_ALL=C " + wrapper_bytes + b" awk " +
            shell_bytes(SERVICE_REQUEST_AWK)
        )
        if producer_output is not None:
            producer_script = (
                f"printf '%b' {SHELL_QUOTE(octal_bytes(producer_output))}; "
                f"exit {producer_status}"
            )
            injected_producer = (
                wrapper_bytes + b" sh -c " + shell_bytes(producer_script)
            )
            assert_true(service_shell.count(awk_command) == 1,
                        "generated shell should contain one AWK producer")
            service_shell = service_shell.replace(
                awk_command, injected_producer, 1
            )

        tr_command = (
            b"LC_ALL=C " + wrapper_bytes + b" tr '\\000' '\\030'"
        )
        if normalizer_status is not None:
            injected_normalizer = (
                wrapper_bytes + b" sh -c " +
                shell_bytes(f"exit {normalizer_status}")
            )
            assert_true(service_shell.count(tr_command) == 1,
                        "generated shell should contain one normalizer")
            service_shell = service_shell.replace(
                tr_command, injected_normalizer, 1
            )

        runner = (
            b"#!/bin/sh\n"
            b"request=$1\n"
            b"response=$2\n"
            b"say() { printf '%s\\n' \"$1\"; }\n\n" +
            service_shell + b"\n"
        )

        if request_fifo:
            os.mkfifo(request)
        else:
            request.write_bytes(request_data)
        response.write_bytes(b"")
        script.write_bytes(runner)
        environment = os.environ.copy()
        environment["TMPDIR"] = str(root / "private")
        environment["QEMU_WASM_NORMALIZER_PID_FILE"] = str(
            normalizer_pid_file
        )
        process = subprocess.Popen(
            [busybox, "sh", str(script), str(request), str(response)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            start_new_session=True,
        )

        writer_open = threading.Event()
        release_writer = threading.Event()
        writer_errors = []
        writer = None
        if request_fifo:
            def write_request():
                try:
                    with request.open("wb", buffering=0) as stream:
                        stream.write(request_data)
                        writer_open.set()
                        release_writer.wait(timeout + 2)
                except OSError as error:
                    writer_errors.append(error)

            writer = threading.Thread(target=write_request, daemon=True)
            writer.start()

        timed_out = False
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=2)

        normalizer_pid = None
        normalizer_reaped = None
        if normalizer_pid_file.exists():
            normalizer_pid_text = normalizer_pid_file.read_text().strip()
            normalizer_pid = (
                int(normalizer_pid_text) if normalizer_pid_text else None
            )
        if normalizer_pid is not None:
            try:
                os.kill(normalizer_pid, 0)
            except ProcessLookupError:
                normalizer_reaped = True
            else:
                normalizer_reaped = False

        writer_was_open = writer_open.is_set() and not release_writer.is_set()
        private_root = root / "private"
        private_paths = (
            list(private_root.rglob("*")) if private_root.exists() else []
        )
        release_writer.set()
        if writer is not None:
            writer.join(timeout=2)
            assert_true(not writer.is_alive(), "FIFO writer should terminate")
        assert_true(not writer_errors,
                    f"FIFO writer failed: {writer_errors!r}")
        assert_true(not timed_out,
                    "generated service shell exceeded its bounded timeout")
        assert_true(not private_paths,
                    f"generated shell leaked private paths: {private_paths!r}")

        result = subprocess.CompletedProcess(
            process.args, process.returncode, stdout, stderr
        )
        details = {
            "normalizer_pid": normalizer_pid,
            "normalizer_reaped": normalizer_reaped,
            "writer_was_open": writer_was_open,
            "private_paths": private_paths,
        }
        return result, response.read_bytes(), details


def run_generated_service_shell(init, request_data, **kwargs):
    result, response, _ = run_generated_service_shell_details(
        init, request_data, **kwargs
    )
    return result, response


def test_display_input_smoke_initramfs():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        busybox = root / "busybox"
        helper = root / "input-helper"
        output = root / "initramfs.cpio.gz"
        busybox.write_bytes(b"busybox")
        helper.write_bytes(b"helper")
        busybox.chmod(0o755)
        helper.chmod(0o755)

        subprocess.run([
            sys.executable,
            str(SCRIPT),
            "--busybox",
            str(busybox),
            "--output",
            str(output),
            "--display-input-smoke",
            "--input-helper",
            str(helper),
            "--input-text",
            "ab",
        ], check=True)

        entries = parse_newc(output)
        init = entries["init"]["data"]
        assert_true(b"QEMU_WASM_LINUX_INPUT_READY" in init,
                    "display input init should print the input ready marker")
        assert_true(b"read -r input < /dev/tty1" in init,
                    "display input init should fall back to the first virtual terminal")
        assert_true(b"QEMU WASM DISPLAY INPUT OK" in init,
                    "display input init should draw the visual marker")
        assert_true(b"/bin/wasm-display-input-helper" in init,
                    "display input init should run the input-event helper")
        assert_true(b"/dev/input " in init,
                    "display input init should let the helper scan input events")
        assert_true(b"'QEMU_WASM_LINUX_INPUT_READY' > \"$serial\"" in init,
                    "input helper should emit readiness after opening input fds")
        assert_true(b"input_ready=1" in init,
                    "display input init should not emit fallback readiness after helper use")
        assert_true(entries["bin/wasm-display-input-helper"]["data"] == b"helper",
                    "input helper should be copied into the initramfs")
        assert_true(stat.S_ISDIR(entries["dev/input"]["mode"]),
                    "dev/input should be a directory")
        assert_true(stat.S_ISCHR(entries["dev/tty0"]["mode"]),
                    "dev/tty0 should be a character device")
        assert_true(entries["dev/tty0"]["rdev_major"] == 4,
                    "dev/tty0 major should be 4")
        assert_true(entries["dev/tty0"]["rdev_minor"] == 0,
                    "dev/tty0 minor should be 0")
        assert_true(stat.S_ISCHR(entries["dev/tty1"]["mode"]),
                    "dev/tty1 should be a character device")
        assert_true(entries["dev/tty1"]["rdev_major"] == 4,
                    "dev/tty1 major should be 4")
        assert_true(entries["dev/tty1"]["rdev_minor"] == 1,
                    "dev/tty1 minor should be 1")
        assert_true(stat.S_ISCHR(entries["dev/ttyS0"]["mode"]),
                    "dev/ttyS0 should be a character device")
        assert_true(entries["dev/ttyS0"]["rdev_major"] == 4,
                    "dev/ttyS0 major should be 4")
        assert_true(entries["dev/ttyS0"]["rdev_minor"] == 64,
                    "dev/ttyS0 minor should be 64")
        assert_true(stat.S_ISCHR(entries["dev/input/event0"]["mode"]),
                    "dev/input/event0 should be a character device")
        assert_true(entries["dev/input/event0"]["rdev_major"] == 13,
                    "dev/input/event0 major should be 13")
        assert_true(entries["dev/input/event0"]["rdev_minor"] == 64,
                    "dev/input/event0 minor should be 64")
        assert_true(stat.S_ISCHR(entries["dev/input/event31"]["mode"]),
                    "dev/input/event31 should be a character device")
        assert_true(entries["dev/input/event31"]["rdev_major"] == 13,
                    "dev/input/event31 major should be 13")
        assert_true(entries["dev/input/event31"]["rdev_minor"] == 95,
                    "dev/input/event31 minor should be 95")


def test_service_bridge_smoke_initramfs():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        busybox = root / "busybox"
        output = root / "service-initramfs.cpio.gz"
        busybox.write_bytes(b"busybox")
        busybox.chmod(0o755)

        subprocess.run([
            sys.executable,
            str(SCRIPT),
            "--busybox",
            str(busybox),
            "--output",
            str(output),
            "--service-bridge-smoke",
        ], check=True)

        entries = parse_newc(output)
        init = entries["init"]["data"]
        syntax = check_shell_syntax(init)
        assert_true(syntax.returncode == 0,
                    f"service bridge init syntax failed: {syntax.stderr!r}")
        assert_true(b"/dev/virtio-ports/org.qemu.wasm.service.request" in init,
                    "service bridge init should use the default request port")
        assert_true(b"/dev/virtio-ports/org.qemu.wasm.service.response" in init,
                    "service bridge init should use the default response port")
        assert_true(b"QEMU_WASM_SERVICE_READY" in init,
                    "service bridge init should print readiness marker")
        assert_true(b"QEMU_WASM_SERVICE_PORTS_MISSING" in init,
                    "service bridge init should diagnose missing virtio ports")
        assert_true(
            b'^[ \\t\\r]*[{][ \\t\\r]*"operation"' in init,
            "service bridge init should anchor the operation field",
        )
        assert_true(b'[ \\t\\r]*' in init,
                    "service bridge init should allow only JSON whitespace")
        assert_true(b'[[:space:]]' not in init,
                    "service bridge init must not admit non-JSON whitespace")
        assert_true(b'"id"' in init and b'[A-Za-z0-9._:-]*' in init,
                    "service bridge init should validate the request id")
        assert_true(
            b'/bin/busybox sed -n' not in init,
            "service bridge init must not use unanchored field extraction",
        )
        assert_true(b'index($0, sprintf("%c", 24))' in init,
                    "service bridge init should reject a raw CAN byte")
        assert_true(
            b'length($0) > 4095' in init,
            "service bridge init should bound the complete request line",
        )
        assert_true(b'RT != "\\n"' in init,
                    "service bridge init should require newline framing")
        assert_true(b'QEMU_WASM_SERVICE_MALFORMED_REQUEST' in init,
                    "service bridge init should diagnose malformed requests")
        assert_true(
            b'continue' in init,
            "service bridge init should accept a request after a malformed line",
        )
        assert_true(
            b"LC_ALL=C /bin/busybox tr '\\000' '\\030'" in init and
            b'< "$request" > "$normalized" 3>&- &' in init,
            "service bridge init should map NUL to CAN before AWK framing",
        )
        assert_true(
            b'/bin/busybox mkfifo "$normalized" "$tags"' in init,
            "service bridge init should use private framing FIFOs",
        )
        assert_true(
            b'while IFS= read -r record' in init,
            "service bridge shell should consume only tagged parser output",
        )
        assert_true(b'done < "$tags"' in init,
                    "tag consumption must not use a foreground pipeline")
        assert_true(b'wait "$normalizer_pid"' in init,
                    "service bridge init should reap its normalizer")
        assert_true(b'/bin/busybox rm -f "$normalized" "$tags"' in init,
                    "service bridge init should clean its private FIFOs")
        assert_true(b'IFS= read -r line' not in init,
                    "service bridge shell must not read raw request bytes")
        assert_true(b'printf \'%s\\n\' "$line"' not in init,
                    "service bridge shell must not store raw request bytes")
        assert_true(b'set -- $parsed' not in init,
                    "service bridge shell must not split "
                    "attacker-controlled bytes")
        assert_true(
            b'case "$record" in' in init and
            b'if [ "$operation" = health ]; then' in init,
            "service bridge init should execute only the health operation",
        )
        assert_true(b'{"id":"%s","status":"ok","operation":"health"}' in init,
                    "service bridge init should return a health response")
        assert_true(b"QEMU_WASM_LINUX_BOOT_OK" in init,
                    "service bridge init should print the success marker")

    request = (
        b'{"operation":"health","id":"qemu-wasm-service-65",'
        b'"deadlineMs":0}\n'
    )
    subsequent = (
        b'{"operation":"health","id":"qemu-wasm-service-66",'
        b'"deadlineMs":9999999999999}\n'
    )
    valid = parse_service_request(request)
    assert_true(valid.returncode == 0, "compact bounded JSON should parse")
    assert_true(valid.stdout == b"V\tqemu-wasm-service-65\thealth\n",
                "the parser should tag the validated id and operation")

    accepted_requests = [
        (
            "JSON whitespace",
            b' \t{\r "operation"\t:\r"health" \t,\r "id" : '
            b'"qemu-wasm-service-65" , "deadlineMs" : 42 \r}\t ' + b'\n',
        ),
        (
            "CRLF framing",
            b'{"operation":"health","id":"qemu-wasm-service-65",'
            b'"deadlineMs":9999999999999}\r\n',
        ),
    ]
    for description, accepted in accepted_requests:
        parsed = parse_service_request(accepted)
        assert_true(parsed.returncode == 0,
                    f"{description} should parse")
        assert_true(parsed.stdout == b"V\tqemu-wasm-service-65\thealth\n",
                    f"{description} should preserve validated extraction")

    for cut in (len(request) - 1, 1, len(request) // 2):
        canceled = request[:cut] + b"\x18\n"
        assert_true(canceled != request,
                    "canceled bytes must not recreate the original request")
        assert_true(canceled.count(b"\n") == 1,
                    "the canceled line should contain one terminator")
        try:
            json.loads(canceled[:-1])
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        else:
            raise AssertionError(
                "a canceled line must not strict-parse as JSON"
            )
        parsed = parse_service_request(canceled)
        assert_true(parsed.returncode == 0,
                    "the guest parser must reject CAN at every tested cut")
        assert_true(parsed.stdout == b"M\nE\n",
                    "a canceled record should emit only malformed and end tags")

    valid = parse_service_request(subsequent)
    assert_true(valid.returncode == 0,
                "a subsequent canonical request should succeed")
    assert_true(valid.stdout == b"V\tqemu-wasm-service-66\thealth\n",
                "the subsequent request should preserve its identity")
    valid_object = (
        b'{"operation":"health","id":"qemu-wasm-service-67",'
        b'"deadlineMs":1}'
    )
    unterminated = parse_service_request(valid_object)
    assert_true(unterminated.returncode == 0,
                "an unterminated request should be diagnosed")
    assert_true(unterminated.stdout == b"M\nE\n",
                "an unterminated request must not execute")
    malformed_then_unterminated = parse_service_request(
        b"not-json\n" + valid_object
    )
    assert_true(malformed_then_unterminated.returncode == 0,
                "mixed unterminated input should be diagnosed")
    assert_true(malformed_then_unterminated.stdout == b"M\nM\nE\n",
                "an unterminated valid tail must remain malformed")
    rejected_requests = [
        (
            "leading-zero deadline",
            b'{"operation":"health","id":"qemu-wasm-service-67",'
            b'"deadlineMs":01}\n',
        ),
        ("vertical tab", b'{\x0b"operation":"health","id":"x",'
                         b'"deadlineMs":1}\n'),
        ("form feed", b'{\x0c"operation":"health","id":"x",'
                       b'"deadlineMs":1}\n'),
        (
            "duplicate key",
            b'{"operation":"health","id":"x","id":"y",'
            b'"deadlineMs":1}\n',
        ),
        (
            "escaped value",
            b'{"operation":"he\\u0061lth","id":"x",'
            b'"deadlineMs":1}\n',
        ),
        (
            "extra field",
            b'{"operation":"health","id":"x","deadlineMs":1,'
            b'"extra":0}\n',
        ),
        (
            "operation metacharacters",
            b'{"operation":"health;poweroff","id":"x",'
            b'"deadlineMs":1}\n',
        ),
        (
            "identifier metacharacters",
            b'{"operation":"health","id":"x$(poweroff)",'
            b'"deadlineMs":1}\n',
        ),
        ("raw CAN sentinel", valid_object + b'\x18\n'),
        ("valid-object substring", b'garbage ' + valid_object + b' tail\n'),
        ("prefix garbage", b'garbage ' + valid_object + b'\n'),
        ("suffix garbage", valid_object + b' garbage\n'),
    ]
    for description, rejected in rejected_requests:
        parsed = parse_service_request(rejected)
        assert_true(parsed.returncode == 0,
                    f"{description} must not pass the whole-object parser")
        assert_true(parsed.stdout == b"M\nE\n",
                    f"{description} must emit only closed rejection tags")

    overlong_id = (
        b'{"operation":"health","id":"' + (b"a" * 129) +
        b'","deadlineMs":9999999999999}\n'
    )
    overlong = parse_service_request(overlong_id)
    assert_true(overlong.returncode == 0 and overlong.stdout == b"M\nE\n",
                "the validated request identity should remain bounded")

    clean_shell_requests = [
        (
            "compact",
            b'{"operation":"health","id":"clean-compact",'
            b'"deadlineMs":0}\n',
            "clean-compact",
        ),
        (
            "JSON whitespace",
            b' \t{\r "operation"\t:\r"health" \t,\r "id" : '
            b'"clean-whitespace" , "deadlineMs" : 42 \r}\t ' + b'\n',
            "clean-whitespace",
        ),
        (
            "CRLF framing",
            b'{"operation":"health","id":"clean-crlf",'
            b'"deadlineMs":1}\r\n',
            "clean-crlf",
        ),
    ]
    for description, clean_request, request_id in clean_shell_requests:
        result, response = run_generated_service_shell(init, clean_request)
        assert_true(result.returncode == 0,
                    f"generated shell {description} request should run")
        expected = (
            f'{{"id":"{request_id}","status":"ok",'
            f'"operation":"health"}}\n'
        ).encode("ascii")
        assert_true(response == expected,
                    f"generated shell {description} response should match")
        assert_true(
            result.stdout ==
            b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_LINUX_BOOT_OK\n",
            f"generated shell {description} markers should be preserved",
        )

    persistent_request = (
        b'{"operation":"health","id":"persistent-fifo",'
        b'"deadlineMs":1}\n'
    )
    result, response, details = run_generated_service_shell_details(
        init,
        persistent_request,
        request_fifo=True,
        timeout=3,
    )
    assert_true(result.returncode == 0,
                "persistent FIFO request should complete")
    assert_true(
        response ==
        b'{"id":"persistent-fifo","status":"ok",'
        b'"operation":"health"}\n',
        "persistent FIFO request should receive its response",
    )
    assert_true(
        result.stdout ==
        b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_LINUX_BOOT_OK\n",
        "persistent FIFO request should emit the success marker",
    )
    assert_true(details["writer_was_open"],
                "FIFO writer must still be open when the shell completes")
    assert_true(details["normalizer_pid"] is not None,
                "persistent probe should record the normalizer pid")
    assert_true(details["normalizer_reaped"],
                "persistent probe should reap the normalizer")

    def valid_object(request_id):
        return (
            b'{"operation":"health","id":"' + request_id +
            b'","deadlineMs":1}'
        )

    nul_records = [
        (
            "operation",
            b'{"operation":"hea\x00lth","id":"nul-operation",'
            b'"deadlineMs":1}\n',
        ),
        (
            "identifier",
            b'{"operation":"health","id":"nul\x00-identifier",'
            b'"deadlineMs":1}\n',
        ),
        (
            "leading structural whitespace",
            b'\x00 {"operation":"health","id":"nul-leading",'
            b'"deadlineMs":1}\n',
        ),
        (
            "between-token structural whitespace",
            b'{\x00 "operation":"health","id":"nul-between",'
            b'"deadlineMs":1}\n',
        ),
        (
            "joined valid objects",
            valid_object(b"nul-joined-a") + b"\x00" +
            valid_object(b"nul-joined-b") + b"\n",
        ),
        (
            "malformed NUL line",
            b'not-json\x00still-not-json\n',
        ),
    ]
    for index, (description, nul_record) in enumerate(nul_records):
        clean_id = f"clean-after-nul-{index}"
        clean_request = valid_object(clean_id.encode("ascii")) + b"\n"
        result, response = run_generated_service_shell(
            init, nul_record + clean_request
        )
        assert_true(result.returncode == 0,
                    f"generated shell {description} case should run")
        expected = (
            f'{{"id":"{clean_id}","status":"ok",'
            f'"operation":"health"}}\n'
        ).encode("ascii")
        assert_true(response == expected,
                    f"{description} must not execute before the clean request")
        assert_true(
            result.stdout ==
            b"QEMU_WASM_SERVICE_READY\n"
            b"QEMU_WASM_SERVICE_MALFORMED_REQUEST\n"
            b"QEMU_WASM_LINUX_BOOT_OK\n",
            f"{description} should diagnose then serve the clean request",
        )

    unsupported = (
        b'{"operation":"status","id":"unsupported-operation",'
        b'"deadlineMs":1}\n'
    )
    result, response = run_generated_service_shell(init, unsupported)
    assert_true(result.returncode == 0,
                "generated shell unsupported operation case should run")
    assert_true(
        response ==
        b'{"id":"unsupported-operation","status":"error",'
        b'"error":"unsupported operation"}\n',
        "generated shell should preserve unsupported-operation responses",
    )
    assert_true(
        result.stdout ==
        b"QEMU_WASM_SERVICE_READY\n"
        b"QEMU_WASM_SERVICE_UNSUPPORTED_OPERATION\n",
        "generated shell should preserve unsupported-operation diagnostics",
    )

    result, response = run_generated_service_shell(init, b"")
    assert_true(result.returncode == 0 and response == b"",
                "generated shell should handle end of input without execution")
    assert_true(
        result.stdout ==
        b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n",
        "generated shell should preserve end-of-input diagnostics",
    )

    unterminated_shell_requests = [
        (
            "valid unterminated EOF",
            valid_object(b"unterminated-shell"),
            b"QEMU_WASM_SERVICE_READY\n"
            b"QEMU_WASM_SERVICE_MALFORMED_REQUEST\n"
            b"QEMU_WASM_SERVICE_READ_FAILED\n",
        ),
        (
            "malformed then unterminated valid",
            b"not-json\n" + valid_object(b"unterminated-after-malformed"),
            b"QEMU_WASM_SERVICE_READY\n"
            b"QEMU_WASM_SERVICE_MALFORMED_REQUEST\n"
            b"QEMU_WASM_SERVICE_MALFORMED_REQUEST\n"
            b"QEMU_WASM_SERVICE_READ_FAILED\n",
        ),
    ]
    for description, request_data, expected_stdout in (
        unterminated_shell_requests
    ):
        result, response = run_generated_service_shell(init, request_data)
        assert_true(result.returncode == 0 and response == b"",
                    f"generated shell must reject {description}")
        assert_true(result.stdout == expected_stdout,
                    f"generated shell should diagnose {description}")

    fault_cases = [
        ("AWK fault without tag", b"", 2,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("successful producer without tag", b"", 0,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("unknown tag", b"X\n", 0,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("partial V tag", b"V\tid\n", 0,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("unterminated V tag", b"V\tid\thealth", 0,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("V tag with extra field", b"V\tid\thealth\textra\n", 0,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("malformed M tag", b"M\textra\n", 0,
         b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n"),
        ("M without terminal tag", b"M\n", 0,
         b"QEMU_WASM_SERVICE_READY\n"
         b"QEMU_WASM_SERVICE_MALFORMED_REQUEST\n"
         b"QEMU_WASM_SERVICE_READ_FAILED\n"),
    ]
    for description, producer_output, producer_status, expected_stdout in (
        fault_cases
    ):
        result, response = run_generated_service_shell(
            init,
            b"",
            producer_output=producer_output,
            producer_status=producer_status,
        )
        assert_true(result.returncode == 0 and response == b"",
                    f"generated shell must reject {description}")
        assert_true(result.stdout == expected_stdout,
                    f"generated shell should diagnose {description}")

    result, response = run_generated_service_shell(
        init, b"", normalizer_status=3
    )
    assert_true(result.returncode == 0 and response == b"",
                "generated shell must reject a normalizer fault")
    assert_true(
        result.stdout ==
        b"QEMU_WASM_SERVICE_READY\nQEMU_WASM_SERVICE_READ_FAILED\n",
        "generated shell should diagnose a normalizer fault",
    )

    malformed = b'not-json\n'
    result, response = run_generated_service_shell(init, malformed)
    assert_true(result.returncode == 0 and response == b"",
                "generated shell should reject malformed input "
                "without execution")
    assert_true(
        result.stdout ==
        b"QEMU_WASM_SERVICE_READY\n"
        b"QEMU_WASM_SERVICE_MALFORMED_REQUEST\n"
        b"QEMU_WASM_SERVICE_READ_FAILED\n",
        "generated shell should preserve malformed and end diagnostics",
    )


def test_persistent_disk_smoke_initramfs():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        busybox = root / "busybox"
        output = root / "persistent-disk-initramfs.cpio.gz"
        busybox.write_bytes(b"busybox")
        busybox.chmod(0o755)

        subprocess.run([
            sys.executable,
            str(SCRIPT),
            "--busybox",
            str(busybox),
            "--output",
            str(output),
            "--persistent-disk-smoke",
            "verify",
            "--persistent-disk-device",
            "/dev/vdb",
            "--persistent-disk-payload",
            "BUS_ENGINE_OS_DISK_PROOF",
        ], check=True)

        entries = parse_newc(output)
        init = entries["init"]["data"]
        assert_true(b"/dev/vdb" in init,
                    "persistent disk init should use the requested disk device")
        assert_true(b"BUS_ENGINE_OS_DISK_PROOF" in init,
                    "persistent disk init should include the proof payload")
        assert_true(b"QEMU_WASM_PERSISTENT_DISK_VERIFY_OK" in init,
                    "verify init should print the verify success marker")
        assert_true(b"QEMU_WASM_PERSISTENT_DISK_WRITE_OK" not in init,
                    "verify init should not print the write success marker")
        assert_true(b"QEMU_WASM_PERSISTENT_DISK_DEVICE_MISSING" in init,
                    "persistent disk init should diagnose missing disk devices")
        assert_true(b"dd if=\"$device\" bs=1 count=\"$payload_len\"" in init,
                    "persistent disk init should read back the exact proof payload")
        assert_true(b"conv=notrunc" in init,
                    "persistent disk init should preserve the rest of the raw disk on writes")
        assert_true(b"QEMU_WASM_LINUX_BOOT_OK" in init,
                    "persistent disk init should print the success marker")


def main():
    test_display_input_smoke_initramfs()
    test_service_bridge_smoke_initramfs()
    test_persistent_disk_smoke_initramfs()
    print("wasm-build-smoke-initramfs-test: ok")


if __name__ == "__main__":
    main()
