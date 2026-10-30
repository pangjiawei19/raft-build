import assert from "node:assert/strict";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";
import { AxiosHeaders } from "axios";
import api from "../src/api/client";
import { AppSetupPanel, AppSetupRequirement } from "../src/components/integrations/AppSetup";
import { renderWithIntl, TestIntlProvider } from "./helpers/intl";

const url = "https://setup.example.test/configure?installation_id=installation&server_id=server&setup_revision=1";
const pending = { status: "pending", url, description: "Choose a repository", revision: 1, completedAt: null, canConfigure: true };
function response(data: object) { return { data, status: 200, statusText: "OK", headers: {}, config: { headers: new AxiosHeaders() } }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("setup is disclosed before install without turning publisher text into markup", () => {
  renderWithIntl(<AppSetupRequirement url="https://setup.example.test/configure" description="<img src=x onerror=alert(1)>" />);
  assert.ok(screen.getByText("Setup required"));
  assert.ok(screen.getByText(/continue configuration at setup.example.test/));
  assert.ok(screen.getByText("<img src=x onerror=alert(1)>"));
  assert.equal(document.querySelectorAll('img[src="x"]').length, 0);
});

test("opening setup never reports completion; returning refreshes the App-reported state", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(response(pending));
  const put = vi.spyOn(api, "put"); const post = vi.spyOn(api, "post");
  renderWithIntl(<AppSetupPanel clientId="app" serverId="server" />);
  const link = await screen.findByRole("link", { name: "Continue setup" });
  assert.equal(link.getAttribute("href"), url);
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.deepEqual(get.mock.calls[0], ["/integrations/clients/app/setup", { headers: { "X-Server-Id": "server" } }]);
  assert.ok(screen.getByText("Installed, setup pending"));
  get.mockResolvedValue(response({ ...pending, status: "complete", completedAt: "2026-10-16T08:00:00Z" }));
  await act(async () => { window.dispatchEvent(new window.Event("focus")); });
  await screen.findByRole("link", { name: "Manage configuration" });
  assert.ok(screen.getByText("Configured"));
  assert.equal(put.mock.calls.length, 0); assert.equal(post.mock.calls.length, 0);
  cleanup();
  renderWithIntl(<AppSetupPanel clientId="app" serverId="server" />);
  await screen.findByRole("link", { name: "Manage configuration" });
});

test("members see pending state with no administrator link; refreshing does not promote authority", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(response({ ...pending, url: null, canConfigure: false }));
  renderWithIntl(<AppSetupPanel clientId="app" serverId="server" />);
  await screen.findByText("Ask a Server administrator to complete configuration.");
  assert.equal(screen.queryAllByRole("link").length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => assert.equal(get.mock.calls.length, 2));
  assert.equal(screen.queryAllByRole("link").length, 0);
});

test("unsafe setup responses render a bounded error, never a navigation target", async () => {
  vi.spyOn(api, "get").mockResolvedValue(response({ ...pending, url: "javascript:alert(1)" }));
  renderWithIntl(<AppSetupPanel clientId="app" serverId="server" />);
  await screen.findByRole("alert");
  assert.equal(screen.queryAllByRole("link").length, 0);
});

test("switching Server cannot display the late setup URL from the previous Server", async () => {
  let finishFirst!: (value: ReturnType<typeof response>) => void;
  const first = new Promise<ReturnType<typeof response>>((resolve) => { finishFirst = resolve; });
  vi.spyOn(api, "get").mockImplementationOnce(() => first).mockResolvedValue(response({ ...pending, url: "https://second.example.test/setup" }));
  const rendered = renderWithIntl(<AppSetupPanel clientId="app" serverId="first" />);
  rendered.rerender(<TestIntlProvider><AppSetupPanel clientId="app" serverId="second" /></TestIntlProvider>);
  const link = await screen.findByRole("link", { name: "Continue setup" });
  assert.equal(link.getAttribute("href"), "https://second.example.test/setup");
  await act(async () => { finishFirst(response(pending)); });
  assert.equal(screen.getByRole("link", { name: "Continue setup" }).getAttribute("href"), "https://second.example.test/setup");
});
