import type { Request, Response } from "express";
import { ACTIVITY_SYNC_CONTRACT, ACTIVITY_SYNC_CONTRACT_REVISION } from "@botiverse/raft-sync-core";
import { addTraceEvent } from "../tracing/semanticTrace";

/** Response header naming the Activity sync contract revision this server speaks. */
export const ACTIVITY_CONTRACT_RESPONSE_HEADER = "X-Raft-Contract";
/** Optional request header: the revision the client's bindings were generated at. */
export const ACTIVITY_CONTRACT_CLIENT_REVISION_HEADER = "X-Raft-Contract-Revision";

export const ACTIVITY_CONTRACT_HEADER_VALUE = `${ACTIVITY_SYNC_CONTRACT};revision=${ACTIVITY_SYNC_CONTRACT_REVISION}`;

const REVISION_RE = /^[1-9][0-9]{0,8}$/;

/**
 * The Activity sync handshake (packages/sync-core/contracts/activity-v1,
 * revisions.json). The server always reports its revision; a client enables
 * its sync engine only on an exact match and otherwise stays on
 * /channels/inbox. The client's own revision is recorded for diagnosis and
 * never changes the response.
 */
export function applyActivityContractHandshake(req: Request, res: Response, endpoint: "snapshot" | "difference"): void {
  res.setHeader(ACTIVITY_CONTRACT_RESPONSE_HEADER, ACTIVITY_CONTRACT_HEADER_VALUE);
  // Browsers only expose non-safelisted response headers that are listed here.
  res.append("Access-Control-Expose-Headers", ACTIVITY_CONTRACT_RESPONSE_HEADER);

  const raw = req.get(ACTIVITY_CONTRACT_CLIENT_REVISION_HEADER)?.trim();
  const clientRevision = raw && REVISION_RE.test(raw) ? Number(raw) : null;
  addTraceEvent("activity.contract.handshake", {
    endpoint,
    server_revision: ACTIVITY_SYNC_CONTRACT_REVISION,
    client_revision: clientRevision,
    client_revision_present: raw !== undefined && raw !== "",
    client_revision_valid: clientRevision !== null,
    revision_match: clientRevision === null ? null : clientRevision === ACTIVITY_SYNC_CONTRACT_REVISION,
  });
}
