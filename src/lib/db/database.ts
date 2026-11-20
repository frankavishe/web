import Dexie, { type EntityTable, type Table } from "dexie";
import { type Sealed, Vault } from "./vault";

/**
 * This browser's chat data: Signal state, conversations, messages and the outbox. The port of
 * mobile's `AppDatabase` (schema v3). Sensitive fields are sealed with the {@link Vault};
 * see vault.ts for what stays clear and why.
 *
 * IndexedDB transactions end as soon as they await anything that isn't IndexedDB (WebCrypto
 * included), so values are sealed before a transaction starts and unsealed after it ends.
 */

export type ConversationKind = "direct" | "group";
export type MessageKind = "text" | "system";

/** In forward order; `failed` sits last but can always be set (see updateMessageStatus). */
export const MESSAGE_STATUSES = ["pending", "sent", "delivered", "read", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
const rank = (s: MessageStatus) => MESSAGE_STATUSES.indexOf(s);

// ---- decoded shapes (what the app works with) -------------------------------------------

export interface LocalConversation {
  id: string;
  kind: ConversationKind;
  /** Group name, learnt from encrypted `group_update` payloads. */
  name: string | null;
  /** `sentAt` (ms) of the update that set [name]; older updates are ignored. */
  nameUpdatedAt: number | null;
  /** The other user of a direct chat. */
  peerUserId: string | null;
  updatedAt: number;
  unreadCount: number;
  /** False once this user left or was removed: the history stays, read-only. */
  active: boolean;
}

export interface Member {
  conversationId: string;
  userId: string;
  /** `admin` or `member`, as on the server. */
  role: "admin" | "member";
}

export interface Message {
  /** Client-generated id, the same on every device. */
  id: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  kind: MessageKind;
  body: string | null;
  sentAt: number;
  receivedAt: number | null;
  status: MessageStatus;
}

export interface CachedUser {
  id: string;
  displayName: string | null;
  phone: string | null;
  avatarThumbUrl: string | null;
}

export interface OutboxItem {
  id: number;
  messageId: string;
  conversationId: string;
  /** JSON of the plaintext payload. */
  payload: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
}

export interface Receipt {
  messageId: string;
  userId: string;
  status: MessageStatus;
}

export interface ChatSummary {
  conversation: LocalConversation;
  lastMessage: Message | null;
  /** The other user of a direct chat, when known. */
  peer: CachedUser | null;
  /** Who sent lastMessage, when known (for "Alice: hi" in groups). */
  lastSender: CachedUser | null;
}

export interface MemberInfo {
  member: Member;
  user: CachedUser | null;
  isAdmin: boolean;
}

// ---- stored rows ------------------------------------------------------------------------

interface KvRow {
  key: string;
  value: string;
}
interface MetaRow {
  key: string;
  value: CryptoKey;
}
interface SealedRow {
  id: string;
  sealed: Sealed;
}
interface ConversationRow extends Omit<LocalConversation, "name" | "active"> {
  name: Sealed | null;
  active: 0 | 1;
}
interface MessageRow extends Omit<Message, "body"> {
  body: Sealed | null;
  /** Insertion order, to break ties between equal sentAt. */
  seq: number;
}
interface OutboxRow extends Omit<OutboxItem, "payload" | "id"> {
  id?: number;
  payload: Sealed;
}
interface KnownDeviceRow {
  userId: string;
  deviceId: string;
}
interface CachedUserRow {
  id: string;
  sealed: Sealed;
}

let lastSeq = 0;
/** Increasing across reloads (millisecond based) and within one millisecond. */
function nextSeq(): number {
  lastSeq = Math.max(Date.now() * 1000, lastSeq + 1);
  return lastSeq;
}

export class ChatDb extends Dexie {
  kv!: Table<KvRow, string>;
  meta!: Table<MetaRow, string>;
  identity!: Table<SealedRow, string>;
  remoteIdentities!: Table<SealedRow, string>;
  preKeys!: Table<SealedRow, string>;
  signedPreKeys!: Table<SealedRow, string>;
  sessions!: Table<SealedRow, string>;
  conversations!: EntityTable<ConversationRow, "id">;
  members!: Table<Member, [string, string]>;
  messages!: EntityTable<MessageRow, "id">;
  outbox!: Table<OutboxRow, number>;
  knownDevices!: Table<KnownDeviceRow, [string, string]>;
  cachedUsers!: EntityTable<CachedUserRow, "id">;
  receipts!: Table<Receipt, [string, string]>;

  readonly vault: Vault;

  constructor(name = "chat") {
    super(name);
    this.version(1).stores({
      kv: "key",
      meta: "key",
      identity: "id",
      remoteIdentities: "id",
      preKeys: "id",
      signedPreKeys: "id",
      sessions: "id",
      conversations: "id",
      members: "[conversationId+userId], conversationId",
      messages: "id, conversationId, [conversationId+sentAt+seq]",
      outbox: "++id, nextAttemptAt",
      knownDevices: "[userId+deviceId], userId",
      cachedUsers: "id",
      receipts: "[messageId+userId], messageId",
    });
    this.vault = new Vault({
      load: async () => (await this.meta.get("vault"))?.value,
      save: async (key) => {
        await this.meta.put({ key: "vault", value: key });
      },
    });
  }

  // ---- key/value ------------------------------------------------------------------------

  async readKv(key: string): Promise<string | null> {
    return (await this.kv.get(key))?.value ?? null;
  }

  async writeKv(key: string, value: string): Promise<void> {
    await this.kv.put({ key, value });
  }

  // ---- sealed records (Signal store) ------------------------------------------------------

  async putSealed(table: Table<SealedRow, string>, id: string, value: unknown): Promise<void> {
    await table.put({ id, sealed: await this.vault.seal(value) });
  }

  async putSealedMany(table: Table<SealedRow, string>, items: [string, unknown][]): Promise<void> {
    const rows = await Promise.all(
      items.map(async ([id, v]) => ({ id, sealed: await this.vault.seal(v) })),
    );
    await table.bulkPut(rows);
  }

  async getSealed<T>(table: Table<SealedRow, string>, id: string): Promise<T | undefined> {
    const row = await table.get(id);
    return row ? this.vault.unseal<T>(row.sealed) : undefined;
  }

  // ---- conversations ----------------------------------------------------------------------

  private async decodeConversation(row: ConversationRow): Promise<LocalConversation> {
    return { ...row, name: await this.vault.unsealOrNull<string>(row.name), active: row.active === 1 };
  }

  /** Inserts a conversation; the name, when given, is set as of [c.nameUpdatedAt]. */
  async insertConversation(
    c: Pick<LocalConversation, "id" | "kind" | "updatedAt"> & Partial<LocalConversation>,
  ): Promise<void> {
    const name = await this.vault.sealOrNull(c.name ?? null);
    await this.conversations.put({
      id: c.id,
      kind: c.kind,
      name,
      nameUpdatedAt: c.nameUpdatedAt ?? null,
      peerUserId: c.peerUserId ?? null,
      updatedAt: c.updatedAt,
      unreadCount: c.unreadCount ?? 0,
      active: c.active === false ? 0 : 1,
    });
  }

  async conversationById(id: string): Promise<LocalConversation | null> {
    const row = await this.conversations.get(id);
    return row ? this.decodeConversation(row) : null;
  }

  async allConversations(): Promise<LocalConversation[]> {
    return Promise.all((await this.conversations.toArray()).map((r) => this.decodeConversation(r)));
  }

  /** Deletes the chat with its members, messages, receipts and queued items. */
  async deleteConversation(id: string): Promise<void> {
    await this.transaction(
      "rw",
      [this.conversations, this.members, this.messages, this.receipts, this.outbox],
      async () => {
        const ids = (await this.messages.where("conversationId").equals(id).primaryKeys()) as string[];
        await this.receipts.where("messageId").anyOf(ids).delete();
        await this.messages.bulkDelete(ids);
        await this.members.where("conversationId").equals(id).delete();
        await this.outbox.filter((o) => o.conversationId === id).delete();
        await this.conversations.delete(id);
      },
    );
  }

  /** Moves the conversation to the top of the list. */
  async touchConversation(id: string, at: number): Promise<void> {
    await this.conversations.update(id, { updatedAt: at });
  }

  /**
   * Sets the group name when [at] is newer than when the current name was set.
   * Returns whether it changed.
   */
  async setConversationName(id: string, name: string, at: number): Promise<boolean> {
    const sealed = await this.vault.seal(name);
    return this.transaction("rw", this.conversations, async () => {
      const c = await this.conversations.get(id);
      if (!c) return false;
      if (c.nameUpdatedAt !== null && at <= c.nameUpdatedAt) return false;
      await this.conversations.update(id, { name: sealed, nameUpdatedAt: at });
      return true;
    });
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.conversations.update(id, { active: active ? 1 : 0 });
  }

  // ---- members ----------------------------------------------------------------------------

  async setMembers(conversationId: string, list: Member[]): Promise<void> {
    await this.transaction("rw", this.members, async () => {
      await this.members.where("conversationId").equals(conversationId).delete();
      await this.members.bulkPut(list);
    });
  }

  membersOf(conversationId: string): Promise<Member[]> {
    return this.members.where("conversationId").equals(conversationId).toArray();
  }

  /** Members with their cached profiles; admins first, then by name. */
  async membersWithUsers(conversationId: string): Promise<MemberInfo[]> {
    const members = await this.membersOf(conversationId);
    const list = await Promise.all(
      members.map(async (member) => ({
        member,
        user: await this.cachedUser(member.userId),
        isAdmin: member.role === "admin",
      })),
    );
    const key = (m: MemberInfo) => (m.user?.displayName ?? m.user?.phone ?? "￿").toLowerCase();
    return list.sort((a, b) =>
      a.isAdmin !== b.isAdmin ? (a.isAdmin ? -1 : 1) : key(a).localeCompare(key(b)),
    );
  }

  // ---- messages ---------------------------------------------------------------------------

  private async decodeMessage(row: MessageRow): Promise<Message> {
    const decoded: Message & { seq?: number } = {
      ...row,
      body: await this.vault.unsealOrNull<string>(row.body),
    };
    delete decoded.seq;
    return decoded;
  }

  /** Insert-or-ignore: a message id already stored is left as it is. */
  async insertMessage(m: Omit<Message, "receivedAt"> & { receivedAt?: number | null }): Promise<void> {
    const body = await this.vault.sealOrNull(m.body);
    await this.transaction("rw", this.messages, async () => {
      if (await this.messages.get(m.id)) return;
      await this.messages.add({ ...m, receivedAt: m.receivedAt ?? null, body, seq: nextSeq() });
    });
  }

  async messageById(id: string): Promise<Message | null> {
    const row = await this.messages.get(id);
    return row ? this.decodeMessage(row) : null;
  }

  /** Oldest first. */
  async messagesIn(conversationId: string): Promise<Message[]> {
    const rows = await this.messages
      .where("[conversationId+sentAt+seq]")
      .between([conversationId, -Infinity, -Infinity], [conversationId, Infinity, Infinity])
      .toArray();
    return Promise.all(rows.map((r) => this.decodeMessage(r)));
  }

  private async lastMessageRow(conversationId: string): Promise<MessageRow | undefined> {
    return this.messages
      .where("[conversationId+sentAt+seq]")
      .between([conversationId, -Infinity, -Infinity], [conversationId, Infinity, Infinity])
      .last();
  }

  /**
   * Moves a message forward only (sent → delivered → read). `failed` can always be set, and a
   * failed message can move to any state when it is retried.
   */
  async updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
    await this.transaction("rw", this.messages, async () => {
      const row = await this.messages.get(id);
      if (!row) return;
      const forward = status === "failed" || row.status === "failed" || rank(status) > rank(row.status);
      if (forward) await this.messages.update(id, { status });
    });
  }

  /** Sets the unread count to the number of other users' text messages not yet read. */
  async recountUnread(id: string, myUserId: string): Promise<void> {
    await this.transaction("rw", this.messages, this.conversations, async () => {
      const unreadCount = await this.messages
        .where("conversationId")
        .equals(id)
        .filter((m) => m.senderUserId !== myUserId && m.kind === "text" && m.status !== "read")
        .count();
      await this.conversations.update(id, { unreadCount });
    });
  }

  /**
   * Marks other users' unread messages in [conversationId] as read, recounts unread and
   * returns the ids that changed.
   */
  async markIncomingRead(conversationId: string, myUserId: string): Promise<string[]> {
    const ids = await this.transaction("rw", this.messages, async () => {
      const rows = await this.messages
        .where("conversationId")
        .equals(conversationId)
        .filter((m) => m.senderUserId !== myUserId && m.kind === "text" && m.status !== "read")
        .toArray();
      for (const r of rows) await this.messages.update(r.id, { status: "read" });
      return rows.map((r) => r.id);
    });
    await this.recountUnread(conversationId, myUserId);
    return ids;
  }

  /** The chat list, most recent activity first. */
  async chatList(): Promise<ChatSummary[]> {
    const convs = await this.conversations.toArray();
    const list = await Promise.all(
      convs.map(async (row) => {
        const last = await this.lastMessageRow(row.id);
        return {
          conversation: await this.decodeConversation(row),
          lastMessage: last ? await this.decodeMessage(last) : null,
          peer: row.peerUserId ? await this.cachedUser(row.peerUserId) : null,
          lastSender: last ? await this.cachedUser(last.senderUserId) : null,
          at: last ? [last.sentAt, last.seq] : [row.updatedAt, 0],
        };
      }),
    );
    list.sort((a, b) => b.at[0] - a.at[0] || b.at[1] - a.at[1]);
    return list.map((s) => ({
      conversation: s.conversation,
      lastMessage: s.lastMessage,
      peer: s.peer,
      lastSender: s.lastSender,
    }));
  }

  // ---- group receipts ---------------------------------------------------------------------

  receiptsFor(messageId: string): Promise<Receipt[]> {
    return this.receipts.where("messageId").equals(messageId).toArray();
  }

  /**
   * Records that [userId] reached [status] for one of this user's group messages (forward
   * only), then moves the message to the lowest status across the current members.
   */
  async applyReceipt(
    messageId: string,
    userId: string,
    status: MessageStatus,
    myUserId: string,
  ): Promise<void> {
    await this.transaction("rw", [this.messages, this.receipts, this.members], async () => {
      const m = await this.messages.get(messageId);
      if (!m) return;
      const existing = await this.receipts.get([messageId, userId]);
      if (!existing || rank(status) > rank(existing.status)) {
        await this.receipts.put({ messageId, userId, status });
      }
      await this.aggregate(m, myUserId);
    });
  }

  /**
   * Re-applies the aggregate to this user's sent or delivered messages in [conversationId],
   * e.g. after a member who held them back left.
   */
  async reaggregate(conversationId: string, myUserId: string): Promise<void> {
    await this.transaction("rw", [this.messages, this.receipts, this.members], async () => {
      const mine = await this.messages
        .where("conversationId")
        .equals(conversationId)
        .filter(
          (m) =>
            m.senderUserId === myUserId &&
            m.kind === "text" &&
            (m.status === "sent" || m.status === "delivered"),
        )
        .toArray();
      for (const m of mine) await this.aggregate(m, myUserId);
    });
  }

  /** Runs inside the callers' transaction. */
  private async aggregate(m: MessageRow, myUserId: string): Promise<void> {
    const others = (await this.membersOf(m.conversationId))
      .map((x) => x.userId)
      .filter((u) => u !== myUserId);
    if (others.length === 0) return;
    const byUser = new Map((await this.receiptsFor(m.id)).map((r) => [r.userId, r.status]));
    let lowest: MessageStatus = "read";
    for (const u of others) {
      const st = byUser.get(u);
      if (!st) return; // not everyone has it yet
      if (rank(st) < rank(lowest)) lowest = st;
    }
    const forward = m.status === "failed" || rank(lowest) > rank(m.status);
    if (forward) await this.messages.update(m.id, { status: lowest });
  }

  // ---- devices and users ------------------------------------------------------------------

  async devicesOf(userId: string): Promise<string[]> {
    return (await this.knownDevices.where("userId").equals(userId).toArray()).map((r) => r.deviceId);
  }

  async addDevice(userId: string, deviceId: string): Promise<void> {
    await this.knownDevices.put({ userId, deviceId });
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    await this.knownDevices.delete([userId, deviceId]);
  }

  async cacheUser(u: CachedUser): Promise<void> {
    const { id, ...profile } = u;
    await this.cachedUsers.put({ id, sealed: await this.vault.seal(profile) });
  }

  async cachedUser(id: string): Promise<CachedUser | null> {
    const row = await this.cachedUsers.get(id);
    if (!row) return null;
    return { id, ...(await this.vault.unseal<Omit<CachedUser, "id">>(row.sealed)) };
  }

  // ---- outbox -----------------------------------------------------------------------------

  async enqueueOutbox(o: Omit<OutboxItem, "id" | "attempts"> & { attempts?: number }): Promise<number> {
    const payload = await this.vault.seal(o.payload);
    return this.outbox.add({ ...o, attempts: o.attempts ?? 0, payload });
  }

  /** Items due at [now], oldest first. */
  async dueOutbox(now: number): Promise<OutboxItem[]> {
    const rows = await this.outbox.filter((o) => o.nextAttemptAt <= now).sortBy("id");
    return Promise.all(
      rows.map(async (r) => ({ ...r, id: r.id!, payload: await this.vault.unseal<string>(r.payload) })),
    );
  }

  async removeOutbox(id: number): Promise<void> {
    await this.outbox.delete(id);
  }

  async rescheduleOutbox(id: number, attempts: number, next: number): Promise<void> {
    await this.outbox.update(id, { attempts, nextAttemptAt: next });
  }

  /** Makes every waiting item due now (the connection is back). */
  async outboxDueNow(now: number): Promise<void> {
    await this.outbox.toCollection().modify({ nextAttemptAt: now });
  }

  /** When the next outbox item becomes due, or null when the outbox is empty. */
  async nextOutboxDue(): Promise<number | null> {
    return (await this.outbox.orderBy("nextAttemptAt").first())?.nextAttemptAt ?? null;
  }
}
