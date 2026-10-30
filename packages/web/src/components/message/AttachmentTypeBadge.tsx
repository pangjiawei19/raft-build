import { FilePreviewBadge } from "@botiverse/raft-ui";
import { attachmentBadgeLabel } from "../../utils/attachmentBadgeLabel";

/**
 * The file-type chip, in one place.
 *
 * RUI's badge renders no label of its own, so this wrapper supplies the
 * extension text. It is the inline chip (`placement="inline"`) so each surface
 * decides where it sits: the Files row passes its absolute corner, the card and
 * preview header leave it inline. Renders nothing for unknown extensions.
 */
export function AttachmentTypeBadge({
  filename,
  className,
  "data-testid": testId,
  "data-message-affordance": affordance,
}: {
  filename: string;
  className?: string;
  "data-testid"?: string;
  "data-message-affordance"?: string;
}) {
  const label = attachmentBadgeLabel(filename);
  if (!label) return null;

  return (
    <FilePreviewBadge
      data-testid={testId}
      data-message-affordance={affordance}
      placement="inline"
      className={className}
    >
      {label}
    </FilePreviewBadge>
  );
}
