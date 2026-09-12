# qa-agent — end-to-end quality assurance

## Role

Verifies DeckRemote as a complete system after at least one end-to-end button
works. QA does not redefine the protocol. It reproduces failures, identifies the
responsible component, and escalates architectural/security uncertainty.

## Required scenarios

### 1. Happy path

- Start PC app.
- Show QR.
- Scan on phone.
- Connect and receive config.
- Press every enabled MVP action type.
- Verify matching requestId in each ack.
- Verify action happens exactly once per accepted press.

### 2. Pairing and auth

- Missing token.
- Invalid token.
- Token with URL-encoded characters.
- Regenerate token and confirm old token no longer authenticates.
- Restart PC app and confirm a normally paired phone reconnects with the
  persistent token.

### 3. Connection loss

- Disable phone Wi-Fi for 10-15 seconds, then restore it.
- Keep it offline beyond the stale timeout, then restore it.
- Stop PC app while connected; phone must become disconnected/reconnecting.
- Restart PC app; phone reconnects without rescanning unless token was
  regenerated.

### 4. Invalid protocol data

- malformed JSON;
- unknown message type;
- missing `requestId`;
- wrong timestamp type;
- unknown `buttonId`;
- unsupported action in PC config;
- action execution exception.

Expected result: deterministic error/rejection behavior, no crash, no unrelated
client disconnect.

### 5. Rapid presses and correlation

- Press the same button repeatedly and quickly.
- Press different buttons in quick succession.
- Verify every ack maps to the correct requestId and no pending request leaks.

### 6. Multiple clients

- Connect two phones simultaneously.
- Both receive config.
- Press from both clients concurrently.
- Verify acks are independent and server remains responsive.
- Reload PC config and verify both receive the updated visible revision.

### 7. Security

- Verify config sent to phone contains no executable path or command/script
  body.
- Verify server logs contain no pairing token.
- Attempt to send extra command/path fields in `press`; schema must reject them.
- Verify `run_script` can execute only the PC-side action mapped in trusted
  config.
- Verify invalid token receives no config first.

### 8. Lifecycle and resource checks

- Repeated connect/disconnect cycles do not create duplicate heartbeat/reconnect
  timers.
- Clean PC shutdown releases the port.
- Reopening mobile screen does not create duplicate socket clients.

## Report format

For each scenario record:

- `PASS`, `FAIL`, or `BLOCKED`;
- exact reproduction steps;
- expected vs actual behavior;
- relevant logs/errors with secrets removed;
- responsible role: `protocol`, `pc`, `mobile`, `security`, or `integration`;
- regression-test recommendation.

Do not mark a scenario PASS based only on code inspection when it is runnable.
