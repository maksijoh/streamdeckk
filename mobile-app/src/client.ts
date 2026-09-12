import type { Button, ClientMessage } from '../../shared/protocol.types';
import { connectionUrl, parseServerMessage, ProtocolError, type Pairing } from './protocol.ts';

export type ClientState = {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  buttons: Button[];
  notice: string;
  pending: number;
};
export type Socket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};
type Runtime = {
  socket(url: string): Socket;
  uuid(): string;
  now(): number;
  random(): number;
  later(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
};
const stopCodes = new Set([4001, 4002, 1003, 1008, 1009]);

export class DeckClient {
  state: ClientState = { status: 'disconnected', buttons: [], notice: '', pending: 0 };
  private pairing: Pairing | null = null;
  private socket: Socket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private maintenance: ReturnType<typeof setTimeout> | undefined;
  private active = true;
  private enabled = false;
  private retryIndex = 0;
  private revision: number | null = null;
  private lastValid = 0;
  private configuredAt: number | null = null;
  private nextPing = 0;
  private presses = new Map<string, { buttonId: string; sent: number }>();
  private pings = new Map<string, number>();
  private runtime: Runtime;
  private publish: (state: ClientState) => void;
  private invalidToken: () => void;

  constructor(publish: (state: ClientState) => void, invalidToken: () => void,
    runtime: Pick<Runtime, 'uuid'> & Partial<Runtime>) {
    this.publish = publish;
    this.invalidToken = invalidToken;
    this.runtime = { socket: url => new WebSocket(url) as unknown as Socket, now: () => performance.now(),
      random: Math.random, later: setTimeout, cancel: clearTimeout, ...runtime };
  }

  private update(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch, pending: this.presses.size };
    this.publish(this.state);
  }

  connect(pairing: Pairing) {
    // Validate at the single connection boundary, including restored credentials.
    connectionUrl(pairing);
    this.disconnect();
    this.pairing = { ...pairing };
    this.enabled = true;
    this.retryIndex = 0;
    if (this.active) this.open();
  }

  disconnect() {
    this.enabled = false;
    this.clearTimers();
    this.dropSocket();
    this.update({ status: 'disconnected' });
  }

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.clearTimers();
    if (!active || !this.enabled) return;
    if (this.socket) {
      // No healthy-backoff credit for time spent suspended.
      if (this.revision !== null) this.configuredAt = this.runtime.now();
      this.tick();
    } else this.open();
  }

  press(buttonId: string) {
    if (!this.active || this.state.status !== 'connected' || !this.state.buttons.some(button => button.id === buttonId)) return;
    const requestId = this.runtime.uuid();
    this.presses.set(requestId, { buttonId, sent: this.runtime.now() });
    this.update({ notice: 'Sent' });
    this.send({ type: 'press', requestId, buttonId, ts: Date.now() });
  }

  private clearTimers() {
    if (this.retry !== undefined) this.runtime.cancel(this.retry);
    if (this.maintenance !== undefined) this.runtime.cancel(this.maintenance);
    this.retry = this.maintenance = undefined;
  }

  private dropSocket(code = 1000, reason = '') {
    const old = this.socket;
    this.socket = null;
    this.revision = null;
    this.configuredAt = null;
    this.pings.clear();
    if (this.presses.size) {
      this.presses.clear();
      this.update({ notice: 'Connection lost. Action outcome unknown; presses were not replayed.' });
    }
    if (old) {
      const close = () => {
        try { old.close(code, reason); } catch { /* A closing native socket may already be gone. */ }
      };
      // RN Android cannot close before native onOpen registers the socket. If an
      // abandoned handshake succeeds before its native deadline, close it then.
      old.onopen = close;
      old.onmessage = old.onclose = old.onerror = null;
      close();
    }
  }

  private open() {
    if (!this.enabled || !this.active || !this.pairing || this.socket) return;
    this.clearTimers();
    this.update({ status: 'connecting' });
    let socket: Socket;
    try { socket = this.runtime.socket(connectionUrl(this.pairing)); }
    catch { this.fail(1006); return; }
    this.socket = socket;
    this.lastValid = this.runtime.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastValid = this.runtime.now();
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const message = parseServerMessage(event.data);
        if (this.revision === null && message.type !== 'config') throw new ProtocolError();
        if (message.type === 'ack') {
          let press = this.presses.get(message.requestId);
          if (press && this.runtime.now() - press.sent >= 30000) {
            this.presses.delete(message.requestId);
            this.update({ notice: 'Action outcome unknown. The press was not replayed.' });
            press = undefined;
          }
          if (press && press.buttonId !== message.buttonId) throw new ProtocolError();
          if (press) {
            this.presses.delete(message.requestId);
            this.update({ notice: message.ok ? 'Action accepted' : message.error.message });
          }
        } else if (message.type === 'config') {
          if (this.revision === null) {
            this.configuredAt = this.runtime.now();
            this.nextPing = this.runtime.now() + 10000;
          }
          if (this.revision === null || message.revision > this.revision) {
            this.revision = message.revision;
            this.update({ status: 'connected', buttons: message.buttons });
          }
        } else this.pings.delete(message.requestId);
        this.lastValid = this.runtime.now();
      } catch (error) { this.fail(error instanceof ProtocolError ? error.code : 1008); }
    };
    socket.onclose = event => { if (this.socket === socket) this.fail(event.code); };
    // React Native delivers onclose after onerror, including its application close code.
    // Keep the deadline as a fallback if a platform fails to deliver onclose.
    socket.onerror = () => { if (this.socket === socket) this.update({ status: 'error' }); };
    this.tick();
  }

  private send(message: ClientMessage) {
    if (!this.socket || this.socket.readyState !== 1) { this.fail(1006); return; }
    try { this.socket.send(JSON.stringify(message)); } catch { this.fail(1006); }
  }

  private tick = () => {
    this.maintenance = undefined;
    if (!this.active || !this.enabled || !this.socket) return;
    const now = this.runtime.now();
    if (now - this.lastValid >= 25000) { this.fail(1006); return; }
    for (const [id, press] of this.presses) {
      if (now - press.sent >= 30000) {
        this.presses.delete(id);
        this.update({ notice: 'Action outcome unknown. The press was not replayed.' });
      }
    }
    for (const [id, sent] of this.pings) if (now - sent >= 25000) this.pings.delete(id);
    if (this.configuredAt !== null && now - this.configuredAt >= 25000) this.retryIndex = 0;
    if (this.revision !== null && now >= this.nextPing) {
      const requestId = this.runtime.uuid();
      this.pings.set(requestId, now);
      this.nextPing = now + 10000;
      this.send({ type: 'ping', requestId, ts: Date.now() });
    }
    if (this.socket) this.maintenance = this.runtime.later(this.tick, 250);
  };

  private fail(code: number) {
    const hadPending = this.presses.size > 0;
    this.clearTimers();
    this.dropSocket(code === 1006 ? 1000 : code, code === 4002 ? 'Incompatible protocol version' : code === 1003 ? 'Binary message' : code === 1009 ? 'Message too large' : 'Invalid message');
    if (stopCodes.has(code)) {
      this.enabled = false;
      const notice = code === 4001 ? 'Pairing expired. Scan a new QR on the PC.' :
        code === 4002 ? 'Update the phone and PC apps to compatible versions.' : 'Invalid data from the PC. Check the PC app and retry.';
      this.update({ status: 'error', notice: notice + (hadPending ? ' Action outcome unknown; presses were not replayed.' : '') });
      if (code === 4001) { this.pairing = null; this.invalidToken(); }
      return;
    }
    this.update({ status: 'disconnected' });
    if (this.enabled && this.active && this.pairing) {
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retryIndex++, 5)) * (0.8 + this.runtime.random() * 0.2);
      this.retry = this.runtime.later(() => { this.retry = undefined; this.open(); }, delay);
    }
  }
}
