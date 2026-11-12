import request from "supertest";
import { createApp } from "../src/app";
import { loadApprovals } from "../src/data";
import { openApiSpec } from "../src/openapi";
import {
  ApprovalTypeSchema,
  GreetingRequestSchema,
  HelpRequestSchema,
  SummaryRequestSchema,
  TalkRequestSchema,
  TeachRequestSchema
} from "../src/schemas";
import { makeService } from "./helpers";
import type { ZodTypeAny } from "zod";

/** The documentation is a contract: these tests fail when it drifts from the code. */
interface LooseOperation {
  requestBody?: { content: { "application/json": { examples: Record<string, { value: unknown }> } } };
}
interface LooseSpec {
  paths: Record<string, Record<string, LooseOperation>>;
  components: { schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }> };
}
const spec = openApiSpec as unknown as LooseSpec;

const REQUEST_SCHEMAS: Record<string, ZodTypeAny> = {
  "/api/ai/summary": SummaryRequestSchema,
  "/api/ai/talk": TalkRequestSchema,
  "/api/ai/help": HelpRequestSchema,
  "/api/ai/teach": TeachRequestSchema,
  "/api/ai/greeting": GreetingRequestSchema
};

// No LLM configured: every AI route answers instantly through its built-in fallback.
const app = createApp({
  service: makeService(null),
  approvals: loadApprovals(),
  rateLimit: { windowMs: 60_000, max: 1000 }
});

describe("OpenAPI document", () => {
  it("lists exactly the 7 endpoints the assignment needs", () => {
    const documented = Object.entries(spec.paths)
      .flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`))
      .sort();
    expect(documented).toEqual(
      [
        "GET /api/health",
        "GET /api/approvals",
        "POST /api/ai/summary",
        "POST /api/ai/talk",
        "POST /api/ai/help",
        "POST /api/ai/teach",
        "POST /api/ai/greeting"
      ].sort()
    );
  });

  it.each(Object.entries(REQUEST_SCHEMAS))(
    "every request example for %s passes the real Zod schema",
    (path, schema) => {
      const examples = spec.paths[path].post.requestBody?.content["application/json"].examples ?? {};
      expect(Object.keys(examples).length).toBeGreaterThan(0);
      for (const [name, example] of Object.entries(examples)) {
        const result = schema.safeParse(example.value);
        expect({ example: name, ok: result.success }).toEqual({ example: name, ok: true });
      }
    }
  );

  it("documents the same approval types as the Zod contract", () => {
    expect(spec.components.schemas.Approval.properties?.type.enum).toEqual([...ApprovalTypeSchema.options]);
  });
});

describe("documented endpoints are really mounted", () => {
  it("GET /api/health and GET /api/approvals respond 200", async () => {
    await request(app).get("/api/health").expect(200, { ok: true });
    const res = await request(app).get("/api/approvals").expect(200);
    expect(res.body.approvals).toHaveLength(4);
  });

  it.each(Object.keys(REQUEST_SCHEMAS))("POST %s streams SSE for its first documented example", async (path) => {
    const examples = Object.values(spec.paths[path].post.requestBody?.content["application/json"].examples ?? {});
    const res = await request(app).post(path).send(examples[0].value).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toMatch(/^event: meta/m);
    expect(res.text).toMatch(/^event: done/m);
  });
});

describe("docs endpoints", () => {
  it("serves the raw OpenAPI JSON", async () => {
    const res = await request(app).get("/api/openapi.json").expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toHaveLength(7);
  });

  it("redirects /api/docs to the trailing-slash URL Swagger UI needs", async () => {
    const res = await request(app).get("/api/docs").expect(302);
    expect(res.headers.location).toBe("/api/docs/");
  });

  it("serves the Swagger UI page", async () => {
    const res = await request(app).get("/api/docs/").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toMatch(/swagger-ui/i);
  });
});
