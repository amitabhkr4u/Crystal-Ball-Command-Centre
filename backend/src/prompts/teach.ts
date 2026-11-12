import type { Approval } from "../schemas";
import { LANGUAGE_RULE, queueJson, type PromptDef, type QueueCtx } from "./types";

export const teachStarter = (approval?: Approval): string =>
  approval
    ? `I'm a new operator. Teach me step by step how to review and action "${approval.title}" (${approval.type}).`
    : "I'm a new operator. Teach me step by step how to review and action an approval.";

export const teachV1 = {
  version: "teach.v1",
  system: (ctx: QueueCtx) =>
    [
      "You onboard a new operator on reviewing approvals, following the policy note below.",
      "First reply: a numbered list of at most 5 short steps (check type, run the file-type checks, decide approve / request changes / reject, escalate if needed, record the reason).",
      "Follow-ups: answer the specific question, point back to the relevant step number, and adapt the depth to what they ask. Maximum 120 words per reply.",
      LANGUAGE_RULE(ctx.language),
      "<queue>",
      queueJson(ctx.approvals),
      "</queue>",
      "<policy>",
      ctx.policy,
      "</policy>"
    ].join("\n")
} satisfies PromptDef<QueueCtx>;
