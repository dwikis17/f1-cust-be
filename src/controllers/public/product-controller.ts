import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import type { ProductFilters, ProductSort } from "../../repositories/public/product-repository.js";
import { localeSchema, productAudienceSchema, slugSchema } from "../../schemas.js";
import { PublicProductService } from "../../services/public/product-service.js";

function listValue(value: unknown) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((item) => typeof item === "string" ? item.split(",") : []).map((item) => item.trim()).filter(Boolean);
}

const slugListSchema = z.preprocess(listValue, z.array(slugSchema).max(50));
const audienceListSchema = z.preprocess(listValue, z.array(productAudienceSchema).max(10));
const sortSchema = z.enum([
  "featured",
  "relevance",
  "name_asc",
  "name_desc",
  "price_asc",
  "price_desc",
  "newest",
  "oldest",
]);

const listQuerySchema = z.object({
  locale: localeSchema.default("en"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  productType: slugListSchema,
  category: slugListSchema,
  tag: slugListSchema,
  team: slugListSchema,
  driver: slugListSchema,
  size: z.preprocess(listValue, z.array(z.string().trim().min(1).max(40)).max(50)),
  color: z.preprocess(listValue, z.array(z.string().trim().min(1).max(60)).max(50)),
  audience: audienceListSchema,
  availability: z.enum(["in_stock"]).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: sortSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    context.addIssue({ code: "custom", path: ["minPrice"], message: "Minimum price cannot exceed maximum price" });
  }
});

function filters(query: z.infer<typeof listQuerySchema>): ProductFilters {
  return {
    search: query.search,
    productTypes: [...new Set([...query.productType, ...query.category])],
    tags: query.tag,
    teams: query.team,
    drivers: query.driver,
    sizes: query.size,
    colors: query.color,
    audiences: query.audience,
    availability: query.availability,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
  };
}

export class PublicProductController {
  static async listProducts(request: Request, response: Response) {
    const query = parse(listQuerySchema, request.query);
    response.json(await PublicProductService.listProducts(
      filters(query),
      (query.sort ?? "newest") as ProductSort,
      query.page,
      query.limit,
      query.locale,
    ));
  }
  static async listCollectionProducts(request: Request, response: Response) {
    const query = parse(listQuerySchema, request.query);
    response.json(await PublicProductService.listCollectionProducts(
      String(request.params.slug),
      filters(query),
      (query.sort ?? "featured") as ProductSort,
      query.page,
      query.limit,
      query.locale,
    ));
  }
  static async findProduct(request: Request, response: Response) {
    const query = parse(z.object({ locale: localeSchema.default("en") }).strict(), request.query);
    response.json(await PublicProductService.findProduct(String(request.params.slug), query.locale));
  }
}
