"use client";
// Version history side panel. Lists snapshots (throttled autosaves + named
// manual versions + restore-backups), previews their text, and restores one —
// the restore endpoint first backs up the current content so a restore is itself
// undoable. Pairs with the autosave snapshots wired in lib/editor-store.ts.
import type { Editor } from "@tiptap/core";
import { History, Loader2, RotateCcw, Save } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
  snapshotDocument,
  type DocumentVersion,
  type ProseMirrorDoc,
} from "@/lib/api";
import { useEditorStore } from "@/lib/editor-store";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Flatten a ProseMirror doc to plain text for a preview excerpt. */
function pmText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  const inner = (n.content ?? []).map(pmText).join("");
  // Block separators so headings/paragraphs don't run together.
  return /heading|paragraph|listItem/.test(n.type ?? "") ? inner + "\n" : inner;
}

function relTime(iso: string, locale: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (min < 1) return rtf.format(0, "second"); // "now" / 「現在」
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  return new Date(iso).toLocaleString(locale);
}

export function VersionHistoryPanel({
  editor,
  docId,
}: {
  editor: Editor;
  docId: string;
}) {
  const t = useTranslations("editor");
  const locale = useLocale();
  const open = useEditorStore((s) => s.versionsOpen);
  const close = useEditorStore((s) => s.closeVersions);

  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | "save" | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{ id: number; text: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVersions(await listDocumentVersions(docId));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    if (open) {
      setPreview(null);
      void refresh();
    }
  }, [open, refresh]);

  // Human label for the three system labels; custom names show as-is.
  function labelText(label: string): string {
    if (label === "autosave") return t("versions.labelAutosave");
    if (label === "restore-backup") return t("versions.labelRestoreBackup");
    return label;
  }

  async function handleSaveVersion() {
    setBusy("save");
    try {
      await snapshotDocument(
        docId,
        editor.getJSON() as ProseMirrorDoc,
        name.trim() || t("versions.defaultName"),
      );
      setName("");
      toast.success(t("versions.saved"));
      await refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview(id: number) {
    if (preview?.id === id) {
      setPreview(null);
      return;
    }
    try {
      const v = await getDocumentVersion(docId, id);
      const text = pmText(v.content_json)
        .replace(/\n{2,}/g, "\n")
        .trim();
      setPreview({ id, text: text.slice(0, 600) || t("versions.empty") });
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function handleRestore(id: number) {
    if (!window.confirm(t("versions.confirmRestore"))) return;
    setBusy(id);
    try {
      const { content_json } = await restoreDocumentVersion(docId, id);
      editor.commands.setContent(content_json as Record<string, unknown>);
      // Persist the restored content + refresh state through the normal cycle.
      useEditorStore
        .getState()
        .queueContentSave(content_json as ProseMirrorDoc);
      toast.success(t("versions.restored"));
      setPreview(null);
      await refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("versions.panelTitle")}
          </SheetTitle>
          <SheetDescription>{t("versions.panelDesc")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {/* Save a named version */}
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("versions.namePlaceholder")}
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={handleSaveVersion}
            >
              {busy === "save" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("versions.save")}
            </Button>
          </div>

          <div className="border-t" />

          {loading && versions.length === 0 ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("versions.none")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {versions.map((v) => (
                <li key={v.id} className="rounded-md border">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {labelText(v.label)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {relTime(v.created_at, locale)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => handlePreview(v.id)}
                    >
                      {t("versions.preview")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => handleRestore(v.id)}
                    >
                      {busy === v.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      {t("versions.restore")}
                    </Button>
                  </div>
                  {preview?.id === v.id && (
                    <p className="whitespace-pre-wrap border-t px-3 py-2 text-xs text-muted-foreground">
                      {preview.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
