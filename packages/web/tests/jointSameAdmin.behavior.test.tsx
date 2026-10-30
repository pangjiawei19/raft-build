import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import api from "../src/api/client";
import { TestIntlProvider } from "./helpers/intl";
import CreateJointChannelDialog from "../src/components/channel/CreateJointChannelDialog";
import { useSystemNotifications } from "../src/components/layout/useSystemNotifications";
import { useServerStore } from "../src/store/serverStore";
import { useAgentStore } from "../src/store/agentStore";
import { useAuthStore } from "../src/store/authStore";
import { useChannelStore } from "../src/store/channelStore";

// RFC 075 §4.5: the inviter inviting themselves on a server they administer
// connects directly, but only after an explicit confirmation in the dialog.

const originalApiGet = api.get;
const originalApiPost = api.post;

afterEach(() => {
  cleanup();
  api.get = originalApiGet;
  api.post = originalApiPost;
  useServerStore.setState({ servers: [], current: null, members: [] } as never);
  useAgentStore.setState({ agents: [] } as never);
  useAuthStore.setState({ user: null } as never);
  useChannelStore.setState(useChannelStore.getInitialState(), true);
});

function seed(targetRole: "owner" | "admin" | "member") {
  const source = { id: "s1", slug: "source", name: "Source Co", role: "owner", plan: "pro" };
  const target = { id: "s2", slug: "target", name: "Target Co", role: targetRole, plan: "pro" };
  useAuthStore.setState({ user: { id: "u1", name: "alice", email: "alice@example.com" }, initialized: true } as never);
  useAgentStore.setState({ agents: [] } as never);
  useServerStore.setState({ servers: [source, target], current: source, loading: false, members: [] } as never);
}

function renderDialog() {
  return render(
    <TestIntlProvider locale="en">
      <MemoryRouter>
        <CreateJointChannelDialog onClose={() => {}} />
      </MemoryRouter>
    </TestIntlProvider>,
  );
}

function fillInvite(people: string) {
  fireEvent.change(screen.getByPlaceholderText("e.g. partner-launch"), { target: { value: "shared" } });
  fireEvent.change(screen.getByPlaceholderText("partner-workspace"), { target: { value: "target" } });
  fireEvent.change(screen.getByPlaceholderText("@admin or admin@example.com"), { target: { value: people } });
}

test("inviting yourself on a server you administer needs explicit confirmation and sends sameAdmin", async () => {
  seed("admin");
  const calls: unknown[] = [];
  useChannelStore.setState({
    createChannel: async (_name: string, _description: string | undefined, opts: unknown) => {
      calls.push(opts);
      return { id: "c1" };
    },
  } as never);
  renderDialog();
  fillInvite("@alice");

  const notice = screen.getByTestId("joint-same-admin-notice");
  assert.match(notice.textContent ?? "", /You're an admin of both Source Co and Target Co\. .*no email will be sent\./);

  fireEvent.click(screen.getByRole("button", { name: "Create Joint Channel" }));
  assert.ok(await screen.findByText("Confirm the direct connection, or remove yourself from the invited people."));
  assert.equal(calls.length, 0, "an unconfirmed same-admin invite must not be submitted");

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Create Joint Channel" }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual((calls[0] as { jointInvites: unknown }).jointInvites, [
    { targetServerSlug: "target", invitedPeople: ["@alice"], sameAdmin: true },
  ]);
});

test("no direct-connection notice when you are not an admin of the target or invite someone else", () => {
  seed("member");
  renderDialog();
  fillInvite("alice@example.com");
  assert.ok(screen.queryByTestId("joint-same-admin-notice") === null);

  cleanup();
  seed("owner");
  renderDialog();
  fillInvite("@bob");
  assert.ok(screen.queryByTestId("joint-same-admin-notice") === null);
});

test("pending joint invites appear in the notification center and accept in-app", async () => {
  useServerStore.setState({
    current: { id: "s2", slug: "target", name: "Target Co", role: "admin", plan: "pro" },
    servers: [],
    members: [],
  } as never);
  const posts: string[] = [];
  api.get = (async (url: string) => {
    if (url !== "/channels/joint-invites") return { data: {} };
    return {
      data: {
        invites: [{
          id: "inv-1",
          fromServerName: "Source Co",
          fromServerSlug: "source",
          channelName: "shared",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }],
      },
    };
  }) as typeof api.get;
  api.post = (async (url: string) => {
    posts.push(url);
    return { data: {} };
  }) as typeof api.post;

  const wrapper = ({ children }: { children: ReactElement }) => (
    <TestIntlProvider locale="en"><MemoryRouter>{children}</MemoryRouter></TestIntlProvider>
  );
  const { result } = renderHook(() => useSystemNotifications(), { wrapper });
  await waitFor(() => assert.ok(result.current.some((entry) => entry.id === "joint-invite:inv-1")));
  const entry = result.current.find((candidate) => candidate.id === "joint-invite:inv-1")!;
  assert.equal(entry.title, "Invitation to join #shared");
  assert.equal(entry.action?.label, "Accept");

  await act(async () => {
    entry.action!.onClick();
  });
  await waitFor(() => assert.deepEqual(
    posts.filter((url) => url.startsWith("/channels/")),
    ["/channels/joint-invites/inv-1/accept"],
  ));
});
