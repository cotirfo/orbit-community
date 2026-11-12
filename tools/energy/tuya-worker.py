"""Private JSON-lines worker. Only DP_QUERY through TinyTuya status is exposed."""
import contextlib
import ipaddress
import json
import logging
import math
import os
import stat
import sys

logging.disable(logging.CRITICAL)


def credentials(device_id):
    directory = os.environ.get("CREDENTIALS_DIRECTORY", "/run/credentials/orbit-community.service")
    filename = os.environ.get("ORBIT_ENERGY_CREDENTIAL_FILE") or os.path.join(directory, "tuya-local-key")
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "r", encoding="utf-8") as handle:
        info = os.fstat(handle.fileno())
        systemd = (os.path.dirname(os.path.abspath(filename)) == os.path.abspath(directory)
                   and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o440)
        if (not stat.S_ISREG(info.st_mode) or info.st_size > 4096
                or info.st_uid not in (0, os.geteuid()) or (info.st_mode & 0o077 and not systemd)):
            raise ValueError("credentials")
        key = handle.read(4097).rstrip("\r\n")
    if not isinstance(device_id, str) or not 1 <= len(device_id) <= 64 or not device_id.replace("_", "").replace("-", "").isalnum() or len(key.encode("latin1")) != 16:
        raise ValueError("credentials")
    return device_id, key


def main():
    device = None
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("op") != "status" or not isinstance(request_id, int):
                raise ValueError("worker")
            if not hasattr(os, "geteuid") or os.geteuid() == 0:
                raise ValueError("credentials")
            address = str(ipaddress.IPv4Address(request["address"]))
            timeout = float(request["timeout"])
            if not 0 < timeout <= 5:
                raise ValueError("worker")
            if device is None:
                try:
                    with contextlib.redirect_stdout(sys.stderr):
                        import tinytuya
                    if tinytuya.__version__ != "1.20.0":
                        raise ImportError()
                except ImportError:
                    raise ValueError("dependency") from None
                try:
                    device_id, key = credentials(request.get("deviceId"))
                except Exception:
                    raise ValueError("credentials") from None
                class ReadOnlyDevice(tinytuya.Device):
                    def generate_payload(self, command, *args, **kwargs):
                        # DP_QUERY (10) and DP_QUERY_NEW (16) only. Session-key
                        # negotiation is internal to TinyTuya's transport.
                        if command not in (10, 16):
                            raise ValueError("worker")
                        return super().generate_payload(command, *args, **kwargs)
                with contextlib.redirect_stdout(sys.stderr):
                    device = ReadOnlyDevice(device_id, address, key, version=3.4,
                                             persist=True, connection_timeout=timeout,
                                             connection_retry_limit=1, connection_retry_delay=0, port=6668)
                    device.set_retry(False)
                    # Prevent fallback to device22's CONTROL_NEW query path.
                    device.disabledetect = True
            with contextlib.redirect_stdout(sys.stderr):
                value = device.status()
            if not isinstance(value, dict) or "Err" in value or "Error" in value:
                code = str(value.get("Err")) if isinstance(value, dict) else ""
                raise ValueError({"914": "authentication", "904": "authentication", "902": "timeout", "901": "offline", "905": "offline"}.get(code, "invalid-data"))
            dps = value.get("dps", value.get("data", {}).get("dps", {}))
            if (not isinstance(dps.get("1"), bool)
                    or any(isinstance(dps.get(k), bool) or not isinstance(dps.get(k), (int, float))
                           or not math.isfinite(dps[k]) or dps[k] < 0 for k in ("18", "19", "20"))):
                raise ValueError("invalid-data")
            response = {"id": request_id, "ok": True, "dps": {k: dps.get(k) for k in ("1", "18", "19", "20")}}
        except Exception as error:
            code = str(error)
            if code not in ("authentication", "credentials", "timeout", "offline", "invalid-data", "dependency", "worker"):
                code = "worker"
            response = {"id": request_id, "ok": False, "code": code}
            if device is not None:
                with contextlib.suppress(Exception):
                    device.close()
                device = None
        print(json.dumps(response, allow_nan=False), flush=True)
    if device is not None:
        device.close()


if __name__ == "__main__":
    main()
