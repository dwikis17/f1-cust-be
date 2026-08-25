import assert from "node:assert/strict";
import test from "node:test";
import { effectivePriceIdr, salePercentageFromSalePrice } from "./product-price.js";

test("sale percentages round to the nearest whole percent with a one-percent minimum", () => {
  assert.equal(salePercentageFromSalePrice(200_000, 180_000), 10);
  assert.equal(salePercentageFromSalePrice(1_000, 999), 1);
  assert.equal(salePercentageFromSalePrice(1_000, null), null);
});

test("sale pricing uses the configured sale price until cleared", () => {
  assert.equal(effectivePriceIdr({ priceIdr: 1_000, salePriceIdr: 750 }), 750);
  assert.equal(effectivePriceIdr({ priceIdr: 1_000, salePriceIdr: null }), 1_000);
});
