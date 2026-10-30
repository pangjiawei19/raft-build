import { dbTest as test } from "../test/integration/dbTest";
import assert from "node:assert/strict";
import { __testRisingWaveInbox, getActivityUnreadTotalsBatch, getInboxItems } from "./channelService";
import { installRisingWaveReadReferences, uninstallRisingWaveReadReferences } from "../test/risingWaveReadReference";
import { __testUnifiedChainTransition } from "../db/risingwave";

// Until 077's parent condition serves everywhere, the serving views still carry
// threads below a parent the receiver can no longer see. The Activity read checks
// those parents in Postgres after the RW read and, if any fail, reads again with
// them excluded in SQL; the unread totals take their unread back out.

beforeEach(() => {
  uninstallRisingWaveReadReferences();
  __testUnifiedChainTransition.reset();
});

afterEach(() => {
  __testRisingWaveInbox.reset();
  installRisingWaveReadReferences();
});

type Call = { text: string; values: unknown[] };

function emptyServingPage(threadParentChannelIds: string[] | null) {
  return {
    kind: null,
    totalCount: 0,
    totalUnreadCount: 0,
    activeUnreadCount: 0,
    groupChannelIds: [],
    groupChannelNames: [],
    groupChannelTypes: [],
    groupCounts: [],
    groupLastActivityAts: [],
    threadParentChannelIds,
  };
}

async function fixture(seed: any) {
  const owner = await seed.human();
  const user = await seed.human();
  const server = await seed.server({ owner, members: [user] });
  const publicParent = await seed.channel({ server, members: [owner], name: "public-parent" });
  const privateMember = await seed.channel({ server, members: [owner, user], name: "private-member", visibility: "private" });
  const privateLeft = await seed.channel({ server, members: [owner], name: "private-left", visibility: "private" });
  const archived = await seed.channel({ server, members: [owner, user], name: "archived", archivedAt: new Date() });
  return { user, server, publicParent, privateMember, privateLeft, archived };
}

test("Activity: threads below an archived or no-longer-member private parent are excluded in a second read", async ({ seed }) => {
  const f = await fixture(seed);
  const missing = "00000000-0000-4000-8000-0000000000aa";
  const calls: Call[] = [];
  __testRisingWaveInbox.set({
    getPool: () => ({} as never),
    query: (async (_pool: unknown, text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return {
        result: {
          rows: [emptyServingPage(calls.length === 1
            ? [f.publicParent.id, f.privateMember.id, f.privateLeft.id, f.archived.id, missing]
            : null)],
        },
      };
    }) as never,
  });

  await getInboxItems(f.server.id, f.user.id, { filter: "all" });

  assert.equal(calls.length, 2, "one read to learn the parents, one with the invisible ones excluded");
  assert.equal(calls[0].values.length, 7);
  assert.doesNotMatch(calls[0].text, /\$8/);
  assert.deepEqual(
    [...(calls[1].values[7] as string[])].sort(),
    [f.privateLeft.id, f.archived.id, missing].sort(),
    "visible parents (public, private with membership) stay; archived, left and unknown parents are excluded",
  );
  // The exclusion applies to the rows, groups and totals (filtered) and to the active totals.
  assert.equal(calls[1].text.match(/i\.parent_channel_id = ANY\(\$8::varchar\[\]\)/g)?.length, 2);
});

test("Activity: no second read when every thread parent is visible", async ({ seed }) => {
  const f = await fixture(seed);
  const calls: Call[] = [];
  __testRisingWaveInbox.set({
    getPool: () => ({} as never),
    query: (async (_pool: unknown, text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return { result: { rows: [emptyServingPage([f.publicParent.id, f.privateMember.id])] } };
    }) as never,
  });

  await getInboxItems(f.server.id, f.user.id, { filter: "unread" });
  await getInboxItems(f.server.id, f.user.id, { filter: "mentions" });

  assert.equal(calls.length, 2, "one RW read per request");
});

test("Activity totals: unread of threads below an invisible parent is taken out of the badge", async ({ seed }) => {
  const f = await fixture(seed);
  const calls: Call[] = [];
  __testRisingWaveInbox.set({
    getPool: () => ({} as never),
    query: (async (_pool: unknown, text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return {
        result: {
          rows: [
            { serverId: f.server.id, parentChannelId: null, unreadCount: 20 },
            { serverId: f.server.id, parentChannelId: f.publicParent.id, unreadCount: 3 },
            { serverId: f.server.id, parentChannelId: f.privateMember.id, unreadCount: 4 },
            { serverId: f.server.id, parentChannelId: f.privateLeft.id, unreadCount: 5 },
            { serverId: f.server.id, parentChannelId: f.archived.id, unreadCount: 6 },
          ],
        },
      };
    }) as never,
  });

  const totals = await getActivityUnreadTotalsBatch([{ serverId: f.server.id }], f.user.id);

  assert.equal(calls.length, 1, "the per-parent unread comes in the same round trip");
  assert.deepEqual(totals.get(f.server.id), { totalUnreadCount: 9, activeUnreadCount: 9 });
});

test("Activity totals: a badge with only visible thread parents is unchanged", async ({ seed }) => {
  const f = await fixture(seed);
  __testRisingWaveInbox.set({
    getPool: () => ({} as never),
    query: (async () => ({
      result: {
        rows: [
          { serverId: f.server.id, parentChannelId: null, unreadCount: 7 },
          { serverId: f.server.id, parentChannelId: f.publicParent.id, unreadCount: 3 },
        ],
      },
    })) as never,
  });

  const totals = await getActivityUnreadTotalsBatch([{ serverId: f.server.id }], f.user.id);
  assert.deepEqual(totals.get(f.server.id), { totalUnreadCount: 7, activeUnreadCount: 7 });
});
