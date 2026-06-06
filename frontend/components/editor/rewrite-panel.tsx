"use client";
// AI rewrite side panel. Opened from the selection BubbleMenu「AI 改寫」: it
// captures the highlighted passage + its doc range, streams a rewrite for the
// chosen preset (or a custom instruction), and on Accept replaces exactly the
// original range. The body is keyed on a store nonce so each open starts fresh.
import type { Editor } from "@tiptap/core";
import { Check, Loader2, RotateCw, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatRateLimitError, streamRewrite } from "@/lib/api";
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

// Preset keys must match backend rewrite.PRESETS.
const PRESETS = [
  "paraphrase",
  "simplify",
  "expand",
  "shorten",
  "improve_fluency",
  "academic",
  "fix_grammar",
] as const;

/** Shell: the Sheet + header. Body remounts (keyed on nonce) on every open. */
export function RewritePanel({ editor, docId }: { editor: Editor; docId: string }) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.rewriteOpen);
  const nonce = useEditorStore((s) => s.rewriteNonce);
  const closeRewrite = useEditorStore((s) => s.closeRewrite);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeRewrite()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("rewrite.panelTitle")}</SheetTitle>
          <SheetDescription>{t("rewrite.panelDesc")}</SheetDescription>
        </SheetHeader>
        {open && <RewritePanelBody key={nonce} editor={editor} docId={docId} />}
      </SheetContent>
    </Sheet>
  );
}

function RewritePanelBody({ editor, docId }: { editor: Editor; docId: string }) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const original = useEditorStore((s) => s.rewriteText);
  const closeRewrite = useEditorStore((s) => s.closeRewrite);

  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastInstruction, setLastInstruction] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    (instruction: string) => {
      const instr = instruction.trim();
      if (!instr) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLastInstruction(instr);
      setResult("");
      setLoading(true);
      void streamRewrite(
        { doc_id: docId, text: original, instruction: instr, locale },
        (delta) => {
          if (!controller.signal.aborted) setResult((r) => r + delta);
        },
        controller.signal
      )
        .catch((e) => {
          if (controller.signal.aborted) return;
          if (e instanceof ChatRateLimitError)
            toast.error(t("rewrite.rateLimited", { seconds: e.retryAfter }));
          else toast.error(String(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [docId, original, locale, t]
  );

  function handleAccept() {
    const range = useEditorStore.getState().rewriteRange;
    const text = result.trim();
    if (!range || !text) return;
    editor.chain().focus().insertContentAt(range, text).run();
    toast.success(t("rewrite.applied"));
    closeRewrite();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      {/* Original passage */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {t("rewrite.originalLabel")}
        </p>
        <ScrollArea className="max-h-24 rounded-md border bg-muted/40 p-2">
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{original}</p>
        </ScrollArea>
      </div>

      {/* Preset instructions */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((key) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={loading}
            onClick={() => run(key)}
          >
            {t(`rewrite.preset.${key}`)}
          </Button>
        ))}
      </div>

      {/* Custom instruction */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(custom);
        }}
      >
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t("rewrite.customPlaceholder")}
          disabled={loading}
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          className="shrink-0"
          disabled={loading || !custom.trim()}
          aria-label={t("rewrite.send")}
          title={t("rewrite.send")}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </form>

      {/* Result */}
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {t("rewrite.resultLabel")}
        </p>
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-card p-3">
          {loading && !result ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("rewrite.working")}
            </div>
          ) : result ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("rewrite.prompt")}</p>
          )}
        </ScrollArea>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={closeRewrite}
        >
          <X className="mr-1 h-4 w-4" />
          {t("rewrite.discard")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || !lastInstruction}
          onClick={() => lastInstruction && run(lastInstruction)}
        >
          <RotateCw className="mr-1 h-4 w-4" />
          {t("rewrite.retry")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={loading || !result.trim()}
          onClick={handleAccept}
        >
          <Check className="mr-1 h-4 w-4" />
          {t("rewrite.accept")}
        </Button>
      </div>
    </div>
  );
}
