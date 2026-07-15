import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { notFound, parse } from "./http.js";

const router = Router();
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(100).optional(),
  size: z.string().trim().max(40).optional(),
  color: z.string().trim().max(60).optional(),
}).strict();

const productInclude = {
  category: true,
  tags: { include: { tag: true } },
  variants: { orderBy: [{ color: "asc" as const }, { size: "asc" as const }] },
  photos: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};

function publicProduct(product: Awaited<ReturnType<typeof prisma.product.findFirst>> & Record<string, unknown>) {
  const value = product as any;
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    description: value.description,
    priceIdr: value.priceIdr,
    category: value.category,
    tags: value.tags.map(({ tag }: any) => tag),
    variants: value.variants.map(({ stockQuantity, ...variant }: any) => ({ ...variant, available: stockQuantity > 0 })),
    photos: value.photos.map((photo: any) => ({ ...photo, url: `/uploads/${photo.path}` })),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

router.get("/categories", async (_request, response) => {
  response.json(await prisma.category.findMany({ orderBy: { name: "asc" } }));
});

router.get("/tags", async (_request, response) => {
  response.json(await prisma.tag.findMany({ orderBy: { name: "asc" } }));
});

router.get("/products", async (request, response) => {
  const query = parse(listQuerySchema, request.query);
  const where = {
    status: "ACTIVE" as const,
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: "insensitive" as const } },
        { description: { contains: query.search, mode: "insensitive" as const } },
      ],
    }),
    ...(query.category && { category: { slug: query.category } }),
    ...(query.tag && { tags: { some: { tag: { slug: query.tag } } } }),
    ...((query.size || query.color) && {
      variants: { some: { ...(query.size && { size: query.size }), ...(query.color && { color: query.color }) } },
    }),
  };
  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  response.json({ data: products.map((product) => publicProduct(product as any)), page: query.page, limit: query.limit, total });
});

router.get("/products/:slug", async (request, response) => {
  const product = await prisma.product.findFirst({
    where: { slug: String(request.params.slug), status: "ACTIVE" },
    include: productInclude,
  });
  if (!product) notFound("Product not found");
  response.json(publicProduct(product as any));
});

export default router;
