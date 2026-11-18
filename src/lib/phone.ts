import {
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";

export interface CountryOption {
  code: CountryCode;
  name: string;
  dialCode: string;
}

const FALLBACK_COUNTRY: CountryCode = "TZ";

/** All countries, named in the browser's language, sorted by name. */
export function listCountries(locale = "en"): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    names = null;
  }
  return getCountries()
    .map((code) => ({
      code,
      name: names?.of(code) ?? code,
      dialCode: `+${getCountryCallingCode(code)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Country from a BCP 47 tag such as `sw-TZ`, if it is one libphonenumber knows. */
export function countryFromLocale(locale: string | undefined): CountryCode {
  const region = locale?.split("-")[1]?.toUpperCase();
  return region && (getCountries() as string[]).includes(region)
    ? (region as CountryCode)
    : FALLBACK_COUNTRY;
}

export type PhoneCheck =
  | { ok: true; e164: string }
  | { ok: false; reason: "empty" | "invalid" };

/**
 * Validates a number typed in the national format (or with a leading +) for a country and
 * returns it in E.164, as the API expects.
 */
export function toE164(input: string, country: CountryCode): PhoneCheck {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
  return { ok: true, e164: parsed.number };
}

/** Human-friendly international format, e.g. `+255 712 345 678`. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
