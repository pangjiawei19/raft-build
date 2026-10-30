import { useCallback, useMemo } from "react";
import { useIntl } from "react-intl";
import { FormSection, Separator, Switch } from "@botiverse/raft-ui";
import { ROW_DESCRIPTION_CLASS, ROW_TITLE_CLASS } from "./channelSettingsClasses";
import { useServerStore } from "../../store/serverStore";
import {
  hasSidebarPinnedRef,
  removeSidebarPinnedRef,
  upsertSidebarPinnedRef,
} from "../../utils/sidebarPinnedRefs";
import type { SidebarPinnedRef } from "../../utils/sidebarPinnedRefs";

const NO_PINNED_REFS: SidebarPinnedRef[] = [];

/**
 * The per-user conversation preferences — Pin, (panel-only) Activity mute,
 * and the collapse-long-messages switch. Extracted from EditChannelDialog
 * (task #703) so the DM settings sheet renders the SAME preferences block as
 * the channel one: a DM has no name/description form, but pin and display
 * prefs apply to it unchanged (per-DM mute remains a documented non-feature,
 * so the mute row only ever appears when the caller passes `activityMute`).
 *
 * Visual language (v2「重量随风险」, Artea 2026-08-06): high-frequency,
 * zero-risk, fully reversible toggles stay BARE on the paper — hairline
 * dividers, no borders, no shadow.
 */
export interface ChannelPreferencesSectionProps {
  channelId: string;
  /** Mute is a panel-only surface; callers without the capability omit it. */
  isPanel?: boolean;
  activityMute?: {
    muted: boolean;
    busy: boolean;
    onToggle: () => void;
  };
  collapseLongMessages?: {
    enabled: boolean;
    busy: boolean;
    onToggle: () => void;
  };
}

export function ChannelPreferencesSection({
  channelId,
  isPanel = false,
  activityMute,
  collapseLongMessages,
}: ChannelPreferencesSectionProps) {
  const { formatMessage } = useIntl();
  const sidebarOrder = useServerStore((s) => s.sidebarOrder);
  const updateSidebarOrder = useServerStore((s) => s.updateSidebarOrder);
  const pinnedRefs = sidebarOrder.pinned ?? NO_PINNED_REFS;
  const channelPinRef = useMemo(() => ({ kind: "channel" as const, id: channelId }), [channelId]);
  const isPinned = hasSidebarPinnedRef(pinnedRefs, channelPinRef);
  const handleTogglePin = useCallback(() => {
    const next = isPinned
      ? removeSidebarPinnedRef(pinnedRefs, channelPinRef)
      : upsertSidebarPinnedRef(pinnedRefs, channelPinRef);
    // Same fire-and-forget contract as the Sidebar context-menu toggle.
    void updateSidebarOrder({ pinned: next });
  }, [isPinned, pinnedRefs, channelPinRef, updateSidebarOrder]);
  // The Switch passes the next checked state; the toggles take no argument.
  const toggleMute = activityMute?.onToggle;
  const handleToggleMute = useCallback(() => toggleMute?.(), [toggleMute]);
  const toggleCollapse = collapseLongMessages?.onToggle;
  const handleToggleCollapse = useCallback(() => toggleCollapse?.(), [toggleCollapse]);

  return (
    <FormSection
      data-testid="channel-settings-preferences"
      title={formatMessage({ id: "message.chatPanel.overflow.preferencesGroup" })}
    >
      <div>
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <h4 id="channel-settings-pin-label" className={ROW_TITLE_CLASS}>
              {formatMessage({ id: "message.channelSettings.pinTitle" })}
            </h4>
            <p className={ROW_DESCRIPTION_CLASS}>
              {formatMessage({ id: "message.channelSettings.pinDescription" })}
            </p>
          </div>
          <Switch
            checked={isPinned}
            onCheckedChange={handleTogglePin}
            aria-labelledby="channel-settings-pin-label"
            className="shrink-0"
            data-testid="channel-settings-pin-switch"
          />
        </div>
        {isPanel && activityMute && (
          <>
          <Separator />
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <h4 id="channel-settings-mute-label" className={ROW_TITLE_CLASS}>
                {formatMessage({ id: "message.channelSettings.muteActivityTitle" })}
              </h4>
              <p className={ROW_DESCRIPTION_CLASS}>
                {formatMessage({ id: "message.channelSettings.muteActivityDescription" })}
              </p>
            </div>
            <Switch
              checked={activityMute.muted}
              disabled={activityMute.busy}
              onCheckedChange={handleToggleMute}
              aria-labelledby="channel-settings-mute-label"
              className="shrink-0"
              data-testid="channel-overflow-mute-switch"
            />
          </div>
          </>
        )}
        {collapseLongMessages && (
          <>
          <Separator />
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <h4 id="channel-settings-collapse-label" className={ROW_TITLE_CLASS}>
                {formatMessage({ id: "message.channelSettings.collapseLongMessagesTitle" })}
              </h4>
              <p className={ROW_DESCRIPTION_CLASS}>
                {formatMessage({ id: "message.channelSettings.collapseLongMessagesDescription" })}
              </p>
            </div>
            <Switch
              checked={collapseLongMessages.enabled}
              disabled={collapseLongMessages.busy}
              onCheckedChange={handleToggleCollapse}
              aria-labelledby="channel-settings-collapse-label"
              className="shrink-0"
              data-testid="channel-settings-collapse-switch"
            />
          </div>
          </>
        )}
      </div>
    </FormSection>
  );
}
