"""讀 run.py 產的 JSON，輸出 markdown 報表 + CSV + win-rate 長條圖。

用法（從 backend/）：
  .venv/bin/python -m experiments.report                       # 取 out/ 最新一份
  .venv/bin/python -m experiments.report out/ablation_x.json   # 指定
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

_OUT = Path(__file__).resolve().parent / "out"


def _latest_json() -> Path:
    files = sorted(_OUT.glob("ablation_*.json"))
    if not files:
        sys.exit("out/ 沒有 ablation_*.json，先跑 experiments.run")
    return files[-1]


def _winrate_rows(winrate: dict) -> list[dict]:
    rows = []
    for slot in winrate.values():
        rows.append(slot)
    return rows


def _md(data: dict, stem: str) -> str:
    m = data["meta"]
    lines = [
        "# Ablation 結果報表",
        "",
        f"- 產生時間：{m['generated_at']}",
        f"- 語料篇數：{m['n_papers']}（注意：實為少數 distinct 論文，多樣性有限）",
        f"- Arms：{', '.join(m['arms'])}（A=全文直接問　C=拆解無規則　B=本方法）",
        f"- Judges：{', '.join(m['judges']) or '（無，未做評比）'}",
        f"- 模式：{'fresh 重跑 pipeline' if m['fresh'] else 'cache 讀現成 result_json'}",
        "",
        "## 1. 建議品質 — pairwise win-rate（position-swap 去偏）",
        "",
        "| Judge | 對比 | n | 前者勝 | 後者勝 | 平手 | swap 一致率 |",
        "|---|---|---|---|---|---|---|",
    ]
    for slot in _winrate_rows(data["winrate"]):
        lines.append(
            f"| {slot['model']} | {slot['arm1']} vs {slot['arm2']} | {slot['n']} "
            f"| {slot['arm1_wins']} | {slot['arm2_wins']} | {slot['ties']} "
            f"| {slot['swap_consistent_rate']} |"
        )

    ja = data["judge_agreement"]
    lines += [
        "",
        "## 2. 雙 judge 一致性",
        "",
        f"- 共同評比的比較數：{ja['n_shared']}",
        f"- winner 一致率：{ja['agreement_rate']}",
        f"- Krippendorff's α (nominal)：{ja['alpha_nominal']}",
        "",
        "## 3. self-consistency（重跑穩定性）",
        "",
        "| 論文 | arm | n_runs | 缺陷數 mean±sd | CV | issue Jaccard |",
        "|---|---|---|---|---|---|",
    ]
    for po in data["papers"]:
        c = po.get("consistency")
        if c:
            lines.append(
                f"| {po['label'][:30]} | {m['consistency_arm']} | {c['n_runs']} "
                f"| {c['count_mean']}±{c['count_sd']} | {c['count_cv']} "
                f"| {c['issue_jaccard_mean']} |"
            )
    if not any(po.get("consistency") for po in data["papers"]):
        lines.append("| （未跑，--consistency-n=1）| | | | | |")

    lines += [
        "",
        "## 4. 各篇缺陷數概覽",
        "",
        "| 論文 | " + " | ".join(f"arm {a}" for a in m["arms"]) + " |",
        "|---|" + "---|" * len(m["arms"]),
    ]
    for po in data["papers"]:
        cells = " | ".join(str(len(po["arms"].get(a, []))) for a in m["arms"])
        lines.append(f"| {po['label'][:30]} | {cells} |")

    lines += [
        "",
        "## 方法學限制（誠實標注）",
        "",
        "- **語料少**：僅少數 distinct 論文，結論只能看趨勢、不可外推；放大需補同領域語料。",
        "- **issue Jaccard 偏保守**：issue_type 是 LLM 自由生成文字，字面差異會壓低 Jaccard，僅供參考。",
        "- **cache 模式**：Arm B 用歷史 result_json，與 A/C 當前模型可能非同版；嚴格對照請用 `--fresh`。",
        "- **judge 非完美**：LLM-as-judge 有自身偏好，故用雙 judge + position-swap 去偏，並報一致性。",
    ]
    return "\n".join(lines)


def _csv(data: dict, path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "model",
                "arm1",
                "arm2",
                "n",
                "arm1_wins",
                "arm2_wins",
                "ties",
                "swap_consistent_rate",
            ]
        )
        for slot in _winrate_rows(data["winrate"]):
            w.writerow(
                [
                    slot["model"],
                    slot["arm1"],
                    slot["arm2"],
                    slot["n"],
                    slot["arm1_wins"],
                    slot["arm2_wins"],
                    slot["ties"],
                    slot["swap_consistent_rate"],
                ]
            )


def _chart(data: dict, path: Path) -> bool:
    rows = _winrate_rows(data["winrate"])
    if not rows:
        return False
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("（matplotlib 未裝，跳過圖表）")
        return False

    plt.rcParams["font.sans-serif"] = ["PingFang HK", "Arial Unicode MS", "Heiti TC"]
    plt.rcParams["axes.unicode_minus"] = False

    labels = [f"{r['model'].split(':')[0]}\n{r['arm1']}v{r['arm2']}" for r in rows]
    a1 = [r["arm1_wins"] for r in rows]
    tie = [r["ties"] for r in rows]
    a2 = [r["arm2_wins"] for r in rows]
    import numpy as np

    x = np.arange(len(rows))
    fig, ax = plt.subplots(figsize=(max(6, len(rows) * 1.3), 4.4))
    ax.bar(x, a1, label="前者勝", color="#5bc0de")
    ax.bar(x, tie, bottom=a1, label="平手", color="#cccccc")
    ax.bar(
        x, a2, bottom=[i + j for i, j in zip(a1, tie)], label="後者勝", color="#d9534f"
    )
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("比較次數")
    ax.set_title("Pairwise win-rate（A=全文 C=拆解 B=本方法）")
    ax.legend()
    fig.savefig(path, bbox_inches="tight", dpi=140)
    plt.close(fig)
    return True


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else _latest_json()
    data = json.loads(src.read_text(encoding="utf-8"))
    stem = src.stem

    md_path = _OUT / f"{stem}.md"
    md_path.write_text(_md(data, stem), encoding="utf-8")
    print(f"✓ markdown → {md_path}")

    csv_path = _OUT / f"{stem}_winrate.csv"
    _csv(data, csv_path)
    print(f"✓ csv → {csv_path}")

    png_path = _OUT / f"{stem}_winrate.png"
    if _chart(data, png_path):
        print(f"✓ chart → {png_path}")


if __name__ == "__main__":
    main()
