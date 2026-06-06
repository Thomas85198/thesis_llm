import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

// Core UI strings live in messages/<locale>.json; each large page keeps its own
// namespace file under messages/pages/<page>.<locale>.json so they can be
// edited (and translated) independently without colliding. They are merged into
// a single message tree here, mounted under their namespace key.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const [core, stats, about, changelog, kgflow, editor] = await Promise.all([
    import(`../messages/${locale}.json`),
    import(`../messages/pages/stats.${locale}.json`),
    import(`../messages/pages/about.${locale}.json`),
    import(`../messages/pages/changelog.${locale}.json`),
    import(`../messages/pages/kgflow.${locale}.json`),
    import(`../messages/pages/editor.${locale}.json`),
  ]);

  return {
    locale,
    messages: {
      ...core.default,
      stats: stats.default,
      about: about.default,
      changelog: changelog.default,
      kgFlow: kgflow.default,
      editor: editor.default,
    },
  };
});
