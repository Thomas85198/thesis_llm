"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { useJobTracker } from "@/components/job-tracker";

// Drop-in replacement for next/link that confirms before navigating away while
// an analysis is in progress, so a stray click doesn't close the progress view.
export function GuardedLink({
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const { isProcessing } = useJobTracker();
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (
          isProcessing &&
          !window.confirm(
            "分析進行中，離開會關閉這個進度畫面（分析仍會在背景完成，可從通知或「歷史」頁回來）。確定離開？"
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
