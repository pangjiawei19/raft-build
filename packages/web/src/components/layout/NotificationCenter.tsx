import { forwardRef, useCallback } from "react";
import { CheckCircle2 } from "lucide-react";
import { useIntl } from "react-intl";
import {
  NotificationCenterActionButton,
  NotificationCenterCount,
  NotificationCenterEmptyState,
  NotificationCenterHeader,
  NotificationCenterItem,
  NotificationCenterItemActions,
  NotificationCenterItemBody,
  NotificationCenterItemContent,
  NotificationCenterItemIcon,
  NotificationCenterItemRow,
  NotificationCenterItemTitle,
  NotificationCenterList,
  NotificationCenterPopup,
  NotificationCenterScroller,
  NotificationCenterTitle,
} from "@botiverse/raft-ui";
import type { NotificationAction, NotificationEntry } from "./useSystemNotifications";
import { useDismissedNotificationStore } from "./dismissedNotificationStore";

export interface NotificationCenterProps {
  notifications: NotificationEntry[];
  /** "top-bar": the desktop-width panel, hung under the top bar's Bell instead of beside the rail. */
  flavor: "desktop" | "mobile" | "top-bar";
}

function initialFocusForKeyboardOpen(openType: string) {
  return openType === "keyboard";
}

const NotificationCenter = forwardRef<HTMLDivElement, NotificationCenterProps>(
  function NotificationCenter({ notifications, flavor }, ref) {
    const { formatMessage } = useIntl();
    const dismiss = useDismissedNotificationStore((state) => state.dismiss);

    return (
      <NotificationCenterPopup
        ref={ref}
        data-testid="notification-center"
        viewport={flavor === "mobile" ? "mobile" : "desktop"}
        size="md"
        className="w-80"
        side={flavor === "desktop" ? "right" : "bottom"}
        align="end"
        sideOffset={8}
        initialFocus={initialFocusForKeyboardOpen}
        aria-label={formatMessage({ id: "ui.notificationCenter.ariaLabel" })}
      >
        <NotificationCenterHeader className="px-3">
          <NotificationCenterTitle>
            {formatMessage({ id: "ui.notificationCenter.title" })}
          </NotificationCenterTitle>
          <NotificationCenterCount>
            {notifications.length === 0
              ? formatMessage({ id: "ui.notificationCenter.countAllClear" })
              : formatMessage({ id: "ui.notificationCenter.countItems" }, { count: notifications.length })}
          </NotificationCenterCount>
        </NotificationCenterHeader>
        <NotificationCenterScroller>
          {notifications.length === 0 ? (
            <NotificationCenterEmptyState>
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <CheckCircle2 size={36} />
                <div className="font-bold">{formatMessage({ id: "ui.notificationCenter.emptyTitle" })}</div>
                <div className="text-sm text-foreground-muted">{formatMessage({ id: "ui.notificationCenter.emptyBody" })}</div>
              </div>
            </NotificationCenterEmptyState>
          ) : (
            <NotificationCenterList aria-label={formatMessage({ id: "ui.notificationCenter.listAriaLabel" })}>
              {notifications.map((entry) => (
                <NotificationCenterItem key={entry.id} className="px-3 py-3">
                  <NotificationCenterItemRow>
                    <NotificationCenterItemIcon status={entry.kind}>
                      {entry.icon}
                    </NotificationCenterItemIcon>
                    <NotificationCenterItemContent>
                      <NotificationCenterItemTitle>{entry.title}</NotificationCenterItemTitle>
                      {entry.body ? <NotificationCenterItemBody>{entry.body}</NotificationCenterItemBody> : null}
                      <NotificationActions entry={entry} dismiss={dismiss} />
                    </NotificationCenterItemContent>
                  </NotificationCenterItemRow>
                </NotificationCenterItem>
              ))}
            </NotificationCenterList>
          )}
        </NotificationCenterScroller>
      </NotificationCenterPopup>
    );
  },
);

export default NotificationCenter;

function NotificationActions({
  entry,
  dismiss,
}: {
  entry: NotificationEntry;
  dismiss: (key: string) => void;
}) {
  const { formatMessage } = useIntl();
  const { dismissalKey } = entry;
  const handleDismiss = useCallback(() => {
    if (dismissalKey) dismiss(dismissalKey);
  }, [dismiss, dismissalKey]);
  // In-row actions all look the same (raft-ui's outline button); order says
  // which comes first.
  const actions = [entry.action, entry.secondaryAction].filter(
    (action): action is NotificationAction => action != null,
  );

  if (actions.length === 0 && !dismissalKey) return null;
  return (
    <NotificationCenterItemActions className="mt-2 ml-0 flex-wrap justify-start">
      {actions.map((action) => (
        <NotificationCenterActionButton
          key={action.label}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </NotificationCenterActionButton>
      ))}
      {dismissalKey ? (
        <NotificationCenterActionButton
          type="button"
          onClick={handleDismiss}
        >
          {formatMessage({ id: "common.announcement.dismiss" })}
        </NotificationCenterActionButton>
      ) : null}
    </NotificationCenterItemActions>
  );
}
