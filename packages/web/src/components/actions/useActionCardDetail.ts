// What an action card shows under its title, as data: labelled property rows,
// an optional OAuth permission list, and Raft's notes about consequence or
// permission. ActionCard lays these out with the raft-ui MessageActionCard
// parts, so the frame never branches on the action type.

import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { ActionCardAction } from "@botiverse/raft-shared";
import type { MessageId } from "../../i18n/messages";
import { useAgentStore } from "../../store/agentStore";
import { useServerStore } from "../../store/serverStore";
import { useChannelStore } from "../../store/channelStore";
import { useMachineStore } from "../../store/machineStore";

export interface ActionCardProperty {
  label: string;
  value: ReactNode;
  /** Long machine values (URLs, keys) break anywhere; they are Space Mono too. */
  breakAll?: boolean;
  /** A short machine value (client key, @handle, Computer name): Space Mono. */
  mono?: boolean;
  /** The value is a placeholder ("No description prefilled."), not data. */
  muted?: boolean;
}

export interface ActionCardDetail {
  properties: ActionCardProperty[];
  /** OAuth scope ids for the permission list. */
  scopes?: readonly string[];
  /** The agent the app will send to, shown with an agent-inbound scope. */
  scopeAgentName?: string;
  /** Raft's notes about what the action does or who may run it. */
  notices: string[];
}

export function useActionCardDetail(action: ActionCardAction): ActionCardDetail {
  const { formatMessage } = useIntl();
  const channels = useChannelStore((s) => s.channels);
  const members = useServerStore((s) => s.members);
  const agents = useAgentStore((s) => s.agents);
  const machines = useMachineStore((s) => s.machines);

  const field = (id: MessageId) => formatMessage({ id });
  const humanName = (id: string) =>
    members.find((m) => m.userId === id)?.displayName ?? members.find((m) => m.userId === id)?.name ?? id.slice(0, 8);
  const agentName = (id: string) =>
    agents.find((a) => a.id === id)?.displayName ?? agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);

  switch (action.type) {
    case "channel:create": {
      const properties: ActionCardProperty[] = [];
      if (action.description) properties.push({ label: field("actionCard.field.description"), value: action.description });
      const humans = (action.initialHumans ?? []).map(humanName).filter(Boolean);
      if (humans.length > 0) properties.push({ label: field("actionCard.field.humans"), value: humans.join(", ") });
      const initialAgents = (action.initialAgents ?? []).map(agentName);
      if (initialAgents.length > 0) properties.push({ label: field("actionCard.field.agents"), value: initialAgents.join(", ") });
      return { properties, notices: [] };
    }
    case "agent:create": {
      const properties: ActionCardProperty[] = [];
      properties.push(action.description
        ? { label: field("actionCard.field.description"), value: action.description }
        : { label: field("actionCard.field.description"), value: field("actionCard.noDescription"), muted: true });
      const targetComputer = action.requiredComputer ?? action.suggestedComputer;
      if (targetComputer) {
        const targetMachine = machines.find((machine) => machine.id === targetComputer);
        properties.push({
          label: field(action.requiredComputer ? "actionCard.field.requiredComputer" : "actionCard.field.suggestedComputer"),
          value: targetMachine?.name ?? targetComputer.slice(0, 8),
          mono: true,
        });
      }
      if (action.hosting === "antiproton") {
        properties.push({
          label: field("actionCard.field.hosting"),
          value: action.model
            ? formatMessage({ id: "actionCard.hostedOnModel" }, { model: action.model })
            : field("actionCard.hosted"),
        });
      }
      return { properties, notices: [] };
    }
    case "channel:add_member": {
      const properties: ActionCardProperty[] = [];
      const channel = channels.find((c) => c.id === action.channel);
      if (channel?.name) properties.push({ label: field("actionCard.field.channel"), value: `#${channel.name}` });
      const humans = (action.humans ?? []).map(humanName).filter(Boolean);
      if (humans.length > 0) properties.push({ label: field("actionCard.field.humans"), value: humans.join(", ") });
      const addAgents = (action.agents ?? []).map(agentName);
      if (addAgents.length > 0) properties.push({ label: field("actionCard.field.agents"), value: addAgents.join(", ") });
      return { properties, notices: [] };
    }
    case "integration:approve_agent_login":
      return {
        properties: [
          { label: field("actionCard.field.service"), value: action.clientName },
          { label: field("actionCard.field.agent"), value: `@${action.agentName}`, mono: true },
        ],
        scopes: action.scopes,
        scopeAgentName: action.agentName,
        notices: [],
      };
    case "integration:install_marketplace_app":
      return {
        properties: [
          { label: field("actionCard.field.service"), value: action.clientName },
          { label: field("actionCard.field.agent"), value: formatMessage({ id: "actionCard.agentHandle" }, { agent: action.agentName }), mono: true },
        ],
        scopes: action.scopes,
        scopeAgentName: action.agentName,
        notices: [field("actionCard.installMarketplaceOwnerOnly"), ...(action.setupUrl ? [formatMessage({ id: "appSetup.requiredAfterInstall" }), ...(action.setupDescription ? [action.setupDescription] : [])] : [])],
      };
    case "integration:register_app": {
      const properties: ActionCardProperty[] = [
        action.clientKey
          ? { label: field("actionCard.field.clientKey"), value: action.clientKey, mono: true }
          : { label: field("actionCard.field.clientKey"), value: field("actionCard.autoGeneratedOnCommit") },
        { label: field("actionCard.field.redirectUrl"), value: action.returnUrl, breakAll: true },
      ];
      if (action.homepageUrl) properties.push({ label: field("actionCard.field.appUrl"), value: action.homepageUrl, breakAll: true });
      if (action.agentManifestUrl) properties.push({ label: field("actionCard.field.agentManifest"), value: action.agentManifestUrl, breakAll: true });
      if (action.setupUrl) properties.push({ label: formatMessage({ id: "appSetup.urlLabel" }), value: action.setupUrl, breakAll: true });
      if (action.setupDescription) properties.push({ label: formatMessage({ id: "appSetup.descriptionLabel" }), value: action.setupDescription });
      const notices = [field("actionCard.registerOwnerNote")];
      if (action.unsafeDemoUrlOverride) notices.push(field("actionCard.unsafeDemoUrlOverride"));
      return { properties, scopes: action.scopes, notices };
    }
    case "integration:update_app_registration": {
      const properties: ActionCardProperty[] = [{ label: field("actionCard.field.clientKey"), value: action.clientKey, mono: true }];
      if (action.name) properties.push({ label: field("actionCard.field.name"), value: action.name });
      if (action.returnUrl) properties.push({ label: field("actionCard.field.redirectUrl"), value: action.returnUrl, breakAll: true });
      if (action.homepageUrl) properties.push({ label: field("actionCard.field.appUrl"), value: action.homepageUrl, breakAll: true });
      if (action.agentManifestUrl) properties.push({ label: field("actionCard.field.agentManifest"), value: action.agentManifestUrl, breakAll: true });
      if (action.setupUrl) properties.push({ label: formatMessage({ id: "appSetup.urlLabel" }), value: action.setupUrl, breakAll: true });
      if (action.setupDescription) properties.push({ label: formatMessage({ id: "appSetup.descriptionLabel" }), value: action.setupDescription });
      const notices: string[] = [];
      if (action.unsafeDemoUrlOverride) notices.push(field("actionCard.unsafeDemoUrlOverride"));
      return { properties, scopes: action.scopes, notices };
    }
    case "integration:recover_app_owner": {
      const target = agents.find((agent) => agent.id === action.targetAgent);
      return {
        properties: [
          { label: field("actionCard.field.clientKey"), value: action.clientKey, mono: true },
          { label: field("actionCard.field.recoveryOwner"), value: `@${target?.name ?? action.targetAgent.slice(0, 8)}`, mono: true },
        ],
        notices: [field("actionCard.adminRecoveryOnly")],
      };
    }
  }
}
