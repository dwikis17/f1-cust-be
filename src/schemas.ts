import { z } from "zod";

export const idSchema = z.string().uuid();
export const slugSchema = z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const nameSchema = z.string().trim().min(1).max(120);

export const catalogEntitySchema = z.object({ name: nameSchema, slug: slugSchema }).strict();
export const catalogEntityPatchSchema = catalogEntitySchema.partial().refine((value) => Object.keys(value).length > 0);

export const sizingGuideSchema = z.object({
  unit: z.enum(["cm", "in"]),
  measurements: z.record(z.string().trim().min(1).max(50), z.number().positive()).refine((value) => Object.keys(value).length > 0),
}).strict();

export const variantSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  size: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(60),
  stockQuantity: z.number().int().nonnegative(),
  packageLengthMm: z.number().int().positive(),
  packageWidthMm: z.number().int().positive(),
  packageHeightMm: z.number().int().positive(),
  packageWeightG: z.number().int().positive(),
  sizingGuide: sizingGuideSchema,
}).strict();
export const variantPatchSchema = variantSchema.partial().refine((value) => Object.keys(value).length > 0);

export const productSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  description: z.string().trim().max(10_000).default(""),
  priceIdr: z.number().int().nonnegative(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  categoryId: idSchema,
  tagIds: z.array(idSchema).max(30).default([]),
  variants: z.array(variantSchema).max(100).default([]),
}).strict();

export const productPatchSchema = z.object({
  name: nameSchema.optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(10_000).optional(),
  priceIdr: z.number().int().nonnegative().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  categoryId: idSchema.optional(),
  tagIds: z.array(idSchema).max(30).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export const photoPatchSchema = z.object({
  color: z.string().trim().min(1).max(60).nullable().optional(),
  altText: z.string().trim().min(1).max(240).optional(),
  position: z.number().int().nonnegative().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
