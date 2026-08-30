import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../http.js";
import { localeSchema } from "../schemas.js";
import { StorefrontContentService } from "../services/storefront-content-service.js";
import { storefrontContentSchema } from "../storefront-content.js";
import { revalidateStorefrontNow } from "../storefront-revalidation.js";

const localizedQuerySchema = z.object({ locale: localeSchema.default("en") }).strict();
const contentTags = ["content:shipping-returns:en", "content:shipping-returns:id", "content:support"];

export class StorefrontContentController {
  static async findAdmin(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await StorefrontContentService.findAdmin());
    } catch (error) {
      next(error);
    }
  }

  static async replace(request: Request, response: Response, next: NextFunction) {
    try {
      const content = await StorefrontContentService.replace(parse(storefrontContentSchema, request.body));
      await revalidateStorefrontNow(contentTags);
      response.json(content);
    } catch (error) {
      next(error);
    }
  }

  static async findShippingReturns(request: Request, response: Response, next: NextFunction) {
    try {
      const { locale } = parse(localizedQuerySchema, request.query);
      response.json(await StorefrontContentService.findShippingReturns(locale));
    } catch (error) {
      next(error);
    }
  }

  static async findSupport(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await StorefrontContentService.findSupport());
    } catch (error) {
      next(error);
    }
  }
}
