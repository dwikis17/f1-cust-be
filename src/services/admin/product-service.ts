import type { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../http.js";
import { CatalogRepository } from "../../repositories/admin/catalog-repository.js";
import {
  ProductRepository,
  type ProductListInput,
  type ProductWithRelations,
} from "../../repositories/admin/product-repository.js";
import { salePercentageFromSalePrice } from "../../product-price.js";
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

function copyName(name: string, copyNumber: number) {
  const prefix = copyNumber === 1 ? "Copy of " : `Copy ${copyNumber} of `;
  return `${prefix}${name.slice(0, 120 - prefix.length)}`;
}

function copyValue(value: string, copyNumber: number) {
  const suffix = copyNumber === 1 ? "-copy" : `-copy-${copyNumber}`;
  return `${value.slice(0, 100 - suffix.length).replace(/-+$/, "")}${suffix}`;
}

function copySku(sku: string, copyNumber: number, variantIndex: number) {
  const suffix = copyNumber === 1 ? `-copy-${variantIndex + 1}` : `-copy-${copyNumber}-${variantIndex + 1}`;
  return `${sku.slice(0, 80 - suffix.length)}${suffix}`;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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

  private static rejectIfSoldOut(variants: Array<{ stockQuantity: number }>) {
    if (variants.length > 0 && variants.every(({ stockQuantity }) => stockQuantity === 0)) {
      throw new HttpError(400, "OUT_OF_STOCK", "Active products must have stock available");
    }
  }

  private static salePricing(
    priceIdr: number,
    salePriceIdr: number | null,
  ) {
    if (salePriceIdr !== null && (salePriceIdr < 1 || salePriceIdr >= priceIdr)) {
      throw new HttpError(400, "INVALID_SALE_PRICE", "Sale price must be lower than the regular price");
    }
    return { salePriceIdr, salePercentage: salePercentageFromSalePrice(priceIdr, salePriceIdr) };
  }

  static async listProducts(input: ProductListInput) {
    const result = await ProductRepository.listProducts(input);
    const data = result.data.map(ProductService.response);
    if (input.all) return data;
    return { data, page: input.page, limit: input.limit, total: result.total ?? 0 };
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
    if (input.status === "ACTIVE") ProductService.rejectIfSoldOut(input.variants);
    await ProductService.validateActivation(input.status, input.audience, collectionIds, input.variants.length);
    const salePricing = ProductService.salePricing(input.priceIdr, input.salePriceIdr);
    const { driverIds: _driverIds, collectionIds: _collectionIds, tagIds: _tagIds, variants, salePriceIdr: _salePriceIdr, ...product } = input;
    const created = await ProductRepository.createProduct({
      ...product,
      ...salePricing,
      tags: { create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) },
      drivers: { create: driverIds.map((driverId) => ({ driver: { connect: { id: driverId } } })) },
      collections: {
        create: collectionIds.map((collectionId) => ({ collection: { connect: { id: collectionId } } })),
      },
      variants: {
        create: variants.map((variant, position) => ({
          ...variant,
          position,
          sizingGuide: variant.sizingGuide,
        })),
      },
    });
    return ProductService.response(created);
  }
  static async duplicateProduct(id: string) {
    const source = await ProductRepository.findProduct(id);
    if (!source) notFound("Product not found");

    for (let copyNumber = 1; copyNumber <= 100; copyNumber += 1) {
      try {
        const created = await ProductRepository.createProduct({
          name: copyName(source.name, copyNumber),
          nameId: source.nameId,
          slug: copyValue(source.slug, copyNumber),
          description: source.description,
          descriptionId: source.descriptionId,
          bulletPoints: source.bulletPoints === null ? Prisma.JsonNull : source.bulletPoints,
          sizingNote: source.sizingNote,
          priceIdr: source.priceIdr,
          salePriceIdr: source.salePriceIdr,
          salePercentage: source.salePercentage,
          status: "DRAFT",
          condition: source.condition,
          category: { connect: { id: source.categoryId } },
          ...(source.teamId ? { team: { connect: { id: source.teamId } } } : {}),
          audience: source.audience,
          tags: { create: source.tags.map(({ tagId }) => ({ tag: { connect: { id: tagId } } })) },
          drivers: { create: source.drivers.map(({ driverId }) => ({ driver: { connect: { id: driverId } } })) },
          collections: { create: source.collections.map(({ collectionId }) => ({ collection: { connect: { id: collectionId } } })) },
          variants: {
            create: source.variants.map((variant, index) => ({
              sku: copySku(variant.sku, copyNumber, index),
              size: variant.size,
              color: variant.color,
              stockQuantity: 0,
              packageLengthMm: variant.packageLengthMm,
              packageWidthMm: variant.packageWidthMm,
              packageHeightMm: variant.packageHeightMm,
              packageWeightG: variant.packageWeightG,
              sizingGuide: variant.sizingGuide,
              position: variant.position,
            })),
          },
        });
        return ProductService.response(created);
      } catch (error) {
        if (!isUniqueViolation(error) || copyNumber === 100) throw error;
      }
    }
    throw new Error("Unreachable");
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
    if (input.status === "ACTIVE" && current.status !== "ACTIVE") ProductService.rejectIfSoldOut(current.variants);
    await ProductService.validateActivation(effectiveStatus, effectiveAudience, effectiveCollectionIds, current.variants.length);
    const priceIdr = input.priceIdr ?? current.priceIdr;
    const salePriceIdr = input.salePriceIdr === undefined ? current.salePriceIdr : input.salePriceIdr;
    const salePricing = ProductService.salePricing(priceIdr, salePriceIdr);

    const {
      tagIds: _tagIds,
      driverIds: _driverIds,
      collectionIds: _collectionIds,
      salePriceIdr: _salePriceIdr,
      ...product
    } = input;
    const updated = await ProductRepository.updateProduct(
      id,
      { ...product, ...salePricing },
      { tagIds, driverIds, collectionIds },
    );
    return ProductService.response(updated);
  }

  static async createVariant(productId: string, input: VariantInput) {
    if (!await ProductRepository.findProductStatus(productId)) notFound("Product not found");
    // ponytail: max+1 can tie under concurrent creates; createdAt/id tie-breakers keep reads deterministic.
    const { _max: { position } } = await ProductRepository.maxVariantPosition(productId);
    return ProductRepository.createVariant({ ...input, productId, position: (position ?? -1) + 1 });
  }
  static async updateVariant(productId: string, id: string, input: VariantPatch) {
    const current = await ProductRepository.findVariant(id, productId);
    if (!current) notFound("Variant not found");
    const { sizingGuide, ...variant } = input;
    return ProductRepository.updateVariant(id, productId, {
      ...variant,
      ...(sizingGuide !== undefined ? { sizingGuide } : {}),
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
