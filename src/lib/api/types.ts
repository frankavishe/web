import type { components } from "./schema";

type Schemas = components["schemas"];

export type Me = Schemas["Me"];
export type PublicUser = Schemas["PublicUser"];
export type Device = Schemas["Device"];
export type AuthResult = Schemas["AuthResult"];
export type TokenPair = Schemas["TokenPair"];
export type RequestCodeResponse = Schemas["RequestCodeResponse"];
export type ErrorBody = Schemas["Error"];
export type ErrorCode = ErrorBody["code"];

/** Payloads of server-to-client events (contracts/ws-events.schema.json). */
export type DeviceRevokedReason =
  | "signed_out"
  | "replaced"
  | "evicted"
  | "token_reuse"
  | "inactive";

export interface DeviceRevokedEvent {
  deviceId: string;
  reason: DeviceRevokedReason;
}

export interface ProfileUpdatedEvent {
  id: string;
  displayName: string | null;
  about: string;
  avatarUrl: string | null;
  avatarThumbUrl?: string | null;
}
