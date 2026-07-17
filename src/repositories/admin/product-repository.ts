import type { Prisma } from "../../generated/prisma/client.js";
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
  variants: { orderBy: [{ color: "asc" as const }, { size: "asc" as const }, { sku: "asc" as const }] },
  photos: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type RelationUpdates = {
  tagIds?: string[];
  driverIds?: string[];
  collectionIds?: string[];
};

export class ProductRepository {
  static listProducts() {
    return prisma.product.findMany({ include: productInclude, orderBy: { createdAt: "desc" } });
  }
  static findProduct(id: string) {
    return prisma.product.findUnique({ where: { id }, include: productInclude });
  }
  static createProduct(data: Prisma.ProductCreateArgs["data"]) {
    return prisma.product.create({ data, include: productInclude });
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

  static createVariant(data: Prisma.ProductVariantUncheckedCreateInput) {
    return prisma.productVariant.create({ data });
  }
  static findVariant(id: string, productId: string) {
    return prisma.productVariant.findFirst({ where: { id, productId } });
  }
  static updateVariant(id: string, data: Prisma.ProductVariantUpdateInput) {
    return prisma.productVariant.update({ where: { id }, data });
  }
  static deleteVariant(id: string, productId: string) {
    return prisma.productVariant.deleteMany({ where: { id, productId } });
  }
  static countVariants(productId: string) {
    return prisma.productVariant.count({ where: { productId } });
  }
  static findProductStatus(productId: string) {
    return prisma.product.findUnique({ where: { id: productId }, select: { status: true } });
  }
}
