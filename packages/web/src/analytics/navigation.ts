// Primary navigation telemetry (xxchan, #raft-botiverse-user-analytics
// 2026-10-17): which entry people use to reach each main surface, per
// platform, to decide what the mobile tab bar holds. Called from the click
// handlers of the entries themselves, never from route changes (page_viewed
// counts those, whatever the way in).
import type { ProductEventProperties } from "@botiverse/raft-shared";
import { getPwaInstallDisplayMode } from "../utils/pwaInstall";
import { trackEvent } from "./track";

type NavEntry = ProductEventProperties<"nav_entry_selected">;

/** A click on a primary navigation entry. `wasActive`: the user was already on that surface. */
export function trackNavEntrySelected(
  destination: NavEntry["destination"],
  surface: NavEntry["surface"],
  wasActive: boolean,
): void {
  trackEvent("nav_entry_selected", {
    destination,
    surface,
    was_active: wasActive,
    display_mode: getPwaInstallDisplayMode(window),
  });
}
