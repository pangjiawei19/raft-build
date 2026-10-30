import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import api from "../src/api/client";
import PublicServerPage from "../src/pages/PublicServerPage";
import { renderWithIntl } from "./helpers/intl";

// Kept apart from publicServerPage.behavior.test.tsx, which is near the CI
// worker memory limit. Proves the public page renders attachments, mentions
// and reactions from the public DTO alone: attachment bytes come from the
// public attachment route, and nothing calls a member endpoint or writes.

globalThis.IntersectionObserver = globalThis.IntersectionObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
} as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = globalThis.ResizeObserver ?? class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

const originalGet = api.get;
const originalPost = api.post;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
});

const sender = { displayName: "Cindy", avatarUrl: null, description: null };

test("public messages render attachments, display-name mentions and reaction counts without member calls", async () => {
  const reads: string[] = [];
  api.get = (async (url: string) => {
    reads.push(url);
    if (url === "/public/servers/open-team") return { data: {
      server: { id: "server-1", name: "Open Team", slug: "open-team", avatarUrl: null },
      channels: [{ id: "channel-1", name: "announcements", description: null }],
      canJoinAsGuest: false,
    } };
    if (url === "/public/servers/open-team/channels/channel-1/messages") return { data: { messages: [{
      id: "message-1",
      senderType: "user",
      sender,
      messageType: "chat",
      content: "ping @mona about the plan",
      createdAt: "2026-09-08T08:00:00.000Z",
      threadId: "thread-1",
      replyCount: 1,
      attachments: [
        { id: "att-image", filename: "photo.png", mimeType: "image/png", sizeBytes: 2048, width: 640, height: 480 },
        { id: "att-html", filename: "report.html", mimeType: "text/html", sizeBytes: 512, width: null, height: null },
      ],
      mentions: [{ type: "user", name: "mona", displayName: "Mona Display" }],
      reactions: [{ emoji: "👍", count: 3 }],
    }] } };
    if (url.startsWith("/public/servers/open-team/threads/thread-1/messages?")) return { data: { messages: [{
      id: "reply-1",
      senderType: "user",
      sender,
      messageType: "chat",
      content: "reply with a file",
      createdAt: "2026-09-08T08:01:00.000Z",
      threadId: null,
      replyCount: 0,
      attachments: [{ id: "att-reply", filename: "notes.zip", mimeType: "application/zip", sizeBytes: 10, width: null, height: null }],
      mentions: [],
      reactions: [],
    }] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  api.post = (async (url: string) => assert.fail(`the public page must not write: ${url}`)) as typeof api.post;
  const downloads: Array<{ href: string; download: string }> = [];
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download });
  };

  renderWithIntl(<MemoryRouter><PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} /></MemoryRouter>);

  const row = await screen.findByTestId("public-server-message-row");
  const attachments = within(row).getByTestId("read-only-message-attachments");

  // Images render inline from the public route, never from a CDN thumbnail or
  // the member `/attachments/:id/url` resolver.
  const image = within(attachments).getByAltText("photo.png");
  assert.match(image.getAttribute("src") ?? "", /\/api\/public\/servers\/open-team\/attachments\/att-image$/);
  const imageDownload = within(attachments).getByRole("link", { name: "Download photo.png" });
  assert.match(imageDownload.getAttribute("href") ?? "", /\/api\/public\/servers\/open-team\/attachments\/att-image\?download=1$/);

  // Non-image files are download chips; HTML is never previewed here.
  fireEvent.click(within(attachments).getByText("report.html"));
  assert.equal(downloads.length, 1);
  assert.match(downloads[0]!.href, /\/api\/public\/servers\/open-team\/attachments\/att-html\?download=1$/);
  assert.equal(downloads[0]!.download, "report.html");

  // Mentions show the display name with the member highlight, but are not links.
  const mention = within(row).getByText("@Mona Display");
  assert.equal(mention.closest("[data-message-mention=\"display-only\"]") !== null, true);
  assert.ok(mention.closest("a") === null, "a public mention must not link to a member profile");
  fireEvent.click(mention);
  fireEvent.mouseEnter(mention);

  // Reactions: emoji and count, with no control to react.
  const reaction = within(row).getByLabelText(/👍/);
  assert.match(reaction.textContent ?? "", /3/);
  assert.ok(reaction.closest("button") === null, "a public viewer cannot react");

  fireEvent.click(within(row).getByTestId("message-thread-replies-badge"));
  const thread = await screen.findByTestId("read-only-thread-panel");
  fireEvent.click(await within(thread).findByText("notes.zip"));
  assert.equal(downloads.length, 2);
  assert.match(downloads[1]!.href, /\/api\/public\/servers\/open-team\/attachments\/att-reply\?download=1$/);

  await waitFor(() => assert.deepEqual(reads, [
    "/public/servers/open-team",
    "/public/servers/open-team/channels/channel-1/messages",
    "/public/servers/open-team/threads/thread-1/messages?limit=50",
  ], "the public page reads only the public DTO routes"));
});
