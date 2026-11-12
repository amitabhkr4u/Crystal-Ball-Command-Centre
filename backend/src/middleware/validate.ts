import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

/** Validates req.body against a Zod schema before the handler runs; replaces it with the parsed value. */
export const validate =
  (schema: ZodTypeAny): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body failed validation.",
          details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
        }
      });
      return;
    }
    req.body = result.data;
    next();
  };
