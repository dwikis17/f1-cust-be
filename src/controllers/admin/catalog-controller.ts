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
import { revalidateStorefront } from "../../storefront-revalidation.js";

export class CatalogController {
  static async listCategories(_request: Request, response: Response) {
    response.json(await CatalogService.listCategories());
  }
  static async createCategory(request: Request, response: Response) {
    const value = await CatalogService.createCategory(parse(catalogEntitySchema, request.body)); revalidateStorefront(["catalog:products"]); response.status(201).json(value);
  }
  static async updateCategory(request: Request, response: Response) {
    const value = await CatalogService.updateCategory(parse(idSchema, request.params.id), parse(catalogEntityPatchSchema, request.body)); revalidateStorefront(["catalog:products"]); response.json(value);
  }
  static async deleteCategory(request: Request, response: Response) {
    await CatalogService.deleteCategory(parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:products"]);
    response.status(204).send();
  }

  static async listTags(_request: Request, response: Response) {
    response.json(await CatalogService.listTags());
  }
  static async createTag(request: Request, response: Response) {
    const value = await CatalogService.createTag(parse(catalogEntitySchema, request.body)); revalidateStorefront(["catalog:products"]); response.status(201).json(value);
  }
  static async updateTag(request: Request, response: Response) {
    const value = await CatalogService.updateTag(parse(idSchema, request.params.id), parse(catalogEntityPatchSchema, request.body)); revalidateStorefront(["catalog:products"]); response.json(value);
  }
  static async deleteTag(request: Request, response: Response) {
    await CatalogService.deleteTag(parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:products"]);
    response.status(204).send();
  }

  static async listTeams(_request: Request, response: Response) {
    response.json(await CatalogService.listTeams());
  }
  static async createTeam(request: Request, response: Response) {
    const value = await CatalogService.createTeam(parse(teamSchema, request.body)); revalidateStorefront(["catalog:teams", "catalog:products"]); response.status(201).json(value);
  }
  static async updateTeam(request: Request, response: Response) {
    const value = await CatalogService.updateTeam(parse(idSchema, request.params.id), parse(teamPatchSchema, request.body)); revalidateStorefront(["catalog:teams", "catalog:products"]); response.json(value);
  }
  static async deleteTeam(request: Request, response: Response) {
    await CatalogService.deleteTeam(parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:teams", "catalog:products"]);
    response.status(204).send();
  }

  static async listDrivers(_request: Request, response: Response) {
    response.json(await CatalogService.listDrivers());
  }
  static async createDriver(request: Request, response: Response) {
    const value = await CatalogService.createDriver(parse(driverSchema, request.body)); revalidateStorefront(["catalog:products"]); response.status(201).json(value);
  }
  static async updateDriver(request: Request, response: Response) {
    const value = await CatalogService.updateDriver(parse(idSchema, request.params.id), parse(driverPatchSchema, request.body)); revalidateStorefront(["catalog:products"]); response.json(value);
  }
  static async deleteDriver(request: Request, response: Response) {
    await CatalogService.deleteDriver(parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:products"]);
    response.status(204).send();
  }

  static async listCollections(_request: Request, response: Response) {
    response.json(await CatalogService.listCollections());
  }
  static async findCollection(request: Request, response: Response) {
    response.json(await CatalogService.findCollection(parse(idSchema, request.params.id)));
  }
  static async createCollection(request: Request, response: Response) {
    const value = await CatalogService.createCollection(parse(collectionSchema, request.body)); revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${value.slug}`]); response.status(201).json(value);
  }
  static async updateCollection(request: Request, response: Response) {
    const id = parse(idSchema, request.params.id);
    const previous = await CatalogService.findCollection(id);
    const value = await CatalogService.updateCollection(
      id,
      parse(collectionPatchSchema, request.body),
    );
    revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${previous.slug}`, `catalog:collection:${value.slug}`]);
    response.json(value);
  }
  static async deleteCollection(request: Request, response: Response) {
    const id = parse(idSchema, request.params.id);
    const previous = await CatalogService.findCollection(id);
    await CatalogService.deleteCollection(id);
    revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${previous.slug}`]);
    response.status(204).send();
  }
  static async replaceCollectionProducts(request: Request, response: Response) {
    const id = parse(idSchema, request.params.id);
    const value = await CatalogService.replaceCollectionProducts(
      id,
      parse(collectionMembershipSchema, request.body),
    );
    const collection = await CatalogService.findCollection(id);
    revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${collection.slug}`]);
    response.json(value);
  }
}
