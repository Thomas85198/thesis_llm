"""Ablation 的統計：win-rate 彙整、雙 judge 一致性、self-consistency。

不依賴 scipy/sklearn——nominal Krippendorff's α 自己實作（~40 行標準公式）。
"""

from __future__ import annotations

import itertools
from collections import defaultdict
from statistics import mean, pstdev


def winrate(pairs: list[dict]) -> dict[str, dict]:
    """彙整 judge_pair 結果。

    key = "model|arm1-arm2"，value = {arm1, arm2, n, arm1_wins, arm2_wins, ties,
    swap_consistent_rate}。arm1/arm2 順序以第一次出現為準。
    """
    agg: dict[str, dict] = {}
    for p in pairs:
        a1, a2 = p["arm1"], p["arm2"]
        key = f"{p['model']}|{a1}-{a2}"
        slot = agg.setdefault(
            key,
            {
                "model": p["model"],
                "arm1": a1,
                "arm2": a2,
                "n": 0,
                "arm1_wins": 0,
                "arm2_wins": 0,
                "ties": 0,
                "swap_consistent": 0,
            },
        )
        slot["n"] += 1
        slot["swap_consistent"] += int(p.get("swap_consistent", False))
        if p["winner"] == a1:
            slot["arm1_wins"] += 1
        elif p["winner"] == a2:
            slot["arm2_wins"] += 1
        else:
            slot["ties"] += 1
    for slot in agg.values():
        n = slot["n"] or 1
        slot["swap_consistent_rate"] = round(slot["swap_consistent"] / n, 3)
    return agg


def judge_agreement(pairs: list[dict]) -> dict:
    """兩個 judge 對「同一對比較（同 paper、同 arm 對）」的 winner 是否一致。

    pairs 需含 'paper_id'。回傳 {n_shared, agreement_rate, alpha_nominal}。
    """
    by_unit: dict[tuple, dict[str, str]] = defaultdict(dict)
    for p in pairs:
        unit = (p.get("paper_id"), p["arm1"], p["arm2"])
        by_unit[unit][p["model"]] = p["winner"]

    shared = [labels for labels in by_unit.values() if len(labels) >= 2]
    if not shared:
        return {"n_shared": 0, "agreement_rate": None, "alpha_nominal": None}

    agree = sum(1 for labels in shared if len(set(labels.values())) == 1)
    units = [list(labels.values()) for labels in shared]
    return {
        "n_shared": len(shared),
        "agreement_rate": round(agree / len(shared), 3),
        "alpha_nominal": krippendorff_alpha_nominal(units),
    }


def krippendorff_alpha_nominal(units: list[list[str]]) -> float | None:
    """Nominal Krippendorff's α。units = 每個評分單位的 rater 標籤清單（可缺失）。

    α = 1 - Do/De，用 coincidence matrix 計（標準公式，nominal metric δ=1 iff c≠k）。
    回傳 None 當資料不足以計算。
    """
    coincidence: dict[tuple[str, str], float] = defaultdict(float)
    for labels in units:
        m = len(labels)
        if m < 2:
            continue
        for c, k in itertools.permutations(labels, 2):
            coincidence[(c, k)] += 1.0 / (m - 1)

    if not coincidence:
        return None
    n_c: dict[str, float] = defaultdict(float)
    for (c, _k), v in coincidence.items():
        n_c[c] += v
    n = sum(n_c.values())
    if n <= 1:
        return None

    do = sum(v for (c, k), v in coincidence.items() if c != k)
    de = sum(n_c[c] * n_c[k] for c in n_c for k in n_c if c != k) / (n - 1)
    if de == 0:
        return 1.0  # 全體一致且只有一種類別
    return round(1 - do / de, 3)


def _issue_set(findings: list[dict]) -> set[str]:
    return {
        (f.get("issue_type") or "").strip().lower()
        for f in findings
        if f.get("issue_type")
    }


def consistency(runs: list[list[dict]]) -> dict:
    """某 arm 重跑 N 次的穩定性。

    runs = N 次跑的 findings 清單。回傳缺陷數的均值/標準差/變異係數，與 issue_type
    集合的平均 pairwise Jaccard。注意：issue_type 是 LLM 自由生成文字，字面差異會壓低
    Jaccard，僅供趨勢參考（報表會標注此限制）。
    """
    counts = [len(r) for r in runs]
    sets = [_issue_set(r) for r in runs]
    jaccards = []
    for a, b in itertools.combinations(sets, 2):
        union = a | b
        jaccards.append(len(a & b) / len(union) if union else 1.0)
    avg = mean(counts) if counts else 0.0
    sd = pstdev(counts) if len(counts) > 1 else 0.0
    return {
        "n_runs": len(runs),
        "count_mean": round(avg, 2),
        "count_sd": round(sd, 2),
        "count_cv": round(sd / avg, 3) if avg else None,
        "issue_jaccard_mean": round(mean(jaccards), 3) if jaccards else None,
    }
