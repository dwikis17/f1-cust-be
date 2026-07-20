import { notFound } from "../../http.js";
import { PublicCatalogRepository } from "../../repositories/public/catalog-repository.js";
import {
  PublicProductRepository,
  type ProductFilters,
  type ProductSort,
} from "../../repositories/public/product-repository.js";
import type { ProductWithRelations } from "../../repositories/admin/product-repository.js";

type NamedFacetValue = { id: string; name: string; slug: string };
type Locale = "en" | "id";

function increment(map: Map<string, { value: NamedFacetValue; count: number }>, value: NamedFacetValue) {
  const current = map.get(value.id);
  if (current) current.count += 1;
  else map.set(value.id, { value, count: 1 });
}

function namedFacet(map: Map<string, { value: NamedFacetValue; count: number }>) {
  return [...map.values()]
    .map(({ value, count }) => ({ ...value, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class PublicProductService {
  private static publicProduct(product: ProductWithRelations, locale: Locale) {
    const { drivers, collections, variants, photos, category, nameId, descriptionId, ...value } = product;
    return {
      ...value,
      name: locale === "id" ? nameId ?? product.name : product.name,
      description: locale === "id" ? descriptionId ?? product.description : product.description,
      category,
      productType: category,
      drivers: drivers.map(({ driver }) => driver),
      collections: collections.map(({ collection }) => collection),
      variants: variants.map(({ stockQuantity, ...variant }) => ({ ...variant, available: stockQuantity > 0 })),
      photos: photos.map((photo) => ({ ...photo, url: PublicProductRepository.storedPhotoUrl(photo.path) })),
    };
  }

  private static async facets(collectionSlug: string, filters: ProductFilters) {
    const [teamProducts, driverProducts, productTypeProducts, audienceProducts, availabilityProducts, priceProducts] =
      await PublicProductRepository.facetSources(collectionSlug, filters);
    const teams = new Map<string, { value: NamedFacetValue; count: number }>();
    const drivers = new Map<string, { value: NamedFacetValue; count: number }>();
    const productTypes = new Map<string, { value: NamedFacetValue; count: number }>();
    const audiences = new Map<string, number>();

    for (const { team } of teamProducts) if (team) increment(teams, team);
    for (const product of driverProducts) {
      for (const { driver } of product.drivers) increment(drivers, driver);
    }
    for (const { category } of productTypeProducts) increment(productTypes, category);
    for (const { audience } of audienceProducts) {
      if (audience) audiences.set(audience, (audiences.get(audience) ?? 0) + 1);
    }

    let min = 0;
    let max = 0;
    if (priceProducts.length > 0) {
      min = priceProducts[0]?.priceIdr ?? 0;
      max = min;
      for (const { priceIdr } of priceProducts) {
        if (priceIdr < min) min = priceIdr;
        if (priceIdr > max) max = priceIdr;
      }
    }

    return {
      teams: namedFacet(teams),
      drivers: namedFacet(drivers),
      productTypes: namedFacet(productTypes),
      audiences: [...audiences.entries()].map(([value, count]) => ({ value, count })),
      availability: { inStock: availabilityProducts.filter(({ variants }) => variants.length > 0).length },
      price: { min, max },
    };
  }

  static async listProducts(filters: ProductFilters, sort: ProductSort, page: number, limit: number, locale: Locale) {
    const [total, products] = await PublicProductRepository.listProducts(filters, sort, page, limit);
    return { data: products.map((product) => PublicProductService.publicProduct(product, locale)), page, limit, total };
  }

  static async listCollectionProducts(
    collectionSlug: string,
    filters: ProductFilters,
    sort: ProductSort,
    page: number,
    limit: number,
    locale: Locale,
  ) {
    const collectionPromise = PublicCatalogRepository.findCollection(collectionSlug);
    const productsPromise = PublicProductRepository.listCollectionProducts(collectionSlug, filters, sort, page, limit);
    const facetsPromise = PublicProductService.facets(collectionSlug, filters);
    const [collection, [total, memberships], facets] = await Promise.all([
      collectionPromise,
      productsPromise,
      facetsPromise,
    ]);
    if (!collection) notFound("Collection not found");
    return {
      collection,
      data: memberships.map(({ product }) => PublicProductService.publicProduct(product, locale)),
      page,
      limit,
      total,
      facets,
    };
  }

  static async findProduct(slug: string, locale: Locale) {
    const product = await PublicProductRepository.findProduct(slug);
    if (!product) notFound("Product not found");
    return PublicProductService.publicProduct(product, locale);
  }

  static async cartItems(variantIds: string[], locale: Locale) {
    const uniqueIds = [...new Set(variantIds)];
    const variants = await PublicProductRepository.findCartItems(uniqueIds);
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const data = uniqueIds.flatMap((variantId) => {
      const value = byId.get(variantId);
      if (!value) return [];
      const { product } = value;
      const photo = product.photos[0];
      return [{
        product: {
          id: product.id,
          name: locale === "id" ? product.nameId ?? product.name : product.name,
          slug: product.slug,
          priceIdr: product.priceIdr,
          merchandisingLabel: product.team?.name ?? product.category.name,
          photo: photo ? { url: PublicProductRepository.storedPhotoUrl(photo.path), altText: photo.altText } : null,
        },
        variant: {
          id: value.id,
          sku: value.sku,
          size: value.size,
          color: value.color,
          available: value.stockQuantity > 0,
        },
      }];
    });
    return { data, missingVariantIds: uniqueIds.filter((id) => !byId.has(id)) };
  }
}
