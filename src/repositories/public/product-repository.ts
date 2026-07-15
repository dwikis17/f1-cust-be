import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import { storedPhotoUrl } from "../../photo-storage.js";

const productInclude = {
  category: true,
  team: true,
  driver: true,
  tags: { include: { tag: true } },
  variants: { orderBy: [{ color: "asc" as const }, { size: "asc" as const }] },
  photos: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};

export type ProductFilters = {
  search?: string;
  category?: string;
  tag?: string;
  team?: string;
  driver?: string;
  size?: string;
  color?: string;
};

export class PublicProductRepository {
  static storedPhotoUrl(value: string) { return storedPhotoUrl(value); }
  static listProducts(filters: ProductFilters, page: number, limit: number) {
    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
        ],
      }),
      ...(filters.category && { category: { slug: filters.category } }),
      ...(filters.tag && { tags: { some: { tag: { slug: filters.tag } } } }),
      ...(filters.team && { team: { slug: filters.team } }),
      ...(filters.driver && { driver: { slug: filters.driver } }),
      ...((filters.size || filters.color) && {
        variants: { some: { ...(filters.size && { size: filters.size }), ...(filters.color && { color: filters.color }) } },
      }),
    };
    return prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
  }
  static findProduct(slug: string) {
    return prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, include: productInclude });
  }
}
