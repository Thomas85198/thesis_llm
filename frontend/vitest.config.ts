import path from "node:path";
import { defineConfig } from "vitest/config";

// 對齊 tsconfig 的 "@/..." 路徑 alias，讓測試能載入 lib/ 下互相引用的模組。
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { environment: "node" },
});
