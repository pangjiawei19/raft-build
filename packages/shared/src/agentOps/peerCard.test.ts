import { describe, expect, it } from "vitest";

import { peerCardHasContent, peerCardId, peerCardRev, renderPeerCard, senderObservationId, senderRev } from "./passiveResources";

const richard = { kind: "human" as const, name: "richard", description: "Founder. Prefers short updates.", timezone: "Asia/Shanghai" };

describe("DM peer card", () => {
  it("is the sender resource: same id and version as a message from the peer", () => {
    expect(peerCardId(richard)).toBe(senderObservationId("human", "richard"));
    expect(peerCardRev(richard)).toBe(senderRev(richard.description, richard.timezone));
  });

  it("shows the peer, kind, zone and description, then the equivalent command", () => {
    expect(renderPeerCard(richard)).toEqual([
      "DM peer @richard (human, Asia/Shanghai): Founder. Prefers short updates.",
      "Equivalent: raft user info @richard",
    ]);
    expect(renderPeerCard({ kind: "agent", name: "Scout" })[0]).toBe("DM peer @Scout (agent): no description.");
  });

  it("caps a long description like a channel card's, keeping the equivalent command", () => {
    const lines = renderPeerCard({ kind: "agent", name: "Scout", description: "a".repeat(310) });
    expect(lines[0]).toBe(`DM peer @Scout (agent): ${"a".repeat(300)}…⟨10 more chars⟩`);
    expect(lines[1]).toBe("Equivalent: raft user info @Scout");
  });

  it("has content only with a description or a zone", () => {
    expect(peerCardHasContent({ kind: "agent", name: "x" })).toBe(false);
    expect(peerCardHasContent({ kind: "agent", name: "x", description: "  " })).toBe(false);
    expect(peerCardHasContent({ kind: "human", name: "x", timezone: "UTC" })).toBe(true);
  });
});
