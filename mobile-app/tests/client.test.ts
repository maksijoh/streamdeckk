import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { DeckClient, type Socket } from '../src/client.ts';
import { connectionUrl, parseQr, parseServerMessage, ProtocolError } from '../src/protocol.ts';

const token = 'a'.repeat(43);
const pairing = { endpoint: 'ws://192.168.1.2:8765/', token };
const config = (revision = 1) => ({ type: 'config', protocolVersion: 1, revision, buttons: [{ id: 'btn_1', label: 'Music' }] });
const requestId = '550e8400-e29b-41d4-a716-446655440000';
const pong = { type: 'pong', requestId, ts: 1 };
const ack = (requestId: string, buttonId = 'btn_1') => ({ type: 'ack', requestId, buttonId, ok: true, error: null });

class FakeSocket implements Socket {
  readyState = 0;
  onopen: Socket['onopen'] = null;
  onmessage: Socket['onmessage'] = null;
  onclose: Socket['onclose'] = null;
  onerror: Socket['onerror'] = null;
  sent: Record<string, unknown>[] = [];
  closes: number[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close(code = 1000) { this.readyState = 3; this.closes.push(code); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  closed(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function harness() {
  let now = 0;
  let sequence = 0;
  let timerId = 0;
  let revoked = 0;
  const sockets: FakeSocket[] = [];
  const delays: number[] = [];
  const timers = new Map<number, { when: number; callback: () => void }>();
  const client = new DeckClient(() => undefined, () => { revoked++; }, {
    now: () => now, random: () => 0.5, uuid: () => `550e8400-e29b-41d4-a716-${String(++sequence).padStart(12, '0')}`,
    socket: url => { assert.equal(url, connectionUrl(pairing)); const socket = new FakeSocket(); sockets.push(socket); return socket; },
    later: (callback, delay) => { delays.push(delay); const id = ++timerId; timers.set(id, { when: now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: id => { timers.delete(id as unknown as number); },
  });
  function advance(ms: number) {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].when - b[1].when)[0];
      if (!next || next[1].when > end) break;
      now = next[1].when; timers.delete(next[0]); next[1].callback();
    }
    now = end;
  }
  function start() { client.connect(pairing); const socket = sockets.at(-1)!; socket.open(); socket.message(config()); return socket; }
  return { client, sockets, timers, delays, advance, start, revoked: () => revoked };
}

test('QR normalizes supported LAN endpoints and percent-encoded token', () => {
  for (const host of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.2', '169.254.4.1']) {
    assert.deepEqual(parseQr(`ws://${host}:8765?token=${token}`), { endpoint: `ws://${host}:8765/`, token });
  }
  assert.deepEqual(parseQr(`ws://192.168.1.2:08765/?token=%61${token.slice(1)}`), pairing);
  assert.equal(connectionUrl(pairing), `${pairing.endpoint}?token=${token}&protocolVersion=1`);
});

test('QR rejects public, alternate addresses, malformed and extra fields', () => {
  const hosts = ['127.0.0.1', '8.8.8.8', 'localhost', '[::1]', '3232235778', '0xc0a80102', '192.168.01.2', '192.168.1.256', '172.32.0.1', '169.253.1.1'];
  for (const host of hosts) assert.throws(() => parseQr(`ws://${host}:8765?token=${token}`));
  for (const raw of [
    `wss://192.168.1.2:8765?token=${token}`, `ws://192.168.1.2?token=${token}`, `ws://user@192.168.1.2:8765?token=${token}`,
    `ws://192.168.1.2:0?token=${token}`, `ws://192.168.1.2:65536?token=${token}`, `ws://192.168.1.2:8765/x?token=${token}`,
    `${pairing.endpoint}?token=${token}&token=${token}`, `${pairing.endpoint}?token=${token}&protocolVersion=1`,
    `${pairing.endpoint}?token=${token}#x`, `${pairing.endpoint}?token=%QZ`, `${pairing.endpoint}?token=short`,
    `${pairing.endpoint}?token=${token}\n`, `${pairing.endpoint}?token=${token}%`, `${pairing.endpoint}?unknown=${token}`,
  ]) assert.throws(() => parseQr(raw));
});

test('restored endpoint is revalidated at the connection boundary', () => {
  const h = harness();
  for (const endpoint of ['ws://8.8.8.8:8765/', 'ws://127.0.0.1:8765/', 'ws://192.168.1.2/', 'ws://192.168.1.2:8765', 'ws://192.168.1.2:8765/?x=y']) {
    assert.throws(() => h.client.connect({ endpoint, token }));
  }
  assert.equal(h.sockets.length, 0);
});

test('runtime validator agrees with all shared wire fixtures and direction', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../../shared/fixtures.json', import.meta.url), 'utf8'));
  for (const value of fixtures.valid) {
    if (['config', 'ack', 'pong'].includes(value.type)) assert.deepEqual(parseServerMessage(JSON.stringify(value)), value);
    else assert.throws(() => parseServerMessage(JSON.stringify(value)), ProtocolError);
  }
  for (const fixture of fixtures.invalid) assert.throws(() => parseServerMessage(JSON.stringify(fixture.message)), ProtocolError, fixture.name);
});

test('validation covers binary, UTF-8 size, duplicate IDs, line endings and versions', () => {
  assert.throws(() => parseServerMessage(new Uint8Array()), { code: 1003 });
  assert.throws(() => parseServerMessage(' '.repeat(65537)), { code: 1009 });
  assert.throws(() => parseServerMessage('😀'.repeat(16385)), { code: 1009 });
  const value = JSON.stringify(config());
  assert.deepEqual(parseServerMessage(value + ' '.repeat(65536 - value.length)), config());
  assert.throws(() => parseServerMessage(JSON.stringify({ ...config(), buttons: [config().buttons[0], config().buttons[0]] })), { code: 1008 });
  for (const suffix of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => parseServerMessage(JSON.stringify({ ...config(), buttons: [{ id: `btn_1${suffix}`, label: 'x' }] })), { code: 1008 });
  }
  assert.throws(() => parseServerMessage('{"type":"config","protocolVersion":2}'), { code: 4002 });
  assert.throws(() => parseServerMessage('{}\n{}'), { code: 1008 });
  assert.doesNotThrow(() => parseServerMessage(JSON.stringify({ ...config(), buttons: [{ id: 'x', label: '😀'.repeat(80) }] })));
});

test('first config gates presses and resets revision on a new connection', () => {
  const h = harness(); h.client.connect(pairing); const first = h.sockets[0]; first.open();
  h.client.press('btn_1'); assert.equal(first.sent.length, 0);
  first.message(config(20)); first.message({ ...config(19), buttons: [] });
  assert.equal(h.client.state.buttons.length, 1);
  first.closed(); h.advance(900); const second = h.sockets[1]; second.open(); second.message(config(0));
  assert.equal(h.client.state.status, 'connected');
  second.message({ ...config(1), buttons: [] }); assert.equal(h.client.state.buttons.length, 0);
});

test('ack before config and wrong-direction input stop reconnect with 1008', () => {
  for (const value of [pong, ack(requestId), { type: 'ping', requestId, ts: 1 }]) {
    const h = harness(); h.client.connect(pairing); h.sockets[0].open(); h.sockets[0].message(value);
    assert.deepEqual(h.sockets[0].closes, [1008]); h.advance(100000); assert.equal(h.sockets.length, 1);
  }
});

test('rapid presses correlate independently; failures and late acks are safe', () => {
  const h = harness(); const socket = h.start(); h.client.press('btn_1'); h.client.press('btn_1');
  assert.equal(h.client.state.pending, 2);
  const ids = socket.sent.map(message => message.requestId as string); assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(Object.keys(socket.sent[0]).sort(), ['buttonId', 'requestId', 'ts', 'type']);
  socket.message(ack(ids[1])); assert.equal(h.client.state.pending, 1);
  socket.message({ ...ack(ids[0]), ok: false, error: { code: 'action_failed', message: 'Action failed' } });
  assert.equal(h.client.state.pending, 0); assert.equal(h.client.state.notice, 'Action failed');
  socket.message(ack(ids[0], 'other')); assert.equal(h.client.state.status, 'connected');
});

test('pending ack with a mismatched button is a protocol failure', () => {
  const h = harness(); const socket = h.start(); h.client.press('btn_1'); socket.message(ack(socket.sent[0].requestId as string, 'other'));
  assert.deepEqual(socket.closes, [1008]); assert.equal(h.client.state.pending, 0);
});

test('30-second timeout is unknown and never replays; ignored acks refresh health', () => {
  const h = harness(); const socket = h.start(); h.client.press('btn_1'); const id = socket.sent[0].requestId as string;
  for (let i = 0; i < 3; i++) { h.advance(10000); socket.message(ack(requestId)); }
  assert.equal(h.client.state.pending, 0); assert.match(h.client.state.notice, /unknown/);
  socket.message(ack(id)); assert.match(h.client.state.notice, /unknown/);
  socket.closed(); h.advance(900); h.sockets[1].open(); h.sockets[1].message(config());
  assert.equal(h.sockets[1].sent.length, 0);
});

test('disconnect marks pending unknown and discards obsolete callbacks', () => {
  const h = harness(); const first = h.start(); h.client.press('btn_1'); const obsolete = first.onmessage!;
  h.client.connect(pairing); const second = h.sockets[1]; second.open(); second.message(config());
  obsolete({ data: JSON.stringify({ ...config(99), buttons: [] }) });
  assert.equal(h.client.state.buttons.length, 1); assert.equal(h.client.state.pending, 0); assert.match(h.client.state.notice, /unknown/);
  h.client.disconnect(); h.advance(100000); assert.equal(h.sockets.length, 2); assert.equal(h.timers.size, 0);
});

test('a cancelled native handshake that opens late is immediately closed', () => {
  const h = harness();
  h.client.connect(pairing);
  const old = h.sockets[0];
  h.client.connect(pairing);
  const current = h.sockets[1];
  current.open(); current.message(config());
  // RN ignores the first native close while connecting; emulate its late upgrade.
  old.open();
  assert.equal(old.readyState, 3);
  assert.deepEqual(old.closes, [1000, 1000]);
  assert.equal(current.readyState, 1);
  assert.equal(h.client.state.status, 'connected');
  h.client.disconnect();
  assert.equal(h.timers.size, 0);
});

test('10-second heartbeat starts after config; 25-second stale deadline reconnects', () => {
  const h = harness(); h.client.connect(pairing); const socket = h.sockets[0]; socket.open(); h.advance(10000);
  assert.equal(socket.sent.length, 0); socket.message(config()); h.advance(10000);
  assert.equal(socket.sent[0].type, 'ping'); socket.message({ ...pong, requestId: socket.sent[0].requestId });
  h.advance(25000); assert.equal(h.client.state.status, 'disconnected');
  h.advance(900); assert.equal(h.sockets.length, 2);
});

test('missing first config times out; background suspends timers and foreground checks immediately', () => {
  const h = harness(); h.client.connect(pairing); h.sockets[0].open(); h.advance(25000);
  assert.equal(h.client.state.status, 'disconnected'); h.advance(900);
  const socket = h.sockets[1]; socket.open(); socket.message(config());
  h.client.setActive(false); assert.equal(h.timers.size, 0); h.advance(30000); h.client.press('btn_1'); assert.equal(socket.sent.length, 0);
  h.client.setActive(true); assert.equal(socket.readyState, 3); assert.equal(h.client.state.status, 'disconnected');
  h.advance(1800); assert.equal(h.sockets.length, 3);
});

test('backoff grows across brief configured connections and resets after 25 healthy seconds', () => {
  const h = harness(); h.start();
  for (const delay of [900, 1800, 3600, 7200, 14400, 27000, 27000]) {
    h.sockets.at(-1)!.closed(); assert.equal(h.delays.at(-1), delay); h.advance(delay);
    const socket = h.sockets.at(-1)!; socket.open(); socket.message(config());
  }
  for (let i = 0; i < 5; i++) { h.advance(5000); h.sockets.at(-1)!.message(pong); }
  h.sockets.at(-1)!.closed(); assert.equal(h.delays.at(-1), 900);
});

test('terminal closures stop retries; only 4001 revokes pairing', () => {
  for (const code of [4001, 4002, 1003, 1008, 1009]) {
    const h = harness(); h.start().closed(code); h.advance(100000); h.client.setActive(false); h.client.setActive(true);
    assert.equal(h.sockets.length, 1); assert.equal(h.revoked(), code === 4001 ? 1 : 0); assert.equal(h.timers.size, 0);
  }
  const h = harness(); h.start().message({ type: 'config', protocolVersion: 2 });
  assert.deepEqual(h.sockets[0].closes, [4002]); assert.equal(h.revoked(), 0);
});

test('normal unexpected close reconnects; native error waits for auth close code', () => {
  for (const code of [1000, 1001, 1006]) {
    const h = harness(); h.start().closed(code); h.advance(900); assert.equal(h.sockets.length, 2);
  }
  const h = harness(); const socket = h.start(); socket.onerror?.(); socket.closed(4001);
  h.advance(100000); assert.equal(h.revoked(), 1); assert.equal(h.sockets.length, 1);
});

test('Android plugin bounds opening handshakes without changing established read timeout', () => {
  const { disableRedirects }: { disableRedirects: (source: string) => string } = createRequire(import.meta.url)('../plugins/withNoWebSocketRedirects.cjs');
  const source = 'package app.deckremote.mobile\nclass MainApplication {\n  override fun onCreate() {\n    super.onCreate()\n    loadReactNative(this)\n  }\n}';
  const output = disableRedirects(source);
  assert.match(output, /import com.facebook.react.modules.websocket.WebSocketModule/);
  assert.match(output, /followRedirects\(false\).followSslRedirects\(false\)/);
  assert.match(output, /\.callTimeout\(20, java\.util\.concurrent\.TimeUnit\.SECONDS\)/);
  assert.doesNotMatch(output, /readTimeout|pingInterval/);
  assert.ok(output.indexOf('setCustomClientBuilder') < output.indexOf('loadReactNative'));
  assert.equal(disableRedirects(output), output);
  const previousOutput = output.replace('.callTimeout(20, java.util.concurrent.TimeUnit.SECONDS)', '');
  assert.equal(disableRedirects(previousOutput), output);
  assert.equal(output.match(/setCustomClientBuilder/g)?.length, 1);
  assert.equal(output.match(/import com.facebook.react.modules.websocket.WebSocketModule/g)?.length, 1);
  assert.throws(() => disableRedirects('class MainApplication {}'));
  assert.throws(() => disableRedirects(output.replace('override fun onCreate()', 'fun renamedEntryPoint()')));
});
