#!/usr/bin/env python3
"""產生 3.1.0→3.4.1 投影片用圖表。資料全部來自 docs/baselines/forensic-fatschema-baseline.md
與 memory/slimming-accuracy-baseline.md（2026-05-25 實驗實測值）。"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["PingFang HK", "Arial Unicode MS", "Heiti TC"]
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["font.size"] = 13
plt.rcParams["figure.dpi"] = 140
plt.rcParams["savefig.bbox"] = "tight"
plt.rcParams["savefig.facecolor"] = "white"

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figures")
os.makedirs(OUT, exist_ok=True)

# 配色
C_FAT = "#d9534f"      # 肥/舊 = 紅
C_SLIM = "#5cb85c"     # 瘦/新 = 綠
C_SEQ = "#d9534f"      # 序列 = 紅
C_PAR = "#5bc0de"      # 平行 = 藍
C_BLUE = "#337ab7"
C_GREY = "#aaaaaa"
C_AMBER = "#f0ad4e"


def save(fig, name):
    p = os.path.join(OUT, name)
    fig.savefig(p)
    plt.close(fig)
    print("wrote", p)


# ---------------------------------------------------------------------------
# 圖 2：平行 vs 序列 加速（同篇控制實驗，build_paper_graph）
# ---------------------------------------------------------------------------
def fig_parallel_speedup():
    fig, ax = plt.subplots(figsize=(6.2, 4.4))
    labels = ["序列\n(MAX_WORKERS=1)", "平行\n(MAX_WORKERS=6)"]
    vals = [225, 60]
    bars = ax.bar(labels, vals, color=[C_SEQ, C_PAR], width=0.55,
                  edgecolor="black", linewidth=0.6)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 4, f"{v}s",
                ha="center", va="bottom", fontsize=15, fontweight="bold")
    ax.set_ylabel("抽取耗時 build_paper_graph (秒)")
    ax.set_title("平行化加速：同一篇、同程式碼、只切 OPENAI_MAX_WORKERS", fontsize=13)
    ax.set_ylim(0, 260)
    ax.annotate("約 3.4× 加速", xy=(1, 60), xytext=(0.45, 160),
                fontsize=15, fontweight="bold", color=C_PAR,
                arrowprops=dict(arrowstyle="->", color=C_PAR, lw=2))
    ax.grid(axis="y", alpha=0.3)
    save(fig, "fig2_parallel_speedup.png")


# ---------------------------------------------------------------------------
# 圖 3：雜訊地板 — 同設定 run-to-run 變異 ≥ 平行↔序列差異
# ---------------------------------------------------------------------------
def fig_noise_floor():
    metrics = ["EDU", "Entity", "ER", "FRU", "RST"]
    par1 = [572, 172, 60, 174, 149]
    par2 = [570, 169, 74, 120, 139]
    seq1 = [564, 158, 70, 143, 142]
    seq2 = [577, 163, 66, 155, 141]
    x = np.arange(len(metrics))
    w = 0.2
    fig, ax = plt.subplots(figsize=(8.4, 4.8))
    ax.bar(x - 1.5 * w, par1, w, label="平行 run1", color=C_PAR)
    ax.bar(x - 0.5 * w, par2, w, label="平行 run2", color="#2a9fd6")
    ax.bar(x + 0.5 * w, seq1, w, label="序列 run1", color=C_SEQ)
    ax.bar(x + 1.5 * w, seq2, w, label="序列 run2", color="#a94442")
    ax.set_xticks(x)
    ax.set_xticklabels(metrics)
    ax.set_ylabel("抽取節點/關係數量")
    ax.set_title("「雜訊地板」：同一篇跑 4 次（同設定的變異 ≥ 平行 vs 序列的差異）", fontsize=12.5)
    ax.legend(ncol=4, fontsize=10, loc="upper center")
    ax.grid(axis="y", alpha=0.3)
    # FRU 標註：兩次平行就差 174↔120
    ax.annotate("同為平行，FRU 差 174 vs 120 (45%)", xy=(3.0, 174), xytext=(1.1, 430),
                fontsize=10.5, color="#b00", fontweight="bold",
                arrowprops=dict(arrowstyle="->", color="#b00", lw=1.5))
    ax.set_ylim(0, 640)
    save(fig, "fig3_noise_floor.png")


# ---------------------------------------------------------------------------
# 圖 4：規則瘦身 token 節省（NeuroSymbolic 同篇固定候選，rule_check）
# ---------------------------------------------------------------------------
def fig_slim_token_per_rule():
    rules = ["REL-02", "REL-13", "REL-06", "REL-08", "REL-01"]
    cand = [32, 35, 82, 1, 25]
    fat = [1330, 1211, 3814, 357, 2928]
    slim = [341, 371, 1967, 31, 2478]
    pct = [round((s - f) / f * 100) for f, s in zip(fat, slim)]
    x = np.arange(len(rules))
    w = 0.38
    fig, ax = plt.subplots(figsize=(8.6, 4.8))
    ax.bar(x - w / 2, fat, w, label="肥 schema", color=C_FAT, edgecolor="black", linewidth=0.4)
    ax.bar(x + w / 2, slim, w, label="瘦 schema", color=C_SLIM, edgecolor="black", linewidth=0.4)
    for i, p in enumerate(pct):
        top = max(fat[i], slim[i])
        ax.text(i, top + 60, f"{p}%", ha="center", fontsize=12, fontweight="bold",
                color="#1a7a1a" if p < -20 else "#777")
    ax.set_xticks(x)
    ax.set_xticklabels([f"{r}\n({c} 候選)" for r, c in zip(rules, cand)], fontsize=11)
    ax.set_ylabel("rule_check output token")
    ax.set_title("規則瘦身：同篇同候選逐規則 token（候選多/違規少者大勝）", fontsize=12.5)
    ax.legend(fontsize=11)
    ax.grid(axis="y", alpha=0.3)
    ax.set_ylim(0, 4300)
    save(fig, "fig4_slim_token_per_rule.png")


# ---------------------------------------------------------------------------
# 圖 4b：rule_check 總 token / 時間（剔除 REL-12 異常）
# ---------------------------------------------------------------------------
def fig_slim_totals():
    fig, axes = plt.subplots(1, 2, figsize=(9.2, 4.2))
    # token
    ax = axes[0]
    bars = ax.bar(["肥", "瘦"], [10196, 5795], color=[C_FAT, C_SLIM], width=0.55,
                  edgecolor="black", linewidth=0.5)
    for b, v in zip(bars, [10196, 5795]):
        ax.text(b.get_x() + b.get_width() / 2, v + 150, f"{v:,}", ha="center",
                fontsize=12, fontweight="bold")
    ax.set_title("rule_check 總 token  −43%", fontsize=12.5)
    ax.set_ylabel("output token")
    ax.set_ylim(0, 11500)
    ax.grid(axis="y", alpha=0.3)
    # time
    ax = axes[1]
    bars = ax.bar(["肥", "瘦"], [127, 82], color=[C_FAT, C_SLIM], width=0.55,
                  edgecolor="black", linewidth=0.5)
    for b, v in zip(bars, [127, 82]):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.5, f"{v}s", ha="center",
                fontsize=12, fontweight="bold")
    ax.set_title("rule_check 總時間  −35%", fontsize=12.5)
    ax.set_ylabel("秒")
    ax.set_ylim(0, 145)
    ax.grid(axis="y", alpha=0.3)
    fig.suptitle("規則瘦身效果（NeuroSymbolic 同篇，剔除 REL-12 退化異常）", fontsize=12.5, y=1.02)
    save(fig, "fig4b_slim_totals.png")


# ---------------------------------------------------------------------------
# 圖 5：固定圖譜 A/B — 4 篇 fat-vs-slim ≈ within-fat（雜訊天花板）
# ---------------------------------------------------------------------------
def fig_ab_agreement():
    papers = ["Forensic\n(155)", "Vaswani\nTransformer (75)",
              "Li Browser\nAgent-RAG (113)", "NeuroSymbolic\nAI4Law (181)"]
    within_fat = [97.4, 97.9, 95.6, 96.0]
    fat_vs_slim = [96.6, 98.3, 95.9, 95.5]
    kappa = [0.913, 0.793, 0.732, 0.862]
    x = np.arange(len(papers))
    w = 0.36
    fig, ax = plt.subplots(figsize=(9.2, 5.0))
    b1 = ax.bar(x - w / 2, within_fat, w, label="within-fat（雜訊天花板：肥自己重跑）",
                color=C_GREY, edgecolor="black", linewidth=0.4)
    b2 = ax.bar(x + w / 2, fat_vs_slim, w, label="fat-vs-slim（瘦 vs 肥）",
                color=C_SLIM, edgecolor="black", linewidth=0.4)
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.15,
                    f"{b.get_height():.1f}", ha="center", fontsize=10)
    ax.set_xticks(x)
    ax.set_xticklabels(papers, fontsize=10.5)
    ax.set_ylabel("逐候選判定一致率 (%)")
    ax.set_ylim(90, 100)
    ax.set_title("固定圖譜 A/B：瘦身偏離肥版 ≈ 肥版自己重跑的雜訊（無退步）", fontsize=12.5)
    ax.legend(fontsize=10, loc="lower left")
    ax.grid(axis="y", alpha=0.3)
    # κ 次軸
    ax2 = ax.twinx()
    ax2.plot(x, kappa, "o--", color=C_BLUE, lw=2, markersize=9, label="Cohen's κ")
    for xi, k in zip(x, kappa):
        ax2.text(xi, k + 0.012, f"κ={k:.2f}", ha="center", fontsize=10,
                 color=C_BLUE, fontweight="bold")
    ax2.set_ylabel("Cohen's κ", color=C_BLUE)
    ax2.set_ylim(0.5, 1.0)
    ax2.tick_params(axis="y", colors=C_BLUE)
    save(fig, "fig5_ab_agreement.png")


# ---------------------------------------------------------------------------
# 圖 6：肥 schema 基準 18 條缺陷分佈（Forensic）
# ---------------------------------------------------------------------------
def fig_defect_baseline():
    rules = ["REL-01", "REL-02", "REL-04", "REL-06", "REL-08", "REL-12", "REL-13"]
    counts = [3, 2, 2, 6, 1, 2, 2]
    names = ["裸主張", "Baseline\n未批判", "缺巨觀\n拆解", "概念未\n形式化",
             "問題解法\n不符", "結論\n偏移", "後設論述\n失衡"]
    colors = plt.cm.tab10(np.linspace(0, 1, len(rules)))
    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    bars = ax.bar(range(len(rules)), counts, color=colors, edgecolor="black", linewidth=0.4)
    for b, c in zip(bars, counts):
        ax.text(b.get_x() + b.get_width() / 2, c + 0.08, str(c), ha="center",
                fontsize=13, fontweight="bold")
    ax.set_xticks(range(len(rules)))
    ax.set_xticklabels([f"{r}\n{n}" for r, n in zip(rules, names)], fontsize=10)
    ax.set_ylabel("缺陷數")
    ax.set_title("肥 schema 基準：Forensic 論文共 18 條缺陷（瘦身驗收基準）", fontsize=12.5)
    ax.set_ylim(0, 7)
    ax.grid(axis="y", alpha=0.3)
    save(fig, "fig6_defect_baseline.png")


# ---------------------------------------------------------------------------
# 圖 7：四篇各階段 output token 堆疊（顯示 rule_check 是大宗）
# ---------------------------------------------------------------------------
def fig_stage_token_stack():
    papers = ["Forensic\n(瘦+平行)", "Vaswani\n(序+肥)", "Li-RAG\n(序+肥)", "NeuroSymbolic\n(序+肥)"]
    stages = ["edu", "er", "rst_fru", "rule_check", "cross_section"]
    data = {
        "edu":           [11293, 8437, 20737, 23310],
        "er":            [9015, 5553, 7818, 5712],
        "rst_fru":       [10143, 5222, 10510, 13171],
        "rule_check":    [8633, 9638, 15978, 22938],
        "cross_section": [561, 20, 678, 20],
    }
    colors = {"edu": "#9ecae1", "er": "#6baed6", "rst_fru": "#3182bd",
              "rule_check": "#e6550d", "cross_section": "#fdae6b"}
    fig, ax = plt.subplots(figsize=(8.8, 5.0))
    bottom = np.zeros(len(papers))
    for s in stages:
        vals = np.array(data[s])
        ax.bar(papers, vals, bottom=bottom, label=s, color=colors[s],
               edgecolor="white", linewidth=0.6)
        bottom += vals
    # 標 rule_check 數值
    for i, p in enumerate(papers):
        rc = data["rule_check"][i]
        below = data["edu"][i] + data["er"][i] + data["rst_fru"][i]
        ax.text(i, below + rc / 2, f"{rc//1000}k", ha="center", va="center",
                fontsize=10, color="white", fontweight="bold")
    ax.set_ylabel("output token")
    ax.set_title("各階段 output token：rule_check（橘）是瘦身鎖定的浪費重災區", fontsize=12.5)
    ax.legend(fontsize=10, ncol=5, loc="upper left")
    ax.grid(axis="y", alpha=0.3)
    save(fig, "fig7_stage_token_stack.png")


# ---------------------------------------------------------------------------
# 圖 8：四篇整篇處理時間（標版本，誠實標示混淆）
# ---------------------------------------------------------------------------
def fig_processing_time():
    papers = ["Forensic", "Vaswani", "Li-RAG", "NeuroSymbolic"]
    times = [138, 313, 519, 536]
    minutes = [t / 60 for t in times]
    versions = ["瘦+平行", "序+肥", "序+肥", "序+肥"]
    colors = [C_SLIM, C_FAT, C_FAT, C_FAT]
    fig, ax = plt.subplots(figsize=(8.4, 4.6))
    bars = ax.bar(papers, times, color=colors, edgecolor="black", linewidth=0.5)
    for b, t, m, v in zip(bars, times, minutes, versions):
        ax.text(b.get_x() + b.get_width() / 2, t + 8, f"{t}s\n({m:.1f} 分)\n{v}",
                ha="center", fontsize=10, fontweight="bold")
    ax.set_ylabel("整篇處理時間 (秒)")
    ax.set_title("整篇處理時間（注意：受版本＋論文大小雙重影響，非純瘦身對照）", fontsize=12)
    ax.set_ylim(0, 640)
    ax.grid(axis="y", alpha=0.3)
    save(fig, "fig8_processing_time.png")


if __name__ == "__main__":
    fig_parallel_speedup()
    fig_noise_floor()
    fig_slim_token_per_rule()
    fig_slim_totals()
    fig_ab_agreement()
    fig_defect_baseline()
    fig_stage_token_stack()
    fig_processing_time()
    print("ALL DONE")
