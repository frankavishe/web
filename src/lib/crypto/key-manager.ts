import { KeyHelper, type KeyPairType } from "@privacyresearch/libsignal-protocol-typescript";
import type { E2eeApi } from "@/lib/api/e2ee";
import type { PublicPreKey } from "@/lib/api/types";
import { toB64 } from "@/lib/bytes";
import type { ChatDb } from "@/lib/db/database";
import { initSignal } from "./envelope-cipher";
import type { DexieSignalStore } from "./signal-store";

/** Prekeys per upload; also the most the API accepts at once. */
export const BATCH_SIZE = 100;
/** The server sends `prekeys:low` below this; ensureKeys uses the same threshold. */
export const LOW_WATERMARK = 10;
export const SIGNED_PRE_KEY_ID = 1;
/** Prekey ids stay in 1 … 0xFFFFFE, as in libsignal. */
const MAX_PRE_KEY_ID = 0xfffffe;

const K_NEXT_PRE_KEY_ID = "nextPreKeyId";
const K_UPLOADED = "keysUploaded";
const K_SIGNED_SIGNATURE = "signedPreKeySignature";

/** The id after [count] ids starting at [start], wrapping like mobile does. */
export function nextPreKeyId(start: number, count: number): number {
  return ((start - 1 + count) % MAX_PRE_KEY_ID) + 1;
}

async function generatePreKeys(start: number, count: number) {
  const out: { keyId: number; keyPair: KeyPairType }[] = [];
  for (let i = 0; i < count; i++) {
    out.push(await KeyHelper.generatePreKey(nextPreKeyId(start, i)));
  }
  return out;
}

const publicOf = (keys: { keyId: number; keyPair: KeyPairType }[]): PublicPreKey[] =>
  keys.map((k) => ({ keyId: k.keyId, publicKey: toB64(k.keyPair.pubKey) }));

/**
 * Creates this browser's Signal keys, publishes the public halves with `PUT /keys` and keeps the
 * server stocked with one-time prekeys. The port of mobile's KeyManager.
 */
export class KeyManager {
  constructor(
    private readonly api: E2eeApi,
    private readonly db: ChatDb,
    readonly store: DexieSignalStore,
  ) {
    initSignal();
  }

  private topUpInFlight: Promise<void> | null = null;

  /**
   * Run after sign-in and on every start: generates keys on first use, (re)uploads them until the
   * server has them, then tops up prekeys when the server is running low.
   */
  async ensureKeys(): Promise<void> {
    if (!(await this.store.hasLocalIdentity())) await this.generate();
    if ((await this.db.readKv(K_UPLOADED)) !== "1") {
      await this.uploadAll();
      return;
    }
    const count = await this.api.getKeyCount();
    if (count < LOW_WATERMARK) await this.topUp(count);
  }

  /**
   * Uploads enough new prekeys to bring the server back to BATCH_SIZE. Calls made while an
   * upload runs share it, so a burst of `prekeys:low` events causes a single upload.
   */
  topUp(remaining: number): Promise<void> {
    this.topUpInFlight ??= this.doTopUp(remaining).finally(() => {
      this.topUpInFlight = null;
    });
    return this.topUpInFlight;
  }

  private async doTopUp(remaining: number): Promise<void> {
    if ((await this.db.readKv(K_UPLOADED)) !== "1") return this.ensureKeys();
    const n = BATCH_SIZE - remaining;
    if (n <= 0) return;
    const start = Number((await this.db.readKv(K_NEXT_PRE_KEY_ID)) ?? "1");
    const keys = await generatePreKeys(start, n);
    await this.store.storePreKeys(keys);
    await this.db.writeKv(K_NEXT_PRE_KEY_ID, String(nextPreKeyId(start, n)));
    const identity = await this.store.getIdentityKeyPair();
    await this.api.uploadKeys({
      registrationId: await this.store.getLocalRegistrationId(),
      identityKey: toB64(identity.pubKey),
      preKeys: publicOf(keys),
    });
  }

  private async generate(): Promise<void> {
    const identity = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const signed = await KeyHelper.generateSignedPreKey(identity, SIGNED_PRE_KEY_ID);
    const preKeys = await generatePreKeys(1, BATCH_SIZE);
    await this.db.preKeys.clear();
    await this.db.signedPreKeys.clear();
    await this.store.storeSignedPreKey(SIGNED_PRE_KEY_ID, signed.keyPair);
    await this.db.writeKv(K_SIGNED_SIGNATURE, toB64(signed.signature));
    await this.store.storePreKeys(preKeys);
    await this.db.writeKv(K_NEXT_PRE_KEY_ID, String(nextPreKeyId(1, BATCH_SIZE)));
    await this.db.writeKv(K_UPLOADED, "0");
    // Last: until the identity exists, the next start generates everything again.
    await this.store.saveLocalIdentity(identity, registrationId);
  }

  /**
   * Sends identity, signed prekey and the stored one-time prekeys. Safe to repeat: the server
   * ignores prekeys it already has.
   */
  private async uploadAll(): Promise<void> {
    const identity = await this.store.getIdentityKeyPair();
    const signed = await this.store.loadSignedPreKey(SIGNED_PRE_KEY_ID);
    const signature = await this.db.readKv(K_SIGNED_SIGNATURE);
    if (!signed || !signature) throw new Error("Signed prekey missing");
    const ids = ((await this.db.preKeys.toCollection().primaryKeys()) as string[])
      .map(Number)
      .sort((x, y) => x - y)
      .slice(0, BATCH_SIZE);
    const stored = await Promise.all(
      ids.map(async (id) => ({ keyId: Number(id), keyPair: (await this.store.loadPreKey(id))! })),
    );
    await this.api.uploadKeys({
      registrationId: await this.store.getLocalRegistrationId(),
      identityKey: toB64(identity.pubKey),
      signedPreKey: {
        keyId: SIGNED_PRE_KEY_ID,
        publicKey: toB64(signed.pubKey),
        signature,
      },
      preKeys: publicOf(stored),
    });
    await this.db.writeKv(K_UPLOADED, "1");
  }
}
