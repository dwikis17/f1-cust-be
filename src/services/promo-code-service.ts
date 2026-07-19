import type { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, notFound } from "../http.js";
import type { promoCodePatchSchema, promoCodeSchema } from "../schemas.js";

type PromoCodeInput = z.infer<typeof promoCodeSchema>;
type PromoCodePatch = z.infer<typeof promoCodePatchSchema>;
type CartItem = { variantId: string; quantity: number };
type DiscountRule = { discountPercentage: number; maxDiscountIdr: number | null };

export function calculatePromoDiscount(subtotalIdr: number, promoCode: DiscountRule) {
  const percentageDiscount = Math.floor((subtotalIdr * promoCode.discountPercentage) / 100);
  return Math.min(subtotalIdr, promoCode.maxDiscountIdr ?? percentageDiscount, percentageDiscount);
}

export class PromoCodeService {
  static async preview(code: string, items: CartItem[]) {
    const promoCode = await prisma.promoCode.findUnique({ where: { code } });
    if (!promoCode?.active) {
      throw new HttpError(409, "PROMO_CODE_UNAVAILABLE", "Promo code is invalid or inactive");
    }

    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: [...quantities.keys()] } },
      select: {
        id: true,
        stockQuantity: true,
        product: { select: { priceIdr: true, status: true } },
      },
    });
    if (variants.length !== quantities.size || variants.some((variant) =>
      variant.product.status !== "ACTIVE" || variant.stockQuantity < (quantities.get(variant.id) ?? 0))) {
      throw new HttpError(409, "CART_CHANGED", "One or more cart items are unavailable");
    }

    const subtotalIdr = variants.reduce(
      (sum, variant) => sum + variant.product.priceIdr * (quantities.get(variant.id) ?? 0),
      0,
    );
    const discountIdr = calculatePromoDiscount(subtotalIdr, promoCode);
    return {
      code: promoCode.code,
      discountPercentage: promoCode.discountPercentage,
      maxDiscountIdr: promoCode.maxDiscountIdr,
      subtotalIdr,
      discountIdr,
      discountedSubtotalIdr: subtotalIdr - discountIdr,
    };
  }

  static async list() {
    const [promoCodes, redemptions] = await Promise.all([
      prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.order.groupBy({
        by: ["promoCodeId"],
        where: { promoCodeId: { not: null }, promoRedeemedAt: { not: null } },
        _count: { _all: true },
        _sum: { discountIdr: true },
      }),
    ]);
    const totals = new Map(redemptions.map((item) => [item.promoCodeId, item]));
    return promoCodes.map((promoCode) => ({
      ...promoCode,
      redemptionCount: totals.get(promoCode.id)?._count._all ?? 0,
      redeemedDiscountIdr: totals.get(promoCode.id)?._sum.discountIdr ?? 0,
    }));
  }

  static create(input: PromoCodeInput) {
    return prisma.promoCode.create({ data: { ...input, maxDiscountIdr: input.maxDiscountIdr ?? null } });
  }

  static update(id: string, input: PromoCodePatch) {
    return prisma.promoCode.update({ where: { id }, data: input });
  }

  static async usages(id: string, page: number, limit: number) {
    if (!await prisma.promoCode.findUnique({ where: { id }, select: { id: true } })) notFound("Promo code not found");
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
    return { data: orders, page, limit, total };
  }
}
