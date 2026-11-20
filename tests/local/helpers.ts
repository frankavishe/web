import { isArrayBuffer } from "@/lib/bytes";
import { ChatDb } from "@/lib/db/database";

let n = 0;

/** A fresh database with a unique name. */
export function freshDb(): ChatDb {
  return new ChatDb(`test-${Date.now()}-${n++}`);
}

/** Every value stored in [db], flattened to text (bytes as latin1), for leak checks. */
export async function rawDump(db: ChatDb): Promise<string> {
  const parts: string[] = [];
  const visit = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(String(v));
    else if (isArrayBuffer(v)) parts.push(String.fromCharCode(...new Uint8Array(v)));
    else if (ArrayBuffer.isView(v)) parts.push(String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (typeof v === "object") Object.values(v).forEach(visit);
  };
  for (const table of db.tables) {
    if (table.name === "meta") continue; // the CryptoKey itself (non-extractable)
    for (const row of await table.toArray()) visit(row);
  }
  return parts.join("\n");
}
