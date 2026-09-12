import type { ServerMessage } from '../../shared/protocol.types';

export type Pairing = { endpoint: string; token: string };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors: Record<string, string> = {
  unknown_button: 'Button does not exist',
  invalid_message: 'Invalid press message',
  action_failed: 'Action failed',
  unsupported_action: 'Action is unsupported or disabled',
};

export function parseQr(raw: string): Pairing {
  // Parse the literal host before URL normalization can accept alternate IPv4 forms.
  const match = /^ws:\/\/(\d+\.\d+\.\d+\.\d+):(\d+)(?:\/)?\?([^#\s]+)$/.exec(raw);
  if (!match || match[0] !== raw) throw new Error('Scan a DeckRemote QR from your PC on the same Wi-Fi.');
  const [, host, portText, query] = match;
  const octets = host.split('.').map(Number);
  const [a, b] = octets;
  const port = Number(portText);
  if (octets.some((n, i) => n > 255 || String(n) !== host.split('.')[i]) ||
      !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) ||
      !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The QR must use a local IPv4 address and valid port.');
  const parts = query.split('=');
  if (parts.length !== 2 || query.includes('&')) throw new Error('Invalid pairing QR. Generate a new QR on the PC.');
  let key: string;
  let token: string;
  try { key = decodeURIComponent(parts[0]); token = decodeURIComponent(parts[1]); }
  catch { throw new Error('Invalid pairing QR. Generate a new QR on the PC.'); }
  if (key !== 'token' || !tokenPattern.test(token) || token.length !== 43) throw new Error('Invalid pairing token. Generate a new QR on the PC.');
  return { endpoint: `ws://${host}:${port}/`, token };
}

export function connectionUrl(pairing: Pairing): string {
  const normalized = parseQr(`${pairing.endpoint}?token=${encodeURIComponent(pairing.token)}`);
  if (normalized.endpoint !== pairing.endpoint) throw new Error('Saved pairing is invalid. Scan again.');
  return `${normalized.endpoint}?token=${encodeURIComponent(normalized.token)}&protocolVersion=1`;
}

export class ProtocolError extends Error {
  code: number;
  constructor(code = 1008) { super(code === 4002 ? 'Update the phone and PC apps to compatible versions.' : 'Invalid data from the PC. Check the PC app and retry.'); this.code = code; }
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const matches = (v: unknown, pattern: RegExp, max: number) => typeof v === 'string' && v.length <= max && pattern.exec(v)?.[0] === v;

export function parseServerMessage(raw: unknown): ServerMessage {
  if (typeof raw !== 'string') throw new ProtocolError(1003);
  // TextEncoder is not available in every native JS runtime. Count UTF-8 code points directly.
  let size = 0;
  for (const char of raw) {
    const cp = char.codePointAt(0)!;
    size += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (size > 65536) throw new ProtocolError(1009);
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ProtocolError(); }
  if (!object(value)) throw new ProtocolError();
  if (value.type === 'config' && Object.hasOwn(value, 'protocolVersion') && value.protocolVersion !== 1) throw new ProtocolError(4002);
  let valid = false;
  if (value.type === 'config') {
    const ids = new Set<string>();
    valid = keys(value, ['type', 'protocolVersion', 'revision', 'buttons']) && value.protocolVersion === 1 && integer(value.revision) &&
      Array.isArray(value.buttons) && value.buttons.length <= 256 && value.buttons.every(button => {
        if (!object(button) || !keys(button, ['id', 'label'], ['icon']) || !matches(button.id, idPattern, 64) ||
            typeof button.label !== 'string' || [...button.label].length < 1 || [...button.label].length > 80 ||
            (Object.hasOwn(button, 'icon') && !matches(button.icon, /^[A-Za-z0-9_-]+$/, 64)) || ids.has(button.id as string)) return false;
        ids.add(button.id as string);
        return true;
      });
  } else if (value.type === 'pong') {
    valid = keys(value, ['type', 'requestId', 'ts']) && matches(value.requestId, uuidPattern, 36) && integer(value.ts);
  } else if (value.type === 'ack') {
    valid = keys(value, ['type', 'requestId', 'buttonId', 'ok', 'error']) && matches(value.requestId, uuidPattern, 36) && matches(value.buttonId, idPattern, 64) &&
      ((value.ok === true && value.error === null) || (value.ok === false && object(value.error) && keys(value.error, ['code', 'message']) &&
        typeof value.error.code === 'string' && Object.hasOwn(errors, value.error.code) && value.error.message === errors[value.error.code]));
  }
  if (!valid) throw new ProtocolError();
  return value as ServerMessage;
}
