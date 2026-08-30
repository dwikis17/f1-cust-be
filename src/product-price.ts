type ProductPrice = {
  priceIdr: number;
  salePriceIdr: number | null;
};

export function salePercentageFromSalePrice(priceIdr: number, salePriceIdr: number | null) {
  return salePriceIdr === null ? null : Math.max(1, Math.round((priceIdr - salePriceIdr) * 100 / priceIdr));
}

export function effectivePriceIdr(product: ProductPrice) {
  return product.salePriceIdr ?? product.priceIdr;
}
