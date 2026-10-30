import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asServerId, type AnalyticsId } from "@botiverse/raft-shared";
import { buildClientEventRows, clientEventBatchSchema } from "./productEventIngest";

test("ingest counts missing announcement classification separately from invalid values", () => {
  const now = new Date();
  const complete = { announcement_id: randomUUID(), delivery_version: 1, action: "primary", has_cta: true };
  const batch = clientEventBatchSchema.parse({
    source: "web",
    events: [complete, { announcement_id: complete.announcement_id, delivery_version: 1, has_cta: true }, { ...complete, has_cta: "yes" }].map((properties) => ({
      uuid: randomUUID(), event: "announcement_interacted", timestamp: now.toISOString(), properties,
    })),
  });
  const result = buildClientEventRows({
    batch, receivedAt: now, analyticsId: randomUUID() as AnalyticsId, serverId: asServerId(randomUUID()),
  });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].properties, complete);
  assert.deepEqual(result.rejected, { missing_property: 1, invalid_property_value: 1 });
});

test("a native batch is accepted, but only for events the registry opens to native apps", () => {
  const now = new Date();
  const batch = clientEventBatchSchema.parse({
    source: "ios",
    events: [
      { event: "nav_entry_selected", properties: { destination: "activity", surface: "mobile_tab_bar", was_active: false } },
      { event: "activity_open", properties: { from: "rail" } },
    ].map((event) => ({ uuid: randomUUID(), timestamp: now.toISOString(), ...event })),
  });
  const result = buildClientEventRows({
    batch, receivedAt: now, analyticsId: randomUUID() as AnalyticsId, serverId: asServerId(randomUUID()),
  });
  assert.deepEqual(result.rows.map((row) => [row.event, row.source]), [["nav_entry_selected", "ios"]]);
  assert.deepEqual(result.rejected, { source_not_allowed: 1 });
  assert.equal(clientEventBatchSchema.safeParse({ ...batch, source: "server" }).success, false, "server facts never arrive in a client batch");
});
