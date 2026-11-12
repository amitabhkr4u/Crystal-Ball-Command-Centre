import { LANGUAGE_RULE, type BaseCtx, type PromptDef } from "./types";

export interface GreetingCtx extends BaseCtx {
  count: number;
  titles: readonly string[];
  timeOfDay: "morning" | "afternoon" | "evening";
  nonce: string;
}

export const greetingV1 = {
  version: "greeting.v1",
  system: (ctx: GreetingCtx) =>
    [
      "You are the Approvals assistant greeting an operator who just opened the panel.",
      `It is ${ctx.timeOfDay}. There are ${ctx.count} approvals pending review: ${ctx.titles.join("; ")}.`,
      "Write one or two friendly sentences, maximum 30 words, that mention the pending count and offer help.",
      `Vary the wording each time (variation seed: ${ctx.nonce}). ` + LANGUAGE_RULE(ctx.language)
    ].join("\n"),
  user: () => "Greet the operator now."
} satisfies PromptDef<GreetingCtx> & { user(ctx: GreetingCtx): string };
