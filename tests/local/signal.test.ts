// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { E2eeApi } from "@/lib/api/e2ee";
import type { DeviceBundle, UploadKeysBody } from "@/lib/api/types";
import { fromUtf8, utf8 } from "@/lib/bytes";
import { BATCH_SIZE, nextPreKeyId } from "@/lib/crypto/key-manager";
import { UntrustedIdentityError } from "@/lib/crypto/signal-store";
import { createLocalData, type LocalData } from "@/lib/local-data";
import { rawDump } from "./helpers";

let n = 0;
const opened: LocalData[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.db.close();
    await d.db.delete();
  }
});

/** A device whose API only records uploads (and can be made to fail). */
function device(api: Partial<E2eeApi> = {}) {
  const uploads: UploadKeysBody[] = [];
  const fullApi = {
    uploadKeys: vi.fn(async (b: UploadKeysBody) => {
      uploads.push(b);
    }),
    getKeyCount: vi.fn(async () => BATCH_SIZE),
    ...api,
  } as unknown as E2eeApi;
  const data = createLocalData(fullApi, `signal-${Date.now()}-${n++}`);
  opened.push(data);
  return { ...data, uploads, api: fullApi };
}

/** The bundle the server would hand out for [d] (the first prekey of its last upload). */
function bundleOf(d: ReturnType<typeof device>, deviceId: string, preKeyIndex = 0): DeviceBundle {
  const full = d.uploads.find((u) => u.signedPreKey)!;
  return {
    deviceId,
    registrationId: full.registrationId,
    identityKey: full.identityKey,
    signedPreKey: full.signedPreKey!,
    preKey: full.preKeys[preKeyIndex] ?? null,
  };
}

describe("key manager", () => {
  it("creates keys once, uploads 100 prekeys and the signed prekey", async () => {
    const d = device();
    await d.keys.ensureKeys();
    expect(d.uploads).toHaveLength(1);
    const body = d.uploads[0];
    expect(body.preKeys).toHaveLength(BATCH_SIZE);
    expect(body.preKeys.map((p) => p.keyId)).toEqual(Array.from({ length: BATCH_SIZE }, (_, i) => i + 1));
    expect(body.signedPreKey?.keyId).toBe(1);
    expect(atob(body.identityKey)).toHaveLength(33);
    expect(atob(body.signedPreKey!.signature)).toHaveLength(64);

    // Next start: already uploaded, server stocked → nothing to do.
    await d.keys.ensureKeys();
    expect(d.uploads).toHaveLength(1);
    // Private keys never leave the vault in clear.
    expect(await rawDump(d.db)).not.toContain(body.identityKey);
  });

  it("re-uploads until the server has the keys, keeping the same identity", async () => {
    let fail = true;
    const accepted: UploadKeysBody[] = [];
    const d = device({
      uploadKeys: async (b) => {
        if (fail) throw new Error("offline");
        accepted.push(b);
      },
    });
    await expect(d.keys.ensureKeys()).rejects.toThrow("offline");
    fail = false;
    await d.keys.ensureKeys();
    expect(accepted).toHaveLength(1);
    expect(accepted[0].preKeys).toHaveLength(BATCH_SIZE);
    expect(accepted[0].signedPreKey).toBeDefined();
    // Uploaded now: the next start doesn't send the full set again.
    await d.keys.ensureKeys();
    expect(accepted).toHaveLength(1);
  });

  it("tops up with new ids; concurrent calls share one upload", async () => {
    const d = device();
    await d.keys.ensureKeys();
    await Promise.all([d.keys.topUp(3), d.keys.topUp(3)]);
    expect(d.uploads).toHaveLength(2);
    const top = d.uploads[1];
    expect(top.signedPreKey).toBeUndefined();
    expect(top.preKeys.map((p) => p.keyId)).toEqual(
      Array.from({ length: BATCH_SIZE - 3 }, (_, i) => BATCH_SIZE + 1 + i),
    );
    await d.keys.topUp(BATCH_SIZE);
    expect(d.uploads).toHaveLength(2);
  });

  it("tops up on start when the server runs low", async () => {
    const d = device({ getKeyCount: vi.fn(async () => 4) });
    await d.keys.ensureKeys();
    await d.keys.ensureKeys();
    expect(d.uploads[1].preKeys).toHaveLength(BATCH_SIZE - 4);
  });

  it("wraps prekey ids like libsignal", () => {
    expect(nextPreKeyId(1, 100)).toBe(101);
    expect(nextPreKeyId(0xfffffe, 1)).toBe(1);
  });
});

describe("sessions", () => {
  it("two devices talk both ways, across ratchet steps", async () => {
    const alice = device();
    const bob = device();
    await alice.keys.ensureKeys();
    await bob.keys.ensureKeys();

    expect(await alice.cipher.hasSession("bob-d")).toBe(false);
    await alice.cipher.processBundle(bundleOf(bob, "bob-d"));
    expect(await alice.cipher.hasSession("bob-d")).toBe(true);

    const m1 = await alice.cipher.encrypt("bob-d", utf8("hi bob 👋"));
    expect(m1.type).toBe("prekey");
    expect(m1.deviceId).toBe("bob-d");
    const got = await bob.cipher.decrypt({ senderDeviceId: "alice-d", type: m1.type, ciphertext: m1.ciphertext });
    expect(fromUtf8(got)).toBe("hi bob 👋");
    // Bob's one-time prekey was used up.
    expect(await bob.store.loadPreKey(1)).toBeUndefined();

    const r1 = await bob.cipher.encrypt("alice-d", utf8("hi alice"));
    expect(r1.type).toBe("whisper");
    expect(fromUtf8(await alice.cipher.decrypt({ senderDeviceId: "bob-d", ...r1 }))).toBe("hi alice");

    for (let i = 0; i < 3; i++) {
      const m = await alice.cipher.encrypt("bob-d", utf8(`ratchet ${i}`));
      expect(fromUtf8(await bob.cipher.decrypt({ senderDeviceId: "alice-d", ...m }))).toBe(`ratchet ${i}`);
    }

    // A replayed message is refused.
    await expect(bob.cipher.decrypt({ senderDeviceId: "alice-d", ...m1 })).rejects.toThrow();

    await alice.cipher.deleteSession("bob-d");
    expect(await alice.cipher.hasSession("bob-d")).toBe(false);
  });

  it("works without a one-time prekey", async () => {
    const alice = device();
    const bob = device();
    await alice.keys.ensureKeys();
    await bob.keys.ensureKeys();
    await alice.cipher.processBundle({ ...bundleOf(bob, "bob-d"), preKey: null });
    const m = await alice.cipher.encrypt("bob-d", utf8("no otk"));
    expect(fromUtf8(await bob.cipher.decrypt({ senderDeviceId: "alice-d", ...m }))).toBe("no otk");
  });

  it("trusts a device key on first use and rejects a changed one", async () => {
    const alice = device();
    const bob = device();
    const impostor = device();
    for (const d of [alice, bob, impostor]) await d.keys.ensureKeys();

    await alice.cipher.processBundle(bundleOf(bob, "bob-d"));
    await alice.cipher.encrypt("bob-d", utf8("x"));
    await alice.cipher.deleteSession("bob-d");
    // Same device id, different identity key.
    await expect(alice.cipher.processBundle(bundleOf(impostor, "bob-d"))).rejects.toThrow();

    // Receiving side: a prekey message from a known device with a new identity is refused.
    await bob.cipher.processBundle(bundleOf(alice, "alice-d"));
    const fromImpostor = device();
    await fromImpostor.keys.ensureKeys();
    const known = await alice.store.getIdentity("bob-d");
    expect(known).toBeDefined();
    await fromImpostor.cipher.processBundle(bundleOf(alice, "alice-d", 1));
    const forged = await fromImpostor.cipher.encrypt("alice-d", utf8("trust me"));
    await expect(alice.cipher.decrypt({ senderDeviceId: "bob-d", ...forged })).rejects.toThrow(
      UntrustedIdentityError,
    );
  });
});
