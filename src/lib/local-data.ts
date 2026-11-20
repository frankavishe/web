import { type E2eeApi, httpE2eeApi } from "@/lib/api/e2ee";
import { EnvelopeCipher } from "@/lib/crypto/envelope-cipher";
import { KeyManager } from "@/lib/crypto/key-manager";
import { DexieSignalStore } from "@/lib/crypto/signal-store";
import { ChatDb } from "@/lib/db/database";

/** This browser's encrypted chat data and the Signal objects built on it. */
export interface LocalData {
  db: ChatDb;
  store: DexieSignalStore;
  cipher: EnvelopeCipher;
  keys: KeyManager;
}

export function createLocalData(api: E2eeApi = httpE2eeApi, name = "chat"): LocalData {
  const db = new ChatDb(name);
  const store = new DexieSignalStore(db);
  return { db, store, cipher: new EnvelopeCipher(store), keys: new KeyManager(api, db, store) };
}

let current: LocalData | null = null;

/** The app's local data, opened on first use. */
export function localData(): LocalData {
  current ??= createLocalData();
  return current;
}

/** Closes and deletes the local database, its vault key included. */
export async function wipeLocalData(): Promise<void> {
  const data = current;
  current = null;
  const db = data?.db ?? new ChatDb();
  db.close();
  await db.delete();
}

const K_OWNER_DEVICE = "ownerDeviceId";

let generation = 0;

/**
 * Keeps local data in step with the session; call it whenever the auth status or device changes.
 * - Signed in: data belonging to another device (another account, or an earlier sign-in of this
 *   one) is wiped, then keys are created and uploaded if needed.
 * - Signed out (sign-out, revoked, expired): everything is wiped.
 * A page reload keeps the data, so this browser's Signal identity survives it.
 *
 * Resolves once done; a newer call makes older ones stop early.
 */
export async function syncLocalSession(status: "unknown" | "signedIn" | "signedOut", deviceId: string | null) {
  const gen = ++generation;
  if (status === "signedOut") {
    await wipeLocalData();
    return;
  }
  if (status !== "signedIn" || !deviceId) return;
  let data = localData();
  const owner = await data.db.readKv(K_OWNER_DEVICE);
  if (gen !== generation) return;
  if (owner !== null && owner !== deviceId) {
    await wipeLocalData();
    if (gen !== generation) return;
    data = localData();
  }
  await data.db.writeKv(K_OWNER_DEVICE, deviceId);
  if (gen !== generation) return;
  await data.keys.ensureKeys();
}
