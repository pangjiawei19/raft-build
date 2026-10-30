/**
 * task #19 — Activity v2 has been retired from the web inbox.
 * The Activity sidebar inbox (activity_sidebar_inbox_v0: All/Unread/Mentions/
 * Saved/DMs/Done views plus the channel/DM source list) has been retired too.
 *
 * The historic server-side flag rows may remain for rollback/history, but the
 * web client must not request any of these retired flags anymore. If these keys
 * re-enter the registered web flag list, an enabled stale server flag can put
 * users back on a retired inbox path.
 */
import assert from "node:assert/strict";

import {
  REGISTERED_SERVER_FEATURE_FLAG_KEYS,
} from "../src/store/serverFeatureFlags";

test("retired Activity v2 flags are not registered for web evaluation", () => {
  assert.equal(
    REGISTERED_SERVER_FEATURE_FLAG_KEYS.includes("activity_v2" as never),
    false,
    "the legacy activity_v2 key must not be requested by the web client",
  );
  assert.equal(
    REGISTERED_SERVER_FEATURE_FLAG_KEYS.includes("activity_sync_core" as never),
    false,
    "the activity_sync_core key must not be requested by the web client",
  );
});

test("retired Activity sidebar inbox flag is not registered for web evaluation", () => {
  assert.equal(
    REGISTERED_SERVER_FEATURE_FLAG_KEYS.includes("activity_sidebar_inbox_v0" as never),
    false,
    "the activity_sidebar_inbox_v0 key must not be requested by the web client",
  );
});
