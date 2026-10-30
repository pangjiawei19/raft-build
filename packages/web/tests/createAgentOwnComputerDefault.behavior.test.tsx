import assert from "node:assert/strict";
import "./helpers/domSetup";
import { pickFallbackMachine } from "../src/components/agent/CreateAgentDialog";
import type { Machine } from "../src/store/machineStore";

function machine(id: string, patch: Partial<Machine> = {}): Machine {
  return {
    id,
    name: id,
    description: null,
    status: "online",
    statusVersion: 1,
    apiKeyPrefix: "slk_test",
    runtimes: [],
    hostname: null,
    os: null,
    daemonVersion: "1.0.40",
    isComputer: true,
    computerAttachedByCurrentUser: false,
    lastHeartbeat: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  };
}

// bug-triage task #23 (julie): creating an agent defaulted to whichever
// computer came first, not the creator's own.
test("the fallback computer is the creator's own online Computer when they have one", () => {
  const machines = [machine("teammate"), machine("mine", { computerAttachedByCurrentUser: true })];
  assert.equal(pickFallbackMachine(machines, undefined)?.id, "mine");
});

test("an offline or too-old own Computer is skipped; otherwise the first usable machine is kept", () => {
  assert.equal(pickFallbackMachine([machine("teammate"), machine("mine", { computerAttachedByCurrentUser: true, status: "offline" })], undefined)?.id, "teammate");
  assert.equal(pickFallbackMachine([machine("teammate", { daemonVersion: "1.0.40" }), machine("mine", { computerAttachedByCurrentUser: true, daemonVersion: "1.0.1" })], "1.0.30")?.id, "teammate");
  assert.equal(pickFallbackMachine([machine("a"), machine("b")], undefined)?.id, "a");
  assert.ok(pickFallbackMachine([machine("a", { status: "offline" })], undefined) === undefined);
});
