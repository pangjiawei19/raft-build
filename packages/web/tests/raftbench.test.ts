import { describe, expect, it, vi, afterEach } from "vitest";
import { evaluateMessages, exportFindingEvidence } from "../src/raftbench/model";
import type { EvidenceMessage } from "../src/raftbench/model";
import { loadMessageSnapshot } from "../src/raftbench/liveMessages";
import api from "../src/api/client";
vi.mock("../src/api/client", () => ({ default: { get: vi.fn() } }));
const message = (
  id: string,
  content: string,
  minute = 0,
  patch: Partial<EvidenceMessage> = {},
): EvidenceMessage => ({
  id,
  channelId: "c1",
  senderId: "human",
  senderType: "user",
  content,
  createdAt: new Date(Date.UTC(2026, 9, 15, 9, minute)).toISOString(),
  ...patch,
});
afterEach(() => vi.clearAllMocks());
describe("RaftBench evidence rules", () => {
  it("detects explicit English/Chinese friction only in human chat, retaining evidence", () => {
    const messages = [
      message("a", "I already told you."),
      message("b", "还是不行", 1),
      message("c", "Stop asking", 2, { senderType: "agent" }),
      message("d", "还是不行", 3, { messageType: "system" }),
      message("e", "还是不行", 4, { senderType: "external_projection" }),
    ];
    const result = evaluateMessages(messages);
    expect(result.findings.map((f) => f.evidence[0].id)).toEqual(["b", "a"]);
    expect(result.sentiment).toEqual({
      positive: 0,
      negative: 2,
      mixed: 0,
      unscored: 0,
    });
  });
  it("counts mixed wording separately and never calls unscored wording neutral", () => {
    const r = evaluateMessages([
      message("a", "Thanks, this is not helpful."),
      message("b", "Please update the README."),
    ]);
    expect(r.sentiment).toEqual({
      positive: 0,
      negative: 0,
      mixed: 1,
      unscored: 1,
    });
    expect(r.findings[0].kind).toBe("negative");
  });
  it("requires three repeats and isolates actors, channels and 15-minute episodes", () => {
    const repeat = (id: string, m: number, p: Partial<EvidenceMessage> = {}) =>
      message(id, "Please confirm which folder to use.", m, {
        senderType: "agent",
        senderId: "agent1",
        ...p,
      });
    expect(
      evaluateMessages([repeat("a", 0), repeat("b", 1)]).findings,
    ).toHaveLength(0);
    const valid = [
      repeat("a", 0),
      repeat("b", 1, { content: " PLEASE CONFIRM WHICH FOLDER TO USE. " }),
      repeat("c", 2),
    ];
    expect(
      evaluateMessages(valid.reverse()).findings[0].evidence.map((e) => e.id),
    ).toEqual(["a", "b", "c"]);
    for (const patch of [
      { senderId: "other" },
      { channelId: "other" },
      { createdAt: "2026-10-15T10:00:00Z" },
    ])
      expect(
        evaluateMessages([
          repeat("a", 0),
          repeat("b", 1),
          repeat("c", 2, patch),
        ]).findings,
      ).toHaveLength(0);
    expect(
      evaluateMessages([
        repeat("a", 0),
        repeat("b", 1),
        repeat("c", 2),
        repeat("d", 3),
      ]).findings,
    ).toHaveLength(1);
    expect(evaluateMessages(valid, 4).findings).toHaveLength(0);
  });
});
describe("authenticated channel snapshot boundary", () => {
  it("reads exactly the chosen channel/server with cancellation; excludes unrelated metadata from export", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        messages: [
          { ...message("a", "hello"), attachments: [{ private: "excluded" }] },
        ],
        historyLimited: true,
      },
    });
    const controller = new AbortController();
    const r = await loadMessageSnapshot("c1", "s1", controller.signal);
    expect(api.get).toHaveBeenCalledWith("/messages/channel/c1", {
      params: { limit: 200 },
      headers: { "X-Server-Id": "s1" },
      signal: controller.signal,
    });
    expect(r.messages).toEqual([message("a", "hello")]);
    expect(r.historyLimited).toBe(true);
    expect(r.mayHaveOlder).toBe(false);
  });
  it("fails on scope mismatch, malformed row, invalid date, duplicate IDs or denied access", async () => {
    for (const messages of [
      [message("a", "x", 0, { channelId: "other" })],
      [message("a", "x", 0, { createdAt: "bad" })],
      [message("a", "x"), message("a", "x")],
      [{ id: "bad" }],
    ]) {
      vi.mocked(api.get).mockResolvedValue({ data: { messages } });
      await expect(
        loadMessageSnapshot("c1", "s1", new AbortController().signal),
      ).rejects.toThrow();
    }
    vi.mocked(api.get).mockRejectedValue(new Error("403"));
    await expect(
      loadMessageSnapshot("c1", "s1", new AbortController().signal),
    ).rejects.toThrow("403");
  });
});

describe("workspace overview aggregation", () => {
  it("excludes denied channels, reports partial coverage and retains channel identity", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/denied")) throw new Error("403");
      const channelId = String(url).split("/").at(-1)!;
      return {
        data: {
          messages: [message(channelId, "Stop asking", 0, { channelId })],
        },
      };
    });
    const { loadChannelSnapshots } =
      await import("../src/raftbench/liveMessages");
    const result = await loadChannelSnapshots(
      ["c1", "denied", "c2"],
      "s1",
      new AbortController().signal,
    );
    expect(result.channels.map((c) => c.channelId)).toEqual(["c1", "c2"]);
    expect(result.unavailableChannelIds).toEqual(["denied"]);
    expect(result.requestedChannels).toBe(3);
    expect(
      evaluateMessages(result.messages)
        .findings.map((f) => f.evidence[0].channelId)
        .sort(),
    ).toEqual(["c1", "c2"]);
  });
  it("bounds concurrency and cancels without publishing a partial stale overview", async () => {
    let active = 0,
      maximum = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const channelId = String(url).split("/").at(-1)!;
      return {
        data: { messages: [message(channelId, "hello", 0, { channelId })] },
      };
    });
    const { loadChannelSnapshots } =
      await import("../src/raftbench/liveMessages");
    await loadChannelSnapshots(
      Array.from({ length: 9 }, (_, i) => "c" + i),
      "s1",
      new AbortController().signal,
    );
    expect(maximum).toBe(4);
    await expect(
      loadChannelSnapshots(
        Array.from({ length: 21 }, (_, i) => "c" + i),
        "s1",
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    const before = vi.mocked(api.get).mock.calls.length;
    await expect(
      loadChannelSnapshots(["c1"], "s1", controller.signal),
    ).rejects.toThrow();
    expect(api.get).toHaveBeenCalledTimes(before);
  });
});

it("exports matched evidence once without unrelated corpus or nested duplicate bodies", () => {
  const hit = message("hit", "I am frustrated.");
  const result = evaluateMessages([hit, message("normal", "ordinary private text")]);
  const exported = exportFindingEvidence([...result.findings, ...result.findings]);
  expect(exported.messages).toEqual([hit]);
  expect(exported.findings.every((finding) => !Object.hasOwn(finding, "evidence"))).toBe(true);
  expect(JSON.stringify(exported)).not.toContain("ordinary private text");
  expect(exportFindingEvidence([])).toEqual({ findings: [], messages: [] });
});
