import type { NextFunction, Request, Response } from "express";
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
  static async listCategories(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CatalogService.listCategories());
    } catch (error) {
      next(error);
    }
  }
  static async createCategory(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.createCategory(parse(catalogEntitySchema, request.body)); revalidateStorefront(["catalog:products"]); response.status(201).json(value);
    } catch (error) {
      next(error);
    }
  }
  static async updateCategory(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.updateCategory(parse(idSchema, request.params.id), parse(catalogEntityPatchSchema, request.body)); revalidateStorefront(["catalog:products"]); response.json(value);
    } catch (error) {
      next(error);
    }
  }
  static async deleteCategory(request: Request, response: Response, next: NextFunction) {
    try {
      await CatalogService.deleteCategory(parse(idSchema, request.params.id));
      revalidateStorefront(["catalog:products"]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static async listTags(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CatalogService.listTags());
    } catch (error) {
      next(error);
    }
  }
  static async createTag(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.createTag(parse(catalogEntitySchema, request.body)); revalidateStorefront(["catalog:products"]); response.status(201).json(value);
    } catch (error) {
      next(error);
    }
  }
  static async updateTag(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.updateTag(parse(idSchema, request.params.id), parse(catalogEntityPatchSchema, request.body)); revalidateStorefront(["catalog:products"]); response.json(value);
    } catch (error) {
      next(error);
    }
  }
  static async deleteTag(request: Request, response: Response, next: NextFunction) {
    try {
      await CatalogService.deleteTag(parse(idSchema, request.params.id));
      revalidateStorefront(["catalog:products"]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static async listTeams(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CatalogService.listTeams());
    } catch (error) {
      next(error);
    }
  }
  static async createTeam(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.createTeam(parse(teamSchema, request.body)); revalidateStorefront(["catalog:teams", "catalog:products"]); response.status(201).json(value);
    } catch (error) {
      next(error);
    }
  }
  static async updateTeam(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.updateTeam(parse(idSchema, request.params.id), parse(teamPatchSchema, request.body)); revalidateStorefront(["catalog:teams", "catalog:products"]); response.json(value);
    } catch (error) {
      next(error);
    }
  }
  static async deleteTeam(request: Request, response: Response, next: NextFunction) {
    try {
      await CatalogService.deleteTeam(parse(idSchema, request.params.id));
      revalidateStorefront(["catalog:teams", "catalog:products"]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static async listDrivers(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CatalogService.listDrivers());
    } catch (error) {
      next(error);
    }
  }
  static async createDriver(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.createDriver(parse(driverSchema, request.body)); revalidateStorefront(["catalog:products"]); response.status(201).json(value);
    } catch (error) {
      next(error);
    }
  }
  static async updateDriver(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.updateDriver(parse(idSchema, request.params.id), parse(driverPatchSchema, request.body)); revalidateStorefront(["catalog:products"]); response.json(value);
    } catch (error) {
      next(error);
    }
  }
  static async deleteDriver(request: Request, response: Response, next: NextFunction) {
    try {
      await CatalogService.deleteDriver(parse(idSchema, request.params.id));
      revalidateStorefront(["catalog:products"]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static async listCollections(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CatalogService.listCollections());
    } catch (error) {
      next(error);
    }
  }
  static async findCollection(request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CatalogService.findCollection(parse(idSchema, request.params.id)));
    } catch (error) {
      next(error);
    }
  }
  static async createCollection(request: Request, response: Response, next: NextFunction) {
    try {
      const value = await CatalogService.createCollection(parse(collectionSchema, request.body)); revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${value.slug}`]); response.status(201).json(value);
    } catch (error) {
      next(error);
    }
  }
  static async updateCollection(request: Request, response: Response, next: NextFunction) {
    try {
      const id = parse(idSchema, request.params.id);
      const previous = await CatalogService.findCollection(id);
      const value = await CatalogService.updateCollection(
        id,
        parse(collectionPatchSchema, request.body),
      );
      revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${previous.slug}`, `catalog:collection:${value.slug}`]);
      response.json(value);
    } catch (error) {
      next(error);
    }
  }
  static async deleteCollection(request: Request, response: Response, next: NextFunction) {
    try {
      const id = parse(idSchema, request.params.id);
      const previous = await CatalogService.findCollection(id);
      await CatalogService.deleteCollection(id);
      revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${previous.slug}`]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }
  static async replaceCollectionProducts(request: Request, response: Response, next: NextFunction) {
    try {
      const id = parse(idSchema, request.params.id);
      const value = await CatalogService.replaceCollectionProducts(
        id,
        parse(collectionMembershipSchema, request.body),
      );
      const collection = await CatalogService.findCollection(id);
      revalidateStorefront(["catalog:collections", "catalog:products", `catalog:collection:${collection.slug}`]);
      response.json(value);
    } catch (error) {
      next(error);
    }
  }
}
