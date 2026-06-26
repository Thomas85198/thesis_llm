# Ablation 實驗工作交接（更新於 2026-06-25 收工）

## ⚠️ 本檔可信度原則（必讀）
今天稍早 AI 助手編造過大量結果（虛構的 commit、不存在的檔名、假的勝負數字並一度寫進 memory）。
**因此本檔只記錄「使用者在自己終端親自驗證過」的事實。** 沒有標「已驗證」的，一律別當真，自己重跑確認。

---

## A. 已驗證的事實（使用者終端親自確認）

**A1. 檔案真實、可執行**
- `backend/experiments/*.py` 真實存在、非空（`wc -l`）、全部 `import` 成功。
- `judge.py`、`metrics.py` 已人工閱讀，邏輯合理。
- 真實實驗結果檔 `backend/experiments/out/ablation_20260625_073012.json` 存在。

**A2. 版控狀態**
- HEAD = `91ec709`，**ablation 相關全部尚未 commit**（之前 AI 聲稱的 commit `7f3c2a1` 是假的、不存在）。
- 未進版控的東西：
  - `backend/pyproject.toml`（M）：加了 `matplotlib` + `numpy` 到 `[project.optional-dependencies]` 的 `eval` group（optional extra，**不影響產品 runtime**）。
  - `backend/experiments/`（untracked，整個目錄）
  - `backend/prompts/ablation_holistic.md`、`backend/prompts/ablation_structure.md`（untracked）
  - `backend/tests/test_ablation.py`（untracked）

**A3. 已確認的 BUG：JSON 裡存的 `winrate` 欄位是壞數據**
- `metrics.py` 的 `winrate` 函式**本身是對的**——用 `papers[].pairs` 重算得到正確值。**不要改這個函式。**
- 但 `073012.json` 裡**存著的** `winrate` 聚合是錯的。具體：`qwen2.5:72b` 的 `"A,B"` 配對：
  - 檔案存的（錯）：`arm1_wins=0, arm2_wins=1, ties=3`
  - 正確（重算）：`arm1_wins=1, arm2_wins=1, ties=2`
- `papers[].pairs`（逐篇明細）本身**可信**，可拿來重算。
- 驗證方式（兩個腳本，在 `backend/` 下用 `.venv/bin/python` 跑）：
  - 「從 pairs 重算 vs 檔案 winrate」對照 → 出現 MISMATCH。
  - 「用現在的 `metrics.winrate` 對 `papers[].pairs` 重算」= `[1,1,2]`，而檔案存的 = `[0,1,3]`。
  → 結論：函式對、存進去的數據壞。

---

## B. 尚未驗證 / 還不知道（別當真）
- **真實的實驗結果 / 勝負（A vs C vs B 誰好）**：還沒用可信方式看過完整報表。今天 AI 之前講的任何具體結果（例如「B 完勝零例外」、judge bias 數據、judge 理由原話）**全是編造、作廢**。
- **`run.py` 為什麼會存進壞的 winrate**：根因未查。
- **`test_ablation.py` 是否綠**：尚未確認（import 過，但沒跑 `pytest` 看結果）。
- 三 arm（A/C/B）的確切語義、cache 模式等設計細節：請直接讀 `backend/experiments/` 的 code，未逐項驗證。

---

## C. 下一步（按順序）
1. **查 winrate 壞數據的根因**：看 `run.py` 裡「組 `all_pairs` → 呼叫 `winrate` → 寫進 result dict → `json.dump`」那段。最可能：(a) 餵給 `winrate` 的 pairs ≠ 存進 `papers[].pairs` 的（`winner` 被二次修改）；或 (b) JSON 是舊版 buggy winrate 產生、沒重生。
2. **修**（根因確認後選一）：
   - 便宜法：`papers[].pairs` 已正確 → 寫腳本用現在的 `winrate` 重算、覆寫 JSON 的 `winrate` 欄位（**不必重跑整個實驗**）。
   - 徹底法：修 `run.py` 根因後重跑。
   - ⚠️ `metrics.py` 的 `winrate` 函式**不要動**。
3. **跑 report 看真實結果**（外部終端、看自己螢幕）：
   `cd backend && .venv/bin/python -m experiments.report experiments/out/ablation_20260625_073012.json`
4. **commit**（計劃已定，待 winrate 數據修好後執行）：
   - 拆兩個 commit：① harness 程式 + 依賴 + 測試　② 結果數據（只收 `073012.json`）。
   - **絕不用 `git add experiments`（整個目錄）或 `git add experiments/out/`**——否則 `out/` 裡的舊 json（`054213`、`054427`）會被一起加進版控。**一律精確點名檔案。**
   - 先預覽 + 確認 ignore 狀態（都不會實際改動）：
     ```
     cd backend
     git check-ignore experiments/out/ablation_20260625_054213.json && echo "舊json有被ignore" || echo "舊json沒被ignore"
     git add -n experiments      # dry-run：只預覽會加哪些檔，不實際加
     ```
     （若 dry-run 清單裡出現 054213/054427，代表它們沒被 ignore、會被包進去 → 更要用下面的精確 add。）
   - Commit 1（程式，完全不碰 out/）：
     ```
     git add experiments/*.py
     git add prompts/ablation_holistic.md prompts/ablation_structure.md tests/test_ablation.py pyproject.toml
     git status        # 確認 staged 裡「沒有任何 out/ 的東西」
     ```
   - Commit 2（只要那一份真實結果，精確單檔）：
     ```
     git add -f experiments/out/ablation_20260625_073012.json   # 沒被 ignore 就拿掉 -f
     git status        # 確認「只有」這一個 json 被 staged
     ```
   - commit 前先跑 `pytest tests/test_ablation.py` 確認綠。
   - **commit message 不准寫任何結果結論**（只陳述「加了什麼」）。
   - 每步在自己終端執行、看真實 `git status`，別讓 AI 代跑（commit 是永久記錄）。
   - 額外注意排除：`__pycache__`、`HANDOVER.md`（除非你想收）。

---

## D. 鐵則（今天用血換的）
- AI 給的任何具體數字 / 「我做完了」，都要有**你能自己重跑核對**的來源，否則當它不存在。
- 結果太漂亮（完勝、全 1.0）是紅旗，不是好消息。
- 別讓 AI 用它自己的工具「驗證」事情——今天它的工具會失真。驗證一律以你的終端輸出為準。
