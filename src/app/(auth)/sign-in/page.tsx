"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SignInForm } from "@/components/auth/SignInForm";
import { refreshSession } from "@/lib/api/client";
import { type SignOutReason, useAuthStore } from "@/stores/auth";

const REASONS: Record<SignOutReason, string> = {
  signed_out: "This browser was signed out.",
  replaced: "This browser was signed out.",
  evicted: "This browser was signed out because the account signed in on another browser.",
  token_reuse: "This browser was signed out for your security. Sign in again.",
  inactive: "You were signed out after a long time without activity.",
  expired: "Your session has ended. Sign in again.",
};

export default function SignInPage() {
  const router = useRouter();
  // A reason only exists after an in-app navigation (never on first load), so reading the
  // store here can't cause a hydration mismatch.
  const [notice] = useState(() => {
    const reason = useAuthStore.getState().signOutReason;
    return reason ? REASONS[reason] : null;
  });
  // Only a first load (status unknown) needs to probe the refresh cookie.
  const [checking, setChecking] = useState(
    () => useAuthStore.getState().status !== "signedOut",
  );

  useEffect(() => {
    const store = useAuthStore.getState();
    store.consumeSignOutReason();

    if (store.status === "signedIn") {
      router.replace("/");
      return;
    }
    if (store.status === "signedOut") return;
    // First load: the refresh cookie may still hold a session.
    let active = true;
    void refreshSession().then((token) => {
      if (!active) return;
      if (token) router.replace("/");
      else setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="grid min-h-full place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-accent font-bold text-accent-fg">
            C
          </span>
          <span className="text-lg font-semibold">Chat App</span>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          {notice && (
            <p className="mb-5 rounded-xl bg-accent-soft px-4 py-3 text-sm" role="status">
              {notice}
            </p>
          )}
          {checking ? (
            <p className="py-10 text-center text-sm text-muted">Loading…</p>
          ) : (
            <SignInForm onSignedIn={() => router.replace("/")} />
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          New to Chat App? Create your account in the Android app, then sign in here.
        </p>
      </div>
    </main>
  );
}
