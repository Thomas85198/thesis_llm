"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { useJobTracker } from "@/components/job-tracker";

// Drop-in replacement for next/link that confirms before navigating away while
// an analysis is in progress — but only from the upload page ("/"), which is
// the only place that shows the live progress view. Once the user is already on
// another page the global pill carries the state, so navigating there is safe
// and needs no confirmation.
export function GuardedLink({
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const { isProcessing } = useJobTracker();
  const pathname = usePathname();
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (
          isProcessing &&
          pathname === "/" &&
          !window.confirm(
            "分析進行中，離開會關閉這個進度畫面（分析仍會在背景完成，可從上方「分析中」狀態回來）。確定離開？"
          )
        ) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
