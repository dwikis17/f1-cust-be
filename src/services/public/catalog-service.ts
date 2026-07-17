import { PublicCatalogRepository } from "../../repositories/public/catalog-repository.js";

type CollectionItem = Awaited<ReturnType<typeof PublicCatalogRepository.listCollections>>[number];
type CollectionTreeNode = CollectionItem & { children: CollectionTreeNode[] };

export class PublicCatalogService {
  static listCategories() { return PublicCatalogRepository.listCategories(); }
  static listTags() { return PublicCatalogRepository.listTags(); }
  static listTeams() { return PublicCatalogRepository.listTeams(); }
  static listDrivers(team?: string) { return PublicCatalogRepository.listDrivers(team); }
  static async listCollections() {
    const collections = await PublicCatalogRepository.listCollections();
    const byParent = new Map<string | null, typeof collections>();
    for (const collection of collections) {
      const siblings = byParent.get(collection.parentId) ?? [];
      siblings.push(collection);
      byParent.set(collection.parentId, siblings);
    }
    const build = (parentId: string | null): CollectionTreeNode[] =>
      (byParent.get(parentId) ?? []).map((collection) => ({ ...collection, children: build(collection.id) }));
    return build(null);
  }
  static findCollection(slug: string) { return PublicCatalogRepository.findCollection(slug); }
}
