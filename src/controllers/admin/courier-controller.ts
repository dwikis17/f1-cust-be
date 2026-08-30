import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { CourierService } from "../../services/admin/courier-service.js";
import { revalidateStorefrontNow } from "../../storefront-revalidation.js";

const courierCodeSchema = z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9_]+$/);
const courierUpdateSchema = z.object({ active: z.boolean() }).strict();
const freeShippingRuleSchema = z.object({
  active: z.boolean(),
  minimumPurchaseIdr: z.number().int().positive().max(2_000_000_000),
  maxCoverageIdr: z.number().int().positive().max(2_000_000_000),
}).strict();

export class CourierController {
  static async list(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CourierService.list());
    } catch (error) {
      next(error);
    }
  }

  static async update(request: Request, response: Response, next: NextFunction) {
    try {
      const code = parse(courierCodeSchema, request.params.code);
      const { active } = parse(courierUpdateSchema, request.body);
      response.json(await CourierService.setActive(code, active));
    } catch (error) {
      next(error);
    }
  }

  static async updateFreeShippingRule(request: Request, response: Response, next: NextFunction) {
    try {
      const rule = await CourierService.updateFreeShippingRule(parse(freeShippingRuleSchema, request.body));
      await revalidateStorefrontNow(["shipping:free-shipping-policy"]);
      response.json(rule);
    } catch (error) {
      next(error);
    }
  }
}
