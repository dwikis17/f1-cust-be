import assert from "node:assert/strict";
import test from "node:test";
import { effectivePriceIdr, salePriceFromPercentage } from "./product-price.js";

test("sale prices round to the nearest rupiah", () => {
  assert.equal(salePriceFromPercentage(1_000, 20), 800);
  assert.equal(salePriceFromPercentage(999, 20), 799);
  assert.equal(salePriceFromPercentage(1_000, null), null);
});

test("sale pricing uses the configured sale price until cleared", () => {
  assert.equal(effectivePriceIdr({ priceIdr: 1_000, salePriceIdr: 750 }), 750);
  assert.equal(effectivePriceIdr({ priceIdr: 1_000, salePriceIdr: null }), 1_000);
});
