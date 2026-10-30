import { and, eq, inArray } from "drizzle-orm";
import { COMPUTER_HOST_IDENTITY_FEATURE_FLAG_KEY, HOST_ID_HASH_PATTERN } from "@botiverse/raft-shared";

import { getDb } from "../db";
import { computerHostIdentities, machines } from "../db/schema";
import { evaluateFeatureFlag } from "./featureFlagService";

/**
 * Same-machine grouping of Computers (design: #proj-raft-computer 00b1039f).
 * The daemon reports HMAC(hardware ID, "raft-host-id-v1:" + serverId); it is
 * stored in its own table so no machine-row read can return it, and only ever
 * leaves the Server as an opaque per-response group label.
 */

export async function isHostIdentityEnabled(serverId: string): Promise<boolean> {
  try {
    return (await evaluateFeatureFlag({ key: COMPUTER_HOST_IDENTITY_FEATURE_FLAG_KEY, serverId })).enabled;
  } catch {
    return false;
  }
}

export function isHostIdHash(value: unknown): value is string {
  return typeof value === "string" && HOST_ID_HASH_PATTERN.test(value);
}

export async function recordHostIdHash(machineId: string, hostIdHash: string, now: Date): Promise<void> {
  await getDb()
    .insert(computerHostIdentities)
    .values({ machineId, hostIdHash, reportedAt: now })
    .onConflictDoUpdate({ target: computerHostIdentities.machineId, set: { hostIdHash, reportedAt: now } });
}

/**
 * Pure: machines that share a hash get the same label; a machine alone on its
 * hash gets none. Labels are `machine-1`, `machine-2`, ... in the order the
 * list presents them, so they say nothing beyond this one response.
 */
export function sameMachineGroupLabels(
  orderedMachineIds: readonly string[],
  hashByMachineId: ReadonlyMap<string, string>,
): Map<string, string> {
  const members = new Map<string, string[]>();
  for (const id of orderedMachineIds) {
    const hash = hashByMachineId.get(id);
    if (!hash) continue;
    const group = members.get(hash);
    if (group) group.push(id);
    else members.set(hash, [id]);
  }
  const labels = new Map<string, string>();
  let next = 1;
  for (const ids of members.values()) {
    if (ids.length < 2) continue;
    const label = `machine-${next++}`;
    for (const id of ids) labels.set(id, label);
  }
  return labels;
}

/** Group labels for a server's machines; empty when the flag is off. */
export async function sameMachineGroupsForServer(
  serverId: string,
  orderedMachineIds: readonly string[],
): Promise<Map<string, string> | null> {
  if (!(await isHostIdentityEnabled(serverId))) return null;
  if (orderedMachineIds.length < 2) return new Map();
  const rows = await getDb()
    .select({ machineId: computerHostIdentities.machineId, hostIdHash: computerHostIdentities.hostIdHash })
    .from(computerHostIdentities)
    .innerJoin(machines, eq(machines.id, computerHostIdentities.machineId))
    .where(and(eq(machines.serverId, serverId), inArray(computerHostIdentities.machineId, [...orderedMachineIds])));
  return sameMachineGroupLabels(orderedMachineIds, new Map(rows.map((row) => [row.machineId, row.hostIdHash])));
}
