import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TEXT_PREVIEW_BYTE_LIMIT } from "@botiverse/raft-shared";

import api from "../src/api/client";
import ImageLightbox from "../src/components/ImageLightbox";
import PublicServerPage from "../src/pages/PublicServerPage";
import { useImageLightboxStore } from "../src/store/imageLightboxStore";
import { renderWithIntl } from "./helpers/intl";

// The API on its own origin, as in production: the member PDF frame only
// renders a PDF from an origin other than the app's.
vi.mock("../src/desktopRuntimeEnvironment", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/desktopRuntimeEnvironment")>(),
  RUNTIME_API_BASE: "https://api.example.test/api",
}));

// Product decision (cindyz): public pages preview Markdown, text and PDF files
// like members do, but only through the public attachment route. Kept apart
// from publicServerRichMessages.behavior.test.tsx (CI worker memory).

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
const originalFetch = globalThis.fetch;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  globalThis.fetch = originalFetch;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  useImageLightboxStore.getState().close();
});

const sender = { displayName: "Cindy", avatarUrl: null, description: null };
const PUBLIC_ATTACHMENT = /\/api\/public\/servers\/open-team\/attachments\//;

type TestAttachment = { id: string; filename: string; mimeType: string; sizeBytes: number; width?: number | null; height?: number | null };

function renderPublicMessage(attachments: TestAttachment[], bodies: Record<string, string> = {}) {
  const apiReads: string[] = [];
  api.get = (async (url: string) => {
    apiReads.push(url);
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
      content: "files",
      createdAt: "2026-09-08T08:00:00.000Z",
      threadId: null,
      replyCount: 0,
      attachments: attachments.map((attachment) => ({ width: null, height: null, ...attachment })),
      mentions: [],
      reactions: [],
    }] } };
    throw new Error(`unexpected read ${url}`);
  }) as typeof api.get;
  api.post = (async (url: string) => assert.fail(`the public page must not write: ${url}`)) as typeof api.post;
  const fetches: Array<{ url: string; credentials: RequestCredentials | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // The page's own visit beacon is not an attachment read.
    if (url.includes("/public-visits/")) return new Response(null, { status: 204 });
    fetches.push({ url, credentials: init?.credentials });
    const id = /\/attachments\/([^/?]+)$/.exec(url)?.[1];
    const body = id ? bodies[id] : undefined;
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
  const downloads: Array<{ href: string; download: string }> = [];
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download });
  };
  renderWithIntl(
    <MemoryRouter>
      <PublicServerPage slug="open-team" onSignIn={() => {}} onRegister={() => {}} onUnavailable={() => {}} />
      <ImageLightbox />
    </MemoryRouter>,
  );
  return { apiReads, fetches, downloads };
}

async function attachmentsRegion() {
  const row = await screen.findByTestId("public-server-message-row");
  return within(row).getByTestId("read-only-message-attachments");
}

function assertNoMemberAttachmentCalls(apiReads: string[], fetches: Array<{ url: string }>) {
  for (const url of [...apiReads, ...fetches.map((entry) => entry.url)]) {
    assert.ok(!/\/api\/attachments\//.test(url) && !url.startsWith("/attachments/"), `member attachment endpoint requested: ${url}`);
    assert.ok(!url.includes("/messages/attachment-preview"), `member preview gate requested: ${url}`);
  }
}

test("a public markdown chip opens the read-only preview with content fetched anonymously from the public route", async () => {
  const { apiReads, fetches, downloads } = renderPublicMessage(
    [{ id: "att-md", filename: "plan.md", mimeType: "text/markdown", sizeBytes: 64 }],
    { "att-md": "# Launch plan\n\nShip the **public preview** next week.\n" },
  );

  fireEvent.click(within(await attachmentsRegion()).getByText("plan.md"));

  const heading = await screen.findByRole("heading", { name: "Launch plan" });
  assert.equal(heading.tagName, "H1");
  assert.ok(screen.getByText("public preview").closest("strong") !== null, "markdown renders through the member renderer");
  assert.equal(fetches.length, 1);
  assert.match(fetches[0]!.url, /\/api\/public\/servers\/open-team\/attachments\/att-md$/);
  assert.equal(fetches[0]!.credentials, "omit");
  assert.equal(downloads.length, 0, "a previewable file does not download on click");

  // Download stays available inside the preview, through the public route.
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  assert.equal(downloads.length, 1);
  assert.match(downloads[0]!.href, /\/api\/public\/servers\/open-team\/attachments\/att-md\?download=1$/);
  assert.equal(downloads[0]!.download, "plan.md");

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => assert.ok(screen.queryByRole("heading", { name: "Launch plan" }) === null));
  assertNoMemberAttachmentCalls(apiReads, fetches);
});

test("public text and CSV chips preview as plain text", async () => {
  const { apiReads, fetches } = renderPublicMessage(
    [
      { id: "att-log", filename: "server.log", mimeType: "application/octet-stream", sizeBytes: 32 },
      { id: "att-csv", filename: "numbers.csv", mimeType: "text/csv", sizeBytes: 16 },
    ],
    { "att-log": "line one\n<script>alert(1)</script>\n", "att-csv": "a,b\n1,2\n" },
  );
  const region = await attachmentsRegion();

  fireEvent.click(within(region).getByText("server.log"));
  await screen.findByText("<script>alert(1)</script>");
  assert.ok(document.querySelector("script") === null, "text is shown as text, never parsed as markup");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  fireEvent.click(within(region).getByText("numbers.csv"));
  await screen.findByText("1,2");
  assert.deepEqual(fetches.map((entry) => entry.url.replace(/^.*\/attachments\//, "")), ["att-log", "att-csv"]);
  assert.ok(fetches.every((entry) => PUBLIC_ATTACHMENT.test(entry.url)));
  assertNoMemberAttachmentCalls(apiReads, fetches);
});

test("public HTML and SVG attachments stay download-only, whatever their MIME claims", async () => {
  const { apiReads, fetches, downloads } = renderPublicMessage([
    { id: "att-html", filename: "report.html", mimeType: "text/html", sizeBytes: 64 },
    { id: "att-html-plain", filename: "page.htm", mimeType: "text/plain", sizeBytes: 64 },
    { id: "att-svg", filename: "logo.svg", mimeType: "image/svg+xml", sizeBytes: 64 },
    { id: "att-svg-plain", filename: "icon.svg", mimeType: "text/plain", sizeBytes: 64 },
  ]);
  const region = await attachmentsRegion();

  for (const filename of ["report.html", "page.htm", "logo.svg", "icon.svg"]) {
    fireEvent.click(within(region).getByText(filename));
  }
  assert.deepEqual(downloads.map((entry) => entry.href.replace(/^.*\/attachments\//, "")), [
    "att-html?download=1",
    "att-html-plain?download=1",
    "att-svg?download=1",
    "att-svg-plain?download=1",
  ]);
  assert.equal(fetches.length, 0, "active content is never fetched for preview");
  assert.ok(screen.queryByRole("button", { name: "Download" }) === null, "no preview opened");
  assertNoMemberAttachmentCalls(apiReads, fetches);
});

test("an oversize public text file falls back to download, before and while reading", async () => {
  const { fetches, downloads } = renderPublicMessage(
    [
      { id: "att-big", filename: "huge.txt", mimeType: "text/plain", sizeBytes: TEXT_PREVIEW_BYTE_LIMIT + 1 },
      // The projection's size is metadata; the cap also holds on the bytes read.
      { id: "att-lying", filename: "small.txt", mimeType: "text/plain", sizeBytes: 10 },
    ],
    { "att-lying": "x".repeat(TEXT_PREVIEW_BYTE_LIMIT + 1) },
  );
  const region = await attachmentsRegion();

  fireEvent.click(within(region).getByText("huge.txt"));
  assert.equal(fetches.length, 0, "a file over the cap is not fetched for preview");
  assert.equal(downloads.length, 1);
  assert.match(downloads[0]!.href, /\/attachments\/att-big\?download=1$/);

  fireEvent.click(within(region).getByText("small.txt"));
  await waitFor(() => assert.equal(downloads.length, 2));
  assert.match(downloads[1]!.href, /\/attachments\/att-lying\?download=1$/);
  assert.equal(fetches.length, 1);
  assert.ok(screen.queryByRole("button", { name: "Download" }) === null, "no truncated preview opened");
});

test("a public PDF opens the member PDF preview on the public inline-PDF URL", async () => {
  const { apiReads, fetches, downloads } = renderPublicMessage([
    { id: "att-pdf", filename: "paper.pdf", mimeType: "application/pdf", sizeBytes: 4096 },
  ]);

  fireEvent.click(within(await attachmentsRegion()).getByText("paper.pdf"));

  const download = await screen.findByRole("button", { name: "Download" });
  const frame = await screen.findByTitle(/paper\.pdf/);
  assert.equal(frame.tagName, "IFRAME");
  assert.equal(frame.getAttribute("src"), "https://api.example.test/api/public/servers/open-team/attachments/att-pdf?disposition=inline");
  assert.ok(frame.getAttribute("sandbox") === null, "the member cross-origin PDF frame, unchanged");
  assert.equal(downloads.length, 0);
  fireEvent.click(download);
  assert.match(downloads[0]!.href, /\/attachments\/att-pdf\?download=1$/);
  assert.equal(fetches.length, 0);
  assertNoMemberAttachmentCalls(apiReads, fetches);
});

test("a public image opens the shared lightbox on public URLs, downloading through the public route", async () => {
  const { apiReads, fetches, downloads } = renderPublicMessage([
    { id: "att-image", filename: "photo.png", mimeType: "image/png", sizeBytes: 2048, width: 640, height: 480 },
  ]);

  fireEvent.click(within(await attachmentsRegion()).getByRole("button", { name: "Preview photo.png" }));

  await waitFor(() => assert.equal(useImageLightboxStore.getState().isOpen, true));
  const lightboxImages = Array.from(document.querySelectorAll("img")).filter((img) => !img.closest("[data-testid=\"read-only-message-attachments\"]"));
  assert.ok(lightboxImages.some((img) => /\/api\/public\/servers\/open-team\/attachments\/att-image$/.test(img.getAttribute("src") ?? "")));
  const lightboxDownloads = screen.getAllByRole("button", { name: /download/i });
  fireEvent.click(lightboxDownloads[lightboxDownloads.length - 1]!);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0]!.href, /\/attachments\/att-image\?download=1$/);
  assertNoMemberAttachmentCalls(apiReads, fetches);
});
