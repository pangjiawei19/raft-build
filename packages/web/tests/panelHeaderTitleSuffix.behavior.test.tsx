import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "@botiverse/raft-ui";

import PanelHeader from "../src/components/ui/PanelHeader";
import { TestIntlProvider } from "./helpers/intl";

afterEach(cleanup);

// A badge beside a panel title is a sticker: in dark mode its die-cut edge is a
// ring drawn outside its box. The title suffix therefore sits in raft-ui's
// PanelStatus, a flex item centred on the head's row, and nothing between it
// and the heading may clip (truncate / overflow-hidden), or the edge is cut.
test("a title suffix sits in PanelStatus with nothing clipping it", () => {
  render(
    <TestIntlProvider>
      <PanelHeader title="关系图" titleSuffix={<Badge.Experimental data-testid="suffix" />} />
    </TestIntlProvider>,
  );

  const badge = screen.getByTestId("suffix");
  assert.equal(badge.parentElement?.getAttribute("data-slot"), "panel-status", "the suffix is PanelStatus's child");
  const heading = badge.closest('[data-slot="panel-heading"]');
  assert.ok(heading, "the suffix shares the title's row");
  for (let el = badge.parentElement; el && el !== heading; el = el.parentElement) {
    assert.doesNotMatch(
      el.className,
      /(?:^| )(?:truncate|overflow-hidden|overflow-clip)(?: |$)/,
      `${el.getAttribute("data-slot") ?? el.tagName} would clip the suffix's edge`,
    );
  }
  assert.doesNotMatch(badge.className, /(?:^| )-?translate-y-/, "the row centres the badge; no hand nudge");
});
