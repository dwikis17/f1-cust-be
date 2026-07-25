type ProductPrice = {
  priceIdr: number;
  salePriceIdr: number | null;
};

export function effectivePriceIdr(product: ProductPrice) {
  return product.salePriceIdr ?? product.priceIdr;
}
