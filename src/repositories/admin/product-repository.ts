import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";

export const productInclude = {
  category: true,
  team: true,
  drivers: { include: { driver: { include: { team: true } } }, orderBy: { driver: { name: "asc" as const } } },
  collections: {
    include: { collection: true },
    orderBy: [{ collection: { position: "asc" as const } }, { collection: { name: "asc" as const } }],
  },
  tags: { include: { tag: true } },
  variants: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }] },
  photos: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type RelationUpdates = {
  tagIds?: string[];
  driverIds?: string[];
  collectionIds?: string[];
};

type ProductCreateData = Omit<Prisma.ProductCreateArgs["data"], "variants"> & {
  variants: {
    create: Array<Omit<Prisma.ProductVariantCreateWithoutProductInput, "sizingGuide"> & { sizingGuide?: unknown | null }>;
  };
};

type VariantCreateData = Omit<Prisma.ProductVariantUncheckedCreateInput, "sizingGuide"> & { sizingGuide?: unknown | null };
type VariantUpdateData = Omit<Prisma.ProductVariantUpdateInput, "sizingGuide"> & { sizingGuide?: unknown | null };
type ProductClient = Prisma.TransactionClient | typeof prisma;

export class ProductRepository {
  static listProducts() {
    return prisma.product.findMany({ include: productInclude, orderBy: { createdAt: "desc" } });
  }
  static findProduct(id: string) {
    return prisma.product.findUnique({ where: { id }, include: productInclude });
  }
  static createProduct(data: ProductCreateData) {
    return prisma.product.create({
      data: {
        ...data,
        variants: {
          ...data.variants,
          create: data.variants.create.map((variant) => ({
            ...variant,
            sizingGuide: variant.sizingGuide ?? Prisma.JsonNull,
          })),
        },
      } as Prisma.ProductCreateArgs["data"],
      include: productInclude,
    });
  }
  static updateProduct(id: string, data: Prisma.ProductUpdateArgs["data"], relations: RelationUpdates) {
    return prisma.$transaction(async (tx) => {
      if (relations.tagIds !== undefined) {
        await tx.productTag.deleteMany({ where: { productId: id } });
        if (relations.tagIds.length > 0) {
          await tx.productTag.createMany({ data: relations.tagIds.map((tagId) => ({ productId: id, tagId })) });
        }
      }
      if (relations.driverIds !== undefined) {
        await tx.productDriver.deleteMany({ where: { productId: id } });
        if (relations.driverIds.length > 0) {
          await tx.productDriver.createMany({
            data: relations.driverIds.map((driverId) => ({ productId: id, driverId })),
          });
        }
      }
      if (relations.collectionIds !== undefined) {
        await tx.productCollection.deleteMany({ where: { productId: id } });
        if (relations.collectionIds.length > 0) {
          await tx.productCollection.createMany({
            data: relations.collectionIds.map((collectionId) => ({ productId: id, collectionId })),
          });
        }
      }
      return tx.product.update({ where: { id }, data, include: productInclude });
    });
  }

  static createVariant(data: VariantCreateData) {
    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: { ...data, sizingGuide: data.sizingGuide ?? Prisma.JsonNull } as Prisma.ProductVariantUncheckedCreateInput,
      });
      await ProductRepository.archiveSoldOutProducts(tx, [data.productId]);
      return variant;
    });
  }
  static maxVariantPosition(productId: string) {
    return prisma.productVariant.aggregate({ where: { productId }, _max: { position: true } });
  }
  static findVariant(id: string, productId: string) {
    return prisma.productVariant.findFirst({ where: { id, productId } });
  }
  static updateVariant(id: string, productId: string, data: VariantUpdateData) {
    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.update({
        where: { id },
        data: {
          ...data,
          ...(data.sizingGuide !== undefined
            ? { sizingGuide: data.sizingGuide === null ? Prisma.JsonNull : data.sizingGuide }
            : {}),
        } as Prisma.ProductVariantUpdateInput,
      });
      await ProductRepository.archiveSoldOutProducts(tx, [productId]);
      return variant;
    });
  }
  static deleteVariant(id: string, productId: string) {
    return prisma.$transaction(async (tx) => {
      const deleted = await tx.productVariant.deleteMany({ where: { id, productId } });
      if (deleted.count > 0) await ProductRepository.archiveSoldOutProducts(tx, [productId]);
      return deleted;
    });
  }
  static archiveSoldOutProducts(client: ProductClient, productIds: string[]) {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return Promise.resolve({ count: 0 });
    return client.product.updateMany({
      where: {
        id: { in: ids },
        status: "ACTIVE",
        variants: { some: {}, none: { stockQuantity: { gt: 0 } } },
      },
      data: { status: "ARCHIVED" },
    });
  }
  static countVariants(productId: string) {
    return prisma.productVariant.count({ where: { productId } });
  }
  static findProductStatus(productId: string) {
    return prisma.product.findUnique({ where: { id: productId }, select: { status: true } });
  }
}
