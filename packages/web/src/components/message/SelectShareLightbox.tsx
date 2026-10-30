import { Card, Button, DialogHeader } from "@botiverse/raft-ui";
import CloseButton from "../ui/CloseButton";
import { useCallback, useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { useIntl } from "react-intl";
import { Check, Copy, Download, Share2, X } from "lucide-react";
import { downloadDataUrl } from "../../utils/selectScreenshot";
import type { ValidatedScreenshot } from "../../utils/screenshotBudget";
import {
  copyPngDataUrlToClipboard,
  resolvePngClipboardCapability,
} from "../../utils/selectMarkdown";
import Lightbox from "../ui/Lightbox";

export interface SelectShareLightboxProps {
  /** The captured PNG; only a validated capture can be previewed or sent on. */
  image: ValidatedScreenshot;
  /** Suggested filename when the user clicks Download. */
  filename?: string;
  /** Called when the user dismisses the preview (Cancel, X, ESC, backdrop). Selection should be preserved. */
  onClose: () => void;
  /** Called after a successful Download. Selection mode should exit here. Defaults to onClose if omitted. */
  onSaved?: () => void;
  /** Optional platform share target. Runs only after the preview PNG already exists. */
  onShareToX?: (image: ValidatedScreenshot) => Promise<void>;
}

type FileShareNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

function isMobileBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function pngFile(image: ValidatedScreenshot, filename: string): File {
  return new File([image.blob], filename, { type: "image/png" });
}

async function canSavePngViaNativeShare(image: ValidatedScreenshot, filename: string): Promise<boolean> {
  if (!isMobileBrowser()) return false;
  const nav = navigator as FileShareNavigator;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [pngFile(image, filename)] });
  } catch {
    return false;
  }
}

/**
 * Confirmation lightbox shown after the user clicks "Share..." on the
 * select-mode toolbar. The user reviews the rendered screenshot, then chooses
 * an artifact action. Platform-specific share targets intentionally live here,
 * not in the toolbar, so the image is ready before the user sends it anywhere.
 */
const stopClickPropagation = (event: React.MouseEvent) => {
  event.stopPropagation();
};

export default function SelectShareLightbox({
  image,
  filename = "slock-export.png",
  onClose,
  onSaved,
  onShareToX,
}: SelectShareLightboxProps) {
  const { formatMessage } = useIntl();
  const { dataUrl } = image;
  const [sharingToX, setSharingToX] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [canCopyImage, setCanCopyImage] = useState(false);
  const [canNativeSaveImage, setCanNativeSaveImage] = useState(false);
  const [previewSourceWidth, setPreviewSourceWidth] = useState<number | null>(null);

  const handlePreviewImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth } = event.currentTarget;
    if (naturalWidth <= 0) return;

    // The capture records the ratio it rasterized at (lower than the screen's
    // when the selection is long; task #1302). Keep the
    // lightbox from enlarging a narrow message-column export above the CSS
    // width it was captured at; that interpolation is what makes text look
    // soft while the downloaded PNG remains the correct aspect ratio.
    setPreviewSourceWidth(naturalWidth / image.pixelRatio);
  };

  // Async-loader probing native share capability. Reset-on-input + arrival.
  // Adjust-rule fires on the reset-to-false setState line too.
  // oxlint-disable-next-line react-doctor/no-cascading-set-state
  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change
    setCanNativeSaveImage(false);
    void canSavePngViaNativeShare(image, filename).then((canSave) => {
      if (!cancelled) setCanNativeSaveImage(canSave);
    });
    return () => {
      cancelled = true;
    };
  }, [image, filename]);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;
    const syncPermission = () => {
      if (!cancelled && permissionStatus) {
        setCanCopyImage(permissionStatus.state !== "denied");
      }
    };

    void resolvePngClipboardCapability().then((capability) => {
      if (cancelled) return;
      permissionStatus = capability.permissionStatus;
      setCanCopyImage(capability.available);
      permissionStatus?.addEventListener("change", syncPermission);
    });

    return () => {
      cancelled = true;
      permissionStatus?.removeEventListener("change", syncPermission);
    };
  }, []);

  const handleDownload = useCallback(async () => {
    if (sharingToX || savingImage || copyingImage) return;
    if (!canNativeSaveImage) {
      downloadDataUrl(dataUrl, filename);
      (onSaved ?? onClose)();
      return;
    }

    setSavingImage(true);
    try {
      const file = pngFile(image, filename);
      const nav = navigator as FileShareNavigator;
      await nav.share?.({
        files: [file],
        title: formatMessage({ id: "message.selectShare.nativeShareTitle" }),
      });
      (onSaved ?? onClose)();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      downloadDataUrl(dataUrl, filename);
      (onSaved ?? onClose)();
    } finally {
      setSavingImage(false);
    }
  }, [sharingToX, savingImage, copyingImage, canNativeSaveImage, image, dataUrl, filename, onSaved, onClose, formatMessage]);

  const handleCopyImage = useCallback(async () => {
    if (sharingToX || savingImage || copyingImage) return;
    setCopyingImage(true);
    setImageCopied(false);
    setCopyError(null);
    try {
      await copyPngDataUrlToClipboard(dataUrl);
      setImageCopied(true);
    } catch (err) {
      console.error("copyPngDataUrlToClipboard failed:", err);
      const errorName = typeof err === "object" && err !== null && "name" in err
        ? String(err.name)
        : "";
      if (errorName === "NotAllowedError") {
        setCanCopyImage(false);
      } else {
        setCopyError(formatMessage({ id: "message.share.copyImageFailed" }));
      }
    } finally {
      setCopyingImage(false);
    }
  }, [sharingToX, savingImage, copyingImage, dataUrl, formatMessage]);

  const handleShareToX = useCallback(async () => {
    if (!onShareToX || sharingToX || savingImage || copyingImage) return;
    setSharingToX(true);
    try {
      await onShareToX(image);
    } finally {
      setSharingToX(false);
    }
  }, [onShareToX, sharingToX, savingImage, copyingImage, image]);

  return (
    <Lightbox
      onClose={onClose}
      zIndex={100}
      backdropClass="bg-layer-backdrop"
      className="flex items-center justify-center p-4"
      data-testid="select-share-lightbox"
    >
      <Card
        className="flex max-h-[90vh] w-full max-w-3xl flex-col"
        onClick={stopClickPropagation}
      >
        {/* The preview is a dialog with pinned bars: raft-ui's dialog bar head
            (56, a seam under it, on the card's own surface). Its close is the
            dialog close — the small ghost icon button whose glyph ends on the
            head's 20 edge — drawn here because the card is not a raft Dialog. */}
        <DialogHeader bar>
          <h2 className="min-w-0 flex-1 truncate text-headline text-foreground">{formatMessage({ id: "message.selectShare.title" })}</h2>
          <CloseButton
            type="button"
            onClick={onClose}
            aria-label={formatMessage({ id: "common.close" })}
            data-testid="select-share-lightbox-close"
            className="-mr-1.5"
          >
            <X className="size-4.5" />
          </CloseButton>
        </DialogHeader>
        <div className="flex-1 overflow-auto p-4">
          <img
            src={dataUrl}
            alt={formatMessage({ id: "message.selectShare.alt" })}
            className="mx-auto block max-w-full rounded-container border border-line-hairline"
            onLoad={handlePreviewImageLoad}
            style={previewSourceWidth ? { width: `${previewSourceWidth}px` } : undefined}
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-hairline px-4 py-3 sm:px-5">
          {copyError && (
            <p
              role="alert"
              className="mr-auto text-callout font-medium text-danger-strong"
              data-testid="select-share-lightbox-copy-error"
            >
              {copyError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canCopyImage && (
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={handleCopyImage}
                disabled={sharingToX || savingImage || copyingImage}
                loading={copyingImage}
                loadingLabel={formatMessage({ id: "message.selectShare.copying" })}
                data-testid="select-share-lightbox-copy-image"
              >
                {imageCopied ? <Check /> : <Copy />}
                {imageCopied
                  ? formatMessage({ id: "message.selectShare.copied" })
                  : formatMessage({ id: "message.selectShare.copyImage" })}
              </Button>
            )}
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={handleDownload}
              disabled={sharingToX || savingImage || copyingImage}
              loading={savingImage}
              loadingLabel={formatMessage({ id: "message.selectShare.saving" })}
              data-testid="select-share-lightbox-download"
            >
              <Download />
              {canNativeSaveImage
                ? formatMessage({ id: "message.selectShare.saveImage" })
                : formatMessage({ id: "common.lightbox.download" })}
            </Button>
            {onShareToX && (
              <Button
                type="button"
                size="lg"
                variant="accent"
                onClick={handleShareToX}
                disabled={sharingToX || savingImage || copyingImage}
                loading={sharingToX}
                loadingLabel={formatMessage({ id: "message.selectShare.sharing" })}
                data-testid="select-share-lightbox-share-x"
              >
                <Share2 />
                {formatMessage({ id: "message.selectShare.shareToX" })}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </Lightbox>
  );
}
