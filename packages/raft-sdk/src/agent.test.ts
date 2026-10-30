import assert from "node:assert/strict";
import * as agent from "./agent";
import * as root from "./index";

test("the agent entry exports createRaftAgent, built on the program-layer client", async () => {
  const calls: string[] = [];
  const raft = agent.createRaftAgent({
    serverUrl: "https://raft.example",
    credential: "sk_agent_sdk_test",
    fetch: async (input) => {
      calls.push(String(input));
      return Response.json({ ok: true, state: "sent", messageId: "message-1" });
    },
  });
  const sent = await raft.routes.messages.send({ body: { target: "#sdk", content: "hello" } });
  assert.equal(sent.ok, true);
  assert.deepEqual(calls, ["https://raft.example/internal/agent-api/send"]);
  assert.equal("createRaftClient" in agent, false, "the program-layer client stays on the root");
  assert.equal("createRaftAgent" in root, false, "the agent factory is only on ./agent");
});

test("the deprecated root aliases create the same agent-layer client", async () => {
  const options = { serverUrl: "https://raft.example", credential: "sk_agent_sdk_test" };
  assert.deepEqual(Object.keys(root.createRaft(options)).sort(), Object.keys(agent.createRaftAgent(options)).sort());
  const store: agent.RaftCredentialStore = {
    load: async () => ({
      schemaVersion: 1,
      serverUrl: "https://raft.example",
      credential: "sk_agent_sdk_test",
      storedAt: "2026-10-19T00:00:00.000Z",
      agentId: "agent-1",
      agentName: "bobo",
      agentDisplayName: "BoBo",
      serverId: "server-1",
      credentialId: "credential-1",
      scopes: ["read", "send"],
    }),
    save: async () => undefined,
  };
  assert.equal(typeof (await root.createRaftFromStore({ store })).invoke, "function");
  assert.equal(typeof (await agent.createRaftAgentFromStore({ store })).invoke, "function");
});

test("helpers and errors are the same values from either entry", () => {
  for (const name of ["RaftSdkConfigurationError", "RaftCredentialError", "SeenFrontier", "raftbenchFailedReport", "raftbenchFailureKind", "RAFT_OPERATIONS"] as const) {
    assert.equal((agent as Record<string, unknown>)[name], (root as Record<string, unknown>)[name], name);
  }
  assert.throws(
    () => agent.createRaftAgent({ serverUrl: "", credential: "sk_agent_sdk_test" }),
    (error: unknown) => error instanceof root.RaftSdkConfigurationError && error.code === "MISSING_SERVER_URL",
  );
});
