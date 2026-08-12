import type {
  CollectionKind,
  Prisma,
  ProductAudience,
  ProductCondition,
} from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import { storedPhotoUrl } from "../../photo-storage.js";
import { effectivePriceIdr } from "../../product-price.js";
import { productInclude } from "../admin/product-repository.js";

const productCardSelect = {
  id: true,
  name: true,
  nameId: true,
  slug: true,
  priceIdr: true,
  salePriceIdr: true,
  salePercentage: true,
  condition: true,
  category: { select: { name: true } },
  team: { select: { name: true } },
  tags: { select: { tag: { select: { id: true, name: true } } } },
  photos: {
    select: { path: true, altText: true },
    orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
    take: 2,
  },
} satisfies Prisma.ProductSelect;

export type PublicProductCardRecord = Prisma.ProductGetPayload<{ select: typeof productCardSelect }>;

export type ProductSort =
  | "featured"
  | "relevance"
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "newest"
  | "oldest";

export type ProductFilters = {
  search?: string;
  productTypes?: string[];
  tags?: string[];
  teams?: string[];
  drivers?: string[];
  sizes?: string[];
  colors?: string[];
  audiences?: ProductAudience[];
  conditions?: ProductCondition[];
  availability?: "in_stock";
  minPrice?: number;
  maxPrice?: number;
  onSale?: boolean;
};

type FacetName = "tag" | "team" | "driver" | "productType" | "audience" | "condition" | "availability" | "price";
type PriceRow = { id: string; priceIdr: number; salePriceIdr: number | null };

const hasPriceFilter = (filters: ProductFilters) => filters.minPrice !== undefined || filters.maxPrice !== undefined;

function matchesPrice(product: PriceRow, filters: ProductFilters) {
  const price = effectivePriceIdr(product);
  return (filters.minPrice === undefined || price >= filters.minPrice)
    && (filters.maxPrice === undefined || price <= filters.maxPrice);
}

function productWhere(filters: ProductFilters, omit?: FacetName): Prisma.ProductWhereInput {
  const variantFilter: Prisma.ProductVariantWhereInput = {
    ...(filters.sizes?.length && { size: { in: filters.sizes } }),
    ...(filters.colors?.length && { color: { in: filters.colors } }),
    ...(omit !== "availability" && filters.availability && { stockQuantity: { gt: 0 } }),
  };
  const hasVariantFilter = Object.keys(variantFilter).length > 0;
  return {
    status: "ACTIVE",
    ...(filters.search && {
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { nameId: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
        { descriptionId: { contains: filters.search, mode: "insensitive" } },
      ],
    }),
    ...(omit !== "productType" && filters.productTypes?.length && {
      category: { slug: { in: filters.productTypes } },
    }),
    ...(filters.tags?.length && { tags: { some: { tag: { slug: { in: filters.tags } } } } }),
    ...(omit !== "team" && filters.teams?.length && { team: { slug: { in: filters.teams } } }),
    ...(omit !== "driver" && filters.drivers?.length && {
      drivers: { some: { driver: { slug: { in: filters.drivers } } } },
    }),
    ...(omit !== "audience" && filters.audiences?.length && { audience: { in: filters.audiences } }),
    ...(omit !== "condition" && filters.conditions?.length && { condition: { in: filters.conditions } }),
    ...(filters.onSale && { salePercentage: { not: null } }),
    ...(hasVariantFilter && { variants: { some: variantFilter } }),
  };
}

function productOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "name_asc": return [{ name: "asc" }, { id: "asc" }];
    case "name_desc": return [{ name: "desc" }, { id: "asc" }];
    case "price_asc": return [{ priceIdr: "asc" }, { id: "asc" }];
    case "price_desc": return [{ priceIdr: "desc" }, { id: "asc" }];
    case "oldest": return [{ createdAt: "asc" }, { id: "asc" }];
    case "featured":
    case "relevance":
    case "newest": return [{ createdAt: "desc" }, { id: "asc" }];
  }
}

function membershipOrderBy(sort: ProductSort): Prisma.ProductCollectionOrderByWithRelationInput[] {
  if (sort === "featured") {
    return [{ featured: "desc" }, { position: "asc" }, { product: { createdAt: "desc" } }];
  }
  return productOrderBy(sort).map((order) => ({ product: order }));
}

function inCollection(collectionSlug: string, where: Prisma.ProductWhereInput): Prisma.ProductWhereInput {
  return { ...where, collections: { some: { collection: { slug: collectionSlug, active: true } } } };
}

export class PublicProductRepository {
  static storedPhotoUrl(value: string) { return storedPhotoUrl(value); }

  private static async effectivePriceWhere(
    where: Prisma.ProductWhereInput,
    filters: ProductFilters,
    omit: FacetName | undefined,
  ) {
    if (omit === "price" || !hasPriceFilter(filters)) return where;
    // ponytail: scans compact price rows; move this CASE expression into SQL when the catalog is measurably large.
    const products = await prisma.product.findMany({
      where,
      select: { id: true, priceIdr: true, salePriceIdr: true },
    });
    return { ...where, id: { in: products.filter((product) => matchesPrice(product, filters)).map(({ id }) => id) } };
  }

  static async listProducts(filters: ProductFilters, sort: ProductSort, page: number, limit: number) {
    const where = productWhere(filters);
    if (hasPriceFilter(filters) || sort === "price_asc" || sort === "price_desc") {
      const candidates = await prisma.product.findMany({
        where,
        select: { id: true, priceIdr: true, salePriceIdr: true },
        ...(sort === "price_asc" || sort === "price_desc" ? {} : { orderBy: productOrderBy(sort) }),
      });
      const filtered = candidates.filter((product) => matchesPrice(product, filters));
      if (sort === "price_asc" || sort === "price_desc") {
        const direction = sort === "price_asc" ? 1 : -1;
        filtered.sort((left, right) =>
          direction * (effectivePriceIdr(left) - effectivePriceIdr(right))
          || left.id.localeCompare(right.id));
      }
      const ids = filtered.slice((page - 1) * limit, page * limit).map(({ id }) => id);
      const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: productCardSelect });
      const byId = new Map(products.map((product) => [product.id, product]));
      return [filtered.length, ids.flatMap((id) => {
        const product = byId.get(id);
        return product ? [product] : [];
      })] as const;
    }
    return prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        select: productCardSelect,
        orderBy: productOrderBy(sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
  }

  static async listCollectionProducts(
    collectionSlug: string,
    filters: ProductFilters,
    sort: ProductSort,
    page: number,
    limit: number,
  ) {
    const product = productWhere(filters);
    const where: Prisma.ProductCollectionWhereInput = { collection: { slug: collectionSlug, active: true }, product };
    if (hasPriceFilter(filters) || sort === "price_asc" || sort === "price_desc") {
      const candidates = await prisma.productCollection.findMany({
        where,
        select: {
          product: { select: { id: true, priceIdr: true, salePriceIdr: true } },
        },
        ...(sort === "price_asc" || sort === "price_desc" ? {} : { orderBy: membershipOrderBy(sort) }),
      });
      const filtered = candidates.filter(({ product }) => matchesPrice(product, filters));
      if (sort === "price_asc" || sort === "price_desc") {
        const direction = sort === "price_asc" ? 1 : -1;
        filtered.sort((left, right) =>
          direction * (effectivePriceIdr(left.product) - effectivePriceIdr(right.product))
          || left.product.id.localeCompare(right.product.id));
      }
      const ids = filtered.slice((page - 1) * limit, page * limit).map(({ product: { id } }) => id);
      const memberships = await prisma.productCollection.findMany({
        where: { collection: { slug: collectionSlug, active: true }, productId: { in: ids } },
        select: { productId: true, product: { select: productCardSelect } },
      });
      const byId = new Map(memberships.map((membership) => [membership.productId, membership]));
      return [filtered.length, ids.flatMap((id) => {
        const membership = byId.get(id);
        return membership ? [membership] : [];
      })] as const;
    }
    return prisma.$transaction([
      prisma.productCollection.count({ where }),
      prisma.productCollection.findMany({
        where,
        select: { productId: true, product: { select: productCardSelect } },
        orderBy: membershipOrderBy(sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
  }

  static async facetSources(collectionSlug: string | null, filters: ProductFilters) {
    const scoped = (omit: FacetName) =>
      PublicProductRepository.effectivePriceWhere(
        collectionSlug ? inCollection(collectionSlug, productWhere(filters, omit)) : productWhere(filters, omit),
        filters,
        omit,
      );
    const [
      tagWhere,
      teamWhere,
      driverWhere,
      productTypeWhere,
      audienceWhere,
      conditionWhere,
      availabilityWhere,
      priceWhere,
    ] = await Promise.all([
      scoped("tag"),
      scoped("team"),
      scoped("driver"),
      scoped("productType"),
      scoped("audience"),
      scoped("condition"),
      scoped("availability"),
      scoped("price"),
    ]);
    return Promise.all([
      prisma.product.findMany({
        where: tagWhere,
        select: { tags: { select: { tag: true } } },
      }),
      prisma.product.findMany({ where: teamWhere, select: { team: true } }),
      prisma.product.findMany({
        where: driverWhere,
        select: { drivers: { select: { driver: true } } },
      }),
      prisma.product.findMany({ where: productTypeWhere, select: { category: true } }),
      prisma.product.findMany({ where: audienceWhere, select: { audience: true } }),
      prisma.product.findMany({ where: conditionWhere, select: { condition: true } }),
      prisma.product.findMany({
        where: availabilityWhere,
        select: { variants: { where: { stockQuantity: { gt: 0 } }, select: { id: true }, take: 1 } },
      }),
      prisma.product.findMany({
        where: priceWhere,
        select: { id: true, priceIdr: true, salePriceIdr: true },
      }),
    ]);
  }

  static listFeaturedCollectionProductCards(collectionSlug: string, limit: number) {
    return prisma.productCollection.findMany({
      where: { collection: { slug: collectionSlug, active: true }, product: { status: "ACTIVE" } },
      select: { product: { select: productCardSelect } },
      orderBy: membershipOrderBy("featured"),
      take: limit,
    });
  }

  static findProduct(slug: string) {
    return prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, include: productInclude });
  }

  static findCartItems(variantIds: string[]) {
    return prisma.productVariant.findMany({
      where: { id: { in: variantIds }, product: { status: "ACTIVE" } },
      select: {
        id: true,
        sku: true,
        size: true,
        color: true,
        stockQuantity: true,
        product: {
          select: {
            id: true,
            name: true,
            nameId: true,
            slug: true,
            priceIdr: true,
            salePriceIdr: true,
            team: { select: { name: true } },
            category: { select: { name: true } },
            photos: {
              select: { path: true, altText: true },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              take: 1,
            },
          },
        },
      },
    });
  }
}

export type PublicCollectionRecord = {
  id: string;
  name: string;
  slug: string;
  kind: CollectionKind;
  parentId: string | null;
  imageUrl: string | null;
  description: string;
  position: number;
  active: boolean;
};
