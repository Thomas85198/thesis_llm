"""Neo4j layer: write PaperGraph, run Cypher rule queries."""

from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

from neo4j import Driver, GraphDatabase
from neo4j.exceptions import TransientError

from .schemas import PaperGraph

_driver: Driver | None = None
_driver_lock = threading.Lock()


def driver() -> Driver:
    # Double-checked locking so concurrent rule-check threads can't each build a
    # separate driver during cold init. Steady state is a lockless read.
    global _driver
    if _driver is None:
        with _driver_lock:
            if _driver is None:
                _driver = GraphDatabase.driver(
                    os.getenv("NEO4J_URI", "bolt://localhost:7687"),
                    auth=(
                        os.getenv("NEO4J_USER", "neo4j"),
                        os.getenv("NEO4J_PASSWORD", "thesis_demo_pw"),
                    ),
                )
    return _driver


def close() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


@contextmanager
def session() -> Iterator[Any]:
    s = driver().session()
    try:
        yield s
    finally:
        s.close()


SCHEMA_CYPHER = [
    "CREATE CONSTRAINT paper_id IF NOT EXISTS FOR (p:Paper) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT edu_id IF NOT EXISTS FOR (e:EDU) REQUIRE e.id IS UNIQUE",
    "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT fru_id IF NOT EXISTS FOR (f:FRU) REQUIRE f.id IS UNIQUE",
    "CREATE CONSTRAINT rst_id IF NOT EXISTS FOR (r:RST) REQUIRE r.id IS UNIQUE",
    # clear_paper / fetch_graph_for_viz filter by paper_id — without these every
    # call is an AllNodesScan once the DB holds more than a few papers.
    "CREATE INDEX edu_paper IF NOT EXISTS FOR (e:EDU) ON (e.paper_id)",
    "CREATE INDEX entity_paper IF NOT EXISTS FOR (n:Entity) ON (n.paper_id)",
    "CREATE INDEX fru_paper IF NOT EXISTS FOR (f:FRU) ON (f.paper_id)",
    "CREATE INDEX rst_paper IF NOT EXISTS FOR (r:RST) ON (r.paper_id)",
    "CREATE INDEX paper_paper IF NOT EXISTS FOR (p:Paper) ON (p.paper_id)",
]


def init_schema() -> None:
    with session() as s:
        for q in SCHEMA_CYPHER:
            s.run(q)


def clear_paper(paper_id: str) -> None:
    with session() as s:
        s.run(
            """
            MATCH (n) WHERE n.paper_id = $pid DETACH DELETE n
            """,
            pid=paper_id,
        )
        # Paper nodes written before paper_id was mirrored onto them (see
        # _write_tx) are missed by the sweep above — delete by id as well.
        s.run("MATCH (p:Paper {id:$pid}) DETACH DELETE p", pid=paper_id)


def write_graph(graph: PaperGraph) -> None:
    init_schema()
    # Fresh deployments hit a TransientError on the first write while the
    # constraints above are still warming up — one retry absorbs it instead of
    # failing the whole job and forcing a manual re-upload.
    try:
        with session() as s:
            s.execute_write(_write_tx, graph)
    except TransientError:
        time.sleep(2)
        with session() as s:
            s.execute_write(_write_tx, graph)


def paper_exists(paper_id: str) -> bool:
    """Whether the paper's graph is actually present (cache hits must check —
    SQLite can outlive the Neo4j volume)."""
    with session() as s:
        rec = s.run(
            "MATCH (p:Paper {id:$pid})-[:HAS_EDU]->(:EDU) RETURN count(*) AS c LIMIT 1",
            pid=paper_id,
        ).single()
        return bool(rec and rec["c"] > 0)


def _write_tx(tx: Any, g: PaperGraph) -> None:
    tx.run(
        # paper_id mirrors id so clear_paper's `WHERE n.paper_id = $pid` sweep
        # also removes the Paper node itself (it used to leave an orphan).
        "MERGE (p:Paper {id:$id}) SET p.title=$title, p.paper_id=$id",
        id=g.paper_id,
        title=g.title,
    )
    for e in g.edus:
        tx.run(
            """
            MERGE (n:EDU {id:$id})
            SET n.text=$text, n.section=$section, n.order=$order,
                n.page=$page, n.bbox=$bbox, n.paper_id=$pid
            WITH n
            MATCH (p:Paper {id:$pid})
            MERGE (p)-[:HAS_EDU]->(n)
            """,
            id=e.id,
            text=e.text,
            section=e.section,
            order=e.order,
            page=e.page,
            bbox=e.bbox,
            pid=g.paper_id,
        )
    for ent in g.entities:
        tx.run(
            """
            MERGE (n:Entity {id:$id})
            SET n.name=$name, n.type=$type, n.paper_id=$pid
            """,
            id=ent.id,
            name=ent.name,
            type=ent.type,
            pid=g.paper_id,
        )
    for tr in g.er_triples:
        tx.run(
            """
            MATCH (s:Entity {id:$src}), (t:Entity {id:$tgt}), (e:EDU {id:$evid})
            MERGE (s)-[r:ER {id:$id}]->(t)
            SET r.predicate=$pred, r.evidence_edu_id=$evid, r.paper_id=$pid
            MERGE (s)-[:MENTIONED_IN]->(e)
            MERGE (t)-[:MENTIONED_IN]->(e)
            """,
            id=tr.id,
            src=tr.source_entity_id,
            tgt=tr.target_entity_id,
            pred=tr.predicate,
            evid=tr.evidence_edu_id,
            pid=g.paper_id,
        )
    for fru in g.fru_nodes:
        tx.run(
            """
            MERGE (f:FRU {id:$id})
            SET f.function=$fn, f.summary=$sm, f.paper_id=$pid
            """,
            id=fru.id,
            fn=fru.function,
            sm=fru.summary,
            pid=g.paper_id,
        )
        for eid in fru.edu_ids:
            tx.run(
                """
                MATCH (f:FRU {id:$fid}), (e:EDU {id:$eid})
                MERGE (f)-[:COVERS]->(e)
                """,
                fid=fru.id,
                eid=eid,
            )
    for rst in g.rst_nodes:
        tx.run(
            """
            MERGE (r:RST {id:$id})
            SET r.rst_type=$tp, r.paper_id=$pid
            WITH r
            MATCH (n:EDU {id:$nuc})
            MERGE (r)-[:NUCLEUS]->(n)
            """,
            id=rst.id,
            tp=rst.rst_type,
            pid=g.paper_id,
            nuc=rst.nucleus_edu_id,
        )
        for sid in rst.satellite_edu_ids:
            tx.run(
                """
                MATCH (r:RST {id:$rid}), (e:EDU {id:$sid})
                MERGE (r)-[:SATELLITE]->(e)
                """,
                rid=rst.id,
                sid=sid,
            )


def run_cypher(query: str, **params: Any) -> list[dict[str, Any]]:
    with session() as s:
        return [r.data() for r in s.run(query, **params)]


def resolve_evidence_to_edus(ids: list[str]) -> list[str]:
    """Map a mix of EDU / FRU node ids to concrete EDU ids.

    Rule candidate subgraphs are FRU-based, so the checker LLM often cites FRU
    node ids as evidence. Those don't resolve to a PDF location. Expand each FRU
    id to the EDU ids it COVERS; pass through ids that are already EDUs; drop
    anything that matches neither. Order-preserving, de-duplicated.
    """
    if not ids:
        return []
    rows = run_cypher(
        """
        UNWIND $ids AS cid
        OPTIONAL MATCH (e:EDU {id: cid})
        OPTIONAL MATCH (:FRU {id: cid})-[:COVERS]->(fe:EDU)
        WITH cid, e, collect(DISTINCT fe.id) AS fru_edus
        RETURN cid AS cid,
               CASE WHEN e IS NOT NULL THEN [cid] ELSE fru_edus END AS edu_ids
        """,
        ids=ids,
    )
    out: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for eid in r["edu_ids"]:
            if eid and eid not in seen:
                seen.add(eid)
                out.append(eid)
    return out


def fetch_graph_for_viz(paper_id: str) -> dict[str, Any]:
    """Return nodes + edges for the frontend visualization."""
    nodes = run_cypher(
        """
        MATCH (n) WHERE n.paper_id = $pid
        RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props
        """,
        pid=paper_id,
    )
    edges = run_cypher(
        """
        MATCH (a)-[r]->(b) WHERE a.paper_id = $pid AND b.paper_id = $pid
        RETURN id(a) AS source, id(b) AS target, type(r) AS type, properties(r) AS props
        """,
        pid=paper_id,
    )
    return {"nodes": nodes, "edges": edges}
