// read_mutations is large (prod 10-16: 22.9M rows, 30 GB heap). Every
// migration that (re)adds read_mutations_scope_shape must add it NOT VALID: a
// validating ADD CONSTRAINT scans the whole table inside the deploy
// transaction while holding the ALTER's ACCESS EXCLUSIVE lock (0358 shipped to
// staging that way; caught before production).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRIZZLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

test("every migration that adds read_mutations_scope_shape adds it NOT VALID", () => {
  const adds: string[] = [];
  for (const file of readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    const statements = readFileSync(path.join(DRIZZLE_DIR, file), "utf8").split("--> statement-breakpoint");
    for (const statement of statements) {
      if (!/ADD CONSTRAINT\s+"read_mutations_scope_shape"/i.test(statement)) continue;
      adds.push(file);
      assert.match(statement, /\)\s*NOT VALID\s*;/i, `${file} re-adds read_mutations_scope_shape without NOT VALID`);
    }
  }
  assert.ok(adds.includes("0216_b2_composite_done.sql") && adds.includes("0358_conversation_read_all.sql"), `found: ${adds.join(", ")}`);
});
