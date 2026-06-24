"use client";
// Export side panel. The document layout (article / twocolumn / IEEE / Taiwan
// thesis) is picked at the top and applies to every renderer that can honor it
// (typeset PDF + LaTeX); md/txt are layout-free by nature. Content is taken
// from editor.getJSON() at click time, so it always reflects the latest edits
// regardless of the autosave debounce.
import type { Editor } from "@tiptap/core";
import {
  Eye,
  FileCode,
  FileDown,
  FileText,
  FileType,
  FileType2,
  Loader2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  exportDocument,
  type ExportFormat,
  type ProseMirrorDoc,
} from "@/lib/api";
import {
  CITATION_STYLE_LABEL,
  type CitationStyle,
} from "@/lib/citation-format";
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
  pdf: "pdf",
  md: "md",
  txt: "txt",
  html: "html",
};

// Mirrors the backend's CJK detection: CJK content → ctex + Noto Serif CJK TC
// in the exported .tex, which requires XeLaTeX.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿]/;

const TEMPLATES = ["twthesis", "article", "twocolumn", "ieee"] as const;

const templateStorageKey = (docId: string) => `editor:template:${docId}`;
const coverStorageKey = (docId: string) => `editor:cover:${docId}`;

// Taiwan-thesis cover fields, paired zh/en. Placeholders are illustrative
// (modeled on a real CGU master thesis) — empty fields are skipped server-side.
const COVER_ROWS: {
  key: string;
  zh: string;
  en: string;
  phZh: string;
  phEn: string;
}[] = [
  {
    key: "university",
    zh: "universityZh",
    en: "universityEn",
    phZh: "長庚大學",
    phEn: "Chang Gung University",
  },
  {
    key: "department",
    zh: "departmentZh",
    en: "departmentEn",
    phZh: "資訊管理學系",
    phEn: "Department of Information Management",
  },
  {
    key: "degree",
    zh: "degreeZh",
    en: "degreeEn",
    phZh: "碩士論文",
    phEn: "Master Thesis",
  },
  {
    key: "title",
    zh: "titleZh",
    en: "titleEn",
    phZh: "中文論文題目",
    phEn: "English Title",
  },
  {
    key: "advisor",
    zh: "advisorZh",
    en: "advisorEn",
    phZh: "張禾坤 博士",
    phEn: "Her-Kun Chang, Ph.D.",
  },
  {
    key: "student",
    zh: "studentZh",
    en: "studentEn",
    phZh: "盧建霖",
    phEn: "Chien-Lin Lu",
  },
  {
    key: "date",
    zh: "dateZh",
    en: "dateEn",
    phZh: "中華民國 108 年 1 月",
    phEn: "January 2019",
  },
];

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
      // Button defaults to whitespace-nowrap, which made long descriptions
      // overflow horizontally — allow wrapping and a min-w-0 text column.
      className="h-auto w-full justify-start gap-3 whitespace-normal py-3 text-left"
      disabled={busy !== null}
      onClick={onClick}
    >
      {busy === busyKey ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
      ) : (
        <I className="h-5 w-5 shrink-0" />
      )}
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="text-sm font-medium">{label}</span>
        <span className="break-words text-xs text-muted-foreground">
          {desc}
        </span>
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
  const docId = useEditorStore((s) => s.docId);
  const citationStyle = useEditorStore((s) => s.citationStyle);
  const setCitationStyle = useEditorStore((s) => s.setCitationStyle);

  const [busy, setBusy] = useState<string | null>(null);
  // The layout is a property of the document, not of one export — remember it
  // per document so reopening the panel keeps the author's choice.
  const [template, setTemplate] = useState<string>(() => {
    // Default to the Taiwan-thesis layout — this is a thesis-writing tool, so the
    // thesis format (cover + 第N章 + numbered sections) is the expected default,
    // not a bare article. Remembered per-doc once the author picks one.
    if (typeof window === "undefined" || !docId) return "twthesis";
    const saved = window.localStorage.getItem(templateStorageKey(docId));
    return saved && (TEMPLATES as readonly string[]).includes(saved)
      ? saved
      : "twthesis";
  });
  // CJK docs get ctex + Noto Serif CJK TC and need XeLaTeX — surface that in
  // the panel so 繁中 users know the font is handled and which compiler to use.
  const hasCjk = open && CJK_RE.test(title + editor.getText());

  // Taiwan-thesis bilingual cover. Persisted per document (a thesis cover is
  // stable across exports), prefilled with the doc title as the Chinese title.
  const [coverOn, setCoverOn] = useState(false);
  const [cover, setCover] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!docId || typeof window === "undefined") return;
    let saved: { on?: boolean; fields?: Record<string, string> } = {};
    try {
      saved = JSON.parse(
        window.localStorage.getItem(coverStorageKey(docId)) || "{}",
      );
    } catch {
      saved = {};
    }
    const fields = saved.fields || {};
    if (!fields.titleZh && title) fields.titleZh = title;
    setCover(fields);
    setCoverOn(!!saved.on);
  }, [docId, title]);

  function persistCover(on: boolean, fields: Record<string, string>) {
    if (!docId || typeof window === "undefined") return;
    window.localStorage.setItem(
      coverStorageKey(docId),
      JSON.stringify({ on, fields }),
    );
  }
  function setCoverField(k: string, v: string) {
    const next = { ...cover, [k]: v };
    setCover(next);
    persistCover(coverOn, next);
  }
  function toggleCover(on: boolean) {
    setCoverOn(on);
    persistCover(on, cover);
  }

  function changeTemplate(value: string) {
    setTemplate(value);
    if (docId && typeof window !== "undefined") {
      window.localStorage.setItem(templateStorageKey(docId), value);
    }
    // IEEE venues expect bracketed numeric citations — pairing the IEEE layout
    // with APA in-text markers is a classic submission mistake.
    if (
      value === "ieee" &&
      citationStyle !== "ieee" &&
      citationStyle !== "numeric"
    ) {
      toast.info(t("export.ieeeStyleHint"), {
        action: {
          label: t("export.ieeeStyleSwitch"),
          onClick: () => setCitationStyle("ieee" as CitationStyle),
        },
        duration: 8000,
      });
    }
  }

  const docBody = () => ({
    title,
    content_json: editor.getJSON() as ProseMirrorDoc,
    style: citationStyle,
    locale,
    template,
    // Only the Taiwan-thesis layout has a cover; send it only when opted in.
    cover: template === "twthesis" && coverOn ? cover : undefined,
  });

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Compile server-side and show the typeset PDF in a new tab (browser PDF
  // viewer, downloadable from there). Previewing instead of silently saving a
  // file lets the author SEE the real layout — and catch it if it breaks.
  async function handlePdfTypeset() {
    setBusy("pdftex");
    const win = window.open("", "_blank"); // sync open dodges popup blockers
    try {
      const { blob } = await exportDocument({ ...docBody(), format: "pdf" });
      if (!win) {
        toast.error(t("export.popupBlocked"));
        return;
      }
      win.location.href = URL.createObjectURL(blob);
      closeExport();
    } catch (e) {
      win?.close();
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(format: ExportFormat) {
    setBusy(format);
    try {
      const { blob, filename } = await exportDocument({ ...docBody(), format });
      triggerDownload(
        blob,
        filename ||
          `${(title || "document").trim() || "document"}.${EXT[format]}`,
      );
      toast.success(t("export.done"));
      closeExport();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  // Open an academic-styled HTML render in a new tab (math rendered).
  async function handlePreview() {
    setBusy("preview");
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
      closeExport();
    } catch (e) {
      win?.close();
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  const item = (
    icon: Icon,
    key: string,
    busyKey: string,
    onClick: () => void,
  ) => (
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
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{t("export.panelTitle")}</SheetTitle>
          <SheetDescription>
            {t("export.panelDesc", {
              style: CITATION_STYLE_LABEL[citationStyle],
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("export.template")}</span>
            <select
              value={template}
              onChange={(e) => changeTemplate(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="twthesis">{t("export.tplTwthesis")}</option>
              <option value="article">{t("export.tplArticle")}</option>
              <option value="twocolumn">{t("export.tplTwoColumn")}</option>
              <option value="ieee">{t("export.tplIeee")}</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            {t("export.templateDesc")}
          </p>
          {hasCjk && (
            <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {t("export.cjkHint")}
            </p>
          )}

          {template === "twthesis" && (
            <div className="rounded-md border">
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={coverOn}
                  onChange={(e) => toggleCover(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{t("export.cover.toggle")}</span>
              </label>
              {coverOn && (
                <div className="flex flex-col gap-2 border-t px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    {t("export.cover.hint")}
                  </p>
                  {COVER_ROWS.map((row) => (
                    <div key={row.key} className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">
                        {t(`export.cover.${row.key}`)}
                      </span>
                      <input
                        value={cover[row.zh] || ""}
                        onChange={(e) => setCoverField(row.zh, e.target.value)}
                        placeholder={row.phZh}
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                      />
                      <input
                        value={cover[row.en] || ""}
                        onChange={(e) => setCoverField(row.en, e.target.value)}
                        placeholder={row.phEn}
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="my-1 border-t" />

          {item(Eye, "preview", "preview", () => handlePreview())}
          <ExportItem
            icon={FileDown}
            label={t("export.pdfTex")}
            desc={t("export.pdfTexDesc")}
            busyKey="pdftex"
            busy={busy}
            onClick={() => handlePdfTypeset()}
          />

          <div className="my-1 border-t" />

          {item(FileText, "docx", "docx", () => handleDownload("docx"))}
          {item(FileType2, "latex", "latex", () => handleDownload("latex"))}
          {item(FileCode, "md", "md", () => handleDownload("md"))}
          {item(FileType, "txt", "txt", () => handleDownload("txt"))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
