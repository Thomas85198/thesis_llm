"use client";
// Shown when an autosave is rejected because the document was modified
// elsewhere (another tab/device). Autosave is paused until the user picks:
//  • Reload latest — local edits are first snapshotted as a recoverable version,
//    then the server's content replaces the editor.
//  • Keep mine — force-overwrites the server with the current editor content.
// Both paths re-sync the optimistic-concurrency token via markSynced().
import type { Editor } from "@tiptap/core";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  fetchDocument,
  snapshotDocument,
  updateDocument,
  type ProseMirrorDoc,
} from "@/lib/api";
import { useEditorStore } from "@/lib/editor-store";
import { Button } from "@/components/ui/button";

export function ConflictBanner({
  editor,
  docId,
}: {
  editor: Editor;
  docId: string;
}) {
  const t = useTranslations("editor");
  const conflict = useEditorStore((s) => s.conflict);
  const markSynced = useEditorStore((s) => s.markSynced);
  const [busy, setBusy] = useState<"reload" | "overwrite" | null>(null);

  if (!conflict) return null;

  async function reloadLatest() {
    setBusy("reload");
    try {
      // Preserve local edits as a recoverable version before they're replaced.
      await snapshotDocument(
        docId,
        editor.getJSON() as ProseMirrorDoc,
        t("conflict.backupLabel"),
      ).catch(() => {});
      const latest = await fetchDocument(docId);
      editor.commands.setContent(
        latest.content_json as Record<string, unknown>,
      );
      markSynced(latest.updated_at);
      toast.success(t("conflict.reloaded"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function overwrite() {
    setBusy("overwrite");
    try {
      // No expected_updated_at → unconditional save (force overwrite).
      const res = await updateDocument(docId, {
        content_json: editor.getJSON() as ProseMirrorDoc,
      });
      markSynced(res.updated_at ?? new Date().toISOString());
      toast.success(t("conflict.overwritten"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{t("conflict.message")}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        disabled={busy !== null}
        onClick={reloadLatest}
      >
        {busy === "reload" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t("conflict.reload")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs"
        disabled={busy !== null}
        onClick={overwrite}
      >
        {busy === "overwrite" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        {t("conflict.overwrite")}
      </Button>
    </div>
  );
}
