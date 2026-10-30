// E2E-only read-only probe for sidebar drag/drop forensics (see
// tests/e2e/tests/sidebar/custom-sections.spec.ts). Compiled in only when the
// bundle is built with VITE_E2E=true; production builds tree-shake every
// call site, so this module never ships.
//
// The probe records nothing until a test explicitly opts in via
// `window.__SLOCK_E2E__.sidebarDndProbe.start()`. While enabled it keeps a
// bounded ring buffer of timestamped observations on one performance.now()
// clock: pointer events, sidebar scroll positions, drag lifecycle
// transitions, per-commit droppable registration state, dnd-kit's measured
// droppable rects, the matching live DOM rects, and the collision result
// (including which branch of sidebarCollisionDetection produced it — see the
// recorder calls in Sidebar.tsx). It never writes to dnd-kit or the DOM and
// never waits, remeasures, or retries anything.
import { useDndContext } from "@dnd-kit/core";
import { useEffect, useRef } from "react";

const MAX_ENTRIES = 1200;

type RectSnap = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

export type SidebarDndProbeEntry = {
  t: number;
  kind: "drag-state" | "pointer" | "scroll" | "collision";
  // pointer
  pointerType?: string;
  x?: number;
  y?: number;
  // scroll
  scrollTop?: number;
  // drag-state
  phase?: "active" | "end";
  activeId?: string | null;
  overId?: string | null;
  overContainerId?: string | null;
  collisionIds?: string[];
  measuringScheduled?: boolean;
  registeredContainers?: string[];
  dndRects?: Record<string, RectSnap>;
  domRects?: Record<string, RectSnap>;
  // collision branch (recorded inside sidebarCollisionDetection)
  branch?: "section-sort" | "pointer-item" | "pointer-container" | "bounds-closest-center" | "retained" | "empty";
  branchResultIds?: string[];
  branchValidContainerIds?: string[];
  branchRectIds?: string[];
};

type Recorder = (entry: SidebarDndProbeEntry) => void;

declare global {
  interface Window {
    __SIDEBAR_DND_PROBE_RECORD__?: Recorder;
  }
}

let enabled = false;
let buffer: SidebarDndProbeEntry[] = [];

function record(entry: SidebarDndProbeEntry) {
  if (!enabled) return;
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function isSidebarDndProbeEnabled(): boolean {
  return enabled;
}

export function startSidebarDndProbe() {
  buffer = [];
  enabled = true;
  window.__SIDEBAR_DND_PROBE_RECORD__ = record;
}

export function stopSidebarDndProbe() {
  enabled = false;
  delete window.__SIDEBAR_DND_PROBE_RECORD__;
}

export function readSidebarDndProbe(): SidebarDndProbeEntry[] {
  return buffer.slice();
}

/**
 * Called at each return site of sidebarCollisionDetection so the forensics
 * dump records which branch actually produced the collision result (never
 * inferred from `over` after the fact). Inert unless the probe is enabled;
 * every call site is additionally guarded by `import.meta.env.VITE_E2E` so
 * production builds drop the call entirely.
 */
export function recordSidebarDndCollisionBranch(entry: {
  branch: NonNullable<SidebarDndProbeEntry["branch"]>;
  resultIds: string[];
  validContainerIds?: string[];
  rectIds?: string[];
  x?: number;
  y?: number;
}) {
  if (import.meta.env.VITE_E2E !== "true") return;
  window.__SIDEBAR_DND_PROBE_RECORD__?.({
    t: performance.now(),
    kind: "collision",
    branch: entry.branch,
    branchResultIds: entry.resultIds,
    branchValidContainerIds: entry.validContainerIds,
    branchRectIds: entry.rectIds,
    x: entry.x,
    y: entry.y,
  });
}

function snap(rect: RectSnap): RectSnap {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}

function readDomRects(): Record<string, RectSnap> {
  const rects: Record<string, RectSnap> = {};
  for (const el of document.querySelectorAll("[data-sidebar-dnd-container]")) {
    const id = el.getAttribute("data-sidebar-dnd-container");
    if (id) rects[id] = snap(el.getBoundingClientRect());
  }
  return rects;
}

/**
 * Mounted inside the sidebar DndContext (VITE_E2E builds only). Subscribes to
 * the public dnd-kit context and the sidebar scroll surface; every
 * observation is read-only.
 */
export function SidebarDndE2EProbe() {
  const ctx = useDndContext();
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!enabled) return;
      record({ t: performance.now(), kind: "pointer", pointerType: event.type, x: event.clientX, y: event.clientY });
    };
    const scrollSurface = document.querySelector('[data-testid="sidebar-scroll-surface"]');
    const onScroll = () => {
      if (!enabled) return;
      record({
        t: performance.now(),
        kind: "scroll",
        scrollTop: scrollSurface instanceof HTMLElement ? scrollSurface.scrollTop : undefined,
      });
    };
    window.addEventListener("pointermove", onPointer, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("pointerup", onPointer, true);
    scrollSurface?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("pointerup", onPointer, true);
      scrollSurface?.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Runs after every commit. With MeasuringStrategy.Always, dnd-kit remeasures
  // droppables in its own effects during a drag, so ctx.droppableRects here is
  // what the next collision pass will use.
  useEffect(() => {
    // Opt-in gate comes before ANY observation: when the probe is off (or
    // stopped) this effect must not read dnd rects or touch the DOM at all —
    // the component is mounted on every E2E sidebar, and extra layout reads
    // could perturb the very drag timing under investigation.
    if (!enabled) return;
    if (!ctx.active) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        record({ t: performance.now(), kind: "drag-state", phase: "end", domRects: readDomRects() });
      }
      return;
    }
    wasActiveRef.current = true;
    const dndRects: Record<string, RectSnap> = {};
    for (const [id, rect] of ctx.droppableRects.entries()) {
      dndRects[String(id)] = snap(rect);
    }
    record({
      t: performance.now(),
      kind: "drag-state",
      phase: "active",
      activeId: ctx.active ? String(ctx.active.id) : null,
      overId: ctx.over ? String(ctx.over.id) : null,
      overContainerId: (ctx.over?.data?.current as { containerId?: string } | undefined)?.containerId ?? null,
      collisionIds: ctx.collisions?.map((collision) => String(collision.id)) ?? [],
      measuringScheduled: ctx.measuringScheduled,
      registeredContainers: [...ctx.droppableContainers.values()].map((container) => String(container.id)),
      dndRects,
      domRects: readDomRects(),
    });
  });

  return null;
}
