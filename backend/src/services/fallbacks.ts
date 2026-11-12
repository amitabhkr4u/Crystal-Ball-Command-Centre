import type { Approval, Triage } from "../schemas";
import type { PolicyChunk } from "../rag";

/** Non-AI behaviour for every action. Ranking mirrors the "Review order" section of data/policy.md. */
const TYPE_RULES: Record<Approval["type"], { rank: number; priority: "high" | "medium" | "low"; reason: string }> = {
  PDF: { rank: 1, priority: "high", reason: "Safety and sensor documents gate field use, so they are reviewed first." },
  Folder: { rank: 2, priority: "high", reason: "Onboarding and checklist material unblocks new operators." },
  Video: { rank: 3, priority: "medium", reason: "Demonstration videos are reviewed after procedures and specs." },
  Image: { rank: 4, priority: "low", reason: "Reference maps are reviewed last unless they change a safety zone." }
};

export function fallbackTriage(approvals: readonly Approval[]): Triage {
  const ordered = [...approvals].sort(
    (a, b) => TYPE_RULES[a.type].rank - TYPE_RULES[b.type].rank || a.id.localeCompare(b.id)
  );
  return {
    headline: `${approvals.length} approvals are pending review.`,
    items: ordered.map((a) => ({ id: a.id, priority: TYPE_RULES[a.type].priority, reason: TYPE_RULES[a.type].reason }))
  };
}

function titleOf(approvals: readonly Approval[], id: string): string {
  return approvals.find((a) => a.id === id)?.title ?? id;
}

export function fallbackSummaryText(triage: Triage, approvals: readonly Approval[]): string {
  const lines = triage.items.map((i, n) => `${n + 1}. ${titleOf(approvals, i.id)} (${i.priority}) - ${i.reason}`);
  return `${triage.headline} Recommended order:\n${lines.join("\n")}`;
}

export function fallbackTalkText(triage: Triage, approvals: readonly Approval[]): string {
  return `The AI assistant is unavailable right now, so here is the queue in policy order:\n${triage.items
    .map((i, n) => `${n + 1}. ${titleOf(approvals, i.id)}`)
    .join("\n")}`;
}

export const TEACH_FALLBACK_TEXT = [
  "The AI tutor is unavailable right now. Here is the standard review routine:",
  "1. Open the item and note its type and who submitted it.",
  "2. Check the review order: safety documents, onboarding, videos, then reference images.",
  "3. Run the checks for the file type (completeness, version, legibility, restricted areas).",
  "4. Approve only if every check passes; request changes for gaps; reject wrong or unsafe content with a written reason.",
  "5. Escalate to the Safety Lead if you cannot verify safety equipment, then log your decision."
].join("\n");

export function fallbackHelpText(chunk: PolicyChunk): string {
  return `The AI assistant is unavailable, so here is the closest policy section - ${chunk.title}:\n${chunk.text}`;
}

export const NO_POLICY_MATCH_TEXT =
  "I couldn't find that in the approvals policy note. Try rephrasing, or ask your supervisor.";

export function timeOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export function fallbackGreeting(approvals: readonly Approval[], now: Date): string {
  const n = approvals.length;
  return `Good ${timeOfDay(now)}! You have ${n} approval${n === 1 ? "" : "s"} pending review. Say "Present me Summary" and I will walk you through them.`;
}

/** Splits text into small pieces so built-in answers still arrive through the same streaming path. */
export function chunkText(text: string, wordsPerChunk = 4): string[] {
  const words = text.match(/\S+\s*/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) out.push(words.slice(i, i + wordsPerChunk).join(""));
  return out;
}
