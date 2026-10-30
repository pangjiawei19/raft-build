import { InputGroup, InputGroupAddon, InputGroupInput, Button } from "@botiverse/raft-ui";
import { useCallback, useId, useState } from "react";
import type { ChangeEvent } from "react";
import { useIntl } from "react-intl";
import DialogCard from "../ui/DialogCard";
import SidebarSectionEmojiPicker from "./SidebarSectionEmojiPicker";

/**
 * Create / rename a custom sidebar section (Raft Design System › Dialog): the
 * product's DialogCard shell (popover layer, 16px radius, headline title,
 * ghost close), one labelled field, then at most two actions — a ghost Cancel
 * on the left and the pink primary on the right, the dialog's one reason to
 * exist.
 */
export default function SidebarSectionDialog({
  title,
  initialName = "",
  initialEmoji = "",
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName?: string;
  initialEmoji?: string;
  submitLabel: string;
  onSubmit: (value: { name: string; emoji: string | null }) => void;
  onClose: () => void;
}) {
  const { formatMessage } = useIntl();
  const titleId = useId();
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const trimmedName = name.trim();
  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setName(event.target.value), []);

  return (
    <DialogCard title={title} titleId={titleId} onClose={onClose} closeOnBackdrop maxWidthClass="max-w-[400px]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedName) return;
          onSubmit({ name: trimmedName, emoji: emoji.trim() || null });
        }}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1.5">
          <div className="font-sans text-footnote font-semibold text-foreground">
            {formatMessage({ id: "layout.sidebar.sectionName" })}
          </div>
          <InputGroup>
            <InputGroupAddon className="p-0">
            <SidebarSectionEmojiPicker value={emoji} onChange={setEmoji} />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              aria-label={formatMessage({ id: "layout.sidebar.sectionName" })}
              maxLength={80}
              value={name}
              onChange={handleNameChange}
              className="min-w-0 flex-1"
              placeholder={formatMessage({ id: "layout.sidebar.sectionNamePlaceholder" })}
            />
          </InputGroup>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="lg" variant="ghost" type="button" onClick={onClose}>
            {formatMessage({ id: "layout.sidebar.cancelSection" })}
          </Button>
          <Button size="lg" variant="primary" type="submit" disabled={!trimmedName}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </DialogCard>
  );
}
