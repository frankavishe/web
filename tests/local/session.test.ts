// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadKeysBody } from "@/lib/api/types";

const uploads: UploadKeysBody[] = [];

vi.mock("@/lib/api/e2ee", () => ({
  httpE2eeApi: {
    uploadKeys: async (b: UploadKeysBody) => {
      uploads.push(b);
    },
    getKeyCount: async () => 100,
  },
}));

const { localData, syncLocalSession, wipeLocalData } = await import("@/lib/local-data");

afterEach(async () => {
  await wipeLocalData();
  uploads.length = 0;
});

describe("syncLocalSession", () => {
  it("creates keys on sign-in and keeps them across a restart of the same device", async () => {
    await syncLocalSession("signedIn", "dev-1");
    expect(uploads).toHaveLength(1);
    const identity = uploads[0].identityKey;

    await localData().db.writeKv("probe", "kept");
    await syncLocalSession("unknown", null); // page reload: session being restored
    await syncLocalSession("signedIn", "dev-1");
    expect(uploads).toHaveLength(1);
    expect(await localData().db.readKv("probe")).toBe("kept");
    expect(uploads[0].identityKey).toBe(identity);
  });

  it("wipes data that belongs to another device before creating new keys", async () => {
    await syncLocalSession("signedIn", "dev-1");
    await localData().db.writeKv("probe", "old");
    await syncLocalSession("signedIn", "dev-2");
    expect(await localData().db.readKv("probe")).toBeNull();
    expect(uploads).toHaveLength(2);
    expect(uploads[1].identityKey).not.toBe(uploads[0].identityKey);
  });

  it("wipes everything on sign-out", async () => {
    await syncLocalSession("signedIn", "dev-1");
    await localData().db.writeKv("probe", "x");
    await syncLocalSession("signedOut", null);
    expect(await localData().db.readKv("probe")).toBeNull();
    expect(await localData().store.hasLocalIdentity()).toBe(false);
  });
});
