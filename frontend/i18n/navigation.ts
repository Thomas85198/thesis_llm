import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

// Locale-aware drop-in replacements for next/link and next/navigation. Hrefs
// stay locale-agnostic (e.g. "/papers") — these automatically prepend the
// active locale prefix and strip it back off in usePathname().
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
