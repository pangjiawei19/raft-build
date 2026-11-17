import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";

// 公开源码快照未包含根测试配置，开发脚本沿用上游的 Vitest 全局 API。
export default defineConfig({
  test: {
    globals: true,
    include: ["scripts/**/*.test.{ts,mjs}"],
    // 上游公开快照未附带此测试所依赖的私有 CI 保留策略。
    ...(existsSync(new URL("scripts/ci/migration-snapshot-retention.mjs", import.meta.url))
      ? {} : { exclude: ["**/node_modules/**", "scripts/dev/prune-drizzle-snapshots.test.ts"] }),
    pool: "forks",
    maxWorkers: 4,
    restoreMocks: true,
    testTimeout: 0,
    hookTimeout: 0,
  },
});
