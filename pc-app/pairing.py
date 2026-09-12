"""Persistent user-private pairing, with atomic rotation and generation checks."""
import contextlib
import csv
import ctypes
import ipaddress
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tempfile
import threading
from urllib.parse import quote, unquote_plus, urlsplit

TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z")
LAN_RANGES = tuple(ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"))


def user_only(path):
    if os.name != "nt":
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
        return
    # Replace the DACL, including any explicit grants inherited from older installs.
    output = subprocess.check_output(["whoami", "/user", "/fo", "csv", "/nh"], creationflags=subprocess.CREATE_NO_WINDOW, text=True)
    sid = next(csv.reader([output.strip()]))[1]
    if not re.fullmatch(r"S-1-\d+(?:-\d+)+", sid):
        raise OSError("Unable to determine user SID")
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    descriptor = ctypes.c_void_p()
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    advapi.SetFileSecurityW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_void_p]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(f"D:P(A;OICI;FA;;;{sid})", 1, ctypes.byref(descriptor), None):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not advapi.SetFileSecurityW(str(path), 0x80000004, descriptor):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel.LocalFree(descriptor)


class Revoked(Exception):
    pass


class TokenStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        user_only(directory)
        self.path = directory / "pairing-token"
        self.lock = threading.RLock()
        self.generation = 0
        if self.path.exists():
            user_only(self.path)
            self.token = self.path.read_text(encoding="ascii").strip()
            if not TOKEN.fullmatch(self.token):
                raise ValueError("Invalid stored pairing token; remove the token file locally to recover")
        else:
            self.token = ""
            self.rotate()

    def rotate(self):
        with self.lock:
            token = secrets.token_urlsafe(32)
            fd, name = tempfile.mkstemp(prefix=".pairing-", dir=self.path.parent)
            try:
                with os.fdopen(fd, "w", encoding="ascii") as stream:
                    user_only(Path(name))
                    stream.write(token)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(name, self.path)
            finally:
                Path(name).unlink(missing_ok=True)
            self.token = token
            self.generation += 1
            return self.generation

    @contextlib.contextmanager
    def authorized(self, generation):
        # Keep the check adjacent to OS dispatch even when a worker waited in a pool.
        with self.lock:
            if generation != self.generation:
                raise Revoked()
            yield

    def authenticate(self, target):
        try:
            parts = urlsplit(target)
        except ValueError:
            return 4001, "Invalid token"
        query, malformed = {}, False
        for pair in parts.query.split("&"):
            key, separator, value = pair.partition("=")
            try:
                key = unquote_plus(key, errors="strict")
                bad = not separator or re.search(r"%(?![0-9a-fA-F]{2})", pair)
                value = unquote_plus(value, errors="strict")
            except UnicodeError:
                bad = True
            if bad:
                if key == "token":
                    return 4001, "Invalid token"
                malformed = True
            query.setdefault(key, []).append(value)
        tokens = query.get("token", [])
        if len(tokens) != 1 or not TOKEN.fullmatch(tokens[0]) or not secrets.compare_digest(tokens[0], self.token):
            return 4001, "Invalid token"
        if parts.path != "/" or parts.scheme or parts.netloc or parts.fragment:
            return 1008, "Invalid message"
        if malformed or set(query) != {"token", "protocolVersion"} or query["protocolVersion"] != ["1"]:
            return 4002, "Incompatible protocol version"
        return None


def is_lan(address):
    try:
        ip = ipaddress.IPv4Address(address)
        return any(ip in network for network in LAN_RANGES)
    except ipaddress.AddressValueError:
        return False


def discover_lan():
    addresses = sorted({item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET) if is_lan(item[4][0])})
    if len(addresses) != 1:
        raise ValueError("Choose --host from detected LAN IPv4 addresses: " + (", ".join(addresses) or "none; connect to a LAN first"))
    return addresses[0]


def pairing_url(host, port, token):
    if not is_lan(host) or not 1 <= port <= 65535 or not TOKEN.fullmatch(token):
        raise ValueError("Pairing requires a LAN IPv4 address, port, and valid token")
    return f"ws://{host}:{port}?token={quote(token, safe='')}"
