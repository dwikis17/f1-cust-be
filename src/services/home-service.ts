import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, notFound } from "../http.js";
import { storedPhotoUrl } from "../photo-storage.js";
import { MediaRepository } from "../repositories/admin/media-repository.js";
import { PublicProductRepository } from "../repositories/public/product-repository.js";
import type {
  homeCollectionBlockSchema,
  homeHeroOrderSchema,
  homeHeroSchema,
} from "../schemas.js";
import { MediaService } from "./admin/media-service.js";
import { PublicProductService } from "./public/product-service.js";

const MAX_ACTIVE_CAMPAIGNS = 6;
const MAX_ACTIVE_COLLECTION_BLOCKS = 3;

type HomeHeroInput = z.infer<typeof homeHeroSchema>;
type HomeHeroOrder = z.infer<typeof homeHeroOrderSchema>;
type HomeCollectionBlockInput = z.infer<typeof homeCollectionBlockSchema>;
type HeroImages = {
  desktopImage?: Express.Multer.File;
  mobileImage?: Express.Multer.File;
};
type CollectionBlockImages = {
  leadImage?: Express.Multer.File;
  sideImageOne?: Express.Multer.File;
  sideImageTwo?: Express.Multer.File;
};

async function removeUploaded(keys: string[]) {
  await Promise.all(keys.map((key) => MediaRepository.deletePhoto(key).catch(() => undefined)));
}

async function validateCollection(collectionId: string) {
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, active: true } });
  if (!collection) throw new HttpError(400, "ACTIVE_COLLECTION_REQUIRED", "Choose an active collection");
}

async function validateActiveLimit(active: boolean, wasActive = false) {
  if (!active || wasActive) return;
  if (await prisma.homeHero.count({ where: { active: true } }) >= MAX_ACTIVE_CAMPAIGNS) {
    throw new HttpError(409, "ACTIVE_CAMPAIGN_LIMIT", `Only ${MAX_ACTIVE_CAMPAIGNS} campaigns can be active`);
  }
}

async function storeImages(images: HeroImages, current?: { desktopImageUrl: string; mobileImageUrl: string }) {
  if (!current && (!images.desktopImage || !images.mobileImage)) {
    throw new HttpError(400, "HERO_IMAGES_REQUIRED", "Desktop and mobile images are required");
  }
  const desktopType = images.desktopImage ? MediaService.validateImage(images.desktopImage) : undefined;
  const mobileType = images.mobileImage ? MediaService.validateImage(images.mobileImage) : undefined;
  const desktopKey = desktopType
    ? MediaRepository.photoKey(`home-desktop-${randomUUID()}.${desktopType.extension}`)
    : undefined;
  const mobileKey = mobileType
    ? MediaRepository.photoKey(`home-mobile-${randomUUID()}.${mobileType.extension}`)
    : undefined;
  const keys = [desktopKey, mobileKey].filter((key): key is string => Boolean(key));
  const uploads = await Promise.allSettled([
    desktopKey && MediaRepository.storePhoto(desktopKey, images.desktopImage!.buffer, desktopType!.contentType),
    mobileKey && MediaRepository.storePhoto(mobileKey, images.mobileImage!.buffer, mobileType!.contentType),
  ]);
  const failed = uploads.find((upload) => upload.status === "rejected");
  if (failed?.status === "rejected") {
    await removeUploaded(keys);
    throw failed.reason;
  }
  return {
    keys,
    desktopImageUrl: desktopKey ? MediaRepository.photoUrl(desktopKey) : current!.desktopImageUrl,
    mobileImageUrl: mobileKey ? MediaRepository.photoUrl(mobileKey) : current!.mobileImageUrl,
  };
}

const includeCollection = { collection: true } as const;
const orderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

export class HomeService {
  static listAdmin() {
    return prisma.homeHero.findMany({ include: includeCollection, orderBy });
  }

  static async listPublic(locale: "en" | "id") {
    const heroes = await prisma.homeHero.findMany({
      where: { active: true, collection: { active: true } },
      include: includeCollection,
      orderBy,
      take: MAX_ACTIVE_CAMPAIGNS,
    });
    return heroes.map((hero) => ({
      id: hero.id,
      eyebrow: locale === "id" ? hero.eyebrowId ?? hero.eyebrow : hero.eyebrow,
      title: locale === "id" ? hero.titleId ?? hero.title : hero.title,
      outlinedTitle: locale === "id" ? hero.outlinedTitleId ?? hero.outlinedTitle : hero.outlinedTitle,
      body: locale === "id" ? hero.bodyId ?? hero.body : hero.body,
      ctaLabel: locale === "id" ? hero.ctaLabelId ?? hero.ctaLabel : hero.ctaLabel,
      desktopImageUrl: storedPhotoUrl(hero.desktopImageUrl),
      mobileImageUrl: storedPhotoUrl(hero.mobileImageUrl),
      collection: { name: hero.collection!.name, slug: hero.collection!.slug },
    }));
  }

  static async create(input: HomeHeroInput, images: HeroImages) {
    await Promise.all([validateCollection(input.collectionId), validateActiveLimit(input.active)]);
    const stored = await storeImages(images);
    try {
      const last = await prisma.homeHero.aggregate({ _max: { position: true } });
      return await prisma.homeHero.create({
        data: {
          ...input,
          desktopImageUrl: stored.desktopImageUrl,
          mobileImageUrl: stored.mobileImageUrl,
          position: (last._max.position ?? -1) + 1,
        },
        include: includeCollection,
      });
    } catch (error) {
      await removeUploaded(stored.keys);
      throw error;
    }
  }

  static async update(id: string, input: HomeHeroInput, images: HeroImages) {
    const current = await prisma.homeHero.findUnique({ where: { id } });
    if (!current) notFound("Campaign not found");
    await Promise.all([
      validateCollection(input.collectionId),
      validateActiveLimit(input.active, current.active),
    ]);
    const stored = await storeImages(images, current);
    let updated;
    try {
      updated = await prisma.homeHero.update({
        where: { id },
        data: { ...input, desktopImageUrl: stored.desktopImageUrl, mobileImageUrl: stored.mobileImageUrl },
        include: includeCollection,
      });
    } catch (error) {
      await removeUploaded(stored.keys);
      throw error;
    }
    await Promise.all([
      images.desktopImage ? MediaService.deleteManagedImage(current.desktopImageUrl) : undefined,
      images.mobileImage ? MediaService.deleteManagedImage(current.mobileImageUrl) : undefined,
    ]);
    return updated;
  }

  static async setActive(id: string, active: boolean) {
    const current = await prisma.homeHero.findUnique({ where: { id }, include: includeCollection });
    if (!current) notFound("Campaign not found");
    if (active && !current.collection?.active) {
      throw new HttpError(400, "ACTIVE_COLLECTION_REQUIRED", "Choose an active collection before enabling this campaign");
    }
    await validateActiveLimit(active, current.active);
    return prisma.homeHero.update({ where: { id }, data: { active }, include: includeCollection });
  }

  static async reorder(input: HomeHeroOrder) {
    const campaigns = await prisma.homeHero.findMany({ select: { id: true }, orderBy });
    const currentIds = new Set(campaigns.map((campaign) => campaign.id));
    if (
      input.ids.length !== campaigns.length
      || new Set(input.ids).size !== input.ids.length
      || input.ids.some((id) => !currentIds.has(id))
    ) {
      throw new HttpError(400, "INVALID_CAMPAIGN_ORDER", "Order must contain every campaign exactly once");
    }
    await prisma.$transaction(input.ids.map((id, position) => prisma.homeHero.update({
      where: { id },
      data: { position },
    })));
    return HomeService.listAdmin();
  }

  static async remove(id: string) {
    const campaign = await prisma.homeHero.findUnique({ where: { id } });
    if (!campaign) notFound("Campaign not found");
    await prisma.homeHero.delete({ where: { id } });
    const remaining = await prisma.homeHero.findMany({ select: { id: true }, orderBy });
    await prisma.$transaction(remaining.map((item, position) => prisma.homeHero.update({
      where: { id: item.id },
      data: { position },
    })));
    await Promise.all([
      MediaService.deleteManagedImage(campaign.desktopImageUrl),
      MediaService.deleteManagedImage(campaign.mobileImageUrl),
    ]);
  }
}

async function validateBlockCollection(collectionId: string, currentId?: string) {
  const [collection, duplicate] = await Promise.all([
    prisma.collection.findFirst({ where: { id: collectionId, active: true } }),
    prisma.homeCollectionBlock.findUnique({ where: { collectionId } }),
  ]);
  if (!collection) throw new HttpError(400, "ACTIVE_COLLECTION_REQUIRED", "Choose an active collection");
  if (duplicate && duplicate.id !== currentId) {
    throw new HttpError(409, "COLLECTION_BLOCK_EXISTS", "This collection already has a home block");
  }
}

async function validateActiveBlockLimit(active: boolean, wasActive = false) {
  if (!active || wasActive) return;
  if (await prisma.homeCollectionBlock.count({ where: { active: true } }) >= MAX_ACTIVE_COLLECTION_BLOCKS) {
    throw new HttpError(
      409,
      "ACTIVE_COLLECTION_BLOCK_LIMIT",
      `Only ${MAX_ACTIVE_COLLECTION_BLOCKS} collection blocks can be active`,
    );
  }
}

async function storeBlockImages(
  images: CollectionBlockImages,
  current?: { leadImageUrl: string; sideImageOneUrl: string; sideImageTwoUrl: string },
) {
  if (!current && (!images.leadImage || !images.sideImageOne || !images.sideImageTwo)) {
    throw new HttpError(400, "COLLECTION_BLOCK_IMAGES_REQUIRED", "Lead and both side images are required");
  }
  const uploads = [
    ["leadImageUrl", "home-collection-lead", images.leadImage],
    ["sideImageOneUrl", "home-collection-side-one", images.sideImageOne],
    ["sideImageTwoUrl", "home-collection-side-two", images.sideImageTwo],
  ] as const;
  const entries = uploads.flatMap(([field, prefix, file]) => {
    if (!file) return [];
    const type = MediaService.validateImage(file);
    const key = MediaRepository.photoKey(`${prefix}-${randomUUID()}.${type.extension}`);
    return [{ field, file, key, contentType: type.contentType }];
  });
  const stored = await Promise.allSettled(
    entries.map(({ file, key, contentType }) => MediaRepository.storePhoto(key, file.buffer, contentType)),
  );
  const failed = stored.find((upload) => upload.status === "rejected");
  if (failed?.status === "rejected") {
    await removeUploaded(entries.map(({ key }) => key));
    throw failed.reason;
  }
  const urls = Object.fromEntries(entries.map(({ field, key }) => [field, MediaRepository.photoUrl(key)]));
  return {
    keys: entries.map(({ key }) => key),
    leadImageUrl: urls.leadImageUrl ?? current!.leadImageUrl,
    sideImageOneUrl: urls.sideImageOneUrl ?? current!.sideImageOneUrl,
    sideImageTwoUrl: urls.sideImageTwoUrl ?? current!.sideImageTwoUrl,
  };
}

const includeBlockCollection = { collection: true } as const;
const blockOrderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

export class HomeCollectionBlockService {
  static listAdmin() {
    return prisma.homeCollectionBlock.findMany({ include: includeBlockCollection, orderBy: blockOrderBy });
  }

  static async listPublic(locale: "en" | "id") {
    const blocks = await prisma.homeCollectionBlock.findMany({
      where: { active: true, collection: { active: true } },
      include: includeBlockCollection,
      orderBy: blockOrderBy,
      take: MAX_ACTIVE_COLLECTION_BLOCKS,
    });
    const values = await Promise.all(blocks.map(async (block) => {
      const [, memberships] = await PublicProductRepository.listCollectionProducts(
        block.collection!.slug,
        {},
        "featured",
        1,
        5,
      );
      if (!memberships.length) return null;
      const collection = block.collection!;
      return {
        id: block.id,
        leadImageUrl: storedPhotoUrl(block.leadImageUrl),
        sideImageOneUrl: storedPhotoUrl(block.sideImageOneUrl),
        sideImageTwoUrl: storedPhotoUrl(block.sideImageTwoUrl),
        collection: {
          name: collection.name,
          slug: collection.slug,
          description: locale === "id" ? collection.descriptionId ?? collection.description : collection.description,
        },
        products: memberships.map(({ product }) => PublicProductService.publicProduct(product, locale)),
      };
    }));
    return values.filter((value) => value !== null);
  }

  static async create(input: HomeCollectionBlockInput, images: CollectionBlockImages) {
    await Promise.all([
      validateBlockCollection(input.collectionId),
      validateActiveBlockLimit(input.active),
    ]);
    const stored = await storeBlockImages(images);
    try {
      const last = await prisma.homeCollectionBlock.aggregate({ _max: { position: true } });
      return await prisma.homeCollectionBlock.create({
        data: {
          ...input,
          leadImageUrl: stored.leadImageUrl,
          sideImageOneUrl: stored.sideImageOneUrl,
          sideImageTwoUrl: stored.sideImageTwoUrl,
          position: (last._max.position ?? -1) + 1,
        },
        include: includeBlockCollection,
      });
    } catch (error) {
      await removeUploaded(stored.keys);
      throw error;
    }
  }

  static async update(id: string, input: HomeCollectionBlockInput, images: CollectionBlockImages) {
    const current = await prisma.homeCollectionBlock.findUnique({ where: { id } });
    if (!current) notFound("Collection block not found");
    await Promise.all([
      validateBlockCollection(input.collectionId, id),
      validateActiveBlockLimit(input.active, current.active),
    ]);
    const stored = await storeBlockImages(images, current);
    let updated;
    try {
      updated = await prisma.homeCollectionBlock.update({
        where: { id },
        data: {
          ...input,
          leadImageUrl: stored.leadImageUrl,
          sideImageOneUrl: stored.sideImageOneUrl,
          sideImageTwoUrl: stored.sideImageTwoUrl,
        },
        include: includeBlockCollection,
      });
    } catch (error) {
      await removeUploaded(stored.keys);
      throw error;
    }
    await Promise.all([
      images.leadImage ? MediaService.deleteManagedImage(current.leadImageUrl) : undefined,
      images.sideImageOne ? MediaService.deleteManagedImage(current.sideImageOneUrl) : undefined,
      images.sideImageTwo ? MediaService.deleteManagedImage(current.sideImageTwoUrl) : undefined,
    ]);
    return updated;
  }

  static async setActive(id: string, active: boolean) {
    const current = await prisma.homeCollectionBlock.findUnique({ where: { id }, include: includeBlockCollection });
    if (!current) notFound("Collection block not found");
    if (active && !current.collection?.active) {
      throw new HttpError(400, "ACTIVE_COLLECTION_REQUIRED", "Choose an active collection before enabling this block");
    }
    await validateActiveBlockLimit(active, current.active);
    return prisma.homeCollectionBlock.update({
      where: { id },
      data: { active },
      include: includeBlockCollection,
    });
  }

  static async reorder(input: HomeHeroOrder) {
    const blocks = await prisma.homeCollectionBlock.findMany({ select: { id: true }, orderBy: blockOrderBy });
    const currentIds = new Set(blocks.map((block) => block.id));
    if (
      input.ids.length !== blocks.length
      || new Set(input.ids).size !== input.ids.length
      || input.ids.some((id) => !currentIds.has(id))
    ) {
      throw new HttpError(400, "INVALID_COLLECTION_BLOCK_ORDER", "Order must contain every block exactly once");
    }
    await prisma.$transaction(input.ids.map((id, position) => prisma.homeCollectionBlock.update({
      where: { id },
      data: { position },
    })));
    return HomeCollectionBlockService.listAdmin();
  }

  static async remove(id: string) {
    const block = await prisma.homeCollectionBlock.findUnique({ where: { id } });
    if (!block) notFound("Collection block not found");
    await prisma.homeCollectionBlock.delete({ where: { id } });
    const remaining = await prisma.homeCollectionBlock.findMany({ select: { id: true }, orderBy: blockOrderBy });
    await prisma.$transaction(remaining.map((item, position) => prisma.homeCollectionBlock.update({
      where: { id: item.id },
      data: { position },
    })));
    await Promise.all([
      MediaService.deleteManagedImage(block.leadImageUrl),
      MediaService.deleteManagedImage(block.sideImageOneUrl),
      MediaService.deleteManagedImage(block.sideImageTwoUrl),
    ]);
  }
}
