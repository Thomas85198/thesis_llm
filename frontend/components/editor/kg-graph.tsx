"use client";
// Lightweight knowledge-graph view for a draft: the Entity layer (concepts) and
// their ER relations, laid out left-to-right with dagre and rendered with React
// Flow. Deliberately not the full paper KGFlow — no PDF / judgments / page refs,
// which don't exist for an in-progress draft.
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";

import type { DraftGraph } from "@/lib/api";
import { layoutDagre } from "@/lib/kg-layout";

export default function KGGraph({ graph }: { graph: DraftGraph }) {
  const { nodes, edges, empty } = useMemo(() => {
    const entities = graph.nodes.filter((n) => n.labels.includes("Entity"));
    const ids = new Set(entities.map((e) => e.id));
    const er = graph.edges.filter(
      (e) => e.type === "ER" && ids.has(e.source) && ids.has(e.target),
    );
    if (entities.length === 0)
      return { nodes: [] as Node[], edges: [] as Edge[], empty: true };

    const pos = layoutDagre(
      entities.map((e) => ({ id: String(e.id), width: 160, height: 40 })),
      er.map((e) => ({ source: String(e.source), target: String(e.target) })),
      { rankdir: "LR", nodesep: 28, ranksep: 90 },
    );
    const nodes: Node[] = entities.map((e) => {
      const p = pos.get(String(e.id));
      const kind = String(e.props.type ?? "");
      return {
        id: String(e.id),
        position: { x: p?.x ?? 0, y: p?.y ?? 0 },
        data: { label: String(e.props.name ?? "?") },
        type: "default",
        style: {
          fontSize: 12,
          padding: "4px 8px",
          borderRadius: 8,
          border: "1px solid hsl(var(--border, 220 13% 80%))",
          background: "hsl(var(--card, 0 0% 100%))",
          width: 160,
        },
        title: kind,
      } as Node;
    });
    const edges: Edge[] = er.map((e, i) => ({
      id: `er-${i}`,
      source: String(e.source),
      target: String(e.target),
      label: String(e.props.predicate ?? ""),
      labelStyle: { fontSize: 10, fill: "#888" },
      style: { stroke: "#9ca3af" },
      animated: false,
    }));
    return { nodes, edges, empty: false };
  }, [graph]);

  if (empty)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        （此草稿尚未萃取到概念節點）
      </div>
    );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
