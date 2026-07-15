import type { z } from "zod";
import { notFound } from "../../http.js";
import { CatalogRepository } from "../../repositories/admin/catalog-repository.js";
import type {
  catalogEntityPatchSchema,
  catalogEntitySchema,
  driverPatchSchema,
  driverSchema,
  teamPatchSchema,
  teamSchema,
} from "../../schemas.js";

type CatalogInput = z.infer<typeof catalogEntitySchema>;
type CatalogPatch = z.infer<typeof catalogEntityPatchSchema>;
type TeamInput = z.infer<typeof teamSchema>;
type TeamPatch = z.infer<typeof teamPatchSchema>;
type DriverInput = z.infer<typeof driverSchema>;
type DriverPatch = z.infer<typeof driverPatchSchema>;

export class CatalogService {
  private static async deleteManagedImage(url?: string | null) {
    const key = url?.startsWith("/uploads/") ? url.slice("/uploads/".length) : null;
    if (!key) return;
    await CatalogRepository.deletePhoto(key).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.error("Could not remove image", error);
    });
  }

  static listCategories() { return CatalogRepository.listCategories(); }
  static createCategory(input: CatalogInput) { return CatalogRepository.createCategory(input); }
  static updateCategory(id: string, input: CatalogPatch) { return CatalogRepository.updateCategory(id, input); }
  static deleteCategory(id: string) { return CatalogRepository.deleteCategory(id); }

  static listTags() { return CatalogRepository.listTags(); }
  static createTag(input: CatalogInput) { return CatalogRepository.createTag(input); }
  static updateTag(id: string, input: CatalogPatch) { return CatalogRepository.updateTag(id, input); }
  static deleteTag(id: string) { return CatalogRepository.deleteTag(id); }

  static listTeams() { return CatalogRepository.listTeams(); }
  static createTeam(input: TeamInput) { return CatalogRepository.createTeam(input); }
  static updateTeam(id: string, input: TeamPatch) { return CatalogRepository.updateTeam(id, input); }
  static async deleteTeam(id: string) {
    const team = await CatalogRepository.findTeam(id);
    if (!team) notFound("Team not found");
    await CatalogRepository.deleteTeam(id);
    await CatalogService.deleteManagedImage(team.logoUrl);
  }

  static listDrivers() { return CatalogRepository.listDrivers(); }
  static createDriver(input: DriverInput) { return CatalogRepository.createDriver(input); }
  static updateDriver(id: string, input: DriverPatch) { return CatalogRepository.updateDriver(id, input); }
  static async deleteDriver(id: string) {
    const driver = await CatalogRepository.findDriver(id);
    if (!driver) notFound("Driver not found");
    await CatalogRepository.deleteDriver(id);
    await CatalogService.deleteManagedImage(driver.photoUrl);
  }
}
