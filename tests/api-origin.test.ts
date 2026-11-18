import { afterEach, describe, expect, it, vi } from "vitest";

async function loadClient() {
  vi.resetModules();
  return import("@/lib/api/client");
}

describe("API_URL / API_ORIGIN resolution", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the localhost defaults when nothing is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_REALTIME_URL", undefined);
    const { API_URL, API_ORIGIN } = await loadClient();
    expect(API_URL).toBe("http://localhost:3000/v1");
    expect(API_ORIGIN).toBe("http://localhost:3000");
  });

  it("accepts a relative API URL (proxied) with an explicit realtime URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/v1/");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_URL", "https://chat-api.onrender.com/");
    const { API_URL, API_ORIGIN } = await loadClient();
    expect(API_URL).toBe("/v1");
    expect(API_ORIGIN).toBe("https://chat-api.onrender.com");
  });

  it("does not throw on a relative API URL without a realtime URL (falls back to same origin)", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/v1");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_URL", undefined);
    const { API_ORIGIN } = await loadClient();
    expect(API_ORIGIN).toBe("");
  });
});
