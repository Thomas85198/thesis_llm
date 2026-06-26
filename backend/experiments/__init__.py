"""Ablation 實驗 harness（離線、不碰產品 API）。

import 時載入 backend/.env，讓受測（OpenAI）的 OPENAI_API_KEY 等可用——
產品端是 main.py 在啟動時 load_dotenv()，但這些腳本不走 main.py。
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
