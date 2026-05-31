import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Run on every path except API routes, Next internals, the /version health
  // endpoint (polled by version-watcher, must stay un-prefixed), and any file
  // with an extension (static assets).
  matcher: "/((?!api|_next|_vercel|version|.*\\..*).*)",
};
