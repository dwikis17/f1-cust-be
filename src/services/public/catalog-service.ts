import { PublicCatalogRepository } from "../../repositories/public/catalog-repository.js";

type CollectionItem = Awaited<ReturnType<typeof PublicCatalogRepository.listCollections>>[number];
type Locale = "en" | "id";
type PublicCollectionItem = Omit<CollectionItem, "descriptionId">;
type CollectionTreeNode = PublicCollectionItem & { children: CollectionTreeNode[] };

export class PublicCatalogService {
  static publicCollection<T extends { description: string; descriptionId: string | null }>(
    collection: T,
    locale: Locale,
  ) {
    const { descriptionId, ...value } = collection;
    return {
      ...value,
      description: locale === "id" ? descriptionId ?? collection.description : collection.description,
    };
  }
  static listCategories() { return PublicCatalogRepository.listCategories(); }
  static listTags() { return PublicCatalogRepository.listTags(); }
  static listTeams() { return PublicCatalogRepository.listTeams(); }
  static listDrivers(team?: string) { return PublicCatalogRepository.listDrivers(team); }
  static async listCollections(locale: Locale) {
    const collections = await PublicCatalogRepository.listCollections();
    const byParent = new Map<string | null, typeof collections>();
    for (const collection of collections) {
      const siblings = byParent.get(collection.parentId) ?? [];
      siblings.push(collection);
      byParent.set(collection.parentId, siblings);
    }
    const build = (parentId: string | null): CollectionTreeNode[] =>
      (byParent.get(parentId) ?? []).map((collection) => ({
        ...PublicCatalogService.publicCollection(collection, locale),
        children: build(collection.id),
      }));
    return build(null);
  }
  static async findCollection(slug: string, locale: Locale) {
    const collection = await PublicCatalogRepository.findCollection(slug);
    return collection ? {
      ...PublicCatalogService.publicCollection(collection, locale),
      parent: collection.parent ? PublicCatalogService.publicCollection(collection.parent, locale) : null,
      children: collection.children.map((child) => PublicCatalogService.publicCollection(child, locale)),
    } : null;
  }
}

export const publicCollection = PublicCatalogService.publicCollection;
