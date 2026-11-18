"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { api, call } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth";

const NAV = [
  { href: "/new-chat", label: "New chat" },
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/devices", label: "Linked devices" },
] as const;

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await call(() => api.POST("/auth/sign-out"));
    } catch {
      // Already signed out on the server, or offline: still drop the local session.
    }
    queryClient.clear();
    useAuthStore.getState().clear(null);
  }

  return (
    <aside className="flex w-full flex-col bg-surface">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/settings/profile" className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={user?.displayName} src={user?.avatarThumbUrl ?? user?.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{user?.displayName ?? "You"}</span>
            <span className="block truncate text-xs text-muted">{user?.about}</span>
          </span>
        </Link>
        <button
          onClick={() => void signOut()}
          disabled={signingOut}
          className="rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          Sign out
        </button>
      </header>

      <nav className="flex gap-1 border-b border-border px-3 py-2">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              pathname === item.href
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-2xl" aria-hidden>
          💬
        </span>
        <p className="font-medium">No chats yet</p>
        <p className="text-sm text-muted">Your conversations will appear here.</p>
        <Link
          href="/new-chat"
          className="mt-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:brightness-110"
        >
          Start a chat
        </Link>
      </section>
    </aside>
  );
}
