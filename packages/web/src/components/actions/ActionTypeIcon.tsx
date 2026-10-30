import { AppWindow, Bot, Hash, KeyRound, Package, ShieldAlert, UserPlus } from "lucide-react";
import type { ActionCardAction } from "@botiverse/raft-shared";

/** The lucide icon for an action card's type, placed in the header icon box. */
export function ActionTypeIcon({ type }: { type: ActionCardAction["type"] }) {
  switch (type) {
    case "channel:create":
      return <Hash />;
    case "agent:create":
      return <Bot />;
    case "channel:add_member":
      return <UserPlus />;
    case "integration:approve_agent_login":
      return <KeyRound />;
    case "integration:install_marketplace_app":
      return <Package />;
    case "integration:recover_app_owner":
      return <ShieldAlert />;
    case "integration:register_app":
    case "integration:update_app_registration":
      return <AppWindow />;
  }
}
