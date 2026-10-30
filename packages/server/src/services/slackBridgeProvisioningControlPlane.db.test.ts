import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";
import {
  slackBridgeProvisioningResponseSchema,
  type SlackBridgeProvisioningResponse,
} from "@botiverse/raft-shared";

import { getDb } from "../db/index";
import {
  externalAppCredentials,
  externalAppInstallServerGrants,
  externalAppInstalls,
  externalAppServerGrants,
  externalChannelBindings,
  serverMembers,
} from "../db/schema";
import { SLACK_BRIDGE_REQUIRED_BOT_SCOPES } from "../routes/slackBridge";
import { dbTest } from "../test/integration/dbTest";
import {
  createSlackBridgeProvisioningControlPlane,
  slackBridgeProvisioningManifestHash,
  SLACK_BRIDGE_PROVISIONING_CAPABILITIES,
  type SlackBridgeProvisioningProvider,
} from "./slackBridgeProvisioningControlPlane";

const REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_REDIRECT_URI = "https://raft.example/api/slack-bridge/oauth/callback";
const EVENTS_REQUEST_URL = "https://bridge.example/api/slack-bridge/events";

const BOOTSTRAP = {
  registrationId: REGISTRATION_ID,
  environment: "test" as const,
  providerAppId: "A_MEMBER_READ",
  providerOAuthClientId: "member-read-client",
  oauthRedirectUri: OAUTH_REDIRECT_URI,
  eventsRequestUrl: EVENTS_REQUEST_URL,
  capabilityManifestVersion: 1,
  capabilityManifestHash: slackBridgeProvisioningManifestHash({
    oauthRedirectUri: OAUTH_REDIRECT_URI,
    eventsRequestUrl: EVENTS_REQUEST_URL,
  }),
  requiredCapabilities: SLACK_BRIDGE_PROVISIONING_CAPABILITIES,
  signingSecret: {
    encryptedSecretRef: "env:SLACK_BRIDGE_SIGNING_SECRET",
    envelopeKeyId: "env:process",
    secretRevision: 1,
  },
  oauthClientSecret: {
    encryptedSecretRef: "env:SLACK_BRIDGE_OAUTH_CLIENT_SECRET",
    envelopeKeyId: "env:process",
    secretRevision: 1,
  },
};

function fakeProvider() {
  const calls = { readWorkspace: 0 };
  const provider: SlackBridgeProvisioningProvider = {
    async readInstallGrant() { return { kind: "unverified" }; },
    async readWorkspace() {
      calls.readWorkspace += 1;
      return {
        kind: "fact",
        fact: {
          workspaceName: "Member Read Workspace",
          channels: [
            { id: "C_GENERAL", name: "slack-general", privacyClass: "public", isMember: true },
            { id: "C_SECRET", name: "slack-secret", privacyClass: "private", isMember: true },
            { id: "C_MINE", name: "slack-mine", privacyClass: "private", isMember: true },
            { id: "C_UNPAIRED", name: "slack-unpaired", privacyClass: "public", isMember: true },
          ],
        },
      };
    },
    async readConversationAudience() { return { kind: "unverified" }; },
  };
  return { provider, calls };
}

function parsed(response: SlackBridgeProvisioningResponse): SlackBridgeProvisioningResponse {
  const result = slackBridgeProvisioningResponseSchema.safeParse(response);
  assert.ok(result.success, `response must satisfy the route schema: ${JSON.stringify(result.error?.issues)}`);
  return result.data;
}

async function rejectsUnauthorized(operation: Promise<unknown>, label: string) {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, "external_app_not_authorized", label);
    return true;
  });
}

dbTest("Slack Bridge setup is readable by members, narrowed to their channels, and still managed only by owners/admins", async ({ seed }) => {
  const owner = await seed.human();
  const admin = await seed.human();
  const member = await seed.human();
  const outsider = await seed.human();
  const guest = await seed.human();
  const server = await seed.server({ owner, members: [admin, member, guest] });
  await getDb().update(serverMembers).set({ role: "guest" }).where(and(
    eq(serverMembers.serverId, server.id),
    eq(serverMembers.userId, guest.id),
  ));
  await getDb().update(serverMembers).set({ role: "admin" }).where(and(
    eq(serverMembers.serverId, server.id),
    eq(serverMembers.userId, admin.id),
  ));
  const general = await seed.channel({ server, members: [owner], name: "general-bridge" });
  const secret = await seed.channel({ server, members: [owner], name: "secret-bridge", visibility: "private" });
  const mine = await seed.channel({ server, members: [owner, member], name: "mine-bridge", visibility: "private" });

  const { provider, calls } = fakeProvider();
  const controlPlane = createSlackBridgeProvisioningControlPlane({ db: getDb(), bootstrap: BOOTSTRAP, provider });
  const now = new Date();
  const as = (userId: string) => ({ serverId: server.id, requestingUserId: userId, now });

  const connected = parsed(await controlPlane.connect(as(owner.id)));
  assert.equal(connected.snapshot.stage, "oauth");
  assert.ok(connected.oauthAuthority, "a manager at the OAuth stage receives the authority to start it");

  // A member sees the OAuth step read-only: no authority to start it.
  const memberOAuth = parsed(await controlPlane.load(as(member.id)));
  assert.equal(memberOAuth.snapshot.stage, "oauth");
  assert.equal(memberOAuth.oauthAuthority, null);

  const [grant] = await getDb().select().from(externalAppServerGrants).where(and(
    eq(externalAppServerGrants.serverId, server.id),
    eq(externalAppServerGrants.registrationId, REGISTRATION_ID),
  ));
  const [install] = await getDb().insert(externalAppInstalls).values({
    serverId: server.id,
    registrationId: REGISTRATION_ID,
    serverGrantId: grant.id,
    grantEpoch: grant.grantEpoch,
    state: "active",
    installedScopes: [...SLACK_BRIDGE_REQUIRED_BOT_SCOPES],
    providerAppId: BOOTSTRAP.providerAppId,
    providerTeamId: "T_MEMBER_READ",
    authorityType: "team",
    providerAuthorityId: "T_MEMBER_READ",
    botUserId: "U_MEMBER_READ_BOT",
    providerBotId: "B_MEMBER_READ_BOT",
    workspaceName: "Member Read Workspace",
  }).returning();
  await getDb().insert(externalAppInstallServerGrants).values({
    installId: install.id,
    serverId: server.id,
    registrationId: REGISTRATION_ID,
    serverGrantId: grant.id,
    grantEpoch: grant.grantEpoch,
    authorizedByType: "human",
    authorizedById: owner.id,
  });
  await getDb().insert(externalAppCredentials).values({
    installId: install.id,
    encryptedMaterial: "sealed-test-material",
    envelopeKeyId: "test-key",
    credentialRevision: install.credentialRevision,
  });
  const bindingFor = (channelId: string, providerConversationId: string, privacyClass: "public" | "private") => ({
    serverId: server.id,
    registrationId: REGISTRATION_ID,
    installId: install.id,
    channelId,
    providerConversationId,
    providerConversationKind: privacyClass === "public" ? "public_channel" as const : "private_channel" as const,
    privacyClass,
    ...(privacyClass === "private"
      ? { audienceRevision: 1, audienceFreshUntil: new Date(now.getTime() + 60 * 60_000) }
      : {}),
    state: "paused" as const,
    stateReason: "provisioning_preflight_pending",
    grantEpoch: grant.grantEpoch,
    connectionEpoch: install.connectionEpoch,
    consentedByType: "human" as const,
    consentedById: owner.id,
    consentedAt: now,
  });
  const [generalBinding, secretBinding, mineBinding] = await getDb().insert(externalChannelBindings).values([
    bindingFor(general.id, "C_GENERAL", "public"),
    bindingFor(secret.id, "C_SECRET", "private"),
    bindingFor(mine.id, "C_MINE", "private"),
  ]).returning();

  // Managers keep the full projection: every channel, the whole Slack
  // inventory, all pairs and bindings, and the OAuth authority.
  const adminView = parsed(await controlPlane.load(as(admin.id)));
  assert.equal(adminView.snapshot.stage, "preflight");
  assert.ok(adminView.oauthAuthority, "a manager past connect keeps the re-authorization authority");
  const adminRaftIds = adminView.snapshot.raftChannels.map((channel) => channel.id);
  for (const id of [general.id, secret.id, mine.id]) assert.ok(adminRaftIds.includes(id));
  assert.deepEqual(
    adminView.snapshot.slackChannels.map((channel) => channel.id).sort(),
    ["C_GENERAL", "C_MINE", "C_SECRET", "C_UNPAIRED"],
  );
  assert.deepEqual(
    adminView.snapshot.channelPairs.map((pair) => pair.slackChannelId).sort(),
    ["C_GENERAL", "C_MINE", "C_SECRET"],
  );
  assert.deepEqual(
    adminView.snapshot.rawHealth.bindings.map((binding) => binding.id).sort(),
    [generalBinding.id, mineBinding.id, secretBinding.id].sort(),
  );
  assert.deepEqual(parsed(await controlPlane.load(as(owner.id))), adminView, "owner and admin see the same projection");

  // A member sees the same setup progress, narrowed to channels they can view.
  const readsBefore = calls.readWorkspace;
  const memberView = parsed(await controlPlane.load(as(member.id)));
  assert.equal(calls.readWorkspace, readsBefore + 1, "a member read observes the workspace once, like a manager read");
  assert.equal(memberView.oauthAuthority, null);
  assert.equal(memberView.snapshot.stage, adminView.snapshot.stage);
  assert.deepEqual(memberView.snapshot.preflight, adminView.snapshot.preflight);
  assert.equal(memberView.snapshot.workspaceName, "Member Read Workspace");
  const memberRaftIds = memberView.snapshot.raftChannels.map((channel) => channel.id);
  assert.ok(memberRaftIds.includes(general.id), "public channels are visible");
  assert.ok(memberRaftIds.includes(mine.id), "private channels the member belongs to are visible");
  assert.ok(!memberRaftIds.includes(secret.id), "a private channel the member is not in stays hidden");
  assert.deepEqual(
    memberView.snapshot.channelPairs.map((pair) => [pair.raftChannelId, pair.slackChannelId]).sort(),
    [[general.id, "C_GENERAL"], [mine.id, "C_MINE"]].sort(),
  );
  assert.deepEqual(
    memberView.snapshot.slackChannels.map((channel) => channel.id).sort(),
    ["C_GENERAL", "C_MINE"],
    "members see only the paired Slack channels, never the workspace inventory",
  );
  assert.deepEqual(
    memberView.snapshot.rawHealth.bindings.map((binding) => binding.id).sort(),
    [generalBinding.id, mineBinding.id].sort(),
  );
  assert.deepEqual(
    memberView.snapshot.rawHealth.audiences.map((audience) => audience.bindingId).sort(),
    [generalBinding.id, mineBinding.id].sort(),
  );
  const serialized = JSON.stringify(memberView);
  for (const leaked of [secret.id, secret.name, secretBinding.id, "C_SECRET", "slack-secret", "C_UNPAIRED"]) {
    assert.ok(!serialized.includes(leaked), `member projection must not mention ${leaked}`);
  }

  // Non-members and Guests still cannot read anything.
  await rejectsUnauthorized(controlPlane.load(as(outsider.id)), "non-member load");
  await rejectsUnauthorized(controlPlane.load(as(guest.id)), "guest load");

  // Every mutation stays owner/admin only.
  const memberRequest = as(member.id);
  await rejectsUnauthorized(controlPlane.connect(memberRequest), "member connect");
  await rejectsUnauthorized(controlPlane.saveChannelPairs({
    ...memberRequest,
    pairs: [{ raftChannelId: general.id, slackChannelId: "C_UNPAIRED" }],
  }), "member saveChannelPairs");
  await rejectsUnauthorized(controlPlane.removeChannelPairs({
    ...memberRequest,
    pairs: [{ raftChannelId: general.id, slackChannelId: "C_GENERAL", expectedBindingEpoch: generalBinding.bindingEpoch }],
  }), "member removeChannelPairs");
  await rejectsUnauthorized(controlPlane.runPreflight(memberRequest), "member runPreflight");
  await rejectsUnauthorized(controlPlane.enable(memberRequest), "member enable");
  await rejectsUnauthorized(controlPlane.disconnect({
    ...memberRequest,
    expectedConnectionEpoch: install.connectionEpoch,
  }), "member disconnect");
  const bindingsAfter = await getDb().select({ id: externalChannelBindings.id, state: externalChannelBindings.state })
    .from(externalChannelBindings).where(eq(externalChannelBindings.installId, install.id));
  assert.deepEqual(
    bindingsAfter.map((binding) => binding.state),
    ["paused", "paused", "paused"],
    "rejected member mutations leave every binding untouched",
  );
});
