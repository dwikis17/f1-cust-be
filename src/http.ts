import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: unknown) {
    super(message);
  }
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function notFound(message = "Resource not found"): never {
  throw new HttpError(404, "NOT_FOUND", message);
}

function prismaError(error: unknown): { code: string; meta?: { target?: unknown } } | undefined {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return;
  return error as { code: string; meta?: { target?: unknown } };
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message, fields: error.fields } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: { code: "UPLOAD_ERROR", message: error.message } });
    return;
  }
  const databaseError = prismaError(error);
  if (databaseError) {
    if (databaseError.code === "P2002") {
      response.status(409).json({ error: { code: "CONFLICT", message: "A unique value is already in use", fields: databaseError.meta?.target } });
      return;
    }
    if (databaseError.code === "P2003" || databaseError.code === "P2025") {
      response.status(databaseError.code === "P2025" ? 404 : 409).json({
        error: {
          code: databaseError.code === "P2025" ? "NOT_FOUND" : "REFERENCE_CONFLICT",
          message: databaseError.code === "P2025" ? "Resource not found" : "A referenced resource is missing or still in use",
        },
      });
      return;
    }
  }
  console.error(error);
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } });
}
