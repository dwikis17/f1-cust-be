import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";

const productInclude = {
  category: true,
  team: true,
  driver: true,
  tags: { include: { tag: true } },
  variants: { orderBy: [{ color: "asc" as const }, { size: "asc" as const }] },
  photos: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};

export class ProductRepository {
  static listProducts() {
    return prisma.product.findMany({ include: productInclude, orderBy: { createdAt: "desc" } });
  }
  static findProduct(id: string) {
    return prisma.product.findUnique({ where: { id }, include: productInclude });
  }
  static findProductTeamDriver(id: string) {
    return prisma.product.findUnique({ where: { id }, select: { teamId: true, driverId: true } });
  }
  static createProduct(data: Prisma.ProductCreateArgs["data"]) {
    return prisma.product.create({ data, include: productInclude });
  }
  static updateProduct(id: string, data: Prisma.ProductUpdateArgs["data"], tagIds?: string[]) {
    return prisma.$transaction(async (tx) => {
      if (tagIds) {
        await tx.productTag.deleteMany({ where: { productId: id } });
        await tx.productTag.createMany({ data: tagIds.map((tagId) => ({ productId: id, tagId })) });
      }
      return tx.product.update({ where: { id }, data, include: productInclude });
    });
  }

  static createVariant(data: Prisma.ProductVariantUncheckedCreateInput) { return prisma.productVariant.create({ data }); }
  static findVariant(id: string, productId: string) { return prisma.productVariant.findFirst({ where: { id, productId } }); }
  static updateVariant(id: string, data: Prisma.ProductVariantUpdateInput) { return prisma.productVariant.update({ where: { id }, data }); }
  static deleteVariant(id: string, productId: string) { return prisma.productVariant.deleteMany({ where: { id, productId } }); }
}
