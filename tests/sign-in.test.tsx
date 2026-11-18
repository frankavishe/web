import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { countryFromLocale, toE164 } from "@/lib/phone";
import { deviceNameFromUserAgent } from "@/lib/device-name";
import { useAuthStore } from "@/stores/auth";

const post = vi.fn();

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: { POST: (...args: unknown[]) => post(...args) },
    // Same contract as the real helper: resolve data, or throw what the request threw.
    call: async (fn: () => Promise<unknown>) => fn(),
  };
});

const { SignInForm } = await import("@/components/auth/SignInForm");

describe("phone validation", () => {
  it("normalises a national number to E.164", () => {
    expect(toE164("0712 345 678", "TZ")).toEqual({ ok: true, e164: "+255712345678" });
    expect(toE164("712345678", "TZ")).toEqual({ ok: true, e164: "+255712345678" });
  });

  it("accepts a number typed with its country code", () => {
    expect(toE164("+44 7400 123456", "TZ")).toEqual({ ok: true, e164: "+447400123456" });
  });

  it("rejects empty and invalid numbers", () => {
    expect(toE164("  ", "TZ")).toEqual({ ok: false, reason: "empty" });
    expect(toE164("12", "TZ")).toEqual({ ok: false, reason: "invalid" });
    expect(toE164("0000000000", "TZ")).toEqual({ ok: false, reason: "invalid" });
  });

  it("picks the country from the browser language", () => {
    expect(countryFromLocale("en-GB")).toBe("GB");
    expect(countryFromLocale("sw-tz")).toBe("TZ");
    expect(countryFromLocale("en")).toBe("TZ");
    expect(countryFromLocale(undefined)).toBe("TZ");
  });
});

describe("device name", () => {
  it("describes common browsers", () => {
    expect(
      deviceNameFromUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
    expect(
      deviceNameFromUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");
    expect(deviceNameFromUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe(
      "Firefox on Linux",
    );
  });
});

describe("SignInForm", () => {
  const user = {
    id: "0192f8a0-0000-7000-8000-000000000002",
    phone: "+255712345678",
    displayName: "Frank",
    about: "Hi",
    avatarUrl: null,
    profileComplete: true,
  };

  beforeEach(() => {
    post.mockReset();
    useAuthStore.getState().clear(null);
  });

  async function enterPhone(number = "0712345678") {
    const ue = userEvent.setup();
    await ue.selectOptions(screen.getByLabelText("Country"), "TZ");
    await ue.type(screen.getByLabelText("Phone number"), number);
    await ue.click(screen.getByRole("button", { name: "Send code" }));
    return ue;
  }

  it("shows an error and makes no request for an invalid number", async () => {
    render(<SignInForm onSignedIn={vi.fn()} />);
    await enterPhone("123");
    expect(screen.getByRole("alert")).toHaveTextContent("valid number");
    expect(post).not.toHaveBeenCalled();
  });

  it("requests a code, then verifies as a web device and stores the session", async () => {
    post.mockImplementation((path: string) =>
      path === "/auth/request-code"
        ? { expiresIn: 300, resendAfter: 60 }
        : {
            accessToken: "header.eyJkaWQiOiJkZXYtMSJ9.sig",
            expiresIn: 900,
            isNewAccount: false,
            device: { id: "dev-1", type: "web", name: "Chrome", createdAt: "", lastActiveAt: "", current: true },
            user,
          },
    );
    const onSignedIn = vi.fn();
    render(<SignInForm onSignedIn={onSignedIn} />);

    const ue = await enterPhone();
    expect(post).toHaveBeenCalledWith("/auth/request-code", { body: { phone: "+255712345678" } });

    expect(await screen.findByText(/Resend code in 60s/)).toBeInTheDocument();
    await ue.type(screen.getByLabelText("Verification code"), "123456");

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    const verifyBody = post.mock.calls[1][1].body;
    expect(verifyBody).toMatchObject({ phone: "+255712345678", code: "123456", deviceType: "web" });
    expect(verifyBody.deviceName.length).toBeGreaterThan(0);
    expect(useAuthStore.getState()).toMatchObject({ status: "signedIn", deviceId: "dev-1", user });
  });

  it.each([
    ["INVALID_CODE", 401, "isn't right"],
    ["CODE_EXPIRED", 401, "expired"],
    ["TOO_MANY_ATTEMPTS", 401, "Too many attempts"],
    ["ACCOUNT_NOT_FOUND", 404, "Android app first"],
  ] as const)("explains %s", async (code, status, text) => {
    post.mockImplementation((path: string) => {
      if (path === "/auth/request-code") return { expiresIn: 300, resendAfter: 60 };
      throw new ApiError(status, code, code);
    });
    render(<SignInForm onSignedIn={vi.fn()} />);
    const ue = await enterPhone();
    await ue.type(await screen.findByLabelText("Verification code"), "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(useAuthStore.getState().status).toBe("signedOut");
  });

  it("shows how long to wait when rate limited", async () => {
    post.mockImplementation(() => {
      throw new ApiError(429, "RATE_LIMITED", "slow down", 120);
    });
    render(<SignInForm onSignedIn={vi.fn()} />);
    await enterPhone();
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 2 minutes");
  });
});
