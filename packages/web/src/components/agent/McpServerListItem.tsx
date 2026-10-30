import Banner from "../ui/Banner";
import { Badge, Button, DescriptionDetails, DescriptionItem, DescriptionList, DescriptionTerm, IconTile, ListRow } from "@botiverse/raft-ui";
import type { Presence } from "@botiverse/raft-ui";
import { Blocks, ChevronDown, ChevronUp, FlaskConical, Info, Link2, Pencil, Trash2, Unplug } from "lucide-react";
import type { IntlShape } from "react-intl";
import type { ManagedMcpServerView } from "@botiverse/raft-shared";
import StatusDot from "../ui/StatusDot";
import Tooltip from "../ui/Tooltip";
import api from "../../api/client";
import { normalizeManagedMcpToolDescription } from "./managedMcpToolDescription";
import { useCallback } from "react";

/** Static tooltip placement for tool descriptions (hoisted — task #709). */
const TOOL_TOOLTIP_CONTENT_PROPS = {
  side: "top",
  align: "end",
  className: "max-h-64 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto px-3 py-2 font-normal",
} as const;

/** OAuth state as a DS status chip: a fixed presence light plus its word. */
const OAUTH_STATUS_CHIP: Record<ManagedMcpServerView["oauthStatus"], { variant: "success" | "warning" | "primary" | "muted"; presence: Presence }> = {
  connected: { variant: "success", presence: "online" },
  error: { variant: "warning", presence: "error" },
  pending: { variant: "primary", presence: "busy" },
  disconnected: { variant: "muted", presence: "offline" },
};

type McpServerListItemProps = {
  server: ManagedMcpServerView;
  scope: "server" | "agent";
  canManageServer: boolean;
  busyId: string | null;
  expandedTools: ReadonlySet<string>;
  setExpandedTools: (updater: (current: Set<string>) => Set<string>) => void;
  connectOAuth: (server: ManagedMcpServerView) => Promise<void>;
  disconnectOAuth: (server: ManagedMcpServerView) => Promise<void>;
  mutate: (id: string, operation: () => Promise<unknown>) => Promise<void>;
  beginEdit: (server: ManagedMcpServerView) => void;
  onDeleteTarget: (server: ManagedMcpServerView) => void;
  formatMessage: IntlShape["formatMessage"];
  formatDate: (date: Date, options: Record<string, unknown>) => string;
  formatTime: (date: Date, options: Record<string, unknown>) => string;
};

export function McpServerListItem({
  server,
  scope,
  canManageServer,
  busyId,
  expandedTools,
  setExpandedTools,
  connectOAuth,
  disconnectOAuth,
  mutate,
  beginEdit,
  onDeleteTarget,
  formatMessage,
  formatDate,
  formatTime,
}: McpServerListItemProps) {
  const toolsOpen = expandedTools.has(server.id);
  const connectionReady = server.authMode !== "oauth" || server.oauthStatus === "connected";
  const oauthChip = OAUTH_STATUS_CHIP[server.oauthStatus] ?? OAUTH_STATUS_CHIP.disconnected;

  const handleConnect = useCallback(() => {
    void connectOAuth(server);
  }, [connectOAuth, server]);

  const handleDisconnect = useCallback(() => {
    void disconnectOAuth(server);
  }, [disconnectOAuth, server]);

  const handleTest = useCallback(() => {
    void mutate(server.id, () => api.post(`/mcp/servers/${server.id}/test`));
  }, [mutate, server.id]);

  const handleEdit = useCallback(() => {
    beginEdit(server);
  }, [beginEdit, server]);

  const handleDelete = useCallback(() => {
    onDeleteTarget(server);
  }, [onDeleteTarget, server]);

  const handleToolsToggle = useCallback(() => {
    setExpandedTools((current) => {
      const next = new Set(current);
      if (toolsOpen) next.delete(server.id); else next.add(server.id);
      return next;
    });
  }, [setExpandedTools, toolsOpen, server.id]);

  // Raft Design System › ListRow inside an inset list: raft-ui's display-only
  // ListRow (its buttons are the targets) with a neutral IconTile and the
  // server's facts. The ListRowGroup draws the hairline from the text column
  // (16 + 35 + 12); the facts run onto several lines, so they hang from the top.
  return (
    <ListRow interactive={false} className="items-start">
      <IconTile>
        <Blocks />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="min-w-0 break-words text-subhead font-semibold text-foreground">{server.name}</h4>
              {!server.enabled && (
                <Badge appearance="soft" variant="muted">
                  <StatusDot presence="offline" />
                  {formatMessage({ id: "agent.mcp.disabledBadge" })}
                </Badge>
              )}
              <Badge appearance="outline">{server.provider}</Badge>
              {server.authMode === "oauth" ? (
                <Badge appearance="soft" variant={oauthChip.variant}>
                  <StatusDot presence={oauthChip.presence} />
                  {formatMessage({ id: "agent.mcp.oauthStatus" }, { status: server.oauthStatus })}
                </Badge>
              ) : server.hasCredentials ? (
                <Badge appearance="soft">{formatMessage({ id: "agent.mcp.credentialsStoredBadge" })}</Badge>
              ) : null}
            </div>
            {server.description && <p className="mt-0.5 text-callout text-foreground-muted">{server.description}</p>}
            <p className="mt-1 break-all font-mono text-mono-meta text-foreground-hint">{server.endpointUrl}</p>
            {scope === "agent" && server.usage && (
              <DescriptionList direction="horizontal" className="mt-2">
                <DescriptionItem>
                  <DescriptionTerm>{formatMessage({ id: "agent.mcpUsage.callsLabel" })}</DescriptionTerm>
                  <DescriptionDetails>
                    {formatMessage(
                      { id: "agent.mcpUsage.callCount" },
                      { count: server.usage.invocationCount },
                    )}
                  </DescriptionDetails>
                </DescriptionItem>
                <DescriptionItem>
                  <DescriptionTerm>{formatMessage({ id: "agent.mcpUsage.lastUsedLabel" })}</DescriptionTerm>
                  <DescriptionDetails>
                    <span className="font-mono text-mono-meta">
                      {formatDate(new Date(server.usage.lastInvokedAt), {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      {formatTime(new Date(server.usage.lastInvokedAt), {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </DescriptionDetails>
                </DescriptionItem>
                <DescriptionItem>
                  <DescriptionTerm>{formatMessage({ id: "agent.mcpUsage.lastToolLabel" })}</DescriptionTerm>
                  <DescriptionDetails>
                    <span className="min-w-0 break-all font-mono text-mono-meta">{server.usage.lastToolName}</span>
                  </DescriptionDetails>
                </DescriptionItem>
              </DescriptionList>
            )}
            {server.lastCheckError && (
              <Banner intent="warning" density="sm" className="mt-3">{server.lastCheckError}</Banner>
            )}
          </div>
          {scope === "server" && canManageServer && (
            <div className="flex shrink-0 items-center gap-0.5">
              {server.authMode === "oauth" && server.oauthStatus !== "connected" && (
                <Tooltip content={formatMessage({ id: "agent.mcp.connectName" }, { name: server.name })}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={formatMessage({ id: "agent.mcp.connectName" }, { name: server.name })}
                    disabled={busyId === server.id}
                    onClick={handleConnect}
                  >
                    <Link2 size={16} />
                  </Button>
                </Tooltip>
              )}
              {server.authMode === "oauth" && server.oauthStatus === "connected" && (
                <Tooltip content={formatMessage({ id: "agent.mcp.disconnectName" }, { name: server.name })}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={formatMessage({ id: "agent.mcp.disconnectName" }, { name: server.name })}
                    disabled={busyId === server.id}
                    onClick={handleDisconnect}
                  >
                    <Unplug size={16} />
                  </Button>
                </Tooltip>
              )}
              <Tooltip content={formatMessage({ id: "agent.mcp.testRefreshTools" })}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={formatMessage({ id: "agent.mcp.testName" }, { name: server.name })}
                  disabled={busyId === server.id || !connectionReady}
                  onClick={handleTest}
                >
                  <FlaskConical size={16} />
                </Button>
              </Tooltip>
              <Tooltip content={formatMessage({ id: "agent.mcp.editServer" })}>
                <Button size="icon-sm" variant="ghost" aria-label={formatMessage({ id: "agent.mcp.editName" }, { name: server.name })} onClick={handleEdit}>
                  <Pencil size={16} />
                </Button>
              </Tooltip>
              <Tooltip content={formatMessage({ id: "agent.mcp.deleteServer" })}>
                <Button size="icon-sm" variant="ghost" aria-label={formatMessage({ id: "agent.mcp.deleteName" }, { name: server.name })} onClick={handleDelete}>
                  <Trash2 size={16} />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>

        <button
          type="button"
          className="mt-2 flex items-center gap-1 rounded-[2px] text-footnote font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-focus"
          aria-expanded={toolsOpen}
          onClick={handleToolsToggle}
        >
          {toolsOpen ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {formatMessage({ id: "agent.mcp.toolCount" }, { count: server.toolCatalog.length })}
        </button>
        {toolsOpen && (
          <div className="mt-2 max-h-80 overflow-y-auto rounded-container bg-fill-muted">
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {server.toolCatalog.map((tool) => {
                const label = tool.title || tool.name;
                const description = tool.description ? normalizeManagedMcpToolDescription(tool.description) : null;
                return (
                  <div key={tool.name} className="flex min-h-16 items-start gap-2 border-b border-line-hairline px-3 py-2 sm:even:border-l sm:even:border-line-hairline">
                    <span className="min-w-0 flex-1 break-words">
                      <span className="flex items-start gap-1">
                        <strong className={`min-w-0 flex-1 text-foreground ${tool.title ? "text-callout font-semibold" : "font-mono text-mono-meta font-bold"}`}>{label}</strong>
                        {description && (
                          <Tooltip
                            content={<span className="block text-left">{description}</span>}
                            contentProps={TOOL_TOOLTIP_CONTENT_PROPS}
                          >
                            <button type="button" className="mt-0.5 shrink-0 rounded-[2px] text-foreground-muted outline-none hover:text-foreground focus-visible:shadow-focus" aria-label={formatMessage({ id: "agent.mcp.aboutTool" }, { name: label })}>
                              <Info size={14} />
                            </button>
                          </Tooltip>
                        )}
                      </span>
                      {description && <span className="mt-0.5 line-clamp-2 text-caption text-foreground-hint">{description}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {server.toolCatalog.length === 0 && (
              <p className="px-3 py-3 text-caption text-foreground-hint">{formatMessage({ id: "agent.mcp.testToDiscoverTools" })}</p>
            )}
          </div>
        )}
      </div>
    </ListRow>
  );
}
