// Glimpse G2-5: the CLI's thread-target check, from shared, for SDK sends. A
// top-level send right after this context read one of the target's threads
// stops before anything is sent; the thread, or `targetConfirmed`, goes on.
import assert from "node:assert/strict";
import { formatAgentThreadTargetCheck, SeenFrontier } from "@botiverse/raft-shared";
import { createRaft } from "./index";

const credential = "sk_agent_thread_target_sentinel";
const msg = (seq: number, content: string) => ({
  id: `0000000${seq}-0000-0000-0000-000000000000`, seq, sender_name: "sample-human", sender_type: "human", timestamp: "2026-10-17T09:00:00.000Z", content,
});
const page = (messages: unknown[]) => ({ messages, has_more: false, has_older: false, has_newer: false });
const sent = { ok: true, state: "sent", messageId: "00000099-0000-0000-0000-000000000000", messageSeq: 99 };

type Call = { url: string; body: Record<string, unknown> | undefined };
function server(replies: unknown[]) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (next === undefined) throw new Error(`no reply for ${String(input)}`);
    return Response.json(next);
  };
  return { calls, fetch };
}
const sends = (calls: Call[]) => calls.filter((call) => call.url.includes("/send"));

test("a top-level send right after reading one of its threads stops, sends nothing, and resumes with targetConfirmed", async () => {
  const { calls, fetch } = server([page([msg(40, "parent")]), page([msg(41, "in the thread")]), sent]);
  const raft = createRaft({ serverUrl: "https://raft.example", credential, fetch, hints: "tool" });
  raft.frontier.setContext("ctx-1");
  await raft.messages.read({ target: "#ops" });
  await raft.messages.read({ target: "#ops:abcd1234" });

  const held = await raft.invoke("messages.send", { target: "#ops", content: "done", idempotencyKey: "k-1" });
  if (!held.ok || held.state !== "interrupted") return assert.fail("expected an interrupt");
  assert.equal(sends(calls).length, 0, "nothing was sent");
  assert.equal(held.interrupt.reason, "thread_target");
  assert.equal(held.interrupt.threadTarget, "#ops:abcd1234");
  assert.deepEqual(held.interrupt.resume, { idempotencyKey: "k-1", with: { targetConfirmed: true } });
  assert.equal(held.interrupt.contextId, "ctx-1");
  assert.equal(held.text, formatAgentThreadTargetCheck("#ops", "#ops:abcd1234", {
    toThread: ['  messages_send({ target: "#ops:abcd1234", content: … })'],
    confirm: {
      label: "If the top-level message is intentional, send it again with the target confirmed (same idempotencyKey):",
      lines: ['  messages_send({ target: "#ops", targetConfirmed: true, content: … })'],
    },
  }));
  assert.match(held.text, /^Possible thread target mismatch: your latest read context under #ops is #ops:abcd1234/);
  assert.equal(raft.frontier.recordHeld(held.interrupt), false, "nothing to book");

  const resumed = await raft.invoke("messages.send", { target: "#ops", content: "done", idempotencyKey: "k-1", targetConfirmed: true });
  assert.equal(resumed.ok && resumed.state, "sent");
  assert.equal(sends(calls).length, 1);
  assert.equal(Object.hasOwn(sends(calls)[0]!.body!, "targetConfirmed"), false, "a client-side confirmation, not sent to the Server");
});

test("reading the parent after its thread clears the check, and a thread target is never checked", async () => {
  const { calls, fetch } = server([page([msg(41, "in the thread")]), page([msg(42, "parent")]), sent, sent]);
  const raft = createRaft({ serverUrl: "https://raft.example", credential, fetch });
  raft.frontier.setContext("ctx-1");
  await raft.messages.read({ target: "#ops:abcd1234" });
  await raft.messages.read({ target: "#ops" });
  const top = await raft.invoke("messages.send", { target: "#ops", content: "top-level" });
  const inThread = await raft.invoke("messages.send", { target: "#ops:abcd1234", content: "in thread" });
  assert.equal(top.ok && top.state, "sent");
  assert.equal(inThread.ok && inThread.state, "sent");
  assert.equal(sends(calls).length, 2);
});

test("only the model's sends are checked: a direct call and origin \"code\" send as asked", async () => {
  const { calls, fetch } = server([page([msg(40, "parent")]), page([msg(41, "in the thread")]), sent, sent]);
  const raft = createRaft({ serverUrl: "https://raft.example", credential, fetch });
  raft.frontier.setContext("ctx-1");
  await raft.messages.read({ target: "#ops" });
  await raft.messages.read({ target: "#ops:abcd1234" });
  // A bot that reads a thread, then posts its summary to the channel on purpose.
  const direct = await raft.messages.send({ target: "#ops", content: "summary" });
  const fromCode = await raft.invoke("messages.send", { target: "#ops", content: "summary 2" }, { origin: "code" });
  assert.equal(direct.ok && direct.state, "sent");
  assert.equal(fromCode.ok && fromCode.state, "sent");
  assert.equal(sends(calls).length, 2);
});

test("a thread read in another context does not hold this context's top-level send", async () => {
  const { fetch } = server([page([msg(41, "in the thread")]), sent]);
  const raft = createRaft({ serverUrl: "https://raft.example", credential, fetch });
  await raft.invoke("messages.read", { target: "#ops:abcd1234" }, { contextId: "ctx-A" });
  const outcome = await raft.invoke("messages.send", { target: "#ops", content: "fresh topic" }, { contextId: "ctx-B" });
  assert.equal(outcome.ok && outcome.state, "sent");
});

test("read order survives a snapshot, bounded, and an older snapshot without reads checks nothing", () => {
  const frontier = new SeenFrontier();
  frontier.setContext("ctx-1");
  frontier.recordRead("#ops", 40);
  frontier.recordRead("#ops:abcd1234", 41);
  const restored = SeenFrontier.fromSnapshot(frontier.snapshot());
  restored.setContext("ctx-1");
  assert.deepEqual(restored.latestThreadRead("#ops"), { target: "#ops:abcd1234", seq: 41, readOrder: 2 });
  assert.equal(restored.readOrder("#ops"), 1);
  restored.recordRead("#ops");
  assert.equal(restored.readOrder("#ops"), 3, "the counter continues after a restore");

  const { reads: _dropped, ...older } = frontier.snapshot();
  const fromOlder = SeenFrontier.fromSnapshot(older);
  fromOlder.setContext("ctx-1");
  assert.equal(fromOlder.latestThreadRead("#ops"), undefined);
});
