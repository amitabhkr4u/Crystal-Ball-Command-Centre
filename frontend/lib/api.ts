import {
  ApprovalsResponseSchema,
  DoneEventSchema,
  ErrorBodySchema,
  ErrorEventSchema,
  HealthResponseSchema,
  MetaEventSchema,
  TokenEventSchema,
  type Approval,
  type MetaEvent
} from "./schemas";

export type AiPath = "summary" | "talk" | "help" | "teach" | "greeting";

export type StreamEvent =
  | { type: "meta"; data: MetaEvent }
  | { type: "token"; text: string }
  | { type: "done"; fallback: boolean }
  | { type: "error"; code: string; message: string };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const badFrame = (detail: string) =>
  new ApiError("BAD_FRAME", `The assistant sent an unexpected response (${detail}).`);

/** Parses one SSE frame and validates its payload with the Zod schemas in ./schemas. Unknown events are ignored. */
export function parseFrame(frame: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;

  let json: unknown;
  try {
    json = JSON.parse(dataLines.join("\n"));
  } catch {
    throw badFrame("invalid JSON");
  }

  switch (event) {
    case "meta": {
      const r = MetaEventSchema.safeParse(json);
      if (!r.success) throw badFrame("meta failed validation");
      return { type: "meta", data: r.data };
    }
    case "token": {
      const r = TokenEventSchema.safeParse(json);
      if (!r.success) throw badFrame("token failed validation");
      return { type: "token", text: r.data.text };
    }
    case "done": {
      const r = DoneEventSchema.safeParse(json);
      if (!r.success) throw badFrame("done failed validation");
      return { type: "done", fallback: r.data.fallback };
    }
    case "error": {
      const r = ErrorEventSchema.safeParse(json);
      if (!r.success) throw badFrame("error failed validation");
      return { type: "error", code: r.data.code, message: r.data.message };
    }
    default:
      return null;
  }
}

export async function fetchApprovals(): Promise<Approval[]> {
  let res: Response;
  try {
    res = await fetch("/api/approvals");
  } catch {
    throw new ApiError("NETWORK", "Could not load approvals.");
  }
  if (!res.ok) throw new ApiError("HTTP_ERROR", "Could not load approvals.");
  return ApprovalsResponseSchema.parse(await res.json()).approvals;
}

/** GET /api/health. Never throws: any failure simply means "offline" for the status chip. */
export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    return res.ok && HealthResponseSchema.safeParse(await res.json()).success;
  } catch {
    return false;
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  try {
    const parsed = ErrorBodySchema.safeParse(await res.json());
    if (parsed.success) return new ApiError(parsed.data.error.code, parsed.data.error.message);
  } catch {
    /* fall through to the generic message */
  }
  return new ApiError("HTTP_ERROR", "The assistant is unavailable right now. Please try again.");
}

/** POSTs to an AI endpoint and yields validated SSE events as they arrive. */
export async function* streamAi(
  path: AiPath,
  body: unknown,
  opts: { sessionId: string; signal?: AbortSignal }
): AsyncGenerator<StreamEvent> {
  let res: Response;
  try {
    res = await fetch(`/api/ai/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Session-Id": opts.sessionId },
      body: JSON.stringify(body),
      signal: opts.signal
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ApiError("NETWORK", "Cannot reach the assistant service. Check your connection and retry.");
  }

  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new ApiError("NO_STREAM", "The assistant did not return a stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseFrame(frame);
      if (event) yield event;
    }
  }
}
