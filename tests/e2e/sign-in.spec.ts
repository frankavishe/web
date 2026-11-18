import { expect, test } from "@playwright/test";
import { createAccount, lastOtp, randomPhone, signInOnWeb } from "./helpers";

// Each spec waits out the API's 60 s resend cooldown at least once.
test.describe.configure({ timeout: 180_000 });

test("an Android account signs in on the web and stays signed in after a reload", async ({ page, request }) => {
  const phone = randomPhone();
  await createAccount(request, phone.e164, "Web Tester");

  await signInOnWeb(page, request, phone);

  await expect(page).toHaveURL("/");
  await expect(page.getByText("Web Tester")).toBeVisible();
  await expect(page.getByText("No chats yet")).toBeVisible();

  // The access token lives in memory only; the HttpOnly refresh cookie restores the session.
  await page.reload();
  await expect(page.getByText("Web Tester")).toBeVisible();

  await page.getByRole("link", { name: "Linked devices" }).click();
  await expect(page.getByTestId("device-row")).toHaveCount(2);
  await expect(page.getByText("This browser")).toBeVisible();
});

test("a number without an account is told to use the Android app first", async ({ page, request }) => {
  const phone = randomPhone();
  await page.goto("/sign-in");
  await page.getByLabel("Country").selectOption("TZ");
  await page.getByLabel("Phone number").fill(phone.national);
  await page.getByRole("button", { name: "Send code" }).click();

  await page.getByLabel("Verification code").fill(await lastOtp(request, phone.e164));

  await expect(page.getByRole("alert")).toContainText("Android app first");
  await expect(page).toHaveURL("/sign-in");
});

test("a wrong code shows an error", async ({ page, request }) => {
  const phone = randomPhone();
  await page.goto("/sign-in");
  await page.getByLabel("Country").selectOption("TZ");
  await page.getByLabel("Phone number").fill(phone.national);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = await lastOtp(request, phone.e164);
  const wrong = code === "000000" ? "111111" : "000000";

  await page.getByLabel("Verification code").fill(wrong);

  await expect(page.getByRole("alert")).toContainText("isn't right");
});

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/settings/devices");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
