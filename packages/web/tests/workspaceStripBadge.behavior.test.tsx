import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, render } from "@testing-library/react";
import { WorkspaceStripButton } from "../src/components/topbar/WorkspaceStripButton";
import type { Server } from "../src/store/serverStore";
import { TestIntlProvider } from "./helpers/intl";

// task #1300 (artin): strip unread dots ride raft-ui AvatarBadge, so the badge
// recipe owns the corner, size and stacking — a neighbouring avatar can no
// longer paint over a dot hand-positioned outside its own avatar.
const server = { id: "s-2", name: "Other", slug: "other" } as unknown as Server;
const noop = () => {};

function renderButton(props: Partial<Parameters<typeof WorkspaceStripButton>[0]>) {
  return render(
    <TestIntlProvider>
      <WorkspaceStripButton server={server} isCurrent={false} shortcut={null} hideTooltip onPick={noop} {...props} />
    </TestIntlProvider>,
  );
}

afterEach(() => cleanup());

test("another workspace's unread is the avatar's raft-ui badge, and the label says it", () => {
  const { getByTestId, getByRole } = renderButton({ hasUnread: true });
  const dot = getByTestId("workspace-strip-unread");
  const shell = dot.closest<HTMLElement>('[data-slot="avatar-badge"]');
  assert.ok(shell !== null, "mounted through AvatarBadge");
  // artin: the dot sits at the avatar's top-right (raft-ui AvatarBadge offset).
  assert.equal(shell.style.left, "100%");
  assert.equal(shell.style.top, "0px");
  assert.match(getByRole("button").getAttribute("aria-label") ?? "", /Other.*unread/i);
});

test("the current workspace carries the other-workspace dot only when asked", () => {
  const plain = renderButton({ isCurrent: true, hasUnread: true });
  assert.ok(plain.queryByTestId("workspace-strip-unread") === null, "its own unread never shows on the current avatar");
  assert.ok(plain.queryByTestId("app-top-bar-workspace-unread") === null);
  cleanup();

  const { getByTestId, getByRole } = renderButton({ isCurrent: true, otherUnread: true });
  const dot = getByTestId("app-top-bar-workspace-unread");
  const shell = dot.closest<HTMLElement>('[data-slot="avatar-badge"]');
  assert.ok(shell !== null, "mounted through AvatarBadge");
  assert.equal(shell.style.left, "100%");
  assert.equal(shell.style.top, "0px");
  assert.match(getByRole("button").getAttribute("aria-label") ?? "", /unread/i);
});
