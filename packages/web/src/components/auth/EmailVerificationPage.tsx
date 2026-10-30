import { useState, useEffect, useEffectEvent, useCallback } from "react";
import { Input, Button } from "@botiverse/raft-ui";
import type { ChangeEvent, FormEvent } from "react";
import { useIntl } from "react-intl";
import { useAuthStore } from "../../store/authStore";
import { RefreshCw, LogOut, KeyRound } from "lucide-react";
import Banner from "../ui/Banner";
import CenteredCardFrame from "./CenteredCardFrame";
import { AuthPageIntro } from "./AuthPageFrame";

interface EmailVerificationPageProps {
  initialToken?: string | null;
}

function reloadPage() {
  window.location.reload();
}

export default function EmailVerificationPage({ initialToken }: EmailVerificationPageProps) {
  const { formatMessage } = useIntl();
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [resendSuccess, setResendSuccess] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualToken, setManualToken] = useState("");

  const handleVerify = useCallback(async (token: string) => {
    setVerifying(true);
    setError("");
    try {
      await verifyEmail(token);
      setVerified(true);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("verify");
      window.history.replaceState({}, "", url.pathname + url.hash);
    } catch (err: any) {
      setError(err.response?.data?.error || formatMessage({ id: "pages.emailVerification.verifyFailed" }));
    } finally {
      setVerifying(false);
    }
  }, [verifyEmail, formatMessage]);

  // Auto-verify if token provided via URL. useEffectEvent: only a NEW
  // initialToken may trigger verification — a locale switch (new formatMessage
  // → new handleVerify identity) must not re-verify an already-consumed token
  // (Josh, task #709).
  const verifyOnLoad = useEffectEvent((token: string) => {
    void handleVerify(token);
  });
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- YMNNE-family: pre-existing non-bug site grandfathered; rule now gates new code (see docs/frontend/render-cost-contract.md)
    if (initialToken) {
      verifyOnLoad(initialToken);
    }
  }, [initialToken]);

  const handleResend = useCallback(async () => {
    setResending(true);
    setError("");
    setResendSuccess(false);
    try {
      await resendVerification();
      setResendSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || formatMessage({ id: "pages.emailVerification.resendFailed" }));
    } finally {
      setResending(false);
    }
  }, [resendVerification, formatMessage]);

  const handleManualSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (manualToken.trim()) {
      void handleVerify(manualToken.trim());
    }
  }, [manualToken, handleVerify]);

  const handleManualTokenChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setManualToken(e.target.value);
  }, []);

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  if (verified) {
    return (
      <CenteredCardFrame>
        <div className="w-full">
          <AuthPageIntro
            title={formatMessage({ id: "pages.emailVerification.verifiedTitle" })}
            description={formatMessage({ id: "pages.emailVerification.verifiedDescription" })}
          />
          <Button
            onClick={reloadPage}
            size="xl"
            variant="accent"
            className="w-full"
          >
            {formatMessage({ id: "pages.emailVerification.continueToRaft" })}
          </Button>
        </div>
      </CenteredCardFrame>
    );
  }

  return (
    <CenteredCardFrame>
      <div className="w-full">
        <AuthPageIntro title={formatMessage({ id: "pages.emailVerification.checkEmailTitle" })}>
          <p className="mt-2 text-callout text-foreground-muted">
            {formatMessage({ id: "pages.emailVerification.sentLinkTo" })}
          </p>
          <p className="mt-1 font-mono text-mono-code font-bold text-foreground">{user?.email}</p>
        </AuthPageIntro>

        {error && (
          <Banner intent="warning" className="mb-4">
            {error}
          </Banner>
        )}

        {resendSuccess && (
          <Banner intent="success" className="mb-4">
            {formatMessage({ id: "pages.emailVerification.resent" })}
          </Banner>
        )}

        {verifying && (
          <div className="mb-4 text-center text-callout text-foreground-muted">
            {formatMessage({ id: "pages.emailVerification.verifying" })}
          </div>
        )}

        <div className="space-y-3">
          <Button
            onClick={handleResend}
            disabled={resending}
            size="xl"
            variant="accent"
            className="w-full"
          >
            <RefreshCw size={16} className={resending ? "animate-spin" : ""} />
            {resending
              ? formatMessage({ id: "pages.emailVerification.sending" })
              : formatMessage({ id: "pages.emailVerification.resendAction" })}
          </Button>

          {/* Manual token entry */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowManualInput(!showManualInput)}
              className="inline-flex items-center gap-1 rounded-control text-footnote font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-focus"
            >
              <KeyRound size={14} className="shrink-0 text-foreground-muted" />
              {showManualInput
                ? formatMessage({ id: "pages.emailVerification.hideManualEntry" })
                : formatMessage({ id: "pages.emailVerification.enterCodeManually" })}
            </button>
          </div>

          {showManualInput && (
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <Input
                type="text"
                className="flex-1"
                value={manualToken}
                onChange={handleManualTokenChange}
                placeholder={formatMessage({ id: "pages.emailVerification.tokenPlaceholder" })}
              />
              <Button size="lg"
                type="submit"
                variant="outline"
                disabled={verifying || !manualToken.trim()}
              >
                {verifying ? "…" : formatMessage({ id: "pages.emailVerification.verifyAction" })}
              </Button>
            </form>
          )}

          <Button
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut size={18} />
            {formatMessage({ id: "pages.emailVerification.logOut" })}
          </Button>
        </div>
      </div>
    </CenteredCardFrame>
  );
}
