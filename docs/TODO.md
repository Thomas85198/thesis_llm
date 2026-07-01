# 專案現況 / 待辦

> 最後更新：2026-07-01
> 用途：只放「目前在做 / 還沒做的事」。已完成的歷史不留在這，看 git log 與 `/changelog`。
>
> **各層文件的分工（互不重疊）**
> - 產品功能全貌、未來展望 → 前端 `/about` 頁（單一事實來源，面向讀者）
> - 系統設計 / 架構 / KG 語意 / 效能 → [SYSTEM.md](SYSTEM.md)
> - 資料庫 schema → [DB_SCHEMA.md](DB_SCHEMA.md)
> - 13 條規則怎麼寫、怎麼維護 → [REL-rules-explained.md](REL-rules-explained.md)
> - 消融實驗現況（可信度原則、已驗證事實）→ [../backend/experiments/HANDOVER.md](../backend/experiments/HANDOVER.md)

---

## 現況快照（2026-07-01）

- **產品端**：審稿 + AI 寫作編輯器兩大子系統都上線；編輯器已到 **v4.17.1**（三格式一致、專注模式、文法 lint、缺陷一鍵套用、多格式匯入皆完成）。中英 i18n + 深色模式已併入 `main`。
- **研究端**：離線消融實驗（三 arm × 雙 judge pairwise）的 harness 已進版控（`backend/experiments/`，commit `88ffaf9`）。目前在 `experiment/ablation` 分支收尾。
- **實驗結論屬敏感區**：任何勝負數字 / 一致率一律以 `backend/experiments/HANDOVER.md` 標記「已驗證」者為準，不要憑記憶引用。

---

## 待辦（依優先序）

### A. 消融實驗收尾（卡論文 main result）
1. 修 judge 一致率過低的問題（雙 judge 判定分歧大，先確認是 prompt 還是任務本身難）
2. 控制「缺陷數」confound——三個 arm 之間缺陷數不對齊會污染 pairwise 勝負判讀
3. 強化 prompt-A（全文直丟那個 arm），確保比較公平、不是因為 prompt 太弱才輸
4. 擴大樣本數 n（目前篇數偏少，勝率統計力不足）
5. 收斂出可寫進論文 evaluation 章節的結論

### B. 產品缺口
6. **PDF 匯入編輯器**——把既有 PDF 草稿直接帶進寫作編輯器修改（`/about` 未來展望列為主要缺口）
7. 規則回饋校準：把人工判定（判對 / 誤判）回饋給系統，自動校準規則精準度（Phase 2 迴路程式已就緒，缺累積樣本）

### C. 基建（實用功能穩了再做）
8. 帳號與多人協作（個人空間 + 權限）
9. 成本優化：本地 + 雲端混合推論、批次 API 折扣
10. 上雲：SQLite → 託管 Postgres、本機磁碟 → 物件儲存、記憶體任務 → 持久佇列 + 獨立 worker（三階段見 `/about` 上雲規劃）

---

## 待決策

- [ ] 消融實驗若結論不支持假設，論文如何定調（改敘事 vs 調實驗設計）——以 HANDOVER 的實測為準討論
- [ ] 規則回饋校準需要領域專家標註樣本，誰來標、標多少
- [ ] benchmark（PeerRead / AAEC 等）是否進論文——目前傾向自建語料為主軸
