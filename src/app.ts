import { mkdirSync } from "node:fs";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler } from "./http.js";
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
    app.use("/api/admin/products/:productId/photos", (_request, response) => {
      response.status(501).json({ error: { code: "PHOTO_STORAGE_UNAVAILABLE", message: "Photo storage requires R2" } });
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
