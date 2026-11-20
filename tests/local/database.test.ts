// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { decodeJson, encodeJson, fromB64, toB64, utf8 } from "@/lib/bytes";
import type { ChatDb, Message } from "@/lib/db/database";
import { freshDb, rawDump } from "./helpers";

const T0 = Date.UTC(2026, 10, 19, 10);
const MARKER = "plaintext-marker-7f3a";

let db: ChatDb;
afterEach(async () => {
  db?.close();
  await db?.delete();
});

function msg(id: string, at: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: "c1",
    senderUserId: "u1",
    senderDeviceId: "d1",
    kind: "text",
    body: `hello ${id}`,
    sentAt: at,
    receivedAt: null,
    status: "pending",
    ...extra,
  };
}

describe("codec", () => {
  it("round-trips ArrayBuffers inside JSON", () => {
    const value = { pubKey: utf8("abc"), nested: [utf8("x")], n: 1 };
    const back = decodeJson<typeof value>(encodeJson(value));
    expect(toB64(back.pubKey)).toBe(toB64(value.pubKey));
    expect(toB64(back.nested[0])).toBe(toB64(utf8("x")));
    expect(back.n).toBe(1);
    expect(toB64(fromB64("AAEC"))).toBe("AAEC");
  });
});

describe("vault", () => {
  it("seals with a non-extractable key that survives reopening", async () => {
    db = freshDb();
    const sealed = await db.vault.seal({ secret: MARKER });
    expect(await db.vault.unseal(sealed)).toEqual({ secret: MARKER });

    const key = (await db.meta.get("vault"))!.value;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();

    const again = new (db.constructor as new (name: string) => ChatDb)(db.name);
    expect(await again.vault.unseal(sealed)).toEqual({ secret: MARKER });
    again.close();
  });

  it("keeps bodies, names and payloads out of the stored rows", async () => {
    db = freshDb();
    await db.insertConversation({ id: "c1", kind: "group", name: `group ${MARKER}`, updatedAt: T0 });
    await db.insertMessage(msg("m1", T0, { body: `body ${MARKER}` }));
    await db.cacheUser({ id: "u2", displayName: `name ${MARKER}`, phone: "+255700000002", avatarThumbUrl: null });
    await db.enqueueOutbox({
      messageId: "m1",
      conversationId: "c1",
      payload: `{"body":"${MARKER}"}`,
      nextAttemptAt: T0,
      createdAt: T0,
    });

    expect(await rawDump(db)).not.toContain(MARKER);
    expect(await rawDump(db)).not.toContain("+255700000002");
    // …while the app reads them back.
    expect((await db.messageById("m1"))!.body).toBe(`body ${MARKER}`);
    expect((await db.conversationById("c1"))!.name).toBe(`group ${MARKER}`);
    expect((await db.cachedUser("u2"))!.displayName).toBe(`name ${MARKER}`);
    expect((await db.dueOutbox(T0))[0].payload).toContain(MARKER);
  });
});

describe("chats", () => {
  it("orders messages by time, then insertion; insert ignores a known id", async () => {
    db = freshDb();
    await db.insertConversation({ id: "c1", kind: "direct", peerUserId: "u2", updatedAt: T0 });
    await db.insertMessage(msg("b", T0 + 1000));
    await db.insertMessage(msg("a", T0));
    await db.insertMessage(msg("c", T0 + 1000));
    await db.insertMessage(msg("a", T0, { body: "changed" }));
    const list = await db.messagesIn("c1");
    expect(list.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(list[0].body).toBe("hello a");
  });

  it("message status only moves forward, except failed", async () => {
    db = freshDb();
    await db.insertMessage(msg("m", T0, { status: "sent" }));
    const status = async () => (await db.messageById("m"))!.status;
    await db.updateMessageStatus("m", "read");
    await db.updateMessageStatus("m", "delivered");
    expect(await status()).toBe("read");
    await db.updateMessageStatus("m", "failed");
    expect(await status()).toBe("failed");
    await db.updateMessageStatus("m", "pending");
    expect(await status()).toBe("pending");
  });

  it("counts and marks unread incoming text", async () => {
    db = freshDb();
    await db.insertConversation({ id: "c1", kind: "direct", updatedAt: T0 });
    await db.insertMessage(msg("in1", T0, { senderUserId: "u2", status: "delivered" }));
    await db.insertMessage(msg("in2", T0 + 1, { senderUserId: "u2", status: "delivered" }));
    await db.insertMessage(msg("note", T0 + 2, { senderUserId: "", kind: "system", status: "delivered" }));
    await db.insertMessage(msg("mine", T0 + 3, { status: "sent" }));
    await db.recountUnread("c1", "u1");
    expect((await db.conversationById("c1"))!.unreadCount).toBe(2);

    expect((await db.markIncomingRead("c1", "u1")).sort()).toEqual(["in1", "in2"]);
    expect((await db.conversationById("c1"))!.unreadCount).toBe(0);
    expect(await db.markIncomingRead("c1", "u1")).toEqual([]);
  });

  it("lists chats by latest activity with peer and last sender", async () => {
    db = freshDb();
    await db.insertConversation({ id: "old", kind: "direct", peerUserId: "u2", updatedAt: T0 });
    await db.insertConversation({ id: "new", kind: "group", name: "Trip", updatedAt: T0 });
    await db.insertConversation({ id: "empty", kind: "direct", updatedAt: T0 + 5000 });
    await db.cacheUser({ id: "u2", displayName: "Amina", phone: null, avatarThumbUrl: null });
    await db.insertMessage(msg("m1", T0 + 1000, { conversationId: "old" }));
    await db.insertMessage(msg("m2", T0 + 9000, { conversationId: "new", senderUserId: "u2" }));

    const list = await db.chatList();
    expect(list.map((s) => s.conversation.id)).toEqual(["new", "empty", "old"]);
    expect(list[0].lastSender?.displayName).toBe("Amina");
    expect(list[0].conversation.name).toBe("Trip");
    expect(list[2].peer?.displayName).toBe("Amina");
    expect(list[1].lastMessage).toBeNull();
  });

  it("deleting a chat removes its messages, members and receipts", async () => {
    db = freshDb();
    await db.insertConversation({ id: "c1", kind: "group", updatedAt: T0 });
    await db.setMembers("c1", [{ conversationId: "c1", userId: "u1", role: "admin" }]);
    await db.insertMessage(msg("m1", T0));
    await db.receipts.put({ messageId: "m1", userId: "u2", status: "read" });
    await db.deleteConversation("c1");
    expect(await db.conversationById("c1")).toBeNull();
    expect(await db.messages.count()).toBe(0);
    expect(await db.members.count()).toBe(0);
    expect(await db.receipts.count()).toBe(0);
  });
});

describe("groups", () => {
  async function seedGroup(members: string[]) {
    await db.insertConversation({ id: "c1", kind: "group", updatedAt: T0 });
    await db.setMembers(
      "c1",
      members.map((userId) => ({ conversationId: "c1", userId, role: "member" as const })),
    );
  }

  it("a message turns delivered, then read, only when every member got there", async () => {
    db = freshDb();
    await seedGroup(["u1", "u2", "u3"]);
    await db.insertMessage(msg("m1", T0, { status: "sent" }));
    const status = async () => (await db.messageById("m1"))!.status;

    await db.applyReceipt("m1", "u2", "delivered", "u1");
    expect(await status()).toBe("sent");
    await db.applyReceipt("m1", "u3", "read", "u1");
    expect(await status()).toBe("delivered");
    await db.applyReceipt("m1", "u3", "delivered", "u1");
    expect((await db.receiptsFor("m1")).find((r) => r.userId === "u3")!.status).toBe("read");
    await db.applyReceipt("m1", "u2", "read", "u1");
    expect(await status()).toBe("read");
  });

  it("a member who left no longer holds the ticks back", async () => {
    db = freshDb();
    await seedGroup(["u1", "u2", "u3"]);
    await db.insertMessage(msg("m1", T0, { status: "sent" }));
    await db.applyReceipt("m1", "u2", "read", "u1");
    expect((await db.messageById("m1"))!.status).toBe("sent");
    await db.setMembers("c1", [
      { conversationId: "c1", userId: "u1", role: "admin" },
      { conversationId: "c1", userId: "u2", role: "member" },
    ]);
    await db.reaggregate("c1", "u1");
    expect((await db.messageById("m1"))!.status).toBe("read");
  });

  it("the name follows the newest update; active can be toggled", async () => {
    db = freshDb();
    await seedGroup(["u1"]);
    expect(await db.setConversationName("c1", "Trip", T0)).toBe(true);
    expect(await db.setConversationName("c1", "Older", T0 - 1000)).toBe(false);
    expect(await db.setConversationName("c1", "Same time", T0)).toBe(false);
    expect(await db.setConversationName("c1", "Newer", T0 + 1000)).toBe(true);
    expect((await db.conversationById("c1"))!.name).toBe("Newer");

    expect((await db.conversationById("c1"))!.active).toBe(true);
    await db.setActive("c1", false);
    expect((await db.conversationById("c1"))!.active).toBe(false);
  });

  it("members come with cached names, admins first", async () => {
    db = freshDb();
    await db.insertConversation({ id: "c1", kind: "group", updatedAt: T0 });
    await db.setMembers("c1", [
      { conversationId: "c1", userId: "u1", role: "member" },
      { conversationId: "c1", userId: "u2", role: "member" },
      { conversationId: "c1", userId: "u3", role: "admin" },
    ]);
    await db.cacheUser({ id: "u1", displayName: "Zed", phone: null, avatarThumbUrl: null });
    await db.cacheUser({ id: "u2", displayName: "amy", phone: null, avatarThumbUrl: null });
    const list = await db.membersWithUsers("c1");
    expect(list.map((m) => m.member.userId)).toEqual(["u3", "u2", "u1"]);
    expect(list[0].isAdmin).toBe(true);
    expect(list[0].user).toBeNull();
  });
});

describe("devices and outbox", () => {
  it("tracks known devices per user", async () => {
    db = freshDb();
    await db.addDevice("u", "d1");
    await db.addDevice("u", "d2");
    await db.addDevice("u", "d1");
    expect((await db.devicesOf("u")).sort()).toEqual(["d1", "d2"]);
    await db.removeDevice("u", "d1");
    expect(await db.devicesOf("u")).toEqual(["d2"]);
  });

  it("returns due items oldest first and reschedules", async () => {
    db = freshDb();
    const item = (messageId: string, at: number) => ({
      messageId,
      conversationId: "c1",
      payload: "{}",
      nextAttemptAt: at,
      createdAt: T0,
    });
    const a = await db.enqueueOutbox(item("a", T0));
    await db.enqueueOutbox(item("b", T0 + 10_000));
    expect((await db.dueOutbox(T0)).map((o) => o.messageId)).toEqual(["a"]);
    await db.rescheduleOutbox(a, 1, T0 + 20_000);
    expect(await db.nextOutboxDue()).toBe(T0 + 10_000);
    await db.outboxDueNow(T0);
    expect((await db.dueOutbox(T0)).map((o) => [o.messageId, o.attempts])).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
    await db.removeOutbox(a);
    expect((await db.dueOutbox(T0)).map((o) => o.messageId)).toEqual(["b"]);
  });
});
