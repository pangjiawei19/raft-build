/**
 * Canonical key/value row — small label above value.
 *
 * Replaces the hand-rolled "small grey label above a value" pattern that
 * appeared 30+ times across detail panels (HumanDetailPanel, AgentDetailPanel,
 * MachineDetailPanel) and the SettingsPanel body.
 *
 * Background: stdrc 2026-05-12 #wg-theme:a987f888 asked for strong-signal
 * primitives to be lifted in one PR. KeyValueRow is the second of the three.
 *
 * Slots:
 * - `label`           — the muted label text (string or node)
 * - `value`           — the value content (string or node, often code/mono)
 * - `mono`            — true → render the value cell in `font-mono`
 * - `breakAll`        — true → render the value cell with `break-all` (long
 *                       emails, hostnames, etc.)
 * - `action`          — optional inline trailing element rendered next to the
 *                       label (e.g. an edit pencil button)
 * - `className`       — additional classes on the outer wrapper
 * - `valueClassName`  — additional classes on the value cell
 *
 * Typography follows Raft Design System › PropertyList: the label (dt) is
 * 13/18 500 ink-3, the value (dd) is 14/20 ink. Pass `mono` for fields like
 * email / dates / IDs — what machines write is Space Mono 12/16.
 *
 * If your row needs an inline-editable value (with Save/Cancel and per-row
 * loading state), this primitive is not the right fit — it intentionally
 * stays a presentational primitive. Inline-edit shells like the role / avatar
 * editors in HumanDetailPanel keep their own structure.
 */

import type { ReactNode } from "react";

export type KeyValueRowProps = {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  breakAll?: boolean;
  action?: ReactNode;
  className?: string;
  valueClassName?: string;
};

export default function KeyValueRow({
  label,
  value,
  mono = false,
  breakAll = false,
  action,
  className,
  valueClassName,
}: KeyValueRowProps) {
  const wrapperCls = className ? className : undefined;
  const valueClsParts = [mono ? "font-mono text-mono-meta text-foreground" : "text-callout text-foreground"];
  if (breakAll) valueClsParts.push("break-all");
  if (valueClassName) valueClsParts.push(valueClassName);
  const valueCls = valueClsParts.join(" ");
  return (
    <div className={wrapperCls}>
      <div className="mb-1 flex items-center gap-2">
        <div className="text-footnote font-medium text-foreground-hint">{label}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={valueCls}>{value}</div>
    </div>
  );
}
