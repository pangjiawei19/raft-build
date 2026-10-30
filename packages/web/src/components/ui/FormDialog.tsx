import { useCallback, useRef, useState } from "react";
import type { ComponentProps, FormEventHandler, ReactNode } from "react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogNav,
  DialogTitle,
  SidebarItem,
  SidebarItemContent,
  SidebarItemTitle,
} from "@botiverse/raft-ui";

export type FormDialogSection = {
  /** The id of the FormSection it scrolls to (unique in the document). */
  id: string;
  label: ReactNode;
};

/**
 * A bigger form edited in one go, as a wide centred dialog (raft-ui Dialog
 * `size="wide"`): it dims the page and does not animate, like every centred
 * modal. Its anatomy is raft-ui's:
 * - a 56px head naming what is edited (its sticker, if it has one, and its
 *   name) with ×; nothing that commits;
 * - an optional slot under the head for what must stay in view (a form-level
 *   error, a secret shown once);
 * - the body: the section list (DialogNav, sidebar rows; the one you are
 *   reading is the yellow "you are here") beside the scrolling sections
 *   (raft-ui FormSection), the list hidden on a phone;
 * - a footer with the commit: Cancel, then the screen's one pink button.
 *
 * Outside presses do not dismiss it (a half-filled form is not thrown away by
 * a stray click); × / Escape / Cancel do.
 */
export function FormDialog({
  title,
  leading,
  closeLabel,
  onClose,
  onSubmit,
  notice,
  footer,
  sections,
  navLabel,
  children,
  testId,
  bodyTestId,
  navTestId,
}: {
  title: ReactNode;
  /** The thing's own sticker (an app's logo, an agent's face), if it has one. */
  leading?: ReactNode;
  /** aria-label for ×. */
  closeLabel: string;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** Kept in view under the head: a form-level error, a value shown once. */
  notice?: ReactNode;
  /** The commit row: Cancel, then the primary action. */
  footer: ReactNode;
  /** The sections, in order, for the section list. */
  sections: readonly FormDialogSection[];
  navLabel: string;
  children: ReactNode;
  testId?: string;
  bodyTestId?: string;
  navTestId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(sections[0]?.id);

  const handleOpenChange = useCallback<NonNullable<ComponentProps<typeof Dialog>["onOpenChange"]>>(
    (nextOpen) => {
      if (!nextOpen) onClose();
    },
    [onClose],
  );

  const scrollToSection = useCallback((id: string) => {
    setCurrent(id);
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!scroller || !target) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo?.({ top, behavior: "smooth" });
  }, []);

  // The list follows the reading position: the last section whose top has
  // reached the body's top edge, or the last one once the body is scrolled
  // to its end.
  const syncCurrentFromScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || sections.length === 0) return;
    let next = sections[0]!.id;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2) {
      next = sections[sections.length - 1]!.id;
    } else {
      const line = scroller.getBoundingClientRect().top + 16;
      for (const section of sections) {
        const target = scroller.querySelector<HTMLElement>(`#${CSS.escape(section.id)}`);
        if (!target || target.getBoundingClientRect().top > line) break;
        next = section.id;
      }
    }
    setCurrent((previous) => (previous === next ? previous : next));
  }, [sections]);

  return (
    <Dialog open onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent size="wide" render={<form onSubmit={onSubmit} data-testid={testId} />}>
        <DialogHeader bar>
          {leading ? <span className="flex shrink-0">{leading}</span> : null}
          <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
          <DialogClose aria-label={closeLabel} />
        </DialogHeader>
        {notice ? <div className="shrink-0 space-y-2 border-b border-line-hairline px-5 py-3">{notice}</div> : null}
        <DialogBody bar>
          {sections.length > 1 ? (
            <DialogNav aria-label={navLabel} data-testid={navTestId}>
              {sections.map((section) => (
                <FormDialogNavItem
                  key={section.id}
                  section={section}
                  active={current === section.id}
                  onSelect={scrollToSection}
                />
              ))}
            </DialogNav>
          ) : null}
          <div
            ref={scrollRef}
            onScroll={syncCurrentFromScroll}
            className="min-w-0 flex-1 overflow-y-auto px-5"
            data-testid={bodyTestId}
          >
            {children}
          </div>
        </DialogBody>
        <DialogFooter bar data-testid={testId ? `${testId}-footer` : undefined}>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormDialogNavItem({
  section,
  active,
  onSelect,
}: {
  section: FormDialogSection;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const handleClick = useCallback(() => onSelect(section.id), [onSelect, section.id]);
  return (
    <SidebarItem
      active={active}
      aria-current={active ? "true" : undefined}
      data-form-dialog-section={section.id}
      onClick={handleClick}
    >
      <SidebarItemContent className="items-center">
        <SidebarItemTitle>{section.label}</SidebarItemTitle>
      </SidebarItemContent>
    </SidebarItem>
  );
}
