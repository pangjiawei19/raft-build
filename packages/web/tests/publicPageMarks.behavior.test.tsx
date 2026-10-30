import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render } from "@testing-library/react";
import { afterEach, test } from "vitest";
import { ChannelKindIcon } from "../src/components/channel/channelKindIcon";
import { PublicPageGlobe } from "../src/components/server/PublicPageGlobe";
import { TestIntlProvider } from "./helpers/intl";

// cindyz, #wg-rbac:cbca4ee7: members see at a glance what is public. A channel
// carries the globe only when anyone can read it on the public page, which the
// public route allows for ordinary channels only (Ark: a joint, private or
// thread channel with a stray guestVisible must never look public).

afterEach(() => cleanup());

test("only an ordinary channel can carry the public-page globe", () => {
  const { container, rerender } = render(<TestIntlProvider><ChannelKindIcon type="channel" onPublicPage /></TestIntlProvider>);
  assert.equal(container.querySelectorAll("[data-on-public-page]").length, 1);
  for (const type of ["private", "joint", "thread", "dm"] as const) {
    rerender(<TestIntlProvider><ChannelKindIcon type={type} onPublicPage /></TestIntlProvider>);
    assert.equal(container.querySelectorAll("[data-on-public-page]").length, 0, `${type} never shows the globe`);
  }
  rerender(<TestIntlProvider><ChannelKindIcon type="channel" /></TestIntlProvider>);
  assert.equal(container.querySelectorAll("[data-on-public-page]").length, 0, "no globe unless asked");
});

test("the server name is followed by a globe only while its public page is live, and says what it means", () => {
  const { queryByTestId, rerender } = render(<TestIntlProvider><PublicPageGlobe live /></TestIntlProvider>);
  const globe = queryByTestId("public-page-globe");
  assert.ok(globe !== null);
  assert.match(globe.textContent ?? "", /anyone can read/i, "screen readers get the meaning, not just an icon");
  assert.match(globe.getAttribute("title") ?? "", /anyone can read/i, "pointer users get it as a tooltip");
  rerender(<TestIntlProvider><PublicPageGlobe live={false} /></TestIntlProvider>);
  assert.ok(queryByTestId("public-page-globe") === null);
});

test("a public channel's glyph says what it means to screen readers and on hover; a plain # says nothing extra", () => {
  const { container, rerender } = render(<TestIntlProvider><div data-testid="row"><ChannelKindIcon type="channel" onPublicPage /><span>general</span></div></TestIntlProvider>);
  const row = container.querySelector("[data-testid=row]")!;
  assert.match(row.textContent ?? "", /anyone can read this channel on the public page, general$/i, "the row's text, and so its accessible name, carries the meaning as its own phrase");
  assert.ok(container.querySelector("[data-on-public-page]")?.getAttribute("aria-hidden") !== null, "the drawing itself stays hidden");
  assert.match(container.querySelector("[title]")?.getAttribute("title") ?? "", /anyone can read/i, "pointer users get it as a tooltip");
  rerender(<TestIntlProvider><div data-testid="row"><ChannelKindIcon type="channel" /><span>general</span></div></TestIntlProvider>);
  assert.equal(container.querySelector("[data-testid=row]")!.textContent, "general");
});
