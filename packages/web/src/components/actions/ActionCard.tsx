// Action card — rendered inline as the body of a regular agent message
// row when the message's `actionMetadata.kind === "action-card"`. The
// agent prepared the form; the human admin clicks the action verb button
// to commit it under their own identity.
//
// Per stdrc 2026-05-10 #proj-approval msg=cb1aa609 + msg=7d662135: the
// card stays a *summary* — agent-prefilled fields shown as readonly
// labels, plus the action verb button. We deliberately do NOT inline the
// rest of the create-form on the card (overcrowds the message row); the
// dialog is the place to fill remaining fields. v1 simply fires the
// execute endpoint with the agent's prefilled action; v2 will open the
// existing modal dialog in prefilled mode if any required fields are
// still missing.

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { MessageId } from "../../i18n/messages";
import { Check } from "lucide-react";
import {
  Button,
  MessageActionCard,
  MessageActionCardActions,
  MessageActionCardActionsNote,
  MessageActionCardCollapseTrigger,
  MessageActionCardContent,
  MessageActionCardHeader,
  MessageActionCardHeaderIcon,
  MessageActionCardHeaderDescription,
  MessageActionCardHeaderTitle,
  MessageActionCardHint,
  MessageActionCardHintLabel,
  MessageActionCardNotice,
  MessageActionCardProperties,
  MessageActionCardProperty,
  MessageActionCardPropertyLabel,
  MessageActionCardPropertyValue,
  MessageActionCardStatus,
} from "@botiverse/raft-ui";
import { isSafeOAuthReturnUrl, isActionCardReadOnlyInServer } from "@botiverse/raft-shared";
import type {
  ActionCardAction,
  ActionCardMetadata,
  ActionCardResult,
} from "@botiverse/raft-shared";
import { useAgentStore } from "../../store/agentStore";
import { useServerStore } from "../../store/serverStore";
import { useChannelStore } from "../../store/channelStore";
import { useThreadStore } from "../../store/threadStore";
import { useMessageStore } from "../../store/messageStore";
import { useServerPermissions } from "../../hooks/useServerPermissions";
import { useTimeFormatter } from "../../hooks/useTimeFormatter";
import Banner from "../ui/Banner";
import CreateAgentDialog from "../agent/CreateAgentDialog";
import CreateChannelDialog from "../channel/CreateChannelDialog";
import AddMembersDialog from "../channel/AddMembersDialog";
import api from "../../api/client";
import { ActionCardScopeNotices } from "./ActionCardScopeNotices";
import { ActionCardScopes } from "./ActionCardScopes";
import { ActionTypeIcon } from "./ActionTypeIcon";
import { useActionCardDetail } from "./useActionCardDetail";
import type { ActionCardProperty } from "./useActionCardDetail";

// Product-funnel event types this component is allowed to emit. Mirrors the
// server-side `CLIENT_EVENT_TYPES` whitelist in routes/actions.ts. Server
// rejects anything else; DB check constraint is the second line of defense.
//
// Note: `action_card.execute_success` is intentionally NOT here — server-
// only per Dozy guardrail (#proj-permission:13b42cc0 msg=a1dbc464). Funnel
// "successes" must come from the server-authoritative path (executeActionCard
// or markActionCardExecuted) so a client can't manufacture them.
type ClientEventType =
  | "action_card.open"
  | "action_card.dismiss"
  | "action_card.execute_attempt"
  | "action_card.execute_fail";

type ActionCardErrorClass =
  | "validation"
  | "permission"
  | "not_found"
  | "conflict"
  | "network"
  | "unknown";

interface DismissMetadata {
  dismiss_reason?: "close_button" | "esc" | "backdrop" | "route_change";
}

// `OpenMetadata` and `AttemptMetadata` are intentionally empty: server
// derives `action_type` from the validated card row, so client-side
// hints would be ignored anyway.
type OpenMetadata = Record<string, never>;
type AttemptMetadata = Record<string, never>;

interface FailMetadata {
  error_class?: ActionCardErrorClass;
  error_code?: string;
  http_status?: number;
}

/**
 * Coarse client-side classifier mirroring server `classifyExecuteError`.
 * Used for `execute_fail` events emitted by the dialog-driven path. Only
 * returns categorical buckets — never raw caught text. Matches the
 * server's enum so SQL groups consistently across both emit paths.
 */
function classifyClientError(err: unknown): FailMetadata {
  const e = err as
    | { response?: { status?: number; data?: { error?: string; code?: string } }; code?: string; message?: string }
    | null;
  if (!e || typeof e !== "object") return { error_class: "unknown" };

  const status = e.response?.status;
  const code = e.response?.data?.code ?? (typeof e.code === "string" ? e.code : undefined);
  const out: FailMetadata = { error_class: "unknown" };
  if (typeof status === "number") out.http_status = status;
  if (typeof code === "string" && code.length > 0 && code.length <= 64) out.error_code = code;

  if (status === 400) out.error_class = "validation";
  else if (status === 401 || status === 403) out.error_class = "permission";
  else if (status === 404) out.error_class = "not_found";
  else if (status === 409) out.error_class = "conflict";
  else if (status === undefined && (e.code === "ERR_NETWORK" || /network/i.test(String(e.message ?? "")))) {
    out.error_class = "network";
  }
  return out;
}

interface Props {
  messageId: string;
  metadata: ActionCardMetadata;
  /** Channel of the carrier message. Thread carriers resolve authority from
   *  their parent channel, matching the server writer. */
  channelId: string;
}

interface ActionCardMutationResponse {
  messageId: string;
  metadata: ActionCardMetadata;
}

export function ActionCard({ messageId, metadata, channelId }: Props) {
  const { formatMessage } = useIntl();
  const { formatMessageTime } = useTimeFormatter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [addMembersDialogOpen, setAddMembersDialogOpen] = useState(false);
  // Suppress `dismiss` emit when the dialog closes after a successful
  // submit. Dialogs call `onCreated`/`onSubmitted` then `onClose`; flagging
  // success in the success handler lets the close handler tell the
  // difference between "user closed" and "dialog auto-closed after submit".
  const submitSucceededRef = useRef(false);
  const authorityChannelId = useThreadStore((state) =>
    state.openThreadChannelId === channelId ? state.openParentChannelId : channelId
  );
  const carrierChannel = useChannelStore((state) =>
    state.channels.find((channel) => channel.id === authorityChannelId)
      ?? state.dmChannels.find((channel) => channel.id === authorityChannelId)
  );
  const currentServerId = useServerStore((state) => state.current?.id);
  const sourceReadOnly = isActionCardReadOnlyInServer(metadata.sourceServerId, currentServerId);
  const currentServerRole = useServerStore((state) => state.current?.role);
  const { capabilities } = useServerPermissions();
  const action = metadata.action;
  // Joint carriers are shared with peer servers; the action always runs on
  // the card's target server (fixed at prepare time), never the viewer's.
  const targetServerName = metadata.targetServerName ?? null;
  const blockedReason = sourceReadOnly
    ? targetServerName
      ? { id: "actionCard.blocked.targetServer" as const }
      : { id: "actionCard.blocked.sourceWorkspace" as const }
    : carrierChannel?.archivedAt
    ? { id: "actionCard.blocked.archived" as const }
    : currentServerRole === "guest"
      ? { id: "actionCard.blocked.guest" as const }
      : !carrierChannel || (
          currentServerRole !== "owner"
          && currentServerRole !== "admin"
          && carrierChannel.type !== "dm"
          && carrierChannel.joined !== true
        )
        ? { id: "actionCard.blocked.notMember" as const }
        : action.type === "agent:create" && !capabilities.createAgents
          ? { id: "actionCard.blocked.needCreateAgents" as const }
          : null;
  const canOperateCard = blockedReason === null;
  const blockedReasonId = `action-card-blocked-${messageId}`;
  const blockedReasonText = blockedReason?.id === "actionCard.blocked.targetServer"
    ? formatMessage({ id: blockedReason.id }, { server: targetServerName ?? "" })
    : blockedReason?.id === "actionCard.blocked.notMember"
    ? formatMessage(
        { id: blockedReason.id },
        { channel: carrierChannel?.name ?? formatMessage({ id: "actionCard.title.channelFallback" }) },
      )
    : blockedReason
      ? formatMessage({ id: blockedReason.id })
      : null;

  // Render directly from the `metadata` prop. The server emits
  // `message:updated` from `markActionCardExecuted` (actionCardsService.ts),
  // MainLayout's socket handler dispatches `messageStore.updateMessage`, and
  // the merged `actionMetadata` flows back down here. A local
  // `useState(metadata)` mirror would freeze on first mount and then ignore
  // every subsequent prop change — the classic derived-state anti-pattern.
  const isExecuted = metadata.state === "executed";
  const isFrozen = metadata.state === "frozen";
  const needsReconfirmation = metadata.state === "reconfirm_required";

  // Best-effort: emit a product-funnel event for this card. Failures are
  // swallowed here just like on the server side — a wobbly funnel must
  // never block the underlying user action. The server validates the card
  // + access and re-derives `action_type` from the canonical card row, so
  // the metadata we pass here is intentionally minimal.
  const emitEvent = useCallback(
    (
      eventType: ClientEventType,
      payload?: OpenMetadata | DismissMetadata | AttemptMetadata | FailMetadata,
    ): void => {
      api
        .post(`/actions/${messageId}/event`, {
          eventType,
          metadata: payload ?? {},
        })
        .catch((err) => {
          // Silent: the funnel is best-effort.
          console.debug("[actionCard] event emit failed:", eventType, err);
        });
    },
    [messageId],
  );

  const applyActionCardMutation = useCallback(
    (out: ActionCardMutationResponse): void => {
      useMessageStore.getState().updateMessage({
        id: out.messageId,
        channelId,
        actionMetadata: out.metadata,
      });
    },
    [channelId],
  );

  const confirmationVersion = metadata.confirmationVersion;
  const actionType = action.type;

  // Dialog-backed cards keep the stdrc 2026-05-10 #proj-approval contract:
  // open the regular user-facing dialog with editable prefilled values, then
  // mark the card executed only after the normal API succeeds. Owner-commit
  // cards below execute server-side because the commit itself is the action.
  const handleClick = useCallback(() => {
    async function executeInlineAction() {
      setBusy(true);
      try {
        const { data } = await api.post<ActionCardMutationResponse>(
          `/actions/${messageId}/execute`,
          { expectedState: "prepared", expectedConfirmationVersion: confirmationVersion },
        );
        // Server also emits message:updated, but applying the response keeps
        // the clicked card in sync even if realtime delivery lags or is missed.
        applyActionCardMutation(data);
      } catch (err) {
        const e = err as { response?: { data?: { error?: string } }; message?: string } | null;
        setError(e?.response?.data?.error ?? e?.message ?? formatMessage({ id: "actionCard.executeFailed" }));
      } finally {
        setBusy(false);
      }
    }

    setError(null);
    if (isFrozen || !canOperateCard) return;
    if (needsReconfirmation) {
      setBusy(true);
      api.post<ActionCardMutationResponse>(`/actions/${messageId}/reconfirm`)
        .then(({ data }) => applyActionCardMutation(data))
        .catch((err) => {
          const e = err as { response?: { data?: { error?: string } }; message?: string } | null;
          setError(e?.response?.data?.error ?? e?.message ?? formatMessage({ id: "actionCard.reconfirmationFailed" }));
        })
        .finally(() => setBusy(false));
      return;
    }
    submitSucceededRef.current = false;
    if (
      actionType === "integration:approve_agent_login"
      || actionType === "integration:install_marketplace_app"
      || actionType === "integration:register_app"
      || actionType === "integration:update_app_registration"
      || actionType === "integration:recover_app_owner"
    ) {
      void executeInlineAction();
      return;
    }
    // Funnel hook: human opened the dialog. Emit before opening so a stuck
    // dialog doesn't lose the signal. Best-effort; swallowed on failure.
    // No metadata — server derives `action_type` from the card row.
    emitEvent("action_card.open", {});
    switch (actionType) {
      case "channel:create":
        setChannelDialogOpen(true);
        return;
      case "agent:create":
        setAgentDialogOpen(true);
        return;
      case "channel:add_member":
        setAddMembersDialogOpen(true);
        return;
    }
  }, [
    actionType,
    applyActionCardMutation,
    canOperateCard,
    confirmationVersion,
    emitEvent,
    formatMessage,
    isFrozen,
    messageId,
    needsReconfirmation,
  ]);

  // Funnel hook: dialog closed without a successful submit. The
  // `submitSucceededRef` flag is set in onCreated/onSubmitted handlers
  // before the dialog calls onClose, so we can distinguish "user dismissed"
  // from "dialog auto-closed after success". v1 doesn't distinguish
  // close-button / ESC / backdrop on the FE — all collapse to a single
  // dismiss without a `dismiss_reason`. Adding that resolution is a
  // follow-up.
  const recordDialogClose = useCallback(() => {
    if (!submitSucceededRef.current) {
      // No metadata — server derives `action_type` from the card row.
      // dismiss_reason omitted in v1 (FE doesn't distinguish X / ESC /
      // backdrop yet). Adding that resolution is a follow-up.
      emitEvent("action_card.dismiss", {});
    }
    submitSucceededRef.current = false;
  }, [emitEvent]);

  const handleAgentDialogClose = useCallback(() => {
    recordDialogClose();
    setAgentDialogOpen(false);
  }, [recordDialogClose]);

  const handleChannelDialogClose = useCallback(() => {
    recordDialogClose();
    setChannelDialogOpen(false);
  }, [recordDialogClose]);

  const handleAddMembersDialogClose = useCallback(() => {
    recordDialogClose();
    setAddMembersDialogOpen(false);
  }, [recordDialogClose]);

  // Funnel hooks for the dialog-driven submit lifecycle. The dialogs run
  // their own create API and may fail before mark-executed is reached,
  // which the server can't observe. We emit:
  //   - `execute_attempt` when the dialog actually starts the create call
  //     (after client-side validation passed).
  //   - `execute_fail` when the dialog's create API throws. The dialog
  //     stays open for retry; on a successful retry, the corresponding
  //     `execute_success` will arrive server-side via mark-executed.
  // Per Dozy guardrail msg=a1dbc464: client may NOT emit `execute_success`.
  const handleSubmitStart = useCallback(() => {
    emitEvent("action_card.execute_attempt", {});
  }, [emitEvent]);

  const handleSubmitError = useCallback((err: unknown) => {
    emitEvent("action_card.execute_fail", classifyClientError(err));
  }, [emitEvent]);

  const markExecuted = useCallback(async (result: ActionCardResult) => {
    try {
      const { data } = await api.post<ActionCardMutationResponse>(
        `/actions/${messageId}/mark-executed`,
        { result, expectedConfirmationVersion: confirmationVersion },
      );
      // The socket update is still useful for other tabs/clients; the local
      // response closes the stale-button window on this tab immediately.
      applyActionCardMutation(data);
    } catch (err) {
      // Don't surface mark-executed failure — the resource is already
      // created. Worst case the card stays "prepared" until refresh.
      console.error("Failed to mark action card executed:", err);
      // Funnel hook: dialog-driven `execute_fail` for the mark-executed leg.
      // The create dialog already emitted `execute_attempt` via
      // `handleSubmitStart`; if mark-executed sync fails the submit's funnel
      // outcome would otherwise stop at `execute_attempt` with no terminal
      // event. Per Leiysky/Dozy/meichen review 2026-05-13 (msg=5cb29566 /
      // msg=e2d25035 / DM e270834b): emit `execute_fail` here too, reusing
      // the same client classifier. `execute_success` stays server-only —
      // when mark-executed succeeds the server emits it via the canonical
      // `markActionCardExecuted` path, so this client branch only needs the
      // failure leg.
      handleSubmitError(err);
    }
  }, [applyActionCardMutation, confirmationVersion, handleSubmitError, messageId]);

  const handleAgentCreated = useCallback((agent: { id: string; name: string }) => {
    submitSucceededRef.current = true;
    void markExecuted({ kind: "agent", id: agent.id, name: agent.name });
  }, [markExecuted]);

  const handleChannelCreated = useCallback((channel: { id: string; name: string }) => {
    submitSucceededRef.current = true;
    void markExecuted({ kind: "channel", id: channel.id, name: channel.name });
  }, [markExecuted]);

  const handleMembersAdded = useCallback((result: {
    channelId: string;
    channelName: string;
    addedHumanIds: string[];
    addedAgentIds: string[];
  }) => {
    submitSucceededRef.current = true;
    void markExecuted({
      kind: "channel-members",
      channelId: result.channelId,
      channelName: result.channelName,
      addedHumanIds: result.addedHumanIds,
      addedAgentIds: result.addedAgentIds,
    });
  }, [markExecuted]);

  const detail = useActionCardDetail(action);
  // The state label in the header: a word led by the raft-ui status pixel.
  // A card that is done or that this viewer cannot run folds to its header by
  // default; paused and reconfirm cards stay open because they are waiting on
  // the reader. A reconfirm card waits on the reader, so its pixel is the pink
  // attention pixel (Raft Design System › ActionCard state).
  const status = isExecuted
    ? { variant: "success" as const, label: formatMessage({ id: "actionCard.done" }) }
    : isFrozen
      ? { variant: "muted" as const, label: formatMessage({ id: "actionCard.frozen" }) }
      : needsReconfirmation
        ? { variant: "accent" as const, label: formatMessage({ id: "actionCard.status.reconfirm" }) }
        : blockedReasonText
          ? { variant: "muted" as const, label: formatMessage({ id: "actionCard.status.viewOnly" }) }
          : null;
  const foldsByDefault = isExecuted || (Boolean(blockedReasonText) && !isFrozen && !needsReconfirmation);
  // Fold is decided once, at mount, then belongs to the reader. Two cases need
  // more than `defaultOpen`: a card executed in this session stays open so its
  // result line shows, and a card that loses its label (the carrier channel
  // loaded after the card and the viewer turns out to be allowed) must open,
  // because the toggle only renders while there is a label.
  const [initialFold] = useState(foldsByDefault);
  // A card that folds by default explains itself under its title, so the line
  // shows while folded (rui MessageActionCardHeaderDescription): who ran it and
  // what came of it, or why this viewer cannot run it. Open cards keep their
  // note beside the button.
  const blockedInHeader = !isExecuted && foldsByDefault && Boolean(blockedReasonText);
  // The done line (DS `.rf-action__done`): an ink check, who ran it and when
  // (the time in Space Mono), then what came of it.
  const executedTime = metadata.executedAt ? formatMessageTime(metadata.executedAt) : "";
  const executedLine = isExecuted && (metadata.executedByUserName || metadata.result) ? (
    <>
      <Check aria-hidden="true" className="mr-1.5 inline-block size-4 shrink-0 align-[-3px] text-foreground" />
      {metadata.executedByUserName
        ? formatMessage(
            { id: "actionCard.committedBy" },
            {
              user: metadata.executedByUserName,
              n: (c: ReactNode) => <span key="n" className="font-semibold text-foreground">{c}</span>,
            },
          )
        : null}
      {metadata.executedByUserName && executedTime ? (
        <time
          dateTime={metadata.executedAt ?? undefined}
          className="font-mono text-mono-meta before:mx-1 before:content-['·']"
        >
          {executedTime}
        </time>
      ) : null}
      {metadata.result ? (
        <>
          {" "}
          <ResultLink result={metadata.result} />
        </>
      ) : null}
    </>
  ) : null;
  const headerLine = executedLine ?? (blockedInHeader ? blockedReasonText : null);
  const [readerOpen, setReaderOpen] = useState<boolean | null>(null);
  const open = status === null ? true : (readerOpen ?? !initialFold);
  const runsOnTargetServer = Boolean(targetServerName && carrierChannel?.type === "joint");

  return (
    <MessageActionCard
      className="action-card text-left"
      open={open}
      onOpenChange={setReaderOpen}
      data-state={metadata.state}
    >
      <MessageActionCardHeader>
        <MessageActionCardHeaderIcon>
          <ActionTypeIcon type={action.type} />
        </MessageActionCardHeaderIcon>
        <MessageActionCardHeaderTitle>
          <ActionTitleLine action={action} />
          {headerLine ? (
            <MessageActionCardHeaderDescription id={blockedInHeader ? blockedReasonId : undefined}>
              {headerLine}
            </MessageActionCardHeaderDescription>
          ) : null}
        </MessageActionCardHeaderTitle>
        {status ? (
          <MessageActionCardStatus variant={status.variant}>{status.label}</MessageActionCardStatus>
        ) : null}
        {status ? (
          <MessageActionCardCollapseTrigger aria-label={formatMessage({ id: "actionCard.toggleDetails" })} />
        ) : null}
      </MessageActionCardHeader>
      <MessageActionCardContent>
        {runsOnTargetServer ? (
          <MessageActionCardNotice>
            {formatMessage({ id: "actionCard.targetServer" }, { server: targetServerName ?? "" })}
          </MessageActionCardNotice>
        ) : null}
        {detail.notices.map((notice) => (
          <MessageActionCardNotice key={notice}>{notice}</MessageActionCardNotice>
        ))}
        {detail.scopes ? <ActionCardScopeNotices scopes={detail.scopes} agentName={detail.scopeAgentName} /> : null}
        {detail.properties.length > 0 ? (
          <MessageActionCardProperties>
            {detail.properties.map((property) => (
              <MessageActionCardProperty key={property.label}>
                <MessageActionCardPropertyLabel>{property.label}</MessageActionCardPropertyLabel>
                <MessageActionCardPropertyValue className={propertyValueClassName(property)}>
                  {property.value}
                </MessageActionCardPropertyValue>
              </MessageActionCardProperty>
            ))}
          </MessageActionCardProperties>
        ) : null}

        {action.draftHint ? (
          <>
            <MessageActionCardHintLabel>{formatMessage({ id: "actionCard.reason" })}</MessageActionCardHintLabel>
            <MessageActionCardHint>{action.draftHint}</MessageActionCardHint>
          </>
        ) : null}

        {detail.scopes ? <ActionCardScopes scopes={detail.scopes} /> : null}

        {error ? (
          <Banner intent="warning" density="sm" className="mt-3">{error}</Banner>
        ) : null}

        {isExecuted ? null : (
          <MessageActionCardActions>
            {blockedReasonText && !blockedInHeader ? (
              <MessageActionCardActionsNote id={blockedReasonId}>{blockedReasonText}</MessageActionCardActionsNote>
            ) : null}
            {/* The confirm is an ink-outline button with the action's verb: the
                screen's one pink button stays the composer's Send. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || isFrozen || sourceReadOnly || !canOperateCard}
              aria-describedby={blockedReasonText ? blockedReasonId : undefined}
              onClick={handleClick}
            >
              {busy
                ? "…"
                : isFrozen
                  ? formatMessage({ id: "actionCard.frozen" })
                  : needsReconfirmation
                    ? formatMessage({ id: "actionCard.reconfirm" })
                    : formatMessage({ id: actionVerb(action) })}
            </Button>
          </MessageActionCardActions>
        )}
      </MessageActionCardContent>

      {action.type === "agent:create" && agentDialogOpen ? (
        <CreateAgentDialog
          onClose={handleAgentDialogClose}
          prefilledName={action.name}
          prefilledDescription={action.description}
          prefilledMachineId={action.requiredComputer ?? action.suggestedComputer}
          prefilledMachineMode={action.requiredComputer ? "required" : action.suggestedComputer ? "preferred" : undefined}
          prefilledHosting={action.hosting}
          prefilledHostedModel={action.model}
          actionCardMessageId={messageId}
          actionCardConfirmationVersion={metadata.confirmationVersion}
          onCreated={handleAgentCreated}
          onSubmitStart={handleSubmitStart}
          onSubmitError={handleSubmitError}
          fromActionCard
        />
      ) : null}

      {action.type === "channel:create" && channelDialogOpen ? (
        <CreateChannelDialog
          onClose={handleChannelDialogClose}
          prefilledName={action.name}
          prefilledDescription={action.description}
          prefilledVisibility={action.visibility}
          prefilledHumanIds={action.initialHumans}
          prefilledAgentIds={action.initialAgents}
          onCreated={handleChannelCreated}
          actionCardMessageId={messageId}
          actionCardConfirmationVersion={metadata.confirmationVersion}
          onSubmitStart={handleSubmitStart}
          onSubmitError={handleSubmitError}
        />
      ) : null}

      {action.type === "channel:add_member" && addMembersDialogOpen ? (
        <AddMembersDialog
          channelId={action.channel}
          prefilledHumanIds={action.humans}
          prefilledAgentIds={action.agents}
          draftHint={action.draftHint}
          onClose={handleAddMembersDialogClose}
          onSubmitted={handleMembersAdded}
          actionCardMessageId={messageId}
          actionCardConfirmationVersion={metadata.confirmationVersion}
          onSubmitStart={handleSubmitStart}
          onSubmitError={handleSubmitError}
        />
      ) : null}
    </MessageActionCard>
  );
}

/** Machine values (keys, handles, URLs, computer names) are Space Mono. */
function propertyValueClassName(property: ActionCardProperty): string | undefined {
  if (property.muted) return "text-foreground-hint";
  if (property.breakAll) return "break-all font-mono text-mono-meta";
  if (property.mono) return "font-mono text-mono-meta";
  return undefined;
}

/**
 * The button label id for an action. Returns a `MessageId`, NOT text — the
 * caller formats it. Typing the return as MessageId makes a bad id a compile
 * error rather than a button that renders "actionCard.verb.createChannel".
 */
function actionVerb(action: ActionCardAction): MessageId {
  switch (action.type) {
    case "channel:create":
      return "actionCard.verb.createChannel";
    case "agent:create":
      return "actionCard.verb.createAgent";
    case "channel:add_member":
      return "actionCard.verb.addMembers";
    case "integration:approve_agent_login":
      return "actionCard.verb.approveLogin";
    case "integration:install_marketplace_app":
      return "actionCard.verb.installApp";
    case "integration:register_app":
      return "actionCard.verb.registerApp";
    case "integration:update_app_registration":
      return "actionCard.verb.updateApp";
    case "integration:recover_app_owner":
      return "actionCard.verb.recoverOwner";
  }
}

function ActionTitleLine({ action }: { action: ActionCardAction }) {
  const { formatMessage } = useIntl();
  const channels = useChannelStore((s) => s.channels);
  const dmChannels = useChannelStore((s) => s.dmChannels);
  const members = useServerStore((s) => s.members);
  const agents = useAgentStore((s) => s.agents);

  // Rich-text chunk. The `key` is REQUIRED: react-intl renders chunks as an
  // array, so an unkeyed element triggers React's list-key warning — silent in
  // the UI, which is why this class has landed three times in this codebase.
  const chunks = { n: (c: ReactNode) => <span key="n">{c}</span> };
  const title = (id: MessageId, values: Record<string, unknown> = {}) => (
    <>{formatMessage({ id }, { ...values, ...chunks })}</>
  );

  void dmChannels;
  void members;

  switch (action.type) {
    case "channel:create":
      // `visibility` is a union VALUE, previously interpolated as the English
      // adjective "private"/"public". An id per arm keeps the adjective
      // translatable and lets zh reorder it.
      return title(
        action.visibility === "private"
          ? "actionCard.title.createPrivateChannel"
          : "actionCard.title.createPublicChannel",
        { name: action.name },
      );
    case "agent:create":
      return title("actionCard.title.createAgent", { name: action.name });
    case "channel:add_member": {
      const channel = channels.find((c) => c.id === action.channel);
      const targetLabel = channel?.name
        ? `#${channel.name}`
        : formatMessage({ id: "actionCard.title.channelFallback" });
      const count = (action.humans?.length ?? 0) + (action.agents?.length ?? 0);
      // Was `member{count === 1 ? "" : "s"}` — hand-rolled English plurals.
      return title("actionCard.title.addMembers", { count, target: targetLabel });
    }
    case "integration:approve_agent_login":
      return title("actionCard.title.approveLogin", {
        client: action.clientName,
        agent: action.agentName,
      });
    case "integration:install_marketplace_app":
      return title("actionCard.title.installApp", {
        client: action.clientName,
        agent: action.agentName,
      });
    case "integration:register_app":
      return title("actionCard.title.registerApp", { name: action.name });
    case "integration:update_app_registration":
      return title("actionCard.title.updateApp", { clientKey: action.clientKey });
    case "integration:recover_app_owner": {
      const target = agents.find((agent) => agent.id === action.targetAgent);
      return title("actionCard.title.recoverOwner", {
        clientKey: action.clientKey,
        agent: target?.name ?? action.targetAgent.slice(0, 8),
      });
    }
  }
}

function ResultLink({ result }: { result: ActionCardResult }) {
  const { formatMessage } = useIntl();
  const cls = "font-semibold text-foreground-muted";
  // The leading arrow is punctuation shared by every arm, so it stays in JSX
  // rather than being duplicated into seven translations.
  const arrow = (body: ReactNode) => <span className={cls}>→ {body}</span>;

  switch (result.kind) {
    case "channel":
      return arrow(`#${result.name}`);
    case "agent":
      return arrow(`@${result.name}`);
    case "channel-members": {
      const total = result.addedHumanIds.length + result.addedAgentIds.length;
      return arrow(formatMessage(
        { id: "actionCard.result.channelMembers" },
        { count: total, channel: result.channelName },
      ));
    }
    case "agent-integration-login":
      return arrow(formatMessage(
        { id: "actionCard.result.integrationLogin" },
        { client: result.clientName, agent: result.agentName },
      ));
    case "marketplace-app-installation":
      return <div className="space-y-2">
        {arrow(formatMessage({ id: "actionCard.result.marketplaceInstalled" }, { client: result.clientName }))}
        {result.setupUrl && isSafeOAuthReturnUrl(result.setupUrl) ? <Button size="sm" variant="outline" nativeButton={false} role="link" render={<a href={result.setupUrl} target="_blank" rel="noopener noreferrer" aria-label={formatMessage({ id: "appSetup.continue" })} />}>{formatMessage({ id: "appSetup.continue" })}</Button> : null}
      </div>;
    case "integration-app-registration":
      // `mode` was interpolated raw as the words "registered"/"updated". A union
      // value is not copy — each arm gets its own message.
      return arrow(formatMessage(
        { id: result.mode === "register"
            ? "actionCard.result.appRegistered"
            : "actionCard.result.appUpdated" },
        { client: result.clientName, clientKey: result.clientKey },
      ));
    case "integration-app-owner-recovery":
      return arrow(formatMessage(
        { id: "actionCard.result.ownerRecovered" },
        { client: result.clientName, owner: result.ownerAgentName },
      ));
  }
}
