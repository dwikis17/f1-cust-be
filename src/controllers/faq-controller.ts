import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../http.js";
import { faqPatchSchema, faqSchema, idSchema, localeSchema } from "../schemas.js";
import { FaqService } from "../services/faq-service.js";
import { revalidateStorefront } from "../storefront-revalidation.js";

const publicQuerySchema = z.object({ locale: localeSchema.default("en") }).strict();

export class FaqController {
  static async listPublic(request: Request, response: Response, next: NextFunction) {
    try {
      const { locale } = parse(publicQuerySchema, request.query);
      response.json(await FaqService.listPublic(locale));
    } catch (error) {
      next(error);
    }
  }

  static async list(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await FaqService.list());
    } catch (error) {
      next(error);
    }
  }

  static async create(request: Request, response: Response, next: NextFunction) {
    try {
      const faq = await FaqService.create(parse(faqSchema, request.body));
      revalidateStorefront(["content:faqs:en", "content:faqs:id"]);
      response.status(201).json(faq);
    } catch (error) {
      next(error);
    }
  }

  static async update(request: Request, response: Response, next: NextFunction) {
    try {
      const faq = await FaqService.update(
        parse(idSchema, request.params.id),
        parse(faqPatchSchema, request.body),
      );
      revalidateStorefront(["content:faqs:en", "content:faqs:id"]);
      response.json(faq);
    } catch (error) {
      next(error);
    }
  }

  static async remove(request: Request, response: Response, next: NextFunction) {
    try {
      await FaqService.remove(parse(idSchema, request.params.id));
      revalidateStorefront(["content:faqs:en", "content:faqs:id"]);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}
