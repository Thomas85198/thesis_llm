# -*- coding: utf-8 -*-
"""產生系統架構圖（給 PPT 用）。輸出 system-architecture.png"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

plt.rcParams["font.sans-serif"] = ["PingFang HK", "Arial Unicode MS", "Heiti TC"]
plt.rcParams["axes.unicode_minus"] = False

# 配色
C_BG     = "#ffffff"
C_FRONT  = "#1e293b"   # 前端深藍灰
C_P1     = "#2563eb"   # 支柱一 藍
C_P1_L   = "#dbeafe"
C_P2     = "#059669"   # 支柱二 綠
C_P2_L   = "#d1fae5"
C_MOAT   = "#b91c1c"   # 護城河 紅
C_MOAT_L = "#fee2e2"
C_INFRA  = "#475569"   # 基礎設施 灰
C_INFRA_L= "#e2e8f0"
C_TEXT   = "#0f172a"

fig, ax = plt.subplots(figsize=(15, 9.6))
ax.set_xlim(0, 100)
ax.set_ylim(0, 100)
ax.axis("off")
fig.patch.set_facecolor(C_BG)


def box(x, y, w, h, text, face, edge, tcolor="#0f172a", fs=11, weight="normal", round=0.025, lw=1.5):
    p = FancyBboxPatch((x, y), w, h,
                       boxstyle=f"round,pad=0.2,rounding_size={round*100}",
                       linewidth=lw, edgecolor=edge, facecolor=face, zorder=2)
    ax.add_patch(p)
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            color=tcolor, fontsize=fs, fontweight=weight, zorder=3, linespacing=1.35)


def arrow(x1, y1, x2, y2, color="#64748b", lw=2, style="-|>", ls="-"):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=16,
                        linewidth=lw, color=color, zorder=1, linestyle=ls,
                        shrinkA=2, shrinkB=2)
    ax.add_patch(a)


# ── 標題 ──
ax.text(50, 97.5, "論文檢核與 AI 寫作系統 — 整體架構", ha="center", va="center",
        fontsize=20, fontweight="bold", color=C_TEXT)
ax.text(50, 93.8, "一句話：把論文拆成知識圖譜、用規則檢出結構性缺陷，再把同一套引擎接進即時護欄的 AI 寫作編輯器",
        ha="center", va="center", fontsize=11, color="#475569")

# ── 使用者 / 前端 ──
box(8, 85.5, 84, 5.5,
    "使用者（瀏覽器）　▸　前端　Next.js 15（App Router）＋ TipTap v3 編輯器 ＋ Zustand　·　繁中／英 i18n　·　深色模式",
    C_FRONT, C_FRONT, tcolor="white", fs=11.5, weight="bold")
arrow(50, 85.3, 50, 82.5, color=C_FRONT, lw=2)

# ── API 閘道 ──
box(8, 78.5, 84, 3.8,
    "FastAPI　·　REST API（/api/upload、/api/editor/*）　·　SSE 串流（autocomplete／rewrite）　·　背景任務佇列 + 進度追蹤",
    "#f1f5f9", C_INFRA, tcolor=C_TEXT, fs=10.5, weight="bold")

# ── 兩支柱外框 ──
# 支柱一
box(5, 30, 43.5, 45.5, "", C_P1_L, C_P1, lw=2.2, round=0.02)
ax.text(26.7, 72.7, "① 分析既有 PDF — 缺陷檢核引擎", ha="center", va="center",
        fontsize=13, fontweight="bold", color=C_P1)
# 支柱二
box(51.5, 30, 43.5, 45.5, "", C_P2_L, C_P2, lw=2.2, round=0.02)
ax.text(73.2, 72.7, "② AI 寫作編輯器", ha="center", va="center",
        fontsize=13, fontweight="bold", color=C_P2)

# ── 支柱一：垂直管線 ──
p1x, p1w = 9.5, 34.5
steps = [
    ("PDF 上傳　→　抽取版面 spans（PyMuPDF／OCR 退路）", 67.5),
    ("章節切分　→　EDU 切句（gpt-5.4-mini）", 62.6),
    ("ER 實體關係抽取　→　RST／FRU 修辭·功能結構", 57.7),
    ("PaperGraph　→　寫入 Neo4j 知識圖譜（KG）", 52.8),
    ("13 條 REL 規則檢核（Cypher 撈候選 + LLM 判定）", 47.9),
    ("缺陷清單：證據句（EDU）＋ 修改建議＋嚴重度", 43.0),
]
for i, (t, y) in enumerate(steps):
    face = "#eff6ff" if i % 2 == 0 else "white"
    box(p1x, y, p1w, 4.0, t, face, C_P1, tcolor=C_TEXT, fs=9.3, round=0.03, lw=1.2)
    if i < len(steps) - 1:
        arrow(p1x + p1w / 2, y, p1x + p1w / 2, y - 0.9, color=C_P1, lw=1.6)

# 規則瘦身註腳
box(9.5, 32.0, 34.5, 3.0,
    "規則瘦身：verdict 只在違規才填細節 → 省 ~43–49% token（A/B 測無退步）",
    "#fffbeb", "#d97706", tcolor="#92400e", fs=8.3, round=0.04, lw=1.2)

# ── 支柱二：四大功能群 ──
p2x, p2w = 55.5, 35.5
feats = [
    ("匯入　txt / md / docx / tex　→　ProseMirror", "結構智慧：目錄·圖表目錄活節點、誤判標題/引言自動修正", 67.0),
    ("寫作核心　Autocomplete · 改寫 · 大綱（SSE 串流）", "Block 編輯：Slash 選單 · 圖/表+目錄 · KaTeX 數學", 57.6),
    ("匯出　DOCX / LaTeX(雙欄·期刊模板) / PDF / MD / TXT / HTML", "圖片內嵌、論文字體、zip 打包", 48.2),
    ("智慧引用　OpenAlex 推薦 · rerank · 自動串接（寧缺勿錯）", "引用驗證（綠/黃/紅燈）· 全文句級接地（RAG）", 38.8),
]
for i, (t1, t2, y) in enumerate(feats):
    box(p2x, y, p2w, 7.6, t1 + "\n" + t2, "white", C_P2, tcolor=C_TEXT, fs=8.8, round=0.025, lw=1.2)

# ── 護城河橋接（兩支柱中間箭頭） ──
arrow(48.7, 50, 51.3, 50, color=C_MOAT, lw=2.4, style="-|>")
box(33, 24.5, 39, 4.6,
    "護城河　把 KG／規則／引用引擎接進寫作當下：\nB-M1 引用紅綠燈驗證　·　B-M2 缺陷檢查前移　·　B-M3 全文引用接地",
    C_MOAT_L, C_MOAT, tcolor="#7f1d1d", fs=9.2, weight="bold", round=0.03, lw=1.8)
arrow(26.7, 30, 30, 27, color=C_MOAT, lw=1.6, ls="--")
arrow(73.2, 30, 70, 27, color=C_MOAT, lw=1.6, ls="--")

# ── 共用基礎設施 ──
infra_y = 5.5
box(5, infra_y, 90, 16, "", C_INFRA_L, C_INFRA, lw=2, round=0.015)
ax.text(50, 19.0, "共用基礎設施　Shared Infrastructure", ha="center", va="center",
        fontsize=12, fontweight="bold", color=C_INFRA)
infra_items = [
    ("OpenAI LLM", "gpt-5.4 / 5.4-mini\ntext-embedding-3-small"),
    ("OpenAlex API", "2.5 億+ 學術文獻\n引用推薦／串接來源"),
    ("Neo4j", "論文知識圖譜\n(EDU·實體·關係·規則)"),
    ("SQLite", "papers · documents\nversions · 向量 chunks"),
    ("檔案儲存", "上傳 PDF / 圖片\nUPLOAD_DIR"),
]
n = len(infra_items)
iw = 16.5
gap = (90 - n * iw) / (n + 1)
for i, (head, sub) in enumerate(infra_items):
    ix = 5 + gap + i * (iw + gap)
    box(ix, infra_y + 1.2, iw, 9.5, head + "\n\n" + sub, "white", C_INFRA,
        tcolor=C_TEXT, fs=9.0, weight="normal", round=0.03, lw=1.2)

# 基礎設施連到上層
arrow(50, 21.5, 50, 23.0, color=C_INFRA, lw=1.6, ls="--")

plt.savefig("/Users/luchienlin/Developer/thesis_llm_demo_v3/docs/slides/system-architecture.png",
            dpi=150, bbox_inches="tight", facecolor=C_BG)
print("saved system-architecture.png")
