import { expect, test } from "@playwright/test";
import { createAccount, randomPhone, signInOnWeb } from "./helpers";

// Three codes for one number → two 60 s resend cooldowns.
test.describe.configure({ timeout: 240_000 });

test("signing out one browser from another returns it to sign-in within 10 s", async ({ browser, request }) => {
  const phone = randomPhone();
  await createAccount(request, phone.e164, "Device Tester");

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await signInOnWeb(a, request, phone);
  await expect(a).toHaveURL("/");
  await signInOnWeb(b, request, phone);
  await expect(b).toHaveURL("/");

  await a.goto("/settings/devices");
  const rows = a.getByTestId("device-row");
  await expect(rows).toHaveCount(3); // Android + two browsers

  // Sign out the other browser (a web row that isn't this one).
  const other = rows.filter({ hasText: "Web" }).filter({ hasNotText: "This browser" });
  await other.getByRole("button", { name: "Sign out" }).click();
  await expect(rows).toHaveCount(2);

  // B learns about it over the realtime channel, without reloading.
  await expect(b).toHaveURL("/sign-in", { timeout: 10_000 });
  await expect(b.getByRole("status")).toContainText("signed out");

  // A is unaffected.
  await a.reload();
  await expect(a.getByText("Device Tester").first()).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
