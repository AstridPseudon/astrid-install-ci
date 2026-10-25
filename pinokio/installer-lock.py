"""Probe the installer's actual per-user lock without creating installer state."""
import sys
import time
from pathlib import Path

from astrid.installer import service
from runtime_protocol import platform


def wait_for_lock(seconds: float) -> None:
    if hasattr(service, "installer_lock_path"):
        lock_path = service.installer_lock_path(Path.home(), sys.platform)
    else:
        # Pre-70de7d77a used this same path inline in cli.py.
        parent = service.default_program_root(Path.home(), sys.platform).parent
        if sys.platform == "win32":
            parent = parent / "Astrid Installer"
        lock_path = parent / "astrid-install.lock"
    deadline = time.monotonic() + seconds
    while True:
        try:
            lock = lock_path.open("r+b")
        except FileNotFoundError:
            return
        with lock:
            try:
                platform.lock_file(lock.fileno(), blocking=False)
            except BlockingIOError:
                pass
            else:
                platform.unlock_file(lock.fileno())
                return
        if time.monotonic() >= deadline:
            raise SystemExit("Stop Astrid in Pinokio first, then try again.")
        time.sleep(0.1)


if __name__ == "__main__":
    wait_for_lock(float(sys.argv[1]))
