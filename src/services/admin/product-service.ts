import type { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../http.js";
import { CatalogRepository } from "../../repositories/admin/catalog-repository.js";
import {
  ProductRepository,
  type ProductWithRelations,
} from "../../repositories/admin/product-repository.js";
import type {
  productPatchSchema,
  productSchema,
  variantPatchSchema,
  variantSchema,
} from "../../schemas.js";

type ProductInput = z.infer<typeof productSchema>;
type ProductPatch = z.infer<typeof productPatchSchema>;
type VariantInput = z.infer<typeof variantSchema>;
type VariantPatch = z.infer<typeof variantPatchSchema>;

const unique = (ids: string[] | undefined) => ids === undefined ? undefined : [...new Set(ids)];

export class ProductService {
  private static response(product: ProductWithRelations) {
    const { drivers, collections, ...value } = product;
    return {
      ...value,
      driverIds: drivers.map(({ driverId }) => driverId),
      drivers: drivers.map(({ driver }) => driver),
      collectionIds: collections.map(({ collectionId }) => collectionId),
      collections: collections.map(({ collection }) => collection),
    };
  }

  private static async validateReferences(input: {
    categoryId?: string;
    teamId?: string | null;
    driverIds?: string[];
    collectionIds?: string[];
    tagIds?: string[];
  }) {
    const driverIds = unique(input.driverIds) ?? [];
    const collectionIds = unique(input.collectionIds) ?? [];
    const tagIds = unique(input.tagIds) ?? [];
    const [categories, teams, drivers, collections, tags] = await Promise.all([
      input.categoryId ? CatalogRepository.countCategories([input.categoryId]) : Promise.resolve(1),
      input.teamId ? CatalogRepository.countTeams([input.teamId]) : Promise.resolve(1),
      CatalogRepository.countDrivers(driverIds),
      CatalogRepository.countCollections(collectionIds),
      CatalogRepository.countTags(tagIds),
    ]);
    if (categories !== 1) throw new HttpError(400, "UNKNOWN_PRODUCT_TYPE", "Product type does not exist");
    if (teams !== 1) throw new HttpError(400, "UNKNOWN_TEAM", "Team does not exist");
    if (drivers !== driverIds.length) throw new HttpError(400, "UNKNOWN_DRIVER", "Every driver must exist before assignment");
    if (collections !== collectionIds.length) {
      throw new HttpError(400, "UNKNOWN_COLLECTION", "Every collection must exist before assignment");
    }
    if (tags !== tagIds.length) throw new HttpError(400, "UNKNOWN_TAG", "Every tag must exist before assignment");
  }

  private static async validateActivation(
    status: "DRAFT" | "ACTIVE" | "ARCHIVED",
    audience: "MEN" | "WOMEN" | "KIDS" | "UNISEX" | null | undefined,
    collectionIds: string[],
    variantCount: number,
  ) {
    if (status !== "ACTIVE") return;
    if (!audience) throw new HttpError(400, "AUDIENCE_REQUIRED", "Active products require an audience");
    if (variantCount === 0) throw new HttpError(400, "VARIANT_REQUIRED", "Active products require a purchasable variant");
    if (collectionIds.length === 0 || await CatalogRepository.countActiveCollections(collectionIds) === 0) {
      throw new HttpError(400, "ACTIVE_COLLECTION_REQUIRED", "Active products require at least one active collection");
    }
  }

  static async listProducts() {
    return (await ProductRepository.listProducts()).map(ProductService.response);
  }
  static async findProduct(id: string) {
    const product = await ProductRepository.findProduct(id);
    if (!product) notFound("Product not found");
    return ProductService.response(product);
  }
  static async createProduct(input: ProductInput) {
    const driverIds = unique(input.driverIds) ?? [];
    const collectionIds = unique(input.collectionIds) ?? [];
    const tagIds = unique(input.tagIds) ?? [];
    await ProductService.validateReferences({ ...input, driverIds, collectionIds, tagIds });
    await ProductService.validateActivation(input.status, input.audience, collectionIds, input.variants.length);
    const { driverIds: _driverIds, collectionIds: _collectionIds, tagIds: _tagIds, variants, ...product } = input;
    const created = await ProductRepository.createProduct({
      ...product,
      tags: { create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) },
      drivers: { create: driverIds.map((driverId) => ({ driver: { connect: { id: driverId } } })) },
      collections: {
        create: collectionIds.map((collectionId) => ({ collection: { connect: { id: collectionId } } })),
      },
      variants: {
        create: variants.map((variant) => ({
          ...variant,
          sizingGuide: variant.sizingGuide ?? Prisma.JsonNull,
        })),
      },
    });
    return ProductService.response(created);
  }
  static async updateProduct(id: string, input: ProductPatch) {
    const current = await ProductRepository.findProduct(id);
    if (!current) notFound("Product not found");
    const tagIds = unique(input.tagIds);
    const driverIds = unique(input.driverIds);
    const collectionIds = unique(input.collectionIds);
    await ProductService.validateReferences({ ...input, tagIds, driverIds, collectionIds });

    const effectiveCollectionIds = collectionIds ?? current.collections.map(({ collectionId }) => collectionId);
    const effectiveAudience = input.audience === undefined ? current.audience : input.audience;
    const effectiveStatus = input.status ?? current.status;
    await ProductService.validateActivation(effectiveStatus, effectiveAudience, effectiveCollectionIds, current.variants.length);

    const {
      tagIds: _tagIds,
      driverIds: _driverIds,
      collectionIds: _collectionIds,
      ...product
    } = input;
    const updated = await ProductRepository.updateProduct(id, product, { tagIds, driverIds, collectionIds });
    return ProductService.response(updated);
  }

  static createVariant(productId: string, input: VariantInput) {
    return ProductRepository.createVariant({ ...input, productId, sizingGuide: input.sizingGuide ?? Prisma.JsonNull });
  }
  static async updateVariant(productId: string, id: string, input: VariantPatch) {
    const current = await ProductRepository.findVariant(id, productId);
    if (!current) notFound("Variant not found");
    const effectiveSize = input.size === undefined ? current.size : input.size;
    const effectiveSizingGuide = input.sizingGuide === undefined ? current.sizingGuide : input.sizingGuide;
    if (effectiveSize && !effectiveSizingGuide) {
      throw new HttpError(400, "SIZING_GUIDE_REQUIRED", "A sized variant requires a sizing guide");
    }
    const { sizingGuide, ...variant } = input;
    return ProductRepository.updateVariant(id, {
      ...variant,
      ...(sizingGuide !== undefined ? { sizingGuide: sizingGuide === null ? Prisma.JsonNull : sizingGuide } : {}),
    });
  }
  static async deleteVariant(productId: string, id: string) {
    const [product, variantCount] = await Promise.all([
      ProductRepository.findProductStatus(productId),
      ProductRepository.countVariants(productId),
    ]);
    if (!product) notFound("Product not found");
    if (product.status === "ACTIVE" && variantCount <= 1) {
      throw new HttpError(409, "VARIANT_REQUIRED", "Active products must keep at least one variant");
    }
    if (!(await ProductRepository.deleteVariant(id, productId)).count) notFound("Variant not found");
  }
}
