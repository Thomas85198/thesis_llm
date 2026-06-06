"use client";
// Export side panel. Downloads the live document (DOCX / LaTeX / Markdown /
// plain text) or opens an academic-styled HTML preview — which doubles as the
// PDF path via the browser's print-to-PDF (best CJK fidelity, no server deps).
// Content is taken from editor.getJSON() at click time, so it always reflects
// the latest edits regardless of the autosave debounce.
import type { Editor } from "@tiptap/core";
import {
  Eye,
  FileCode,
  FileText,
  FileType,
  FileType2,
  Loader2,
  Printer,
} from "lucide-react";
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

const EXT: Record<ExportFormat, string> = {
  docx: "docx",
  latex: "tex",
  md: "md",
  txt: "txt",
  html: "html",
};

type Icon = React.ComponentType<{ className?: string }>;

function ExportItem({
  icon: I,
  label,
  desc,
  busyKey,
  busy,
  onClick,
}: {
  icon: Icon;
  label: string;
  desc: string;
  busyKey: string;
  busy: string | null;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto justify-start gap-3 py-3"
      disabled={busy !== null}
      onClick={onClick}
    >
      {busy === busyKey ? <Loader2 className="h-5 w-5 animate-spin" /> : <I className="h-5 w-5" />}
      <span className="flex flex-col items-start">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </Button>
  );
}

export function ExportPanel({ editor }: { editor: Editor }) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const open = useEditorStore((s) => s.exportOpen);
  const closeExport = useEditorStore((s) => s.closeExport);
  const title = useEditorStore((s) => s.title);
  const citationStyle = useEditorStore((s) => s.citationStyle);

  const [busy, setBusy] = useState<string | null>(null);
  const [template, setTemplate] = useState("article");

  const docBody = () => ({
    title,
    content_json: editor.getJSON() as ProseMirrorDoc,
    style: citationStyle,
    locale,
    template,
  });

  async function handleDownload(format: ExportFormat) {
    setBusy(format);
    try {
      const { blob, filename } = await exportDocument({ ...docBody(), format });
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

  // Open an academic-styled HTML render in a new tab. With `print`, trigger the
  // browser print dialog (→ Save as PDF) once content has settled.
  async function handlePreview(print: boolean) {
    setBusy(print ? "pdf" : "preview");
    const win = window.open("", "_blank"); // sync open dodges popup blockers
    try {
      const { blob } = await exportDocument({ ...docBody(), format: "html" });
      const html = await blob.text();
      if (!win) {
        toast.error(t("export.popupBlocked"));
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      if (print) setTimeout(() => { try { win.focus(); win.print(); } catch {} }, 1000);
      closeExport();
    } catch (e) {
      win?.close();
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  const item = (icon: Icon, key: string, busyKey: string, onClick: () => void) => (
    <ExportItem
      icon={icon}
      label={t(`export.${key}`)}
      desc={t(`export.${key}Desc`)}
      busyKey={busyKey}
      busy={busy}
      onClick={onClick}
    />
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeExport()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("export.panelTitle")}</SheetTitle>
          <SheetDescription>
            {t("export.panelDesc", { style: CITATION_STYLE_LABEL[citationStyle] })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          {item(Eye, "preview", "preview", () => handlePreview(false))}
          {item(Printer, "pdf", "pdf", () => handlePreview(true))}

          <div className="my-1 border-t" />

          {item(FileText, "docx", "docx", () => handleDownload("docx"))}
          {item(FileCode, "md", "md", () => handleDownload("md"))}
          {item(FileType, "txt", "txt", () => handleDownload("txt"))}

          <label className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
          {item(FileType2, "latex", "latex", () => handleDownload("latex"))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
