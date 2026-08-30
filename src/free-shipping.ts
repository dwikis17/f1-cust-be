export type FreeShippingRule = {
  active: boolean;
  minimumPurchaseIdr: number;
  maxCoverageIdr: number;
};

export function calculateShippingPrice(originalPrice: number, purchaseIdr: number, rule: FreeShippingRule) {
  const shippingDiscountIdr = rule.active && purchaseIdr >= rule.minimumPurchaseIdr
    ? Math.min(originalPrice, rule.maxCoverageIdr)
    : 0;
  return { originalPrice, shippingDiscountIdr, price: originalPrice - shippingDiscountIdr };
}
