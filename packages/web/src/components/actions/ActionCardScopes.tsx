// The OAuth permissions an action card asks for, in the raft-ui scope list (a
// capped scroll area), and Raft's notes on where the app may send. The notes
// are notices, so the card renders them first, above the properties
// (ActionCardScopeNotices.tsx); the list stays in the body.

import { useIntl } from "react-intl";
import {
  MessageActionCardScope,
  MessageActionCardScopeDescription,
  MessageActionCardScopeList,
  MessageActionCardScopeListLabel,
  MessageActionCardScopeListViewport,
  MessageActionCardScopeName,
} from "@botiverse/raft-ui";
import { OAUTH_SCOPE_PRESENTATION, normalizeVisibleOAuthScopes } from "../../lib/oauthScopePresentation";

export function ActionCardScopes({ scopes }: { scopes: readonly string[] }) {
  const { formatMessage } = useIntl();
  const visibleScopes = normalizeVisibleOAuthScopes(scopes);
  const label = formatMessage({ id: "actionCard.permissions" }, { count: visibleScopes.length || scopes.length });

  if (visibleScopes.length === 0) {
    return (
      <MessageActionCardScopeList>
        <MessageActionCardScopeListLabel>{label}</MessageActionCardScopeListLabel>
        <div className="break-all font-mono text-mono-meta text-foreground">{scopes.length > 0 ? scopes.join(", ") : "-"}</div>
      </MessageActionCardScopeList>
    );
  }

  return (
    <MessageActionCardScopeList>
      <MessageActionCardScopeListLabel>{label}</MessageActionCardScopeListLabel>
      <MessageActionCardScopeListViewport aria-label={label}>
        {visibleScopes.map((scope) => (
          <MessageActionCardScope key={scope}>
            <MessageActionCardScopeName>{scope}</MessageActionCardScopeName>
            <MessageActionCardScopeDescription>
              {formatMessage({ id: OAUTH_SCOPE_PRESENTATION[scope].copyId })}
            </MessageActionCardScopeDescription>
          </MessageActionCardScope>
        ))}
      </MessageActionCardScopeListViewport>
    </MessageActionCardScopeList>
  );
}
