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
  static listCollections() {
    return prisma.collection.findMany({
      where: { active: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
  }
  static findCollection(slug: string) {
    return prisma.collection.findFirst({
      where: { slug, active: true },
      include: {
        parent: true,
        children: { where: { active: true }, orderBy: [{ position: "asc" }, { name: "asc" }] },
        _count: { select: { products: { where: { product: { status: "ACTIVE" } } } } },
      },
    });
  }
}
