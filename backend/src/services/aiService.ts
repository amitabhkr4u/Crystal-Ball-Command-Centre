import { activePrompts, SUMMARY_TRIAGE_TOOL, teachStarter } from "../prompts";
import {
  TriageSchema,
  type Approval,
  type ChatMessage,
  type FallbackReason,
  type GreetingRequest,
  type HelpRequest,
  type MetaEvent,
  type SummaryRequest,
  type TalkRequest,
  type TeachRequest,
  type Triage
} from "../schemas";
import type { LlmClient } from "../llm/types";
import { LlmTimeoutError, streamWithIdleTimeout, withTimeout } from "../llm/timeout";
import { retrieve, type PolicyChunk } from "../rag";
import {
  chunkText,
  fallbackGreeting,
  fallbackHelpText,
  fallbackSummaryText,
  fallbackTalkText,
  fallbackTriage,
  NO_POLICY_MATCH_TEXT,
  TEACH_FALLBACK_TEXT,
  timeOfDay
} from "./fallbacks";

export type AiEvent =
  | { type: "meta"; data: MetaEvent }
  | { type: "token"; text: string }
  | { type: "done"; fallback: boolean }
  | { type: "error"; code: string; message: string };

export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOutputError";
  }
}

export interface AiServiceDeps {
  llm: LlmClient | null;
  approvals: Approval[];
  policyText: string;
  policyChunks: PolicyChunk[];
  timeoutMs?: number;
  now?: () => Date;
  logger?: { warn: (...args: unknown[]) => void };
}

export interface AiService {
  summary(req: SummaryRequest): AsyncGenerator<AiEvent>;
  talk(req: TalkRequest): AsyncGenerator<AiEvent>;
  help(req: HelpRequest): AsyncGenerator<AiEvent>;
  teach(req: TeachRequest): AsyncGenerator<AiEvent>;
  greeting(req: GreetingRequest): AsyncGenerator<AiEvent>;
}

/** Throws unless the model's JSON matches the schema AND lists every real approval exactly once. */
export function validateTriage(raw: unknown, approvals: readonly Approval[]): Triage {
  const parsed = TriageSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidOutputError(`Triage failed schema validation: ${parsed.error.message}`);
  const expected = approvals.map((a) => a.id);
  const got = parsed.data.items.map((i) => i.id);
  const unique = new Set(got);
  if (got.length !== expected.length || unique.size !== got.length || !got.every((id) => expected.includes(id))) {
    throw new InvalidOutputError("Triage must list every approval exactly once");
  }
  return parsed.data;
}

function reasonFor(err: unknown): FallbackReason {
  if (err instanceof LlmTimeoutError) return "timeout";
  if (err instanceof InvalidOutputError) return "invalid_output";
  return "llm_error";
}

export function createAiService(deps: AiServiceDeps): AiService {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const now = deps.now ?? (() => new Date());
  const warn = deps.logger?.warn ?? ((...args: unknown[]) => console.warn(...args));
  const queueCtx = (language: string) => ({ approvals: deps.approvals, policy: deps.policyText, language });

  /** Streams a ready-made answer through the same meta -> token -> done path the live model uses. */
  async function* staticStream(text: string, meta: MetaEvent): AsyncGenerator<AiEvent> {
    yield { type: "meta", data: meta };
    for (const piece of chunkText(text)) yield { type: "token", text: piece };
    yield { type: "done", fallback: meta.fallback };
  }

  const fallbackStream = (
    text: string,
    reason: FallbackReason,
    promptVersion: string,
    extraMeta?: Partial<MetaEvent>
  ) => staticStream(text, { ...extraMeta, fallback: true, reason, promptVersion });

  async function* streamOrFallback(o: {
    promptVersion: string;
    system: string;
    messages: ChatMessage[];
    fallbackText: string;
    extraMeta?: Partial<MetaEvent>;
    temperature?: number;
    maxTokens?: number;
  }): AsyncGenerator<AiEvent> {
    const llm = deps.llm;
    if (!llm) {
      yield* fallbackStream(o.fallbackText, "no_api_key", o.promptVersion, o.extraMeta);
      return;
    }
    let started = false;
    try {
      const tokens = streamWithIdleTimeout(timeoutMs, (signal) =>
        llm.stream({
          system: o.system,
          messages: o.messages,
          signal,
          temperature: o.temperature,
          maxTokens: o.maxTokens
        })
      );
      for await (const text of tokens) {
        if (!started) {
          started = true;
          yield { type: "meta", data: { ...o.extraMeta, fallback: false, promptVersion: o.promptVersion } };
        }
        yield { type: "token", text };
      }
      if (!started) throw new InvalidOutputError("Model returned an empty response");
      yield { type: "done", fallback: false };
    } catch (err) {
      warn(`[ai] ${o.promptVersion} failed (${reasonFor(err)}):`, err);
      if (!started) {
        yield* fallbackStream(o.fallbackText, reasonFor(err), o.promptVersion, o.extraMeta);
      } else {
        yield { type: "error", code: "STREAM_INTERRUPTED", message: "The answer was interrupted. You can retry." };
      }
    }
  }

  async function* summary(req: SummaryRequest): AsyncGenerator<AiEvent> {
    const ctx = queueCtx(req.language);
    const triagePrompt = activePrompts.summaryTriage;
    let triage: Triage | null = null;
    let reason: FallbackReason = "no_api_key";

    const llm = deps.llm;
    if (llm) {
      try {
        const raw = await withTimeout(timeoutMs, (signal) =>
          llm.structured({
            system: triagePrompt.system(ctx),
            messages: [{ role: "user", content: triagePrompt.user(ctx) }],
            tool: SUMMARY_TRIAGE_TOOL,
            signal
          })
        );
        triage = validateTriage(raw, deps.approvals);
      } catch (err) {
        reason = reasonFor(err);
        warn(`[ai] ${triagePrompt.version} failed (${reason}):`, err);
      }
    }

    if (!triage) {
      const fb = fallbackTriage(deps.approvals);
      yield* fallbackStream(fallbackSummaryText(fb, deps.approvals), reason, triagePrompt.version, { triage: fb });
      return;
    }

    const narration = activePrompts.summaryNarration;
    const narrationCtx = { ...ctx, triage };
    yield* streamOrFallback({
      promptVersion: narration.version,
      system: narration.system(narrationCtx),
      messages: [{ role: "user", content: narration.user(narrationCtx) }],
      fallbackText: fallbackSummaryText(triage, deps.approvals),
      extraMeta: { triage },
      maxTokens: 300
    });
  }

  async function* talk(req: TalkRequest): AsyncGenerator<AiEvent> {
    const prompt = activePrompts.talk;
    const ctx = queueCtx(req.language);
    yield* streamOrFallback({
      promptVersion: prompt.version,
      system: prompt.system(ctx),
      messages: req.messages,
      fallbackText: fallbackTalkText(fallbackTriage(deps.approvals), deps.approvals)
    });
  }

  async function* help(req: HelpRequest): AsyncGenerator<AiEvent> {
    const prompt = activePrompts.help;
    const hits = retrieve(deps.policyChunks, req.question);
    if (hits.length === 0) {
      yield* staticStream(NO_POLICY_MATCH_TEXT, {
        fallback: false,
        reason: "no_policy_match",
        promptVersion: prompt.version,
        sources: []
      });
      return;
    }
    const chunks = hits.map((h) => h.chunk);
    const ctx = { language: req.language, question: req.question, chunks };
    yield* streamOrFallback({
      promptVersion: prompt.version,
      system: prompt.system(ctx),
      messages: [{ role: "user", content: prompt.user(ctx) }],
      fallbackText: fallbackHelpText(chunks[0]),
      extraMeta: { sources: chunks.map((c) => ({ id: c.id, title: c.title })) }
    });
  }

  async function* teach(req: TeachRequest): AsyncGenerator<AiEvent> {
    const prompt = activePrompts.teach;
    const approval = deps.approvals.find((a) => a.id === req.approvalId);
    const starter: ChatMessage = { role: "user", content: teachStarter(approval) };
    const messages =
      req.messages.length === 0
        ? [starter]
        : req.messages[0].role === "assistant"
          ? [starter, ...req.messages]
          : req.messages;
    yield* streamOrFallback({
      promptVersion: prompt.version,
      system: prompt.system(queueCtx(req.language)),
      messages,
      fallbackText: TEACH_FALLBACK_TEXT
    });
  }

  async function* greeting(req: GreetingRequest): AsyncGenerator<AiEvent> {
    const prompt = activePrompts.greeting;
    const date = now();
    const ctx = {
      language: req.language,
      count: deps.approvals.length,
      titles: deps.approvals.map((a) => a.title),
      timeOfDay: timeOfDay(date),
      nonce: Math.random().toString(36).slice(2, 8)
    };
    yield* streamOrFallback({
      promptVersion: prompt.version,
      system: prompt.system(ctx),
      messages: [{ role: "user", content: prompt.user() }],
      fallbackText: fallbackGreeting(deps.approvals, date),
      temperature: 1,
      maxTokens: 120
    });
  }

  return { summary, talk, help, teach, greeting };
}
