import type { Channel } from "../store/channelStore";
import type { Server } from "../store/serverStore";

/** ServerResolver proves the current human membership; never infer staff access. */
export function canUseRaftBench(role: Server["role"] | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Candidate visibility is supplied by the channel API; message reads still enforce ACL.
 * Private channels additionally need explicit membership. Public/joint channels
 * need not be joined. DMs, threads and archives remain outside this snapshot.
 */
export function isRaftBenchChannel(channel: Channel): boolean {
  return (
    !channel.archivedAt &&
    (channel.type === "channel" ||
      channel.type === "joint" ||
      (channel.type === "private" && channel.joined === true))
  );
}
