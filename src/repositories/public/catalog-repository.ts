import { prisma } from "../../db.js";

export class PublicCatalogRepository {
  static listCategories() { return prisma.category.findMany({ orderBy: { name: "asc" } }); }
  static listTags() { return prisma.tag.findMany({ orderBy: { name: "asc" } }); }
  static listTeams() { return prisma.team.findMany({ orderBy: { name: "asc" } }); }
  static listDrivers(team?: string) {
    return prisma.driver.findMany({
      where: team ? { team: { slug: team } } : undefined,
      include: { team: true },
      orderBy: { name: "asc" },
    });
  }
}
