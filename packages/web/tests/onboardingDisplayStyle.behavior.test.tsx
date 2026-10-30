import assert from "node:assert/strict";
import "./helpers/domSetup";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../src/api/client";
import AccountIdentitySetupPage from "../src/components/auth/AccountIdentitySetupPage";
import ServerSetupProjectionGate from "../src/components/onboarding/ServerSetupProjectionGate";
import { useServerSetupRevision } from "../src/components/onboarding/serverSetupProjection";
import { useAuthStore } from "../src/store/authStore";
import type { User } from "../src/store/authStore";
import { useMachineStore } from "../src/store/machineStore";
import { AppThemeProvider } from "../src/theme/AppThemeProvider";
import { APP_THEME_PREFERENCES_STORAGE_KEY } from "../src/theme/appTheme";
import {
  completeOnboardingDisplayStyle,
  markOnboardingDisplayStylePending,
  resetOnboardingDisplayStyleSessionForTest,
} from "../src/utils/onboardingDisplayStyle";
import { TestIntlProvider } from "./helpers/intl";

/**
 * Task #247: a new account picks its display style once during onboarding.
 * Owners get it between the survey and the handoff; invited members get it as
 * a dialog where the setup gate would otherwise render nothing. Only account
 * setup opens the prompt, so accounts that existed before are never asked.
 */

const PENDING_KEY = "raft:onboarding-display-style:v1";
const initialAuthState = useAuthStore.getInitialState();
const originalGet = api.get.bind(api);

const COMPLETE_WITH_HANDOFF = {
  surface: "complete",
  phase: "complete",
  currentStep: null,
  blocksChat: false,
  gateReason: "setup_complete",
  computerStatus: "online",
  runtimeStatus: "ready",
  postSetup: { surveyPending: false, handoffPending: true },
};

const MEMBER_PROJECTION = {
  surface: "none",
  phase: null,
  currentStep: null,
  blocksChat: false,
  allowedExits: [],
  sideEffectState: { transitions: "disabled", completion: "disabled" },
  gateReason: "insufficient_permission",
};

beforeEach(() => {
  resetOnboardingDisplayStyleSessionForTest();
  window.localStorage.clear();
  useServerSetupRevision.setState({ revision: 0 });
});

afterEach(() => {
  api.get = originalGet as typeof api.get;
  cleanup();
  window.localStorage.clear();
  useAuthStore.setState(initialAuthState, true);
  useMachineStore.setState(useMachineStore.getInitialState(), true);
});

function renderGate(projection: Record<string, unknown>) {
  let reads = 0;
  api.get = (async (url: string) => {
    if (!url.includes("/setup-projection")) return { data: [] };
    reads += 1;
    return { data: projection };
  }) as typeof api.get;
  render(
    <TestIntlProvider>
      <AppThemeProvider>
        <MemoryRouter initialEntries={["/s/acme"]}>
          <ServerSetupProjectionGate serverId="server-1" serverSlug="acme" />
        </MemoryRouter>
      </AppThemeProvider>
    </TestIntlProvider>,
  );
  return { reads: () => reads };
}

async function settle(reads: () => number) {
  await waitFor(() => assert.ok(reads() >= 1, "the gate read the projection"));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test("owner: the style step comes after the survey and before the handoff", async () => {
  markOnboardingDisplayStylePending();
  renderGate(COMPLETE_WITH_HANDOFF);

  await waitFor(() => assert.ok(screen.getByTestId("server-setup-display-style")));
  assert.ok(screen.queryByTestId("server-setup-handoff") === null, "handoff waits for the style step");

  fireEvent.click(screen.getByTestId("server-setup-display-style-continue"));
  await waitFor(() => assert.ok(screen.getByTestId("server-setup-handoff")));
  assert.equal(window.localStorage.getItem(PENDING_KEY), "done");
});

test("owner without a pending choice goes straight to the handoff", async () => {
  renderGate(COMPLETE_WITH_HANDOFF);
  await waitFor(() => assert.ok(screen.getByTestId("server-setup-handoff")));
  assert.ok(screen.queryByTestId("server-setup-display-style") === null);
});

test("invited member: the style dialog shows once, only while pending", async () => {
  markOnboardingDisplayStylePending();
  renderGate(MEMBER_PROJECTION);
  await waitFor(() => assert.ok(screen.getByTestId("server-setup-display-style")));
  assert.ok(screen.queryByTestId("setup-session-footer") === null, "members get no setup escape links");

  fireEvent.click(screen.getByTestId("server-setup-display-style-continue"));
  await waitFor(() => assert.ok(screen.queryByTestId("server-setup-display-style") === null));
});

test("a member who was never marked pending (an existing account) is not asked", async () => {
  const { reads } = renderGate(MEMBER_PROJECTION);
  await settle(reads);
  assert.ok(screen.queryByTestId("server-setup-display-style") === null);
});

test("owner: Continue moves on to the handoff even when the browser refuses to save", async () => {
  markOnboardingDisplayStylePending();
  renderGate(COMPLETE_WITH_HANDOFF);
  await waitFor(() => assert.ok(screen.getByTestId("server-setup-display-style")));

  // jsdom's Storage, not Node's global one.
  const proto = (window as unknown as { Storage: typeof Storage }).Storage.prototype;
  const originalSetItem = proto.setItem;
  proto.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    fireEvent.click(screen.getByTestId("server-setup-display-style-continue"));
    await waitFor(() => assert.ok(screen.getByTestId("server-setup-handoff")));
  } finally {
    proto.setItem = originalSetItem;
  }
  assert.equal(window.localStorage.getItem(PENDING_KEY), "pending", "the save really failed");
});

test("member: Continue closes the dialog even when the browser refuses to save", async () => {
  markOnboardingDisplayStylePending();
  renderGate(MEMBER_PROJECTION);
  await waitFor(() => assert.ok(screen.getByTestId("server-setup-display-style")));

  const proto = (window as unknown as { Storage: typeof Storage }).Storage.prototype;
  const originalSetItem = proto.setItem;
  proto.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    fireEvent.click(screen.getByTestId("server-setup-display-style-continue"));
    await waitFor(() => assert.ok(screen.queryByTestId("server-setup-display-style") === null));
  } finally {
    proto.setItem = originalSetItem;
  }
  assert.equal(window.localStorage.getItem(PENDING_KEY), "pending", "the save really failed");
});

test("marking pending never re-opens a choice already made", () => {
  completeOnboardingDisplayStyle();
  markOnboardingDisplayStylePending();
  assert.equal(window.localStorage.getItem(PENDING_KEY), "done");
});

function newUser(): User {
  return {
    id: "user-1",
    email: "cindy@example.com",
    gravatarHash: "hash",
    name: "pending_1234567890abcdef",
    displayName: null,
    description: null,
    avatarUrl: null,
    emailVerified: true,
    profileSetupCompletedAt: null,
    profileSetupSuggestedHandle: null,
    profileSetupProvider: null,
    preferredLanguage: null,
    preferredTimezone: null,
    autoTranslationEnabled: false,
    preferredTranslationMode: "manual",
    preferredTranslationDisplay: "translated",
    preferredTimeFormat: null,
    preferredMessageBodyFontSize: null,
    referralSource: null,
    referralSourceOther: null,
    referralSourceSkippedAt: null,
  };
}

function renderIdentitySetup() {
  useAuthStore.setState({ user: newUser(), loading: false });
  render(
    <TestIntlProvider>
      <AppThemeProvider>
        <AccountIdentitySetupPage />
      </AppThemeProvider>
    </TestIntlProvider>,
  );
}

test("account setup on a fresh browser starts in Light and opens the prompt", async () => {
  renderIdentitySetup();
  await waitFor(() => assert.equal(window.localStorage.getItem(PENDING_KEY), "pending"));
  const stored = JSON.parse(window.localStorage.getItem(APP_THEME_PREFERENCES_STORAGE_KEY) ?? "null");
  assert.deepEqual(stored, { mode: "light" });
});

test("account setup leaves an existing choice alone and does not ask again", async () => {
  const existing = { mode: "dark" };
  window.localStorage.setItem(APP_THEME_PREFERENCES_STORAGE_KEY, JSON.stringify(existing));
  renderIdentitySetup();
  await waitFor(() => assert.ok(screen.getByRole("heading", { name: "Set up your account" })));
  assert.equal(window.localStorage.getItem(PENDING_KEY), null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(APP_THEME_PREFERENCES_STORAGE_KEY) ?? "null"), existing);
});
