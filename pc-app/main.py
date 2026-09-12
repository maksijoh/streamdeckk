"""Windows entry point: asyncio server, tray commands, and an in-memory QR window."""
import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import queue
import shutil
import threading

from pairing import TokenStore, discover_lan, is_lan, pairing_url
from server import Service, event


async def run(args):
    data = Path(args.data_dir)
    tokens = TokenStore(data)
    settings_path = data / "settings.json"
    if not settings_path.exists():
        settings_path.write_text(json.dumps({"host": None, "port": 8765}, indent=2), encoding="utf-8")
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    if not isinstance(settings, dict) or set(settings) != {"host", "port"}:
        raise ValueError("settings.json requires host and port")
    host = args.host or settings["host"] or discover_lan()
    port = args.port if args.port is not None else settings["port"]
    if not is_lan(host) or type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Choose a private/link-local IPv4 interface and port 1–65535")
    config_path = Path(args.config) if args.config else data / "config.json"
    if not config_path.exists() and not args.config:
        shutil.copyfile(Path(__file__).with_name("config.json"), config_path)
    service = Service(tokens, config_path)
    await service.start(host, port)
    root = icon = tray_thread = None
    window = None
    try:
        if args.headless:
            await asyncio.Event().wait()
        import tkinter as tk
        from PIL import Image, ImageDraw, ImageTk
        import pystray
        import qrcode

        root = tk.Tk()
        root.withdraw()
        commands = queue.SimpleQueue()
        picture = Image.new("RGB", (64, 64), "#142033")
        draw = ImageDraw.Draw(picture)
        for x in (12, 36):
            for y in (12, 36):
                draw.rounded_rectangle((x, y, x + 16, y + 16), radius=3, fill="#67e8f9")

        def command(name):
            def callback(icon, item):
                commands.put(name)
            return callback

        icon = pystray.Icon("DeckRemote", picture, "DeckRemote", pystray.Menu(
            pystray.MenuItem("Show QR", command("qr"), default=True),
            pystray.MenuItem("Regenerate pairing token", command("rotate")),
            pystray.MenuItem("Reload config", command("reload")),
            pystray.MenuItem("Quit", command("quit"))))
        tray_thread = threading.Thread(target=icon.run, name="deckremote-tray", daemon=True)
        tray_thread.start()
        while True:
            root.update()
            try:
                cmd = commands.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.05)
                continue
            try:
                if cmd == "quit":
                    break
                if cmd == "rotate":
                    await service.rotate()
                    if window is not None and window.winfo_exists():
                        window.destroy()
                    icon.notify("Existing phones were disconnected. Show QR to pair again.", "Pairing token regenerated")
                elif cmd == "reload":
                    await service.reload()
                    icon.notify("Configuration reloaded.", "DeckRemote")
                elif cmd == "qr":
                    if window is not None and window.winfo_exists():
                        window.destroy()
                    window = tk.Toplevel(root)
                    window.title("Pair with DeckRemote")
                    window.resizable(False, False)
                    tk.Label(window, text="Scan in DeckRemote on the same Wi-Fi", padx=20, pady=12).pack()
                    qr = qrcode.make(pairing_url(host, port, tokens.token))
                    photo = ImageTk.PhotoImage(qr.get_image())
                    label = tk.Label(window, image=photo)
                    label.image = photo
                    label.pack(padx=20, pady=10)
                    tk.Label(window, text=f"{host}:{port}", pady=12).pack()
                    window.lift()
            except Exception as error:
                event("tray_command_failed", command=cmd, errorType=type(error).__name__)
                icon.notify("Operation failed. Check local config and permissions.", "DeckRemote")
    finally:
        if icon:
            icon.stop()
        if tray_thread:
            await asyncio.to_thread(tray_thread.join, 3)
        if root:
            root.destroy()
        await service.stop()


def main():
    parser = argparse.ArgumentParser(description="DeckRemote PC service for Windows 10/11")
    parser.add_argument("--host", help="Private/link-local LAN IPv4 interface; auto-detected when unambiguous")
    parser.add_argument("--port", type=int)
    parser.add_argument("--config", help="Trusted local button config JSON")
    parser.add_argument("--data-dir", default=str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DeckRemote"))
    parser.add_argument("--headless", action="store_true", help="Run without tray/QR, stop with Ctrl+C")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        if os.name != "nt" and not args.headless:
            parser.error("The tray and action adapters target Windows; use --headless for development tests")
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass
    except Exception as error:
        event("startup_failed", errorType=type(error).__name__)
        parser.exit(1, "DeckRemote could not start. Check LAN address, port, config, and private data directory permissions.\n")


if __name__ == "__main__":
    main()
