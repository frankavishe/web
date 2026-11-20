import { decodeJson, encodeJson, fromB64, fromUtf8, toB64, utf8 } from "@/lib/bytes";

/**
 * Encryption at rest for this browser's chat data (the web counterpart of SQLCipher on Android).
 *
 * One AES-GCM-256 key per local database, created non-extractable with WebCrypto and kept in
 * IndexedDB by structured clone: script can use it but never read its bytes, so a copy of the
 * browser profile on disk holds only ciphertext, not something that decrypts it offline.
 *
 * What is sealed: message bodies, group names, cached names and numbers, every Signal record
 * and outbox payloads. What stays clear (so IndexedDB can index and sort it): ids, conversation
 * ids, timestamps, delivery status, message kind and sender ids. That routing data is what the
 * server sees anyway; SQLCipher hides it too, which IndexedDB can't while staying queryable.
 */
/**
 * `base64(iv):base64(ciphertext)`. A string rather than bytes, so IndexedDB copies (and Dexie's
 * update cloning) never depend on which realm created a typed array.
 */
export type Sealed = string;

export interface VaultKeyStore {
  load(): Promise<CryptoKey | undefined>;
  save(key: CryptoKey): Promise<void>;
}

export class Vault {
  constructor(private readonly keys: VaultKeyStore) {}

  private keyPromise: Promise<CryptoKey> | null = null;

  private key(): Promise<CryptoKey> {
    this.keyPromise ??= (async () => {
      const existing = await this.keys.load();
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await this.keys.save(key);
      return key;
    })().catch((e: unknown) => {
      this.keyPromise = null;
      throw e;
    });
    return this.keyPromise;
  }

  async seal(value: unknown): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.key(),
      utf8(encodeJson(value)),
    );
    return `${toB64(iv)}:${toB64(data)}`;
  }

  async unseal<T>(sealed: Sealed): Promise<T> {
    const [iv, data] = sealed.split(":");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      await this.key(),
      fromB64(data),
    );
    return decodeJson<T>(fromUtf8(plain));
  }

  async sealOrNull(value: unknown): Promise<Sealed | null> {
    return value === null || value === undefined ? null : this.seal(value);
  }

  async unsealOrNull<T>(sealed: Sealed | null | undefined): Promise<T | null> {
    return sealed ? this.unseal<T>(sealed) : null;
  }
}
