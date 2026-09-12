# DeckRemote PC

Windows 10/11, Python 3.11+. Run from the repository root so the immutable
`shared/protocol.schema.json` is available. Dependencies use the modern
[websockets asyncio API](https://websockets.readthedocs.io/en/15.0/reference/asyncio/server.html).

```powershell
python -m venv pc-app/.venv
pc-app/.venv/Scripts/python.exe -m pip install -r pc-app/requirements.txt
pc-app/.venv/Scripts/python.exe pc-app/main.py
```

For this workspace, Python was found at
`C:/Users/alexy/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`.
The exact bootstrap command used was:

```powershell
& C:/Users/alexy/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -m venv pc-app/.venv
```

The first run creates `%LOCALAPPDATA%/DeckRemote` with a current-user-only DACL,
a persistent `pairing-token`, `settings.json`, and a copy of the sample config.
POSIX development runs use mode 0700/0600; only Windows is the desktop target.
Edit the **copied** config there, then choose **Reload config** in the tray.
Config errors retain the last good config. Logs are JSON on the console and
exclude tokens, handshake URLs, executable paths, arguments and exception text.

Settings contain `{"host": null, "port": 8765}`. A null host is discovered from
local IPv4 interfaces when exactly one private/link-local address is available.
When there are multiple adapters, choose the Wi-Fi/Ethernet address in settings
or pass `--host <LAN-IPv4>`. `--host` and `--port` override settings for that run.
Wildcard/public binding is refused. Permit this Python process through Windows
Firewall on the Private profile if necessary. No firewall rules or router
settings are changed automatically. Both devices must be on the same trusted LAN.

Tray commands:

- **Show QR** opens an in-memory pairing image only on demand. It creates no QR file.
- **Regenerate pairing token** atomically saves and activates a new token, closes
  existing phones with 4001, and closes the obsolete QR window. Queued work cannot
  start under a revoked generation; already-started work may finish.
- **Reload config** atomically swaps trusted actions and broadcasts a full visible
  snapshot when presentation changes. Action-only edits do not bump the revision.
- **Quit** closes sockets and waits for already-started bounded scripts.

`--headless` omits the tray/QR and stops with Ctrl+C. `--data-dir` selects a dedicated
private application directory; do not point it at a shared/general-purpose folder,
because its permissions are restricted to the current user. `--config` reads a
specific trusted local config without copying it. Run one PC service per data directory.

Each config button has `id`, `label`, optional symbolic `icon`, and `action`. Only
the first three fields can reach a phone. Supported local actions:

```json
{"kind":"launch_app","path":"notepad.exe","args":[]}
{"kind":"hotkey","keys":["ctrl","c"]}
{"kind":"media","command":"play_pause","enabled":false}
{"kind":"run_script","path":"python.exe","args":["C:/your/scripts/task.py"],"timeout":20}
```

`path`, `args`, and optional `cwd` are trusted local values. Prefer absolute paths
for your own apps/scripts. There is no shell-string field or `shell=True`; batch
files require explicitly configuring their interpreter and arguments. A script
must exit 0 within its timeout (greater than 0, at most 25 seconds). On timeout the
direct child is killed and reaped; scripts must manage any descendants they spawn.
Successful app launch means process creation was accepted. Successful input means
Windows accepted SendInput; elevated target apps may reject unelevated input.

Hotkeys support Ctrl/Alt/Shift/Win, A–Z, 0–9, F1–F24, Enter/Tab/Escape/Space,
Backspace/Delete and arrow keys. Media commands are `play_pause`, `next_track`,
`previous_track`, `stop`, `volume_mute`, `volume_down`, `volume_up`.
Media is **disabled in the sample pending physical acceptance**; scripts have no
sample button and require explicit local configuration. Unknown/disabled kinds
return `unsupported_action`.

Verification:

```powershell
pc-app/.venv/Scripts/python.exe -m unittest discover -s pc-app/tests -v
pc-app/.venv/Scripts/python.exe shared/validate_protocol.py
```

Tests use real loopback WebSockets and temporary private token/config files. They
exercise actual process launch, script exit/timeout, the otherwise unused F24
key, hidden Tk QR rendering, and tray startup/shutdown on Windows. Native input tests require an interactive desktop and may be
blocked inside a sandbox. Physical phone scanning, Wi-Fi loss/recovery, two real
phones, tray visual inspection, and target-app shortcut effects remain manual QA.
No macOS/Linux desktop support is claimed.
