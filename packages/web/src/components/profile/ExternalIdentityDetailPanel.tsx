import type { ExternalMessageAuthorProjection } from "@botiverse/raft-shared";
import { PanelAction, ProfilePanelBody, Separator } from "@botiverse/raft-ui";
import { X } from "lucide-react";
import { useMemo } from "react";
import { useIntl } from "react-intl";
import AvatarSlot from "../ui/AvatarSlot";
import PanelHeader from "../ui/PanelHeader";
import SectionEyebrow from "../ui/SectionEyebrow";
import {
  EXTERNAL_ACTOR_KIND_MESSAGE_IDS,
  formatExternalProviderLabel,
} from "../message/externalIdentityPresentation";

const HEADER_CONTAINER_PROPS = { "data-testid": "external-identity-header" };

export default function ExternalIdentityDetailPanel({
  profile,
  onBack,
  onClose,
}: {
  profile: ExternalMessageAuthorProjection;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { formatMessage } = useIntl();
  const headerBack = onBack ?? onClose;
  const providerLabel = formatExternalProviderLabel(profile.provider, formatMessage);
  const actorKindLabel = formatMessage({
    id: EXTERNAL_ACTOR_KIND_MESSAGE_IDS[profile.actorKind ?? "unknown"],
  });
  const subtitle = providerLabel
    ? formatMessage(
        { id: "message.externalIdentity.providerAndKind" },
        { provider: providerLabel, kind: actorKindLabel },
      )
    : actorKindLabel;
  const mobileBackProps = useMemo(() => ({
    "data-testid": "external-mobile-back",
    title: formatMessage({ id: "common.announcement.back" }),
  }), [formatMessage]);

  return (
    <>
      <PanelHeader
        title={profile.displayName}
        subtitle={subtitle}
        iconSlot={
          <AvatarSlot
            context="panel-header"
            type="app"
            appAvatarUrl={profile.avatarUrl}
            appInitials={profile.displayName}
          />
        }
        iconAlwaysVisible
        iconKind="avatar"
        onMobileBack={headerBack}
        backButtonVisibility={onBack ? "always" : "responsive"}
        mobileBackProps={mobileBackProps}
        containerProps={HEADER_CONTAINER_PROPS}
        actions={
          // DS header icon button, as on the human and agent profiles.
          <PanelAction
            onClick={onClose}
            className={onBack ? "flex" : "hidden md:flex"}
            aria-label={formatMessage({ id: "common.close" })}
            title={formatMessage({ id: "common.close" })}
          >
            <X size={22} aria-hidden="true" />
          </PanelAction>
        }
      />

      <ProfilePanelBody className="flex-1 overflow-y-auto bg-layer-canvas">
        {profile.workspaceName ? (
          <div>
          <div
            data-testid="external-identity-source"
            className="px-5 py-3"
          >
            <SectionEyebrow as="div" className="mb-1">
              {formatMessage({ id: "member.detail.from" })}
            </SectionEyebrow>
            <div className="text-callout font-semibold text-foreground">
              {profile.workspaceName}
            </div>
          </div>
          <Separator />
          </div>
        ) : null}

        <div className="flex items-start gap-4 px-5 py-5">
          <AvatarSlot
            context="profile-hero"
            type="app"
            appAvatarUrl={profile.avatarUrl}
            appInitials={profile.displayName}
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="truncate text-headline text-foreground">
              {profile.displayName}
            </div>
            <div className="mt-0.5 truncate text-caption text-foreground-hint">
              {subtitle}
            </div>
            <div className="mt-2 text-callout text-foreground-muted">
              {formatMessage({ id: "message.externalIdentity.externalProjection" })}
            </div>
          </div>
        </div>
      </ProfilePanelBody>
    </>
  );
}
