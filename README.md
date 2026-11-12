# Crystal Ball Command Centre - Approvals Assistant

A working rebuild of the OomniEye "Approvals" assistant panel. It has five entry points, each backed by a real Claude call and a tested non-AI fallback:
**Present me Summary**, **Talk to me**, **Help me**, **Teach me** and **Replay Greeting**.

This single README is the complete guide: what is in the repository, how to run it, how it works, how it is tested, and what was deliberately left out.

## Contents

1. [Overview](#1-overview)
2. [Skills demonstrated](#2-skills-demonstrated)
3. [Run it locally](#3-run-it-locally)
4. [Try it](#4-try-it)
5. [Technologies used](#5-technologies-used)
6. [Architecture](#6-architecture)
7. [The five entry points](#7-the-five-entry-points)
8. [API reference](#8-api-reference)
9. [Failure handling](#9-failure-handling)
10. [Frontend design](#10-frontend-design)
11. [Tests and quality checks](#11-tests-and-quality-checks)
12. [Configuration](#12-configuration)
13. [Assignment checklist](#13-assignment-checklist)
14. [Assumptions, substitutions and limitations](#14-assumptions-substitutions-and-limitations)
15. [AI tools used](#15-ai-tools-used)
16. [Short write-up](#16-short-write-up)

## 1. Overview

The repository holds two independent apps. Each has its own `package.json`, TypeScript config and tests.

| Folder | What it is | Port | Stack |
| --- | --- | --- | --- |
| [`backend/`](backend) | REST + Server-Sent Events API, AI layer, fallbacks, retrieval | 4000 | Node 20+, Express 4, TypeScript (strict), Zod, Anthropic SDK, Jest + Supertest |
| [`frontend/`](frontend) | Assistant panel UI | 3000 | Next.js 14, React 18, Zustand, Zod, Vitest + Testing Library |

```
.
|-- backend/    API server
|-- frontend/   Web UI
`-- .github/    CI workflow: runs the checks of both apps
```

## 2. Skills demonstrated

| Skill | Where it shows in the code |
| --- | --- |
| LLM integration (Claude, server-side only) | `backend/src/llm/anthropic.ts`: streaming and forced tool call; key read only in `backend/src/config.ts` |
| Prompt engineering and versioning | `backend/src/prompts/*.ts`: one versioned export per prompt (`summary.triage.v1`, `help.v1`, ...); `activePrompts` picks the live version |
| Structured output with validation | Summary triage is a forced tool call, parsed with Zod, and every approval id must appear exactly once (`validateTriage`) |
| Retrieval-augmented generation | `backend/src/rag.ts`: chunk the policy note, score by keyword overlap, ground the prompt, return cited chunk ids |
| Streaming (SSE) end to end | Server: `backend/src/routes/ai.ts`. Client: `frontend/lib/api.ts` (`fetch` + `ReadableStream`) |
| Resilience and graceful degradation | 8 second timeout, idle timeout for streams, deterministic fallbacks, mid-stream error events |
| API design and contract-first development | Zod schemas (`backend/src/schemas.ts`), hand-written OpenAPI 3 spec served by Swagger UI, typed error bodies |
| Input validation and rate limiting | `validate` middleware on every AI route; per-session limiter (20 requests per minute) |
| State management without prop drilling | Zustand store in `frontend/store/assistantStore.ts` |
| TypeScript strict mode | `strict: true` in both `tsconfig.json` files |
| Testing at three levels | Jest unit tests with a mocked LLM, Supertest API tests, Vitest + Testing Library UI tests |
| Tooling and CI | Prettier, ESLint, EditorConfig, `.nvmrc`, GitHub Actions workflow |

## 3. Run it locally

**Requirements:** Node.js 20 or newer and npm. Use two terminals, one for each app. Start the backend first.

### Step 1: backend (terminal 1)

```bash
cd backend
npm install
cp .env.example .env      # optional: put your key in ANTHROPIC_API_KEY
npm run dev               # API on http://localhost:4000
```

### Step 2: frontend (terminal 2)

```bash
cd frontend
npm install
cp .env.example .env      # API_URL=http://localhost:4000
npm run dev               # UI on http://localhost:3000
```

Open **http://localhost:3000**.

- **With an Anthropic API key** in `backend/.env`, answers come from Claude.
- **Without a key**, leave `ANTHROPIC_API_KEY` empty. The server logs a warning and every action still works through its built-in fallback, labelled in the UI.
- **Swagger UI** (all 7 endpoints, try-it-out): http://localhost:4000/api/docs/
- **Production mode** for the UI: `npm run build && npm start` inside `frontend/`.

### Commands

| Command (run inside `backend/` or `frontend/`) | What it does |
| --- | --- |
| `npm run dev` | Backend: `tsx watch` with reload. Frontend: Next.js dev server |
| `npm start` | Backend: run once without watching. Frontend: serve the production build |
| `npm run build` | Frontend only: production build |
| `npm test` | Backend: Jest + Supertest. Frontend: Vitest + Testing Library |
| `npm run typecheck` | `tsc --noEmit` in strict mode |
| `npm run lint` | Frontend only: `next lint` |
| `npm run format` / `npm run format:check` | Prettier write / check |
| `npm run verify` | Everything CI runs: format check, (lint,) typecheck, tests |

## 4. Try it

1. Open the panel. The header, the five action cards and a language picker (English, Hindi, Spanish, French) are visible.
2. Click **Present me Summary**: a prioritised list of the four pending approvals, then a short narration streamed token by token.
3. Click **Talk to me** and ask a question: a multi-turn chat. The history is sent on every turn.
4. Click **Help me** and ask "What should I check on a PDF?": the answer comes from the policy note and shows its source.
5. Click **Teach me**: the lesson starts on its own; ask a follow-up to see it adapt.
6. Click **Replay Greeting** several times: a fresh greeting with the live pending count and the time of day.
7. Turn on **Dev inspector** above the approvals list. Under each answer it shows the endpoint, prompt version, live-vs-fallback and latency, for example `POST /api/ai/help · help.v1 · live LLM · 1240 ms`.

To see the failure handling, run the backend with `LLM_TIMEOUT_MS=1` (forced timeout), with an invalid key, or with no key. Each case still produces an answer, marked as a built-in one.

## 5. Technologies used

### Backend

| Technology | Why it is used |
| --- | --- |
| Node.js 20+, TypeScript (strict) | Runtime and type safety |
| Express 4 | HTTP server and routing; the app factory (`createApp`) is reused by Supertest |
| `@anthropic-ai/sdk` | Claude calls: `messages.stream` for text and a forced tool call for structured output |
| Zod | Request validation, validation of model output, and the typed contract |
| `express-rate-limit` | Per-session rate limiting |
| `swagger-ui-express` | Interactive API documentation from the hand-written OpenAPI file |
| `dotenv` | Loads `.env` |
| `tsx` | Runs TypeScript directly for `dev` and `start` |
| Jest, ts-jest, Supertest | Unit and HTTP tests |

### Frontend

| Technology | Why it is used |
| --- | --- |
| Next.js 14 (app router), React 18 | UI framework; `rewrites` proxy `/api/*` to the backend |
| Zustand | Single store for session, messages, status, retry and the inspector switch |
| Zod | Validates every response and every SSE frame |
| `lucide-react` | Icons |
| Plain CSS (`app/globals.css`) | Styling, no UI framework |
| Vitest, Testing Library, jsdom | Component and client tests |

### Shared tooling

Prettier (`.prettierrc.json`), ESLint (`next lint`, frontend), EditorConfig, `.nvmrc` (Node 20), `.gitattributes` (LF line endings) and a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs `npm run verify` for both apps.

## 6. Architecture

```
browser (Next.js, Zustand)  --POST /api/ai/*-->  Next rewrite  -->  Express (TypeScript strict)
  fetch + ReadableStream  <-- SSE: meta/token/done/error --          |- Zod validation + per-session rate limit
                                                                      |- aiService: prompts, retrieval, fallbacks
                                                                      `- AnthropicLlm (8s timeout), key stays on the server
```

- The browser only talks to Next.js. `next.config.mjs` rewrites `/api/*` to the backend (`API_URL`), so the browser never needs the backend address or any key.
- `compress: false` in `next.config.mjs` stops gzip from buffering the stream, which would break token-by-token rendering.
- The two folders share no code. The backend owns the full contract in `backend/src/schemas.ts`; the frontend keeps the response subset it needs in `frontend/lib/schemas.ts`. Keeping them as separate deployable apps is a deliberate trade-off: no shared package or workspace tooling to set up, at the cost that a contract change must be made in both files.

### Backend request flow

1. `POST /api/ai/<action>` arrives with an `X-Session-Id` header.
2. The per-session rate limiter runs, then the Zod schema for that action validates the body.
3. `services/aiService.ts` builds the prompt, calls the model through the `LlmClient` interface and yields events.
4. `routes/ai.ts` writes each event as Server-Sent Events: `meta`, repeated `token`, then `done` or `error`.

### Backend folder map

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Entry point: load config and data, create the LLM client, listen |
| `src/app.ts` | Express app factory (also used by Supertest), health, approvals, docs and error handler |
| `src/config.ts` | Environment parsing with defaults |
| `src/data.ts` | Loads and validates `data/approvals.json` and `data/policy.md` |
| `src/schemas.ts` | Zod API contract: requests, triage JSON, SSE events, error body |
| `src/openapi.ts` | Hand-written OpenAPI 3 document served by Swagger UI |
| `src/rag.ts` | Chunk the policy note and score chunks by keyword overlap |
| `src/routes/ai.ts` | The five SSE routes and the SSE writer |
| `src/middleware/` | `validate` (Zod) and `rateLimit` (per session) |
| `src/llm/` | `LlmClient` interface, Anthropic adapter, timeout helpers |
| `src/services/aiService.ts` | One generator per action, model-output validation, fallback selection |
| `src/services/fallbacks.ts` | Deterministic non-AI answers |
| `src/prompts/` | Versioned prompt exports; `index.ts` holds the active versions |
| `tests/` | Jest + Supertest suites (LLM mocked) |
| `data/` | Mock approvals queue and the policy note used for retrieval |

### Frontend folder map

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js app router: layout, page, global CSS |
| `components/ChatPanel.tsx` | Panel shell: header, language picker, states, composer |
| `components/ActionCards.tsx` | The five entry points |
| `components/MessageBubble.tsx`, `TriageList.tsx` | Message and triage rendering |
| `components/ApprovalsList.tsx` | The approvals queue behind the panel |
| `components/ApiStatus.tsx` | Health chip, Swagger link, API map, Dev inspector switch |
| `store/assistantStore.ts` | Session, messages, status, abort, retry |
| `lib/api.ts` | SSE client and error mapping |
| `lib/schemas.ts` | Browser copy of the response contract (Zod) |
| `tests/` | Vitest + Testing Library: panel states, SSE parsing, API bar |

### Design decisions

- Retries are disabled in the SDK: the 8 second deadline plus the fallback is the retry policy.
- The model client sits behind the `LlmClient` interface, so tests can mock it and the provider can be swapped.
- Prompts are versioned exports; the server uses whichever version `activePrompts` points to, so a prompt can be rolled forward or back in one line.
- Fallback answers travel through the same SSE path as live ones, so the UI has a single rendering path.

## 7. The five entry points

| Action | Endpoint | Needs an LLM? | Fallback when the model is unavailable |
| --- | --- | --- | --- |
| Present me Summary | `POST /api/ai/summary` | Yes, for the ranking. A forced tool call returns triage JSON, validated by Zod; the prose is narrated afterwards from that validated list | Ranking by the policy review order, rendered as text |
| Talk to me | `POST /api/ai/talk` | Yes: open-ended, multi-turn (history resent each turn, up to 20 messages) | The queue listed in policy order |
| Help me | `POST /api/ai/help` | Retrieval first. If no policy chunk matches, no model call is made | The closest policy chunk, quoted |
| Teach me | `POST /api/ai/teach` | Yes: step-by-step and adaptive; an empty history starts the lesson | A fixed five-step review routine |
| Replay Greeting | `POST /api/ai/greeting` | Optional: a template does the job, the model adds variety (temperature 1) | A greeting with the live pending count and time of day |

**Data.** `backend/data/approvals.json` has four items (Folder, Video, PDF, Image) with submitters and "Pending Review - Sep 18", validated at boot. `backend/data/policy.md` is a short policy note (about 280 words) split into 5 chunks by its `##` headings.

**Urgency.** The dataset has no deadlines, so "urgent" comes from the review order in the policy note: safety PDFs, then onboarding folders, then videos, then reference images. The model and the fallback use the same rule.

## 8. API reference

Interactive docs: http://localhost:4000/api/docs/ (raw spec: `/api/openapi.json`). The spec is hand-written in `backend/src/openapi.ts`, and `tests/openapi.test.ts` fails if its examples stop passing the Zod schemas or if the documented endpoints drift from the mounted routes.

| # | Method | Path | Called by |
| --- | --- | --- | --- |
| 1 | GET | `/api/health` | API status chip. Response `{ "ok": true }` |
| 2 | GET | `/api/approvals` | Approvals list. Response `{ "approvals": Approval[] }` |
| 3 | POST | `/api/ai/summary` | Present me Summary. Body `{ language? }`. Triage in `meta.triage`, then narration |
| 4 | POST | `/api/ai/talk` | Talk to me. Body `{ language?, messages[1..20] }`; the last message must be from the user |
| 5 | POST | `/api/ai/help` | Help me. Body `{ language?, question (3..500 chars) }`; `meta.sources` lists chunk ids |
| 6 | POST | `/api/ai/teach` | Teach me. Body `{ language?, approvalId?, messages[0..20] }`; empty `messages` starts the lesson |
| 7 | POST | `/api/ai/greeting` | Replay Greeting. Body `{ language? }` |

`language` defaults to `"English"`. A message is `{ role: "user" | "assistant", content: string (1..2000) }`. The AI endpoints are rate limited per `X-Session-Id` (default 20 requests per minute).

**Streaming format** of the AI endpoints:

```
event: meta
data: {"fallback":false,"promptVersion":"talk.v1"}

event: token
data: {"text":"Start with "}

event: done
data: {"fallback":false}
```

An `error` event (`{ "code", "message" }`) replaces `done` when a stream breaks after tokens were sent.

**Errors** use one shape: `{ "error": { "code", "message", "details"?: [{ "path", "message" }] } }`.

| Status | Code | Meaning |
| --- | --- | --- |
| 200 | n/a | SSE stream, fallback answers included |
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` | Bad request body |
| 404 | `NOT_FOUND` | Unknown route |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 32 kB |
| 429 | `RATE_LIMITED` | Too many requests for this session |
| 500 | `INTERNAL` | Unexpected server error |

## 9. Failure handling

| Situation | Behaviour |
| --- | --- |
| No API key | Fallback answer, `reason: "no_api_key"` |
| Structured call exceeds 8 seconds, or a stream is silent for 8 seconds | Fallback answer, `reason: "timeout"` |
| Provider error before any token | Fallback answer, `reason: "llm_error"` |
| Empty or schema-invalid model output | Fallback answer, `reason: "invalid_output"` |
| Help question with no matching policy chunk | No model call, fixed reply, `reason: "no_policy_match"` |
| Stream dies after tokens were sent | `error` event (`STREAM_INTERRUPTED`); the UI keeps the partial text and offers Retry |
| Invalid request | `400` with a typed error body |
| Rate limit | `429 RATE_LIMITED` |

Nothing surfaces as a raw 500 on an AI route. The structured call uses a hard deadline; streams use an idle timeout that restarts on every token, so long answers are fine but a stalled connection is cut.

## 10. Frontend design

**Data flow.**

1. A click on an action card calls `startMode` in the Zustand store.
2. The store's `run()` calls `streamAi` (`lib/api.ts`): a `fetch` POST with `X-Session-Id`, then the response body is read as a stream.
3. Each SSE frame is parsed and validated with the Zod schemas in `lib/schemas.ts`. A malformed frame becomes a typed `ApiError`.
4. `meta` sets the fallback flag, triage and sources on the message, `token` appends text, `done` ends the stream and `error` shows the Retry state.
5. Components only render store state; they contain no network code.

**UI states.**

| State | What the user sees |
| --- | --- |
| loading | "Thinking" status with animated dots |
| streaming | Text growing token by token with a caret |
| fallback | The answer plus a notice that a built-in answer is shown |
| error | An alert (`role="alert"`) with a Retry button; partial text is kept |

**API bar.** `components/ApiStatus.tsx` shows a live online/offline chip (`GET /api/health`), a link to Swagger UI, an **API map** of which UI part calls which of the 7 endpoints, and the **Dev inspector** switch (off by default).

## 11. Tests and quality checks

All AI behaviour is tested with a mocked LLM, so the suites need no API key and no network.

| Suite | Tool | What it covers |
| --- | --- | --- |
| `backend/tests/aiService.test.ts` | Jest | Each action with a mocked model: structured triage, wrong-shape output, invented or omitted ids, timeout, no key, empty stream, mid-stream failure, retrieval grounding, teach history, greeting |
| `backend/tests/api.test.ts` | Supertest | Success path, fallback and timeout path, stalled stream, validation errors, malformed JSON, 429 |
| `backend/tests/timeout.test.ts` | Jest | `withTimeout` and `streamWithIdleTimeout` |
| `backend/tests/fallbacks.test.ts` | Jest | Policy-order ranking, text chunking, greeting |
| `backend/tests/rag.test.ts` | Jest | Chunking, retrieval, word forms, no-match case |
| `backend/tests/openapi.test.ts` | Supertest | Exactly 7 documented operations, examples pass the real Zod schemas, documented endpoints are mounted, docs routes serve |
| `frontend/tests/components/ChatPanel.test.tsx` | Vitest + Testing Library | Loading, streaming, error with Retry, fallback notice, mid-stream cut, conversation actions, language |
| `frontend/tests/components/ApiStatus.test.tsx` | Vitest + Testing Library | Health chip, API map, Dev inspector |
| `frontend/tests/lib/api.test.ts` | Vitest | SSE frame parsing and validation, split chunks, 429 mapping, network failure, health check |

Run `npm run verify` inside each app. It is the same command CI runs.

## 12. Configuration

**Backend** (`backend/.env`, template in `backend/.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | empty | Server-side only. Empty means every action uses its fallback |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model id |
| `PORT` | `4000` | API port |
| `LLM_TIMEOUT_MS` | `8000` | Deadline for model calls and idle timeout for streams |
| `RATE_LIMIT_MAX` | `20` | Requests per window per session |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |

**Frontend** (`frontend/.env`, template in `frontend/.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_URL` | `http://localhost:4000` | Where the Next.js server proxies `/api/*`. No secrets belong here |
| `NEXT_PUBLIC_API_DOCS_URL` | `http://localhost:4000/api/docs/` | Target of the "API docs (Swagger)" link. It points to the backend directly because Swagger UI needs a trailing slash that the Next proxy would strip |

## 13. Assignment checklist

| Requirement | Where |
| --- | --- |
| Five entry points | Section 7 |
| Panel UI (header, action cards, close) | `frontend/components/ChatPanel.tsx`, `ActionCards.tsx` |
| Loading and error states | "Thinking" status, `role="alert"` with Retry, fallback notice |
| Token-by-token streaming | SSE over `fetch` in `frontend/lib/api.ts`; `compress: false` in `frontend/next.config.mjs` |
| Zustand state, no prop drilling | `frontend/store/assistantStore.ts` |
| Node + Express, TypeScript strict | `backend/tsconfig.json`, `frontend/tsconfig.json` |
| API contract validated with Zod before the routes | `backend/src/schemas.ts`, `backend/src/middleware/validate.ts` |
| Hand-written API contract | Zod contract plus `backend/src/openapi.ts` served at `/api/docs/` |
| LLM server-side only | `backend/src/llm/anthropic.ts`; key read in `backend/src/config.ts`; the frontend holds no key |
| Structured JSON validated with Zod, no regex parsing | Summary triage: forced tool call and `validateTriage` |
| Prompts versioned in `prompts/` | `backend/src/prompts/*.ts` |
| 8 second timeout and graceful degradation | `backend/src/llm/timeout.ts`, `backend/src/services/fallbacks.ts` |
| Per-session rate limiting | `backend/src/middleware/rateLimit.ts` |
| Policy note of 200-400 words, 3-5 chunks, in-memory retrieval | `backend/data/policy.md` (5 chunks), `backend/src/rag.ts` |
| Tests: Jest with mocked LLM, Supertest (success and fallback), Vitest (loading, streaming, error) | Section 11 |
| Short write-up, AI tools note | Sections 15 and 16 |

## 14. Assumptions, substitutions and limitations

- **Next.js frontend plus a separate Express API** (the brief allows either). Express lets Supertest exercise the real app, and the Next rewrite keeps the API URL and key out of the browser.
- **Keyword retrieval instead of pgvector**: five chunks do not justify a vector store.
- **In-memory rate limiter**, keyed by the `X-Session-Id` the browser generates (IP as fallback). It guards against UI loops and runaway cost, not a determined attacker; a client can mint new session ids. Production would add IP and auth based limits and a shared store.
- **Language** is sent with every request and enforced in the prompts. Built-in fallback text is English only.
- **"Out loud" is text only.** There is no text-to-speech.
- **Read-only assistant.** Approve and reject actions are out of scope; the panel advises and does not change the queue.
- **Contract kept in two files** (backend and frontend), see section 6.
- **No Loom walkthrough** is included.
- **Commit history** is grouped by feature, not written test-first.

## 15. AI tools used

Built with Claude's help for drafting code, tests and this README. Architecture, trade-offs and the final review are mine.

## 16. Short write-up

**Where AI earns its place.** *Talk to me* and *Teach me* need an LLM: they are open-ended, multi-turn and must adapt to follow-ups. *Present me Summary* needs it for the reasoning (ranking by urgency against the policy note), not for the plumbing, so that step returns Zod-validated JSON and the prose is narrated afterwards. *Help me* is retrieval first: if no policy chunk matches, no model call happens at all. *Replay Greeting* is the least necessary action. A template with the live count does the job; the LLM only adds variety, so it is the first thing I would cut on cost grounds.

**Fallback design.** Every call has an 8s timeout (an idle timeout for streams). On a timeout, provider error, missing key, empty answer or schema-invalid output, the server swaps in a deterministic answer (policy-order ranking, the closest policy chunk, a static onboarding checklist, a count-based greeting) and streams it through the same SSE path with `fallback: true`. The UI shows a notice instead of breaking. If a stream dies after tokens were sent, an `error` event is emitted and the UI offers Retry. Nothing surfaces as a raw 500.

**With more time.** I would add an eval set of queue/expected-triage pairs run against the real model in CI. The mocked tests prove we handle bad output, but not the quality of good output.
