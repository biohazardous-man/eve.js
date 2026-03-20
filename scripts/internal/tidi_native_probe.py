"""
Frida host for blue.dll TiDi research.

This version is intentionally focused on the native BlueNet TiDi path rather
than broad xref scanning. It loads the exact-RVA probe script, writes all
messages to client/tidi_frida_log.txt, and prints the high-signal TiDi events
live in the console.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

try:
    import frida
except ImportError as exc:
    print(
        "frida is not installed. Run: python -m pip install --user frida-tools frida",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


REPO_ROOT = Path(__file__).resolve().parents[2]
JS_PATH = REPO_ROOT / "scripts" / "internal" / "tidi_native_probe.js"
LOG_PATH = REPO_ROOT / "client" / "tidi_frida_log.txt"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EvEJS TiDi native probe via Frida")
    parser.add_argument("--process", default="exefile.exe", help="Process name to attach to")
    parser.add_argument(
        "--wait-seconds",
        type=int,
        default=120,
        help="How long to wait for the process",
    )
    parser.add_argument(
        "--enable-python-probe",
        action="store_true",
        help="Also try the lightweight embedded Python blue.os property probe",
    )
    return parser.parse_args()


def wait_for_process(device: frida.core.Device, name: str, timeout: int) -> int:
    deadline = time.time() + timeout
    print(f"[probe] Waiting for {name} (up to {timeout}s)...")
    while time.time() < deadline:
        for proc in device.enumerate_processes():
            if proc.name.lower() == name.lower():
                return proc.pid
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for {name}")


def format_wire(payload: dict) -> str:
    direction = payload.get("direction", "?")
    hook = payload.get("hook", "?")
    kind = payload.get("kindName", "?")
    kind_hex = payload.get("kindHex", "?")
    length = payload.get("payloadLength", "?")
    trailer = []
    if "clientID" in payload:
        trailer.append(f"clientID={payload['clientID']}")
    if "clientCount" in payload:
        trailer.append(f"clientCount={payload['clientCount']}")
    if "masterID" in payload:
        trailer.append(f"masterID={payload['masterID']}")
    if "flags" in payload:
        trailer.append(f"flags={payload['flags']}")
    if payload.get("payloadHex"):
        trailer.append(f"hex={payload['payloadHex']}")
    suffix = " ".join(trailer)
    return f"[{direction}] {hook} {kind} {kind_hex} len={length} {suffix}".strip()


def format_semantic(payload: dict) -> str:
    label = payload.get("label", "?")
    data = payload.get("data", {})
    parts = [f"{key}={value}" for key, value in data.items()]
    return f"{label}: " + " ".join(parts)


def on_message(message: dict, data: bytes | None) -> None:
    timestamp = time.strftime("%H:%M:%S")

    if message["type"] == "send":
        payload = message["payload"]

        if payload.get("type") == "status":
            print(f"[{timestamp}] {payload['message']}")
        elif payload.get("type") == "module-info":
            print(
                f"[{timestamp}] blue.dll base={payload.get('blueBase')} "
                f"size={payload.get('blueSize')} python={payload.get('pythonDll')}"
            )
        elif payload.get("type") == "tidi-wire":
            print(f"[{timestamp}] {format_wire(payload)}")
        elif payload.get("type") == "tidi-semantic":
            print(f"[{timestamp}] {format_semantic(payload)}")
        elif payload.get("type") == "python-probe":
            print(f"[{timestamp}] python-probe {json.dumps(payload, ensure_ascii=True)}")
        elif payload.get("type") == "fatal":
            print(f"[{timestamp}] fatal {json.dumps(payload, ensure_ascii=True)}")
        else:
            print(f"[{timestamp}] {json.dumps(payload, ensure_ascii=True)}")

        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")

    elif message["type"] == "error":
        desc = message.get("description", str(message))
        print(f"[frida-error] {desc}", file=sys.stderr)
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"type": "frida-error", "message": desc}) + "\n")


def main() -> int:
    args = parse_args()

    print("EvEJS TiDi Native Probe")
    print(f"Log file: {LOG_PATH}")

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text("", encoding="utf-8")

    device = frida.get_local_device()
    pid = wait_for_process(device, args.process, args.wait_seconds)
    print(f"[probe] Found {args.process} (PID {pid}) - attaching...")

    session = device.attach(pid)
    source = JS_PATH.read_text(encoding="utf-8").replace(
        "__ENABLE_PYTHON_PROBE__",
        "true" if args.enable_python_probe else "false",
    )
    script = session.create_script(source)
    script.on("message", on_message)
    script.load()

    print("[probe] Agent loaded. Waiting for TiDi traffic...")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        print("[probe] Detaching...")
        script.unload()
        session.detach()
        print(f"[probe] Done. Full log at: {LOG_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
