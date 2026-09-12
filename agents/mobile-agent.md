# mobile-agent — Expo client

## Role

Implements the untrusted display/control client on the phone: QR pairing,
secure token storage, WebSocket connection/reconnection, visible button grid,
press feedback, and connection status.

The mobile app does not author or receive executable PC action commands in the
MVP.

## Stack

- Expo managed workflow + TypeScript
- `expo-camera` for QR scanning
- `expo-secure-store` for the pairing token
- AsyncStorage for non-secret endpoint/UI metadata if persistence is needed
- built-in React Native `WebSocket`
- one navigation approach only: prefer `expo-router` unless the repository has
  already standardized on React Navigation
- lightweight state: Zustand or React Context; use one, not both
- `@react-native-vector-icons`/Expo-supported icon package already compatible
  with the selected Expo SDK

Pin versions compatible with the repository's Expo SDK.

## Suggested structure

```text
mobile-app/
├── app/
│   ├── pairing.tsx
│   └── deck.tsx
├── src/
│   ├── ws/
│   │   ├── client.ts
│   │   └── protocol.ts
│   ├── storage/
│   │   └── pairing.ts
│   ├── store/
│   │   └── deckStore.ts
│   └── components/
│       ├── DeckButton.tsx
│       └── DeckGrid.tsx
└── app.json
```

## Tasks

### 1. Pairing

- Request camera permission with a clear denied-permission state.
- Scan QR using `expo-camera`.
- Accept only the documented DeckRemote `ws://<ip>:<port>?token=...` payload.
- Validate scheme, host, numeric port, and non-empty token before storing.
- Store token in SecureStore.
- Store non-secret endpoint metadata separately.
- Never print the QR payload/token to production logs.
- Connect immediately after successful validation.

If server auth closes with code `4001`, clear the stale token and route the user
back to pairing.

### 2. WebSocket client

Implement a wrapper with explicit lifecycle methods/events instead of spreading
raw WebSocket logic through UI components.

Required behavior:

- `connect()` / `disconnect()`
- `send(message)` only while socket state allows it
- parse one JSON object per WebSocket text message
- validate/narrow message types before state updates
- status: `connecting | connected | disconnected | error`
- app-level heartbeat: send `ping` every 10 seconds while connected
- consider connection stale after 25 seconds without a valid incoming message
- exponential reconnect delays approximately `1, 2, 4, 8, 16, 30` seconds,
  capped at 30 seconds, with small jitter
- cancel timers when disconnected/unmounted
- avoid multiple concurrent reconnect loops

On app foreground (`AppState`), verify socket health and reconnect when needed.

### 3. Deck screen

- Render the server-provided visible buttons responsively across common phone
  sizes.
- On `config`, replace/update visible button state using its `revision`.
- Ignore stale config revisions within one server session when detectable.
- On press:
  - create UUID `requestId`;
  - send `press` with `buttonId`, `requestId`, and `ts: Date.now()`;
  - show immediate pressed feedback without waiting for ack;
  - track pending request IDs so rapid repeated presses of the same button are
    not confused.
- On a failed ack, surface a concise toast/button error and clear that request
  from pending state.

### 4. No mobile action editor in MVP

Do not add `update_button` or let the phone edit paths, commands, hotkeys, or
scripts. If product scope later requires mobile editing, route the proposal
through the protocol architect first.

### 5. UX

- Dark theme by default is acceptable, but keep colors/theme centralized.
- Show an unobtrusive disconnected/reconnecting banner.
- Pairing errors must be actionable and must not crash the app.
- Ensure safe-area and orientation behavior is reasonable.

## Acceptance criteria

- QR scan -> secure save -> connect -> receive real visible config -> render
  grid -> press -> correlated ack works.
- Rapid repeated presses are correlated by requestId.
- Wi-Fi off/on recovers without app restart.
- PC restart reconnects with the persisted token.
- Invalid/stale token returns the user to pairing.
- Invalid QR and malformed server data do not crash the app.
- No executable action string/path/script is stored or edited by the mobile app.
