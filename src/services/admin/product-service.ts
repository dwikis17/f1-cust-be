import type { z } from "zod";
import { HttpError, notFound } from "../../http.js";
import { CatalogRepository } from "../../repositories/admin/catalog-repository.js";
import { ProductRepository } from "../../repositories/admin/product-repository.js";
import type {
  productPatchSchema,
  productSchema,
  variantPatchSchema,
  variantSchema,
} from "../../schemas.js";

type ProductInput = z.infer<typeof productSchema>;
type ProductPatch = z.infer<typeof productPatchSchema>;
type VariantInput = z.infer<typeof variantSchema>;
type VariantPatch = z.infer<typeof variantPatchSchema>;

export class ProductService {
  private static async validateProductTeamDriver(teamId?: string | null, driverId?: string | null) {
    if (!driverId) return;
    if (!teamId) throw new HttpError(400, "DRIVER_REQUIRES_TEAM", "A driver product must also have a team");
    const driver = await CatalogRepository.findDriverTeam(driverId);
    if (!driver) throw new HttpError(400, "UNKNOWN_DRIVER", "Driver does not exist");
    if (driver.teamId !== teamId) {
      throw new HttpError(400, "DRIVER_TEAM_MISMATCH", "Driver must belong to the product team when assigned");
    }
  }

  static listProducts() { return ProductRepository.listProducts(); }
  static async findProduct(id: string) {
    const product = await ProductRepository.findProduct(id);
    if (!product) notFound("Product not found");
    return product;
  }
  static async createProduct(input: ProductInput) {
    const { tagIds, variants, ...product } = input;
    await ProductService.validateProductTeamDriver(product.teamId, product.driverId);
    return ProductRepository.createProduct({
      ...product,
      tags: { create: [...new Set(tagIds)].map((tagId) => ({ tag: { connect: { id: tagId } } })) },
      variants: { create: variants },
    });
  }
  static async updateProduct(id: string, input: ProductPatch) {
    const { tagIds, ...product } = input;
    if (product.teamId !== undefined || product.driverId !== undefined) {
      const current = await ProductRepository.findProductTeamDriver(id);
      if (!current) notFound("Product not found");
      await ProductService.validateProductTeamDriver(
        product.teamId === undefined ? current.teamId : product.teamId,
        product.driverId === undefined ? current.driverId : product.driverId,
      );
    }
    const uniqueTagIds = tagIds ? [...new Set(tagIds)] : undefined;
    if (uniqueTagIds && await CatalogRepository.countTags(uniqueTagIds) !== uniqueTagIds.length) {
      throw new HttpError(400, "UNKNOWN_TAG", "Every tag must exist before it can be assigned");
    }
    return ProductRepository.updateProduct(id, product, uniqueTagIds);
  }

  static createVariant(productId: string, input: VariantInput) {
    return ProductRepository.createVariant({ ...input, productId });
  }
  static async updateVariant(productId: string, id: string, input: VariantPatch) {
    if (!await ProductRepository.findVariant(id, productId)) notFound("Variant not found");
    return ProductRepository.updateVariant(id, input);
  }
  static async deleteVariant(productId: string, id: string) {
    if (!(await ProductRepository.deleteVariant(id, productId)).count) notFound("Variant not found");
  }
}
