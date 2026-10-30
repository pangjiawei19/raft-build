import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { SLACK_BRIDGE_FEATURE_FLAG_KEYS } from "@botiverse/raft-shared";
import {
  Badge,
  FormSection,
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@botiverse/raft-ui";
import type { SlackBridgeProvisioningProvider, SlackBridgeSetupSnapshot, SlackBridgeSetupStage } from "../settings/slackBridgeProvisioning";
import { isSlackBridgePreflightPassed } from "../settings/slackBridgeProvisioning";
import { slackBridgeProvisioningProvider } from "../settings/slackBridgeProvisioningApi";
import FormField from "../ui/FormField";
import { useServerFeatureFlag } from "../../store/serverFeatureFlags";

const NOT_CONNECTED_VALUE = "__slack_bridge_not_connected__";

export interface SlackBridgeEditor {
  snapshot: SlackBridgeSetupSnapshot | null;
  selectedSlackChannelId: string;
  setSelectedSlackChannelId: (value: string) => void;
  available: boolean;
  apply: (channelId: string) => Promise<void>;
}

export function isChannelSlackBridgeSelectionAvailable(stage: SlackBridgeSetupStage | null): boolean {
  return stage === "health";
}

export async function applyChannelSlackBridgeSelection(input: {
  provider: SlackBridgeProvisioningProvider;
  snapshot: SlackBridgeSetupSnapshot;
  channelId: string;
  selectedSlackChannelId: string;
}): Promise<SlackBridgeSetupSnapshot> {
  let currentSnapshot = input.snapshot;
  const currentPair = currentSnapshot.channelPairs.find((pair) => pair.raftChannelId === input.channelId);
  if (currentPair?.slackChannelId === input.selectedSlackChannelId || (!currentPair && !input.selectedSlackChannelId)) {
    return currentSnapshot;
  }

  if (currentPair) {
    if (!currentPair.bindingEpoch || !input.provider.removeChannelPair) {
      throw new Error("slack_bridge_binding_coordinates_unavailable");
    }
    const removed = await input.provider.removeChannelPair({
      raftChannelId: currentPair.raftChannelId,
      slackChannelId: currentPair.slackChannelId,
      expectedBindingEpoch: currentPair.bindingEpoch,
    });
    currentSnapshot = removed.snapshot;
  }

  if (input.selectedSlackChannelId) {
    const desiredPairs = [
      ...currentSnapshot.channelPairs.map(({ raftChannelId, slackChannelId }) => ({ raftChannelId, slackChannelId })),
      { raftChannelId: input.channelId, slackChannelId: input.selectedSlackChannelId },
    ];
    await input.provider.saveChannelPairs(desiredPairs);
    const preflight = await input.provider.runPreflight();
    if (!isSlackBridgePreflightPassed(preflight.snapshot.preflight)) {
      throw new Error("slack_bridge_preflight_failed");
    }
    currentSnapshot = (await input.provider.enable()).snapshot;
  }
  return currentSnapshot;
}

export function useChannelSlackBridgeEditor(input: {
  channelId?: string;
  visibility: "public" | "private";
  canManage: boolean;
}): SlackBridgeEditor {
  const launchEnabled = useServerFeatureFlag(SLACK_BRIDGE_FEATURE_FLAG_KEYS.master).enabled;
  const [state, setState] = useState<{
    snapshot: SlackBridgeSetupSnapshot | null;
    selectedSlackChannelId: string;
  }>({ snapshot: null, selectedSlackChannelId: "" });
  const { snapshot, selectedSlackChannelId } = state;
  const setSelectedSlackChannelId = useCallback((value: string) => setState((current) => ({
    ...current,
    selectedSlackChannelId: value,
  })), []);

  useEffect(() => {
    let active = true;
    if (!input.canManage || !launchEnabled) {
      return () => { active = false; };
    }
    void slackBridgeProvisioningProvider.load()
      .then((view) => {
        if (!active || view.kind !== "ready") return;
        const current = input.channelId
          ? view.snapshot.channelPairs.find((pair) => pair.raftChannelId === input.channelId)
          : null;
        setState({
          snapshot: view.snapshot,
          selectedSlackChannelId: current?.slackChannelId ?? "",
        });
      })
      .catch(() => {
        if (active) setState({ snapshot: null, selectedSlackChannelId: "" });
      });
    return () => { active = false; };
  }, [input.canManage, input.channelId, launchEnabled]);

  const available = launchEnabled
    && isChannelSlackBridgeSelectionAvailable(snapshot?.stage ?? null);

  const apply = useCallback(async (channelId: string) => {
    if (!launchEnabled || !snapshot || !available) return;
    const fresh = await slackBridgeProvisioningProvider.load();
    const currentSnapshot = await applyChannelSlackBridgeSelection({
      provider: slackBridgeProvisioningProvider,
      snapshot: fresh.snapshot,
      channelId,
      selectedSlackChannelId,
    });
    setState((current) => ({ ...current, snapshot: currentSnapshot }));
  }, [launchEnabled, snapshot, available, selectedSlackChannelId]);

  return useMemo(
    () => ({ snapshot, selectedSlackChannelId, setSelectedSlackChannelId, available, apply }),
    [snapshot, selectedSlackChannelId, setSelectedSlackChannelId, available, apply],
  );
}

/** The channel's Slack Bridge pick as a raft-ui FormSection (DS
 *  `rf-drawer__section`): heading with the provider badge, a line on what it
 *  does, then the Slack channel field. `className` adjusts the section's own
 *  spacing for a host that is not a run of sections (the create dialog). */
export function ChannelSlackBridgeField({
  editor,
  visibility,
  disabled,
  className,
}: {
  editor: SlackBridgeEditor;
  visibility: "public" | "private";
  disabled?: boolean;
  className?: string;
}) {
  const { formatMessage } = useIntl();
  const options = useMemo(() => editor.snapshot?.slackChannels.filter((channel) =>
    !channel.privacyClass || channel.privacyClass === visibility) ?? [], [editor.snapshot, visibility]);
  const pairedBySlackId = useMemo(() => new Map(
    editor.snapshot?.channelPairs.map((pair) => [pair.slackChannelId, pair.raftChannelId]) ?? [],
  ), [editor.snapshot]);
  const selectOptions = useMemo(() => [
    {
      value: NOT_CONNECTED_VALUE,
      label: formatMessage({ id: "channel.bridge.notConnected" }),
      disabled: false,
    },
    ...options.map((channel) => {
      const pairedRaftChannelId = pairedBySlackId.get(channel.id);
      const occupied = !!pairedRaftChannelId && channel.id !== editor.selectedSlackChannelId;
      const membershipRequired = channel.isMember !== true;
      return {
        value: channel.id,
        label: formatMessage(
          { id: membershipRequired
            ? "settings.slackBridge.channelMembershipRequiredOption"
            : occupied
              ? "channel.bridge.alreadyPairedOption"
              : "settings.slackBridge.channelName" },
          { name: channel.name },
        ),
        disabled: occupied || membershipRequired,
      };
    }),
  ], [editor.selectedSlackChannelId, formatMessage, options, pairedBySlackId]);

  const { setSelectedSlackChannelId } = editor;
  const handleValueChange = useCallback((value: string | null) => {
    if (value != null) {
      setSelectedSlackChannelId(value === NOT_CONNECTED_VALUE ? "" : value);
    }
  }, [setSelectedSlackChannelId]);

  if (!editor.available) return null;

  return (
    <FormSection
      className={className}
      data-testid="channel-slack-bridge-field"
      title={(
        <span className="flex items-center gap-2">
          <Badge appearance="outline" data-testid="channel-slack-bridge-provider-badge">
            {formatMessage({ id: "settings.slackBridge.providerBadge" })}
          </Badge>
          {formatMessage({ id: "channel.bridge.fieldTitle" })}
        </span>
      )}
      description={formatMessage({ id: "channel.bridge.fieldDescription" })}
    >
      <FormField label={formatMessage({ id: "channel.bridge.slackChannel" })}>
        <Select
          value={editor.selectedSlackChannelId || NOT_CONNECTED_VALUE}
          disabled={disabled}
          onValueChange={handleValueChange}
          items={selectOptions}
        >
          <SelectTrigger className="w-full" aria-label={formatMessage({ id: "channel.bridge.slackChannel" })}>
            <SelectValue />
            <SelectIcon />
          </SelectTrigger>
          <SelectContent>
            <SelectList>
              {selectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  <SelectItemText>{option.label}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectList>
          </SelectContent>
        </Select>
      </FormField>
    </FormSection>
  );
}
