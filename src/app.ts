import { mkdirSync } from "node:fs";
import cors from "cors";
import express from "express";
import adminRoutes from "./admin-routes.js";
import { config } from "./config.js";
import { SystemController } from "./controllers/system/system-controller.js";
import { errorHandler } from "./http.js";
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
    app.use("/uploads", SystemController.storedPhoto);
  }

  app.get("/health", SystemController.health);
  app.use("/api", publicRoutes);
  app.use("/api/admin", adminRoutes);
  app.use((_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);

  return app;
}
