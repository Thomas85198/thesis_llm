"use client";
// Export side panel. Downloads the live document as .docx or .tex via the
// backend, using the current citation style. The content is taken from the
// editor at click time (editor.getJSON), so the file always reflects the latest
// edits — no dependency on the autosave debounce.
import type { Editor } from "@tiptap/core";
import { FileText, FileType2, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { exportDocument, type ExportFormat, type ProseMirrorDoc } from "@/lib/api";
import { useEditorStore } from "@/lib/editor-store";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const EXT: Record<ExportFormat, string> = { docx: "docx", latex: "tex" };

export function ExportPanel({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const open = useEditorStore((s) => s.exportOpen);
  const closeExport = useEditorStore((s) => s.closeExport);
  const title = useEditorStore((s) => s.title);
  const citationStyle = useEditorStore((s) => s.citationStyle);

  const [busy, setBusy] = useState<ExportFormat | null>(null);

  async function handleExport(format: ExportFormat) {
    setBusy(format);
    try {
      const blob = await exportDocument({
        title,
        content_json: editor.getJSON() as ProseMirrorDoc,
        style: citationStyle,
        locale,
        format,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "document").trim() || "document"}.${EXT[format]}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t("export.done"));
      closeExport();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeExport()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("export.panelTitle")}</SheetTitle>
          <SheetDescription>
            {t("export.panelDesc", {
              style: citationStyle === "apa" ? t("citation.styleApa") : t("citation.styleNumeric"),
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-3 py-3"
            disabled={busy !== null}
            onClick={() => handleExport("docx")}
          >
            {busy === "docx" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
            <span className="flex flex-col items-start">
              <span className="text-sm font-medium">{t("export.docx")}</span>
              <span className="text-xs text-muted-foreground">{t("export.docxDesc")}</span>
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start gap-3 py-3"
            disabled={busy !== null}
            onClick={() => handleExport("latex")}
          >
            {busy === "latex" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <FileType2 className="h-5 w-5" />
            )}
            <span className="flex flex-col items-start">
              <span className="text-sm font-medium">{t("export.latex")}</span>
              <span className="text-xs text-muted-foreground">{t("export.latexDesc")}</span>
            </span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
