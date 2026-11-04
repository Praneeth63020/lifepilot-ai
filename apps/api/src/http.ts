import type { ErrorRequestHandler, Request } from "express";
import { z, type ZodType } from "zod";
import { AppError, type CoreContext } from "@lifepilot/core";

export function parse<T extends ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError(400, "validation_error", "Request validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

export const uuidParam = z.uuid();
export function idParam(req: Request, name = "id"): string {
  const v = req.params[name];
  const r = uuidParam.safeParse(v);
  if (!r.success) throw new AppError(404, "not_found", "Not found");
  return r.data;
}

/** Consistent error body: { error: { code, message, details? } }. Internal errors never leak details. */
export function errorHandler(ctx: CoreContext): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "invalid_json", message: "Malformed JSON body" } });
      return;
    }
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "Request body too large" } });
      return;
    }
    ctx.logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } });
  };
}
