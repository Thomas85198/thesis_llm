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
  Quote,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ChatRateLimitError,
  groundCitation,
  recommendCitations,
  refreshCitations,
  verifyCitation,
  type CitationCandidate,
  type CitationVerdict,
  type GroundResult,
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

/** The claim a citation supports: the sentence ending at the chip (citations
 * usually sit at the end of the claim sentence). Falls back to the paragraph. */
function claimForCitation(editor: Editor, openalexId: string): string {
  let claim = "";
  editor.state.doc.descendants((node, pos) => {
    if (claim) return false;
    if (node.type.name === "citation" && node.attrs.openalexId === openalexId) {
      const $pos = editor.state.doc.resolve(pos);
      const paraStart = pos - $pos.parentOffset;
      const before = editor.state.doc.textBetween(paraStart, pos, " ", " ");
      const parts = before.split(/(?<=[。！？!?.])\s*/).filter(Boolean);
      claim = (parts[parts.length - 1] || before).trim() || $pos.parent.textContent.trim();
      return false;
    }
    return true;
  });
  return claim;
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
  const locale = useLocale();
  const closeCitePanel = useEditorStore((s) => s.closeCitePanel);
  const citationStyle = useEditorStore((s) => s.citationStyle);

  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CitationCandidate[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [yearFrom, setYearFrom] = useState<number | undefined>(undefined);
  // openalex_id → verdict, or "loading" while a verify is in flight. Separate
  // maps: recommend cards verify against the search box; references verify
  // against the claim sentence around the inserted chip.
  const [verdicts, setVerdicts] = useState<Record<string, CitationVerdict | "loading">>({});
  const [refVerdicts, setRefVerdicts] = useState<Record<string, CitationVerdict | "loading">>({});
  // openalexId → full-text grounding result (top supporting sentences), or "loading".
  const [grounds, setGrounds] = useState<Record<string, GroundResult | "loading">>({});
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

  const [refreshing, setRefreshing] = useState(false);

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

  // Claim–evidence "traffic light": does this candidate actually support the
  // claim in the search box? Verifies on demand (one LLM call per click).
  async function handleVerify(c: CitationCandidate) {
    const claim = query.trim();
    if (!claim) {
      toast.error(t("citation.verifyNeedsClaim"));
      return;
    }
    setVerdicts((v) => ({ ...v, [c.openalex_id]: "loading" }));
    try {
      const verdict = await verifyCitation(docId, claim, c.title, c.abstract, locale);
      setVerdicts((v) => ({ ...v, [c.openalex_id]: verdict }));
    } catch (e) {
      setVerdicts((v) => {
        const next = { ...v };
        delete next[c.openalex_id];
        return next;
      });
      if (e instanceof ChatRateLimitError)
        toast.error(t("citation.rateLimited", { seconds: e.retryAfter }));
      else toast.error(String(e));
    }
  }

  // Verify an already-inserted reference: claim = the sentence around the chip;
  // abstract is re-fetched server-side from the openalex_id.
  async function handleVerifyRef(r: CitationAttrs) {
    const claim = claimForCitation(editor, r.openalexId);
    if (!claim) {
      toast.error(t("citation.verifyNoClaim"));
      return;
    }
    setRefVerdicts((v) => ({ ...v, [r.openalexId]: "loading" }));
    try {
      const verdict = await verifyCitation(docId, claim, r.title, "", locale, r.openalexId);
      setRefVerdicts((v) => ({ ...v, [r.openalexId]: verdict }));
    } catch (e) {
      setRefVerdicts((v) => {
        const next = { ...v };
        delete next[r.openalexId];
        return next;
      });
      if (e instanceof ChatRateLimitError)
        toast.error(t("citation.rateLimited", { seconds: e.retryAfter }));
      else toast.error(String(e));
    }
  }

  // Full-text grounding: fetch the source's text and show the sentences that
  // best support the claim around this citation chip.
  async function handleGround(r: CitationAttrs) {
    const claim = claimForCitation(editor, r.openalexId);
    if (!claim) {
      toast.error(t("citation.verifyNoClaim"));
      return;
    }
    setGrounds((g) => ({ ...g, [r.openalexId]: "loading" }));
    try {
      const result = await groundCitation(docId, r.openalexId, r.oaUrl || r.url, claim);
      setGrounds((g) => ({ ...g, [r.openalexId]: result }));
    } catch (e) {
      setGrounds((g) => {
        const next = { ...g };
        delete next[r.openalexId];
        return next;
      });
      if (e instanceof ChatRateLimitError)
        toast.error(t("citation.rateLimited", { seconds: e.retryAfter }));
      else toast.error(String(e));
    }
  }

  // Re-pull every citation from OpenAlex and patch chip attrs in place — fixes
  // metadata frozen at insert time (chiefly links that have since rotted).
  async function handleRefreshLinks() {
    const ids = refs.map((r) => r.openalexId).filter(Boolean);
    if (ids.length === 0) return;
    setRefreshing(true);
    try {
      const fresh = await refreshCitations(ids);
      const byId: Record<string, CitationAttrs> = {};
      for (const [id, c] of Object.entries(fresh)) byId[id] = candidateToAttrs(c);
      const changed = editor.commands.refreshCitations(byId);
      toast.success(
        changed ? t("citation.refreshed") : t("citation.refreshedNoChange")
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRefreshing(false);
    }
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
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {typeof c.similarity === "number" && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-xs text-primary"
                          title={t("citation.semanticHint")}
                        >
                          <Sparkles className="h-3 w-3" />
                          {t("citation.semanticMatch", {
                            pct: Math.round(c.similarity * 100),
                          })}
                        </span>
                      )}
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("citation.viewSource")}
                        </a>
                      )}
                      {verdicts[c.openalex_id] === "loading" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("citation.verifying")}
                        </span>
                      ) : verdicts[c.openalex_id] ? (
                        <VerdictBadge verdict={verdicts[c.openalex_id] as CitationVerdict} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleVerify(c)}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          {t("citation.verify")}
                        </button>
                      )}
                    </div>
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
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                  onClick={handleRefreshLinks}
                  disabled={refreshing}
                  title={t("citation.refreshHint")}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  />
                  {t("citation.refreshLinks")}
                </Button>
              </div>
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
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {refVerdicts[r.openalexId] === "loading" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("citation.verifying")}
                          </span>
                        ) : refVerdicts[r.openalexId] ? (
                          <VerdictBadge verdict={refVerdicts[r.openalexId] as CitationVerdict} />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleVerifyRef(r)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <ShieldCheck className="h-3 w-3" />
                            {t("citation.verify")}
                          </button>
                        )}
                        {grounds[r.openalexId] === "loading" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("citation.grounding")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleGround(r)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Quote className="h-3 w-3" />
                            {t("citation.ground")}
                          </button>
                        )}
                      </div>
                      {grounds[r.openalexId] && grounds[r.openalexId] !== "loading" && (
                        <GroundView result={grounds[r.openalexId] as GroundResult} />
                      )}
                    </li>
                  );
                })}
                </ol>
              </ScrollArea>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Claim–evidence "traffic light" badge: 🟢 supports / 🟡 partial / 🔴 unsupported
 * / ⚪ unknown. Hovering shows the reason and the supporting sentence. */
function VerdictBadge({ verdict }: { verdict: CitationVerdict }) {
  const t = useTranslations("editor");
  const meta = {
    supports: { dot: "bg-emerald-500", cls: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
    partial: { dot: "bg-amber-500", cls: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
    unsupported: { dot: "bg-red-500", cls: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
    unknown: { dot: "bg-slate-400", cls: "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300" },
  }[verdict.verdict];
  const tip = [verdict.reason, verdict.evidence && `「${verdict.evidence}」`]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs ${meta.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {t(`citation.verdict.${verdict.verdict}`)}
    </span>
  );
}

/** Full-text grounding result: the source sentences that best support the claim,
 * each with its match %. Labels whether it came from full text or the abstract. */
function GroundView({ result }: { result: GroundResult }) {
  const t = useTranslations("editor");
  if (result.source === "none" || result.supporting.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">{t("citation.groundNone")}</p>
    );
  }
  return (
    <div className="mt-1.5 rounded-md border bg-muted/30 p-2">
      <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
        {t(result.source === "fulltext" ? "citation.groundFulltext" : "citation.groundAbstract")}
      </p>
      <ul className="flex flex-col gap-1">
        {result.supporting.map((s, i) => (
          <li key={i} className="text-xs leading-snug">
            <span className="mr-1 font-mono text-[10px] text-primary">
              {Math.round(s.score * 100)}%
            </span>
            「{s.sentence}」
          </li>
        ))}
      </ul>
    </div>
  );
}
