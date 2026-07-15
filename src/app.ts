import { mkdirSync } from "node:fs";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler } from "./http.js";
import { readStoredPhoto } from "./photo-storage.js";
import adminRoutes from "./admin-routes.js";
import publicRoutes from "./public-routes.js";

type AppOptions = {
  localUploads?: boolean;
};

export function createApp({ localUploads = true }: AppOptions = {}) {
  if (localUploads) mkdirSync(config.uploadDir, { recursive: true });

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || config.corsOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: "1mb" }));

  if (localUploads) {
    app.use("/uploads", express.static(config.uploadDir, { dotfiles: "deny", fallthrough: false, index: false }));
  } else {
    app.use("/uploads", async (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.status(405).set("allow", "GET, HEAD").send();
        return;
      }
      const key = request.path.replace(/^\/+/, "");
      if (!key || key.includes("..") || key.includes("\\")) {
        response.status(400).json({ error: { code: "INVALID_PATH", message: "Invalid photo path" } });
        return;
      }
      const photo = await readStoredPhoto(key);
      if (!photo) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: "Photo not found" } });
        return;
      }
      response.set({
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(photo.body.byteLength),
        "content-type": photo.contentType,
        ...(photo.etag && { etag: photo.etag }),
      });
      response.status(200).send(request.method === "HEAD" ? undefined : Buffer.from(photo.body));
    });
  }

  app.get("/health", async (_request, response) => {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: "ok" });
  });
  app.use("/api", publicRoutes);
  app.use("/api/admin", adminRoutes);
  app.use((_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);

  return app;
}
