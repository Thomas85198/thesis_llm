"""LLM-as-judge：用地端/雲端 ollama 模型對兩個 arm 的建議做 pairwise 盲評。

刻意「不」走 app.llm（它的 _client 單例綁 OpenAI）——judge 自建獨立 OpenAI-
compatible client 指向 ollama，所以 judge≠受測（受測走 OpenAI），無自我偏好。
兩個 judge 都打同一個 ollama endpoint，只差 model 名：
- glm-5.2:cloud（主，需 `ollama signin`，透過本地 ollama 轉發雲端）
- qwen2.5:72b（副，純地端）

去偏：每對 arm 做 position-swap（正反各評一次），兩次一致才算某 arm 勝，否則 tie。
"""

from __future__ import annotations

import json
import os
import re

from openai import OpenAI

JUDGE_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
JUDGE_PRIMARY = os.getenv("ABLATION_JUDGE_PRIMARY", "glm-5.2:cloud")
JUDGE_SECONDARY = os.getenv("ABLATION_JUDGE_SECONDARY", "qwen2.5:72b")
# glm-5.2 是 reasoning 模型：思考放 message.reasoning、答案放 message.content，
# content 要等推理完才吐。token 上限若太小會被 reasoning 吃光、content 空白，
# 所以給足空間（judge 只回短 JSON，reasoning 不長，4096 綽綽有餘）。
JUDGE_MAX_TOKENS = int(os.getenv("ABLATION_JUDGE_MAX_TOKENS", "4096"))

_SYSTEM = (
    "你是學術寫作評審的後設評審（meta-reviewer）。你會看到兩套針對「同一篇論文」"
    "提出的寫作缺陷與修改建議，分別標記為 X 與 Y。請判斷哪一套整體上對作者改進論文"
    "更有幫助，評估面向：是否切中真實且重要的問題、描述是否具體、建議是否可操作、"
    "有無無中生有或空泛套話。\n"
    '只輸出 JSON 物件，格式：{"winner": "X"|"Y"|"tie", "reason": "一句中文理由"}。'
    "不要輸出任何其他文字。"
)


def _client() -> OpenAI:
    # api_key 對 ollama 無意義但 SDK 需要非空值。
    return OpenAI(
        base_url=JUDGE_BASE_URL, api_key=os.getenv("OLLAMA_API_KEY", "ollama")
    )


def _fmt(findings: list[dict]) -> str:
    if not findings:
        return "（這一套沒有提出任何缺陷）"
    lines = []
    for i, f in enumerate(findings, 1):
        lines.append(
            f"{i}. [{f.get('issue_type', '?')}／{f.get('severity', '?')}] "
            f"{f.get('description', '').strip()}\n   建議：{f.get('suggestion', '').strip()}"
        )
    return "\n".join(lines)


def _parse_verdict(text: str) -> dict:
    """寬鬆 parse：抓第一個 JSON 物件；失敗時退化成關鍵字判斷。"""
    if text:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                obj = json.loads(m.group(0))
                w = str(obj.get("winner", "")).strip().upper()
                if w in ("X", "Y", "TIE"):
                    return {
                        "winner": "tie" if w == "TIE" else w,
                        "reason": obj.get("reason", ""),
                    }
            except json.JSONDecodeError:
                pass
    up = (text or "").upper()
    if "WINNER" in up and '"X"' in up:
        return {"winner": "X", "reason": text[:200]}
    if "WINNER" in up and '"Y"' in up:
        return {"winner": "Y", "reason": text[:200]}
    return {"winner": "tie", "reason": f"unparseable: {text[:120]}"}


def _one_comparison(model: str, paper_label: str, x: list[dict], y: list[dict]) -> dict:
    user = (
        f"論文：{paper_label}\n\n"
        f"=== X 套建議 ===\n{_fmt(x)}\n\n"
        f"=== Y 套建議 ===\n{_fmt(y)}\n\n"
        "哪一套整體更有助於作者改進這篇論文？"
    )
    resp = _client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0,
        max_tokens=JUDGE_MAX_TOKENS,
    )
    return _parse_verdict(resp.choices[0].message.content or "")


def judge_pair(
    model: str,
    paper_label: str,
    arm1: str,
    findings1: list[dict],
    arm2: str,
    findings2: list[dict],
) -> dict:
    """對 (arm1, arm2) 做 position-swap 盲評。

    回傳 {model, arm1, arm2, winner: arm1|arm2|"tie", swap_consistent: bool, runs: [...]}。
    run1 把 arm1 放 X、arm2 放 Y；run2 對調。只有兩次都指向同一 arm 才判它勝。
    """
    v1 = _one_comparison(model, paper_label, findings1, findings2)  # X=arm1, Y=arm2
    v2 = _one_comparison(model, paper_label, findings2, findings1)  # X=arm2, Y=arm1

    # 把 X/Y 還原成 arm 名
    w1 = arm1 if v1["winner"] == "X" else arm2 if v1["winner"] == "Y" else "tie"
    w2 = arm2 if v2["winner"] == "X" else arm1 if v2["winner"] == "Y" else "tie"

    if w1 == w2 and w1 != "tie":
        winner, consistent = w1, True
    else:
        winner, consistent = "tie", (w1 == w2)
    return {
        "model": model,
        "arm1": arm1,
        "arm2": arm2,
        "winner": winner,
        "swap_consistent": consistent,
        "runs": [
            {"layout": f"X={arm1},Y={arm2}", **v1, "winner_arm": w1},
            {"layout": f"X={arm2},Y={arm1}", **v2, "winner_arm": w2},
        ],
    }


def ping(model: str) -> bool:
    """確認某 judge 模型在 ollama 上可呼叫。"""
    try:
        resp = _client().chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "reply with the single word OK"}],
            temperature=0,
            max_tokens=JUDGE_MAX_TOKENS,
        )
        return bool(resp.choices[0].message.content)
    except Exception as e:  # noqa: BLE001 — 探測用，任何錯都算不可用
        print(f"[judge] {model} 不可用：{e}")
        return False
