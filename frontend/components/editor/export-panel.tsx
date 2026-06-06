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
import { CITATION_STYLE_LABEL } from "@/lib/citation-format";
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
  const [template, setTemplate] = useState("article");

  async function handleExport(format: ExportFormat) {
    setBusy(format);
    try {
      const { blob, filename } = await exportDocument({
        title,
        content_json: editor.getJSON() as ProseMirrorDoc,
        style: citationStyle,
        locale,
        format,
        template,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        filename || `${(title || "document").trim() || "document"}.${EXT[format]}`;
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
            {t("export.panelDesc", { style: CITATION_STYLE_LABEL[citationStyle] })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-4">
          <label className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("export.template")}</span>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="article">{t("export.tplArticle")}</option>
              <option value="twocolumn">{t("export.tplTwoColumn")}</option>
              <option value="ieee">{t("export.tplIeee")}</option>
            </select>
          </label>
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
