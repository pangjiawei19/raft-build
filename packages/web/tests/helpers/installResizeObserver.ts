// jsdom has no ResizeObserver. Import this side-effect module in tests that render a
// component that constructs one. It is deliberately NOT in the shared domSetup: vitest isolates each test file's
// environment, so scoping the stub to these files avoids globally giving base-ui's own
// ScrollArea a working ResizeObserver in unrelated suites (which then hit jsdom gaps like
// getAnimations/matchMedia in late resize callbacks). Production uses the real browser API.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserverStub })
    .ResizeObserver = ResizeObserverStub;
}
