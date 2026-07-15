import type { Request, Response } from "express";
import { SystemService } from "../../services/system/system-service.js";

export class SystemController {
  static async health(_request: Request, response: Response) {
    response.json(await SystemService.healthCheck());
  }

  static async storedPhoto(request: Request, response: Response) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.status(405).set("allow", "GET, HEAD").send();
      return;
    }
    const key = request.path.replace(/^\/+/, "");
    if (!key || key.includes("..") || key.includes("\\")) {
      response.status(400).json({ error: { code: "INVALID_PATH", message: "Invalid photo path" } });
      return;
    }
    const photo = await SystemService.readPhoto(key);
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
  }
}
