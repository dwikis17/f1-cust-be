import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError, parse } from "../../http.js";
import { OrderService } from "../../services/admin/order-service.js";

const statusWebhookSchema = z.object({
  event: z.literal("order.status"),
  order_id: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(80),
  courier_tracking_id: z.string().trim().min(1).max(200).nullish(),
  courier_waybill_id: z.string().trim().min(1).max(200).nullish(),
}).passthrough();

function secureEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function verifyAuthorization(request: Request) {
  if (!config.biteshipWebhookSecret) {
    throw new HttpError(503, "BITESHIP_WEBHOOK_NOT_CONFIGURED", "Biteship webhook authentication is not configured");
  }
  const authorization = request.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !secureEqual(token, config.biteshipWebhookSecret)) {
    throw new HttpError(401, "INVALID_BITESHIP_WEBHOOK", "Biteship webhook authentication failed");
  }
}

export class BiteshipWebhookController {
  static async status(request: Request, response: Response, next: NextFunction) {
    try {
      const body = request.body as unknown;
      const emptyBody = body == null
        || (typeof body === "object" && !Array.isArray(body) && Object.keys(body as object).length === 0);
      if (emptyBody) {
        response.type("text/plain").send("ok");
        return;
      }
      verifyAuthorization(request);
      const input = parse(statusWebhookSchema, body);
      const matched = await OrderService.applyBiteshipStatus({
        providerOrderId: input.order_id,
        status: input.status,
        trackingId: input.courier_tracking_id,
        waybillId: input.courier_waybill_id,
      });
      response.json({ received: true, matched });
    } catch (error) {
      next(error);
    }
  }
}
