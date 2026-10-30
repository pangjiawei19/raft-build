import assert from "node:assert/strict";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, toast } from "@botiverse/raft-ui";
import LocalizedToastProvider from "../src/components/LocalizedToastProvider";
import { TestIntlProvider } from "./helpers/intl";

// raft-ui ThemeProvider reads matchMedia on mount; jsdom does not implement it.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});

test("toast status renders as the DS result pixel without chrome and keeps the caller content class", async () => {
  render(
    <ThemeProvider defaultTheme="raft" defaultMode="light">
      <TestIntlProvider>
        <LocalizedToastProvider>
          <div />
        </LocalizedToastProvider>
      </TestIntlProvider>
    </ThemeProvider>,
  );

  act(() => {
    toast.success("Removed", {
      action: { label: "Undo", onClick: () => {} },
      contentClassName: "caller-toast-content",
    });
  });

  const icon = await screen.findByTestId("localized-toast-icon");
  const iconClasses = [...icon.classList];
  for (const chrome of ["border-2", "bg-layer-canvas", "p-1", "p-1.5", "shadow-[2px_2px_0_0_black]", "size-7", "size-8"]) {
    assert.ok(!iconClasses.includes(chrome), `status icon must not carry button chrome class ${chrome}`);
  }
  for (const reset of ["size-5", "border-0", "bg-transparent", "p-0", "shadow-none"]) {
    assert.ok(iconClasses.includes(reset), `status icon must render icon-only (${reset})`);
  }
  // Raft Design System › Toast: a receipt with no "who" leads with one status
  // pixel that says the result (done = lime), not an icon.
  const pixel = screen.getByTestId("localized-toast-pixel");
  assert.match(pixel.className, /\bbg-task-status-done\b/);
  assert.match(pixel.className, /rounded-\[2px\] border-\[1\.5px\] border-sticker-ink/);
  assert.ok(icon.querySelector("svg") === null);

  assert.ok(
    screen.getByTestId("localized-toast-content-row").classList.contains("caller-toast-content"),
    "contentClassName passed to toast.* must reach the rendered toast content",
  );
});
