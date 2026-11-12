/**
 * API contract - written before any route exists (OpenAPI-first in spirit).
 * Used by the Express server for request validation and LLM output validation.
 * The browser validates what it receives with the response subset in frontend/lib/schemas.ts.
 */
import { z } from "zod";

/* ---------- Domain ---------- */

export const ApprovalTypeSchema = z.enum(["Folder", "Video", "PDF", "Image"]);

export const ApprovalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: ApprovalTypeSchema,
  submittedBy: z.string().min(1),
  status: z.literal("Pending Review"),
  statusDate: z.string().min(1)
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalsResponseSchema = z.object({ approvals: z.array(ApprovalSchema) });

/* ---------- Requests ---------- */

export const LanguageSchema = z.string().trim().min(2).max(40).default("English");

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000)
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const endsWithUser = (messages: ChatMessage[]) =>
  messages.length === 0 || messages[messages.length - 1].role === "user";

export const SummaryRequestSchema = z.object({ language: LanguageSchema });
export type SummaryRequest = z.infer<typeof SummaryRequestSchema>;

export const GreetingRequestSchema = z.object({ language: LanguageSchema });
export type GreetingRequest = z.infer<typeof GreetingRequestSchema>;

export const TalkRequestSchema = z
  .object({
    language: LanguageSchema,
    messages: z.array(ChatMessageSchema).min(1).max(20)
  })
  .refine((r) => endsWithUser(r.messages), { message: "The last message must come from the user", path: ["messages"] });
export type TalkRequest = z.infer<typeof TalkRequestSchema>;

export const HelpRequestSchema = z.object({
  language: LanguageSchema,
  question: z.string().trim().min(3).max(500)
});
export type HelpRequest = z.infer<typeof HelpRequestSchema>;

export const TeachRequestSchema = z
  .object({
    language: LanguageSchema,
    approvalId: z.string().min(1).optional(),
    messages: z.array(ChatMessageSchema).max(20).default([])
  })
  .refine((r) => endsWithUser(r.messages), { message: "The last message must come from the user", path: ["messages"] });
export type TeachRequest = z.infer<typeof TeachRequestSchema>;

/* ---------- Structured LLM output (summary triage) ---------- */

export const PrioritySchema = z.enum(["high", "medium", "low"]);

export const TriageItemSchema = z.object({
  id: z.string().min(1),
  priority: PrioritySchema,
  reason: z.string().trim().min(1).max(240)
});

export const TriageSchema = z.object({
  headline: z.string().trim().min(1).max(200),
  items: z.array(TriageItemSchema).min(1).max(10)
});
export type Triage = z.infer<typeof TriageSchema>;

/** Hand-written JSON Schema handed to the model as a forced tool, mirrors TriageSchema. */
export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence describing the state of the queue." },
    items: {
      type: "array",
      description: "Every pending approval exactly once, most urgent first.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The approval id, e.g. APR-001." },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", description: "One short sentence explaining the priority." }
        },
        required: ["id", "priority", "reason"]
      }
    }
  },
  required: ["headline", "items"]
} as const;

/* ---------- SSE events (server -> browser) ---------- */

export const FallbackReasonSchema = z.enum(["no_api_key", "timeout", "llm_error", "invalid_output", "no_policy_match"]);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

export const SourceSchema = z.object({ id: z.string(), title: z.string() });

export const MetaEventSchema = z.object({
  fallback: z.boolean(),
  reason: FallbackReasonSchema.optional(),
  promptVersion: z.string().optional(),
  triage: TriageSchema.optional(),
  sources: z.array(SourceSchema).optional()
});
export type MetaEvent = z.infer<typeof MetaEventSchema>;

export const TokenEventSchema = z.object({ text: z.string() });
export const DoneEventSchema = z.object({ fallback: z.boolean() });
export const ErrorEventSchema = z.object({ code: z.string(), message: z.string() });

/** Non-streaming error body: every 4xx/5xx the API returns has this shape. */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional()
  })
});
