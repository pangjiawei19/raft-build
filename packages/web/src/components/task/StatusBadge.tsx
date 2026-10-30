// The app's task-status badge. It renders raft-ui's `TaskStatusBadge` so the
// icon and colours come from the ONE task-status source (the `task-status-*`
// tokens), keeping every surface consistent within a theme.
//
// Slock owns the label COPY (translated, passed as children) and the extra
// content (e.g. `#N @assignee`); raft-ui owns how a status looks.
//
// Usage:
//   <StatusBadge status="done">Done</StatusBadge>
//   <StatusBadge status={task.status}>
//     <span className="shrink-0">#{task.taskNumber}</span>
//     {task.claimedByName ? <span className="min-w-0 truncate">@{task.claimedByName}</span> : null}
//   </StatusBadge>

import type { ComponentPropsWithRef, ReactNode } from "react";
import { TaskStatusBadge } from "@botiverse/raft-ui";
import type { TaskChipSize } from "@botiverse/raft-ui";
import type { TaskStatus } from "../../store/taskStore";
import { TASK_STATUS_UI, toRuiTaskStatus } from "./taskStatusUi";

interface StatusBadgeProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  status: TaskStatus;
  children?: ReactNode;
  /** `sm` lines the badge up with the `sm` Badges beside it (e.g. the Activity
   *  card metadata row); omitted, it keeps the task chip's own size. */
  size?: TaskChipSize;
  /** Existing callsites pass an icon size; raft-ui sizes the icon from the
   *  token recipe, so this is accepted for compatibility and ignored. */
  iconSize?: number;
}

export function StatusBadge({ status, children, iconSize: _iconSize, ...rest }: StatusBadgeProps) {
  return (
    <TaskStatusBadge status={toRuiTaskStatus(status)} data-status={status} {...rest}>
      {children}
    </TaskStatusBadge>
  );
}

/** Re-exported so a caller can read the label id without importing the map. */
export { TASK_STATUS_UI };
