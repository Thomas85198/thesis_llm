"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { layoutDagre } from "@/lib/kg-layout";
import type { AnalysisResult } from "@/lib/api";

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

function buildEntityGraph(result: AnalysisResult): { nodes: Node[]; edges: Edge[] } {
  const layout = layoutDagre(
    result.graph.entities.map((e) => ({ id: e.id, width: 160, height: 40 })),
    result.graph.er_triples.map((t) => ({
      source: t.source_entity_id,
      target: t.target_entity_id,
    })),
    { rankdir: "LR", nodesep: 30, ranksep: 100 }
  );

  const nodes: Node[] = result.graph.entities.map((e) => {
    const pos = layout.get(e.id) ?? { x: 0, y: 0, w: 160, h: 40 };
    return {
      id: e.id,
      position: { x: pos.x, y: pos.y },
      data: { label: e.name, sublabel: e.type },
      style: {
        background: ENTITY_COLORS[e.type] ?? ENTITY_COLORS.Other,
        color: "#0f172a",
        border: "1px solid rgba(0,0,0,0.10)",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        width: 160,
        textAlign: "center" as const,
      },
    };
  });

  const edges: Edge[] = result.graph.er_triples.map((t) => ({
    id: t.id,
    source: t.source_entity_id,
    target: t.target_entity_id,
    label: t.predicate,
    labelStyle: { fontSize: 10, fill: "#475569" },
    style: { stroke: "#94a3b8", strokeWidth: 1 },
    markerEnd: { type: "arrowclosed" as const, color: "#94a3b8" },
  }));

  return { nodes, edges };
}

function buildFruGraph(result: AnalysisResult): { nodes: Node[]; edges: Edge[] } {
  // Sort FRUs by first EDU's order to chain them sequentially.
  const eduOrder = new Map(
    result.graph.edus.map((e) => [e.id, e.order + e.section.length * 1000])
  );
  const sorted = [...result.graph.fru_nodes].sort((a, b) => {
    const ao = a.edu_ids.length > 0 ? (eduOrder.get(a.edu_ids[0]) ?? 0) : 0;
    const bo = b.edu_ids.length > 0 ? (eduOrder.get(b.edu_ids[0]) ?? 0) : 0;
    return ao - bo;
  });

  const layoutEdges = sorted
    .slice(0, -1)
    .map((f, i) => ({ source: f.id, target: sorted[i + 1].id }));

  const layout = layoutDagre(
    sorted.map((f) => ({ id: f.id, width: 200, height: 60 })),
    layoutEdges,
    { rankdir: "TB", nodesep: 12, ranksep: 36 }
  );

  const nodes: Node[] = sorted.map((f) => {
    const pos = layout.get(f.id) ?? { x: 0, y: 0, w: 200, h: 60 };
    return {
      id: f.id,
      position: { x: pos.x, y: pos.y },
      data: {
        label: (
          <div className="text-left">
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {f.function}
            </div>
            <div className="line-clamp-2 text-[11px] leading-tight">
              {f.summary || "(no summary)"}
            </div>
          </div>
        ),
      },
      style: {
        background: FRU_COLORS[f.function] ?? FRU_COLORS.Other,
        color: "#0f172a",
        border: "1px solid rgba(0,0,0,0.10)",
        borderRadius: 8,
        padding: "6px 10px",
        width: 200,
      },
    };
  });

  const edges: Edge[] = layoutEdges.map((e, i) => ({
    id: `fru-seq-${i}`,
    source: e.source,
    target: e.target,
    style: { stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "4 4" },
  }));

  return { nodes, edges };
}

export function KGFlow({ result }: { result: AnalysisResult }) {
  const [layer, setLayer] = useState<"entity" | "fru">("entity");

  const entityGraph = useMemo(() => buildEntityGraph(result), [result]);
  const fruGraph = useMemo(() => buildFruGraph(result), [result]);

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
        <Tabs value={layer} onValueChange={(v) => setLayer(v as "entity" | "fru")}>
          <TabsList>
            <TabsTrigger value="entity">
              Entity 層 <Badge variant="secondary" className="ml-1.5">{stats.entity}</Badge>
            </TabsTrigger>
            <TabsTrigger value="fru">
              FRU 層 <Badge variant="secondary" className="ml-1.5">{stats.fru}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          ER {stats.er} · RST {stats.rst} · EDU {stats.edu}
        </p>
      </div>

      <Card className="flex-1 overflow-hidden p-0">
        <CardContent className="h-full p-0">
          <Tabs value={layer} onValueChange={(v) => setLayer(v as "entity" | "fru")} className="h-full">
            <TabsContent value="entity" className="h-full m-0">
              <ReactFlow
                nodes={entityGraph.nodes}
                edges={entityGraph.edges}
                fitView
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} size={1} />
                <Controls position="bottom-right" />
                <MiniMap pannable zoomable position="bottom-left" />
              </ReactFlow>
            </TabsContent>
            <TabsContent value="fru" className="h-full m-0">
              <ReactFlow
                nodes={fruGraph.nodes}
                edges={fruGraph.edges}
                fitView
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} size={1} />
                <Controls position="bottom-right" />
                <MiniMap pannable zoomable position="bottom-left" />
              </ReactFlow>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {layer === "entity"
          ? Object.entries(ENTITY_COLORS).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: c }}
                />
                {k}
              </span>
            ))
          : Object.entries(FRU_COLORS).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: c }}
                />
                {k}
              </span>
            ))}
      </div>
    </div>
  );
}
