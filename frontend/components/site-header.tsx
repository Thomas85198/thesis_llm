import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="text-base sm:text-lg">論文檢核系統</span>
          <Badge variant="secondary" className="font-mono text-[10px]">
            v3
          </Badge>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            上傳
          </Link>
          <Link
            href="/papers"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            歷史
          </Link>
          <Link
            href="/stats"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            規則統計
          </Link>
          <Link
            href="/about"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            系統說明
          </Link>
        </nav>
      </div>
    </header>
  );
}
