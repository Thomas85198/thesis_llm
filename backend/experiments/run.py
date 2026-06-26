"""Ablation 主入口：對語料跑三 arm、雙 judge pairwise 盲評、self-consistency，存 JSON。

用法（從 backend/ 目錄）：
  .venv/bin/python -m experiments.run --papers 1 --consistency-n 2      # 先跑通
  .venv/bin/python -m experiments.run                                   # 全語料、預設設定
  .venv/bin/python -m experiments.run --papers paper:4a4686e6 --fresh   # 指定篇、重跑 pipeline

輸出：experiments/out/ablation_<timestamp>.json（report.py 讀它產報表）。
"""

from __future__ import annotations

import argparse
import itertools
import json
from datetime import datetime, timezone
from pathlib import Path

from . import arms, corpus, judge, metrics

_OUT = Path(__file__).resolve().parent / "out"
_ARM_ORDER = ["A", "C", "B"]  # 配對與顯示的固定順序


def _select(args) -> list[corpus.CorpusItem]:
    items = corpus.list_corpus()
    if args.papers and not args.papers.isdigit():
        wanted = set(args.papers.split(","))
        items = [it for it in items if it.paper_id in wanted]
    elif args.papers:
        items = items[: int(args.papers)]
    if args.fresh:
        items = [it for it in items if it.can_fresh]
    return items


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Run ablation A/C/B + dual-judge pairwise."
    )
    ap.add_argument("--papers", help="篇數（數字）或逗號分隔 paper_id；省略=全部")
    ap.add_argument(
        "--arms", default="A,C,B", help="要跑的 arm，逗號分隔（預設 A,C,B）"
    )
    ap.add_argument(
        "--consistency-n",
        type=int,
        default=1,
        help="self-consistency 重跑次數（含首跑）",
    )
    ap.add_argument(
        "--consistency-arm", default="C", help="對哪個 arm 量一致性（預設 C）"
    )
    ap.add_argument(
        "--fresh",
        action="store_true",
        help="從 PDF 重跑 pipeline（需 neo4j、有 PDF 的篇）",
    )
    ap.add_argument("--out", help="輸出 JSON 路徑（預設 out/ablation_<ts>.json）")
    args = ap.parse_args()

    arm_list = tuple(a for a in _ARM_ORDER if a in args.arms.split(","))
    items = _select(args)
    if not items:
        print("沒有符合條件的語料。")
        return

    judges = [m for m in (judge.JUDGE_PRIMARY, judge.JUDGE_SECONDARY) if judge.ping(m)]
    if not judges:
        print(
            "⚠ 沒有可用的 judge 模型（ollama 未起？glm-5.2:cloud 需先 `ollama signin`）。"
        )
        print("  仍會跑三 arm 並存輸出，但沒有 pairwise 評比。")

    print(
        f"語料 {len(items)} 篇；arm={arm_list}；judges={judges or '（無）'}；fresh={args.fresh}"
    )

    papers_out = []
    for idx, item in enumerate(items, 1):
        print(f"\n[{idx}/{len(items)}] {item.paper_id} {item.label}")
        graph, b_defects = arms.materialize(item, args.fresh)

        arm_findings: dict[str, list[dict]] = {}
        if "A" in arm_list:
            arm_findings["A"] = arms.run_arm_a(item, graph)
        if "C" in arm_list:
            arm_findings["C"] = arms.run_arm_c(item, graph)
        if "B" in arm_list:
            arm_findings["B"] = arms.run_arm_b(graph, b_defects)
        for a in arm_list:
            print(f"  arm {a}: {len(arm_findings[a])} findings")

        pairs = []
        for a1, a2 in itertools.combinations(arm_list, 2):
            for jm in judges:
                pr = judge.judge_pair(
                    jm, item.label, a1, arm_findings[a1], a2, arm_findings[a2]
                )
                pr["paper_id"] = item.paper_id
                pairs.append(pr)
                print(
                    f"  judge {jm} {a1} vs {a2} → {pr['winner']} (swap_consistent={pr['swap_consistent']})"
                )

        cons = None
        ca = args.consistency_arm
        if args.consistency_n > 1 and ca in arm_list:
            runs = [arm_findings[ca]]
            runner = {"A": arms.run_arm_a, "C": arms.run_arm_c}.get(ca)
            if runner is None:
                print(f"  ⚠ arm {ca} 無法重跑（B 是 cache 固定），跳過一致性。")
            else:
                for _ in range(args.consistency_n - 1):
                    runs.append(runner(item, graph))
                cons = metrics.consistency(runs)
                print(f"  consistency(arm {ca}, n={args.consistency_n}): {cons}")

        papers_out.append(
            {
                "paper_id": item.paper_id,
                "label": item.label,
                "db": item.db_path.name,
                "arms": arm_findings,
                "pairs": pairs,
                "consistency": cons,
            }
        )

    all_pairs = [p for po in papers_out for p in po["pairs"]]
    result = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "n_papers": len(items),
            "arms": list(arm_list),
            "judges": judges,
            "fresh": args.fresh,
            "consistency_n": args.consistency_n,
            "consistency_arm": args.consistency_arm,
        },
        "papers": papers_out,
        "winrate": metrics.winrate(all_pairs),
        "judge_agreement": metrics.judge_agreement(all_pairs),
    }

    _OUT.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = Path(args.out) if args.out else _OUT / f"ablation_{ts}.json"
    out_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n✓ 已寫出 {out_path}")
    print("  下一步：.venv/bin/python -m experiments.report", out_path)


if __name__ == "__main__":
    main()
