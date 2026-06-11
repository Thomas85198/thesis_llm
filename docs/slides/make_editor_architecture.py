# -*- coding: utf-8 -*-
"""產生「AI 寫作編輯器」架構圖（支柱②）。輸出 editor-architecture.png"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

plt.rcParams["font.sans-serif"] = ["PingFang HK", "Arial Unicode MS", "Heiti TC"]
plt.rcParams["axes.unicode_minus"] = False

C_BG     = "#ffffff"
C_FE     = "#1e293b"   # 前端 深藍灰
C_API    = "#475569"   # API 灰
C_FEAT   = "#059669"   # 一般功能 綠
C_FEAT_L = "#d1fae5"
C_MOAT   = "#b91c1c"   # 護城河 紅
C_MOAT_L = "#fee2e2"
C_RES    = "#2563eb"   # 資源 藍
C_RES_L  = "#dbeafe"
C_TEXT   = "#0f172a"

fig, ax = plt.subplots(figsize=(14.5, 9.2))
ax.set_xlim(0, 100); ax.set_ylim(0, 100); ax.axis("off")
fig.patch.set_facecolor(C_BG)


def box(x, y, w, h, text, face, edge, tcolor="#0f172a", fs=10, weight="normal", round=0.03, lw=1.4):
    p = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0.2,rounding_size={round*100}",
                       linewidth=lw, edgecolor=edge, facecolor=face, zorder=2)
    ax.add_patch(p)
    ax.text(x + w/2, y + h/2, text, ha="center", va="center",
            color=tcolor, fontsize=fs, fontweight=weight, zorder=3, linespacing=1.4)


def arrow(x1, y1, x2, y2, color="#94a3b8", lw=1.8):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14,
                 linewidth=lw, color=color, zorder=1, shrinkA=1, shrinkB=1))


# 標題
ax.text(50, 96.5, "AI 寫作編輯器 — 系統架構（支柱②）", ha="center", va="center",
        fontsize=19, fontweight="bold", color=C_TEXT)
ax.text(50, 92.5, "前端 → API → 五大功能群 → 共用資源；標紅＝把支柱① 分析引擎接進寫作的「護城河」(B-M1/M2/M3)",
        ha="center", va="center", fontsize=10, color="#64748b")

# 第 1 層 前端
box(6, 83, 88, 6,
    "前端　Next.js 15 + TipTap v3（ProseMirror）+ Zustand\n編輯器本體　·　Extensions（slash / figure / table / math / toc）　·　側欄面板（引用 / 匯出 / 缺陷）",
    "#f1f5f9", C_FE, tcolor=C_TEXT, fs=10.5, weight="bold")
arrow(50, 83, 50, 80.5, color=C_FE)

# 第 2 層 API
box(6, 74.5, 88, 5,
    "後端　FastAPI　/api/editor/*　·　REST　+　SSE 串流（autocomplete / rewrite）　·　每端點限流",
    "#e2e8f0", C_API, tcolor=C_TEXT, fs=10.5, weight="bold")

# 第 3 層 五大功能群
feat_y, feat_h = 44, 26
cols = [
    ("寫作核心", C_FEAT, C_FEAT_L,
     "autocomplete.py\nghost text（SSE）\n\nrewrite.py\n改寫·擴寫·潤飾\n\noutline.py\nIMRaD·標題樹", False),
    ("匯入 / 匯出", C_FEAT, C_FEAT_L,
     "import_doc.py\ntxt·md·docx·tex\n結構修正\n\nexport_doc.py\ndocx·tex·pdf\nmd·txt·html", False),
    ("Block 編輯", C_FEAT, C_FEAT_L,
     "（前端 extensions）\nslash 選單\n圖 + 圖目錄\n表 + 表目錄\nKaTeX 數學\n活目錄 toc\n\nupload.py 圖片", False),
    ("智慧引用 ★", C_MOAT, C_MOAT_L,
     "citation.py\n推薦 + 語意 rerank\n\ncitation_relink.py\n純文字→活引用\n\nclaim_verifier.py\nB-M1 驗證（紅綠燈）(G)\n\ngrounding.py\nB-M3 接地·RAG檢索 (R)", True),
    ("缺陷前移 ★", C_MOAT, C_MOAT_L,
     "draft_check.py\nB-M2\n\n把支柱① 的\n13 條 REL\n結構缺陷規則\n前移到「正在寫\n的草稿」\n\n行內波浪底線", True),
]
n = len(cols)
gap = 2.2
cw = (88 - (n - 1) * gap) / n
for i, (name, edge, face, body, moat) in enumerate(cols):
    cx = 6 + i * (cw + gap)
    arrow(50 if i == 0 else cx + cw/2, 74.5, cx + cw/2, feat_y + feat_h, color=C_API, lw=1.4) if False else None
    box(cx, feat_y, cw, feat_h, "", face, edge, lw=2.0, round=0.025)
    ax.text(cx + cw/2, feat_y + feat_h - 2.2, name, ha="center", va="center",
            fontsize=11.5, fontweight="bold", color=edge)
    ax.text(cx + cw/2, feat_y + (feat_h - 4)/2, body, ha="center", va="center",
            fontsize=8.6, color=C_TEXT, linespacing=1.5)
    arrow(cx + cw/2, 74.5, cx + cw/2, feat_y + feat_h, color=C_API, lw=1.3)

# 護城河說明帶
box(6, 36.5, 88, 4.6,
    "護城河（標紅兩群）：把支柱① 既有的「知識圖譜 / 規則 / 引用」分析引擎接進寫作當下　—　B-M1 引用驗證 · B-M2 缺陷前移 · B-M3 引用接地",
    C_MOAT_L, C_MOAT, tcolor="#7f1d1d", fs=9.5, weight="bold", round=0.03, lw=1.6)
arrow(50, 44, 50, 41.3, color=C_MOAT)

# 第 4 層 共用資源
res_y, res_h = 6, 24
ax.text(50, 32.5, "共用資源　Shared Resources", ha="center", va="center",
        fontsize=12, fontweight="bold", color=C_RES)
res = [
    ("SQLite", "documents\ndocument_versions\n（版本快照）\npaper_chunks\n（全文句向量）"),
    ("OpenAI", "gpt-5.4 / mini\n（生成·判讀）\n\ntext-embedding\n-3-small\n（rerank·接地）"),
    ("OpenAlex API", "學術文獻\n引用推薦\n串接·接地\n來源"),
    ("檔案儲存", "UPLOAD_DIR\n上傳圖片\n匯入內嵌圖\n匯出打包"),
]
m = len(res); rgap = 3
rw = (88 - (m - 1) * rgap) / m
for i, (head, sub) in enumerate(res):
    rx = 6 + i * (rw + rgap)
    box(rx, res_y, rw, res_h - 4, head + "\n\n" + sub, C_RES_L, C_RES,
        tcolor=C_TEXT, fs=8.8, round=0.03, lw=1.4)
    ax.text(rx + rw/2, res_y + res_h - 4 - 2.3, head, ha="center", va="center",
            fontsize=10.5, fontweight="bold", color=C_RES)
arrow(50, 36.5, 50, res_y + res_h - 4, color=C_RES, lw=1.4)

plt.savefig("/Users/luchienlin/Developer/thesis_llm_demo_v3/docs/slides/editor-architecture.png",
            dpi=150, bbox_inches="tight", facecolor=C_BG)
print("saved editor-architecture.png")
