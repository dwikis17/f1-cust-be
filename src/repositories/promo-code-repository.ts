import type { z } from "zod";
import { prisma } from "../db.js";
import type { promoCodePatchSchema, promoCodeSchema } from "../schemas.js";

export type PromoCodeInput = z.infer<typeof promoCodeSchema>;
export type PromoCodePatch = z.infer<typeof promoCodePatchSchema>;
export type PromoPreviewVariant = {
  id: string;
  stockQuantity: number;
  product: { priceIdr: number; salePriceIdr: number | null; status: string };
};

export class PromoCodeRepository {
  static findByCode(code: string) {
    return prisma.promoCode.findUnique({ where: { code } });
  }

  static findPreviewVariants(ids: string[]): Promise<PromoPreviewVariant[]> {
    return prisma.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        stockQuantity: true,
        product: { select: { priceIdr: true, salePriceIdr: true, status: true } },
      },
    });
  }

  static async listWithRedemptions() {
    const [promoCodes, redemptions] = await Promise.all([
      prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.order.groupBy({
        by: ["promoCodeId"],
        where: { promoCodeId: { not: null }, promoRedeemedAt: { not: null } },
        _count: { _all: true },
        _sum: { discountIdr: true },
      }),
    ]);
    return { promoCodes, redemptions };
  }

  static create(input: PromoCodeInput) {
    return prisma.promoCode.create({ data: { ...input, maxDiscountIdr: input.maxDiscountIdr ?? null } });
  }

  static update(id: string, input: PromoCodePatch) {
    return prisma.promoCode.update({ where: { id }, data: input });
  }

  static findById(id: string) {
    return prisma.promoCode.findUnique({ where: { id }, select: { id: true } });
  }

  static async listUsages(id: string, page: number, limit: number) {
    const where = { promoCodeId: id };
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        select: {
          id: true,
          email: true,
          createdAt: true,
          paymentStatus: true,
          discountIdr: true,
          promoRedeemedAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);
    return { orders, total };
  }
}
