import { CURRENT_LEGAL_ACCEPTANCE } from "@botiverse/raft-shared";
import { useIntl } from "react-intl";
import { useCallback } from "react";
import type { ReactNode } from "react";

import { Checkbox } from "@botiverse/raft-ui";

// Links inside the acceptance sentence are prose links (DS Message › rf-link).
const LEGAL_LINK_CLASS = "text-foreground-link underline decoration-2 underline-offset-2 hover:decoration-attention";

export default function LegalAcceptanceCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const { formatMessage } = useIntl();
  const handleCheckedChange = useCallback((event: boolean) => {
    onChange(event);
  }, [onChange]);
  return (
    <label className="flex items-start gap-2 text-callout font-semibold text-foreground">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={handleCheckedChange}
        className="shrink-0"
      />
      <span className="min-w-0">
        {formatMessage(
          { id: "auth.legalAcceptance.agreement" },
          {
            terms: (c: ReactNode) => (
              <a
                key="terms"
                href={CURRENT_LEGAL_ACCEPTANCE.termsUrl}
                target="_blank"
                rel="noreferrer"
                className={LEGAL_LINK_CLASS}
              >
                {c}
              </a>
            ),
            privacy: (c: ReactNode) => (
              <a
                key="privacy"
                href={CURRENT_LEGAL_ACCEPTANCE.privacyUrl}
                target="_blank"
                rel="noreferrer"
                className={LEGAL_LINK_CLASS}
              >
                {c}
              </a>
            ),
          },
        )}
      </span>
    </label>
  );
}
