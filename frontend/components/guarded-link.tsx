"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { useJobTracker } from "@/components/job-tracker";

// Drop-in replacement for the locale-aware Link that confirms before navigating
// away while an analysis is in progress — but only from the upload page ("/"),
// which is the only place that shows the live progress view. Once the user is
// already on another page the global pill carries the state, so navigating
// there is safe and needs no confirmation. usePathname() from next-intl returns
// the locale-stripped path, so the "/" check holds in every locale.
export function GuardedLink({
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const { isProcessing } = useJobTracker();
  const pathname = usePathname();
  const t = useTranslations("guard");
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (isProcessing && pathname === "/" && !window.confirm(t("leaveConfirm"))) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
