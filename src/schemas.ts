import { z } from "zod";

export const idSchema = z.string().uuid();
export const slugSchema = z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const nameSchema = z.string().trim().min(1).max(120);
const urlSchema = z.union([
  z.string().url().max(2048),
  z.string().max(2048).regex(/^\/uploads\/[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(?:jpe?g|png|webp)$/),
]);

export const catalogEntitySchema = z.object({ name: nameSchema, slug: slugSchema }).strict();
export const catalogEntityPatchSchema = catalogEntitySchema.partial().refine((value) => Object.keys(value).length > 0);
export const teamSchema = catalogEntitySchema.extend({ logoUrl: urlSchema.nullable().optional() });
export const teamPatchSchema = teamSchema.partial().refine((value) => Object.keys(value).length > 0);
export const driverSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  racingNumber: z.number().int().min(1).max(99),
  photoUrl: urlSchema.nullable().optional(),
  teamId: idSchema.nullable().optional(),
}).strict();
export const driverPatchSchema = driverSchema.partial().refine((value) => Object.keys(value).length > 0);

export const productAudienceSchema = z.enum(["MEN", "WOMEN", "KIDS", "UNISEX"]);
export const localeSchema = z.enum(["en", "id"]);
export const collectionKindSchema = z.enum([
  "DOMAIN",
  "TEAM",
  "DRIVER",
  "MERCHANDISE",
  "BRAND",
  "PROMOTION",
  "MANUAL",
]);
export const collectionSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  kind: collectionKindSchema,
  teamId: idSchema.nullable().optional(),
  driverId: idSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
  imageUrl: urlSchema.nullable().optional(),
  description: z.string().trim().max(5_000).default(""),
  position: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
}).strict();
export const collectionPatchSchema = collectionSchema.partial().refine((value) => Object.keys(value).length > 0);
export const collectionMembershipSchema = z.object({
  productIds: z.array(idSchema).max(10_000),
  featuredProductIds: z.array(idSchema).max(10_000).default([]),
}).strict().superRefine((value, context) => {
  const products = new Set(value.productIds);
  if (value.featuredProductIds.some((id) => !products.has(id))) {
    context.addIssue({
      code: "custom",
      path: ["featuredProductIds"],
      message: "Featured products must also belong to the collection",
    });
  }
});

export const sizingGuideSchema = z.object({
  unit: z.enum(["cm", "in"]),
  measurements: z.record(z.string().trim().min(1).max(50), z.number().positive()).refine((value) => Object.keys(value).length > 0),
}).strict();

const variantBaseSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  size: z.string().trim().min(1).max(40).nullable().optional(),
  color: z.string().trim().min(1).max(60).nullable().optional(),
  stockQuantity: z.number().int().nonnegative(),
  packageLengthMm: z.number().int().positive(),
  packageWidthMm: z.number().int().positive(),
  packageHeightMm: z.number().int().positive(),
  packageWeightG: z.number().int().positive(),
  sizingGuide: sizingGuideSchema.nullable().optional(),
}).strict();
export const variantSchema = variantBaseSchema.superRefine((value, context) => {
  if (value.size && !value.sizingGuide) {
    context.addIssue({ code: "custom", path: ["sizingGuide"], message: "A sized variant requires a sizing guide" });
  }
});
export const variantPatchSchema = variantBaseSchema.partial().refine((value) => Object.keys(value).length > 0);

export const productSchema = z.object({
  name: nameSchema,
  nameId: nameSchema.nullable().optional(),
  slug: slugSchema,
  description: z.string().trim().max(10_000).default(""),
  descriptionId: z.string().trim().max(10_000).nullable().optional(),
  priceIdr: z.number().int().nonnegative(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  categoryId: idSchema,
  teamId: idSchema.nullable().optional(),
  driverIds: z.array(idSchema).max(50).default([]),
  collectionIds: z.array(idSchema).max(100).default([]),
  audience: productAudienceSchema.nullable().optional(),
  tagIds: z.array(idSchema).max(30).default([]),
  variants: z.array(variantSchema).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (value.status !== "ACTIVE") return;
  if (!value.audience) context.addIssue({ code: "custom", path: ["audience"], message: "Active products require an audience" });
  if (value.collectionIds.length === 0) {
    context.addIssue({ code: "custom", path: ["collectionIds"], message: "Active products require a collection" });
  }
  if (value.variants.length === 0) {
    context.addIssue({ code: "custom", path: ["variants"], message: "Active products require a purchasable variant" });
  }
});

export const productPatchSchema = z.object({
  name: nameSchema.optional(),
  nameId: nameSchema.nullable().optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(10_000).optional(),
  descriptionId: z.string().trim().max(10_000).nullable().optional(),
  priceIdr: z.number().int().nonnegative().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  categoryId: idSchema.optional(),
  teamId: idSchema.nullable().optional(),
  driverIds: z.array(idSchema).max(50).optional(),
  collectionIds: z.array(idSchema).max(100).optional(),
  audience: productAudienceSchema.nullable().optional(),
  tagIds: z.array(idSchema).max(30).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export const photoPatchSchema = z.object({
  color: z.string().trim().min(1).max(60).nullable().optional(),
  altText: z.string().trim().min(1).max(240).optional(),
  position: z.number().int().nonnegative().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
