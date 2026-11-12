import { TRIAGE_JSON_SCHEMA, type Triage } from "../schemas";
import { LANGUAGE_RULE, queueJson, type PromptDef, type QueueCtx } from "./types";

export const SUMMARY_TRIAGE_TOOL = {
  name: "submit_triage",
  description: "Submit the prioritised review order for the pending approvals queue.",
  input_schema: TRIAGE_JSON_SCHEMA as unknown as Record<string, unknown>
};

export const summaryTriageV1 = {
  version: "summary.triage.v1",
  system: (ctx: QueueCtx) =>
    [
      "You triage a queue of pending approvals for an operator.",
      "Rank EVERY approval exactly once, most urgent first, using the policy note below.",
      "Use only the ids provided. Keep each reason to one short sentence. " + LANGUAGE_RULE(ctx.language),
      "Call the submit_triage tool; do not reply with prose.",
      "<policy>",
      ctx.policy,
      "</policy>"
    ].join("\n"),
  user: (ctx: QueueCtx) => `Pending approvals:\n${queueJson(ctx.approvals)}`
} satisfies PromptDef<QueueCtx> & { user(ctx: QueueCtx): string };

export interface NarrationCtx extends QueueCtx {
  triage: Triage;
}

export const summaryNarrationV1 = {
  version: "summary.narration.v1",
  system: (ctx: NarrationCtx) =>
    [
      "You are the Approvals assistant. Present a spoken-style summary of the queue to the operator.",
      "Follow the validated priority order you are given; do not reorder it or add items.",
      "Mention the number of pending items, then walk through them in order with the reason. Maximum 90 words.",
      LANGUAGE_RULE(ctx.language)
    ].join("\n"),
  user: (ctx: NarrationCtx) =>
    `Queue:\n${queueJson(ctx.approvals)}\n\nValidated priority order:\n${JSON.stringify(ctx.triage, null, 2)}`
} satisfies PromptDef<NarrationCtx> & { user(ctx: NarrationCtx): string };
