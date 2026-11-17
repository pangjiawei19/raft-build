import assert from "node:assert/strict";
import { test } from "vitest";
import { FREE_MONTHLY_FILE_UPLOAD_LIMIT_BYTES } from "@botiverse/raft-shared";
import { readFreeMonthlyUploadLimitBytes } from "./fileUploadQuota";

test("未设置月上传额度时沿用上游默认，支持自托管的大于 32 位整数额度", () => {
  assert.equal(readFreeMonthlyUploadLimitBytes(""), FREE_MONTHLY_FILE_UPLOAD_LIMIT_BYTES);
  assert.equal(readFreeMonthlyUploadLimitBytes("  "), FREE_MONTHLY_FILE_UPLOAD_LIMIT_BYTES);
  assert.equal(readFreeMonthlyUploadLimitBytes("10737418240"), 10 * 1024 ** 3);
  assert.equal(readFreeMonthlyUploadLimitBytes(" 1 "), 1);
});

test("拒绝零、负数、小数、无穷大、表达式及超出安全整数的月上传额度", () => {
  for (const value of ["0", "-1", "1.5", "Infinity", "NaN", "10 * 1024", "1e10", "9007199254740992"]) {
    assert.throws(() => readFreeMonthlyUploadLimitBytes(value), /FILE_UPLOAD_MONTHLY_LIMIT_BYTES/);
  }
});
