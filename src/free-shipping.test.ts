import assert from "node:assert/strict";
import test from "node:test";
import { calculateShippingPrice } from "./free-shipping.js";

const rule = { active: true, minimumPurchaseIdr: 1_000_000, maxCoverageIdr: 25_000 };

test("free-shipping coverage is inclusive, capped, and never negative", () => {
  assert.deepEqual(calculateShippingPrice(40_000, 999_999, rule), {
    originalPrice: 40_000, shippingDiscountIdr: 0, price: 40_000,
  });
  assert.deepEqual(calculateShippingPrice(40_000, 1_000_000, rule), {
    originalPrice: 40_000, shippingDiscountIdr: 25_000, price: 15_000,
  });
  assert.deepEqual(calculateShippingPrice(20_000, 1_000_000, rule), {
    originalPrice: 20_000, shippingDiscountIdr: 20_000, price: 0,
  });
  assert.equal(calculateShippingPrice(40_000, 1_000_000, { ...rule, active: false }).price, 40_000);
});
