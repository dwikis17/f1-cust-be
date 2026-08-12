import type { z } from "zod";
import { prisma } from "../db.js";
import type { homeCollectionBlockSchema, homeHeroOrderSchema, homeHeroSchema } from "../schemas.js";

export type HomeHeroInput = z.infer<typeof homeHeroSchema>;
export type HomeHeroOrder = z.infer<typeof homeHeroOrderSchema>;
export type HomeCollectionBlockInput = z.infer<typeof homeCollectionBlockSchema>;
export type StoredHeroImages = { desktopImageUrl: string; mobileImageUrl: string };
export type StoredCollectionBlockImages = {
  leadImageUrl: string;
  sideImageOneUrl: string;
  sideImageTwoUrl: string;
};

const includeCollection = { collection: true } as const;
const heroOrderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
const blockOrderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
const includeBlockCollection = { collection: true } as const;

export class HomeRepository {
  static findActiveCollection(id: string) {
    return prisma.collection.findFirst({ where: { id, active: true } });
  }

  static countActiveHeroes() {
    return prisma.homeHero.count({ where: { active: true } });
  }

  static listHeroes() {
    return prisma.homeHero.findMany({ include: includeCollection, orderBy: heroOrderBy });
  }

  static listPublicHeroes(limit: number) {
    return prisma.homeHero.findMany({
      where: { active: true, collection: { active: true } },
      include: includeCollection,
      orderBy: heroOrderBy,
      take: limit,
    });
  }

  static findHero(id: string) {
    return prisma.homeHero.findUnique({ where: { id } });
  }

  static findHeroWithCollection(id: string) {
    return prisma.homeHero.findUnique({ where: { id }, include: includeCollection });
  }

  static nextHeroPosition() {
    return prisma.homeHero.aggregate({ _max: { position: true } });
  }

  static createHero(input: HomeHeroInput, images: StoredHeroImages, position: number) {
    return prisma.homeHero.create({
      data: { ...input, ...images, position },
      include: includeCollection,
    });
  }

  static updateHero(id: string, input: HomeHeroInput, images: StoredHeroImages) {
    return prisma.homeHero.update({
      where: { id },
      data: { ...input, ...images },
      include: includeCollection,
    });
  }

  static setHeroActive(id: string, active: boolean) {
    return prisma.homeHero.update({ where: { id }, data: { active }, include: includeCollection });
  }

  static listHeroIds() {
    return prisma.homeHero.findMany({ select: { id: true }, orderBy: heroOrderBy });
  }

  static reorderHeroes(ids: string[]) {
    return prisma.$transaction(ids.map((id, position) => prisma.homeHero.update({
      where: { id },
      data: { position },
    })));
  }

  static deleteHero(id: string) {
    return prisma.homeHero.delete({ where: { id } });
  }

  static findActiveCollectionAndBlock(collectionId: string) {
    return Promise.all([
      prisma.collection.findFirst({ where: { id: collectionId, active: true } }),
      prisma.homeCollectionBlock.findUnique({ where: { collectionId } }),
    ]);
  }

  static countActiveBlocks() {
    return prisma.homeCollectionBlock.count({ where: { active: true } });
  }

  static listBlocks() {
    return prisma.homeCollectionBlock.findMany({ include: includeBlockCollection, orderBy: blockOrderBy });
  }

  static listPublicBlocks(limit: number) {
    return prisma.homeCollectionBlock.findMany({
      where: { active: true, collection: { active: true } },
      include: includeBlockCollection,
      orderBy: blockOrderBy,
      take: limit,
    });
  }

  static findBlock(id: string) {
    return prisma.homeCollectionBlock.findUnique({ where: { id } });
  }

  static findBlockWithCollection(id: string) {
    return prisma.homeCollectionBlock.findUnique({ where: { id }, include: includeBlockCollection });
  }

  static nextBlockPosition() {
    return prisma.homeCollectionBlock.aggregate({ _max: { position: true } });
  }

  static createBlock(input: HomeCollectionBlockInput, images: StoredCollectionBlockImages, position: number) {
    return prisma.homeCollectionBlock.create({
      data: { ...input, ...images, position },
      include: includeBlockCollection,
    });
  }

  static updateBlock(id: string, input: HomeCollectionBlockInput, images: StoredCollectionBlockImages) {
    return prisma.homeCollectionBlock.update({
      where: { id },
      data: { ...input, ...images },
      include: includeBlockCollection,
    });
  }

  static setBlockActive(id: string, active: boolean) {
    return prisma.homeCollectionBlock.update({
      where: { id },
      data: { active },
      include: includeBlockCollection,
    });
  }

  static listBlockIds() {
    return prisma.homeCollectionBlock.findMany({ select: { id: true }, orderBy: blockOrderBy });
  }

  static reorderBlocks(ids: string[]) {
    return prisma.$transaction(ids.map((id, position) => prisma.homeCollectionBlock.update({
      where: { id },
      data: { position },
    })));
  }

  static deleteBlock(id: string) {
    return prisma.homeCollectionBlock.delete({ where: { id } });
  }
}
