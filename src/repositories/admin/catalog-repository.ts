import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import { deletePhoto } from "../../photo-storage.js";

export class CatalogRepository {
  static listCategories() { return prisma.category.findMany({ orderBy: { name: "asc" } }); }
  static createCategory(data: Prisma.CategoryCreateInput) { return prisma.category.create({ data }); }
  static updateCategory(id: string, data: Prisma.CategoryUpdateInput) { return prisma.category.update({ where: { id }, data }); }
  static deleteCategory(id: string) { return prisma.category.delete({ where: { id } }); }
  static countCategories(ids: string[]) { return prisma.category.count({ where: { id: { in: ids } } }); }

  static listTags() { return prisma.tag.findMany({ orderBy: { name: "asc" } }); }
  static createTag(data: Prisma.TagCreateInput) { return prisma.tag.create({ data }); }
  static updateTag(id: string, data: Prisma.TagUpdateInput) { return prisma.tag.update({ where: { id }, data }); }
  static deleteTag(id: string) { return prisma.tag.delete({ where: { id } }); }
  static countTags(ids: string[]) { return prisma.tag.count({ where: { id: { in: ids } } }); }

  static listTeams() { return prisma.team.findMany({ orderBy: { name: "asc" } }); }
  static findTeam(id: string) { return prisma.team.findUnique({ where: { id } }); }
  static createTeam(data: Prisma.TeamCreateInput) { return prisma.team.create({ data }); }
  static updateTeam(id: string, data: Prisma.TeamUpdateInput) { return prisma.team.update({ where: { id }, data }); }
  static deleteTeam(id: string) { return prisma.team.delete({ where: { id } }); }
  static countTeams(ids: string[]) { return prisma.team.count({ where: { id: { in: ids } } }); }

  static listDrivers() { return prisma.driver.findMany({ include: { team: true }, orderBy: { name: "asc" } }); }
  static findDriver(id: string) { return prisma.driver.findUnique({ where: { id } }); }
  static findDriverTeam(id: string) { return prisma.driver.findUnique({ where: { id }, select: { teamId: true } }); }
  static createDriver(data: Prisma.DriverUncheckedCreateInput) { return prisma.driver.create({ data, include: { team: true } }); }
  static updateDriver(id: string, data: Prisma.DriverUncheckedUpdateInput) {
    return prisma.driver.update({ where: { id }, data, include: { team: true } });
  }
  static deleteDriver(id: string) { return prisma.driver.delete({ where: { id } }); }
  static countDrivers(ids: string[]) { return prisma.driver.count({ where: { id: { in: ids } } }); }

  static listCollections() {
    return prisma.collection.findMany({
      include: { parent: true, team: true, driver: true, _count: { select: { children: true, products: true } } },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
  }
  static listCollectionHierarchy() {
    return prisma.collection.findMany({ select: { id: true, parentId: true } });
  }
  static findCollection(id: string) {
    return prisma.collection.findUnique({
      where: { id },
      include: {
        parent: true,
        team: true,
        driver: true,
        products: { include: { product: true }, orderBy: [{ position: "asc" }, { product: { name: "asc" } }] },
        _count: { select: { children: true, products: true } },
      },
    });
  }
  static createCollection(data: Prisma.CollectionUncheckedCreateInput) {
    return prisma.collection.create({
      data,
      include: { parent: true, team: true, driver: true, _count: { select: { children: true, products: true } } },
    });
  }
  static updateCollection(id: string, data: Prisma.CollectionUncheckedUpdateInput) {
    return prisma.collection.update({
      where: { id },
      data,
      include: { parent: true, team: true, driver: true, _count: { select: { children: true, products: true } } },
    });
  }
  static deleteCollection(id: string) { return prisma.collection.delete({ where: { id } }); }
  static countCollections(ids: string[]) { return prisma.collection.count({ where: { id: { in: ids } } }); }
  static countActiveCollections(ids: string[]) {
    return prisma.collection.count({ where: { id: { in: ids }, active: true } });
  }
  static countActiveProductsDependingOnCollection(collectionId: string) {
    return prisma.product.count({
      where: {
        status: "ACTIVE",
        collections: { some: { collectionId } },
        AND: { collections: { none: { collection: { id: { not: collectionId }, active: true } } } },
      },
    });
  }
  static countProducts(ids: string[]) { return prisma.product.count({ where: { id: { in: ids } } }); }
  static replaceCollectionProducts(collectionId: string, productIds: string[], featuredProductIds: string[]) {
    return prisma.$transaction(async (tx) => {
      await tx.productCollection.deleteMany({ where: { collectionId } });
      if (productIds.length > 0) {
        await tx.productCollection.createMany({
          data: productIds.map((productId, position) => ({
            collectionId,
            productId,
            position,
            featured: featuredProductIds.includes(productId),
          })),
          skipDuplicates: true,
        });
      }
      return tx.collection.findUniqueOrThrow({
        where: { id: collectionId },
        include: {
          parent: true,
          team: true,
          driver: true,
          products: { include: { product: true }, orderBy: [{ position: "asc" }, { product: { name: "asc" } }] },
          _count: { select: { children: true, products: true } },
        },
      });
    });
  }

  static deletePhoto(key: string) { return deletePhoto(key); }
}
