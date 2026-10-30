import type { FeedbackTheme } from "@botiverse/hands-feedback-react";

/**
 * The feedback SDK still takes a style family and forwards it to raft-ui's
 * ThemeProvider, which no longer has families (raft is the only look). Its
 * `FeedbackTheme` type still lists only the legacy families; widen it
 * upstream, then drop this prop and cast.
 */
export const FEEDBACK_SDK_THEME = "raft" as string as FeedbackTheme;
