import { FREE_MONTHLY_FILE_UPLOAD_LIMIT_BYTES } from "@botiverse/raft-shared";

/** 自托管部署可调整免费工作区的月上传上限，仍保留原有用量核算。 */
export function readFreeMonthlyUploadLimitBytes(raw = process.env.FILE_UPLOAD_MONTHLY_LIMIT_BYTES): number {
  if (!raw?.trim()) return FREE_MONTHLY_FILE_UPLOAD_LIMIT_BYTES;
  const value = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("FILE_UPLOAD_MONTHLY_LIMIT_BYTES 必须为正的安全整数，单位为字节。");
  }
  return value;
}

export const freeMonthlyUploadLimitBytes = readFreeMonthlyUploadLimitBytes();
