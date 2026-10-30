import { useCallback } from "react";
import { Checkbox } from "@botiverse/raft-ui";

export function GrantScopeCheckbox({
  scope,
  checked,
  onToggle,
}: {
  scope: string;
  checked: boolean;
  onToggle: (scope: string, checked: boolean) => void;
}) {
  const handleCheckedChange = useCallback((next: boolean) => onToggle(scope, next), [onToggle, scope]);
  return (
    <label className="flex min-h-8 items-center gap-2 break-all font-mono text-mono-meta text-foreground">
      <Checkbox checked={checked} onCheckedChange={handleCheckedChange} />
      {scope}
    </label>
  );
}
