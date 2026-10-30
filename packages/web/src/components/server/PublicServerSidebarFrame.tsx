import type { ReactNode } from "react";
import { SidebarHeader, SidebarHeaderTitle, SidebarRoot } from "@botiverse/raft-ui";

/** Frame shared by the two side columns of the public server page (channels
 *  and settings): the rui SidebarRoot, a header row and a scroll surface.
 *
 *  The head is raft-ui's SidebarHeader, the same head as the signed-in
 *  Sidebar's (on a phone, where the column is the page, the frame). The root
 *  and scroll surface classes mirror the signed-in column; they are measured
 *  against it in a real browser rather than imported, because importing from
 *  Sidebar.tsx would pull the member stores into the anonymous page. */
export default function PublicServerSidebarFrame({
  title,
  testIdPrefix,
  scrollTestId,
  children,
}: {
  title: string;
  testIdPrefix: string;
  scrollTestId: string;
  children: ReactNode;
}) {
  return (
    <SidebarRoot
      className="relative flex h-full w-full flex-col border-r border-line-seam bg-layer-sidebar font-display text-foreground select-none"
      data-testid={`${testIdPrefix}-root`}
    >
      <SidebarHeader data-testid={`${testIdPrefix}-header`}>
        <SidebarHeaderTitle render={<h1>{title}</h1>} />
      </SidebarHeader>
      {/* The list starts 8px below the head's seam, level with the rail's
          first button below the rail's server cell, as the signed-in list
          does under the top bar. */}
      <div className="scrollbar-quiet min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2" data-testid={scrollTestId}>
        {children}
      </div>
    </SidebarRoot>
  );
}
