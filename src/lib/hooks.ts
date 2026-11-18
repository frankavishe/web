"use client";

import type { CountryCode } from "libphonenumber-js";
import { useSyncExternalStore } from "react";
import { countryFromLocale } from "./phone";

const noopSubscribe = () => () => {};

/**
 * The visitor's country from the browser language. The server render (and hydration) uses
 * the fallback, so markup matches; the browser value applies right after.
 */
export function useDefaultCountry(): CountryCode {
  return useSyncExternalStore(
    noopSubscribe,
    () => countryFromLocale(navigator.language),
    () => countryFromLocale(undefined),
  );
}

// A shared minute clock, so components don't read Date.now() while rendering.
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void) {
  if (listeners.size === 0) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

/** Current time in ms, updated every minute; null during server rendering and hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => {
      // Cached between ticks: getSnapshot must return the same value until it changes.
      if (now === 0) now = Date.now();
      return now;
    },
    () => null,
  );
}
