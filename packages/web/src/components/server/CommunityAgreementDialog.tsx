import { Button, Card, DialogSurface } from "@botiverse/raft-ui";
import CloseButton from "../ui/CloseButton";
import Tooltip from "../ui/Tooltip";
import { useCallback, useState } from "react";
import { useIntl } from "react-intl";
import { X } from "lucide-react";
import Modal from "../Modal";
import Banner from "../ui/Banner";
import AgreementBody from "./AgreementBody";

export interface CommunityAgreement {
  id: string;
  title: string;
  bodyMarkdown: string;
  version: number;
}

export default function CommunityAgreementDialog({
  agreement,
  onClose,
  onAgree,
}: {
  agreement: CommunityAgreement;
  onClose: () => void;
  onAgree: (agreementId: string) => Promise<void>;
}) {
  const { formatMessage } = useIntl();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleAgree = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await onAgree(agreement.id);
    } catch (err: any) {
      const response = err?.response?.data;
      setError(
        response?.error === "agreement_changed"
          ? formatMessage({ id: "server.communityAgreement.updated" })
          : formatMessage({ id: "server.communityAgreement.failedToJoin" }),
      );
    } finally {
      setSubmitting(false);
    }
  }, [agreement.id, formatMessage, onAgree]);

  return (
    <Modal onClose={onClose}>
      {/* DS Dialog surface (rf-dialog): raft-ui's DialogSurface draws the frame;
          20 padding here. The surface rather than raft-ui's Dialog parts because
          the shared Modal owns Escape/backdrop/focus here. */}
      <DialogSurface className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-headline">{agreement.title}</h2>
            <div className="mt-1 font-mono text-mono-meta text-foreground-hint">
              {formatMessage({ id: "server.communityAgreement.version" }, { version: agreement.version })}
            </div>
          </div>
          <Tooltip content={formatMessage({ id: "common.close" })}>
            <CloseButton
              type="button"
              onClick={onClose}
              className="shrink-0"
              data-slot="button"
            >
              <X size={18} />
            </CloseButton>
          </Tooltip>
        </div>

        <Card className="max-h-[50vh] overflow-y-auto p-4 text-callout text-foreground-muted">
          <AgreementBody source={agreement.bodyMarkdown} />
        </Card>

        {error && (
          <Banner intent="warning" density="sm" className="mt-4">
            {error}
          </Banner>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button size="lg"
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={submitting}
          >
            {formatMessage({ id: "server.communityAgreement.cancel" })}
          </Button>
          <Button size="lg"
            variant="accent"
            type="button"
            onClick={handleAgree}
            disabled={submitting}
          >
            {submitting
              ? formatMessage({ id: "server.communityAgreement.joining" })
              : formatMessage({ id: "server.communityAgreement.agreeContinue" })}
          </Button>
        </div>
      </DialogSurface>
    </Modal>
  );
}
