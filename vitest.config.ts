import { defineConfig } from "vitest/config";

// 公开源码快照未包含根测试配置，开发脚本沿用上游的 Vitest 全局 API。
export default defineConfig({
  test: {
    globals: true,
    include: ["scripts/**/*.test.{ts,mjs}"],
    pool: "forks",
    maxWorkers: 4,
    restoreMocks: true,
    testTimeout: 0,
    hookTimeout: 0,
  },
});
