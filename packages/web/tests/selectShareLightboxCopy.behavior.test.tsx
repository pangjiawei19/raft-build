import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import SelectShareLightbox from "../src/components/message/SelectShareLightbox";
import { TestIntlProvider } from "./helpers/intl";

const render: typeof rtlRender = (ui, options) =>
  rtlRender(ui, { wrapper: TestIntlProvider, ...options });

const DATA_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Av5NAAAAAElFTkSuQmCC";
// What a validated capture hands the preview (task #1302), at the default 2x.
const IMAGE = {
  dataUrl: DATA_IMAGE,
  blob: new Blob([Uint8Array.from(atob(DATA_IMAGE.split(",")[1]), (c) => c.charCodeAt(0))], { type: "image/png" }),
  width: 1,
  height: 1,
  pixelRatio: 2,
};

type ClipboardPayload = Record<string, Blob | Promise<Blob>>;

class FakeClipboardItem {
  readonly payload: ClipboardPayload;

  constructor(payload: ClipboardPayload) {
    this.payload = payload;
  }
}

const originalClipboardItem = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, "permissions");
let permissionQueryCalls = 0;

function installClipboard(
  write: (items: ClipboardItem[]) => Promise<void>,
  permissionState: PermissionState | null = "granted",
) {
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: FakeClipboardItem,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: permissionState === null
      ? undefined
      : {
          query: async () => {
            permissionQueryCalls += 1;
            return {
              state: permissionState,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
            };
          },
        },
  });
}

beforeEach(() => {
  permissionQueryCalls = 0;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
});

afterEach(() => {
  cleanup();
  if (originalClipboardItem) {
    Object.defineProperty(globalThis, "ClipboardItem", originalClipboardItem);
  } else {
    Reflect.deleteProperty(globalThis, "ClipboardItem");
  }
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalPermissions) {
    Object.defineProperty(navigator, "permissions", originalPermissions);
  } else {
    Reflect.deleteProperty(navigator, "permissions");
  }
});

test("Share preview copies the generated PNG without closing the modal", async () => {
  const writes: ClipboardItem[][] = [];
  installClipboard(async (items) => {
    writes.push(items);
  });
  let closeCalls = 0;

  render(
    <SelectShareLightbox
      image={IMAGE}
      onClose={() => {
        closeCalls += 1;
      }}
    />,
  );

  fireEvent.click(await screen.findByTestId("select-share-lightbox-copy-image"));

  await screen.findByText("Copied");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.length, 1);
  const item = writes[0]?.[0] as unknown as FakeClipboardItem;
  const png = await item.payload["image/png"];
  assert.ok(png instanceof Blob);
  assert.equal(png.type, "image/png");
  assert.ok(png.size > 0);
  assert.equal(closeCalls, 0, "copy should preserve the preview and current selection");
});

test("Share preview renders every footer action as a default footer raft-ui Button", async () => {
  installClipboard(async () => undefined);

  render(
    <SelectShareLightbox
      image={IMAGE}
      onClose={() => undefined}
      onShareToX={async () => undefined}
    />,
  );

  const actionIds = [
    "select-share-lightbox-copy-image",
    "select-share-lightbox-download",
    "select-share-lightbox-share-x",
  ];

  for (const testId of actionIds) {
    const action = await screen.findByTestId(testId);
    assert.equal(action.getAttribute("data-slot"), "button", `${testId} should be owned by raft-ui Button`);
    // Raft DS › Dialog: footer actions are the default 44 button (`size="lg"`
    // → h-11 / text-subhead), never the 32 row button (h-8).
    assert.equal(action.classList.contains("h-11"), true, `${testId} should use the default footer-button height`);
    assert.equal(action.classList.contains("text-subhead"), true, `${testId} should use the default button text`);
    assert.equal(action.classList.contains("h-8"), false, `${testId} must not fall back to the small row button`);
  }
});

test("Share preview does not render Copy when image clipboard is unsupported", async () => {
  Reflect.deleteProperty(globalThis, "ClipboardItem");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: undefined },
  });

  render(<SelectShareLightbox image={IMAGE} onClose={() => undefined} />);
  await waitFor(() => {
    assert.equal(screen.queryByTestId("select-share-lightbox-copy-image"), null);
  });
  assert.ok(screen.getByTestId("select-share-lightbox-download"));
});

test("Share preview does not render Copy when clipboard-write permission is denied", async () => {
  installClipboard(async () => undefined, "denied");

  render(<SelectShareLightbox image={IMAGE} onClose={() => undefined} />);
  await waitFor(() => {
    assert.equal(permissionQueryCalls, 1);
    assert.equal(screen.queryByTestId("select-share-lightbox-copy-image"), null);
  });
  assert.ok(screen.getByTestId("select-share-lightbox-download"));
});

test("Share preview does not upscale the captured CSS width", () => {
  render(<SelectShareLightbox image={IMAGE} onClose={() => undefined} />);
  const image = screen.getByRole("img", { name: "Selected messages screenshot preview" });
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1098 });

  act(() => {
    fireEvent.load(image);
  });

  assert.equal(image.getAttribute("style"), "width: 549px;");
});

test("Share preview sizes by the ratio the image was rendered at, not the screen's", () => {
  // A long selection is rendered at a lower ratio to stay within the pixel
  // budget; dividing by the screen's ratio would shrink its preview.
  render(<SelectShareLightbox image={{ ...IMAGE, pixelRatio: 1 }} onClose={() => undefined} />);
  const image = screen.getByRole("img", { name: "Selected messages screenshot preview" });
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 400 });

  act(() => {
    fireEvent.load(image);
  });

  assert.equal(image.getAttribute("style"), "width: 400px;");
});
