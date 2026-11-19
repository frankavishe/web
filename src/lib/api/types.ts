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

/* ---- Feature 002: end-to-end encrypted messaging ---- */
export type PublicPreKey = Schemas["PublicPreKey"];
export type SignedPreKey = Schemas["SignedPreKey"];
export type UploadKeysBody = Schemas["UploadKeysBody"];
export type DeviceBundle = Schemas["DeviceBundle"];
export type UserKeys = Schemas["UserKeys"];
export type ConversationType = Schemas["ConversationType"];
export type MemberRole = Schemas["MemberRole"];
export type ConversationMember = Schemas["ConversationMember"];
export type Conversation = Schemas["Conversation"];
export type CreateConversationBody = Schemas["CreateConversationBody"];
export type EnvelopeType = Schemas["EnvelopeType"];
export type OutgoingEnvelope = Schemas["OutgoingEnvelope"];
export type SendMessageBody = Schemas["SendMessageBody"];
export type DeviceRef = Schemas["DeviceRef"];
export type DeviceMismatch = Schemas["DeviceMismatch"];
export type Envelope = Schemas["Envelope"];

/** Payloads of the feature 002 realtime events (contracts/ws-events.schema.json). */
export type EnvelopeNewEvent = Envelope;
export type ConversationUpdatedEvent = Conversation | { id: string; removed: true };
export type TypingState = "start" | "stop";
export interface TypingEvent {
  conversationId: string;
  userId: string;
  state: TypingState;
}
export interface PrekeysLowEvent {
  count: number;
}
/** Client-to-server `typing`. */
export interface TypingEmit {
  conversationId: string;
  state: TypingState;
}
