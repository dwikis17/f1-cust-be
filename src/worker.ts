import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app.js";
import { createPrisma, runWithPrisma } from "./db.js";
import { runWithEmailSender } from "./email-service.js";
import { photoPrefixForRequest, runWithPhotoBucket } from "./photo-storage.js";
import { runWithExecutionContext, waitForBackgroundTasks } from "./background.js";
import { PublicCheckoutService } from "./services/public/checkout-service.js";
import { revalidateStorefront } from "./storefront-revalidation.js";
import { reconcilePendingTelegramNotifications } from "./telegram-service.js";

const port = 3000;
const app = createApp({ localUploads: false });
app.listen(port);

const expressHandler = httpServerHandler({ port });

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const prisma = createPrisma(env.HYPERDRIVE.connectionString);
    const hostname = new URL(request.url).hostname;
    const photoPrefix = photoPrefixForRequest(hostname, env.APP_ENV);
    let backgroundTasks: Promise<unknown> | undefined;
    try {
      const response = await runWithExecutionContext(ctx, async () => {
        try {
          return await runWithEmailSender(env.EMAIL, () => runWithPhotoBucket(
            env.PHOTO_BUCKET,
            photoPrefix,
            env.PHOTO_PUBLIC_BASE_URL,
            () => runWithPrisma(prisma, async () => {
              if (!expressHandler.fetch) throw new Error("Express Worker handler is unavailable");
              return expressHandler.fetch.call(expressHandler, request, env, ctx);
            }),
          ));
        } finally {
          backgroundTasks = waitForBackgroundTasks();
        }
      });
      ctx.waitUntil((backgroundTasks ?? Promise.resolve()).finally(() => prisma.$disconnect()));
      return response;
    } catch (error) {
      if (backgroundTasks) ctx.waitUntil(backgroundTasks.finally(() => prisma.$disconnect()));
      else await prisma.$disconnect();
      throw error;
    }
  },
  async scheduled(controller, env, ctx): Promise<void> {
    const prisma = createPrisma(env.HYPERDRIVE.connectionString);
    let backgroundTasks: Promise<unknown> | undefined;
    try {
      await runWithExecutionContext(ctx, async () => {
        try {
          await runWithEmailSender(env.EMAIL, () => runWithPrisma(prisma, async () => {
            switch (controller.cron) {
              case "0 */3 * * *":
                await reconcilePendingTelegramNotifications();
                return;
              case "0 * * * *": {
                const result = await PublicCheckoutService.reconcilePendingPayments();
                console.log(JSON.stringify({ message: "payment expiry reconciliation completed", cron: controller.cron, ...result }));
                if (result.catalogChanged) revalidateStorefront(["catalog:products"]);
                return;
              }
              default:
                console.warn(JSON.stringify({ message: "unknown cron trigger ignored", cron: controller.cron }));
                return;
            }
          }));
        } finally {
          backgroundTasks = waitForBackgroundTasks();
        }
      });
      ctx.waitUntil((backgroundTasks ?? Promise.resolve()).finally(() => prisma.$disconnect()));
    } catch (error) {
      if (backgroundTasks) ctx.waitUntil(backgroundTasks.finally(() => prisma.$disconnect()));
      else await prisma.$disconnect();
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
