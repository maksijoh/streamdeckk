"""Small Windows adapters; executable values come exclusively from local config."""
import ctypes
from ctypes import wintypes
import os
import subprocess
import threading

MEDIA = {"play_pause": 0xB3, "next_track": 0xB0, "previous_track": 0xB1,
         "stop": 0xB2, "volume_mute": 0xAD, "volume_down": 0xAE, "volume_up": 0xAF}
KEYS = {"ctrl": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B, "enter": 0x0D,
        "tab": 9, "escape": 0x1B, "space": 0x20, "backspace": 8, "delete": 0x2E,
        "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28}
KEYS.update({str(chr(code)).lower(): code for code in (*range(65, 91), *range(48, 58))})
KEYS.update({f"f{number}": 0x6F + number for number in range(1, 25)})
INPUT_LOCK = threading.Lock()


class UnsupportedAction(Exception):
    pass


def key_codes(keys):
    if not isinstance(keys, list) or not 1 <= len(keys) <= 8 or any(not isinstance(key, str) or key.lower() not in KEYS for key in keys):
        raise ValueError("Hotkey keys must be 1–8 supported key names")
    result = [KEYS[key.lower()] for key in keys]
    if len(set(result)) != len(result):
        raise ValueError("Duplicate hotkey key")
    return result


def send_keys(codes):
    if os.name != "nt":
        raise UnsupportedAction()
    pointer = ctypes.c_size_t

    class KeyboardInput(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", pointer)]

    class MouseInput(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", pointer)]

    class InputUnion(ctypes.Union):
        _fields_ = [("ki", KeyboardInput), ("mi", MouseInput)]

    class Input(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("data", InputUnion)]

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
    user32.SendInput.restype = wintypes.UINT

    def event(key, up=False):
        flags = (2 if up else 0) | (1 if key in (0x5B, 0x25, 0x26, 0x27, 0x28, 0x2E) or key >= 0xA0 else 0)
        return Input(1, InputUnion(ki=KeyboardInput(key, 0, flags, 0, 0)))

    with INPUT_LOCK:
        events = (Input * (2 * len(codes)))(*[event(key) for key in codes], *[event(key, True) for key in reversed(codes)])
        if user32.SendInput(len(events), events, ctypes.sizeof(Input)) != len(events):
            releases = (Input * len(codes))(*[event(key, True) for key in reversed(codes)])
            user32.SendInput(len(releases), releases, ctypes.sizeof(Input))
            raise OSError("Windows rejected keyboard input")


def execute(action, authorized):
    process = None
    with authorized():
        if not action.get("enabled", True):
            raise UnsupportedAction()
        kind = action["kind"]
        if kind == "launch_app" and os.name == "nt":
            os.startfile(action["path"], arguments=subprocess.list2cmdline(action.get("args", [])), cwd=action.get("cwd"))
            return
        if kind in ("launch_app", "run_script"):
            process = subprocess.Popen([action["path"], *action.get("args", [])], cwd=action.get("cwd"), shell=False,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" and kind == "run_script" else 0)
        elif kind == "hotkey":
            send_keys(key_codes(action["keys"]))
        elif kind == "media":
            send_keys([MEDIA[action["command"]]])
        else:
            raise UnsupportedAction()
    if kind == "run_script":
        try:
            if process.wait(timeout=action.get("timeout", 20)) != 0:
                raise OSError("Script failed")
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise
