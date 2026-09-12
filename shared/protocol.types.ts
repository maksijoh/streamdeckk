/** DeckRemote v1. Runtime validation and connection rules: protocol.md. */
export const PROTOCOL_VERSION = 1 as const;

export type Button = { id: string; label: string; icon?: string };

export type PressMessage = {
  type: "press";
  requestId: string;
  buttonId: string;
  ts: number;
};

export type ActionError =
  | { code: "unknown_button"; message: "Button does not exist" }
  | { code: "invalid_message"; message: "Invalid press message" }
  | { code: "action_failed"; message: "Action failed" }
  | { code: "unsupported_action"; message: "Action is unsupported or disabled" };

export type AckMessage = {
  type: "ack";
  requestId: string;
  buttonId: string;
} & ({ ok: true; error: null } | { ok: false; error: ActionError });

export type ConfigMessage = {
  type: "config";
  protocolVersion: typeof PROTOCOL_VERSION;
  revision: number;
  buttons: Button[];
};

export type PingMessage = { type: "ping"; requestId: string; ts: number };
export type PongMessage = { type: "pong"; requestId: string; ts: number };
export type ClientMessage = PressMessage | PingMessage;
export type ServerMessage = AckMessage | ConfigMessage | PongMessage;
export type ProtocolMessage = ClientMessage | ServerMessage;
