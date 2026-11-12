/**
 * OpenAPI 3.0 description of the API, served by Swagger UI at /api/docs.
 *
 * Hand-written on purpose (the brief asks for a hand-written contract, not generated docs).
 * It mirrors src/schemas.ts; tests/openapi.test.ts fails if an example here stops passing
 * the real Zod schema or if the documented endpoints drift from the mounted routes.
 * No imports: this file is plain data so it can be read (and explained) top to bottom.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

const sessionHeader = { $ref: "#/components/parameters/SessionId" };

/** Every AI endpoint answers with the same SSE envelope, only the example differs. */
const sseResponse = (description: string, example: string) => ({
  description,
  headers: {
    "Content-Type": { schema: { type: "string", example: "text/event-stream; charset=utf-8" } }
  },
  content: {
    "text/event-stream": {
      schema: {
        type: "string",
        description: "Server-Sent Events. Frame shapes: SseMetaEvent, SseTokenEvent, SseDoneEvent, SseErrorEvent."
      },
      example
    }
  }
});

const aiErrors = {
  "400": errorRef("ValidationError"),
  "413": errorRef("PayloadTooLarge"),
  "429": errorRef("RateLimited"),
  "500": errorRef("Internal")
};

const SSE_NOTE =
  "\n\n**Streaming:** the response is `text/event-stream` (`meta` → many `token` → `done`). " +
  "Swagger UI shows it only after the stream ends; use the frontend (or `curl -N`) to watch tokens arrive. " +
  "If the model is unavailable the same stream carries a built-in fallback answer with `fallback: true`.";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Crystal Ball Command Centre - Approvals Assistant API",
    version: "1.0.0",
    description:
      "REST + Server-Sent Events API behind the Approvals assistant panel.\n\n" +
      "- **System** endpoints return plain JSON (approvals queue, health).\n" +
      "- **AI Assistant** endpoints map 1:1 to the five panel actions: Present me Summary, Talk to me, Help me, Teach me, Replay Greeting.\n" +
      "- Every AI call has an 8s timeout and a deterministic non-AI fallback, so a model failure never becomes a raw 500.\n" +
      "- AI endpoints are rate limited per `X-Session-Id` (default 20 requests / minute)."
  },
  servers: [
    { url: "/", description: "Same origin as this page (works via the Next.js proxy on :3000 and directly on :4000)" }
  ],
  tags: [
    { name: "System", description: "Queue data and health" },
    { name: "AI Assistant", description: "The five assistant actions (SSE)" }
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["System"],
        operationId: "getHealth",
        summary: "Liveness check",
        description: "Used by the frontend status chip to show whether the API is reachable.",
        responses: {
          "200": {
            description: "API is up",
            content: { "application/json": { schema: ref("HealthResponse"), example: { ok: true } } }
          }
        }
      }
    },
    "/api/approvals": {
      get: {
        tags: ["System"],
        operationId: "listApprovals",
        summary: "Pending approvals queue",
        description:
          "Seeded mock queue (4 items, `backend/data/approvals.json`). Rendered as the Approvals list in the UI.",
        responses: {
          "200": {
            description: "The pending queue",
            content: {
              "application/json": {
                schema: ref("ApprovalsResponse"),
                example: {
                  approvals: [
                    {
                      id: "APR-001",
                      title: "Site Patrol Onboarding & Checklists",
                      type: "Folder",
                      submittedBy: "Sam HelpAdmin",
                      status: "Pending Review",
                      statusDate: "Sep 18"
                    },
                    {
                      id: "APR-003",
                      title: "Safety Equipment & Sensor Specs",
                      type: "PDF",
                      submittedBy: "Sam HelpAdmin",
                      status: "Pending Review",
                      statusDate: "Sep 18"
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/api/ai/summary": {
      post: {
        tags: ["AI Assistant"],
        operationId: "aiSummary",
        summary: "1. Present me Summary",
        description:
          "Summarises the pending queue, prioritised by urgency, in the operator's language.\n\n" +
          "**AI design:** step 1 is a forced tool call returning structured JSON (`Triage`), validated with Zod and checked to list every approval exactly once; " +
          "step 2 streams a short narration of that validated order. The validated triage arrives in `meta.triage`.\n\n" +
          "**Fallback:** deterministic ranking from the policy review order (`PDF → Folder → Video → Image`)." +
          SSE_NOTE,
        parameters: [sessionHeader],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: ref("SummaryRequest"),
              examples: {
                english: { summary: "English (default)", value: { language: "English" } },
                hindi: { summary: "Hindi", value: { language: "Hindi" } }
              }
            }
          }
        },
        responses: {
          "200": sseResponse(
            "SSE stream: triage in `meta`, narration in `token` frames",
            'event: meta\ndata: {"fallback":false,"promptVersion":"summary.narration.v1","triage":{"headline":"Four approvals are waiting; start with the safety specs.","items":[{"id":"APR-003","priority":"high","reason":"Safety and sensor specs gate field use."}]}}\n\nevent: token\ndata: {"text":"You have four approvals pending. "}\n\nevent: done\ndata: {"fallback":false}\n\n'
          ),
          ...aiErrors
        }
      }
    },
    "/api/ai/talk": {
      post: {
        tags: ["AI Assistant"],
        operationId: "aiTalk",
        summary: "2. Talk to me",
        description:
          "Free-form, multi-turn conversation about the queue. The client sends the full history each turn; the **last message must be from the user**.\n\n" +
          "**Fallback:** a deterministic answer naming what to review first." +
          SSE_NOTE,
        parameters: [sessionHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: ref("TalkRequest"),
              examples: {
                firstTurn: {
                  summary: "First question",
                  value: {
                    language: "English",
                    messages: [{ role: "user", content: "Which of these needs my attention first and why?" }]
                  }
                },
                followUp: {
                  summary: "Follow-up with history",
                  value: {
                    language: "English",
                    messages: [
                      { role: "user", content: "Which of these needs my attention first and why?" },
                      {
                        role: "assistant",
                        content: "Start with the Safety Equipment & Sensor Specs PDF: it gates field use."
                      },
                      { role: "user", content: "And what should I check in it?" }
                    ]
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": sseResponse(
            "SSE stream of the assistant's reply",
            'event: meta\ndata: {"fallback":false,"promptVersion":"talk.v1"}\n\nevent: token\ndata: {"text":"Start with "}\n\nevent: token\ndata: {"text":"the safety PDF."}\n\nevent: done\ndata: {"fallback":false}\n\n'
          ),
          ...aiErrors
        }
      }
    },
    "/api/ai/help": {
      post: {
        tags: ["AI Assistant"],
        operationId: "aiHelp",
        summary: "3. Help me (RAG)",
        description:
          "Answers one operational question, grounded **only** in the approvals policy note (`backend/data/policy.md`).\n\n" +
          "**AI design:** keyword retrieval picks the best policy chunks, the prompt contains only those chunks, and the answer cites them (`[P2]`). " +
          "`meta.sources` lists the chunk ids used. If no chunk matches, **no model call is made**: a fixed reply is streamed with `reason: no_policy_match`.\n\n" +
          "**Fallback:** the retrieved policy text itself." +
          SSE_NOTE,
        parameters: [sessionHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: ref("HelpRequest"),
              examples: {
                covered: {
                  summary: "Covered by the policy",
                  value: { language: "English", question: "When should I escalate an item to the Safety Lead?" }
                },
                notCovered: {
                  summary: "Not in the policy (no LLM call)",
                  value: { language: "English", question: "What is the capital of France?" }
                }
              }
            }
          }
        },
        responses: {
          "200": sseResponse(
            "SSE stream with cited, policy-grounded answer",
            'event: meta\ndata: {"fallback":false,"promptVersion":"help.v1","sources":[{"id":"P4","title":"Escalation"}]}\n\nevent: token\ndata: {"text":"Escalate within one working day [P4]."}\n\nevent: done\ndata: {"fallback":false}\n\n'
          ),
          ...aiErrors
        }
      }
    },
    "/api/ai/teach": {
      post: {
        tags: ["AI Assistant"],
        operationId: "aiTeach",
        summary: "4. Teach me",
        description:
          "Walks a new operator step by step through reviewing and acting on an approval, and adapts to follow-ups. " +
          "Send an **empty `messages` array to start the lesson**; the server supplies the opening prompt. Optionally pass `approvalId` to teach with a real item.\n\n" +
          "**Fallback:** a static onboarding checklist." +
          SSE_NOTE,
        parameters: [sessionHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: ref("TeachRequest"),
              examples: {
                start: { summary: "Start the lesson", value: { language: "English", messages: [] } },
                startWithItem: {
                  summary: "Start with a specific approval",
                  value: { language: "English", approvalId: "APR-003", messages: [] }
                },
                followUp: {
                  summary: "Follow-up question",
                  value: {
                    language: "English",
                    messages: [
                      { role: "assistant", content: "Step 1: open the item and read it fully before deciding." },
                      { role: "user", content: "What if the document looks outdated?" }
                    ]
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": sseResponse(
            "SSE stream with the lesson",
            'event: meta\ndata: {"fallback":false,"promptVersion":"teach.v1"}\n\nevent: token\ndata: {"text":"Step 1: open the item. "}\n\nevent: done\ndata: {"fallback":false}\n\n'
          ),
          ...aiErrors
        }
      }
    },
    "/api/ai/greeting": {
      post: {
        tags: ["AI Assistant"],
        operationId: "aiGreeting",
        summary: "5. Replay Greeting",
        description:
          "Regenerates a short, context-aware greeting that mentions the live pending count and time of day. Higher temperature, so each replay differs.\n\n" +
          "**Fallback:** a count-based template. This is the least AI-necessary action." +
          SSE_NOTE,
        parameters: [sessionHeader],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: ref("GreetingRequest"),
              examples: { english: { summary: "English (default)", value: { language: "English" } } }
            }
          }
        },
        responses: {
          "200": sseResponse(
            "SSE stream with a short greeting",
            'event: meta\ndata: {"fallback":false,"promptVersion":"greeting.v1"}\n\nevent: token\ndata: {"text":"Good morning! Four approvals are waiting for you."}\n\nevent: done\ndata: {"fallback":false}\n\n'
          ),
          ...aiErrors
        }
      }
    }
  },
  components: {
    parameters: {
      SessionId: {
        name: "X-Session-Id",
        in: "header",
        required: false,
        description: "Client-generated id used as the rate-limit key (falls back to the caller's IP).",
        schema: { type: "string", maxLength: 64, example: "demo-session-1" }
      }
    },
    schemas: {
      HealthResponse: {
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean", example: true } }
      },
      Approval: {
        type: "object",
        required: ["id", "title", "type", "submittedBy", "status", "statusDate"],
        properties: {
          id: { type: "string", example: "APR-001" },
          title: { type: "string", example: "Site Patrol Onboarding & Checklists" },
          type: { type: "string", enum: ["Folder", "Video", "PDF", "Image"] },
          submittedBy: { type: "string", example: "Sam HelpAdmin" },
          status: { type: "string", enum: ["Pending Review"] },
          statusDate: { type: "string", example: "Sep 18" }
        }
      },
      ApprovalsResponse: {
        type: "object",
        required: ["approvals"],
        properties: { approvals: { type: "array", items: ref("Approval") } }
      },
      Language: {
        type: "string",
        minLength: 2,
        maxLength: 40,
        default: "English",
        description: "Language the assistant must answer in.",
        example: "English"
      },
      ChatMessage: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["user", "assistant"] },
          content: { type: "string", minLength: 1, maxLength: 2000 }
        }
      },
      SummaryRequest: { type: "object", properties: { language: ref("Language") } },
      GreetingRequest: { type: "object", properties: { language: ref("Language") } },
      TalkRequest: {
        type: "object",
        required: ["messages"],
        properties: {
          language: ref("Language"),
          messages: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: ref("ChatMessage"),
            description: "Full history; the last message must have role `user`."
          }
        }
      },
      HelpRequest: {
        type: "object",
        required: ["question"],
        properties: { language: ref("Language"), question: { type: "string", minLength: 3, maxLength: 500 } }
      },
      TeachRequest: {
        type: "object",
        properties: {
          language: ref("Language"),
          approvalId: { type: "string", description: "Optional approval to teach with, e.g. APR-003." },
          messages: {
            type: "array",
            maxItems: 20,
            default: [],
            items: ref("ChatMessage"),
            description: "Empty to start; otherwise the last message must have role `user`."
          }
        }
      },
      TriageItem: {
        type: "object",
        required: ["id", "priority", "reason"],
        properties: {
          id: { type: "string", example: "APR-003" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", maxLength: 240 }
        }
      },
      Triage: {
        type: "object",
        description:
          "Structured model output. Zod-validated server-side and again in the browser; must list every approval exactly once.",
        required: ["headline", "items"],
        properties: {
          headline: { type: "string", maxLength: 200 },
          items: { type: "array", minItems: 1, maxItems: 10, items: ref("TriageItem") }
        }
      },
      SseMetaEvent: {
        type: "object",
        description: "`event: meta` - always first.",
        required: ["fallback"],
        properties: {
          fallback: { type: "boolean", description: "true when a built-in (non-AI) answer is being streamed." },
          reason: { type: "string", enum: ["no_api_key", "timeout", "llm_error", "invalid_output", "no_policy_match"] },
          promptVersion: { type: "string", example: "talk.v1" },
          triage: ref("Triage"),
          sources: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "title"],
              properties: { id: { type: "string" }, title: { type: "string" } }
            }
          }
        }
      },
      SseTokenEvent: {
        type: "object",
        description: "`event: token` - repeated; append `text` to the answer.",
        required: ["text"],
        properties: { text: { type: "string" } }
      },
      SseDoneEvent: {
        type: "object",
        description: "`event: done` - the stream finished normally.",
        required: ["fallback"],
        properties: { fallback: { type: "boolean" } }
      },
      SseErrorEvent: {
        type: "object",
        description: "`event: error` - replaces `done` when a stream breaks after tokens were already sent.",
        required: ["code", "message"],
        properties: { code: { type: "string", example: "STREAM_INTERRUPTED" }, message: { type: "string" } }
      },
      ErrorBody: {
        type: "object",
        description: "Every non-streaming 4xx/5xx has this shape.",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  required: ["path", "message"],
                  properties: { path: { type: "string" }, message: { type: "string" } }
                }
              }
            }
          }
        }
      }
    },
    responses: {
      ValidationError: {
        description: "Request body failed Zod validation (or was not valid JSON).",
        content: {
          "application/json": {
            schema: ref("ErrorBody"),
            example: {
              error: {
                code: "VALIDATION_ERROR",
                message: "Request body failed validation.",
                details: [{ path: "messages", message: "Array must contain at least 1 element(s)" }]
              }
            }
          }
        }
      },
      PayloadTooLarge: {
        description: "Request body larger than 32 kB.",
        content: {
          "application/json": {
            schema: ref("ErrorBody"),
            example: { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } }
          }
        }
      },
      RateLimited: {
        description: "Too many AI requests for this session.",
        content: {
          "application/json": {
            schema: ref("ErrorBody"),
            example: {
              error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." }
            }
          }
        }
      },
      Internal: {
        description: "Unexpected server error (model failures do NOT end up here; they use the fallback path).",
        content: {
          "application/json": {
            schema: ref("ErrorBody"),
            example: { error: { code: "INTERNAL", message: "Something went wrong." } }
          }
        }
      }
    }
  }
};

export type OpenApiSpec = typeof openApiSpec;
