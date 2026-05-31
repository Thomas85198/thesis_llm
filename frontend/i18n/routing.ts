import { defineRouting } from "next-intl/routing";

// Single source of truth for supported locales. Adding a new language is a
// data-only change: append it here, drop a messages/<locale>.json file, and
// add a label below — no schema or logic changes anywhere else.
export const LOCALES = ["zh-Hant", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-Hant";

// Each locale's name shown in its own language (endonym), used by the switcher.
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-Hant": "繁體中文",
  en: "English",
};

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Always show the locale prefix in the URL (/zh-Hant/..., /en/...).
  localePrefix: "always",
});
