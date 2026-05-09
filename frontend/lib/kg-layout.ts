import * as dagre from "@dagrejs/dagre";

export type LayoutNode = {
  id: string;
  width?: number;
  height?: number;
};

export type LayoutEdge = { source: string; target: string };

export type Positioned = { id: string; x: number; y: number };

export function layoutDagre(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: { rankdir?: "LR" | "TB"; nodesep?: number; ranksep?: number } = {}
): Map<string, { x: number; y: number; w: number; h: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: opts.rankdir ?? "LR",
    nodesep: opts.nodesep ?? 40,
    ranksep: opts.ranksep ?? 80,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: n.width ?? 180, height: n.height ?? 48 });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const id of g.nodes()) {
    const n = g.node(id);
    out.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height });
  }
  return out;
}
