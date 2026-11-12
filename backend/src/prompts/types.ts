import type { Approval } from "../schemas";

/**
 * Every prompt is a versioned export. To iterate: add `fooV2` next to `fooV1`,
 * flip the pointer in prompts/index.ts, and the version string travels with
 * each response (meta.promptVersion) so regressions are traceable.
 */
export interface PromptDef<Ctx> {
  readonly version: string;
  system(ctx: Ctx): string;
}

export interface BaseCtx {
  language: string;
}

export interface QueueCtx extends BaseCtx {
  approvals: readonly Approval[];
  policy: string;
}

export const queueJson = (approvals: readonly Approval[]): string =>
  JSON.stringify(
    approvals.map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      submittedBy: a.submittedBy,
      status: a.status,
      since: a.statusDate
    })),
    null,
    2
  );

export const LANGUAGE_RULE = (language: string): string =>
  `Write in ${language}. Plain text only - no markdown, no asterisks, no headings.`;
