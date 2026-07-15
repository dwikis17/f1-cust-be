import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app.js";
import { createPrisma, runWithPrisma } from "./db.js";
import { runWithPhotoBucket } from "./photo-storage.js";

const port = 3000;
const app = createApp({ localUploads: false });
app.listen(port);

const expressHandler = httpServerHandler({ port });

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const prisma = createPrisma(env.HYPERDRIVE.connectionString);
    const hostname = new URL(request.url).hostname;
    const photoPrefix = hostname === "localhost" || hostname === "127.0.0.1" ? "development/" : "production/";
    try {
      return await runWithPhotoBucket(env.PHOTO_BUCKET, photoPrefix, () =>
        runWithPrisma(prisma, async () => {
          if (!expressHandler.fetch) throw new Error("Express Worker handler is unavailable");
          return expressHandler.fetch.call(expressHandler, request, env, ctx);
        }),
      );
    } finally {
      await prisma.$disconnect();
    }
  },
} satisfies ExportedHandler<Env>;
