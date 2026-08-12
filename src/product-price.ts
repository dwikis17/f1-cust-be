type ProductPrice = {
  priceIdr: number;
  salePriceIdr: number | null;
};

export function salePriceFromPercentage(priceIdr: number, salePercentage: number | null) {
  return salePercentage === null ? null : Math.round(priceIdr * (100 - salePercentage) / 100);
}

export function effectivePriceIdr(product: ProductPrice) {
  return product.salePriceIdr ?? product.priceIdr;
}
