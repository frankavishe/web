import { ApiError, api, call } from "./client";
import type {
  Conversation,
  CreateConversationBody,
  DeviceMismatch,
  Envelope,
  PublicUser,
  SendMessageBody,
  UploadKeysBody,
  UserKeys,
} from "./types";

/**
 * The feature 002 endpoints the messaging code uses. An interface so tests can run the real
 * messaging logic against an in-memory server (tests/messaging/fake-server.ts).
 */
export interface E2eeApi {
  uploadKeys(body: UploadKeysBody): Promise<void>;
  getKeyCount(): Promise<number>;
  /** Consumes one one-time prekey per returned device. */
  getUserKeys(userId: string, deviceIds?: string[]): Promise<UserKeys>;
  /** Users the caller may not see are left out without an error. */
  getUsers(ids: string[]): Promise<PublicUser[]>;
  listContacts(): Promise<PublicUser[]>;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation>;
  /** Direct chats are idempotent: the existing one is returned. */
  createConversation(body: CreateConversationBody): Promise<Conversation>;
  addMembers(conversationId: string, userIds: string[]): Promise<Conversation>;
  removeMember(conversationId: string, userId: string): Promise<void>;
  /** Returns the server timestamp. A stale device list throws 409 DEVICE_MISMATCH. */
  sendMessage(body: SendMessageBody): Promise<string>;
  /** Envelopes waiting for this device, oldest first. */
  listEnvelopes(limit?: number): Promise<Envelope[]>;
  ackEnvelopes(ids: string[]): Promise<void>;
}

/** Max device ids per `GET /users/{id}/keys`. */
export const KEYS_DEVICE_FILTER_MAX = 5;
/** Max ids per `GET /users`. */
export const USERS_BATCH_MAX = 64;
/** Max ids per `POST /envelopes/ack`. */
export const ACK_BATCH_MAX = 500;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const httpE2eeApi: E2eeApi = {
  async uploadKeys(body) {
    await call(() => api.PUT("/keys", { body }));
  },

  async getKeyCount() {
    return (await call(() => api.GET("/keys/count"))).count;
  },

  async getUserKeys(userId, deviceIds) {
    const one = (ids?: string[]) =>
      call(() =>
        api.GET("/users/{userId}/keys", {
          params: { path: { userId }, query: ids ? { deviceId: ids } : {} },
        }),
      );
    if (!deviceIds) return one();
    const devices = [];
    for (const chunk of chunks(deviceIds, KEYS_DEVICE_FILTER_MAX)) {
      devices.push(...(await one(chunk)).devices);
    }
    return { userId, devices };
  },

  async getUsers(ids) {
    const users: PublicUser[] = [];
    for (const chunk of chunks(ids, USERS_BATCH_MAX)) {
      users.push(...(await call(() => api.GET("/users", { params: { query: { id: chunk } } }))));
    }
    return users;
  },

  listContacts: () => call(() => api.GET("/contacts")),

  listConversations: () => call(() => api.GET("/conversations")),

  getConversation: (id) =>
    call(() => api.GET("/conversations/{conversationId}", { params: { path: { conversationId: id } } })),

  createConversation: (body) => call(() => api.POST("/conversations", { body })),

  addMembers: (conversationId, userIds) =>
    call(() =>
      api.POST("/conversations/{conversationId}/members", {
        params: { path: { conversationId } },
        body: { userIds },
      }),
    ),

  async removeMember(conversationId, userId) {
    await call(() =>
      api.DELETE("/conversations/{conversationId}/members/{userId}", {
        params: { path: { conversationId, userId } },
      }),
    );
  },

  async sendMessage(body) {
    return (await call(() => api.POST("/messages", { body }))).serverTimestamp;
  },

  listEnvelopes: (limit = 100) => call(() => api.GET("/envelopes", { params: { query: { limit } } })),

  async ackEnvelopes(ids) {
    for (const chunk of chunks(ids, ACK_BATCH_MAX)) {
      await call(() => api.POST("/envelopes/ack", { body: { ids: chunk } }));
    }
  },
};

/** The device lists from a 409 `DEVICE_MISMATCH`, or null for any other error. */
export function deviceMismatchOf(e: unknown): DeviceMismatch | null {
  if (!(e instanceof ApiError) || e.code !== "DEVICE_MISMATCH" || !e.details) return null;
  const d = e.details as Partial<DeviceMismatch>;
  return { missingDevices: d.missingDevices ?? [], staleDevices: d.staleDevices ?? [] };
}
