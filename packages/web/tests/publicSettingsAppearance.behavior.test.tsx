import "./helpers/domSetup";

import assert from "node:assert/strict";
import { cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AppearanceSection } from "../src/components/settings/SettingsPanel";
import { renderWithIntl } from "./helpers/intl";

// cindyz, #wg-rbac:22e4889c: on the public server page the live agent activity
// bar, agent model names and Pinned/Joint/DM sidebar groups do not exist, so
// their device toggles would change nothing visible there. Cindy narrowed the
// anonymous public surface further to theme only (#wg-rbac:a88cfff6).

afterEach(() => cleanup());

const PUBLIC_ONLY_HIDDEN = [
  "live-agent-activity-setting-label",
  "agent-model-name-setting-label",
  "hide-empty-sidebar-sections-setting-label",
];

test("the public surface offers only the browser-local theme picker", () => {
  renderWithIntl(<MemoryRouter><AppearanceSection publicSurface /></MemoryRouter>);
  for (const id of PUBLIC_ONLY_HIDDEN) {
    assert.ok(document.getElementById(id) === null, `${id} is hidden on the public surface`);
  }
  assert.ok(screen.getByText("Theme"));
  assert.ok(screen.queryByText("Message font size") === null, "message font size is hidden on the public surface");
});

test("members still get every appearance toggle", () => {
  renderWithIntl(<MemoryRouter><AppearanceSection /></MemoryRouter>);
  for (const id of PUBLIC_ONLY_HIDDEN) {
    assert.ok(document.getElementById(id) !== null, `${id} is offered to members`);
  }
  assert.ok(screen.getByText("Message font size"));
});
