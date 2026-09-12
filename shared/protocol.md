# DeckRemote protocol v1 (locked)

This is the wire-format source of truth. `protocol.schema.json` describes the
JSON shapes; `protocol.types.ts` mirrors them. Semantic and connection rules
below are mandatory even where JSON Schema cannot express them. Only five
message types exist: `press`, `ack`, `config`, `ping`, and `pong`.

## Pairing, connection, and revocation

- Transport is a WebSocket on a trusted local network. MVP QR endpoints use
  `ws`, a numeric private/link-local IPv4 address, and an explicit port 1–65535.
  Private ranges are 10/8, 172.16/12, 192.168/16; link-local is 169.254/16.
  IPv6, hostnames, public addresses, userinfo, and URL fragments are unsupported.
  Tests may connect directly to loopback without using the QR scanner.
- On first run the PC creates 32 cryptographically random bytes, represented as
  unpadded base64url (43 characters, `[A-Za-z0-9_-]`). Persist the token in a
  local file accessible only to the current user before accepting clients.
  Normal restarts reuse it. Never log tokens, complete pairing/connection URLs,
  or raw handshake targets. Display the QR/token only on explicit PC-user demand.
- QR payload: `ws://<local-ip>:<port>?token=<url-encoded-token>`. Empty path and
  `/` are equivalent. The QR contains exactly one query parameter, `token`;
  reject unknown/duplicate parameters, malformed percent escapes, invalid token
  shape, missing port, or unsupported endpoint without replacing saved pairing.
- Mobile stores the normalized `ws://<ip>:<port>/` endpoint separately in
  AsyncStorage and the token only in `expo-secure-store`. On connection it adds
  `?token=<url-encoded-token>&protocolVersion=1`. The version is a canonical
  decimal query value (`1`); the JSON config also carries numeric version `1`.
- Server requires `/`, exactly one token and one protocolVersion, and no other
  query keys. Empty path is normalized to `/` by WebSocket clients. Authenticate
  with a constant-time token comparison before checking version or sending data.
  Missing/duplicate/malformed/wrong token: complete the WebSocket upgrade and
  immediately close **4001**, reason `Invalid token`, sending no JSON/config.
  With valid authentication, missing/duplicate/unsupported/noncanonical version
  or unknown query keys: close **4002**, reason `Incompatible protocol version`,
  sending no JSON/config. Invalid path: close **1008** with no config. Broken HTTP
  or WebSocket handshakes may be rejected at the HTTP layer instead.
- Do not filter handshakes by `Origin` in v1 (`websockets.serve(origins=None)`).
  Accept an absent Origin or any single Origin value permitted by the WebSocket
  library, then apply the same token/version checks above. Native clients may
  synthesize an Origin: React Native Android converts the socket endpoint to
  `http://<ip>:<port>` for `ws`. An Origin is neither proof of a native client nor
  authorization. Never authenticate using cookies, HTTP Basic credentials,
  Origin, or other browser-supplied ambient state; only the explicit pairing
  token authorizes access. Websites without that token cannot obtain config or
  execute actions. An Origin allowlist would not protect a leaked bearer token
  from a non-browser client. Adding browser sessions/cookie authentication later
  requires a separate Origin/CSRF policy review. Malformed/duplicate HTTP headers
  may still fail the library's handshake validation.
- On 4001 mobile deletes the saved secret, disables reconnect, and requests a
  fresh scan. On 4002 it preserves pairing, stops reconnect, and asks for an app
  update. A received config with a version other than 1 has the same 4002 behavior
  (check its version before full v1 schema validation). Generic network failures
  must never clear the token.
- Regeneration is an explicit local PC operation: atomically persist the new
  token, activate it, then close all connections authenticated under the old
  token with 4001. Failed persistence leaves the old token active. Check the
  connection's authentication generation again immediately before starting each
  action, so queued work from revoked clients cannot start. Work already started
  may finish; rotation cannot undo OS side effects. New connections using the
  old token must fail, including connections racing with rotation.
- `ws` exposes traffic to the local network. This MVP has no WAN listener,
  router port forwarding, cloud relay, or claim of protection on hostile Wi-Fi.

## Framing and common values

Each WebSocket **text message** is exactly one UTF-8 JSON object. Whitespace is
allowed; JSON lines, batched arrays, trailing content, NaN, and Infinity are not.
Maximum message size is **65,536 UTF-8 bytes**, in both directions. Binary
messages close with **1003**; oversized messages close with **1009**. Validate
before dispatch. Every defined object rejects additional properties.

`requestId` is a 36-character hyphenated UUID (hex digits are case-insensitive).
Clients generate a fresh random UUID for every press/ping and compare returned
IDs exactly. `ts` is an integer Unix epoch timestamp in **milliseconds**, from
0 through 9,007,199,254,740,991. It is diagnostic, not an authorization, replay,
ordering, or timeout mechanism; measure local timeouts with a monotonic clock.
Button IDs match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` and are case-sensitive.

## Messages

### Client → server: press

```json
{"type":"press","requestId":"550e8400-e29b-41d4-a716-446655440000","buttonId":"btn_1","ts":1737020000000}
```

Only the button ID identifies the action. Resolve it from the PC's trusted local
configuration; the network never supplies action types, paths, arguments,
hotkeys, scripts, or shell strings. Take one configuration snapshot when
dispatching so a local reload cannot mix button lookup with a different action.

### Server → client: ack

```json
{"type":"ack","requestId":"550e8400-e29b-41d4-a716-446655440000","buttonId":"btn_1","ok":true,"error":null}
```

```json
{"type":"ack","requestId":"550e8400-e29b-41d4-a716-446655440000","buttonId":"btn_1","ok":false,"error":{"code":"action_failed","message":"Action failed"}}
```

Each valid press gets exactly one ack on its originating connection while that
connection remains usable. Echo `requestId` and `buttonId`; never broadcast acks.
`ok: true` requires `error: null`; `ok: false` requires an error object with one
of these codes and its fixed, non-sensitive message:

| Code | Message | Meaning |
| --- | --- | --- |
| `unknown_button` | `Button does not exist` | ID absent in current PC config |
| `invalid_message` | `Invalid press message` | Correlatable but invalid press |
| `action_failed` | `Action failed` | Configured action raised/failed/timed out |
| `unsupported_action` | `Action is unsupported or disabled` | Unsupported/disabled action |

Do not include exception text, paths, commands, script output, or token data in
an ack. Never send `invalid_token` as an ack. Successful `launch_app` means the
OS accepted process creation, successful hotkey/media means the input adapter
accepted the request, and successful `run_script` means exit code 0. It does not
prove another application responded. Script timeout/nonzero exit is failure.

Mobile tracks pending presses per live connection. After 30 seconds without an
ack show outcome unknown and remove that pending entry. A late/unknown ack is
ignored; an ack for a pending ID with the wrong button ID is a protocol error.
Disconnection makes pending outcomes unknown. **Never retry or replay a press
automatically**: an action may have executed before the ack was lost. There is
no durable deduplication or exactly-once guarantee across connections. Each
received valid press is a separate execution; clients must not reuse IDs.

### Server → client: config

```json
{"type":"config","protocolVersion":1,"revision":1,"buttons":[{"id":"btn_1","label":"Music","icon":"music"},{"id":"btn_2","label":"Mute","icon":"mic-off"}]}
```

The server sends config as the **first JSON message**, immediately after valid
auth/version negotiation. No config request or hello message exists. A client
enables its deck only after validating this config. The server may later send a
complete replacement snapshot when local config changes; never send patches.

`revision` is an integer 0–9,007,199,254,740,991. It increases whenever the visible
snapshot changes within a server lifetime and may reset after restart. Always
accept the first valid snapshot on a new connection regardless of saved revision;
on the same connection apply only strictly newer snapshots. The ordered `buttons`
array contains 0–256 unique IDs. `label` is 1–80 Unicode code points. Optional
`icon` is a 1–64 character symbolic name matching `[A-Za-z0-9_-]+`; missing or
unrecognized icons render a generic fallback. No image/network URLs are icons.

Each visible button has **only** `id`, `label`, and optional `icon`. Construct
this projection using an allowlist; do not serialize local action objects and
then try to remove secrets. Duplicate button IDs are a semantic validation error.
Multiple authenticated clients independently receive the same current snapshot.
One client's actions must not block another client's receive/heartbeat handling.

### Client → server: ping; server → client: pong

```json
{"type":"ping","requestId":"2f663e57-13de-4f61-81db-cfa90ef67bf5","ts":1737020000000}
```

```json
{"type":"pong","requestId":"2f663e57-13de-4f61-81db-cfa90ef67bf5","ts":1737020000123}
```

Every valid ping gets an immediate pong on that connection with the exact same
`requestId` and the server's current timestamp. There is no ack for ping. Action
execution must not block pong processing. Client sends ping every **10 seconds**
after initial config, even when idle or when a press is pending. WebSocket control
pings are optional transport behavior and do not replace these JSON messages.

## Invalid input and connection state

- Server accepts only press/ping; client accepts only config/ack/pong. Wrong
  direction, unknown type, invalid JSON/root value, and uncorrelatable schema
  failures close **1008**, reason `Invalid message`, without executing anything.
- Exception: a JSON object with `type: "press"` and valid UUID `requestId` plus
  valid `buttonId`, but otherwise invalid shape (missing/invalid ts, extra keys,
  etc.), receives an `invalid_message` ack echoing those IDs, and stays connected.
  No action runs. A missing/invalid ID is uncorrelatable and closes 1008 instead.
- Client closes 1008 on invalid server data, duplicate config IDs, a pending ack's
  button mismatch, or any message other than config before initial config.
- A schema-valid expected-direction message updates the client's last-valid-
  message time, including an ignored late ack or old config. Invalid data never
  refreshes it. Pongs may only resolve matching outstanding ping IDs; unsolicited
  valid pongs have no other application effect.
- Start the initial 25-second deadline when WebSocket opens. After **25 seconds**
  without a valid server message (including a missing first config), close the
  local socket and reconnect. On foreground resume check staleness immediately;
  background timers cannot be assumed to run. Discard callbacks/messages from
  obsolete sockets after reconnect or a new scan.
- Transport errors, normal unexpected server closure (1000/1001), and stale
  sessions reconnect while pairing exists and the app is active. On retry index
  `n` starting at 0, wait `min(30000, 1000 * 2^min(n, 5)) * U[0.8,1.0]` ms.
  Thus delay has jitter and never exceeds **30 seconds**. Reset `n` only after
  **25 seconds** of a healthy configured connection to avoid rapid failure loops.
  Maintain one socket and one retry timer; explicit disconnect or replacing a
  pairing cancels both. A fresh scan/explicit retry may connect immediately.
- Codes 4001/4002 and protocol failures 1003/1008/1009 stop automatic reconnect
  and show a useful error. Keep pairing except on 4001. Local user disconnect
  never reconnects. Other closures/errors use normal network backoff.

## Validation

Install `shared/requirements-test.txt`, then run
`python shared/validate_protocol.py` from the repository root. The check validates
the schema itself, every valid example, every invalid fixture against its expected
schema keyword, message-direction definitions, UUIDs, and unique config IDs.
Implementations must additionally test the connection/state rules above.

Origin handshake regression cases (PC integration tests): repeat each row with
Origin absent, `http://127.0.0.1:<test-port>` (native Android style), and
`https://untrusted.example`. Use a loopback test server and do not log tokens.

| Query credentials | Expected result for every Origin variant |
| --- | --- |
| Valid token, version 1 | Upgrade, then first message is config |
| Missing or wrong token, version 1 | Upgrade, close 4001, no config |
| Valid token, unsupported version | Upgrade, close 4002, no config |

A Cookie or HTTP Authorization header alone must never replace the query token.
