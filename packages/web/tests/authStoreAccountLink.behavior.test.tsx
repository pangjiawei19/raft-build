import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./helpers/domSetup";
import api from "../src/api/client";
import { useAuthStore } from "../src/store/authStore";
import { parsePendingAccountLink, setPendingAccountLink } from "../src/utils/pendingAccountLink";
const pending = parsePendingAccountLink({
  token: "a-valid-pending-link-token", provider: "google", email: "existing@example.com", expiresAt: "2099-01-01T00:00:00Z",
  signInMethods: { password: true, providers: [] }, returnTo: "/",
});
if (!pending) throw new Error("invalid fixture");
const response = {
  user: { id: "existing-user", email: "existing@example.com", name: "Existing", preferredMessageBodyFontSize: "md" },
  accessToken: "linked-session", refreshToken: "linked-refresh",
};
beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, loading: false });
  setPendingAccountLink(pending);
});
afterEach(() => { vi.restoreAllMocks(); setPendingAccountLink(null); localStorage.clear(); });

test("a server that ignores pendingLinkToken cannot publish an unbound login session", async () => {
  vi.spyOn(api, "post").mockResolvedValue({ data: response });
  await expect(useAuthStore.getState().login("existing@example.com", "password", pending)).rejects.toThrow("ACCOUNT_LINK_NOT_COMPLETED");
  expect(useAuthStore.getState().user).toBeNull();
  expect(localStorage.getItem("slock_access_token")).toBeNull();
});

test("binding confirmation precedes publishing the authenticated user and tokens", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ data: { ...response, linkedProvider: "google" } });
  await useAuthStore.getState().login("existing@example.com", "password", pending);
  expect(post).toHaveBeenCalledWith("/auth/login", { email: "existing@example.com", password: "password", pendingLinkToken: pending.token });
  expect(useAuthStore.getState().user?.id).toBe("existing-user");
  expect(localStorage.getItem("slock_access_token")).toBe("linked-session");
});
