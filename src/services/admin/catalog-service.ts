import type { z } from "zod";
import { HttpError, notFound } from "../../http.js";
import { CatalogRepository } from "../../repositories/admin/catalog-repository.js";
import type {
  catalogEntityPatchSchema,
  catalogEntitySchema,
  collectionMembershipSchema,
  collectionPatchSchema,
  collectionSchema,
  driverPatchSchema,
  driverSchema,
  teamPatchSchema,
  teamSchema,
} from "../../schemas.js";

type CatalogInput = z.infer<typeof catalogEntitySchema>;
type CatalogPatch = z.infer<typeof catalogEntityPatchSchema>;
type TeamInput = z.infer<typeof teamSchema>;
type TeamPatch = z.infer<typeof teamPatchSchema>;
type DriverInput = z.infer<typeof driverSchema>;
type DriverPatch = z.infer<typeof driverPatchSchema>;
type CollectionInput = z.infer<typeof collectionSchema>;
type CollectionPatch = z.infer<typeof collectionPatchSchema>;
type CollectionMembership = z.infer<typeof collectionMembershipSchema>;

export class CatalogService {
  private static async deleteManagedImage(url?: string | null) {
    const key = url ? CatalogRepository.storedPhotoKey(url) : null;
    if (!key) return;
    await CatalogRepository.deletePhoto(key).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.error("Could not remove image", error);
    });
  }

  static listCategories() { return CatalogRepository.listCategories(); }
  static createCategory(input: CatalogInput) { return CatalogRepository.createCategory(input); }
  static updateCategory(id: string, input: CatalogPatch) { return CatalogRepository.updateCategory(id, input); }
  static deleteCategory(id: string) { return CatalogRepository.deleteCategory(id); }

  static listTags() { return CatalogRepository.listTags(); }
  static createTag(input: CatalogInput) { return CatalogRepository.createTag(input); }
  static updateTag(id: string, input: CatalogPatch) { return CatalogRepository.updateTag(id, input); }
  static deleteTag(id: string) { return CatalogRepository.deleteTag(id); }

  static listTeams() { return CatalogRepository.listTeams(); }
  static createTeam(input: TeamInput) { return CatalogRepository.createTeam(input); }
  static updateTeam(id: string, input: TeamPatch) { return CatalogRepository.updateTeam(id, input); }
  static async deleteTeam(id: string) {
    const team = await CatalogRepository.findTeam(id);
    if (!team) notFound("Team not found");
    await CatalogRepository.deleteTeam(id);
    await CatalogService.deleteManagedImage(team.logoUrl);
  }

  static listDrivers() { return CatalogRepository.listDrivers(); }
  static createDriver(input: DriverInput) { return CatalogRepository.createDriver(input); }
  static updateDriver(id: string, input: DriverPatch) { return CatalogRepository.updateDriver(id, input); }
  static async deleteDriver(id: string) {
    const driver = await CatalogRepository.findDriver(id);
    if (!driver) notFound("Driver not found");
    await CatalogRepository.deleteDriver(id);
    await CatalogService.deleteManagedImage(driver.photoUrl);
  }

  private static async validateCollectionParent(id: string | undefined, parentId: string | null | undefined) {
    if (!parentId) return;
    if (id === parentId) throw new HttpError(400, "COLLECTION_CYCLE", "A collection cannot be its own parent");
    const hierarchy = await CatalogRepository.listCollectionHierarchy();
    const parents = new Map(hierarchy.map((collection) => [collection.id, collection.parentId]));
    if (!parents.has(parentId)) throw new HttpError(400, "UNKNOWN_COLLECTION_PARENT", "Parent collection does not exist");
    let cursor: string | null | undefined = parentId;
    while (cursor) {
      if (cursor === id) throw new HttpError(400, "COLLECTION_CYCLE", "Collection hierarchy cannot contain a cycle");
      cursor = parents.get(cursor);
    }
  }

  private static async validateCollectionRelation(
    kind: CollectionInput["kind"],
    teamId: string | null | undefined,
    driverId: string | null | undefined,
  ) {
    if (kind === "TEAM") {
      if (!teamId || driverId) {
        throw new HttpError(400, "INVALID_COLLECTION_RELATION", "Team collections require one team and no driver");
      }
      if (!await CatalogRepository.findTeam(teamId)) {
        throw new HttpError(400, "UNKNOWN_TEAM", "Related team does not exist");
      }
      return;
    }
    if (kind === "DRIVER") {
      if (!driverId || teamId) {
        throw new HttpError(400, "INVALID_COLLECTION_RELATION", "Driver collections require one driver and no team");
      }
      if (!await CatalogRepository.findDriver(driverId)) {
        throw new HttpError(400, "UNKNOWN_DRIVER", "Related driver does not exist");
      }
      return;
    }
    if (teamId || driverId) {
      throw new HttpError(400, "INVALID_COLLECTION_RELATION", "Only team or driver collections can reference catalog entities");
    }
  }

  static listCollections() { return CatalogRepository.listCollections(); }
  static async findCollection(id: string) {
    const collection = await CatalogRepository.findCollection(id);
    if (!collection) notFound("Collection not found");
    return collection;
  }
  static async createCollection(input: CollectionInput) {
    await Promise.all([
      CatalogService.validateCollectionParent(undefined, input.parentId),
      CatalogService.validateCollectionRelation(input.kind, input.teamId, input.driverId),
    ]);
    return CatalogRepository.createCollection(input);
  }
  static async updateCollection(id: string, input: CollectionPatch) {
    const current = await CatalogRepository.findCollection(id);
    if (!current) notFound("Collection not found");
    await Promise.all([
      input.parentId !== undefined ? CatalogService.validateCollectionParent(id, input.parentId) : undefined,
      CatalogService.validateCollectionRelation(
        input.kind ?? current.kind,
        input.teamId === undefined ? current.teamId : input.teamId,
        input.driverId === undefined ? current.driverId : input.driverId,
      ),
    ]);
    if (current.active && input.active === false && await CatalogRepository.countActiveProductsDependingOnCollection(id)) {
      throw new HttpError(
        409,
        "ACTIVE_COLLECTION_REQUIRED",
        "Move active products to another active collection before hiding this collection",
      );
    }
    return CatalogRepository.updateCollection(id, input);
  }
  static async deleteCollection(id: string) {
    const collection = await CatalogRepository.findCollection(id);
    if (!collection) notFound("Collection not found");
    if (collection._count.children > 0 || collection._count.products > 0) {
      throw new HttpError(409, "COLLECTION_IN_USE", "Remove child collections and product memberships before deletion");
    }
    await CatalogRepository.deleteCollection(id);
    await CatalogService.deleteManagedImage(collection.imageUrl);
  }
  static async replaceCollectionProducts(id: string, input: CollectionMembership) {
    if (!await CatalogRepository.findCollection(id)) notFound("Collection not found");
    const productIds = [...new Set(input.productIds)];
    const featuredProductIds = [...new Set(input.featuredProductIds)];
    if (await CatalogRepository.countProducts(productIds) !== productIds.length) {
      throw new HttpError(400, "UNKNOWN_PRODUCT", "Every product must exist before it can be assigned");
    }
    return CatalogRepository.replaceCollectionProducts(id, productIds, featuredProductIds);
  }
}
