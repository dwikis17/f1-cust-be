import { notFound } from "../../http.js";
import {
  PublicProductRepository,
  type ProductFilters,
} from "../../repositories/public/product-repository.js";

export class PublicProductService {
  private static publicProduct(product: Record<string, any>) {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      priceIdr: product.priceIdr,
      category: product.category,
      team: product.team,
      driver: product.driver,
      tags: product.tags.map(({ tag }: any) => tag),
      variants: product.variants.map(({ stockQuantity, ...variant }: any) => ({ ...variant, available: stockQuantity > 0 })),
      photos: product.photos.map((photo: any) => ({ ...photo, url: PublicProductRepository.storedPhotoUrl(photo.path) })),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  static async listProducts(filters: ProductFilters, page: number, limit: number) {
    const [total, products] = await PublicProductRepository.listProducts(filters, page, limit);
    return { data: products.map((product) => PublicProductService.publicProduct(product)), page, limit, total };
  }
  static async findProduct(slug: string) {
    const product = await PublicProductRepository.findProduct(slug);
    if (!product) notFound("Product not found");
    return PublicProductService.publicProduct(product);
  }
}
