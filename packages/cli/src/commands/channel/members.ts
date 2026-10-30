// `raft channel members <target>` (or `--target <target>`) — GET /internal/agent-api/channel-members?channel=<target>
//
// Returns the current join/post members for a channel, DM, or thread.

import type { AgentChannelMembersData } from "@botiverse/raft-shared";
import type { Command } from "commander";

import { defineCommand, registerCliCommand } from "../../core/command";
import type { CommandRuntimeOptions } from "../../core/context";
import { CliError } from "../../core/errors";
import { writeText } from "../../core/renderer";
import { createAgentApiSurfaceClient } from "../../agentApiPath";
import { formatChannelMembers } from "../server/_format";
import { positionalOrFlagTarget } from "./_targetArg";

export const channelMembersCommand = defineCommand(
  {
    name: "members",
    description: "List agents and humans who are members of a channel, DM, or thread",
    arguments: ["[target]"],
    options: [{ flags: "--target <target>", description: "Channel, DM, or thread to list (same as the positional target)" }],
  },
  async (ctx, targetArg: string | undefined, opts: { target?: string } = {}) => {
    const channel = positionalOrFlagTarget(targetArg, opts.target);
    if (!channel) {
      throw new CliError({
        code: "INVALID_ARG",
        message: "A target is required: a channel, DM, or thread.",
        suggestedNextAction: 'Run `raft channel members "#channel"` (or `--target "#channel"`).',
      });
    }

    const agentContext = ctx.loadAgentContext();
    const client = ctx.createApiClient(agentContext);
    const agentApi = createAgentApiSurfaceClient(client);
    const res = await agentApi.channels.members({ channel });
    if (!res.ok) {
      throw new CliError({
        code: res.status >= 500 ? "SERVER_5XX" : "MEMBERS_FAILED",
        message: res.error ?? `HTTP ${res.status}`,
      });
    }
    writeText(ctx.io, formatChannelMembers(res.data as AgentChannelMembersData));
  },
);

export function registerChannelMembersCommand(parent: Command, runtimeOptions?: CommandRuntimeOptions): void {
  registerCliCommand(parent, channelMembersCommand, runtimeOptions);
}
