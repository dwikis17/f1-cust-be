import type { Request, Response } from "express";
import { parse } from "../../http.js";
import {
  catalogEntityPatchSchema,
  catalogEntitySchema,
  collectionMembershipSchema,
  collectionPatchSchema,
  collectionSchema,
  driverPatchSchema,
  driverSchema,
  idSchema,
  teamPatchSchema,
  teamSchema,
} from "../../schemas.js";
import { CatalogService } from "../../services/admin/catalog-service.js";

export class CatalogController {
  static async listCategories(_request: Request, response: Response) {
    response.json(await CatalogService.listCategories());
  }
  static async createCategory(request: Request, response: Response) {
    response.status(201).json(await CatalogService.createCategory(parse(catalogEntitySchema, request.body)));
  }
  static async updateCategory(request: Request, response: Response) {
    response.json(await CatalogService.updateCategory(parse(idSchema, request.params.id), parse(catalogEntityPatchSchema, request.body)));
  }
  static async deleteCategory(request: Request, response: Response) {
    await CatalogService.deleteCategory(parse(idSchema, request.params.id));
    response.status(204).send();
  }

  static async listTags(_request: Request, response: Response) {
    response.json(await CatalogService.listTags());
  }
  static async createTag(request: Request, response: Response) {
    response.status(201).json(await CatalogService.createTag(parse(catalogEntitySchema, request.body)));
  }
  static async updateTag(request: Request, response: Response) {
    response.json(await CatalogService.updateTag(parse(idSchema, request.params.id), parse(catalogEntityPatchSchema, request.body)));
  }
  static async deleteTag(request: Request, response: Response) {
    await CatalogService.deleteTag(parse(idSchema, request.params.id));
    response.status(204).send();
  }

  static async listTeams(_request: Request, response: Response) {
    response.json(await CatalogService.listTeams());
  }
  static async createTeam(request: Request, response: Response) {
    response.status(201).json(await CatalogService.createTeam(parse(teamSchema, request.body)));
  }
  static async updateTeam(request: Request, response: Response) {
    response.json(await CatalogService.updateTeam(parse(idSchema, request.params.id), parse(teamPatchSchema, request.body)));
  }
  static async deleteTeam(request: Request, response: Response) {
    await CatalogService.deleteTeam(parse(idSchema, request.params.id));
    response.status(204).send();
  }

  static async listDrivers(_request: Request, response: Response) {
    response.json(await CatalogService.listDrivers());
  }
  static async createDriver(request: Request, response: Response) {
    response.status(201).json(await CatalogService.createDriver(parse(driverSchema, request.body)));
  }
  static async updateDriver(request: Request, response: Response) {
    response.json(await CatalogService.updateDriver(parse(idSchema, request.params.id), parse(driverPatchSchema, request.body)));
  }
  static async deleteDriver(request: Request, response: Response) {
    await CatalogService.deleteDriver(parse(idSchema, request.params.id));
    response.status(204).send();
  }

  static async listCollections(_request: Request, response: Response) {
    response.json(await CatalogService.listCollections());
  }
  static async findCollection(request: Request, response: Response) {
    response.json(await CatalogService.findCollection(parse(idSchema, request.params.id)));
  }
  static async createCollection(request: Request, response: Response) {
    response.status(201).json(await CatalogService.createCollection(parse(collectionSchema, request.body)));
  }
  static async updateCollection(request: Request, response: Response) {
    response.json(await CatalogService.updateCollection(
      parse(idSchema, request.params.id),
      parse(collectionPatchSchema, request.body),
    ));
  }
  static async deleteCollection(request: Request, response: Response) {
    await CatalogService.deleteCollection(parse(idSchema, request.params.id));
    response.status(204).send();
  }
  static async replaceCollectionProducts(request: Request, response: Response) {
    response.json(await CatalogService.replaceCollectionProducts(
      parse(idSchema, request.params.id),
      parse(collectionMembershipSchema, request.body),
    ));
  }
}
