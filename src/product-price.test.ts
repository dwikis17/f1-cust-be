import assert from "node:assert/strict";
import test from "node:test";
import { effectivePriceIdr } from "./product-price.js";

test("sale pricing uses the configured sale price until cleared", () => {
  assert.equal(effectivePriceIdr({ priceIdr: 1_000, salePriceIdr: 750 }), 750);
  assert.equal(effectivePriceIdr({ priceIdr: 1_000, salePriceIdr: null }), 1_000);
});
