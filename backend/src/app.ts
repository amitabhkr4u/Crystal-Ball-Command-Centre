import express, { type ErrorRequestHandler, type Express } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./openapi";
import { ApprovalsResponseSchema, type Approval } from "./schemas";
import { createAiRateLimiter } from "./middleware/rateLimit";
import { createAiRouter } from "./routes/ai";
import type { AiService } from "./services/aiService";

export interface AppOptions {
  service: AiService;
  approvals: Approval[];
  rateLimit: { windowMs: number; max: number };
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const type = (err as { type?: string }).type;
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON." } });
  } else if (type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } });
  } else {
    console.error("[api] unhandled error:", err);
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
  }
};

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/approvals", (_req, res) => {
    res.json(ApprovalsResponseSchema.parse({ approvals: options.approvals }));
  });

  // API documentation: raw OpenAPI JSON + interactive Swagger UI (not rate limited, not an AI route).
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });
  app.use(
    "/api/docs",
    (req, res, next) => {
      // Swagger UI loads its assets relatively, so the page must live at /api/docs/ (trailing slash).
      if (req.originalUrl.split("?")[0] === "/api/docs") {
        res.redirect(302, "/api/docs/");
        return;
      }
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: "Crystal Ball API docs",
      swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true }
    })
  );

  app.use("/api/ai", createAiRateLimiter(options.rateLimit), createAiRouter(options.service));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });
  app.use(errorHandler);
  return app;
}
