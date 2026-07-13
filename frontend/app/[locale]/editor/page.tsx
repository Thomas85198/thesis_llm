"use client";

import { FilePlus2, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link, useRouter } from "@/i18n/navigation";
import {
  createDocument,
  deleteDocument,
  fetchImportJob,
  importDocument,
  listDocuments,
  type EditorDocListItem,
  type ImportResult,
} from "@/lib/api";

// Accepted import types (mirrors the backend's _IMPORT_EXTS).
const IMPORT_ACCEPT =
  ".txt,.md,.markdown,.mdown,.docx,.tex,.latex,.pdf,text/plain,text/markdown," +
  "application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// PDF import runs as a backend job (scanned PDFs go through OCR — minutes).
const IMPORT_POLL_MS = 3000;
const IMPORT_POLL_TIMEOUT_MS = 20 * 60 * 1000;

export default function EditorHomePage() {
  const t = useTranslations("editor");
  const locale = useLocale();
  const router = useRouter();
  const [docs, setDocs] = useState<EditorDocListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listDocuments()
      .then((items) => setDocs(items))
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : String(e));
        setDocs([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const doc = await createDocument({ locale });
      router.push(`/editor/${encodeURIComponent(doc.doc_id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    setImporting(true);
    try {
      const res = await importDocument(file);
      let result: ImportResult;
      if ("job_id" in res) {
        result = await pollImportJob(res.job_id);
      } else {
        result = res;
      }
      const doc = await createDocument({
        locale,
        title: result.title,
        content_json: result.content_json,
      });
      toast.success(t("imported", { title: doc.title }));
      router.push(`/editor/${encodeURIComponent(doc.doc_id)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  };

  // Poll a PDF import job; surface the OCR stage once (scanned PDFs take minutes).
  const pollImportJob = async (jobId: string): Promise<ImportResult> => {
    let ocrNotified = false;
    const deadline = Date.now() + IMPORT_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, IMPORT_POLL_MS));
      const st = await fetchImportJob(jobId);
      if (st.status === "done") return st;
      if (st.status === "error") throw new Error(st.detail);
      if (st.stage === "ocr" && !ocrNotified) {
        ocrNotified = true;
        toast.info(t("importOcr"), { duration: 10000 });
      }
    }
    throw new Error(t("importTimeout"));
  };

  const handleDelete = async (docId: string) => {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await deleteDocument(docId);
      setDocs((prev) => prev?.filter((d) => d.doc_id !== docId) ?? null);
      toast.success(t("deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            title={t("importHint")}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {t("import")}
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
            {t("newDocument")}
          </Button>
        </div>
      </div>

      {docs === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">{t("empty")}</p>
          <Button
            onClick={handleCreate}
            disabled={creating}
            variant="secondary"
          >
            <FilePlus2 className="h-4 w-4" />
            {t("newDocument")}
          </Button>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li key={d.doc_id}>
              <Card className="flex flex-row items-center gap-3 p-0 transition-colors hover:bg-accent/50">
                <Link
                  href={`/editor/${encodeURIComponent(d.doc_id)}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                >
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {d.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("updatedAt")}{" "}
                      {new Date(d.updated_at).toLocaleString(locale)}
                    </span>
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-2 h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={t("delete")}
                  onClick={() => handleDelete(d.doc_id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
