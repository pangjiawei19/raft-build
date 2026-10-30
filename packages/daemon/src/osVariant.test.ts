import assert from "node:assert/strict";

import { classifyKernelRelease, detectOsVariant } from "./osVariant";

test("classifies WSL kernels and leaves other Linux kernels alone", () => {
  assert.equal(classifyKernelRelease("5.15.167.4-microsoft-standard-WSL2\n"), "wsl2");
  assert.equal(classifyKernelRelease("4.19.128-microsoft-standard"), "wsl2");
  assert.equal(classifyKernelRelease("4.4.0-19041-Microsoft"), "wsl1");
  assert.equal(classifyKernelRelease("6.18.35-current-arm64"), undefined);
  assert.equal(classifyKernelRelease("6.8.0-45-generic"), undefined);
});

test("only reads the kernel release on Linux and tolerates a missing file", () => {
  const wsl = () => "5.15.167.4-microsoft-standard-WSL2";
  assert.equal(detectOsVariant("linux", wsl), "wsl2");
  assert.equal(detectOsVariant("darwin", wsl), undefined);
  assert.equal(detectOsVariant("win32", wsl), undefined);
  assert.equal(detectOsVariant("linux", () => { throw new Error("ENOENT"); }), undefined);
});
