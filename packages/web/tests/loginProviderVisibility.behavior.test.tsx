import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "./helpers/domSetup";
import { TestIntlProvider } from "./helpers/intl";
import LoginPage from "../src/components/auth/LoginPage";
import type { AccountLinkSignIn } from "../src/components/auth/LoginPage";
import { __resetAuthProvidersForTest } from "../src/hooks/useAuthProviders";
import type { AuthProvider } from "../src/hooks/useAuthProviders";

const fixture = vi.hoisted(() => ({ get: vi.fn(), login: vi.fn() }));
vi.mock("../src/api/client", () => ({ default: { get: fixture.get } }));
vi.mock("../src/store/authStore", () => ({
  useAuthStore: (select: (state: object) => unknown) => select({ login: fixture.login, loading: false }),
}));
vi.mock("../src/hooks/useAccountLinkSignIn", () => ({ useAccountLinkSignIn: () => undefined }));

afterEach(() => { cleanup(); __resetAuthProvidersForTest(); vi.clearAllMocks(); });

const providers: AuthProvider[] = [
  { id: "google", label: "Google", enabled: true },
  { id: "github", label: "GitHub", enabled: true },
];

function pending(overrides: Partial<AccountLinkSignIn> = {}): AccountLinkSignIn {
  return {
    terminal: null, restart: vi.fn(), attemptId: "provider-visibility", provider: "google", providerLabel: "Google",
    email: "existing@example.test", signInMethods: { password: true, providers: ["github"] },
    busy: false, error: "", signIn: vi.fn(), socialSignIn: vi.fn(), cancel: vi.fn(), ...overrides,
  };
}

async function mount(available: AuthProvider[], accountLink?: AccountLinkSignIn) {
  fixture.get.mockResolvedValue({ data: { providers: available } });
  await act(async () => { render(<TestIntlProvider><LoginPage onForgotPassword={vi.fn()} accountLink={accountLink} /></TestIntlProvider>); });
  expect(fixture.get).toHaveBeenCalledWith("/auth/providers");
}

test("ordinary sign-in hides unavailable social methods and their divider", async () => {
  await mount(providers.map((provider) => ({ ...provider, enabled: false })));
  expect(screen.queryAllByRole("button", { name: /Continue with/ }).length).toBe(0);
  expect(screen.queryByText("or", { exact: true })).toBeNull();
  expect(screen.getByLabelText("Password")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Sign In" })).toBeTruthy();
});

test("ordinary sign-in shows only the enabled method and its divider", async () => {
  await mount(providers.map((provider) => ({ ...provider, enabled: provider.id === "google" })));
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue with GitHub" })).toBeNull();
  expect(screen.getByText("or", { exact: true })).toBeTruthy();
});

test("pending connection offers only an enabled method already owned by the existing account", async () => {
  await mount(providers, pending());
  expect(screen.getByRole("heading", { name: "Connect to your existing account" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  expect(screen.getByText("or", { exact: true })).toBeTruthy();
});

test("pending connection does not offer a disabled original method or an empty divider", async () => {
  await mount(providers.map((provider) => ({ ...provider, enabled: provider.id === "google" })), pending());
  expect(screen.queryAllByRole("button", { name: /Continue with/ }).length).toBe(0);
  expect(screen.queryByText("or", { exact: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in and connect Google" })).toBeTruthy();
});

test("terminal provider conflict hides original sign-in methods and their divider", async () => {
  await mount(providers, pending({ terminal: "conflict" }));
  expect(screen.queryAllByRole("button", { name: /Continue with/ }).length).toBe(0);
  expect(screen.queryByText("or", { exact: true })).toBeNull();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.getByRole("button", { name: "Back to Sign In" })).toBeTruthy();
});
