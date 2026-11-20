import {
  type KeyPairType,
  type SessionRecordType,
  type StorageType,
} from "@privacyresearch/libsignal-protocol-typescript";
import { toB64 } from "@/lib/bytes";
import type { ChatDb } from "@/lib/db/database";

/** Every device is its own Signal address: `(deviceUUID, 1)`. */
export const SIGNAL_DEVICE_ID = 1;

export class UntrustedIdentityError extends Error {
  constructor(readonly address: string) {
    super(`Identity key changed for ${address}`);
    this.name = "UntrustedIdentityError";
  }
}

interface LocalIdentity {
  keyPair: KeyPairType;
  registrationId: number;
}

/** `"device-uuid.1"` → `"device-uuid"`; a bare name stays as it is. */
function nameOf(address: string): string {
  const dot = address.lastIndexOf(".");
  return dot > 0 && /^\d+$/.test(address.slice(dot + 1)) ? address.slice(0, dot) : address;
}

const same = (a: ArrayBuffer, b: ArrayBuffer) => toB64(a) === toB64(b);

/**
 * The libsignal store, kept in the encrypted local database (every record sealed).
 *
 * Remote identities are trusted on first use; a different key for a known device is rejected,
 * as on mobile. `saveIdentity` enforces that too, because the library's prekey-message path
 * doesn't await `isTrustedIdentity` (session-builder.js, processV3).
 */
export class DexieSignalStore implements StorageType {
  constructor(private readonly db: ChatDb) {}

  // ---- this device ----------------------------------------------------------------------

  async hasLocalIdentity(): Promise<boolean> {
    return (await this.db.identity.get("local")) !== undefined;
  }

  async saveLocalIdentity(keyPair: KeyPairType, registrationId: number): Promise<void> {
    await this.db.putSealed(this.db.identity, "local", { keyPair, registrationId } satisfies LocalIdentity);
  }

  private async local(): Promise<LocalIdentity> {
    const id = await this.db.getSealed<LocalIdentity>(this.db.identity, "local");
    if (!id) throw new Error("No local identity");
    return id;
  }

  async getIdentityKeyPair(): Promise<KeyPairType> {
    return (await this.local()).keyPair;
  }

  async getLocalRegistrationId(): Promise<number> {
    return (await this.local()).registrationId;
  }

  // ---- remote identities ----------------------------------------------------------------

  async getIdentity(address: string): Promise<ArrayBuffer | undefined> {
    return this.db.getSealed<ArrayBuffer>(this.db.remoteIdentities, nameOf(address));
  }

  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    if (!identityKey) return false;
    const known = await this.getIdentity(identifier);
    return known === undefined || same(known, identityKey);
  }

  /** Returns true when an existing key was replaced (never: a change throws). */
  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const name = nameOf(encodedAddress);
    const known = await this.getIdentity(name);
    if (known !== undefined) {
      if (same(known, publicKey)) return false;
      throw new UntrustedIdentityError(name);
    }
    await this.db.putSealed(this.db.remoteIdentities, name, publicKey);
    return false;
  }

  // ---- prekeys ----------------------------------------------------------------------------

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return this.db.getSealed<KeyPairType>(this.db.preKeys, String(keyId));
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.db.putSealed(this.db.preKeys, String(keyId), keyPair);
  }

  async storePreKeys(keys: { keyId: number; keyPair: KeyPairType }[]): Promise<void> {
    await this.db.putSealedMany(
      this.db.preKeys,
      keys.map((k) => [String(k.keyId), k.keyPair]),
    );
  }

  async removePreKey(keyId: number | string): Promise<void> {
    await this.db.preKeys.delete(String(keyId));
  }

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    return this.db.getSealed<KeyPairType>(this.db.signedPreKeys, String(keyId));
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.db.putSealed(this.db.signedPreKeys, String(keyId), keyPair);
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    await this.db.signedPreKeys.delete(String(keyId));
  }

  // ---- sessions ---------------------------------------------------------------------------

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    return this.db.getSealed<SessionRecordType>(this.db.sessions, encodedAddress);
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    await this.db.putSealed(this.db.sessions, encodedAddress, record);
  }

  async containsSession(encodedAddress: string): Promise<boolean> {
    return (await this.db.sessions.get(encodedAddress)) !== undefined;
  }

  async deleteSession(encodedAddress: string): Promise<void> {
    await this.db.sessions.delete(encodedAddress);
  }
}
