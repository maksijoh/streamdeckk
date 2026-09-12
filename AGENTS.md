# AGENTS.md — DeckRemote

This file is the orchestration entry point for Codex and its subagents.
DeckRemote is a local-network Stream Deck analogue: a mobile app displays a
button deck and sends button presses to a PC app, which executes only actions
already defined in the PC-side configuration.

## 1. Product scope

Repository layout:

```text
deckremote/
├── pc-app/                 # Python PC service
├── mobile-app/             # Expo / React Native client
├── shared/                 # protocol specification + generated/shared schemas
├── agents/                 # human-readable role specifications
├── .codex/agents/          # Codex custom-agent model profiles
└── docs/
```

MVP goals:

- Pair a phone with the PC by scanning a QR code.
- Connect over WebSocket on the same local network.
- Pull the visible deck configuration from the PC.
- Pressing a phone button executes the mapped PC-side action.
- MVP actions: `launch_app`, `hotkey`, `media`, `run_script`.
- Reconnect automatically after temporary network loss.
- Keep action implementation and dangerous command details on the PC.
- Primary MVP desktop target: Windows 10/11. Keep action interfaces portable,
  but do not claim macOS/Linux support until those platforms are tested.

Out of scope for MVP:

- Cloud relay or internet-accessible server.
- Editing action commands from the phone.
- Remote execution of arbitrary shell strings received from the network.
- User accounts, cloud sync, or WAN discovery.

## 2. Source-of-truth hierarchy

When instructions conflict, use this order:

1. `shared/protocol.md` for wire-format behavior.
2. `shared/protocol.schema.json` for machine validation of protocol messages.
3. This `AGENTS.md` for project-wide architecture and orchestration.
4. The relevant `agents/*.md` file for role-specific implementation guidance.
5. Existing code and tests.

If code conflicts with the locked protocol, update the code. Do not silently
change the protocol to accommodate one implementation.

## 3. Model routing policy

Use custom agents from `.codex/agents/` when available. Spend the strongest
reasoning on decisions that affect the whole system; use faster models for
bounded inspection and repetitive validation.

| Work | Preferred agent | Priority |
|---|---|---|
| Protocol, data contract, pairing/auth design | `protocol_architect` | Highest |
| Security review / dangerous execution paths | `security_reviewer` | Highest |
| Final cross-component review and release decision | `integration_reviewer` | Highest |
| PC implementation | `pc_implementer` | High |
| Mobile implementation | `mobile_implementer` | High |
| End-to-end QA design and failure analysis | `qa_engineer` | High |
| Repository exploration / dependency tracing | `repo_explorer` | Medium |
| Documentation/API verification | `docs_researcher` | Medium |
| Repetitive test execution / mechanical checks | `test_runner` | Low |

Escalation rule: if a faster agent reports ambiguity, protocol impact,
security impact, repeated test failures, or an architectural choice, return the
decision to `protocol_architect`, `security_reviewer`, or
`integration_reviewer` rather than guessing.

Do not use a high-cost reasoning agent merely to enumerate files, rerun a known
test command, reformat code, or perform another deterministic/mechanical task.

## 4. Required order of work

### Phase A — protocol lock

`protocol_architect` works first and owns `shared/` until the initial contract
is complete.

Required outputs:

- `shared/protocol.md`
- `shared/protocol.types.ts`
- `shared/protocol.schema.json`
- at least one valid example for every message type
- protocol validation tests or fixtures

No PC/mobile implementation should invent a missing message field. If a needed
message is absent, stop that part of implementation and route the change back
to `protocol_architect`.

### Phase B — implementation in parallel

After the protocol is locked:

- `pc_implementer` may edit `pc-app/**`.
- `mobile_implementer` may edit `mobile-app/**`.
- Neither may edit `shared/**` without explicit protocol-change approval.

Because these scopes are disjoint, PC and mobile work may proceed in parallel.

### Phase C — QA and security

Once one end-to-end button works:

- `qa_engineer` validates end-to-end behavior and failure scenarios.
- `security_reviewer` reviews token handling, network exposure, config handling,
  and all action execution paths.

### Phase D — integration review

`integration_reviewer` checks the final state against the Definition of Done,
protocol, tests, and unresolved QA/security findings. It is the final technical
arbiter before the MVP is considered complete.

## 5. Locked architectural decisions for MVP

### 5.1 Pairing token

- The PC creates a cryptographically random pairing token on first run.
- The token persists locally across normal PC-app restarts.
- The user can explicitly regenerate the token from the PC app to revoke paired
  clients.
- The QR payload is:

```text
ws://<local-ip>:<port>?token=<url-encoded-token>
```

- The mobile app stores the endpoint separately from the token.
- Store the token in `expo-secure-store`; non-secret connection metadata may be
  stored in AsyncStorage.
- If the token is rejected, the mobile app clears the stale secret and asks the
  user to scan a new QR code.

This decision intentionally supports auto-reconnect after either app restarts.

### 5.2 WebSocket message framing

Each WebSocket **text message** contains exactly one UTF-8 JSON object. Do not
use newline-delimited framing inside WebSocket messages.

### 5.3 Time

All protocol timestamps use Unix epoch **milliseconds** as integers. JavaScript
`Date.now()` is valid.

### 5.4 Request correlation

Every command that expects an acknowledgement carries a `requestId` UUID. The
matching `ack` repeats that `requestId`.

### 5.5 Heartbeat

Use application-level `ping` / `pong` JSON messages because React Native does
not expose WebSocket control-frame ping APIs consistently.

Default behavior:

- client sends `ping` every 10 seconds while connected;
- server replies with `pong` carrying the same `requestId`;
- client treats a connection as stale if it has not received a valid message
  for 25 seconds;
- reconnect with exponential backoff capped at 30 seconds, with small jitter.

### 5.6 Visible config vs executable config

The phone receives only presentation data needed to render buttons, e.g.
`id`, `label`, `icon`, optional visual metadata. The PC remains the source of
truth for executable actions (`path`, hotkeys, scripts, media command).

A phone button press sends only the button identity and request metadata. It
never sends a shell command or executable path.

### 5.7 Multiple clients

Multiple paired phones are supported in the MVP. Each client receives the
current visible config. Press acknowledgements are correlated per request.

### 5.8 Protocol authentication failure

An invalid token is a connection/authentication failure, not a normal `ack`
error. The server rejects/closes the connection with an application close code
and must not send configuration data first.

Suggested close codes:

- `4001` — invalid token
- `4002` — incompatible protocol version

## 6. Engineering rules

- Prefer small, reviewable changes.
- Keep secrets out of logs.
- Log connection lifecycle and incoming `press` metadata on the PC, but never
  log the pairing token.
- Never execute an arbitrary command string received from the network.
- `run_script` may execute only the PC-side action already mapped to the pressed
  `buttonId` in trusted local configuration.
- Validate all untrusted incoming JSON before dispatch.
- Handle unknown message types and malformed input without crashing.
- Do not hardcode LAN IP addresses or machine-specific executable paths in
  source code.
- Keep dependencies pinned in the project dependency files.
- Add tests for every bug fixed in protocol or execution logic when practical.
- Do not let subagents recursively create more agents unless the parent task
  explicitly requires it.

## 7. Definition of Done — MVP

The MVP is complete only when all of the following are true:

- PC app starts cleanly and exposes a QR code on demand.
- A phone scans the QR and connects with a valid token.
- Invalid tokens are rejected before config is sent.
- The phone displays real button data received from the PC.
- Pressing a button executes the correct configured action on the PC.
- At least `launch_app` and `hotkey` are proven end-to-end; `media` and
  `run_script` either pass their acceptance tests or are explicitly disabled.
- Every `press` receives a correlated `ack` on success/failure.
- Wi-Fi loss and recovery reconnect automatically without restarting either app.
- A PC-app restart allows a previously paired phone to reconnect using the
  persistent pairing token.
- Token regeneration invalidates old clients.
- Two phones can connect simultaneously without cross-wiring acknowledgements.
- Malformed JSON, unknown button IDs, action failures, and invalid QR payloads
  do not crash either app.
- Security review has no unresolved critical/high finding.
- End-to-end QA passes or every remaining failure is documented and accepted by
  the parent agent/user.

## 8. Completion reporting

Every implementation/review agent returns:

1. files changed or inspected;
2. tests run and exact result;
3. assumptions made;
4. remaining risks or TODOs;
5. whether the protocol was changed (normally `no`).

Never report success without running the relevant available tests. If a test
cannot be run, state exactly why.
