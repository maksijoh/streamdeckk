# protocol-agent — communication contract

## Role

Owns the stable contract between `pc-app` and `mobile-app`. This role runs
before implementation and is intentionally assigned the strongest reasoning
profile because mistakes here multiply across both applications.

## Ownership

May edit:

- `shared/protocol.md`
- `shared/protocol.types.ts`
- `shared/protocol.schema.json`
- protocol fixtures/tests under `shared/`

Do not implement PC or mobile UI/business logic.

## Locked MVP decisions

Follow `AGENTS.md` section 5. In particular:

- one JSON object per WebSocket text message;
- timestamps are Unix epoch milliseconds;
- request/ack correlation uses UUID `requestId`;
- application-level `ping`/`pong`;
- pairing token persists until explicitly regenerated;
- executable action details remain PC-side;
- invalid token is a connection failure, not `ack.error`;
- multiple clients are supported.

## Required protocol

Include a numeric `protocolVersion` in the connection/config contract. Start MVP
at version `1`.

### Client -> server: press

```json
{
  "type": "press",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "buttonId": "btn_3",
  "ts": 1737020000000
}
```

### Server -> client: ack

```json
{
  "type": "ack",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "buttonId": "btn_3",
  "ok": true,
  "error": null
}
```

For failure, `ok` is `false` and `error` is a structured object such as:

```json
{
  "code": "unknown_button",
  "message": "Button does not exist"
}
```

Minimum error codes:

- `unknown_button`
- `invalid_message`
- `action_failed`
- `unsupported_action`

Do not use `invalid_token` as an ack error.

### Server -> client: config

The server sends presentation data only:

```json
{
  "type": "config",
  "protocolVersion": 1,
  "revision": 7,
  "buttons": [
    { "id": "btn_1", "label": "Spotify", "icon": "spotify" },
    { "id": "btn_2", "label": "Mute", "icon": "mic-off" }
  ]
}
```

Do not expose executable paths, shell commands, or script bodies to the mobile
client.

### Client -> server: ping

```json
{
  "type": "ping",
  "requestId": "2f663e57-13de-4f61-81db-cfa90ef67bf5",
  "ts": 1737020000000
}
```

### Server -> client: pong

```json
{
  "type": "pong",
  "requestId": "2f663e57-13de-4f61-81db-cfa90ef67bf5",
  "ts": 1737020000123
}
```

## JSON Schema requirements

- Use a discriminated union on `type`.
- Reject missing required fields and wrong primitive types.
- Constrain IDs to non-empty strings and `requestId` to UUID format where
  practical.
- Set `additionalProperties: false` for protocol messages unless a deliberate
  forward-compatibility mechanism is documented.
- Document how an older client reacts to a newer `protocolVersion`.

## TypeScript requirements

`shared/protocol.types.ts` should export explicit message types plus unions such
as `ClientMessage` and `ServerMessage`. Avoid `any`.

## Acceptance criteria

- Human spec, TypeScript types, JSON Schema, examples, and fixtures agree.
- Both implementation agents can work without reading each other's source.
- Example messages validate against the schema.
- Invalid fixtures fail validation for the expected reason.
- No unresolved field, unit, auth, or heartbeat ambiguity remains.
