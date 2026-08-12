import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { notFound, parse } from "../../http.js";
import { localeSchema, slugSchema } from "../../schemas.js";
import { PublicCatalogService } from "../../services/public/catalog-service.js";

const driverQuerySchema = z.object({ team: slugSchema.optional() }).strict();
const localeQuerySchema = z.object({ locale: localeSchema.default("en") }).strict();

export class PublicCatalogController {
  static async listCategories(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await PublicCatalogService.listCategories());
    } catch (error) {
      next(error);
    }
  }
  static async listTags(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await PublicCatalogService.listTags());
    } catch (error) {
      next(error);
    }
  }
  static async listTeams(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await PublicCatalogService.listTeams());
    } catch (error) {
      next(error);
    }
  }
  static async listDrivers(request: Request, response: Response, next: NextFunction) {
    try {
      const query = parse(driverQuerySchema, request.query);
      response.json(await PublicCatalogService.listDrivers(query.team));
    } catch (error) {
      next(error);
    }
  }
  static async listCollections(request: Request, response: Response, next: NextFunction) {
    try {
      const query = parse(localeQuerySchema, request.query);
      response.json(await PublicCatalogService.listCollections(query.locale));
    } catch (error) {
      next(error);
    }
  }
  static async findCollection(request: Request, response: Response, next: NextFunction) {
    try {
      const query = parse(localeQuerySchema, request.query);
      const collection = await PublicCatalogService.findCollection(String(request.params.slug), query.locale);
      if (!collection) notFound("Collection not found");
      response.json(collection);
    } catch (error) {
      next(error);
    }
  }
}
