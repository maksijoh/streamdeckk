# pc-agent — PC service

## Role

Implements the trusted PC side: authentication, WebSocket server, local button
configuration, action dispatch, QR pairing display, logging, and tray lifecycle.

Primary MVP target: Windows 10/11. Keep platform-specific action code behind
small adapters so macOS/Linux may be added later without changing the protocol.

## Stack

- Python 3.11+
- `websockets` using the current asyncio API
- `jsonschema` for validating incoming JSON against
  `shared/protocol.schema.json`
- `pystray` + `Pillow` for tray UI
- `qrcode` for pairing QR generation
- `keyboard` and/or platform adapter code for hotkeys/media on Windows
- standard-library `subprocess`, `secrets`, `json`, `pathlib`, `logging`

Pin dependency versions in the dependency file.

## Suggested structure

```text
pc-app/
├── main.py
├── server.py
├── protocol.py
├── pairing.py
├── config.py
├── config.json
├── actions/
│   ├── __init__.py
│   ├── launch_app.py
│   ├── hotkey.py
│   ├── media.py
│   └── run_script.py
└── tests/
```

## Tasks

### 1. Startup and lifecycle

- Load or create application settings.
- Load the persistent pairing token; if missing, generate it using
  `secrets.token_urlsafe()` or equivalent cryptographically secure randomness
  and persist it with user-only permissions where the OS permits.
- Determine the current LAN address and configured port.
- Start the WebSocket server without blocking the tray/UI lifecycle.
- Provide tray actions: `Show QR`, `Regenerate pairing token`, `Reload config`,
  `Quit`.
- Shut down server tasks, client sockets, and tray resources cleanly.

### 2. Authentication

- Validate the `token` query parameter before sending config.
- Use constant-time comparison for secrets where practical.
- On invalid token, close/reject using application close code `4001`.
- Never write the token to logs.
- Token regeneration must invalidate subsequent connections using the old token
  and disconnect currently paired clients if required by the chosen
  implementation; document the exact behavior.

### 3. Protocol handling

Read `shared/protocol.md` before implementation.

- Parse each WebSocket text message as one JSON object.
- Validate untrusted messages with `shared/protocol.schema.json` before
  dispatch.
- `press`: look up `buttonId` in the trusted PC config, execute its mapped
  action, return correlated `ack` with the same `requestId`.
- `ping`: return `pong` with the same `requestId`.
- malformed messages: return a protocol error when safe, or close the
  connection if framing/validation makes a response unreliable.
- never crash the server loop because one client sent bad input.

### 4. Config separation

The local `config.json` may include executable action data, for example:

```json
{
  "id": "btn_1",
  "label": "Spotify",
  "icon": "spotify",
  "action": {
    "kind": "launch_app",
    "path": "C:/Program Files/Spotify/Spotify.exe"
  }
}
```

When producing the protocol `config` message, project this down to presentation
fields only. Do not send action paths, hotkey internals, shell commands, or
script bodies to the phone.

Use a monotonic integer `revision` for visible config updates within the running
app. Push updated visible config to all clients after a successful reload.

### 5. Actions

Use a single dispatcher from `action.kind` to small action-specific functions.

- `launch_app`: launch only the PC-side configured path/target.
- `hotkey`: execute only the configured key combination.
- `media`: map an enum-like configured command to supported media key actions.
- `run_script`: execute only a script/command already stored in trusted local
  config. Never accept a command string from a WebSocket message.

Capture exceptions at the dispatch boundary and convert them to
`ack.error.code = "action_failed"`; log diagnostic details server-side without
leaking secrets to the client.

### 6. Network behavior

- Bind to the configured LAN interface/address, not a hardcoded IP.
- If binding to all interfaces is ever allowed, make it an explicit setting and
  show a security warning.
- Support multiple simultaneous clients.
- Keep per-client request handling isolated so one slow/failing client does not
  block all others.

### 7. Logging

Log:

- app start/stop;
- bind address and port;
- client connect/disconnect without token;
- validated `press` requestId/buttonId;
- action success/failure;
- config reload and revision.

Never log pairing tokens or complete secret-bearing QR payloads.

## Acceptance criteria

- Starts and shuts down cleanly.
- Shows a usable QR code.
- Valid token connects; invalid token is rejected before config.
- Sends visible config without executable action details.
- `launch_app` and `hotkey` work end-to-end on the target Windows environment.
- Every press gets the correctly correlated ack.
- Multiple clients are supported.
- Malformed input and action failures do not crash the service.
- `run_script` cannot be supplied or overridden by network input.
