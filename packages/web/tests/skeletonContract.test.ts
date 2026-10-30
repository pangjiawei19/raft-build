import assert from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Skeleton } from "@botiverse/raft-ui";
import { SkeletonRow, ConversationCardSkeleton } from "../src/components/ui/Skeleton";

// Contract for the loading placeholders. Keeps the idiom consistent:
// animate-pulse, the Raft Design System `rf-skel` look (the sunken fill, the
// 4px sticker radius, never pink, every identity stand-in square), size via
// className, aria-hidden, and a row-composition helper that preserves the real
// row box (layout-shift guard). The primitive is raft-ui's Skeleton; the web
// keeps no local copy of it.

describe("Skeleton primitive (raft-ui)", () => {
  it("always animates and is decorative (aria-hidden)", () => {
    const html = renderToStaticMarkup(createElement(Skeleton));
    assert.match(html, /animate-pulse/);
    assert.match(html, /aria-hidden="true"/);
  });

  it("line variant is a sunken-fill bar with the sticker radius", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { variant: "line" }));
    assert.match(html, /data-variant="line"/);
    assert.match(html, /(?:^|[ "])h-3(?:[ "]|$)/);
    assert.match(html, /data-\[variant=line\]:rounded-sticker data-\[variant=line\]:bg-fill-muted/);
    assert.doesNotMatch(html, /bg-black|rounded-full|bg-attention/);
  });

  it("block variant is a sunken fill with the sticker radius", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { variant: "block" }));
    assert.match(html, /data-variant="block"/);
    assert.match(html, /data-\[variant=block\]:rounded-sticker data-\[variant=block\]:bg-fill-muted/);
    assert.doesNotMatch(html, /bg-black|rounded-full|bg-attention/);
  });

  it("size comes from className, not the primitive", () => {
    const html = renderToStaticMarkup(
      createElement(Skeleton, { variant: "line", className: "w-24 h-5" }),
    );
    assert.match(html, /w-24/);
    assert.match(html, /h-5/);
  });

  it("forwards arbitrary div props (e.g. data-testid)", () => {
    const html = renderToStaticMarkup(
      createElement(Skeleton, { "data-testid": "sk" } as Record<string, unknown>),
    );
    assert.match(html, /data-testid="sk"/);
  });
});

describe("SkeletonRow layout-shift composition", () => {
  it("applies the caller's row height/padding classes so the box matches the real row", () => {
    const html = renderToStaticMarkup(
      createElement(SkeletonRow, {
        className: "gap-1.5 px-2 py-2",
        avatar: true,
        avatarClassName: "size-[18px]",
        lineWidths: ["w-24"],
      }),
    );
    // Outer row carries the real-row sizing classes verbatim.
    assert.match(html, /px-2/);
    assert.match(html, /py-2/);
    // Avatar stand-in matches the real avatar box.
    assert.match(html, /size-\[18px\]/);
    // One text line as requested.
    assert.match(html, /w-24/);
  });

  it("draws the avatar stand-in square, like every DS identity", () => {
    const html = renderToStaticMarkup(
      createElement(SkeletonRow, { avatar: true, lineWidths: ["w-24"] }),
    );
    assert.match(html, /data-variant="block"[^>]*size-\[18px\]|size-\[18px\][^>]*data-variant="block"/);
    assert.doesNotMatch(html, /rounded-full|border-black/);
  });

  it("omits the avatar stand-in when avatar is not requested", () => {
    const html = renderToStaticMarkup(
      createElement(SkeletonRow, { lineWidths: ["w-1/2"] }),
    );
    assert.doesNotMatch(html, /rounded-full/);
  });
});

/** The class lists of the raft-ui Cards in the markup. */
function cardClassLists(html: string): string[][] {
  return [...html.matchAll(/<div\b[^>]*\bdata-slot="card"[^>]*>/g)].map((match) =>
    (match[0].match(/\bclass="([^"]*)"/)?.[1] ?? "").split(/\s+/),
  );
}

describe("ConversationCardSkeleton (inbox/saved shared ~96px card)", () => {
  it("uses themed card surfaces and standard RUI loading bars", () => {
    const html = renderToStaticMarkup(createElement(ConversationCardSkeleton));
    const cards = cardClassLists(html);
    assert.equal(cards.length, 6);
    for (const classes of cards) {
      // raft-ui Card: the card fill, a hairline, the container radius; the
      // real card's 12px padding so the list does not jump.
      for (const token of ["rounded-container", "border", "border-line-hairline", "bg-layer-card", "p-3"]) {
        assert.ok(classes.includes(token), `card skeleton must carry ${token}: ${classes.join(" ")}`);
      }
    }
    assert.doesNotMatch(html, /bg-white|bg-black\/|border-black|theme-brutal:/);
    assert.equal((html.match(/data-slot="skeleton"/g) ?? []).length, 30);
    assert.match(html, /aria-busy="true"/);
  });

  it("renders the requested number of cards", () => {
    const html = renderToStaticMarkup(createElement(ConversationCardSkeleton, { count: 3 }));
    // 3 cards, each carrying the card box padding.
    const cards = cardClassLists(html);
    assert.equal(cards.length, 3);
    assert.ok(cards.every((classes) => classes.includes("p-3")));
  });
});
