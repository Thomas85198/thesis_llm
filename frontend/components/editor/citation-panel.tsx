"use client";
// Smart Citation side panel. Two ways in:
//   1. Select a sentence → BubbleMenu「找引用」prefills + auto-searches it.
//   2. Toolbar button opens the panel empty; type any query in the search box.
// The body is keyed on a store nonce so each open remounts with a fresh query
// box and results. A second tab lists the document's references in the current
// citation style.
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  BookText,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ChatRateLimitError,
  recommendCitations,
  type CitationCandidate,
} from "@/lib/api";
import {
  fullReference,
  referenceLinks,
  type CitationAttrs,
} from "@/lib/citation-format";
import { useEditorStore } from "@/lib/editor-store";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function candidateToAttrs(c: CitationCandidate): CitationAttrs {
  return {
    openalexId: c.openalex_id,
    authors: c.authors.join(", "),
    year: c.year,
    title: c.title,
    venue: c.venue,
    doi: c.doi,
    oaUrl: c.oa_url,
    url: c.url,
  };
}

/** Distinct citations in the doc, by first appearance — for the references tab. */
function collectCitations(editor: Editor): CitationAttrs[] {
  const seen = new Set<string>();
  const out: CitationAttrs[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      const a = node.attrs as CitationAttrs;
      if (a.openalexId && !seen.has(a.openalexId)) {
        seen.add(a.openalexId);
        out.push(a);
      }
    }
    return true;
  });
  return out;
}

/** Shell: the Sheet + header. Body remounts (keyed on nonce) on every open. */
export function CitationPanel({ editor, docId }: { editor: Editor; docId: string }) {
  const t = useTranslations("editor");
  const open = useEditorStore((s) => s.citePanelOpen);
  const claim = useEditorStore((s) => s.citeClaim);
  const nonce = useEditorStore((s) => s.citeNonce);
  const closeCitePanel = useEditorStore((s) => s.closeCitePanel);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeCitePanel()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("citation.panelTitle")}</SheetTitle>
          <SheetDescription>{t("citation.panelDesc")}</SheetDescription>
        </SheetHeader>
        {open && (
          <CitationPanelBody
            key={nonce}
            editor={editor}
            docId={docId}
            initialQuery={claim}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CitationPanelBody({
  editor,
  docId,
  initialQuery,
}: {
  editor: Editor;
  docId: string;
  initialQuery: string;
}) {
  const t = useTranslations("editor");
  const closeCitePanel = useEditorStore((s) => s.closeCitePanel);
  const citationStyle = useEditorStore((s) => s.citationStyle);

  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CitationCandidate[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [yearFrom, setYearFrom] = useState<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // References list — recomputed when the doc's citations change.
  const refs = useEditorState({
    editor,
    selector: ({ editor }) => collectCitations(editor),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const doSearch = useCallback(
    (raw: string, yf?: number) => {
      const q = raw.trim();
      if (!q) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const run = async () => {
        setLoading(true);
        setHasSearched(true);
        setCandidates([]);
        try {
          const list = await recommendCitations(docId, q, {
            signal: controller.signal,
            yearFrom: yf,
          });
          if (!controller.signal.aborted) setCandidates(list);
        } catch (e) {
          if (controller.signal.aborted) return;
          if (e instanceof ChatRateLimitError) {
            toast.error(t("citation.rateLimited", { seconds: e.retryAfter }));
          } else {
            toast.error(String(e));
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      };
      void run();
    },
    [docId, t]
  );

  // On open: auto-search a prefilled claim (from BubbleMenu), else focus the box.
  useEffect(() => {
    if (initialQuery.trim()) doSearch(initialQuery, undefined);
    else inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, [initialQuery, doSearch]);

  function handleInsert(c: CitationCandidate) {
    const anchor = useEditorStore.getState().citeAnchor;
    editor
      .chain()
      .focus()
      .insertCitation(candidateToAttrs(c), anchor ?? undefined)
      .run();
    toast.success(t("citation.inserted"));
    closeCitePanel();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
      {/* Free-text search — works with or without a selection */}
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          doSearch(query, yearFrom);
        }}
      >
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("citation.searchPlaceholder")}
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          className="shrink-0"
          aria-label={t("citation.search")}
          title={t("citation.search")}
        >
          <Search className="h-4 w-4" />
        </Button>
      </form>

      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t("citation.yearLabel")}</span>
        <select
          value={yearFrom ?? ""}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : undefined;
            setYearFrom(v);
            if (query.trim()) doSearch(query, v);
          }}
          className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="">{t("citation.yearAll")}</option>
          <option value="2020">{t("citation.yearFrom", { year: 2020 })}</option>
          <option value="2015">{t("citation.yearFrom", { year: 2015 })}</option>
          <option value="2010">{t("citation.yearFrom", { year: 2010 })}</option>
        </select>
      </div>

      <Tabs defaultValue="recommend" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mb-3">
          <TabsTrigger value="recommend">{t("citation.tabRecommend")}</TabsTrigger>
          <TabsTrigger value="references">
            {t("citation.tabReferences")}
            {refs.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {refs.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Recommendations */}
        <TabsContent value="recommend" className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("citation.searching")}
            </div>
          ) : !hasSearched ? (
            <p className="px-1 py-10 text-center text-sm text-muted-foreground">
              {t("citation.searchPrompt")}
            </p>
          ) : candidates.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-muted-foreground">
              {t("citation.noResults")}
            </p>
          ) : (
            <ScrollArea className="h-full pr-3">
              <ul className="flex flex-col gap-2">
                {candidates.map((c) => (
                  <li
                    key={c.openalex_id}
                    className="rounded-lg border bg-card p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{c.title}</p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        aria-label={t("citation.insert")}
                        title={t("citation.insert")}
                        onClick={() => handleInsert(c)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        c.authors.slice(0, 3).join(", "),
                        c.year,
                        c.venue,
                        c.cited_by_count > 0
                          ? t("citation.citedBy", { count: c.cited_by_count })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {c.abstract && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80">
                        {c.abstract}
                      </p>
                    )}
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("citation.viewSource")}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </TabsContent>

        {/* References built from the doc's citation chips */}
        <TabsContent value="references" className="min-h-0 flex-1">
          {refs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <BookText className="h-5 w-5 opacity-60" />
              {t("citation.referencesEmpty")}
            </div>
          ) : (
            <ScrollArea className="h-full pr-3">
              <ol className="flex flex-col gap-3 text-sm">
                {refs.map((r, i) => {
                  const text = fullReference(r, citationStyle, i + 1);
                  const links = referenceLinks(r);
                  return (
                    <li key={r.openalexId} className="flex flex-col gap-1">
                      <span className="leading-snug text-foreground/90">{text}</span>
                      {links.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {links.map((link) => {
                            const meta = {
                              // OA full text — most useful, may rot.
                              fulltext: { icon: FileText, label: t("citation.linkFulltext") },
                              // DOI — stable anchor that (almost) never 404s.
                              doi: { icon: Link2, label: t("citation.linkDoi") },
                              // Fallback when neither OA nor DOI is known.
                              source: { icon: ExternalLink, label: t("citation.viewSource") },
                            }[link.kind];
                            const Icon = meta.icon;
                            return (
                              <a
                                key={link.kind}
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <Icon className="h-3 w-3" />
                                {meta.label}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
