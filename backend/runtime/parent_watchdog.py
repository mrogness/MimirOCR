"""Exit even during inference if the owning process disappears."""
import ctypes
import os
import sys
import threading
import time


def _is_parent_alive_unix(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return True

    try:
        os.kill(parent_pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

    return True


def _is_parent_alive_windows(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return True

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    SYNCHRONIZE = 0x00100000
    WAIT_OBJECT_0 = 0x00000000
    WAIT_TIMEOUT = 0x00000102

    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, parent_pid)
    if not handle:
        return False

    try:
        wait_result = kernel32.WaitForSingleObject(handle, 0)
        if wait_result == WAIT_TIMEOUT:
            return True
        if wait_result == WAIT_OBJECT_0:
            return False
        return False
    finally:
        kernel32.CloseHandle(handle)


def start_parent_watchdog(*, direct_parent: bool = False) -> None:
    parent_pid = int(os.environ.get("MIMIR_PARENT_PID", "0"))
    if parent_pid <= 0:
        return

    def monitor() -> None:
        while True:
            if sys.platform.startswith("win"):
                is_alive = _is_parent_alive_windows(parent_pid)
            else:
                is_alive = _is_parent_alive_unix(parent_pid)
                if direct_parent:
                    is_alive = is_alive and os.getppid() == parent_pid

            if not is_alive:
                os._exit(0)

            time.sleep(2.0)

    thread = threading.Thread(target=monitor, name="mimir-parent-watchdog", daemon=True)
    thread.start()
