"""Cross-section entity dedup (pipeline._dedupe_entities).

extract_er only dedupes names within one section; the merge across sections
happens at graph assembly. These tests pin the merge key (case-insensitive,
whitespace-collapsed) and the triple id remapping that keeps ER/MENTIONED_IN
edges pointing at the surviving node.
"""

from __future__ import annotations

from app.pipeline import _dedupe_entities
from app.schemas import Entity, ERTriple


def _ent(eid: str, name: str, etype: str = "Method") -> Entity:
    return Entity(id=eid, name=name, type=etype)


def _tri(tid: str, src: str, tgt: str) -> ERTriple:
    return ERTriple(
        id=tid,
        source_entity_id=src,
        target_entity_id=tgt,
        predicate="uses",
        evidence_edu_id="p:Intro:edu:0",
    )


def test_same_name_across_sections_merges_to_first():
    ents = [_ent("e1", "Transformer"), _ent("e2", "Transformer")]
    triples = [_tri("t1", "e2", "e2")]

    out_ents, out_triples = _dedupe_entities(ents, triples)

    assert [e.id for e in out_ents] == ["e1"]
    assert out_triples[0].source_entity_id == "e1"
    assert out_triples[0].target_entity_id == "e1"


def test_merge_is_case_insensitive_and_whitespace_collapsed():
    ents = [
        _ent("e1", "Beam Search"),
        _ent("e2", "beam  search"),
        _ent("e3", " BEAM SEARCH "),
    ]

    out_ents, _ = _dedupe_entities(ents, [])

    assert [e.id for e in out_ents] == ["e1"]
    assert out_ents[0].name == "Beam Search"  # first occurrence keeps its casing


def test_distinct_names_untouched():
    ents = [_ent("e1", "BLEU", "Metric"), _ent("e2", "ROUGE", "Metric")]
    triples = [_tri("t1", "e1", "e2")]

    out_ents, out_triples = _dedupe_entities(ents, triples)

    assert len(out_ents) == 2
    assert out_triples == triples  # no remap → same objects pass through


def test_type_conflict_first_wins():
    ents = [_ent("e1", "Attention", "Concept"), _ent("e2", "Attention", "Method")]

    out_ents, _ = _dedupe_entities(ents, [])

    assert out_ents[0].type == "Concept"


def test_unrelated_triple_ids_preserved():
    ents = [_ent("e1", "A"), _ent("e2", "a"), _ent("e3", "B")]
    triples = [_tri("t1", "e2", "e3")]

    _, out_triples = _dedupe_entities(ents, triples)

    assert out_triples[0].id == "t1"
    assert out_triples[0].source_entity_id == "e1"
    assert out_triples[0].target_entity_id == "e3"
