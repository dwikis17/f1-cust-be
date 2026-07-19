import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { idSchema, promoCodeValueSchema } from "../../schemas.js";
import { PublicCheckoutService } from "../../services/public/checkout-service.js";

const checkoutSchema = z.object({
  idempotencyKey: idSchema,
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(25).regex(/^[+0-9][0-9 .()-]+$/),
  address: z.string().trim().min(5).max(500),
  city: z.string().trim().min(2).max(120),
  province: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().regex(/^\d{5}$/),
  items: z.array(z.object({ variantId: idSchema, quantity: z.number().int().min(1).max(9) }).strict()).min(1).max(50),
  courierCode: z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  serviceCode: z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  promoCode: promoCodeValueSchema.optional(),
}).strict();

const notificationSchema = z.object({
  order_id: idSchema,
  status_code: z.string().min(1).max(10),
  gross_amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  signature_key: z.string().min(1).max(256),
  merchant_id: z.string().min(1).max(100),
  transaction_status: z.string().min(1).max(40),
  fraud_status: z.string().max(40).optional(),
  transaction_id: z.string().max(100).optional(),
  payment_type: z.string().max(80).optional(),
}).passthrough();

const trackingLookupSchema = z.object({
  orderNumber: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  email: z.string().trim().email().max(254),
}).strict();

export class PublicCheckoutController {
  static async create(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.status(201).json(await PublicCheckoutService.create(parse(checkoutSchema, request.body)));
  }

  static async find(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await PublicCheckoutService.find(parse(idSchema, String(request.params.id))));
  }

  static async track(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await PublicCheckoutService.track(parse(trackingLookupSchema, request.body)));
  }

  static async midtransNotification(request: Request, response: Response) {
    response.json(await PublicCheckoutService.notification(parse(notificationSchema, request.body)));
  }
}
