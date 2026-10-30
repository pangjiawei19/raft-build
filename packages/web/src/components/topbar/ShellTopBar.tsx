import { useLayoutEffect, useMemo } from "react";
import { AppTopBar } from "./AppTopBar";
import { TopBarGlobalActions } from "./TopBarGlobalActions";
import { useTopBarHost } from "./topBarHostContext";

// One element for the web's own actions, so a re-render of the shell does not
// re-render them.
const GLOBAL_ACTIONS = <TopBarGlobalActions />;

/**
 * The top bar as the app shell mounts it: the web's own actions on the right,
 * plus whatever a host shell supplies through `TopBarHostContext`.
 */
export function ShellTopBar() {
  const host = useTopBarHost();
  const onBarMounted = host?.onBarMounted;
  // Layout effect: the shell swaps its stand-in strip for this bar before the
  // first paint, so the two never show together for a frame.
  useLayoutEffect(() => {
    onBarMounted?.(true);
    return () => onBarMounted?.(false);
  }, [onBarMounted]);
  const trailingStart = host?.trailingStart;
  const trailing = useMemo(
    () => (trailingStart ? <>{trailingStart}{GLOBAL_ACTIONS}</> : GLOBAL_ACTIONS),
    [trailingStart],
  );
  return (
    <AppTopBar
      leadingEnd={host?.leadingEnd}
      trailing={trailing}
      titleBar={host?.titleBar === true}
      workspaceShortcutModifier={host?.workspaceShortcutModifier ?? null}
    />
  );
}
