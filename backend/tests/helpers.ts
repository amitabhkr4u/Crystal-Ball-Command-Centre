import { loadApprovals, loadPolicy } from "../src/data";
import { chunkPolicy } from "../src/rag";
import { createAiService, type AiEvent, type AiService } from "../src/services/aiService";
import type { LlmClient } from "../src/llm/types";

export const silentLogger = { warn: () => undefined };

export function validTriage() {
  return {
    headline: "Four approvals are waiting; start with the safety specs.",
    items: [
      { id: "APR-003", priority: "high", reason: "Safety and sensor specs gate field use." },
      { id: "APR-001", priority: "high", reason: "Onboarding checklists unblock new operators." },
      { id: "APR-002", priority: "medium", reason: "Demo video is useful but not blocking." },
      { id: "APR-004", priority: "low", reason: "Reference map, review last." }
    ]
  };
}

type Mocked = LlmClient & { structured: jest.Mock; stream: jest.Mock };

export function makeLlm(over: Partial<Record<"structured" | "stream", jest.Mock>> = {}): Mocked {
  return {
    structured: jest.fn(async () => validTriage()),
    stream: jest.fn(() =>
      (async function* () {
        yield "Start with ";
        yield "the safety PDF.";
      })()
    ),
    ...over
  } as unknown as Mocked;
}

export function makeService(llm: LlmClient | null, timeoutMs = 1000, now?: () => Date): AiService {
  const policyText = loadPolicy();
  return createAiService({
    llm,
    approvals: loadApprovals(),
    policyText,
    policyChunks: chunkPolicy(policyText),
    timeoutMs,
    now,
    logger: silentLogger
  });
}

export async function collect(events: AsyncIterable<AiEvent>): Promise<AiEvent[]> {
  const out: AiEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

export const never = <T>() => new Promise<T>(() => undefined);

export function tokensOf(events: AiEvent[]): string {
  return events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");
}

export function metaOf(events: AiEvent[]) {
  const meta = events.find((e) => e.type === "meta");
  if (!meta || meta.type !== "meta") throw new Error("no meta event");
  return meta.data;
}
