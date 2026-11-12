"""Synthetic tests: no network, production credentials or physical device."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("energy_worker", Path(__file__).resolve().parents[1] / "tools/energy/tuya-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
VALID = {"dps": {"1": True, "18": 557, "19": 463, "20": 1165, "22": 999}}


class WorkerTests(unittest.TestCase):
    def run_worker(self, values, requests=None, version="1.20.0", root=False, credential_error=False):
        calls = []
        count = len(values)
        values = iter(values)

        class Device:
            def __init__(self, *args, **kwargs):
                calls.append(("init", kwargs))

            def set_retry(self, enabled):
                calls.append(("retry", enabled))

            def generate_payload(self, command):
                calls.append(("command", command))
                return command

            def status(self):
                self.generate_payload(10)
                value = next(values)
                if isinstance(value, Exception):
                    raise value
                return value

            def close(self):
                calls.append(("close",))

        fake = types.SimpleNamespace(Device=Device, __version__=version)
        requests = requests or [{"op": "status", "id": i + 1, "deviceId": "SYNTHETIC_ID", "address": "192.0.2.3", "timeout": 1} for i in range(count)]
        incoming = io.StringIO("".join(json.dumps(r) + "\n" for r in requests))
        outgoing = io.StringIO()
        private = patch.object(worker, "credentials", side_effect=OSError("SYNTHETIC_SECRET")) if credential_error else patch.object(worker, "credentials", return_value=("SYNTHETIC_ID", "SYNTHETIC_SECRET"))
        with patch.dict(sys.modules, {"tinytuya": fake}), patch.object(os, "geteuid", return_value=0 if root else 1000, create=True), private, patch.object(sys, "stdin", incoming), contextlib.redirect_stdout(outgoing):
            worker.main()
        raw = outgoing.getvalue()
        self.assertNotIn("SYNTHETIC_SECRET", raw)
        self.assertNotIn("SYNTHETIC_ID", raw)
        return [json.loads(line) for line in raw.splitlines()], calls

    def test_persistent_read_only_device_and_dps_allowlist(self):
        rows, calls = self.run_worker([VALID, VALID])
        self.assertEqual(len([c for c in calls if c[0] == "init"]), 1)
        self.assertTrue(all(c[1] == 10 for c in calls if c[0] == "command"))
        self.assertEqual(set(rows[0]["dps"]), {"1", "18", "19", "20"})
        options = next(c[1] for c in calls if c[0] == "init")
        self.assertEqual(options["version"], 3.4)
        self.assertEqual(options["port"], 6668)
        self.assertEqual(options["connection_retry_limit"], 1)

    def test_error_codes_and_recovery(self):
        rows, calls = self.run_worker([{"Err": "914", "Payload": "SYNTHETIC_SECRET"}, {"Err": "902"}, {"Err": "905"}, VALID])
        self.assertEqual([r.get("code") for r in rows], ["authentication", "timeout", "offline", None])
        self.assertEqual(len([c for c in calls if c[0] == "init"]), 4)

    def test_bad_values_and_private_exceptions_are_sanitized(self):
        for value in [None, {"dps": {}}, {"dps": {"1": 1, "18": 1, "19": 1, "20": 1}}, {"dps": {**VALID["dps"], "19": float("nan")}}, RuntimeError("SYNTHETIC_SECRET")]:
            rows, _ = self.run_worker([value])
            self.assertFalse(rows[0]["ok"])

    def test_control_request_and_root_execution_are_rejected(self):
        request = {"op": "set", "id": 1, "address": "192.0.2.3", "timeout": 1}
        rows, calls = self.run_worker([VALID], requests=[request])
        self.assertEqual(rows[0]["code"], "worker")
        self.assertEqual(calls, [])
        rows, calls = self.run_worker([VALID], root=True)
        self.assertEqual(rows[0]["code"], "credentials")
        self.assertEqual(calls, [])

    def test_missing_credentials_and_wrong_dependency_version(self):
        rows, _ = self.run_worker([VALID], credential_error=True)
        self.assertEqual(rows[0]["code"], "credentials")
        rows, _ = self.run_worker([VALID], version="0.0.0")
        self.assertEqual(rows[0]["code"], "dependency")

    def test_private_file_permissions_and_systemd_exception(self):
        class PrivateFile(io.StringIO):
            def fileno(self):
                return 42

        for mode, owner, group, path, accepted in [
            (0o600, 1000, 1000, "/private/tuya-local-key", True),
            (0o644, 1000, 1000, "/private/tuya-local-key", False),
            (0o600, 2000, 2000, "/private/tuya-local-key", False),
            (0o440, 0, 0, "/run/credentials/orbit.service/tuya-local-key", True),
            (0o440, 0, 0, "/private/tuya-local-key", False),
        ]:
            data = "0123456789abcdef\n"
            info = types.SimpleNamespace(st_mode=0o100000 | mode, st_uid=owner, st_gid=group, st_size=len(data))
            with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": "/run/credentials/orbit.service", "ORBIT_ENERGY_CREDENTIAL_FILE": path}), patch.object(os, "geteuid", return_value=1000, create=True), patch.object(os, "O_NOFOLLOW", 0x100, create=True), patch.object(os, "open", return_value=42) as opened, patch.object(os, "fdopen", return_value=PrivateFile(data)), patch.object(os, "fstat", return_value=info):
                if accepted:
                    self.assertEqual(worker.credentials("SYNTHETIC_ID"), ("SYNTHETIC_ID", "0123456789abcdef"))
                else:
                    with self.assertRaises(ValueError):
                        worker.credentials("SYNTHETIC_ID")
                self.assertEqual(opened.call_args.args[1], os.O_RDONLY | os.O_NOFOLLOW)


if __name__ == "__main__":
    unittest.main()
