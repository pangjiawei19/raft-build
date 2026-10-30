import NotificationTrigger from "../layout/NotificationTrigger";
import { WorkingNowSummary } from "../layout/WorkingNowSummary";

/**
 * The web top bar's right region: who is working right now, then the Bell.
 * Help stays on the rail, above Settings; the rail keeps navigation, Help and
 * Settings.
 *
 * Raft Design System › AgentActivity: with the top bar the sidebar drops its
 * head, so the "who is working" summary (faces and a count) moves up here,
 * on the frame. It takes no space while nobody is working.
 */
export function TopBarGlobalActions() {
  return (
    <>
      <WorkingNowSummary variant="count" onFrame className="h-9" />
      <NotificationTrigger flavor="top-bar" />
    </>
  );
}
