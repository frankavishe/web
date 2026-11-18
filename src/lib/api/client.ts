import createClient from "openapi-fetch";
import { useAuthStore } from "@/stores/auth";
import type { paths } from "./schema";
import type { ErrorBody, ErrorCode, TokenPair } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/v1").replace(
  /\/$/,
  "",
);

/** Origin of the API (no /v1), used for the Socket.IO connection. */
export const API_ORIGIN = new URL(API_URL).origin;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK",
    message: string,
    /** Seconds from the Retry-After header on 429 responses. */
    readonly retryAfter?: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the HttpOnly `rt` cookie for a new access token. Concurrent callers share one
 * request, because the server rotates the refresh token and treats reuse as theft.
 * Resolves to the new access token, or null when the session is gone (the store is cleared).
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        // Only a definite rejection ends the session; network errors keep it.
        if (res.status === 401) {
          const store = useAuthStore.getState();
          store.clear(store.status === "signedIn" ? "expired" : null);
        }
        return null;
      }
      const body = (await res.json()) as TokenPair;
      useAuthStore.getState().setAccessToken(body.accessToken);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function withToken(request: Request, token: string | null): Request {
  const r = new Request(request);
  if (token) r.headers.set("Authorization", `Bearer ${token}`);
  return r;
}

/** /auth/* routes use their own 401 semantics (wrong code, bad refresh token). */
function isAuthRoute(request: Request): boolean {
  return new URL(request.url).pathname.includes("/auth/");
}

/** fetch with bearer token and a single retry after a refresh on 401. */
export async function authFetch(request: Request): Promise<Response> {
  const retry = request.clone();
  const res = await fetch(withToken(request, useAuthStore.getState().accessToken));
  if (res.status !== 401 || isAuthRoute(request)) return res;

  const token = await refreshSession();
  if (!token) return res;
  return fetch(withToken(retry, token));
}

export const api = createClient<paths>({
  baseUrl: API_URL,
  credentials: "include",
  fetch: authFetch,
});

/** Turns an openapi-fetch result into its data, or throws an ApiError. */
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  const { response } = result;
  if (response.ok) return result.data as T;
  const body = (result.error ?? {}) as Partial<ErrorBody>;
  const retryAfter = Number(response.headers.get("Retry-After")) || undefined;
  throw new ApiError(
    response.status,
    body.code ?? "INTERNAL",
    body.message ?? `Request failed (${response.status})`,
    retryAfter,
    body.details,
  );
}

/** Wraps network failures (offline, CORS, API down) in an ApiError. */
export async function call<T>(
  fn: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result;
  try {
    result = await fn();
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection.");
  }
  return unwrap(result);
}
