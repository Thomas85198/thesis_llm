import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/version-log";

// Runs on the Next.js server, so after a redeploy it returns the *newly
// deployed* version. An already-open browser tab (holding an older JS bundle)
// fetches this and compares against its baked-in CURRENT_VERSION to detect
// that a new release is live — see components/version-watcher.tsx.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: CURRENT_VERSION },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
