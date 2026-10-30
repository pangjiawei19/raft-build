import assert from "node:assert/strict";
import { test } from "vitest";
import { messageSearchParamTraceAttrs, queryScript, queryTermCountBucket } from "./messageSearchTrace";

test("queryScript classifies the query's script without keeping its text", () => {
  assert.equal(queryScript(""), "empty");
  assert.equal(queryScript("   "), "empty");
  assert.equal(queryScript("deploy staging"), "latin");
  assert.equal(queryScript("部署环境"), "cjk");
  assert.equal(queryScript("デプロイ"), "cjk");
  assert.equal(queryScript("배포"), "cjk");
  assert.equal(queryScript("部署到staging环境"), "mixed");
  assert.equal(queryScript("12345 !?"), "other");
});

test("queryTermCountBucket caps at 4+", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 17].map(queryTermCountBucket), ["0", "1", "2", "3", "4+", "4+"]);
});

test("search param attrs carry script always and term count only when the service supplies it", () => {
  const base = { query: "部署到staging环境", sort: "relevance", limit: 20, offset: 0 };
  const route = messageSearchParamTraceAttrs(base);
  assert.equal(route.query_script, "mixed");
  assert.equal("query_term_count_bucket" in route, false);
  const service = messageSearchParamTraceAttrs({ ...base, queryTokenCount: 3 });
  assert.equal(service.query_term_count_bucket, "3");
  assert.equal(Object.values(service).some((value) => typeof value === "string" && value.includes("staging")), false);
});
