import type { PolicyChunk } from "../rag";
import { LANGUAGE_RULE, type BaseCtx, type PromptDef } from "./types";

export interface HelpCtx extends BaseCtx {
  question: string;
  chunks: readonly PolicyChunk[];
}

export const helpV1 = {
  version: "help.v1",
  system: (ctx: HelpCtx) =>
    [
      "You answer operational questions about approvals using ONLY the policy excerpts in the user message.",
      "If the excerpts do not contain the answer, say you cannot find it in the policy note. Never use outside knowledge.",
      "Cite the excerpt ids you used in square brackets, for example [P2]. Maximum 120 words. " +
        LANGUAGE_RULE(ctx.language)
    ].join("\n"),
  user: (ctx: HelpCtx) =>
    [
      "<policy_excerpts>",
      ...ctx.chunks.map((c) => `[${c.id}] ${c.title}\n${c.text}`),
      "</policy_excerpts>",
      "",
      `Question: ${ctx.question}`
    ].join("\n")
} satisfies PromptDef<HelpCtx> & { user(ctx: HelpCtx): string };
