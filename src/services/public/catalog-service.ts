import { PublicCatalogRepository } from "../../repositories/public/catalog-repository.js";

export class PublicCatalogService {
  static listCategories() { return PublicCatalogRepository.listCategories(); }
  static listTags() { return PublicCatalogRepository.listTags(); }
  static listTeams() { return PublicCatalogRepository.listTeams(); }
  static listDrivers(team?: string) { return PublicCatalogRepository.listDrivers(team); }
}
