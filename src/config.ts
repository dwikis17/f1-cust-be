import path from "node:path";
import { z } from "zod";

const env = z.object({
  DATABASE_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("uploads"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_242_880),
  MAX_PHOTOS_PER_PRODUCT: z.coerce.number().int().positive().default(12),
}).parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  uploadDir: path.resolve(env.UPLOAD_DIR),
  sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
  maxPhotosPerProduct: env.MAX_PHOTOS_PER_PRODUCT,
};

export function requireDatabaseUrl() {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required outside the Cloudflare Worker runtime");
  return config.databaseUrl;
}
