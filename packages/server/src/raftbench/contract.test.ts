import { raftbenchModelReportSchema } from "@botiverse/raft-shared";
import { describe, expect, test } from "vitest";
import { isPilotServer, reportSchema, reportVisibleTo, validateFetchedEvidence } from "./contract";
const channel = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const messageId = "12345678-0000-4000-8000-000000000004";
const report = () => ({ runId: "00000000-0000-4000-8000-000000000003", revision: 1, status: "complete", gaps: [], patterns: [{ kind: "repeated_clarification", explanation: "Synthetic example", evidence: [{ target: "#synthetic-qa", messageId: "12345678" }], counterevidence: [{ target: "#synthetic-qa:12345678", messageId }], evidenceLevel: "conversation_only", intent: "unknown", suggestion: "Draft a scoped handoff skill change" }] });
describe("staging service-agent contract", () => {
  test("never enrolls production or an unlisted staging server", () => {
    const id = "90623df1-20ed-4321-88a1-e4e2b411a252";
    expect(isPilotServer(id, "staging")).toBe(true);
    for (const env of ["production", undefined]) expect(isPilotServer(id, env)).toBe(false);
    expect(isPilotServer(channel, "staging")).toBe(false);
  });
  test("a hidden analyzed source hides the entire report, even without findings", () => {
    expect(reportVisibleTo([channel, other], new Set([channel]))).toBe(false);
    expect(reportVisibleTo([channel, other], new Set([channel, other]))).toBe(true);
  });
  test("rejects raw payloads, caller-invented coverage and unsupported evidence grades", () => {
    expect(reportSchema.safeParse({ ...report(), messages: [{ content: "raw" }] }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), processedMessages: 20 }).success).toBe(false);
    const value = report(); value.patterns[0].evidenceLevel = "state_verified";
    expect(reportSchema.safeParse(value).success).toBe(false);
  });
  test("incomplete runs need a reason, while empty complete findings remain valid", () => {
    expect(reportSchema.safeParse({ ...report(), status: "incomplete" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), status: "incomplete", reason: "Budget exhausted" }).success).toBe(true);
    expect(reportSchema.safeParse({ ...report(), patterns: [] }).success).toBe(true);
  });
  test("typed harness failure cannot carry successful status or findings", () => {
    expect(raftbenchModelReportSchema.safeParse({ ...report(), failure: true }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), failure: true }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), status: "incomplete", reason: "Model failed", failure: true }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), status: "incomplete", reason: "Model failed", failure: true, patterns: [] }).success).toBe(true);
  });
  test("accepts short/full IDs only for exact fetched targets and reports every invalid reference", () => {
    const value = reportSchema.parse(report());
    const fetched = [{ target: "#synthetic-qa", messageId, channelId: channel }, { target: "#synthetic-qa:12345678", messageId, channelId: channel }];
    expect(validateFetchedEvidence(value, fetched)).toEqual([]);
    const problems = validateFetchedEvidence(value, []);
    expect(problems.map(p => p.path)).toEqual(["patterns[0].evidence[0]", "patterns[0].counterevidence[0]"]);
    expect(problems.every(p => p.suggestedFix.includes("Nothing has been saved"))).toBe(true);
    expect(validateFetchedEvidence(value, [...fetched, { target: "#synthetic-qa", messageId: "12345678-0000-4000-8000-000000000005", channelId: channel }])[0].message).toContain("ambiguous");
  });
});
