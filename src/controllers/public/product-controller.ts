import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { PublicProductService } from "../../services/public/product-service.js";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(100).optional(),
  team: z.string().trim().max(100).optional(),
  driver: z.string().trim().max(100).optional(),
  size: z.string().trim().max(40).optional(),
  color: z.string().trim().max(60).optional(),
}).strict();

export class PublicProductController {
  static async listProducts(request: Request, response: Response) {
    const { page, limit, ...filters } = parse(listQuerySchema, request.query);
    response.json(await PublicProductService.listProducts(filters, page, limit));
  }
  static async findProduct(request: Request, response: Response) {
    response.json(await PublicProductService.findProduct(String(request.params.slug)));
  }
}
