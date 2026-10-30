import assert from "node:assert/strict";
import "./helpers/domSetup";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TestIntlProvider } from "./helpers/intl";
import api from "../src/api/client";
import { AppShell } from "../src/App";
import { appLoginRedirect } from "../src/pages/AppLoginPage";
import { useAuthStore } from "../src/store/authStore";
import { useServerStore } from "../src/store/serverStore";
import { PENDING_INVITE_STORAGE_KEY } from "../src/utils/socialAuth";

// Account handoff must reach confirmation and return to the app even when
// workspace loading cannot finish; it must not initiate that workspace work.
const originalGet = api.get;
const originalPost = api.post;
const originalAssign = appLoginRedirect.assign;
const user = {
  id: "handoff-user", email: "handoff@example.com", gravatarHash: "", name: "handoff",
  displayName: "Handoff User", description: null, avatarUrl: null, emailVerified: true,
  profileSetupCompletedAt: "2026-08-21T00:00:00.000Z",
};
let serverLoads = 0;
let summaryLoads = 0;
let assigned: string[] = [];
let gets: string[] = [];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
function mount(path = "/login/app?request=req-1") {
  window.history.replaceState({}, "", path);
  return render(<TestIntlProvider><MemoryRouter initialEntries={[path]}><AppShell /><LocationProbe /></MemoryRouter></TestIntlProvider>);
}

beforeEach(() => {
  serverLoads = summaryLoads = 0;
  assigned = [];
  gets = [];
  localStorage.clear();
  useAuthStore.setState({ user, initialized: true, restoreState: "authenticated", loadUser: async () => {} } as never);
  useServerStore.setState({
    current: null, loading: true, servers: [{ id: "already-known-server" }],
    loadServers: async () => { serverLoads++; await new Promise(() => {}); },
    loadServerUnreadSummary: async () => { summaryLoads++; },
  } as never);
  api.get = (async (url: string) => {
    gets.push(url);
    if (url.startsWith("/auth/app-login/requests/")) return { data: { expiresAt: "2099-01-01T00:00:00Z" } };
    if (url === "/auth/providers") return { data: { providers: [] } };
    return { data: {} };
  }) as typeof api.get;
  api.post = (async () => ({ data: {} })) as typeof api.post;
  appLoginRedirect.assign = (url) => { assigned.push(url); };
});
afterEach(() => {
  cleanup();
  api.get = originalGet;
  api.post = originalPost;
  appLoginRedirect.assign = originalAssign;
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useServerStore.setState(useServerStore.getInitialState(), true);
});

test("signed-in app handoff confirms and returns while servers stay loading, without workspace requests", async () => {
  const posts: string[] = [];
  api.post = (async (url: string) => { posts.push(url); return { data: { redirectUrl: "raft://login/callback?code=one-time" } }; }) as typeof api.post;
  mount();
  const approve = await screen.findByRole("button", { name: "Confirm sign-in" });
  await waitFor(() => assert.equal(approve.hasAttribute("disabled"), false));
  assert.equal(useServerStore.getState().loading, true);
  assert.equal(serverLoads, 0);
  assert.equal(summaryLoads, 0);
  assert.deepEqual(posts, [], "account confirmation remains explicit");
  await act(async () => { fireEvent.click(approve); });
  assert.deepEqual(posts, ["/auth/app-login/requests/req-1/approve"]);
  assert.deepEqual(assigned, ["raft://login/callback?code=one-time"]);
  assert.ok(screen.getByTestId("app-login-returned"));
});

test("password sign-in at the app URL proceeds directly to confirmation without loading servers", async () => {
  useAuthStore.setState({ user: null, restoreState: "anonymous", accessToken: null, refreshToken: null });
  api.post = (async (url: string) => {
    if (url === "/auth/login") return { data: { user, accessToken: "test-access", refreshToken: "test-refresh" } };
    return { data: {} };
  }) as typeof api.post;
  const { container } = mount();
  fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "handoff@example.com" } });
  fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "test-password" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign In", exact: true })); });
  await screen.findByTestId("app-login-confirm");
  assert.equal(serverLoads, 0);
  assert.equal(summaryLoads, 0);
  assert.deepEqual(assigned, []);
});

test("a stored invite cannot consume or redirect the app handoff", async () => {
  localStorage.setItem(PENDING_INVITE_STORAGE_KEY, "later-invite");
  mount();
  await screen.findByTestId("app-login-confirm");
  assert.equal(screen.getByTestId("location").textContent, "/login/app?request=req-1");
  assert.equal(localStorage.getItem(PENDING_INVITE_STORAGE_KEY), "later-invite");
  assert.ok(gets.includes("/auth/app-login/requests/req-1"));
});

test("app handoff retains email verification before request confirmation", async () => {
  useAuthStore.setState({ user: { ...user, emailVerified: false } } as never);
  mount();
  assert.ok(screen.queryByTestId("app-login-confirm") === null);
  assert.ok(screen.getByText("Check your email"));
  assert.equal(gets.some((url) => url.startsWith("/auth/app-login/")), false);
});

test("ordinary workspace entry still loads servers and shows its loading state", async () => {
  mount("/servers");
  await waitFor(() => assert.equal(serverLoads, 1));
  assert.equal(summaryLoads, 1);
  assert.ok(screen.getByText("Loading servers…"));
  assert.equal(gets.some((url) => url.startsWith("/auth/app-login/")), false);
});


test("app handoff retains account identity setup before request confirmation", async () => {
  useAuthStore.setState({ user: { ...user, name: "pending_handoff", profileSetupCompletedAt: null } } as never);
  mount();
  assert.ok(screen.queryByTestId("app-login-confirm") === null);
  assert.ok(screen.getByText("Set up your account"));
  assert.equal(gets.some((url) => url.startsWith("/auth/app-login/")), false);
});

test("OAuth completion does not start workspace loading before its return navigation", async () => {
  api.post = (() => new Promise(() => {})) as typeof api.post;
  mount("/?auth_callback=social&provider=google&code=one-time&returnTo=%2Flogin%2Fapp%3Frequest%3Dreq-1");
  await act(async () => { await Promise.resolve(); });
  assert.equal(serverLoads, 0);
  assert.equal(summaryLoads, 0);
});


test("the existing app route still accepts a trailing slash", async () => {
  mount("/login/app/?request=req-1");
  await screen.findByTestId("app-login-confirm");
  assert.equal(serverLoads, 0);
  assert.equal(summaryLoads, 0);
});
