import asyncio
import contextlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from actions import execute
from pairing import Revoked, TokenStore, pairing_url
from protocol import MAX_SIZE, decode, encode, validator
from server import Service


def press(button="one", **extra):
    return {"type": "press", "requestId": str(uuid.uuid4()), "buttonId": button, "ts": 1, **extra}


class LocalTests(unittest.TestCase):
    def test_token_private_persistence_rotation_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            store = TokenStore(directory)
            old = store.token
            self.assertEqual(len(old), 43)
            self.assertEqual(TokenStore(directory).token, old)
            with patch("pairing.os.replace", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    store.rotate()
            self.assertEqual(store.token, old)
            self.assertEqual(TokenStore(directory).token, old)
            generation = store.generation
            store.rotate()
            self.assertNotEqual(store.token, old)
            self.assertEqual(TokenStore(directory).token, store.token)
            with self.assertRaises(Revoked), store.authorized(generation):
                self.fail("revoked dispatch started")

    def test_strict_json(self):
        for raw in ('{"x":NaN}', '{"x":Infinity}', '{"x":1,"x":2}', '{}\n{}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                decode(raw)

    def test_qr_ranges(self):
        for address in ("127.0.0.1", "0.0.0.0", "8.8.8.8", "example.com"):
            with self.assertRaises(ValueError):
                pairing_url(address, 8765, "a" * 43)
        self.assertEqual(pairing_url("192.168.1.2", 8765, "a" * 43), "ws://192.168.1.2:8765?token=" + "a" * 43)

    def test_actions_use_argv_and_scripts_require_success(self):
        with patch("actions.subprocess.Popen") as popen:
            popen.return_value.wait.return_value = 0
            execute({"kind": "run_script", "path": "trusted.exe", "args": ["a & b"]}, contextlib.nullcontext)
            self.assertEqual(popen.call_args.args[0], ["trusted.exe", "a & b"])
            self.assertFalse(popen.call_args.kwargs["shell"])
            popen.return_value.wait.return_value = 1
            with self.assertRaises(OSError):
                execute({"kind": "run_script", "path": "trusted.exe"}, contextlib.nullcontext)

    def test_windows_input_adapter_accepts_harmless_f24(self):
        # Real SendInput acceptance, no application shortcut or clipboard mutation.
        if sys.platform != "win32":
            self.skipTest("Windows-only input adapter")
        execute({"kind": "hotkey", "keys": ["f24"]}, contextlib.nullcontext)

    def test_windows_qr_and_tray_lifecycle(self):
        if sys.platform != "win32":
            self.skipTest("Windows-only tray")
        import tkinter as tk
        import pystray
        import qrcode
        from PIL import Image, ImageTk
        root = tk.Tk()
        root.withdraw()
        icon = pystray.Icon("deckremote-test", Image.new("RGB", (16, 16), "cyan"), "DeckRemote test")
        ready = threading.Event()

        def setup(icon):
            ready.set()

        thread = threading.Thread(target=icon.run, kwargs={"setup": setup}, daemon=True)
        try:
            photo = ImageTk.PhotoImage(qrcode.make(pairing_url("192.168.1.2", 8765, "a" * 43)).get_image(), master=root)
            self.assertGreater(photo.width(), 100)
            root.update()
            thread.start()
            self.assertTrue(ready.wait(2))
        finally:
            icon.stop()
            if thread.ident:
                thread.join(2)
            root.destroy()
        self.assertFalse(thread.is_alive())


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.path = self.directory / "config.json"
        self.source = {"buttons": [{"id": "one", "label": "One", "icon": "music", "action": {"kind": "launch_app", "path": "private-secret.exe"}},
                                   {"id": "disabled", "label": "Disabled", "action": {"kind": "media", "command": "play_pause", "enabled": False}}]}
        self.write_config()
        self.tokens = TokenStore(self.directory / "private")
        self.ran = []
        self.started = threading.Event()
        self.release = threading.Event()
        self.slow = False
        self.fail = False

        def runner(action, authorized):
            with authorized():
                self.ran.append(action)
                self.started.set()
            if self.slow:
                self.release.wait(4)
            if self.fail:
                raise OSError("secret path and token must not escape")

        self.service = Service(self.tokens, self.path, runner=runner)
        server = await self.service.start("127.0.0.1", 0)
        self.base = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"

    def write_config(self):
        self.path.write_text(json.dumps(self.source), encoding="utf-8")

    async def asyncTearDown(self):
        self.release.set()
        await self.service.stop()
        self.temp.cleanup()

    def url(self, query=None, path="/"):
        return self.base + path + "?" + (query if query is not None else f"token={self.tokens.token}&protocolVersion=1")

    async def receive(self, client):
        return decode(await asyncio.wait_for(client.recv(), 2))

    async def assert_closed(self, url, code):
        async with connect(url, proxy=None) as client:
            with self.assertRaises(ConnectionClosed) as error:
                await self.receive(client)
            self.assertEqual(error.exception.rcvd.code, code)

    async def test_auth_and_version_before_any_config(self):
        token = self.tokens.token
        for query, code in [("", 4001), ("token=bad&protocolVersion=1", 4001),
                            (f"token={token}&token={token}&protocolVersion=1", 4001),
                            (f"token={token}%xx&protocolVersion=1", 4001),
                            (f"token={token}", 4002), (f"token={token}&protocolVersion=01", 4002),
                            (f"token={token}&protocolVersion=1&protocolVersion=1", 4002),
                            (f"token={token}&protocolVersion=%xx", 4002),
                            (f"token={token}&protocolVersion=1&broken", 4002),
                            (f"token={token}&protocolVersion=1&extra=true", 4002)]:
            with self.subTest(query=query.replace(token, "REDACTED")):
                await self.assert_closed(self.url(query), code)
        await self.assert_closed(self.url(path="/other"), 1008)
        self.assertEqual(self.ran, [])

    async def test_origin_never_bypasses_or_blocks_token_and_version_auth(self):
        for origin in (None, "http://192.168.1.2:8765", "https://arbitrary.example"):
            for query, expected in ((f"token={self.tokens.token}&protocolVersion=1", None),
                                    ("token=wrong&protocolVersion=1", 4001),
                                    (f"token={self.tokens.token}&protocolVersion=2", 4002)):
                async with connect(self.url(query), origin=origin, proxy=None) as client:
                    if expected is None:
                        self.assertEqual((await self.receive(client))["type"], "config")
                    else:
                        with self.assertRaises(ConnectionClosed) as error:
                            await self.receive(client)
                        self.assertEqual(error.exception.rcvd.code, expected)

    async def test_config_projection_and_atomic_reload(self):
        async with connect(self.url(), proxy=None) as client:
            first = await self.receive(client)
            self.assertNotIn("private-secret", encode(first))
            self.assertEqual(set(first["buttons"][0]), {"id", "label", "icon"})
            self.source["buttons"][0]["label"] = "Updated"
            self.write_config()
            await self.service.reload()
            second = await self.receive(client)
            self.assertGreater(second["revision"], first["revision"])
            self.source["buttons"].append(self.source["buttons"][0])
            self.write_config()
            with self.assertRaises(ValueError):
                await self.service.reload()
            self.assertEqual(self.service.config, second)

    async def test_correlatable_injection_is_nack_without_execution(self):
        async with connect(self.url(), proxy=None) as client:
            await self.receive(client)
            message = press(command="calc.exe")
            await client.send(encode(message))
            result = await self.receive(client)
            self.assertEqual(result["error"]["code"], "invalid_message")
            self.assertEqual(result["requestId"], message["requestId"])
            self.assertEqual(self.ran, [])
            await client.send(encode(press("missing")))
            self.assertEqual((await self.receive(client))["error"]["code"], "unknown_button")

    async def test_bad_input_closes_without_execution(self):
        cases = [('[]', 1008), ('{', 1008), ('{"type":"unknown"}', 1008),
                 (encode({"type": "pong", "requestId": str(uuid.uuid4()), "ts": 1}), 1008),
                 (encode(press(requestId="invalid")), 1008), (b"binary", 1003), ("x" * (MAX_SIZE + 1), 1009)]
        for raw, code in cases:
            async with connect(self.url(), proxy=None) as client:
                await self.receive(client)
                await client.send(raw)
                with self.assertRaises(ConnectionClosed) as error:
                    await self.receive(client)
                self.assertEqual(error.exception.rcvd.code, code)
        self.assertEqual(self.ran, [])

    async def test_two_clients_ack_isolation_and_heartbeat_during_action(self):
        self.slow = True
        async with connect(self.url(), proxy=None) as first, connect(self.url(), proxy=None) as second:
            await self.receive(first)
            await self.receive(second)
            first_press, second_press = press(), press()
            await first.send(encode(first_press))
            await asyncio.to_thread(self.started.wait, 1)
            for client in (first, second):
                ping = {"type": "ping", "requestId": str(uuid.uuid4()), "ts": 1}
                await client.send(encode(ping))
                pong = await self.receive(client)
                self.assertEqual(pong["type"], "pong")
                self.assertEqual(pong["requestId"], ping["requestId"])
            await second.send(encode(second_press))
            self.release.set()
            self.assertEqual((await self.receive(first))["requestId"], first_press["requestId"])
            self.assertEqual((await self.receive(second))["requestId"], second_press["requestId"])
            self.assertEqual(len(self.ran), 2)

    async def test_rotation_revokes_live_and_queued_requests(self):
        self.slow = True
        self.service.slots = asyncio.Semaphore(1)
        old_url = self.url()
        async with connect(old_url, proxy=None) as client:
            await self.receive(client)
            await client.send(encode(press()))
            await asyncio.to_thread(self.started.wait, 1)
            await client.send(encode(press()))
            await asyncio.sleep(0.05)
            await self.service.rotate()
            self.release.set()
            with self.assertRaises(ConnectionClosed) as error:
                await self.receive(client)
            self.assertEqual(error.exception.rcvd.code, 4001)
        await self.assert_closed(old_url, 4001)
        async with connect(self.url(), proxy=None) as fresh:
            self.assertEqual((await self.receive(fresh))["type"], "config")
        await asyncio.sleep(0.05)
        self.assertEqual(len(self.ran), 1)

    async def test_action_error_is_sanitized(self):
        self.fail = True
        async with connect(self.url(), proxy=None) as client:
            await self.receive(client)
            await client.send(encode(press()))
            result = await self.receive(client)
            self.assertEqual(result["error"], {"code": "action_failed", "message": "Action failed"})
            self.assertTrue(validator("ack").is_valid(result))

    async def test_stop_closes_clients_and_releases_port(self):
        port = int(self.base.rsplit(":", 1)[1])
        async with connect(self.url(), proxy=None) as client:
            await self.receive(client)
            await self.service.stop()
            with self.assertRaises(ConnectionClosed) as error:
                await self.receive(client)
            self.assertEqual(error.exception.rcvd.code, 1001)
        replacement = Service(self.tokens, self.path, runner=self.service.runner)
        await replacement.start("127.0.0.1", port)
        await replacement.stop()

    async def test_real_launch_script_and_disabled_media_over_websocket(self):
        marker = self.directory / "launched.txt"
        self.source = {"buttons": [
            {"id": "one", "label": "Launch", "action": {"kind": "launch_app", "path": sys.executable,
             "args": ["-c", "from pathlib import Path; import sys; Path(sys.argv[1]).write_text('launched')", str(marker)]}},
            {"id": "script", "label": "Script", "action": {"kind": "run_script", "path": sys.executable, "args": ["-c", "pass"]}},
            {"id": "failure", "label": "Failure", "action": {"kind": "run_script", "path": sys.executable, "args": ["-c", "raise SystemExit(2)"]}},
            {"id": "timeout", "label": "Timeout", "action": {"kind": "run_script", "path": sys.executable, "args": ["-c", "import time; time.sleep(10)"], "timeout": 0.1}},
            {"id": "disabled", "label": "Disabled", "action": {"kind": "media", "command": "play_pause", "enabled": False}},
        ]}
        if sys.platform == "win32":
            self.source["buttons"].append({"id": "key", "label": "Input", "action": {"kind": "hotkey", "keys": ["f24"]}})
        self.write_config()
        await self.service.reload()
        self.service.runner = execute
        async with connect(self.url(), proxy=None) as client:
            await self.receive(client)
            expected = [("one", None), ("script", None), ("failure", "action_failed"),
                        ("timeout", "action_failed"), ("disabled", "unsupported_action")]
            if sys.platform == "win32":
                expected.append(("key", None))
            for button, code in expected:
                await client.send(encode(press(button)))
                reply = await self.receive(client)
                self.assertEqual(reply["error"]["code"] if reply["error"] else None, code)
            for _ in range(40):
                if marker.exists():
                    break
                await asyncio.sleep(0.05)
            self.assertEqual(marker.read_text(), "launched")


if __name__ == "__main__":
    unittest.main()
