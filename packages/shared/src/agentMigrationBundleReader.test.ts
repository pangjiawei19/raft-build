import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { test } from "vitest";
import {
  AgentMigrationChunkDigestMismatchError,
  readAgentMigrationBundle,
  readVerifiedAgentMigrationChunks,
} from "./agentMigrationBundleReader";
import type { AgentMigrationControlManifest } from "./agentMigrationResumable";

type Entry = { name: string; content?: string; type?: "file" | "symlink"; linkname?: string };

async function bundle(entries: Entry[]): Promise<Buffer> {
  const tar = pack();
  const parts: Buffer[] = [];
  tar.on("data", (chunk: Buffer) => parts.push(chunk));
  const done = new Promise<void>((resolve) => tar.on("end", () => resolve()));
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      if (entry.type === "symlink") {
        tar.entry({ name: entry.name, type: "symlink", linkname: entry.linkname }, (error) => error ? reject(error) : resolve());
      } else {
        tar.entry({ name: entry.name, mode: 0o644 }, Buffer.from(entry.content ?? ""), (error) => error ? reject(error) : resolve());
      }
    });
  }
  tar.finalize();
  await done;
  return gzipSync(Buffer.concat(parts));
}

function controlFor(bytes: Buffer, entries: Entry[]): AgentMigrationControlManifest {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expanded = entries.reduce((n, e) => n + Buffer.byteLength(e.content ?? ""), 0);
  return {
    bundle: { totalBytes: bytes.byteLength, sha256, chunks: [{ index: 0, offsetBytes: 0, sizeBytes: bytes.byteLength, sha256 }] },
    archive: { entryCount: entries.length, expandedBytes: expanded, maxEntryBytes: 1024 },
  } as unknown as AgentMigrationControlManifest;
}

async function* once(bytes: Buffer): AsyncGenerator<Buffer> {
  yield bytes;
}

test("entries come in archive order; bytes a caller leaves unread are drained", async () => {
  const entries: Entry[] = [
    { name: "workspace/MEMORY.md", content: "memory" },
    { name: "workspace/notes/a.md", content: "skipped by the caller" },
    { name: "workspace/link", type: "symlink", linkname: "notes/a.md" },
  ];
  const bytes = await bundle(entries);
  const control = controlFor(bytes, entries);
  const seen: string[] = [];
  let memory = "";
  const result = await readAgentMigrationBundle({
    control,
    chunks: readVerifiedAgentMigrationChunks(control, () => once(bytes)),
    onEntry: async (entry) => {
      seen.push(`${entry.type}:${entry.relativePath}`);
      if (entry.type === "file" && entry.relativePath === "MEMORY.md") {
        for await (const chunk of entry.stream) memory += String(chunk);
      }
    },
  });
  assert.deepEqual(seen, ["file:MEMORY.md", "file:notes/a.md", "symlink:link"]);
  assert.equal(memory, "memory");
  assert.deepEqual(result, { entries: 3, bytes: 27 });
});

test("a chunk longer than the manifest says is refused as soon as it overflows", async () => {
  const entries: Entry[] = [{ name: "workspace/MEMORY.md", content: "memory" }];
  const bytes = await bundle(entries);
  const control = controlFor(bytes, entries);
  await assert.rejects(
    readAgentMigrationBundle({
      control,
      chunks: readVerifiedAgentMigrationChunks(control, () => once(Buffer.concat([bytes, Buffer.from("extra")]))),
      onEntry: async () => {},
    }),
    AgentMigrationChunkDigestMismatchError,
  );
});

test("a path escape or an entry under a symlink is refused", async () => {
  for (const [entries, code] of [
    [[{ name: "workspace/../escape", content: "x" }], "MIGRATION_OBJECT_STORE_UNSAFE_PATH"],
    [[{ name: "workspace/link", type: "symlink", linkname: "notes" }, { name: "workspace/link/x", content: "x" }], "MIGRATION_ARCHIVE_SYMLINK_ANCESTOR"],
    [[{ name: "workspace/out", type: "symlink", linkname: "../../etc/passwd" }], "MIGRATION_OBJECT_STORE_UNSAFE_LINK"],
  ] as Array<[Entry[], string]>) {
    const bytes = await bundle(entries);
    const control = controlFor(bytes, entries);
    await assert.rejects(
      readAgentMigrationBundle({ control, chunks: once(bytes), onEntry: async () => {} }),
      new RegExp(code),
    );
  }
});
