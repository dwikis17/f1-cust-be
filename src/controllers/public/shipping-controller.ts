import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { idSchema } from "../../schemas.js";
import { PublicShippingService } from "../../services/public/shipping-service.js";

const shippingRatesSchema = z.object({
  destinationPostalCode: z.string().trim().regex(/^\d{5}$/, "Postal code must contain exactly 5 digits"),
  items: z.array(z.object({
    variantId: idSchema,
    quantity: z.number().int().min(1).max(9),
  }).strict()).min(1).max(50),
}).strict();

export class PublicShippingController {
  static async rates(request: Request, response: Response) {
    const input = parse(shippingRatesSchema, request.body);
    response.set("cache-control", "no-store");
    response.json(await PublicShippingService.rates(input));
  }
}
