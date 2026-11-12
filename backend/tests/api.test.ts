import request from "supertest";
import { createApp } from "../src/app";
import { loadApprovals } from "../src/data";
import { ErrorBodySchema, MetaEventSchema, TriageSchema } from "../src/schemas";
import { makeLlm, makeService, never } from "./helpers";
import type { LlmClient } from "../src/llm/types";

interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(body: string): SseFrame[] {
  return body
    .split("\n\n")
    .filter((f) => f.trim())
    .map((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] ?? "{}") as Record<string, unknown>;
      return { event, data };
    });
}

function buildApp(llm: LlmClient | null, opts: { timeoutMs?: number; max?: number } = {}) {
  return createApp({
    service: makeService(llm, opts.timeoutMs ?? 1000),
    approvals: loadApprovals(),
    rateLimit: { windowMs: 60_000, max: opts.max ?? 100 }
  });
}

describe("GET /api/approvals", () => {
  it("returns the seeded queue", async () => {
    const res = await request(buildApp(null)).get("/api/approvals").expect(200);
    expect(res.body.approvals).toHaveLength(4);
    expect(res.body.approvals[0]).toMatchObject({ id: "APR-001", status: "Pending Review" });
  });
});

describe("POST /api/ai/summary - success path", () => {
  it("streams a Zod-valid triage in meta, then tokens, then done", async () => {
    const res = await request(buildApp(makeLlm())).post("/api/ai/summary").send({ language: "English" }).expect(200);

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const frames = parseSse(res.text);
    expect(frames[0].event).toBe("meta");
    const meta = MetaEventSchema.parse(frames[0].data);
    expect(meta.fallback).toBe(false);
    expect(TriageSchema.safeParse(meta.triage).success).toBe(true);

    const tokens = frames.filter((f) => f.event === "token").map((f) => f.data.text);
    expect(tokens.join("")).toBe("Start with the safety PDF.");
    expect(frames[frames.length - 1]).toEqual({ event: "done", data: { fallback: false } });
  });
});

describe("fallback / timeout path", () => {
  it("answers 200 with a built-in summary when the LLM stalls past the deadline", async () => {
    const llm = makeLlm({ structured: jest.fn(() => never()) });
    const started = Date.now();
    const res = await request(buildApp(llm, { timeoutMs: 50 }))
      .post("/api/ai/summary")
      .send({})
      .expect(200);

    expect(Date.now() - started).toBeLessThan(2000);
    const frames = parseSse(res.text);
    const meta = MetaEventSchema.parse(frames[0].data);
    expect(meta).toMatchObject({ fallback: true, reason: "timeout" });
    expect(meta.triage?.items[0].id).toBe("APR-003");
    expect(frames[frames.length - 1]).toEqual({ event: "done", data: { fallback: true } });
  });

  it("survives a stalled token stream on /talk", async () => {
    const llm = makeLlm({
      stream: jest.fn(() =>
        (async function* () {
          await never<void>();
          yield "x";
        })()
      )
    });
    const res = await request(buildApp(llm, { timeoutMs: 50 }))
      .post("/api/ai/talk")
      .send({ messages: [{ role: "user", content: "What first?" }] })
      .expect(200);
    const frames = parseSse(res.text);
    expect(MetaEventSchema.parse(frames[0].data)).toMatchObject({ fallback: true, reason: "timeout" });
    expect(frames.at(-1)?.event).toBe("done");
  });

  it("degrades gracefully with no API key configured", async () => {
    const res = await request(buildApp(null)).post("/api/ai/greeting").send({}).expect(200);
    const frames = parseSse(res.text);
    expect(MetaEventSchema.parse(frames[0].data)).toMatchObject({ fallback: true, reason: "no_api_key" });
    expect(
      frames
        .filter((f) => f.event === "token")
        .map((f) => f.data.text)
        .join("")
    ).toContain("4 approvals");
  });

  it("reports a mid-stream failure as an SSE error event, not a 500", async () => {
    const llm = makeLlm({
      stream: jest.fn(() =>
        (async function* () {
          yield "Part";
          throw new Error("reset");
        })()
      )
    });
    const res = await request(buildApp(llm))
      .post("/api/ai/help")
      .send({ question: "What should I check on a PDF?" })
      .expect(200);
    expect(parseSse(res.text).map((f) => f.event)).toEqual(["meta", "token", "error"]);
  });
});

describe("request validation", () => {
  it("rejects an empty talk conversation with a typed 400", async () => {
    const res = await request(buildApp(makeLlm())).post("/api/ai/talk").send({ messages: [] }).expect(400);
    const body = ErrorBodySchema.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.[0].path).toBe("messages");
  });

  it("rejects a conversation that does not end with a user message", async () => {
    await request(buildApp(makeLlm()))
      .post("/api/ai/talk")
      .send({ messages: [{ role: "assistant", content: "hello" }] })
      .expect(400);
  });

  it("returns JSON (not an HTML stack trace) for malformed bodies", async () => {
    const res = await request(buildApp(makeLlm()))
      .post("/api/ai/summary")
      .set("Content-Type", "application/json")
      .send("{bad")
      .expect(400);
    expect(ErrorBodySchema.parse(res.body).error.code).toBe("INVALID_JSON");
  });
});

describe("rate limiting", () => {
  it("throttles per session id and returns a typed 429", async () => {
    const app = buildApp(null, { max: 2 });
    const hit = (session: string) => request(app).post("/api/ai/greeting").set("X-Session-Id", session).send({});

    await hit("session-a").expect(200);
    await hit("session-a").expect(200);
    const blocked = await hit("session-a").expect(429);
    expect(ErrorBodySchema.parse(blocked.body).error.code).toBe("RATE_LIMITED");

    await hit("session-b").expect(200);
  });
});
