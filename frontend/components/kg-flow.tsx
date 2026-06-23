"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { ChevronRight, ExternalLink, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import nextDynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { layoutDagre } from "@/lib/kg-layout";
import { cn } from "@/lib/utils";
import {
  deleteJudgment,
  fetchJudgments,
  pdfUrl,
  pickLocalized,
  submitJudgment,
} from "@/lib/api";
import type {
  AnalysisResult,
  Defect,
  EDU,
  SectionName,
  Severity,
  Verdict,
} from "@/lib/api";

// Labels are resolved at render time via t(`verdict.${value}`) since module-level
// consts cannot call hooks; only value + styling live here.
const VERDICT_OPTIONS: { value: Verdict; active: string }[] = [
  {
    value: "correct",
    active:
      "bg-green-100 text-green-800 ring-2 ring-green-500 dark:bg-green-950 dark:text-green-200",
  },
  {
    value: "partial",
    active:
      "bg-yellow-100 text-yellow-800 ring-2 ring-yellow-500 dark:bg-yellow-950 dark:text-yellow-200",
  },
  {
    value: "wrong",
    active:
      "bg-red-100 text-red-800 ring-2 ring-red-500 dark:bg-red-950 dark:text-red-200",
  },
];

const PdfViewer = nextDynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  },
);

type PdfHighlight = {
  edu_id: string;
  page: number;
  bbox: [number, number, number, number];
  severity?: "high" | "medium" | "low";
};

type PdfPreview = {
  focusEduId: string;
  highlights: PdfHighlight[];
  section: string;
  page: number;
};

type OpenPdf = (eduIds: string[], focusId: string) => void;

const ENTITY_COLORS: Record<string, string> = {
  Concept: "#a78bfa",
  Method: "#60a5fa",
  Metric: "#34d399",
  Dataset: "#fbbf24",
  Model: "#22d3ee",
  Task: "#f472b6",
  Claim: "#fb7185",
  Other: "#94a3b8",
};

const FRU_COLORS: Record<string, string> = {
  Motivation: "#fb7185",
  Claim: "#f97316",
  Evidence: "#22c55e",
  Background: "#94a3b8",
  Definition: "#a78bfa",
  MethodStep: "#60a5fa",
  Observation: "#06b6d4",
  Attribution: "#14b8a6",
  Concession: "#eab308",
  Compensation: "#84cc16",
  Specific: "#ec4899",
  Generalization: "#8b5cf6",
  Restatement: "#64748b",
  MetaDiscourse: "#f43f5e",
  Other: "#cbd5e1",
};

// Severity styling, mirrored from defect-panel.tsx for the FRU defect linkage.
// Severity labels are resolved via t(`sev.${severity}`) at render time.
const SEVERITY_BORDER: Record<Severity, string> = {
  high: "border-l-red-500",
  medium: "border-l-orange-500",
  low: "border-l-yellow-500",
};
const SEVERITY_BADGE: Record<Severity, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium:
    "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  low: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
};
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// Document order of sections. Entities are grouped into the section of the
// earliest EDU that any of their relations cites.
const SECTION_ORDER: SectionName[] = [
  "Abstract",
  "Introduction",
  "Method",
  "Experiment",
  "Results",
  "Discussion",
  "Conclusion",
  "Other",
];

// Bucket key for entities that have no relation citing a sectioned EDU.
// Its human label is resolved via t("unsectioned") at render time.
const UNSECTIONED = "__unsectioned__";

function entityColor(type: string): string {
  return ENTITY_COLORS[type] ?? ENTITY_COLORS.Other;
}

// Tracks the active `.dark` class on <html> so canvas-rendered widgets (React
// Flow nodes/edges/controls use inline colors, not Tailwind) can re-theme live
// when the user toggles. A MutationObserver keeps it in sync with the toggle.
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// Detail panel width is user-resizable via a drag handle on its left edge,
// clamped so the panel never crowds out the left list nor overflows the card.
const ASIDE_MIN = 320;
const ASIDE_MAX = 620;
const ASIDE_DEFAULT = 380;

function useResizableAside() {
  const [width, setWidth] = useState(ASIDE_DEFAULT);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // Handle sits on the aside's LEFT edge → dragging left widens it.
        const next = startW + (startX - ev.clientX);
        setWidth(Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, next)));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width],
  );

  return { width, onMouseDown };
}

function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-foreground/20"
    />
  );
}

type EntitySort = "default" | "alpha" | "relations";
type FruSort = "default" | "alpha" | "defects";

// Segmented sort control, styled to match the existing pill filters above it.
function SortControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex overflow-hidden rounded-full border bg-muted/50">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-2 py-0.5 text-[11px] transition",
              value === opt.value
                ? "bg-muted font-medium"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type EntityRelation = {
  predicate: string;
  direction: "out" | "in"; // out: this entity is the source; in: the target
  otherId: string;
  otherName: string;
  otherType: string;
  evidenceText: string;
  evidenceEduId: string; // for jumping to the cited sentence in the PDF
};

type GroupedEntity = {
  id: string;
  name: string;
  type: string;
  sortKey: number; // earliest cited EDU order, for in-section ordering
};

type SectionGroup = {
  key: string;
  entities: GroupedEntity[];
};

type EntityModel = {
  groups: SectionGroup[];
  relationsById: Map<string, EntityRelation[]>;
  sectionById: Map<string, string>; // bucket key per entity
  typeCounts: { type: string; count: number }[];
};

function analyzeEntities(result: AnalysisResult): EntityModel {
  const eduMap = new Map(result.graph.edus.map((e) => [e.id, e]));
  const entityMap = new Map(result.graph.entities.map((e) => [e.id, e]));
  const sectionRank = (s: SectionName) => {
    const i = SECTION_ORDER.indexOf(s);
    return i < 0 ? SECTION_ORDER.length : i;
  };

  // Relations per entity (both directions).
  const relationsById = new Map<string, EntityRelation[]>();
  for (const e of result.graph.entities) relationsById.set(e.id, []);

  // Track the earliest cited EDU per entity → representative section + sortKey.
  const best = new Map<
    string,
    { rank: number; order: number; section: SectionName }
  >();
  const consider = (eid: string, section: SectionName, order: number) => {
    const rank = sectionRank(section);
    const cur = best.get(eid);
    if (!cur || rank < cur.rank || (rank === cur.rank && order < cur.order)) {
      best.set(eid, { rank, order, section });
    }
  };

  for (const t of result.graph.er_triples) {
    const src = entityMap.get(t.source_entity_id);
    const tgt = entityMap.get(t.target_entity_id);
    if (!src || !tgt) continue;
    const edu = t.evidence_edu_id ? eduMap.get(t.evidence_edu_id) : undefined;
    const evidenceText = edu?.text ?? "";
    const evidenceEduId = edu ? edu.id : "";

    relationsById.get(src.id)?.push({
      predicate: t.predicate,
      direction: "out",
      otherId: tgt.id,
      otherName: tgt.name,
      otherType: tgt.type,
      evidenceText,
      evidenceEduId,
    });
    relationsById.get(tgt.id)?.push({
      predicate: t.predicate,
      direction: "in",
      otherId: src.id,
      otherName: src.name,
      otherType: src.type,
      evidenceText,
      evidenceEduId,
    });

    if (edu) {
      consider(src.id, edu.section, edu.order);
      consider(tgt.id, edu.section, edu.order);
    }
  }

  // Fallback for entities not cited by any relation: assign the section of the
  // earliest EDU (in document order) whose text mentions the entity name. This
  // is a heuristic for grouping only — relation-evidenced sections take priority.
  const unassigned = result.graph.entities.filter(
    (e) => !best.has(e.id) && e.name.length >= 3,
  );
  if (unassigned.length > 0) {
    const edusInOrder = [...result.graph.edus].sort(
      (a, b) =>
        sectionRank(a.section) - sectionRank(b.section) || a.order - b.order,
    );
    const lowered = edusInOrder.map((e) => ({
      section: e.section,
      order: e.order,
      text: e.text.toLowerCase(),
    }));
    for (const e of unassigned) {
      const nm = e.name.toLowerCase();
      const hit = lowered.find((edu) => edu.text.includes(nm));
      if (hit) {
        best.set(e.id, {
          rank: sectionRank(hit.section),
          order: hit.order,
          section: hit.section,
        });
      }
    }
  }

  // Dedupe relations (same direction + predicate + other entity).
  for (const [id, rels] of relationsById) {
    const seen = new Set<string>();
    relationsById.set(
      id,
      rels.filter((r) => {
        const k = `${r.direction}|${r.predicate}|${r.otherId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    );
  }

  // Bucket entities by representative section.
  const sectionById = new Map<string, string>();
  const buckets = new Map<string, GroupedEntity[]>();
  for (const e of result.graph.entities) {
    const b = best.get(e.id);
    const key = b ? b.section : UNSECTIONED;
    sectionById.set(e.id, key);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({
      id: e.id,
      name: e.name,
      type: e.type,
      sortKey: b ? b.order : Number.MAX_SAFE_INTEGER,
    });
  }

  const orderedKeys = [...SECTION_ORDER, UNSECTIONED];
  const groups: SectionGroup[] = orderedKeys
    .filter((k) => buckets.has(k))
    .map((k) => ({
      key: k,
      entities: buckets
        .get(k)!
        .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name)),
    }));

  // Type counts, ordered by the legend order.
  const counts = new Map<string, number>();
  for (const e of result.graph.entities) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const typeCounts = Object.keys(ENTITY_COLORS)
    .filter((t) => counts.has(t))
    .map((t) => ({ type: t, count: counts.get(t)! }))
    .concat(
      [...counts.keys()]
        .filter((t) => !(t in ENTITY_COLORS))
        .map((t) => ({ type: t, count: counts.get(t)! })),
    );

  return { groups, relationsById, sectionById, typeCounts };
}

// Focused 1-hop "ego" graph for the selected entity. Neighbors that point INTO
// the entity land on the left, neighbors it points TO land on the right, via a
// left-to-right dagre layout — so the panel reads "incoming | entity | outgoing".
function EgoGraph({
  centerId,
  centerName,
  centerType,
  relations,
  onSelect,
}: {
  centerId: string;
  centerName: string;
  centerType: string;
  relations: EntityRelation[];
  onSelect: (id: string) => void;
}) {
  const isDark = useIsDark();
  const { nodes, edges } = useMemo(() => {
    const NODE_W = 120;
    const NODE_H = 30;

    // Unique neighbor nodes (an entity may appear via several predicates).
    const neighborType = new Map<string, string>();
    const neighborName = new Map<string, string>();
    for (const r of relations) {
      neighborType.set(r.otherId, r.otherType);
      neighborName.set(r.otherId, r.otherName);
    }

    const layoutNodes = [
      { id: centerId, width: NODE_W, height: NODE_H },
      ...[...neighborName.keys()].map((id) => ({
        id,
        width: NODE_W,
        height: NODE_H,
      })),
    ];
    const layoutEdges = relations.map((r) => ({
      source: r.direction === "out" ? centerId : r.otherId,
      target: r.direction === "out" ? r.otherId : centerId,
    }));

    const layout = layoutDagre(layoutNodes, layoutEdges, {
      rankdir: "LR",
      nodesep: 16,
      ranksep: 90,
    });

    const mkNode = (
      id: string,
      name: string,
      type: string,
      center: boolean,
    ): Node => {
      const pos = layout.get(id) ?? { x: 0, y: 0, w: NODE_W, h: NODE_H };
      const c = entityColor(type);
      return {
        id,
        position: { x: pos.x, y: pos.y },
        data: {
          // span carries the full name as a native tooltip; the node's own
          // ellipsis styling still truncates the visible text.
          label: (
            <span
              title={name}
              className="block overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {name}
            </span>
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        connectable: false,
        style: {
          // Center: solid bright fill → dark text reads in both themes.
          // Neighbor: faint tint → text must follow the theme or it vanishes
          // (dark text on the dark-mode tint was the invisible-node bug).
          background: center ? c : `${c}26`,
          border: `1px solid ${c}`,
          borderRadius: 8,
          padding: "4px 6px",
          fontSize: 10,
          fontWeight: center ? 600 : 400,
          width: NODE_W,
          textAlign: "center" as const,
          color: center ? "#0f172a" : isDark ? "#e2e8f0" : "#0f172a",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap" as const,
        },
      };
    };

    const nodes: Node[] = [
      mkNode(centerId, centerName, centerType, true),
      ...[...neighborName.keys()].map((id) =>
        mkNode(
          id,
          neighborName.get(id) ?? id,
          neighborType.get(id) ?? "Other",
          false,
        ),
      ),
    ];

    const edges: Edge[] = relations.map((r, i) => ({
      id: `ego-${i}`,
      source: r.direction === "out" ? centerId : r.otherId,
      target: r.direction === "out" ? r.otherId : centerId,
      label: r.predicate,
      labelStyle: { fontSize: 9, fill: isDark ? "#cbd5e1" : "#475569" },
      labelBgStyle: { fill: isDark ? "#1e293b" : "#f8fafc", fillOpacity: 0.85 },
      labelBgPadding: [2, 1] as [number, number],
      style: { stroke: isDark ? "#64748b" : "#94a3b8", strokeWidth: 1 },
      markerEnd: {
        type: "arrowclosed" as const,
        color: isDark ? "#64748b" : "#94a3b8",
      },
    }));

    return { nodes, edges };
  }, [centerId, centerName, centerType, relations, isDark]);

  return (
    <ReactFlow
      // Remount when the focused entity changes so fitView re-runs on the new
      // graph — otherwise a previously-fit viewport leaves a large tree
      // overflowing the panel.
      key={centerId}
      nodes={nodes}
      edges={edges}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      // Allow shrinking far enough that even a hub entity with many relations
      // fits, and let the user drag to pan / pinch + buttons to zoom when it
      // doesn't. (zoomOnScroll stays off so the side panel still scrolls.)
      minZoom={0.05}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick
      panOnDrag
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
      // colorMode themes the built-in Background + Controls (the previously
      // white-on-dark zoom buttons) to match the active theme.
      colorMode={isDark ? "dark" : "light"}
      onNodeClick={(_, node) => onSelect(node.id)}
    >
      <Background gap={14} size={1} color={isDark ? "#334155" : "#e2e8f0"} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

function EntityLayer({
  result,
  onOpenPdf,
  noPdf = false,
}: {
  result: AnalysisResult;
  onOpenPdf: OpenPdf;
  noPdf?: boolean;
}) {
  const t = useTranslations("kgFlow");
  const model = useMemo(() => analyzeEntities(result), [result]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<EntitySort>("default");
  const aside = useResizableAside();

  const filterActive = activeTypes.size > 0;
  const matchesType = (type: string) => !filterActive || activeTypes.has(type);
  const q = query.trim().toLowerCase();
  const matchesQuery = (name: string) => !q || name.toLowerCase().includes(q);

  // Sort within a section group; relation count comes from model.relationsById.
  const sortEntities = (entities: GroupedEntity[]): GroupedEntity[] => {
    const arr = [...entities];
    if (sort === "alpha") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "relations")
      arr.sort(
        (a, b) =>
          (model.relationsById.get(b.id)?.length ?? 0) -
            (model.relationsById.get(a.id)?.length ?? 0) ||
          a.name.localeCompare(b.name),
      );
    return arr; // "default" keeps the model's section+order sort
  };

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleType = (type: string) =>
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const selected = selectedId
    ? (result.graph.entities.find((e) => e.id === selectedId) ?? null)
    : null;
  const selectedRelations = selectedId
    ? (model.relationsById.get(selectedId) ?? [])
    : [];
  const selectedSection = selectedId ? model.sectionById.get(selectedId) : null;

  return (
    <div className="flex h-full">
      {/* Left: section-grouped entity chips */}
      <div className="flex-1 overflow-auto p-3">
        {/* Search box */}
        <div className="relative mb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchEntities")}
            className="w-full rounded-md border bg-background px-2 py-1 pr-7 text-xs outline-none focus:ring-1 focus:ring-foreground/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              title={t("clearSearch")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="mb-2">
          <SortControl
            label={t("sortLabel")}
            value={sort}
            onChange={setSort}
            options={[
              { value: "default", label: t("sortDefault") },
              { value: "alpha", label: t("sortAlpha") },
              { value: "relations", label: t("sortRelations") },
            ]}
          />
        </div>

        {/* Type filter */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {model.typeCounts.map(({ type, count }) => {
            const on = activeTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition",
                  on
                    ? "border-foreground/40 bg-muted font-medium"
                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted",
                )}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: entityColor(type) }}
                />
                {type}
                <span className="tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
          {filterActive && (
            <button
              onClick={() => setActiveTypes(new Set())}
              className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("clearFilter")}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {model.groups.map((g) => {
            const visible = sortEntities(
              g.entities.filter(
                (e) => matchesType(e.type) && matchesQuery(e.name),
              ),
            );
            // Hide groups emptied by an active filter or search.
            if ((filterActive || q) && visible.length === 0) return null;
            const isCollapsed = collapsed.has(g.key);
            return (
              <div key={g.key} className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleCollapse(g.key)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                    {g.key === UNSECTIONED ? t("unsectioned") : g.key}
                  </span>
                  <Badge variant="secondary">
                    {filterActive || q
                      ? `${visible.length}/${g.entities.length}`
                      : g.entities.length}
                  </Badge>
                </button>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                    {visible.map((e) => {
                      const c = entityColor(e.type);
                      const isSel = selectedId === e.id;
                      return (
                        <button
                          key={e.id}
                          onClick={() => setSelectedId(isSel ? null : e.id)}
                          title={`${e.name} · ${e.type}`}
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs transition",
                            isSel && "ring-2 ring-offset-1",
                          )}
                          style={{
                            background: `${c}1f`,
                            borderColor: c,
                            // @ts-expect-error CSS custom prop for ring color
                            "--tw-ring-color": c,
                          }}
                        >
                          {e.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: selected entity detail (resizable) */}
      <aside
        className="relative shrink-0 overflow-auto border-l bg-muted/20 p-3"
        style={{ width: aside.width }}
      >
        <ResizeHandle onMouseDown={aside.onMouseDown} />
        {!selected ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("entityEmptyHint")}
            <br />
            {t("entityEmptyHintSub")}
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: entityColor(selected.type) }}
                />
                <span
                  className="text-sm font-semibold leading-tight"
                  title={selected.name}
                >
                  {selected.name}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selected.type}
                {selectedSection && selectedSection !== UNSECTIONED
                  ? ` · ${selectedSection}`
                  : ""}
              </p>
            </div>

            {selectedRelations.length > 0 && (
              <div className="h-56 overflow-hidden rounded-md border bg-background">
                <EgoGraph
                  centerId={selected.id}
                  centerName={selected.name}
                  centerType={selected.type}
                  relations={selectedRelations}
                  onSelect={setSelectedId}
                />
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("relations")}{" "}
                {selectedRelations.length > 0 &&
                  `(${selectedRelations.length})`}
              </p>
              {selectedRelations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("noRelations")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedRelations.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-md border bg-background px-2 py-1.5"
                    >
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">
                          {r.direction === "out" ? "→" : "←"}
                        </span>
                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">
                          {r.predicate}
                        </span>
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: entityColor(r.otherType) }}
                        />
                        <button
                          onClick={() => setSelectedId(r.otherId)}
                          className="truncate text-left hover:underline"
                          title={r.otherName}
                        >
                          {r.otherName}
                        </button>
                      </div>
                      {r.evidenceText && (
                        <div className="mt-1 flex items-start gap-1">
                          <p
                            className="line-clamp-3 flex-1 text-[11px] leading-snug text-muted-foreground"
                            title={r.evidenceText}
                          >
                            {r.evidenceText}
                          </p>
                          {!noPdf && r.evidenceEduId && (
                            <button
                              onClick={() =>
                                onOpenPdf([r.evidenceEduId], r.evidenceEduId)
                              }
                              title={t("locateInPdf")}
                              className="mt-0.5 shrink-0 text-muted-foreground transition hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function fruColor(fn: string): string {
  return FRU_COLORS[fn] ?? FRU_COLORS.Other;
}

function topSeverity(defects: Defect[]): Severity {
  return defects.reduce<Severity>(
    (acc, d) =>
      SEVERITY_RANK[d.severity] < SEVERITY_RANK[acc] ? d.severity : acc,
    "low",
  );
}

type FruItem = {
  id: string;
  function: string;
  summary: string;
  eduIds: string[];
  sortKey: number; // earliest covered EDU order, for in-section ordering
};

type FruGroup = {
  key: string;
  frus: FruItem[];
};

type FruModel = {
  groups: FruGroup[];
  functionCounts: { fn: string; count: number }[];
  defectsByFru: Map<string, Defect[]>; // FRU id → defects whose evidence EDUs overlap
  sectionById: Map<string, string>;
  eduMap: Map<string, EDU>;
};

function analyzeFrus(result: AnalysisResult): FruModel {
  const eduMap = new Map(result.graph.edus.map((e) => [e.id, e]));
  const sectionRank = (s: SectionName) => {
    const i = SECTION_ORDER.indexOf(s);
    return i < 0 ? SECTION_ORDER.length : i;
  };

  // Each FRU covers consecutive EDUs of one section → take the earliest EDU's
  // section as the bucket, and its order as the in-section sort key.
  const buckets = new Map<string, FruItem[]>();
  const sectionById = new Map<string, string>();
  for (const f of result.graph.fru_nodes) {
    let best: { rank: number; order: number; section: SectionName } | null =
      null;
    for (const id of f.edu_ids) {
      const edu = eduMap.get(id);
      if (!edu) continue;
      const rank = sectionRank(edu.section);
      if (
        !best ||
        rank < best.rank ||
        (rank === best.rank && edu.order < best.order)
      ) {
        best = { rank, order: edu.order, section: edu.section };
      }
    }
    const key = best ? best.section : UNSECTIONED;
    sectionById.set(f.id, key);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({
      id: f.id,
      function: f.function,
      summary: f.summary,
      eduIds: f.edu_ids,
      sortKey: best ? best.order : Number.MAX_SAFE_INTEGER,
    });
  }

  const orderedKeys = [...SECTION_ORDER, UNSECTIONED];
  const groups: FruGroup[] = orderedKeys
    .filter((k) => buckets.has(k))
    .map((k) => ({
      key: k,
      frus: buckets.get(k)!.sort((a, b) => a.sortKey - b.sortKey),
    }));

  // Function counts, ordered by the legend order.
  const counts = new Map<string, number>();
  for (const f of result.graph.fru_nodes) {
    counts.set(f.function, (counts.get(f.function) ?? 0) + 1);
  }
  const functionCounts = Object.keys(FRU_COLORS)
    .filter((fn) => counts.has(fn))
    .map((fn) => ({ fn, count: counts.get(fn)! }))
    .concat(
      [...counts.keys()]
        .filter((fn) => !(fn in FRU_COLORS))
        .map((fn) => ({ fn, count: counts.get(fn)! })),
    );

  // Defects touching each FRU, via edu_ids ∩ defect.evidence_edu_ids. Note this
  // is generous (a defect's evidence often spans several overlapping FRUs), so
  // the UI frames it as "defects involving this passage", not "this FRU's fault".
  const defectsByFru = new Map<string, Defect[]>();
  for (const f of result.graph.fru_nodes) {
    const set = new Set(f.edu_ids);
    const ds = result.defects.filter((d) =>
      d.evidence_edu_ids.some((e) => set.has(e)),
    );
    if (ds.length > 0) defectsByFru.set(f.id, ds);
  }

  return { groups, functionCounts, defectsByFru, sectionById, eduMap };
}

function FruLayer({
  result,
  onOpenPdf,
  noPdf = false,
}: {
  result: AnalysisResult;
  onOpenPdf: OpenPdf;
  noPdf?: boolean;
}) {
  const t = useTranslations("kgFlow");
  const locale = useLocale();
  const model = useMemo(() => analyzeFrus(result), [result]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeFns, setActiveFns] = useState<Set<string>>(new Set());
  const [judgments, setJudgments] = useState<Map<string, Verdict>>(new Map());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FruSort>("default");
  const aside = useResizableAside();

  // Human-as-judge verdicts, shared with the result page via the same API.
  // Drafts have no judgment workflow — skip the fetch entirely.
  useEffect(() => {
    if (noPdf) return;
    let cancelled = false;
    fetchJudgments(result.paper_id)
      .then((items) => {
        if (cancelled) return;
        const m = new Map<string, Verdict>();
        for (const j of items) m.set(j.defect_id, j.verdict);
        setJudgments(m);
      })
      .catch(() => {
        /* best-effort; missing judgments shouldn't block the graph */
      });
    return () => {
      cancelled = true;
    };
  }, [result.paper_id, noPdf]);

  const handleJudge = useCallback(
    async (defectId: string, ruleId: string, verdict: Verdict | null) => {
      setJudgments((prev) => {
        const next = new Map(prev);
        if (verdict === null) next.delete(defectId);
        else next.set(defectId, verdict);
        return next;
      });
      try {
        if (verdict === null) {
          await deleteJudgment(result.paper_id, defectId);
        } else {
          await submitJudgment(result.paper_id, {
            defect_id: defectId,
            rule_id: ruleId,
            verdict,
          });
        }
      } catch (err) {
        toast.error(t("saveJudgmentFailed"), {
          description: err instanceof Error ? err.message : String(err),
        });
        try {
          const items = await fetchJudgments(result.paper_id);
          const m = new Map<string, Verdict>();
          for (const j of items) m.set(j.defect_id, j.verdict);
          setJudgments(m);
        } catch {
          /* ignore */
        }
      }
    },
    [result.paper_id, t],
  );

  const filterActive = activeFns.size > 0;
  const matchesFn = (fn: string) => !filterActive || activeFns.has(fn);
  const q = query.trim().toLowerCase();
  // FRU search matches the summary text and the function name.
  const matchesQuery = (f: FruItem) =>
    !q ||
    f.summary.toLowerCase().includes(q) ||
    f.function.toLowerCase().includes(q);

  // Sort within a section group; defect linkage comes from model.defectsByFru.
  const sortFrus = (frus: FruItem[]): FruItem[] => {
    const arr = [...frus];
    if (sort === "alpha")
      arr.sort((a, b) => a.summary.localeCompare(b.summary));
    else if (sort === "defects")
      arr.sort((a, b) => {
        const da = model.defectsByFru.get(a.id)?.length ?? 0;
        const db = model.defectsByFru.get(b.id)?.length ?? 0;
        // Defective FRUs first, then by defect count, then keep document order.
        return (
          (db > 0 ? 1 : 0) - (da > 0 ? 1 : 0) ||
          db - da ||
          a.sortKey - b.sortKey
        );
      });
    return arr; // "default" keeps the model's section+order sort
  };

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleFn = (fn: string) =>
    setActiveFns((prev) => {
      const next = new Set(prev);
      if (next.has(fn)) next.delete(fn);
      else next.add(fn);
      return next;
    });

  const selected = selectedId
    ? (result.graph.fru_nodes.find((f) => f.id === selectedId) ?? null)
    : null;
  const selectedDefects = selectedId
    ? (model.defectsByFru.get(selectedId) ?? [])
    : [];
  const selectedSection = selectedId ? model.sectionById.get(selectedId) : null;
  const selectedEdus = selected
    ? selected.edu_ids
        .map((id) => model.eduMap.get(id))
        .filter((e): e is EDU => Boolean(e))
        .sort((a, b) => a.order - b.order)
    : [];
  const selectedPage = selectedEdus.find((e) => e.page > 0)?.page ?? 0;

  return (
    <div className="flex h-full">
      {/* Left: section-grouped FRU cards */}
      <div className="flex-1 overflow-auto p-3">
        {/* Search box */}
        <div className="relative mb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchFru")}
            className="w-full rounded-md border bg-background px-2 py-1 pr-7 text-xs outline-none focus:ring-1 focus:ring-foreground/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              title={t("clearSearch")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="mb-2">
          <SortControl
            label={t("sortLabel")}
            value={sort}
            onChange={setSort}
            options={[
              { value: "default", label: t("sortDefault") },
              { value: "alpha", label: t("sortAlpha") },
              { value: "defects", label: t("sortDefectsFirst") },
            ]}
          />
        </div>

        {/* Function filter */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {model.functionCounts.map(({ fn, count }) => {
            const on = activeFns.has(fn);
            return (
              <button
                key={fn}
                onClick={() => toggleFn(fn)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition",
                  on
                    ? "border-foreground/40 bg-muted font-medium"
                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted",
                )}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: fruColor(fn) }}
                />
                {fn}
                <span className="tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
          {filterActive && (
            <button
              onClick={() => setActiveFns(new Set())}
              className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("clearFilter")}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {model.groups.map((g) => {
            const visible = sortFrus(
              g.frus.filter((f) => matchesFn(f.function) && matchesQuery(f)),
            );
            // Hide groups emptied by an active filter or search.
            if ((filterActive || q) && visible.length === 0) return null;
            const isCollapsed = collapsed.has(g.key);
            return (
              <div key={g.key} className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleCollapse(g.key)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                    {g.key === UNSECTIONED ? t("unsectioned") : g.key}
                  </span>
                  <Badge variant="secondary">
                    {filterActive || q
                      ? `${visible.length}/${g.frus.length}`
                      : g.frus.length}
                  </Badge>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1.5 px-3 pb-3">
                    {visible.map((f) => {
                      const c = fruColor(f.function);
                      const isSel = selectedId === f.id;
                      const ds = model.defectsByFru.get(f.id);
                      return (
                        <button
                          key={f.id}
                          onClick={() => setSelectedId(isSel ? null : f.id)}
                          className={cn(
                            "flex w-full flex-col items-start gap-1 rounded-md border px-2 py-1.5 text-left transition",
                            isSel && "ring-2 ring-offset-1",
                          )}
                          style={{
                            borderColor: c,
                            // @ts-expect-error CSS custom prop for ring color
                            "--tw-ring-color": c,
                          }}
                        >
                          <div className="flex w-full items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: c }}
                            />
                            <span className="text-[11px] font-medium">
                              {f.function}
                            </span>
                            {ds && ds.length > 0 && (
                              <span
                                className={cn(
                                  "ml-auto rounded px-1 py-0.5 text-[10px] font-medium",
                                  SEVERITY_BADGE[topSeverity(ds)],
                                )}
                              >
                                {t("defectCount", { count: ds.length })}
                              </span>
                            )}
                          </div>
                          <span
                            className="line-clamp-2 text-[11px] leading-snug text-foreground"
                            title={f.summary || t("noSummary")}
                          >
                            {f.summary || t("noSummary")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: selected FRU detail (resizable) */}
      <aside
        className="relative shrink-0 overflow-auto border-l bg-muted/20 p-3"
        style={{ width: aside.width }}
      >
        <ResizeHandle onMouseDown={aside.onMouseDown} />
        {!selected ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("fruEmptyHint")}
            <br />
            {t("fruEmptyHintSub")}
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: fruColor(selected.function) }}
                />
                <span className="text-sm font-semibold leading-tight">
                  {selected.function}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selectedSection && selectedSection !== UNSECTIONED
                  ? selectedSection
                  : t("unsectioned")}
                {` · ${t("coversSegments", { count: selected.edu_ids.length })}`}
                {!noPdf && selectedPage > 0
                  ? ` · ${t("page", { page: selectedPage })}`
                  : ""}
              </p>
            </div>

            {selected.summary && (
              <p className="text-xs leading-snug">{selected.summary}</p>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("coveredEdu", { count: selectedEdus.length })}
              </p>
              <div className="space-y-1 border-l-2 border-muted-foreground/30 pl-3">
                {selectedEdus.map((e) => (
                  <div key={e.id} className="flex items-start gap-1">
                    <p className="flex-1 text-[11px] italic leading-relaxed text-muted-foreground">
                      「{e.text.trim()}」
                    </p>
                    {!noPdf && (
                      <button
                        onClick={() => onOpenPdf(selected.edu_ids, e.id)}
                        title={t("locateInPdf")}
                        className="mt-0.5 shrink-0 text-muted-foreground transition hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("defectsInvolving")}{" "}
                {selectedDefects.length > 0 && `(${selectedDefects.length})`}
              </p>
              {selectedDefects.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("noDefectInSegment")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {selectedDefects.map((d) => (
                    <li
                      key={d.id}
                      className={cn(
                        "rounded-md border border-l-2 bg-background px-2 py-1.5",
                        SEVERITY_BORDER[d.severity],
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[10px] font-medium",
                            SEVERITY_BADGE[d.severity],
                          )}
                        >
                          {t(`sev.${d.severity}`)}
                        </span>
                        <span className="text-xs font-medium">
                          {d.defect_type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {d.rule_id}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        {pickLocalized(d.description, locale)}
                      </p>
                      {pickLocalized(d.suggestion, locale) && (
                        <p className="mt-1 text-[11px] leading-snug">
                          <span className="font-medium">{t("suggestion")}</span>{" "}
                          {pickLocalized(d.suggestion, locale)}
                        </p>
                      )}
                      <div
                        className={cn(
                          "mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2",
                          noPdf && "hidden",
                        )}
                      >
                        {VERDICT_OPTIONS.map((opt) => {
                          const isActive = judgments.get(d.id) === opt.value;
                          const label = t(`verdict.${opt.value}`);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                handleJudge(
                                  d.id,
                                  d.rule_id,
                                  isActive ? null : opt.value,
                                )
                              }
                              title={
                                isActive
                                  ? t("clickToCancel")
                                  : t("markAs", { label })
                              }
                              className={cn(
                                "rounded px-2 py-0.5 text-[11px] font-medium transition-all hover:opacity-90",
                                isActive
                                  ? opt.active
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export function KGFlow({
  result,
  noPdf = false,
}: {
  result: AnalysisResult;
  // Draft mode: there's no source PDF (or human-as-judge), so hide locate-in-PDF
  // buttons, page references and the judgment UI — everything else is identical.
  noPdf?: boolean;
}) {
  const t = useTranslations("kgFlow");
  const [layer, setLayer] = useState<"entity" | "fru">("entity");
  const [pdf, setPdf] = useState<PdfPreview | null>(null);

  const eduMap = useMemo(
    () => new Map(result.graph.edus.map((e) => [e.id, e])),
    [result],
  );

  const openPdf = useCallback<OpenPdf>(
    (eduIds, focusId) => {
      const highlights: PdfHighlight[] = eduIds
        .map((id) => eduMap.get(id))
        .filter((e): e is EDU => Boolean(e))
        .map((e) => ({
          edu_id: e.id,
          page: e.page,
          bbox: e.bbox,
          severity: "low" as const,
        }));
      const focus = eduMap.get(focusId);
      setPdf({
        focusEduId: focusId,
        highlights,
        section: focus?.section ?? "",
        page: focus?.page ?? 0,
      });
    },
    [eduMap],
  );

  const stats = {
    entity: result.graph.entities.length,
    er: result.graph.er_triples.length,
    fru: result.graph.fru_nodes.length,
    rst: result.graph.rst_nodes.length,
    edu: result.graph.edus.length,
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={layer}
          onValueChange={(v) => setLayer(v as "entity" | "fru")}
        >
          <TabsList>
            <TabsTrigger value="entity">
              {t("entityLayer")}{" "}
              <Badge variant="secondary" className="ml-1.5">
                {stats.entity}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="fru">
              {t("fruLayer")}{" "}
              <Badge variant="secondary" className="ml-1.5">
                {stats.fru}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          ER {stats.er} · RST {stats.rst} · EDU {stats.edu}
        </p>
      </div>

      <Card className="flex-1 overflow-hidden p-0">
        <CardContent className="h-full p-0">
          <Tabs
            value={layer}
            onValueChange={(v) => setLayer(v as "entity" | "fru")}
            className="h-full"
          >
            <TabsContent value="entity" className="h-full m-0">
              <EntityLayer result={result} onOpenPdf={openPdf} noPdf={noPdf} />
            </TabsContent>
            <TabsContent value="fru" className="h-full m-0">
              <FruLayer result={result} onOpenPdf={openPdf} noPdf={noPdf} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet open={!!pdf} onOpenChange={(o) => !o && setPdf(null)}>
        <SheetContent
          side="right"
          className="flex flex-col gap-0 p-0 data-[side=right]:w-[92vw] data-[side=right]:sm:max-w-[820px]"
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t("sourceLocate")}</SheetTitle>
            <SheetDescription>
              {pdf
                ? pdf.section
                  ? t("sectionPage", {
                      section: pdf.section,
                      page: pdf.page + 1,
                    })
                  : t("pageOnly", { page: pdf.page + 1 })
                : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 p-3">
            {pdf && (
              <PdfViewer
                pdfUrl={pdfUrl(result.paper_id)}
                highlights={pdf.highlights}
                focusedEduId={pdf.focusEduId}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
