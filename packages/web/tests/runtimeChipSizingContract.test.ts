import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function readSource(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

// DS PropertyList + StatusChip: the Runtime value is the DS runtime chip
// (`.rf-runtime`: the cyan-soft Badge in Space Mono 12 400). The model, reasoning
// and mode values are plain facts — no colour, model ids in Space Mono — because
// a colour block must mean identity, status, signal or consequence.
test("agent runtime configuration rows render the DS runtime chip and plain-fact values", () => {
  const source = readSource("src/components/agent/AgentDetailPanel.tsx");
  assert.match(source, /const RUNTIME_CHIP_CLASS = "font-mono text-mono-meta font-normal";/);
  const runtime = [...source.matchAll(/<RuntimeAccountUsageGateChip\b([^>]*?)>/g)];
  assert.equal(runtime.length, 1);
  assert.match(runtime[0]![1], /appearance="soft"/);
  assert.match(runtime[0]![1], /variant="information"/);
  assert.match(runtime[0]![1], /className=\{RUNTIME_CHIP_CLASS\}/);
  assert.doesNotMatch(runtime[0]![1], /\bstyle=/);
  // The usage chip names itself from a plain string child.
  assert.match(source, /className=\{RUNTIME_CHIP_CLASS\}\s*>[\s\S]*?\{formatRuntimeLabelWithStatus\(currentRuntimeConfig\.runtime, formatMessage\)\}\s*<\/RuntimeAccountUsageGateChip>/);
  // The profile hero carries the same chip with its cpu icon.
  assert.match(source, /<Badge appearance="soft" variant="information" className=\{RUNTIME_CHIP_CLASS\} data-testid="agent-profile-runtime-chip">\s*<Cpu size=\{14\} aria-hidden="true" \/>/);

  for (const field of ["model", "reasoning", "mode"]) {
    const label = `label={formatMessage({ id: "agent.runtimeConfig.${field}" })}`;
    const index = source.indexOf(label);
    assert.notEqual(index, -1, `${field} label missing`);
    const value = source.slice(index, index + 600);
    assert.doesNotMatch(value.split("</InfoRow>")[0]!, /<Badge\b/, `${field} is a plain fact, not a coloured chip`);
  }
  const model = source.slice(source.indexOf('label={formatMessage({ id: "agent.runtimeConfig.model" })}'));
  assert.match(model, /^[^]*?<span className="min-w-0 break-all font-mono">\{currentRuntimeModelLabel\}<\/span>/);
});

test("machine runtime chips use the shared badge recipe without forcing a legacy border or height", () => {
  const source = [
    readSource("src/components/machine/MachineDetailPanel.tsx"),
    readSource("src/components/machine/CommandCopyRoot.tsx"),
    readSource("src/components/machine/WorkspaceDeleteButton.tsx"),
    readSource("src/components/machine/BulkResetOptionCard.tsx"),
    readSource("src/components/machine/MachineAgentRow.tsx"),
  ].join("\n");
  // Raft DS runtime tags: the badge recipe draws them from props alone —
  // cyan-soft when detected, stone-soft when not — with no local class
  // override of colour, border or height.
  const chips = [...source.matchAll(/<RuntimeAccountUsageGateChip\b([^>]*?)>/g)];
  assert.equal(chips.length, 1);
  assert.match(chips[0]![1], /appearance="soft"/);
  assert.match(chips[0]![1], /variant=\{detected \? "information" : "muted"\}/);
  assert.doesNotMatch(chips[0]![1], /\b(?:className|style)=/);
});
