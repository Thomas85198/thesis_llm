"""Backend-side locale config + helpers for multilingual LLM content.

Single source of truth for which languages the analysis produces. Adding a
language is a data-only change: append the locale here and add its prompt
language name to LANG_NAME — the translation pass and chat then cover it
automatically (older papers are not back-filled).

Locale codes mirror the frontend (i18n/routing.ts): "zh-Hant", "en", ...
PRIMARY_LOCALE is the language the checker/cross-section prompts generate in;
every other supported locale is filled by the translation pass.
"""
from __future__ import annotations

from typing import Any

SUPPORTED_LOCALES: list[str] = ["zh-Hant", "en"]
PRIMARY_LOCALE: str = "zh-Hant"

# Human-readable language name injected into prompts ("Write ... in {language}").
LANG_NAME: dict[str, str] = {
    "zh-Hant": "繁體中文",
    "en": "English",
}


def normalize_locale(locale: str | None) -> str:
    """Map an arbitrary request locale to a supported one (fallback: PRIMARY)."""
    if locale in SUPPORTED_LOCALES:
        return locale  # type: ignore[return-value]
    return PRIMARY_LOCALE


def pick(value: Any, locale: str) -> str:
    """Read a localized value for `locale`.

    Accepts either a {locale: text} map or a plain string (tolerates legacy /
    not-yet-translated data). Falls back to PRIMARY_LOCALE, then any value.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return (
            value.get(locale)
            or value.get(PRIMARY_LOCALE)
            or next((v for v in value.values() if v), "")
        )
    return ""
