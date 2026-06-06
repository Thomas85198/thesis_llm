"use client";
// Outline generator side panel. Two ways to build a heading tree:
//   1. IMRaD — a fixed standard thesis structure, inserted instantly (no model).
//   2. Smart Headings — type a topic, AI generates a tailored heading tree.
// Either way the headings are inserted as heading nodes at the cursor.
import type { Editor } from "@tiptap/core";
import { Loader2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ChatRateLimitError, generateOutline, type OutlineHeading } from "@/lib/api";
import { useEditorStore } from "@/lib/editor-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Fixed IMRaD thesis skeleton (all level-1 sections); labels come from i18n.
const IMRAD_KEYS = [
  "intro",
  "litReview",
  "methods",
  "results",
  "discussion",
  "conclusion",
] as const;

/** Insert headings (each followed by an empty paragraph) at the cursor. */
function insertHeadings(editor: Editor, headings: OutlineHeading[]) {
  const content = headings.flatMap((h) => [
    { type: "heading", attrs: { level: h.level }, content: [{ type: "text", text: h.text }] },
    { type: "paragraph" },
  ]);
  editor.chain().focus().insertContent(content).run();
}

export function OutlinePanel({ editor, docId }: { editor: Editor; docId: string }) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.outlineOpen);
  const nonce = useEditorStore((s) => s.outlineNonce);
  const closeOutline = useEditorStore((s) => s.closeOutline);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeOutline()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("outline.panelTitle")}</SheetTitle>
          <SheetDescription>{t("outline.panelDesc")}</SheetDescription>
        </SheetHeader>
        {open && <OutlinePanelBody key={nonce} editor={editor} docId={docId} />}
      </SheetContent>
    </Sheet>
  );
}

function OutlinePanelBody({ editor, docId }: { editor: Editor; docId: string }) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const closeOutline = useEditorStore((s) => s.closeOutline);

  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  function applyImrad() {
    insertHeadings(
      editor,
      IMRAD_KEYS.map((k) => ({ level: 1, text: t(`outline.imrad.${k}`) }))
    );
    toast.success(t("outline.inserted"));
    closeOutline();
  }

  async function generate() {
    const q = topic.trim();
    if (!q) return;
    setLoading(true);
    setHeadings([]);
    try {
      setHeadings(await generateOutline(docId, q, locale));
    } catch (e) {
      if (e instanceof ChatRateLimitError)
        toast.error(t("outline.rateLimited", { seconds: e.retryAfter }));
      else toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }

  function applyGenerated() {
    if (headings.length === 0) return;
    insertHeadings(editor, headings);
    toast.success(t("outline.inserted"));
    closeOutline();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
      {/* IMRaD standard structure */}
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("outline.imradTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("outline.imradDesc")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={applyImrad}>
          {t("outline.insert")}
        </Button>
      </div>

      {/* Smart Headings from a topic */}
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1 text-sm font-medium">{t("outline.smartTitle")}</p>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t("outline.topicPlaceholder")}
            disabled={loading}
          />
          <Button
            type="submit"
            size="icon"
            variant="secondary"
            className="shrink-0"
            disabled={loading || !topic.trim()}
            aria-label={t("outline.generate")}
            title={t("outline.generate")}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </form>

        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-card p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("outline.working")}
            </div>
          ) : headings.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {headings.map((h, i) => (
                <li
                  key={i}
                  className={h.level === 1 ? "font-medium" : "text-muted-foreground"}
                  style={{ paddingLeft: `${(h.level - 1) * 14}px` }}
                >
                  {h.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("outline.prompt")}</p>
          )}
        </ScrollArea>

        {headings.length > 0 && !loading && (
          <div className="mt-3 flex justify-end">
            <Button type="button" size="sm" onClick={applyGenerated}>
              {t("outline.insertGenerated")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
