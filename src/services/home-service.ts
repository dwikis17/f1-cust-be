import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { prisma } from "../db.js";
import { HttpError } from "../http.js";
import { storedPhotoUrl } from "../photo-storage.js";
import { MediaRepository } from "../repositories/admin/media-repository.js";
import type { homeHeroSchema } from "../schemas.js";
import { MediaService } from "./admin/media-service.js";

const HOME_ID = "home";

type HomeHeroInput = z.infer<typeof homeHeroSchema>;
type HeroImages = {
  desktopImage?: Express.Multer.File;
  mobileImage?: Express.Multer.File;
};

async function removeUploaded(keys: string[]) {
  await Promise.all(keys.map((key) => MediaRepository.deletePhoto(key).catch(() => undefined)));
}

export class HomeService {
  static getAdmin() {
    return prisma.homeHero.findUnique({ where: { id: HOME_ID }, include: { collection: true } });
  }

  static async getPublic(locale: "en" | "id") {
    const hero = await prisma.homeHero.findUnique({
      where: { id: HOME_ID },
      include: { collection: true },
    });
    if (!hero?.collection?.active) return null;
    return {
      eyebrow: locale === "id" ? hero.eyebrowId ?? hero.eyebrow : hero.eyebrow,
      title: locale === "id" ? hero.titleId ?? hero.title : hero.title,
      outlinedTitle: locale === "id" ? hero.outlinedTitleId ?? hero.outlinedTitle : hero.outlinedTitle,
      body: locale === "id" ? hero.bodyId ?? hero.body : hero.body,
      ctaLabel: locale === "id" ? hero.ctaLabelId ?? hero.ctaLabel : hero.ctaLabel,
      desktopImageUrl: storedPhotoUrl(hero.desktopImageUrl),
      mobileImageUrl: storedPhotoUrl(hero.mobileImageUrl),
      collection: { name: hero.collection.name, slug: hero.collection.slug },
    };
  }

  static async save(input: HomeHeroInput, images: HeroImages) {
    const [current, collection] = await Promise.all([
      prisma.homeHero.findUnique({ where: { id: HOME_ID } }),
      prisma.collection.findFirst({ where: { id: input.collectionId, active: true } }),
    ]);
    if (!collection) throw new HttpError(400, "ACTIVE_COLLECTION_REQUIRED", "Choose an active collection");
    if (!current && (!images.desktopImage || !images.mobileImage)) {
      throw new HttpError(400, "HERO_IMAGES_REQUIRED", "Desktop and mobile images are required for the first save");
    }

    const desktopType = images.desktopImage ? MediaService.validateImage(images.desktopImage) : undefined;
    const mobileType = images.mobileImage ? MediaService.validateImage(images.mobileImage) : undefined;
    const desktopKey = desktopType ? MediaRepository.photoKey(`home-desktop-${randomUUID()}.${desktopType.extension}`) : undefined;
    const mobileKey = mobileType ? MediaRepository.photoKey(`home-mobile-${randomUUID()}.${mobileType.extension}`) : undefined;
    const newKeys = [desktopKey, mobileKey].filter((key): key is string => Boolean(key));

    const uploads = await Promise.allSettled([
      desktopKey && MediaRepository.storePhoto(desktopKey, images.desktopImage!.buffer, desktopType!.contentType),
      mobileKey && MediaRepository.storePhoto(mobileKey, images.mobileImage!.buffer, mobileType!.contentType),
    ]);
    const failedUpload = uploads.find((upload) => upload.status === "rejected");
    if (failedUpload?.status === "rejected") {
      await removeUploaded(newKeys);
      throw failedUpload.reason;
    }

    const desktopImageUrl = desktopKey ? MediaRepository.photoUrl(desktopKey) : current!.desktopImageUrl;
    const mobileImageUrl = mobileKey ? MediaRepository.photoUrl(mobileKey) : current!.mobileImageUrl;
    let updated;
    try {
      updated = await prisma.homeHero.upsert({
        where: { id: HOME_ID },
        create: { id: HOME_ID, ...input, desktopImageUrl, mobileImageUrl },
        update: { ...input, desktopImageUrl, mobileImageUrl },
        include: { collection: true },
      });
    } catch (error) {
      await removeUploaded(newKeys);
      throw error;
    }

    await Promise.all([
      desktopKey ? MediaService.deleteManagedImage(current?.desktopImageUrl) : undefined,
      mobileKey ? MediaService.deleteManagedImage(current?.mobileImageUrl) : undefined,
    ]);
    return updated;
  }
}
