import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { slugSchema } from "../../schemas.js";
import { PublicCatalogService } from "../../services/public/catalog-service.js";

const driverQuerySchema = z.object({ team: slugSchema.optional() }).strict();

export class PublicCatalogController {
  static async listCategories(_request: Request, response: Response) {
    response.json(await PublicCatalogService.listCategories());
  }
  static async listTags(_request: Request, response: Response) {
    response.json(await PublicCatalogService.listTags());
  }
  static async listTeams(_request: Request, response: Response) {
    response.json(await PublicCatalogService.listTeams());
  }
  static async listDrivers(request: Request, response: Response) {
    const query = parse(driverQuerySchema, request.query);
    response.json(await PublicCatalogService.listDrivers(query.team));
  }
}
