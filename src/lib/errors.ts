import { ApiError } from "./api/client";
import type { ErrorCode } from "./api/types";

const MESSAGES: Partial<Record<ErrorCode | "NETWORK", string>> = {
  INVALID_PHONE: "That phone number isn't valid.",
  INVALID_CODE: "That code isn't right. Check it and try again.",
  CODE_EXPIRED: "That code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Request a new code.",
  ACCOUNT_NOT_FOUND:
    "There's no account for this number yet. Create your account on the Android app first, then sign in here.",
  USER_NOT_FOUND: "This number isn't on Chat App.",
  DEVICE_NOT_FOUND: "That device is no longer signed in.",
  SESSION_REVOKED: "This browser was signed out.",
  UNAUTHORIZED: "Your session has ended. Sign in again.",
  FILE_TOO_LARGE: "That photo is too large. The limit is 5 MB.",
  UNSUPPORTED_MEDIA_TYPE: "Use a JPEG, PNG or WebP photo.",
  NETWORK: "Can't reach the server. Check your connection.",
};

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** A sentence to show the user for any error thrown by the API helpers. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  if (error.code === "RATE_LIMITED") {
    return error.retryAfter
      ? `Too many requests. Try again in ${waitText(error.retryAfter)}.`
      : "Too many requests. Try again later.";
  }
  if (error.code === "VALIDATION_FAILED") return error.message || "Check what you entered.";
  return MESSAGES[error.code] ?? "Something went wrong. Try again.";
}
