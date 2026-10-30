import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./helpers/domSetup";
import { TestIntlProvider } from "./helpers/intl";
import LoginPage from "../src/components/auth/LoginPage";
import type { AccountLinkSignIn } from "../src/components/auth/LoginPage";

vi.mock("../src/hooks/useAccountLinkSignIn", () => ({ useAccountLinkSignIn: () => undefined }));
const fixture = vi.hoisted(() => ({ login: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/store/authStore", () => ({
  useAuthStore: (select: (state: object) => unknown) => select({ login: fixture.login, loading: false }),
}));
vi.mock("../src/hooks/useAuthProviders", () => ({
  useAuthProviders: () => ({ enabledProviders: [{ id: "github", label: "GitHub", enabled: true }] }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(overrides: Partial<AccountLinkSignIn> = {}) {
  const accountLink = {
    terminal: null, restart: vi.fn(), attemptId: "test-attempt", provider: "google" as const, providerLabel: "Google", email: "", signInMethods: { password: true, providers: ["github" as const] }, busy: false, error: "", signIn: vi.fn().mockResolvedValue(undefined),
    socialSignIn: vi.fn(), cancel: vi.fn(), ...overrides,
  };
  render(<TestIntlProvider><LoginPage onForgotPassword={vi.fn()} accountLink={accountLink} /></TestIntlProvider>);
  return accountLink;
}

test("existing account credentials complete the connection flow, never ordinary sign-in", async () => {
  const link = mount();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "existing@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "existing-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in and connect Google" }));
  await waitFor(() => expect(link.signIn).toHaveBeenCalledWith("existing@example.com", "existing-password"));
  expect(fixture.login).not.toHaveBeenCalled();
  expect(screen.getByText(/Sign in the way you usually do/)).toBeTruthy();
});

test("an original social provider resumes the pending connection and cancellation is explicit", () => {
  const link = mount();
  fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
  expect(link.socialSignIn).toHaveBeenCalledWith("github");
  fireEvent.click(screen.getByRole("button", { name: "Don't connect Google" }));
  expect(link.cancel).toHaveBeenCalledOnce();
  expect(fixture.login).not.toHaveBeenCalled();
});

test("pending connection cannot be resubmitted while completing", () => {
  mount({ busy: true });
  expect(screen.getByRole("button", { name: "Signing in…" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Don't connect Google" }).hasAttribute("disabled")).toBe(true);
});
