// Theme-contract regression for the channel-settings Joint sections.
//
// Both sections once shipped hardcoded black text (`text-black`,
// `text-black/55`) that nearly disappeared on dark surfaces (Artea flagged the
// dark screenshot on 2026-09-28). They are now raft-ui FormSections (the Raft
// Design System's sheet section): a 13/18 700 ink-2 heading
// (`text-foreground-muted`) and an ink-3 (`text-foreground-hint`) line under
// it, with no theme-scoped overrides. These assertions pin the class strings on
// the rendered DOM so a revert cannot silently reintroduce fixed black text.

import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "./helpers/intl";
import JointConversionSection from "../src/components/channel/JointConversionSection";
import JointAttachmentUploadSection from "../src/components/channel/JointAttachmentUploadSection";
import type { RecoveryView } from "../src/utils/directAttachmentUpload";

afterEach(cleanup);

const noop = () => {};

/** A raft-ui FormSection's own title and description elements. */
function formSectionParts(section: HTMLElement) {
  assert.equal(section.getAttribute("data-slot"), "form-section");
  return {
    title: section.querySelector('[data-slot="form-section-title"]'),
    description: section.querySelector('[data-slot="form-section-description"]'),
  };
}

function assertHasClasses(element: Element | null, expected: string[]): void {
  assert.ok(element, `expected element for classes ${expected.join(" ")}`);
  const tokens = (element.getAttribute("class") ?? "").split(/\s+/);
  for (const cls of expected) {
    assert.ok(
      tokens.includes(cls),
      `expected "${cls}" in class="${element.getAttribute("class")}"`,
    );
  }
}

test("JointConversionSection renders the DS section tokens", () => {
  const { container } = renderWithIntl(
    <JointConversionSection
      busy={false}
      disabled={false}
      onStart={noop}
      conversionJob={{ status: "running", phase: "prepare" }}
    />,
  );

  // Task #741: the section's divider is raft-ui's (FormSection draws the rule
  // between consecutive sections), not a web border class.
  const section = screen.getByTestId("channel-settings-joint-conversion-section");
  assert.doesNotMatch(section.className, /(?:^|\s)border-(?:t|b)(?:\s|$)/);
  const { title, description } = formSectionParts(section);
  assertHasClasses(title, [
    "text-footnote",
    "font-bold",
    "text-foreground-muted",
  ]);
  assert.equal(title?.textContent, "Chat with members from other servers");
  assertHasClasses(description, ["text-foreground-hint"]);
  // The CTA is described by that line.
  assert.ok(description?.contains(container.querySelector("#channel-settings-joint-conversion-description")));
  // "In progress" hint on the current conversion stage (the descriptive span
  // inside the stage list that once carried `text-black/55`).
  assertHasClasses(screen.getByText("In progress"), ["text-foreground-hint"]);
});

test("JointAttachmentUploadSection renders the DS section tokens", () => {
  const uploads: RecoveryView[] = [
    {
      uploadId: "u1",
      filename: "evidence.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      state: "pending",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ];
  renderWithIntl(
    <JointAttachmentUploadSection uploads={uploads} onOpenChannel={noop} onCancel={noop} />,
  );

  // Task #741: the section's divider is raft-ui's (FormSection draws the rule
  // between consecutive sections), not a web border class.
  const section = screen.getByTestId("channel-settings-joint-uploads-section");
  assert.doesNotMatch(section.className, /(?:^|\s)border-(?:t|b)(?:\s|$)/);
  const { title, description } = formSectionParts(section);
  assertHasClasses(title, ["text-footnote", "font-bold", "text-foreground-muted"]);
  assertHasClasses(description, ["text-foreground-hint"]);
  // A single upload row has no divider above it (Separators go between rows).
  assert.ok(screen.getByTestId("channel-settings-joint-upload-u1").querySelector('[data-slot="separator"]') === null);
});
