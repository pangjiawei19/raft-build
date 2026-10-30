import {
  buildCindyMemoryMd as cindyMemoryMd,
  buildOnboardingKnowledgeFaqMd as onboardingKnowledgeFaqMd,
  buildOnboardingObjectivesMd as onboardingObjectivesMd,
  buildOnboardingPlaybookMd as onboardingPlaybookMd,
} from "@botiverse/raft-shared";
import { axSurface } from "./agentRuntimeInput";

// The text lives in shared (cindyOnboardingContent.ts) so the server can seed a
// hosted Cindy from the same source; these wrappers keep the AX surfaces.

export const buildOnboardingPlaybookMd = axSurface(
  "Cindy onboarding playbook, written to notes/onboarding_playbook.md on first startup.",
  (): string => onboardingPlaybookMd(),
  { examples: [{ title: "Initial seed", args: [] }] },
);

export const buildOnboardingKnowledgeFaqMd = axSurface(
  "Cindy onboarding FAQ, written to notes/onboarding_knowledge_faq.md on first startup.",
  (): string => onboardingKnowledgeFaqMd(),
  { examples: [{ title: "Initial seed", args: [] }] },
);

export const buildOnboardingObjectivesMd = axSurface(
  "Cindy initial objectives and recap protocol, written to notes/onboarding_objectives.md on first startup.",
  (): string => onboardingObjectivesMd(),
  { examples: [{ title: "Initial seed", args: [] }] },
);

export const buildCindyMemoryMd = axSurface(
  "Cindy initial memory and knowledge index, written to MEMORY.md on first startup.",
  (agentName: string): string => cindyMemoryMd(agentName),
  { examples: [{ title: "Initial memory", args: ["Cindy"] }] },
);

/** The seed files a computer-hosted Cindy gets on first start; a hosted Cindy imports the same set. */
export { buildCindySeedFiles } from "@botiverse/raft-shared";
