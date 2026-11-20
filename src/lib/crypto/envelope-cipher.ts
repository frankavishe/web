import {
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  setWebCrypto,
} from "@privacyresearch/libsignal-protocol-typescript";
import type { DeviceBundle, Envelope, OutgoingEnvelope } from "@/lib/api/types";
import { binaryStringToB64, fromB64 } from "@/lib/bytes";
import { type DexieSignalStore, SIGNAL_DEVICE_ID } from "./signal-store";

let webCryptoSet = false;
/** The library needs WebCrypto handed to it once (browser and Node alike). */
export function initSignal(): void {
  if (webCryptoSet) return;
  setWebCrypto(globalThis.crypto);
  webCryptoSet = true;
}

export const addressOf = (deviceId: string) => new SignalProtocolAddress(deviceId, SIGNAL_DEVICE_ID);

/** libsignal's message type for prekey messages; the TS library uses 1 for whisper. */
const PREKEY_TYPE = 3;

/**
 * Encrypts and decrypts envelopes with this device's Signal sessions.
 *
 * Every operation runs one at a time: a session is read, ratcheted and written back per call,
 * so two interleaved calls on the same session would lose a ratchet step.
 */
export class EnvelopeCipher {
  constructor(private readonly store: DexieSignalStore) {
    initSignal();
  }

  private tail: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }

  hasSession(deviceId: string): Promise<boolean> {
    return this.serial(async () => {
      if (!(await this.store.containsSession(addressOf(deviceId).toString()))) return false;
      return new SessionCipher(this.store, addressOf(deviceId)).hasOpenSession();
    });
  }

  deleteSession(deviceId: string): Promise<void> {
    return this.serial(() => this.store.deleteSession(addressOf(deviceId).toString()));
  }

  /** Starts a session from a bundle fetched with `GET /users/{id}/keys`. */
  processBundle(b: DeviceBundle): Promise<void> {
    return this.serial(async () => {
      await new SessionBuilder(this.store, addressOf(b.deviceId)).processPreKey({
        registrationId: b.registrationId,
        identityKey: fromB64(b.identityKey),
        signedPreKey: {
          keyId: b.signedPreKey.keyId,
          publicKey: fromB64(b.signedPreKey.publicKey),
          signature: fromB64(b.signedPreKey.signature),
        },
        preKey: b.preKey
          ? { keyId: b.preKey.keyId, publicKey: fromB64(b.preKey.publicKey) }
          : undefined,
      });
    });
  }

  /** One envelope for [deviceId]; needs a session ({@link processBundle}). */
  encrypt(deviceId: string, plaintext: ArrayBuffer): Promise<OutgoingEnvelope> {
    return this.serial(async () => {
      const msg = await new SessionCipher(this.store, addressOf(deviceId)).encrypt(plaintext);
      return {
        deviceId,
        // The Dart and TS libraries number whisper messages differently, so the wire carries
        // names instead (Phase 0 finding).
        type: msg.type === PREKEY_TYPE ? "prekey" : "whisper",
        ciphertext: binaryStringToB64(msg.body!),
      };
    });
  }

  /** Throws on an untrusted identity, a duplicate or an invalid message. */
  decrypt(e: Pick<Envelope, "senderDeviceId" | "type" | "ciphertext">): Promise<ArrayBuffer> {
    return this.serial(async () => {
      const cipher = new SessionCipher(this.store, addressOf(e.senderDeviceId));
      const bytes = fromB64(e.ciphertext);
      return e.type === "prekey"
        ? cipher.decryptPreKeyWhisperMessage(bytes)
        : cipher.decryptWhisperMessage(bytes);
    });
  }
}
