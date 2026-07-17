import type { CollectionKind, Prisma, ProductAudience } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import { storedPhotoUrl } from "../../photo-storage.js";
import { productInclude } from "../admin/product-repository.js";

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
  availability?: "in_stock";
  minPrice?: number;
  maxPrice?: number;
};

type FacetName = "team" | "driver" | "productType" | "audience" | "availability" | "price";

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
        { description: { contains: filters.search, mode: "insensitive" } },
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
    ...(omit !== "price" && (filters.minPrice !== undefined || filters.maxPrice !== undefined) && {
      priceIdr: { gte: filters.minPrice, lte: filters.maxPrice },
    }),
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

  static listProducts(filters: ProductFilters, sort: ProductSort, page: number, limit: number) {
    const where = productWhere(filters);
    return prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: productOrderBy(sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
  }

  static listCollectionProducts(collectionSlug: string, filters: ProductFilters, sort: ProductSort, page: number, limit: number) {
    const product = productWhere(filters);
    const where: Prisma.ProductCollectionWhereInput = { collection: { slug: collectionSlug, active: true }, product };
    return prisma.$transaction([
      prisma.productCollection.count({ where }),
      prisma.productCollection.findMany({
        where,
        include: { product: { include: productInclude } },
        orderBy: membershipOrderBy(sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
  }

  static facetSources(collectionSlug: string, filters: ProductFilters) {
    const scoped = (omit: FacetName) => inCollection(collectionSlug, productWhere(filters, omit));
    return Promise.all([
      prisma.product.findMany({ where: scoped("team"), select: { team: true } }),
      prisma.product.findMany({
        where: scoped("driver"),
        select: { drivers: { select: { driver: true } } },
      }),
      prisma.product.findMany({ where: scoped("productType"), select: { category: true } }),
      prisma.product.findMany({ where: scoped("audience"), select: { audience: true } }),
      prisma.product.findMany({
        where: scoped("availability"),
        select: { variants: { where: { stockQuantity: { gt: 0 } }, select: { id: true }, take: 1 } },
      }),
      prisma.product.findMany({ where: scoped("price"), select: { priceIdr: true } }),
    ]);
  }

  static findProduct(slug: string) {
    return prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, include: productInclude });
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
