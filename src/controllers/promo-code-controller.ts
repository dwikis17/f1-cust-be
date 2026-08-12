import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../http.js";
import {
  idSchema,
  promoCodePatchSchema,
  promoCodeSchema,
  promoCodeValueSchema,
} from "../schemas.js";
import { PromoCodeService } from "../services/promo-code-service.js";

const cartItemsSchema = z.array(z.object({
  variantId: idSchema,
  quantity: z.number().int().min(1).max(9),
}).strict()).min(1).max(50);
const previewSchema = z.object({ code: promoCodeValueSchema, items: cartItemsSchema }).strict();
const usageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export class PromoCodeController {
  static async preview(request: Request, response: Response, next: NextFunction) {
    try {
      response.set("cache-control", "no-store");
      const input = parse(previewSchema, request.body);
      response.json(await PromoCodeService.preview(input.code, input.items));
    } catch (error) {
      next(error);
    }
  }

  static async list(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await PromoCodeService.list());
    } catch (error) {
      next(error);
    }
  }

  static async create(request: Request, response: Response, next: NextFunction) {
    try {
      response.status(201).json(await PromoCodeService.create(parse(promoCodeSchema, request.body)));
    } catch (error) {
      next(error);
    }
  }

  static async update(request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await PromoCodeService.update(
        parse(idSchema, request.params.id),
        parse(promoCodePatchSchema, request.body),
      ));
    } catch (error) {
      next(error);
    }
  }

  static async usages(request: Request, response: Response, next: NextFunction) {
    try {
      const query = parse(usageQuerySchema, request.query);
      response.json(await PromoCodeService.usages(parse(idSchema, request.params.id), query.page, query.limit));
    } catch (error) {
      next(error);
    }
  }
}
