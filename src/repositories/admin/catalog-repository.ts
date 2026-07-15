import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import { deletePhoto } from "../../photo-storage.js";

export class CatalogRepository {
  static listCategories() { return prisma.category.findMany({ orderBy: { name: "asc" } }); }
  static createCategory(data: Prisma.CategoryCreateInput) { return prisma.category.create({ data }); }
  static updateCategory(id: string, data: Prisma.CategoryUpdateInput) { return prisma.category.update({ where: { id }, data }); }
  static deleteCategory(id: string) { return prisma.category.delete({ where: { id } }); }

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

  static listDrivers() { return prisma.driver.findMany({ include: { team: true }, orderBy: { name: "asc" } }); }
  static findDriver(id: string) { return prisma.driver.findUnique({ where: { id } }); }
  static findDriverTeam(id: string) { return prisma.driver.findUnique({ where: { id }, select: { teamId: true } }); }
  static createDriver(data: Prisma.DriverUncheckedCreateInput) { return prisma.driver.create({ data, include: { team: true } }); }
  static updateDriver(id: string, data: Prisma.DriverUncheckedUpdateInput) {
    return prisma.driver.update({ where: { id }, data, include: { team: true } });
  }
  static deleteDriver(id: string) { return prisma.driver.delete({ where: { id } }); }

  static deletePhoto(key: string) { return deletePhoto(key); }
}
