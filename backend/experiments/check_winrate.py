"""核對工具：用現在的 metrics.winrate 對 JSON 的 papers[].pairs 重算，
比對檔案裡存的 winrate 欄位是否一致（找 HANDOVER A3 的壞數據 bug）。

用法（從 backend/）：
  .venv/bin/python -m experiments.check_winrate experiments/out/ablation_20260625_081709.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import metrics

WIN_FIELDS = ("arm1_wins", "arm2_wins", "ties", "n")


def main() -> None:
    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))

    all_pairs = [p for po in data["papers"] for p in po["pairs"]]
    recomputed = metrics.winrate(all_pairs)
    stored = data.get("winrate", {})

    print(f"檔案：{path.name}")
    print(f"pairs 總數：{len(all_pairs)}；winrate 分組：{len(recomputed)}")
    print("-" * 72)

    any_mismatch = False
    for key in sorted(set(recomputed) | set(stored)):
        r = recomputed.get(key, {})
        s = stored.get(key, {})
        rt = tuple(r.get(f) for f in WIN_FIELDS)
        st = tuple(s.get(f) for f in WIN_FIELDS)
        flag = "OK" if rt == st else "❌ MISMATCH"
        if rt != st:
            any_mismatch = True
        print(f"[{flag}] {key}")
        print(f"    重算  (a1,a2,tie,n) = {rt}")
        print(f"    檔案存(a1,a2,tie,n) = {st}")

    print("-" * 72)
    print(
        "結論：",
        "有 MISMATCH（檔案 winrate 是壞數據）"
        if any_mismatch
        else "全部一致（檔案 winrate 可信）",
    )


if __name__ == "__main__":
    main()
