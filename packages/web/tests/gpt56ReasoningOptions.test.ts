import assert from "node:assert/strict";
import { getDefaultModel } from "@botiverse/raft-shared";
import {
  reasoningEffortOptionsForModel,
  reconcileReasoningEffort,
} from "../src/utils/reasoningEffortOptions";

// WEB half of the Codex reasoning task: the model form reads Tenny's shared
// RUNTIME_MODELS.codex data (supportedReasoningEfforts / defaultReasoningEffort)
// rather than hardcoding per-variant level lists. These assertions pin the
// picker behavior against that shared data.

test("codex default model is GPT-6.1 Sol", () => {
  assert.equal(getDefaultModel("codex"), "gpt-6.1-sol");
});

test("GPT-6.1 Sol exposes all six reasoning levels including Ultra; GPT-6 Luna stops at Max", () => {
  assert.deepEqual(reasoningEffortOptionsForModel("codex", "gpt-6.1-sol").map((o) => o.value), ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(reasoningEffortOptionsForModel("codex", "gpt-6-luna").map((o) => o.value), ["low", "medium", "high", "xhigh", "max"]);
});

test("Astra exposes all six reasoning levels including Ultra", () => {
  const values = reasoningEffortOptionsForModel("codex", "gpt-6-astra").map((o) => o.value);
  assert.deepEqual(values, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.ok(values.includes("ultra"), "gpt-6-astra should include ultra");
});

test("sol and terra expose all six reasoning levels including Ultra", () => {
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra"]) {
    const values = reasoningEffortOptionsForModel("codex", model).map((o) => o.value);
    assert.deepEqual(values, ["low", "medium", "high", "xhigh", "max", "ultra"], model);
    assert.ok(values.includes("ultra"), `${model} should include ultra`);
  }
});

test("luna omits Ultra (five levels)", () => {
  const values = reasoningEffortOptionsForModel("codex", "gpt-5.6-luna").map((o) => o.value);
  assert.deepEqual(values, ["low", "medium", "high", "xhigh", "max"]);
  assert.ok(!values.includes("ultra"), "luna must not offer ultra");
});

test("effort levels carry catalog ids (label/description text is locale-owned)", () => {
  const options = reasoningEffortOptionsForModel("codex", "gpt-5.6-sol");
  const xhigh = options.find((o) => o.value === "xhigh");
  assert.equal(xhigh?.labelId, "agent.reasoningEffort.xhigh");
  const ultra = options.find((o) => o.value === "ultra");
  assert.equal(ultra?.descriptionId, "agent.reasoningEffort.ultraDescription");
});

test("default reasoning effort seeds to Low for Astra", () => {
  assert.equal(reconcileReasoningEffort("codex", "gpt-6-astra", null), "low");
});

test("default reasoning effort seeds to Medium for the GPT-5.6 variants", () => {
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.equal(reconcileReasoningEffort("codex", model, null), "medium", model);
  }
});

test("selecting luna clamps an Ultra choice down to the model default", () => {
  assert.equal(reconcileReasoningEffort("codex", "gpt-5.6-luna", "ultra"), "medium");
  // A level luna supports is preserved.
  assert.equal(reconcileReasoningEffort("codex", "gpt-5.6-luna", "max"), "max");
});

test("non-gating models fall back to the BASE set — max/ultra must NOT leak (task #496)", () => {
  // A model that declares no supportedReasoningEfforts (Claude Haiku 4.5, which
  // takes no effort) gets the BASE set only, not the full catalog.
  const values = reasoningEffortOptionsForModel("claude", "claude-haiku-4-5").map((o) => o.value);
  assert.deepEqual(values, ["low", "medium", "high", "xhigh"]);
  assert.ok(!values.includes("max") && !values.includes("ultra"), "a non-gating model must not offer max/ultra");
  // Claude models that declare low..max offer max, never ultra.
  assert.deepEqual(reasoningEffortOptionsForModel("claude", "sonnet").map((o) => o.value), ["low", "medium", "high", "xhigh", "max"]);
  // A base-level value passes through unchanged (incl. null).
  assert.equal(reconcileReasoningEffort("claude", "sonnet", "high"), "high");
  assert.equal(reconcileReasoningEffort("claude", "sonnet", null), null);
});
