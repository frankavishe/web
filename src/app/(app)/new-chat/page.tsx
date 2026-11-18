"use client";

import { useQuery } from "@tanstack/react-query";
import type { CountryCode } from "libphonenumber-js";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PageHeader } from "@/components/shell/PageHeader";
import { ApiError, api, call } from "@/lib/api/client";
import type { PublicUser } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";
import { useDefaultCountry } from "@/lib/hooks";
import { formatPhone, listCountries, toE164 } from "@/lib/phone";
import { useAuthStore } from "@/stores/auth";

type Lookup =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "found"; user: PublicUser }
  | { state: "missing"; phone: string }
  | { state: "error"; text: string };

export default function NewChatPage() {
  const me = useAuthStore((s) => s.user);
  const countries = useMemo(() => listCountries(), []);
  const defaultCountry = useDefaultCountry();
  const [picked, setCountry] = useState<CountryCode | null>(null);
  const country = picked ?? defaultCountry;
  const [number, setNumber] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [selected, setSelected] = useState<PublicUser | null>(null);

  const contacts = useQuery({
    queryKey: ["contacts"],
    queryFn: () => call(() => api.GET("/contacts")),
  });

  async function find(e: React.FormEvent) {
    e.preventDefault();
    const check = toE164(number, country);
    if (!check.ok) {
      setLookup({
        state: "error",
        text: check.reason === "empty" ? "Enter a phone number." : "That number isn't valid for this country.",
      });
      return;
    }
    if (check.e164 === me?.phone) {
      setLookup({ state: "error", text: "That's your own number." });
      return;
    }
    setLookup({ state: "busy" });
    try {
      const user = await call(() => api.GET("/users/lookup", { params: { query: { phone: check.e164 } } }));
      setLookup({ state: "found", user });
    } catch (err) {
      if (err instanceof ApiError && err.code === "USER_NOT_FOUND") {
        setLookup({ state: "missing", phone: check.e164 });
      } else {
        setLookup({ state: "error", text: errorMessage(err) });
      }
    }
  }

  const field =
    "rounded-xl border border-border bg-surface px-3 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25";

  return (
    <>
      <PageHeader title="New chat" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-lg flex-col gap-8 px-4 py-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
              Find by phone number
            </h2>
            <form onSubmit={find} noValidate className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value as CountryCode)}
                className={`${field} sm:w-36`}
              >
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.dialCode}
                  </option>
                ))}
              </select>
              <input
                aria-label="Phone number"
                type="tel"
                inputMode="tel"
                placeholder="Phone number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className={`${field} flex-1`}
              />
              <button
                type="submit"
                disabled={lookup.state === "busy"}
                className="rounded-xl bg-accent px-4 py-2.5 font-semibold text-accent-fg disabled:opacity-50"
              >
                {lookup.state === "busy" ? "Searching…" : "Search"}
              </button>
            </form>

            <div className="mt-3" aria-live="polite">
              {lookup.state === "found" && (
                <UserRow user={lookup.user} onSelect={setSelected} />
              )}
              {lookup.state === "missing" && (
                <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
                  {formatPhone(lookup.phone)} isn&apos;t on Chat App yet.
                </p>
              )}
              {lookup.state === "error" && (
                <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                  {lookup.text}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
              Contacts on Chat App
            </h2>
            {contacts.isPending && <p className="text-sm text-muted">Loading contacts…</p>}
            {contacts.isError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(contacts.error)}
              </p>
            )}
            {contacts.data?.length === 0 && (
              <p className="text-sm text-muted">
                No contacts yet. Contacts from your phone&apos;s address book appear here after you
                open the Android app.
              </p>
            )}
            {contacts.data && contacts.data.length > 0 && (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {contacts.data.map((c) => (
                  <li key={c.id}>
                    <UserRow user={c} onSelect={setSelected} flat />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selected && (
            <section className="rounded-2xl border border-border bg-surface p-5 text-center">
              <div className="flex justify-center">
                <Avatar name={selected.displayName} src={selected.avatarUrl} size="lg" />
              </div>
              <p className="mt-3 text-lg font-semibold">{selected.displayName ?? formatPhone(selected.phone)}</p>
              <p className="text-sm text-muted">{formatPhone(selected.phone)}</p>
              <p className="mt-2 text-sm">{selected.about}</p>
              <p className="mt-4 text-xs text-muted">Messaging is coming in the next update.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function UserRow({
  user,
  onSelect,
  flat = false,
}: {
  user: PublicUser;
  onSelect: (u: PublicUser) => void;
  flat?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(user)}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 ${
        flat ? "" : "rounded-2xl border border-border bg-surface"
      }`}
    >
      <Avatar name={user.displayName} src={user.avatarThumbUrl ?? user.avatarUrl} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{user.displayName ?? formatPhone(user.phone)}</span>
        <span className="block truncate text-sm text-muted">{user.about}</span>
      </span>
    </button>
  );
}
