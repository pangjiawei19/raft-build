// A runtime whose form OAR now owns (`@botiverse/oar/forms`,
// docs/spec/config-form.md in botiverse/oar): its fields, modes and copy come
// from OAR, and this projection turns them into the options of the existing v2
// builder. The projection must leave the served form byte-identical
// (packages/runtime-form/fixtures/<runtime>.form.json), so it supports exactly
// the shapes a migrated runtime has today and refuses anything else at load,
// rather than serving a form it cannot represent.
import type { RuntimeConfigForm } from "@botiverse/oar/forms";
import type { ReasoningModelFormOptions } from "./runtimeFormV2Registry";

function refuse(form: RuntimeConfigForm, detail: string): never {
  throw new Error(`OAR config form for ${form.runtime} has no Raft v2 projection: ${detail}`);
}

/** What Raft offers of an OAR model field: a subset of its modes, optionally required, and Raft's own hint. */
export interface RaftModelNarrowing {
  readonly modes: readonly ("inherit" | "preset" | "custom")[];
  readonly required: boolean;
  readonly hint?: string;
}

/**
 * Host narrowing (docs/spec/config-form.md, "Host narrowing"): an OAR form
 * states what the runtime accepts; Raft offers less. Narrowing only removes:
 * the offered modes must be a subset of OAR's, a field may become required but
 * never optional, and the OAR modes become the field's `launchModes`, so a
 * stored value Raft no longer offers is still preserved on edit and launches.
 * The hint is copy, which is the host's.
 */
export function narrowOarForm(form: RuntimeConfigForm, model: RaftModelNarrowing): RuntimeConfigForm {
  return {
    ...form,
    fields: form.fields.map((field) => {
      if (field.kind !== "model") return field;
      const accepted = field.launchModes ?? field.modes;
      const widened = model.modes.filter((mode) => !field.modes.includes(mode));
      if (widened.length > 0) refuse(form, `narrowing offers ${widened.join(", ")}, which OAR's form does not`);
      if (field.required && !model.required) refuse(form, "narrowing makes a required model field optional");
      if (model.hint !== undefined && field.hint === undefined) refuse(form, "narrowing replaces a hint OAR's form does not have");
      return {
        ...field,
        modes: [...model.modes],
        launchModes: [...accepted],
        required: model.required,
        ...(model.hint === undefined || field.hint === undefined ? {} : { hint: { ...field.hint, en: model.hint } }),
      };
    }),
  };
}

export function reasoningModelOptionsFromOar(form: RuntimeConfigForm): ReasoningModelFormOptions {
  for (const field of form.fields) {
    if (field.kind !== "model" && field.kind !== "effort") refuse(form, `field ${field.id} (${field.kind})`);
  }
  const model = form.fields.find((field) => field.kind === "model");
  if (!model || model.kind !== "model" || model.id !== "model" || !model.required) refuse(form, "a required `model` field");
  if (!model.modes.includes("preset")) refuse(form, "a model field without the preset mode");
  // The v2 reasoning-model form has no "runtime default" choice yet.
  if (model.modes.includes("inherit")) refuse(form, "the inherit model mode");
  const effort = form.fields.find((field) => field.kind === "effort");
  if (effort && (effort.kind !== "effort" || effort.id !== "reasoningEffort" || effort.modelField !== "model")) {
    refuse(form, "an effort field other than `reasoningEffort` following `model`");
  }
  return {
    customModel: model.modes.includes("custom"),
    fastMode: false,
    reasoning: effort !== undefined,
    modelHint: model.hint?.en ?? "",
  };
}
