/**
 * The label on an attachment's file-type chip: its extension, upper-cased, for
 * the kinds that get a chip; null for the rest. Shared by the message
 * attachment card and the Files panel row so both agree.
 */
const BADGED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "txt", "md", "markdown", "csv", "json", "zip", "html",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "mov",
]);

export function attachmentBadgeLabel(filename: string): string | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return BADGED_EXTENSIONS.has(extension) ? extension.toUpperCase() : null;
}
