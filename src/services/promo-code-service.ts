import { HttpError, notFound } from "../http.js";
import { effectivePriceIdr } from "../product-price.js";
import {
  PromoCodeRepository,
  type PromoCodeInput,
  type PromoCodePatch,
} from "../repositories/promo-code-repository.js";

type CartItem = { variantId: string; quantity: number };
type DiscountRule = { discountPercentage: number; maxDiscountIdr: number | null };

export type { PromoCodeInput, PromoCodePatch } from "../repositories/promo-code-repository.js";

export class PromoCodeService {
  static calculatePromoDiscount(subtotalIdr: number, promoCode: DiscountRule) {
    const percentageDiscount = Math.floor((subtotalIdr * promoCode.discountPercentage) / 100);
    return Math.min(subtotalIdr, promoCode.maxDiscountIdr ?? percentageDiscount, percentageDiscount);
  }

  static async preview(code: string, items: CartItem[]) {
    const promoCode = await PromoCodeRepository.findByCode(code);
    if (!promoCode?.active) {
      throw new HttpError(409, "PROMO_CODE_UNAVAILABLE", "Promo code is invalid or inactive");
    }

    const quantities = new Map<string, number>();
    for (const item of items) {
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const variants = await PromoCodeRepository.findPreviewVariants([...quantities.keys()]);
    if (variants.length !== quantities.size || variants.some((variant) =>
      variant.product.status !== "ACTIVE" || variant.stockQuantity < (quantities.get(variant.id) ?? 0))) {
      throw new HttpError(409, "CART_CHANGED", "One or more cart items are unavailable");
    }

    const subtotalIdr = variants.reduce(
      (sum, variant) => sum + effectivePriceIdr(variant.product) * (quantities.get(variant.id) ?? 0),
      0,
    );
    const discountIdr = PromoCodeService.calculatePromoDiscount(subtotalIdr, promoCode);
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
    const { promoCodes, redemptions } = await PromoCodeRepository.listWithRedemptions();
    const totals = new Map(redemptions.map((item) => [item.promoCodeId, item]));
    return promoCodes.map((promoCode) => ({
      ...promoCode,
      redemptionCount: totals.get(promoCode.id)?._count._all ?? 0,
      redeemedDiscountIdr: totals.get(promoCode.id)?._sum.discountIdr ?? 0,
    }));
  }

  static create(input: PromoCodeInput) {
    return PromoCodeRepository.create(input);
  }

  static update(id: string, input: PromoCodePatch) {
    return PromoCodeRepository.update(id, input);
  }

  static async usages(id: string, page: number, limit: number) {
    if (!await PromoCodeRepository.findById(id)) notFound("Promo code not found");
    const { orders, total } = await PromoCodeRepository.listUsages(id, page, limit);
    return { data: orders, page, limit, total };
  }
}

export const calculatePromoDiscount = PromoCodeService.calculatePromoDiscount;
