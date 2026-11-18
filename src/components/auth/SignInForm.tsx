"use client";

import type { CountryCode } from "libphonenumber-js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, call } from "@/lib/api/client";
import { deviceNameFromUserAgent } from "@/lib/device-name";
import { errorMessage } from "@/lib/errors";
import { useDefaultCountry } from "@/lib/hooks";
import { formatPhone, listCountries, toE164 } from "@/lib/phone";
import { useAuthStore } from "@/stores/auth";

type Step = { name: "phone" } | { name: "code"; phone: string };

const CODE_LENGTH = 6;

/** Counts down from `seconds` to 0 once per second. */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, setLeft] as const;
}

export function SignInForm({ onSignedIn }: { onSignedIn: () => void }) {
  const countries = useMemo(() => listCountries(), []);
  const defaultCountry = useDefaultCountry();
  const [picked, setCountry] = useState<CountryCode | null>(null);
  const country = picked ?? defaultCountry;
  const [national, setNational] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useCountdown();
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneId = useId();
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    if (step.name === "code") codeRef.current?.focus();
  }, [step.name]);

  const dialCode = countries.find((c) => c.code === country)?.dialCode ?? "";

  async function requestCode(phone: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await call(() => api.POST("/auth/request-code", { body: { phone } }));
      setStep({ name: "code", phone });
      setCode("");
      setResendIn(res.resendAfter);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    const check = toE164(national, country);
    if (!check.ok) {
      setError(
        check.reason === "empty"
          ? "Enter your phone number."
          : "That doesn't look like a valid number for this country.",
      );
      return;
    }
    await requestCode(check.e164);
  }

  async function verify(phone: string, value: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await call(() =>
        api.POST("/auth/verify", {
          body: {
            phone,
            code: value,
            deviceType: "web",
            deviceName: deviceNameFromUserAgent(navigator.userAgent),
          },
        }),
      );
      setSession({ accessToken: res.accessToken, user: res.user, deviceId: res.device.id });
      onSignedIn();
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && step.name === "code" && !busy) {
      void verify(step.phone, digits);
    }
  }

  const input =
    "w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60";
  const primary =
    "w-full rounded-xl bg-accent px-4 py-3 font-semibold text-accent-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

  if (step.name === "phone") {
    return (
      <form onSubmit={submitPhone} noValidate className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted">
            Enter the phone number of your Chat App account. We&apos;ll text you a code.
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Country
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value as CountryCode)}
            className={input}
            disabled={busy}
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.dialCode})
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5 text-sm font-medium">
          <label htmlFor={phoneId}>Phone number</label>
          <div className="flex gap-2">
            <span
              aria-hidden
              className="grid min-w-16 place-items-center rounded-xl border border-border bg-surface-2 px-3 font-mono text-sm text-muted"
            >
              {dialCode}
            </span>
            <input
              id={phoneId}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="712 345 678"
              value={national}
              onChange={(e) => setNational(e.target.value)}
              className={input}
              disabled={busy}
              aria-invalid={error ? true : undefined}
            />
          </div>
        </div>

        {error && <ErrorText>{error}</ErrorText>}

        <button type="submit" className={primary} disabled={busy}>
          {busy ? "Sending code…" : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === CODE_LENGTH) void verify(step.phone, code);
        else setError("Enter the 6-digit code.");
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enter the code</h1>
        <p className="mt-1 text-sm text-muted">
          We sent a 6-digit code to <span className="font-medium text-fg">{formatPhone(step.phone)}</span>.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Verification code
        <input
          ref={codeRef}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          className={`${input} text-center font-mono text-2xl tracking-[0.5em]`}
          disabled={busy}
          aria-invalid={error ? true : undefined}
        />
      </label>

      {error && <ErrorText>{error}</ErrorText>}

      <button type="submit" className={primary} disabled={busy || code.length !== CODE_LENGTH}>
        {busy ? "Checking…" : "Sign in"}
      </button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-muted underline-offset-4 hover:underline"
          onClick={() => {
            setStep({ name: "phone" });
            setError(null);
          }}
        >
          Change number
        </button>
        {resendIn > 0 ? (
          <span className="text-muted" aria-live="polite">
            Resend code in {resendIn}s
          </span>
        ) : (
          <button
            type="button"
            className="font-medium text-accent underline-offset-4 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void requestCode(step.phone)}
          >
            Resend code
          </button>
        )}
      </div>
    </form>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      {children}
    </p>
  );
}
