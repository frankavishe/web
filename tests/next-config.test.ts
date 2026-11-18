import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return (await import("../next.config")).default;
}

describe("next.config rewrites (API proxy)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not proxy when API_PROXY_TARGET is unset (local dev)", async () => {
    vi.stubEnv("API_PROXY_TARGET", "");
    const config = await loadConfig();
    expect(await config.rewrites!()).toEqual([]);
  });

  it("proxies /v1/* to the API, stripping a trailing slash", async () => {
    vi.stubEnv("API_PROXY_TARGET", "https://chat-api.onrender.com/");
    const config = await loadConfig();
    expect(await config.rewrites!()).toEqual([
      { source: "/v1/:path*", destination: "https://chat-api.onrender.com/v1/:path*" },
    ]);
  });
});
