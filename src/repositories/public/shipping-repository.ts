import { prisma } from "../../db.js";

export type ShippingVariant = {
  id: string;
  sku: string;
  stockQuantity: number;
  packageLengthMm: number;
  packageWidthMm: number;
  packageHeightMm: number;
  packageWeightG: number;
  product: { name: string; priceIdr: number; salePriceIdr: number | null; status: string };
};

export class PublicShippingRepository {
  static findRateVariants(ids: string[]): Promise<ShippingVariant[]> {
    return prisma.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        sku: true,
        stockQuantity: true,
        packageLengthMm: true,
        packageWidthMm: true,
        packageHeightMm: true,
        packageWeightG: true,
        product: {
          select: { name: true, priceIdr: true, salePriceIdr: true, status: true },
        },
      },
    });
  }
}
