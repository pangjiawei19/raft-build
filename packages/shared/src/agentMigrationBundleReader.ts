/**
 * Reading an agent migration bundle: the one implementation both the target
 * daemon (unpacking into a Computer workspace) and the server's hosted
 * importer (picking files for a hosted import) use, so a bundle is checked
 * the same way whoever reads it.
 *
 * Node-only. Not re-exported from the package root, which stays browser-safe;
 * import it from `@botiverse/raft-shared/src/agentMigrationBundleReader`.
 *
 * The reader verifies every chunk's size and sha256, the whole bundle's size
 * and sha256, and the archive against the control manifest's bounds, and
 * refuses unsafe entries (path escapes, duplicates, entries under a symlink,
 * symlinks that leave the workspace, unsupported types, oversize entries,
 * the commit marker path). What to do with an accepted entry is the caller's.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import { AGENT_MIGRATION_COMMIT_MARKER_PATH, type AgentMigrationControlChunk, type AgentMigrationControlManifest } from "./agentMigrationResumable";

const ARCHIVE_WORKSPACE_PREFIX = "workspace/";
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:/;

export class AgentMigrationChunkDigestMismatchError extends Error {
  readonly code = "MIGRATION_CHUNK_DIGEST_MISMATCH";

  constructor(readonly chunkIndex: number) {
    super(`MIGRATION_CHUNK_DIGEST_MISMATCH:${chunkIndex}`);
    this.name = "AgentMigrationChunkDigestMismatchError";
  }
}

export class AgentMigrationWholeBundleDigestMismatchError extends Error {
  readonly code = "MIGRATION_WHOLE_BUNDLE_DIGEST_MISMATCH";

  constructor() {
    super("MIGRATION_WHOLE_BUNDLE_DIGEST_MISMATCH");
    this.name = "AgentMigrationWholeBundleDigestMismatchError";
  }
}

export function isPortableAbsolutePath(value: string): boolean {
  return path.posix.isAbsolute(value.replaceAll("\\", "/")) || path.win32.isAbsolute(value);
}

/**
 * A symlink target that stays inside the workspace, normalized to POSIX form.
 * Throws `MIGRATION_OBJECT_STORE_UNSAFE_LINK` for absolute, drive, NUL or
 * escaping targets. Used when packing (source) and unpacking (target).
 */
export function normalizeAgentMigrationSymlinkTarget(
  workspaceRelativePath: string,
  linkTarget: string,
): string {
  const portableTarget = linkTarget.replaceAll("\\", "/");
  if (
    !linkTarget
    || linkTarget.includes("\0")
    || isPortableAbsolutePath(linkTarget)
    || WINDOWS_DRIVE_PATH_PATTERN.test(linkTarget)
  ) {
    throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_LINK");
  }

  const normalizedTarget = path.posix.normalize(portableTarget);
  const normalizedLinkPath = normalizeLinkPath(workspaceRelativePath);
  const resolvedTarget = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalizedLinkPath), normalizedTarget),
  );
  if (
    !normalizedTarget
    || normalizedTarget === "."
    || resolvedTarget === ".."
    || resolvedTarget.startsWith("../")
    || isPortableAbsolutePath(resolvedTarget)
    || WINDOWS_DRIVE_PATH_PATTERN.test(normalizedTarget)
  ) {
    throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_LINK");
  }
  return normalizedTarget;
}

function normalizeLinkPath(value: string): string {
  const portable = value.replaceAll("\\", "/");
  if (value.includes("\0") || isPortableAbsolutePath(value) || WINDOWS_DRIVE_PATH_PATTERN.test(value)) {
    throw new Error(`unsafe migration export path: ${value}`);
  }
  const normalized = path.posix.normalize(portable);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`unsafe migration export path: ${value}`);
  }
  return normalized;
}

/** An archive entry path relative to the workspace, or `MIGRATION_OBJECT_STORE_UNSAFE_PATH`. */
export function normalizeAgentMigrationArchiveRelativePath(value: string): string {
  if (value.includes("\\")) throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_PATH");
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_PATH");
  }
  const normalized = path.posix.normalize(value);
  if (
    !normalized
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.isAbsolute(normalized)
    || /^[a-zA-Z]:/.test(normalized)
    || normalized.includes("\0")
  ) {
    throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_PATH");
  }
  return normalized;
}

/**
 * The bundle's bytes in chunk order, each chunk checked against the manifest
 * once it has been read whole. `openChunk` returns one chunk's bytes (a file
 * on the daemon, a download on the server).
 */
export async function* readVerifiedAgentMigrationChunks(
  control: AgentMigrationControlManifest,
  openChunk: (chunk: AgentMigrationControlChunk) => AsyncIterable<Uint8Array>,
): AsyncGenerator<Buffer> {
  for (const expected of control.bundle.chunks) {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const value of openChunk(expected)) {
      const chunk = Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > expected.sizeBytes) throw new AgentMigrationChunkDigestMismatchError(expected.index);
      hash.update(chunk);
      yield chunk;
    }
    if (bytes !== expected.sizeBytes || hash.digest("hex") !== expected.sha256) {
      throw new AgentMigrationChunkDigestMismatchError(expected.index);
    }
  }
}

export type AgentMigrationBundleEntry =
  | {
    type: "file";
    /** Workspace-relative POSIX path, already checked. */
    relativePath: string;
    sizeBytes: number;
    /** Permission bits from the archive (`& 0o777`), 0o600 when absent. */
    mode: number;
    /** The file's bytes. The reader drains whatever the caller leaves unread. */
    stream: Readable;
  }
  | {
    type: "symlink";
    relativePath: string;
    /** Normalized and checked to stay inside the workspace. */
    linkTarget: string;
  };

export interface ReadAgentMigrationBundleInput {
  control: AgentMigrationControlManifest;
  /** The bundle's bytes in order, e.g. from `readVerifiedAgentMigrationChunks`. */
  chunks: AsyncIterable<Uint8Array>;
  /** Called once per accepted entry, in archive order; the next entry waits for it. */
  onEntry: (entry: AgentMigrationBundleEntry) => Promise<void>;
}

/**
 * Stream a bundle through gunzip and tar, checking every entry. Rejects on the
 * first problem; on success the whole bundle digest and the manifest's entry
 * count and expanded bytes have matched exactly.
 */
export async function readAgentMigrationBundle(input: ReadAgentMigrationBundleInput): Promise<{ entries: number; bytes: number }> {
  const { control } = input;
  const wholeHash = createHash("sha256");
  let bundleBytes = 0;
  const hashingBundle = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bundleBytes += chunk.byteLength;
      if (bundleBytes > control.bundle.totalBytes) {
        callback(new AgentMigrationWholeBundleDigestMismatchError());
        return;
      }
      wholeHash.update(chunk);
      callback(null, chunk);
    },
  });
  const tarExtract = extract();
  const seen = new Set<string>();
  const symlinkPaths = new Set<string>();
  let entries = 0;
  let bytes = 0;
  const addEntry = (sizeBytes: number) => {
    entries += 1;
    bytes += sizeBytes;
    if (entries > control.archive.entryCount || bytes > control.archive.expandedBytes) {
      throw new Error("MIGRATION_ARCHIVE_LIMIT_EXCEEDED");
    }
  };
  tarExtract.on("entry", (header, stream, next) => {
    void (async () => {
      if (!header.name.startsWith(ARCHIVE_WORKSPACE_PREFIX)) throw new Error("MIGRATION_ARCHIVE_ENTRY_UNEXPECTED");
      const relativePath = normalizeAgentMigrationArchiveRelativePath(header.name.slice(ARCHIVE_WORKSPACE_PREFIX.length));
      if (relativePath === AGENT_MIGRATION_COMMIT_MARKER_PATH) throw new Error("MIGRATION_OBJECT_STORE_RESERVED_PATH");
      if (seen.has(relativePath)) throw new Error("MIGRATION_ARCHIVE_ENTRY_DUPLICATE");
      // Check each ancestor rather than each symlink: linear in path depth, not
      // in the number of symlinks seen so far.
      for (let slash = relativePath.indexOf("/"); slash !== -1; slash = relativePath.indexOf("/", slash + 1)) {
        if (symlinkPaths.has(relativePath.slice(0, slash))) throw new Error("MIGRATION_ARCHIVE_SYMLINK_ANCESTOR");
      }
      seen.add(relativePath);
      if (header.type === "symlink") {
        const linkTarget = safeSymlinkTarget(relativePath, header.linkname);
        await drain(stream);
        addEntry(0);
        await input.onEntry({ type: "symlink", relativePath, linkTarget });
        symlinkPaths.add(relativePath);
        return;
      }
      if (header.type !== "file") throw new Error("MIGRATION_ARCHIVE_ENTRY_TYPE_UNSUPPORTED");
      const sizeBytes = header.size;
      if (
        typeof sizeBytes !== "number"
        || !Number.isSafeInteger(sizeBytes)
        || sizeBytes < 0
        || sizeBytes > control.archive.maxEntryBytes
      ) {
        throw new Error("MIGRATION_ARCHIVE_ENTRY_SIZE_INVALID");
      }
      addEntry(sizeBytes);
      const mode = typeof header.mode === "number" ? header.mode & 0o777 : 0o600;
      await input.onEntry({ type: "file", relativePath, sizeBytes, mode, stream: stream as Readable });
      await drain(stream);
    })().then(() => next(), next);
  });
  await pipeline(Readable.from(input.chunks), hashingBundle, createGunzip(), tarExtract);
  if (bundleBytes !== control.bundle.totalBytes || wholeHash.digest("hex") !== control.bundle.sha256) {
    throw new AgentMigrationWholeBundleDigestMismatchError();
  }
  if (entries !== control.archive.entryCount || bytes !== control.archive.expandedBytes) {
    throw new Error("MIGRATION_ARCHIVE_COMMIT_CONDITION_MISMATCH");
  }
  return { entries, bytes };
}

function safeSymlinkTarget(relativePath: string, linkTarget: string | null | undefined): string {
  if (linkTarget === undefined || linkTarget === null) throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_LINK");
  const normalized = normalizeAgentMigrationSymlinkTarget(relativePath, linkTarget);
  if (normalized !== linkTarget) throw new Error("MIGRATION_OBJECT_STORE_UNSAFE_LINK");
  return normalized;
}

async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const _chunk of stream as AsyncIterable<Uint8Array>) {
    // Tar entries are sequential; an entry's unread bytes must still be read.
  }
}
