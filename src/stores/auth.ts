import { create } from "zustand";
import type { DeviceRevokedReason, Me, ProfileUpdatedEvent } from "@/lib/api/types";

/**
 * - `unknown`: page just loaded; a session may still be restored from the refresh cookie.
 * - `signedIn`: we hold an access token.
 * - `signedOut`: no session (never signed in, signed out, or revoked).
 */
export type AuthStatus = "unknown" | "signedIn" | "signedOut";

export type SignOutReason = DeviceRevokedReason | "expired";

interface AuthState {
  status: AuthStatus;
  /** Kept in memory only; the refresh token lives in an HttpOnly cookie. */
  accessToken: string | null;
  user: Me | null;
  deviceId: string | null;
  /** Why the last session ended, shown once on the sign-in page. */
  signOutReason: SignOutReason | null;

  setSession: (s: { accessToken: string; user?: Me; deviceId?: string }) => void;
  setAccessToken: (token: string) => void;
  setUser: (user: Me) => void;
  applyProfileUpdate: (e: ProfileUpdatedEvent) => void;
  clear: (reason?: SignOutReason | null) => void;
  consumeSignOutReason: () => SignOutReason | null;
}

/** Reads the `did` claim; the token is not verified here (the server does that). */
export function deviceIdFromToken(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const did = (JSON.parse(json) as { did?: unknown }).did;
    return typeof did === "string" ? did : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "unknown",
  accessToken: null,
  user: null,
  deviceId: null,
  signOutReason: null,

  setSession: ({ accessToken, user, deviceId }) =>
    set((s) => ({
      status: "signedIn",
      accessToken,
      user: user ?? s.user,
      deviceId: deviceId ?? s.deviceId,
      signOutReason: null,
    })),

  setAccessToken: (accessToken) =>
    set((s) => ({
      accessToken,
      status: "signedIn",
      deviceId: deviceIdFromToken(accessToken) ?? s.deviceId,
    })),

  setUser: (user) => set({ user }),

  applyProfileUpdate: (e) => {
    const user = get().user;
    if (!user || user.id !== e.id) return;
    set({
      user: {
        ...user,
        displayName: e.displayName,
        about: e.about,
        avatarUrl: e.avatarUrl,
        avatarThumbUrl: e.avatarThumbUrl ?? null,
        profileComplete: e.displayName !== null && e.displayName.length > 0,
      },
    });
  },

  clear: (reason = null) =>
    set({
      status: "signedOut",
      accessToken: null,
      user: null,
      deviceId: null,
      signOutReason: reason,
    }),

  consumeSignOutReason: () => {
    const reason = get().signOutReason;
    if (reason) set({ signOutReason: null });
    return reason;
  },
}));
