/** Byte helpers shared by the vault and the Signal code. Work in the browser and in Node. */

/** True for an ArrayBuffer from any realm (jsdom and Node have separate globals in tests). */
export function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return Object.prototype.toString.call(v) === "[object ArrayBuffer]";
}

function bytesOf(data: ArrayBuffer | Uint8Array): Uint8Array {
  return isArrayBuffer(data) ? new Uint8Array(data) : data;
}

export function toB64(data: ArrayBuffer | Uint8Array): string {
  const bytes = bytesOf(data);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/**
 * libsignal-protocol-typescript returns ciphertext as a "binary string" (one char per byte).
 * Phase 0 finding: convert it via latin1, never as UTF-8.
 */
export function binaryStringToB64(s: string): string {
  return btoa(s);
}

export function utf8(s: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function fromUtf8(data: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(bytesOf(data));
}

/** JSON that keeps ArrayBuffers (as `{"$ab": base64}`), for Signal key pairs in the vault. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v: unknown) {
    // The replacer sees the raw value through `this[key]` (ArrayBuffer has no toJSON).
    const raw = key === "" ? v : this[key];
    return isArrayBuffer(raw) ? { $ab: toB64(raw) } : v;
  });
}

export function decodeJson<T>(json: string): T {
  return JSON.parse(json, (_key, v: unknown) =>
    v !== null && typeof v === "object" && "$ab" in v && Object.keys(v).length === 1
      ? fromB64((v as { $ab: string }).$ab)
      : v,
  ) as T;
}
