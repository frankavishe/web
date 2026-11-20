"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { api, call, refreshSession } from "@/lib/api/client";
import type { PublicUser } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";
import { syncLocalSession } from "@/lib/local-data";
import { connectRealtime } from "@/lib/realtime/socket";
import { useAuthStore } from "@/stores/auth";

const PROFILE_PATH = "/settings/profile";

/**
 * Guarded app shell: restores the session from the refresh cookie, loads the profile, keeps
 * the realtime connection open, and returns to sign-in when the device is signed out.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const deviceId = useAuthStore((s) => s.deviceId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // 1. Restore or leave.
  useEffect(() => {
    if (status === "signedOut") {
      queryClient.clear();
      router.replace("/sign-in");
    } else if (status === "unknown") {
      void refreshSession().then((token) => {
        // 401 → the store is signedOut and the branch above runs. Otherwise the server is unreachable.
        if (!token && useAuthStore.getState().status === "unknown") {
          setLoadError("Can't reach the server. Check your connection.");
        }
      });
    }
  }, [status, router, queryClient, attempt]);

  // 2. Load the profile after a restore (sign-in already provides it).
  useEffect(() => {
    if (status !== "signedIn" || user) return;
    call(() => api.GET("/me"))
      .then((me) => useAuthStore.getState().setUser(me))
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [status, user, attempt]);

  // 3. A display name is required before using the app.
  useEffect(() => {
    if (user && !user.profileComplete && pathname !== PROFILE_PATH) router.replace(PROFILE_PATH);
  }, [user, pathname, router]);

  // 4. Encrypted local data: keys for this device on sign-in, wiped on sign-out.
  useEffect(() => {
    syncLocalSession(status, deviceId).catch((e: unknown) => {
      // Offline or server trouble: keys are uploaded on the next start.
      console.warn("local session:", e);
    });
  }, [status, deviceId]);

  // 5. Realtime.
  useEffect(() => {
    if (status !== "signedIn") return;
    return connectRealtime({
      onDeviceRevoked: (e) => useAuthStore.getState().clear(e.reason),
      onProfileUpdated: (e) => {
        useAuthStore.getState().applyProfileUpdate(e);
        queryClient.setQueryData<PublicUser[]>(["contacts"], (list) =>
          list?.map((c) => (c.id === e.id ? { ...c, ...e } : c)),
        );
      },
    });
  }, [status, queryClient]);

  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }, []);

  if (loadError) {
    return (
      <main className="grid min-h-full place-items-center px-4">
        <div className="text-center">
          <p className="text-muted">{loadError}</p>
          <button
            onClick={retry}
            className="mt-4 rounded-xl bg-accent px-5 py-2.5 font-semibold text-accent-fg"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (status !== "signedIn" || !user) {
    return (
      <main className="grid min-h-full place-items-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  const onHome = pathname === "/";

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className={`${onHome ? "flex" : "hidden md:flex"} w-full shrink-0 border-r border-border md:w-[360px]`}
      >
        <Sidebar />
      </div>
      <main className={`${onHome ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col bg-bg`}>
        {children}
      </main>
    </div>
  );
}
