import { z } from "zod";
import { lazySchema } from "./lazySchema";

export const raftbenchEvidenceSchema = lazySchema("raftbenchEvidenceSchema", () => z.object({
  target: z.string().regex(/^#[^\s:#]+(?::[0-9a-f]{8})?$/, "Copy the target exactly from the material you were given."),
  messageId: z.string().regex(/^(?:[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, "Copy the 8-character or full msg ID exactly from the material you were given."),
}).strict());
const raftbenchReportBaseSchema = lazySchema("raftbenchReportBaseSchema", () => z.object({
  runId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["complete", "incomplete"]),
  reason: z.string().trim().max(1000).optional(),
  patterns: z.array(z.object({
    kind: z.enum(["repeated_clarification", "repeated_attempt", "unsupported_completion", "successful_practice"]),
    explanation: z.string().trim().min(1).max(1000),
    evidence: z.array(raftbenchEvidenceSchema).min(1).max(12),
    counterevidence: z.array(raftbenchEvidenceSchema).max(12),
    // Tool/state evidence is not in the initial source reader. Do not invent it.
    evidenceLevel: z.enum(["conversation_only", "insufficient"]),
    intent: z.enum(["active", "deliberately_paused", "unknown"]),
    suggestion: z.string().trim().max(1000),
  }).strict()).max(20),
  gaps: z.array(z.enum(["budget", "history_limit", "missing_tool_outcomes", "inaccessible_source", "partial_scan"])).max(5),
}).strict());
/** The model-facing result schema deliberately has no execution-failure field. */
export const raftbenchModelReportSchema = lazySchema("raftbenchModelReportSchema", () => raftbenchReportBaseSchema.refine(value => value.status !== "incomplete" || !!value.reason, {
  path: ["reason"], message: "Explain why this run is incomplete.",
}));
/** The credential API additionally accepts a typed harness execution failure. */
export const raftbenchReportSchema = lazySchema("raftbenchReportSchema", () => raftbenchReportBaseSchema.extend({ failure: z.literal(true).optional() }).superRefine((value, ctx) => {
  if (value.failure && (value.status !== "incomplete" || value.patterns.length !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["failure"], message: "Execution failure requires incomplete, a reason and no findings." });
  }
  if (value.status === "incomplete" && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Explain why this run is incomplete; nothing will be saved without a reason." });
  }
}));
export type RaftbenchReport = z.infer<typeof raftbenchReportSchema>;

export const raftbenchContextQuerySchema = lazySchema("raftbenchContextQuerySchema", () => z.object({
  runId: z.string().uuid().optional(),
  cursor: z.string().max(512).optional(),
}).strict());
// Responses are parsed permissively: unknown fields are ignored and lengths are
// not capped, so a Server that adds a field or a note does not break clients
// already running (Tenny). Requests and the model's result stay strict.
export const raftbenchCoverageSchema = lazySchema("raftbenchCoverageSchema", () => z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  fetchedMessages: z.number().int().nonnegative(),
  exhausted: z.boolean(),
  skippedChunks: z.number().int().nonnegative().optional(),
  stopReason: z.enum(["more_pages", "message_limit", "char_limit", "window_end"]),
  notRead: z.array(z.string()),
}));
export const raftbenchContextResponseSchema = lazySchema("raftbenchContextResponseSchema", () => z.object({
  runId: z.string().uuid(),
  revision: z.number().int().positive(),
  sourceText: z.string(),
  sources: z.array(z.object({ target: z.string(), messageId: z.string() })),
  coverage: raftbenchCoverageSchema,
  nextCursor: z.string().nullable(),
}));
export const raftbenchSubmitResponseSchema = lazySchema("raftbenchSubmitResponseSchema", () => z.object({
  runId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["complete", "incomplete"]),
  receiptId: z.string().uuid(),
  coverage: raftbenchCoverageSchema,
}));
export type RaftbenchContextQuery = z.infer<typeof raftbenchContextQuerySchema>;
export type RaftbenchContextResponse = z.infer<typeof raftbenchContextResponseSchema>;
export type RaftbenchSubmitResponse = z.infer<typeof raftbenchSubmitResponseSchema>;

/** Delivered to the hosted plugin, never offered as a model-facing operation. */
export const raftbenchRunAssignedSchema = lazySchema("raftbenchRunAssignedSchema", () => z.object({
  kind: z.literal("raftbench_run_assigned"),
  runId: z.string().uuid(),
  revision: z.number().int().positive(),
  text: z.literal("This run is handled automatically by the system. You do not need to take any action or reply."),
}).strict());
export type RaftbenchRunAssigned = z.infer<typeof raftbenchRunAssignedSchema>;
