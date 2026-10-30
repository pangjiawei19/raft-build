import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildCindySeedFiles,
  buildOnboardingKnowledgeFaqMd,
  buildOnboardingPlaybookMd,
} from "./cindyOnboardingContent";

// Agents call provider-run agents "cloud agents". The provider name stays only
// as the API value `hosting: "antiproton"`; prose must not name it, and must not
// fall back to "hosted agent".
const REPO_ROOT = join(__dirname, "../../..");
const KNOWLEDGE_DIR = join(REPO_ROOT, "manual/agent-knowledge");
// External agents run their own runtime; that article is about a different subject.
const EXEMPT_ARTICLES = new Set(["external-agent.md"]);

const API_VALUE = /(["'`])antiproton\1|\\"antiproton\\"|`computer` \| `antiproton`/gi;
// Refusals, errors and next-step hints agents receive. Only string literals are
// scanned, so comments and identifiers never match.
const AGENT_FACING_SOURCES = [
  "packages/shared/src/actionCards.ts",
  "packages/server/src/services/actionCardsService.ts",
  "packages/server/src/routes/internalAgentApi.ts",
  "packages/server/src/raftbench/service.ts",
];

function stringLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(REPO_ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found.push(JSON.stringify(node.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function offenders(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(API_VALUE, ""))
    .filter((line) => /antiproton|hosted agent|raft-hosted agent|hosted by raft/i.test(line));
}

describe("agent-facing cloud agent wording", () => {
  it("knowledge articles use cloud agent wording", () => {
    const found: string[] = [];
    for (const file of readdirSync(KNOWLEDGE_DIR, { recursive: true }) as string[]) {
      if (!file.endsWith(".md") || EXEMPT_ARTICLES.has(file)) continue;
      for (const line of offenders(readFileSync(join(KNOWLEDGE_DIR, file), "utf8"))) found.push(`${file}: ${line}`);
    }
    expect(found).toEqual([]);
  });

  it("Cindy briefing uses cloud agent wording", () => {
    const texts = [
      buildOnboardingPlaybookMd(),
      buildOnboardingKnowledgeFaqMd(),
      ...buildCindySeedFiles().map((f) => f.content),
      ...buildCindySeedFiles({ hosted: true }).map((f) => f.content),
    ];
    expect(texts.flatMap(offenders)).toEqual([]);
  });

  it("agent API descriptions use cloud agent wording", () => {
    const spec = readFileSync(join(REPO_ROOT, "packages/shared/agent-api/agent-api.v1.json"), "utf8");
    const descriptions = [...spec.matchAll(/"description": "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    expect(descriptions.flatMap(offenders)).toEqual([]);
  });

  it("agent-facing refusals use cloud agent wording", () => {
    expect(AGENT_FACING_SOURCES.flatMap((file) => offenders(stringLiterals(file).join("\n")).map((line) => `${file}: ${line}`))).toEqual([]);
  });
});
