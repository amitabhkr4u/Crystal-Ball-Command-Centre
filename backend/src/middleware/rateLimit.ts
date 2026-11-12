import rateLimit from "express-rate-limit";

/**
 * Per-session throttle for the AI endpoints (in-memory store, single process).
 * Keyed by the X-Session-Id the browser generates, falling back to IP. A client can
 * mint new session ids, so this protects the LLM bill from a runaway UI loop,
 * not from a determined attacker - production would add IP + auth based limits.
 */
export function createAiRateLimiter(opts: { windowMs: number; max: number }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.header("x-session-id")?.slice(0, 64) || req.ip || "anonymous",
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." }
      });
    }
  });
}
