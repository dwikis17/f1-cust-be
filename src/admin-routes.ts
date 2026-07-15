import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAdmin } from "./auth.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { HttpError, notFound, parse } from "./http.js";
import { deletePhoto, photoKey, storePhoto } from "./photo-storage.js";
import { createSessionToken, hashToken, verifyPassword } from "./security.js";
import {
  catalogEntityPatchSchema,
  catalogEntitySchema,
  driverPatchSchema,
  driverSchema,
  idSchema,
  photoPatchSchema,
  productPatchSchema,
  productSchema,
  teamPatchSchema,
  teamSchema,
  variantPatchSchema,
  variantSchema,
} from "./schemas.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(200) }).strict();
// ponytail: process-local rate limits are enough for one API instance; move to Redis before horizontal scaling.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const productInclude = {
  category: true,
  team: true,
  driver: true,
  tags: { include: { tag: true } },
  variants: { orderBy: [{ color: "asc" as const }, { size: "asc" as const }] },
  photos: { orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] },
};

async function validateProductTeamDriver(teamId?: string | null, driverId?: string | null) {
  if (!driverId) return;
  if (!teamId) throw new HttpError(400, "DRIVER_REQUIRES_TEAM", "A driver product must also have a team");
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { teamId: true } });
  if (!driver) throw new HttpError(400, "UNKNOWN_DRIVER", "Driver does not exist");
  if (driver.teamId !== teamId) {
    throw new HttpError(400, "DRIVER_TEAM_MISMATCH", "Driver must belong to the product team when assigned");
  }
}

function checkLoginRate(ip: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return;
  }
  if (attempt.count >= 5) throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Try again later");
  attempt.count += 1;
}

router.post("/auth/login", async (request, response) => {
  const input = parse(loginSchema, request.body);
  const key = request.ip ?? "unknown";
  checkLoginRate(key);
  const admin = await prisma.admin.findUnique({ where: { email: input.email.toLowerCase() } });
  const passwordValid = await verifyPassword(
    input.password,
    admin?.passwordSalt ?? "00000000000000000000000000000000",
    admin?.passwordHash ?? "00".repeat(64),
  );
  if (!admin || !admin.active || !passwordValid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  loginAttempts.delete(key);
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await prisma.adminSession.create({ data: { adminId: admin.id, tokenHash: hashToken(token), expiresAt } });
  response.json({ token, expiresAt, admin: { id: admin.id, email: admin.email, displayName: admin.displayName } });
});

router.use(requireAdmin);

router.post("/auth/logout", async (_request, response) => {
  await prisma.adminSession.delete({ where: { id: response.locals.sessionId } });
  response.status(204).send();
});

router.get("/auth/me", (_request, response) => response.json(response.locals.admin));

router.get("/categories", async (_request, response) => response.json(await prisma.category.findMany({ orderBy: { name: "asc" } })));
router.post("/categories", async (request, response) => {
  response.status(201).json(await prisma.category.create({ data: parse(catalogEntitySchema, request.body) }));
});
router.patch("/categories/:id", async (request, response) => {
  response.json(await prisma.category.update({ where: { id: parse(idSchema, request.params.id) }, data: parse(catalogEntityPatchSchema, request.body) }));
});
router.delete("/categories/:id", async (request, response) => {
  await prisma.category.delete({ where: { id: parse(idSchema, request.params.id) } });
  response.status(204).send();
});

router.get("/tags", async (_request, response) => response.json(await prisma.tag.findMany({ orderBy: { name: "asc" } })));
router.post("/tags", async (request, response) => {
  response.status(201).json(await prisma.tag.create({ data: parse(catalogEntitySchema, request.body) }));
});
router.patch("/tags/:id", async (request, response) => {
  response.json(await prisma.tag.update({ where: { id: parse(idSchema, request.params.id) }, data: parse(catalogEntityPatchSchema, request.body) }));
});
router.delete("/tags/:id", async (request, response) => {
  await prisma.tag.delete({ where: { id: parse(idSchema, request.params.id) } });
  response.status(204).send();
});

router.get("/teams", async (_request, response) => response.json(await prisma.team.findMany({ orderBy: { name: "asc" } })));
router.post("/teams", async (request, response) => {
  response.status(201).json(await prisma.team.create({ data: parse(teamSchema, request.body) }));
});
router.patch("/teams/:id", async (request, response) => {
  response.json(await prisma.team.update({ where: { id: parse(idSchema, request.params.id) }, data: parse(teamPatchSchema, request.body) }));
});
router.delete("/teams/:id", async (request, response) => {
  await prisma.team.delete({ where: { id: parse(idSchema, request.params.id) } });
  response.status(204).send();
});

router.get("/drivers", async (_request, response) => {
  response.json(await prisma.driver.findMany({ include: { team: true }, orderBy: { name: "asc" } }));
});
router.post("/drivers", async (request, response) => {
  response.status(201).json(await prisma.driver.create({ data: parse(driverSchema, request.body), include: { team: true } }));
});
router.patch("/drivers/:id", async (request, response) => {
  response.json(await prisma.driver.update({
    where: { id: parse(idSchema, request.params.id) },
    data: parse(driverPatchSchema, request.body),
    include: { team: true },
  }));
});
router.delete("/drivers/:id", async (request, response) => {
  await prisma.driver.delete({ where: { id: parse(idSchema, request.params.id) } });
  response.status(204).send();
});

router.get("/products", async (_request, response) => {
  response.json(await prisma.product.findMany({ include: productInclude, orderBy: { createdAt: "desc" } }));
});

router.get("/products/:id", async (request, response) => {
  const product = await prisma.product.findUnique({ where: { id: parse(idSchema, request.params.id) }, include: productInclude });
  if (!product) notFound("Product not found");
  response.json(product);
});

router.post("/products", async (request, response) => {
  const input = parse(productSchema, request.body);
  const { tagIds, variants, ...product } = input;
  await validateProductTeamDriver(product.teamId, product.driverId);
  const created = await prisma.product.create({
    data: {
      ...product,
      tags: { create: [...new Set(tagIds)].map((tagId) => ({ tag: { connect: { id: tagId } } })) },
      variants: { create: variants },
    },
    include: productInclude,
  });
  response.status(201).json(created);
});

router.patch("/products/:id", async (request, response) => {
  const id = parse(idSchema, request.params.id);
  const input = parse(productPatchSchema, request.body);
  const { tagIds, ...product } = input;
  if (product.teamId !== undefined || product.driverId !== undefined) {
    const current = await prisma.product.findUnique({ where: { id }, select: { teamId: true, driverId: true } });
    if (!current) notFound("Product not found");
    await validateProductTeamDriver(
      product.teamId === undefined ? current.teamId : product.teamId,
      product.driverId === undefined ? current.driverId : product.driverId,
    );
  }
  const uniqueTagIds = tagIds ? [...new Set(tagIds)] : undefined;
  if (uniqueTagIds && await prisma.tag.count({ where: { id: { in: uniqueTagIds } } }) !== uniqueTagIds.length) {
    throw new HttpError(400, "UNKNOWN_TAG", "Every tag must exist before it can be assigned");
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (uniqueTagIds) {
      await tx.productTag.deleteMany({ where: { productId: id } });
      await tx.productTag.createMany({ data: uniqueTagIds.map((tagId) => ({ productId: id, tagId })) });
    }
    return tx.product.update({ where: { id }, data: product, include: productInclude });
  });
  response.json(updated);
});

router.post("/products/:productId/variants", async (request, response) => {
  const productId = parse(idSchema, request.params.productId);
  response.status(201).json(await prisma.productVariant.create({ data: { ...parse(variantSchema, request.body), productId } }));
});

router.patch("/products/:productId/variants/:id", async (request, response) => {
  const productId = parse(idSchema, request.params.productId);
  const id = parse(idSchema, request.params.id);
  const existing = await prisma.productVariant.findFirst({ where: { id, productId } });
  if (!existing) notFound("Variant not found");
  response.json(await prisma.productVariant.update({ where: { id }, data: parse(variantPatchSchema, request.body) }));
});

router.delete("/products/:productId/variants/:id", async (request, response) => {
  const productId = parse(idSchema, request.params.productId);
  const id = parse(idSchema, request.params.id);
  const result = await prisma.productVariant.deleteMany({ where: { id, productId } });
  if (!result.count) notFound("Variant not found");
  response.status(204).send();
});

function imageExtension(buffer: Buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

router.post("/products/:productId/photos", upload.single("photo"), async (request, response) => {
  const productId = parse(idSchema, request.params.productId);
  if (!request.file) throw new HttpError(400, "PHOTO_REQUIRED", "A photo file is required");
  const extension = imageExtension(request.file.buffer);
  if (!extension) throw new HttpError(400, "INVALID_IMAGE", "Only valid JPEG, PNG, and WebP images are allowed");
  const metadata = parse(z.object({
    color: z.string().trim().min(1).max(60).optional(),
    altText: z.string().trim().min(1).max(240),
    position: z.coerce.number().int().nonnegative().default(0),
  }).strict(), request.body);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound("Product not found");
  if (await prisma.productPhoto.count({ where: { productId } }) >= config.maxPhotosPerProduct) {
    throw new HttpError(409, "PHOTO_LIMIT", "Product photo limit reached");
  }
  if (metadata.color && !(await prisma.productVariant.findFirst({ where: { productId, color: metadata.color } }))) {
    throw new HttpError(400, "UNKNOWN_COLOR", "Photo color must match a product variant");
  }

  const filename = photoKey(`${randomUUID()}.${extension}`);
  const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  await storePhoto(filename, request.file.buffer, contentType);
  try {
    const photo = await prisma.productPhoto.create({ data: { productId, path: filename, ...metadata } });
    response.status(201).json({ ...photo, url: `/uploads/${filename}` });
  } catch (error) {
    await deletePhoto(filename).catch(() => undefined);
    throw error;
  }
});

router.patch("/products/:productId/photos/:id", async (request, response) => {
  const productId = parse(idSchema, request.params.productId);
  const id = parse(idSchema, request.params.id);
  const input = parse(photoPatchSchema, request.body);
  if (input.color && !(await prisma.productVariant.findFirst({ where: { productId, color: input.color } }))) {
    throw new HttpError(400, "UNKNOWN_COLOR", "Photo color must match a product variant");
  }
  const existing = await prisma.productPhoto.findFirst({ where: { id, productId } });
  if (!existing) notFound("Photo not found");
  response.json(await prisma.productPhoto.update({ where: { id }, data: input }));
});

router.delete("/products/:productId/photos/:id", async (request, response) => {
  const productId = parse(idSchema, request.params.productId);
  const id = parse(idSchema, request.params.id);
  const photo = await prisma.productPhoto.findFirst({ where: { id, productId } });
  if (!photo) notFound("Photo not found");
  await prisma.productPhoto.delete({ where: { id } });
  await deletePhoto(photo.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") console.error("Could not remove photo file", error);
  });
  response.status(204).send();
});

export default router;
