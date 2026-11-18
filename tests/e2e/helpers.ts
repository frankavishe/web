import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/v1").replace(/\/$/, "");

/** The API allows one code request per number per 60 s. */
const RESEND_MS = 61_000;
const lastRequest = new Map<string, number>();

/** A random valid Tanzanian mobile number (+255 7XX XXX XXX). */
export function randomPhone(): { e164: string; national: string } {
  const rest = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const national = `71${rest.slice(0, 7)}`;
  return { e164: `+255${national}`, national: `0${national}` };
}

async function waitForResend(phone: string) {
  const last = lastRequest.get(phone);
  if (last) {
    const wait = last + RESEND_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

/** Reads the latest code from the dev-only endpoint (API must run with NODE_ENV=development). */
export async function lastOtp(request: APIRequestContext, phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const res = await request.get(`${API_URL}/dev/last-otp`, { params: { phone } });
      if (!res.ok()) return undefined;
      code = ((await res.json()) as { code: string }).code;
      return code;
    }, { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  return code!;
}

/** Marks a code request done from the browser, so the next one waits for the cooldown. */
export function noteCodeRequested(phone: string) {
  lastRequest.set(phone, Date.now());
}

export async function requestCode(request: APIRequestContext, phone: string) {
  await waitForResend(phone);
  const res = await request.post(`${API_URL}/auth/request-code`, { data: { phone } });
  expect(res.status(), await res.text()).toBe(202);
  noteCodeRequested(phone);
}

/**
 * Creates an account the way the Android app does (only Android can create accounts) and
 * sets a display name. Returns the Android access token.
 */
export async function createAccount(
  request: APIRequestContext,
  phone: string,
  displayName: string,
): Promise<string> {
  await requestCode(request, phone);
  const code = await lastOtp(request, phone);
  const res = await request.post(`${API_URL}/auth/verify`, {
    data: { phone, code, deviceType: "android", deviceName: "Playwright Pixel" },
  });
  expect(res.status(), await res.text()).toBe(200);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const patch = await request.patch(`${API_URL}/me`, {
    data: { displayName },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  return accessToken;
}

/** Signs in through the web UI, waiting out the per-number resend cooldown first. */
export async function signInOnWeb(page: Page, request: APIRequestContext, phone: { e164: string; national: string }) {
  await waitForResend(phone.e164);
  await page.goto("/sign-in");
  await page.getByLabel("Country").selectOption("TZ");
  await page.getByLabel("Phone number").fill(phone.national);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  noteCodeRequested(phone.e164);
  const code = await lastOtp(request, phone.e164);
  await page.getByLabel("Verification code").fill(code);
}
