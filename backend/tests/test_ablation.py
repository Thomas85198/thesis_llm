"""Ablation harness 的純邏輯測試：mock LLM/judge，不碰網路/DB/neo4j。"""

from __future__ import annotations

from experiments import arms, judge, metrics


# --- arms ---------------------------------------------------------------

_GRAPH = {
    "edus": [
        {"id": "e1", "text": "我們提出一個新方法。", "section": "Introduction"},
        {"id": "e2", "text": "實驗顯示準確率提升。", "section": "Results"},
    ],
    "fru_nodes": [
        {"id": "f1", "function": "Claim", "edu_ids": ["e1"], "summary": "提出新方法"}
    ],
    "entities": [{"id": "n1", "name": "新方法"}, {"id": "n2", "name": "準確率"}],
    "er_triples": [
        {"source_entity_id": "n1", "target_entity_id": "n2", "predicate": "improves"}
    ],
}


def test_run_arm_b_normalizes_defects():
    defects = [
        {
            "rule_id": "REL-01",
            "defect_type": "NakedClaim",
            "severity": "high",
            "section": "Introduction",
            "evidence_edu_ids": ["e1"],
            "description": {"zh-Hant": "主張缺證據", "en": "naked claim"},
            "suggestion": {"zh-Hant": "補上數據"},
        }
    ]
    out = arms.run_arm_b(_GRAPH, defects)
    assert len(out) == 1
    f = out[0]
    assert f["issue_type"] == "NakedClaim"
    assert f["severity"] == "high"
    assert f["description"] == "主張缺證據"  # 取 zh-Hant
    assert f["suggestion"] == "補上數據"
    assert "我們提出一個新方法" in f["location"]  # evidence EDU 文字帶入


def test_structure_dump_contains_sections_and_relations():
    dump = arms._structure_dump(_GRAPH)
    assert "Introduction" in dump
    assert "Claim" in dump
    assert "新方法 --improves--> 準確率" in dump


def test_run_arm_a_calls_llm(monkeypatch):
    captured = {}

    def fake_call(**kwargs):
        captured.update(kwargs)
        return {
            "defects": [
                {
                    "location": "L",
                    "issue_type": "x",
                    "severity": "low",
                    "description": "d",
                    "suggestion": "s",
                }
            ]
        }

    monkeypatch.setattr(arms.llm, "call_with_tool", fake_call)

    class Item:
        paper_id = "paper:test"

    out = arms.run_arm_a(Item(), _GRAPH)
    assert out and out[0]["issue_type"] == "x"
    assert captured["stage"] == "ablation:arm_a"
    assert "我們提出一個新方法" in captured["user_content"]  # 全文拼接送進去


# --- judge --------------------------------------------------------------


def test_parse_verdict_json():
    assert judge._parse_verdict('{"winner":"X","reason":"r"}')["winner"] == "X"
    assert judge._parse_verdict('亂講 {"winner": "tie"} 後綴')["winner"] == "tie"
    assert judge._parse_verdict("完全不是 json")["winner"] == "tie"


def test_judge_pair_swap_consistent(monkeypatch):
    # 兩次擺位都判「實際內容較好的那套」勝 → swap 一致、判該 arm 勝。
    # run1: X=B,Y=A → 評審選 X(=B)；run2: X=A,Y=B → 評審選 Y(=B)
    calls = iter([{"winner": "X", "reason": ""}, {"winner": "Y", "reason": ""}])
    monkeypatch.setattr(judge, "_one_comparison", lambda *a, **k: next(calls))
    r = judge.judge_pair("m", "paper", "B", [{"x": 1}], "A", [])
    assert r["winner"] == "B"
    assert r["swap_consistent"] is True


def test_judge_pair_position_bias_becomes_tie(monkeypatch):
    # 兩次都選 X（位置偏好）→ 還原成不同 arm → 判 tie。
    monkeypatch.setattr(
        judge, "_one_comparison", lambda *a, **k: {"winner": "X", "reason": ""}
    )
    r = judge.judge_pair("m", "paper", "B", [], "A", [])
    assert r["winner"] == "tie"
    assert r["swap_consistent"] is False


# --- metrics ------------------------------------------------------------


def test_winrate_and_alpha():
    pairs = [
        {
            "model": "m",
            "arm1": "B",
            "arm2": "A",
            "winner": "B",
            "swap_consistent": True,
            "paper_id": "p1",
        },
        {
            "model": "m",
            "arm1": "B",
            "arm2": "A",
            "winner": "tie",
            "swap_consistent": False,
            "paper_id": "p2",
        },
    ]
    wr = metrics.winrate(pairs)["m|B-A"]
    assert wr["arm1_wins"] == 1 and wr["ties"] == 1
    assert wr["swap_consistent_rate"] == 0.5
    assert metrics.krippendorff_alpha_nominal([["B", "B"], ["A", "A"]]) == 1.0


def test_consistency():
    c = metrics.consistency(
        [[{"issue_type": "x"}, {"issue_type": "y"}], [{"issue_type": "x"}]]
    )
    assert c["count_mean"] == 1.5
    assert c["issue_jaccard_mean"] == 0.5
