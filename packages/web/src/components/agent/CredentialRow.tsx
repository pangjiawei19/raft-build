import { Button, Card } from "@botiverse/raft-ui";
import { useCallback } from "react";
import { useIntl } from "react-intl";
import type { Credential } from "./ExternalAgentToken";

export function CredentialRow({
  credential,
  confirming,
  pending,
  revokingId,
  onConfirmRevoke,
  onCancelRevoke,
  onStartRevoke,
}: {
  credential: Credential;
  confirming: boolean;
  pending: boolean;
  revokingId: string | null;
  onConfirmRevoke: (credentialId: string) => void;
  onCancelRevoke: () => void;
  onStartRevoke: (credentialId: string) => void;
}) {
  const { formatMessage, formatDate } = useIntl();
  const handleConfirmClick = useCallback(() => onConfirmRevoke(credential.id), [onConfirmRevoke, credential.id]);
  const handleStartClick = useCallback(() => onStartRevoke(credential.id), [onStartRevoke, credential.id]);
  return (
    <Card className="block space-y-1 p-2">
      <p className="break-words text-callout font-semibold text-foreground">{credential.name || formatMessage({ id: "agent.detail.externalTokenLabel" })} <span className="break-all font-mono text-mono-meta font-normal text-foreground-hint">{credential.maskedToken || credential.id.slice(0, 8)}</span></p>
      <p className="text-caption text-foreground-hint">{formatMessage({ id: "agent.detail.externalTokenCreated" }, { date: formatDate(credential.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
      <p className="text-caption text-foreground-muted">{formatMessage({ id: credential.revokedAt ? "agent.detail.externalTokenRevoked" : "agent.detail.externalTokenActive" })}</p>
      {!credential.revokedAt && (confirming ? (
        <>
          <p className="text-callout text-foreground">{formatMessage({ id: "agent.detail.externalTokenRevokeWarning" })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={revokingId !== null} onClick={onCancelRevoke}
              className="whitespace-normal">
              {formatMessage({ id: "agent.detail.externalTokenCancel" })}
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={pending || revokingId !== null} onClick={handleConfirmClick}
              className="whitespace-normal">
              {formatMessage({ id: "agent.detail.externalTokenConfirmRevoke" })}
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={pending || revokingId !== null} onClick={handleStartClick}
          className="whitespace-normal">
          {formatMessage({ id: "agent.detail.externalTokenRevoke" })}
        </Button>
      ))}
    </Card>
  );
}
