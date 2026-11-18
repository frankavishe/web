import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL, authFetch, refreshSession } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    useAuthStore.getState().clear(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shares one refresh request between concurrent callers", async () => {
    fetchMock.mockResolvedValue(json(200, { accessToken: "a.e30.b", expiresIn: 900 }));
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(results).toEqual(["a.e30.b", "a.e30.b", "a.e30.b"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/auth/refresh`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(useAuthStore.getState().status).toBe("signedIn");
  });

  it("signs out with reason 'expired' when a live session can't be refreshed", async () => {
    useAuthStore.getState().setSession({ accessToken: "old" });
    fetchMock.mockResolvedValue(json(401, { code: "SESSION_REVOKED", message: "x" }));
    expect(await refreshSession()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ status: "signedOut", signOutReason: "expired" });
  });

  it("keeps the session when the server is unreachable", async () => {
    useAuthStore.getState().setSession({ accessToken: "old" });
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await refreshSession()).toBeNull();
    expect(useAuthStore.getState().status).toBe("signedIn");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    useAuthStore.getState().setSession({ accessToken: "old" });
    fetchMock
      .mockResolvedValueOnce(json(401, { code: "UNAUTHORIZED", message: "expired" }))
      .mockResolvedValueOnce(json(200, { accessToken: "new", expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const res = await authFetch(new Request(`${API_URL}/me`));

    expect(res.status).toBe(200);
    const first = fetchMock.mock.calls[0][0] as Request;
    const retry = fetchMock.mock.calls[2][0] as Request;
    expect(first.headers.get("Authorization")).toBe("Bearer old");
    expect(retry.headers.get("Authorization")).toBe("Bearer new");
  });

  it("does not refresh on 401 from /auth routes (e.g. a wrong code)", async () => {
    fetchMock.mockResolvedValue(json(401, { code: "INVALID_CODE", message: "x" }));
    const res = await authFetch(new Request(`${API_URL}/auth/verify`, { method: "POST" }));
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
