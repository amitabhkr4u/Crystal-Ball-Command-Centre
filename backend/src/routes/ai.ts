import { Router, type Response } from "express";
import {
  GreetingRequestSchema,
  HelpRequestSchema,
  SummaryRequestSchema,
  TalkRequestSchema,
  TeachRequestSchema
} from "../schemas";
import { validate } from "../middleware/validate";
import type { AiEvent, AiService } from "../services/aiService";

/** One SSE frame: the event name is the AiEvent type, the data is the rest of the event. */
function writeEvent(res: Response, event: AiEvent): void {
  const { type, ...payload } = event;
  res.write(`event: ${type}\ndata: ${JSON.stringify(event.type === "meta" ? event.data : payload)}\n\n`);
}

/** Wraps a service generator as an SSE response. Never lets an exception become a raw 500 after headers are sent. */
function sse<Body>(handler: (body: Body) => AsyncGenerator<AiEvent>) {
  return async (req: { body: Body }, res: Response): Promise<void> => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) clientGone = true;
    });

    try {
      for await (const event of handler(req.body)) {
        if (clientGone) break;
        writeEvent(res, event);
      }
    } catch (err) {
      console.error("[ai] unexpected handler failure:", err);
      if (!clientGone)
        writeEvent(res, {
          type: "error",
          code: "INTERNAL",
          message: "The assistant hit an unexpected problem. Please retry."
        });
    } finally {
      res.end();
    }
  };
}

export function createAiRouter(service: AiService): Router {
  const router = Router();
  router.post(
    "/summary",
    validate(SummaryRequestSchema),
    sse((b: Parameters<AiService["summary"]>[0]) => service.summary(b))
  );
  router.post(
    "/talk",
    validate(TalkRequestSchema),
    sse((b: Parameters<AiService["talk"]>[0]) => service.talk(b))
  );
  router.post(
    "/help",
    validate(HelpRequestSchema),
    sse((b: Parameters<AiService["help"]>[0]) => service.help(b))
  );
  router.post(
    "/teach",
    validate(TeachRequestSchema),
    sse((b: Parameters<AiService["teach"]>[0]) => service.teach(b))
  );
  router.post(
    "/greeting",
    validate(GreetingRequestSchema),
    sse((b: Parameters<AiService["greeting"]>[0]) => service.greeting(b))
  );
  return router;
}
