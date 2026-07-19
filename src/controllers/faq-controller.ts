import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../http.js";
import { faqPatchSchema, faqSchema, idSchema, localeSchema } from "../schemas.js";
import { FaqService } from "../services/faq-service.js";

const publicQuerySchema = z.object({ locale: localeSchema.default("en") }).strict();

export class FaqController {
  static async listPublic(request: Request, response: Response) {
    const { locale } = parse(publicQuerySchema, request.query);
    response.json(await FaqService.listPublic(locale));
  }

  static async list(_request: Request, response: Response) {
    response.json(await FaqService.list());
  }

  static async create(request: Request, response: Response) {
    response.status(201).json(await FaqService.create(parse(faqSchema, request.body)));
  }

  static async update(request: Request, response: Response) {
    response.json(await FaqService.update(
      parse(idSchema, request.params.id),
      parse(faqPatchSchema, request.body),
    ));
  }

  static async remove(request: Request, response: Response) {
    await FaqService.remove(parse(idSchema, request.params.id));
    response.status(204).end();
  }
}
