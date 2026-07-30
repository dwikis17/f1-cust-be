import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { prisma } from "../db.js";
import { HttpError, notFound } from "../http.js";
import { storedPhotoUrl } from "../photo-storage.js";
import { MediaRepository } from "../repositories/admin/media-repository.js";
import type { homeHeroOrderSchema, homeHeroSchema } from "../schemas.js";
import { MediaService } from "./admin/media-service.js";

const MAX_ACTIVE_CAMPAIGNS = 6;

type HomeHeroInput = z.infer<typeof homeHeroSchema>;
type HomeHeroOrder = z.infer<typeof homeHeroOrderSchema>;
type HeroImages = {
  desktopImage?: Express.Multer.File;
  mobileImage?: Express.Multer.File;
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
