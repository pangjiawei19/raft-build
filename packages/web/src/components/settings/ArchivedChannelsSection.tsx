import { useCallback, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { Archive, GitBranch, Hash, Lock } from "lucide-react";
import { Card, IconTile } from "@botiverse/raft-ui";

import { useAppNavigate } from "../../hooks/useAppNavigate";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { useTimeFormatter } from "../../hooks/useTimeFormatter";
import { useChannelStore } from "../../store/channelStore";
import type { Channel } from "../../store/channelStore";
import { useServerStore } from "../../store/serverStore";
import Banner from "../ui/Banner";
import SectionHeader from "../ui/SectionHeader";
import Tooltip from "../ui/Tooltip";
import { UnarchiveChannelButton } from "./UnarchiveChannelButton";

export type ArchivedChannel = Channel & {
  type: "channel" | "private" | "joint";
  archivedAt: string;
};

function isArchivedChannel(channel: Channel): channel is ArchivedChannel {
  return (
    !!channel.archivedAt
    && (channel.type === "channel" || channel.type === "private" || channel.type === "joint")
  );
}

function channelTypeIcon(type: ArchivedChannel["type"]) {
  if (type === "private") return <Lock size={16} />;
  if (type === "joint") return <GitBranch size={16} />;
  return <Hash size={16} />;
}

function channelTypeMessageId(type: ArchivedChannel["type"]) {
  if (type === "private") return "settings.archivedChannels.private" as const;
  if (type === "joint") return "settings.archivedChannels.joint" as const;
  return "settings.archivedChannels.public" as const;
}

function ArchivedChannelsSectionContent() {
  const { formatMessage } = useIntl();
  const { formatMediumDateTime } = useTimeFormatter();
  const nav = useAppNavigate();
  const { capabilities } = useServerPermissions();
  const channels = useChannelStore((state) => state.channels);
  const loading = useChannelStore((state) => state.loading);
  const unarchiveChannel = useChannelStore((state) => state.unarchiveChannel);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const archivedChannels = useMemo(
    () => channels
      .filter(isArchivedChannel)
      .sort((left, right) => (
        right.archivedAt.localeCompare(left.archivedAt)
        || left.name.localeCompare(right.name)
      )),
    [channels],
  );

  const handleUnarchive = useCallback(
    async (channel: ArchivedChannel) => {
      setError("");
      setBusyChannelId(channel.id);
      try {
        await unarchiveChannel(channel.id);
      } catch (err: unknown) {
        const axiosError = err as { response?: { data?: { error?: string } } };
        setError(axiosError.response?.data?.error || formatMessage({ id: "channel.edit.failedUnarchive" }));
      } finally {
        setBusyChannelId(null);
      }
    },
    [formatMessage, unarchiveChannel],
  );

  if (!capabilities.archiveChannels || loading || archivedChannels.length === 0) {
    return null;
  }

  return (
    <section className="mb-6" data-testid="archived-channels-section">
      <SectionHeader
        className="mb-3"
        icon={<Archive size={16} />}
        label={formatMessage({ id: "settings.archivedChannels.sectionLabel" })}
        count={archivedChannels.length}
      />

      {error ? (
        <Banner
          intent="warning"
          density="sm"
          className="mb-3"
          data-testid="archived-channels-error"
        >
          {error}
        </Banner>
      ) : null}

      <Card className="divide-y divide-line-hairline">
        {archivedChannels.map((channel) => {
          const busy = busyChannelId === channel.id;
          const typeLabel = formatMessage({ id: channelTypeMessageId(channel.type) });
          const channelName = formatMessage(
            { id: "settings.archivedChannels.channelName" },
            { name: channel.name },
          );
          return (
            <div
              key={channel.id}
              className="flex flex-col gap-3 px-4 py-3 sm:min-h-11 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`archived-channel-row-${channel.id}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Tooltip content={typeLabel}>
                <IconTile size="sm" role="img" aria-label={typeLabel}>
                  {channelTypeIcon(channel.type)}
                </IconTile>
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block max-w-full truncate rounded-sticker text-left text-subhead font-semibold text-foreground-muted underline decoration-[1.5px] underline-offset-[3px] outline-none hover:text-foreground focus-visible:shadow-focus"
                    aria-label={formatMessage(
                      { id: "settings.archivedChannels.openAriaLabel" },
                      { name: channel.name },
                    )}
                    onClick={() => nav.toChannel(channel.id)}
                  >
                    {channelName}
                  </button>
                  <div className="mt-0.5 truncate text-footnote text-foreground-muted">
                    {formatMessage(
                      { id: "settings.archivedChannels.metadata" },
                      {
                        type: typeLabel,
                        date: formatMediumDateTime(channel.archivedAt),
                      },
                    )}
                  </div>
                </div>
              </div>
              <UnarchiveChannelButton
                channel={channel}
                busy={busy}
                disabled={busyChannelId !== null}
                onUnarchive={handleUnarchive}
              />
            </div>
          );
        })}
      </Card>
    </section>
  );
}

export default function ArchivedChannelsSection() {
  const serverId = useServerStore((state) => state.current?.id ?? null);
  return <ArchivedChannelsSectionContent key={serverId} />;
}
