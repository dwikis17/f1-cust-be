import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError, parse } from "../../http.js";
import { idSchema, photoPatchSchema } from "../../schemas.js";
import { MediaService } from "../../services/admin/media-service.js";
import { ProductService } from "../../services/admin/product-service.js";
import { revalidateStorefront } from "../../storefront-revalidation.js";

const photoMetadataSchema = z.object({
  color: z.string().trim().min(1).max(60).optional(),
  altText: z.string().trim().min(1).max(240),
  position: z.coerce.number().int().nonnegative().default(0),
}).strict();

export class MediaController {
  static async replaceTeamLogo(request: Request, response: Response) {
    const value = await MediaService.replaceTeamLogo(parse(idSchema, request.params.id), request.file); revalidateStorefront(["catalog:teams", "catalog:products"]); response.json(value);
  }
  static async deleteTeamLogo(request: Request, response: Response) {
    await MediaService.deleteTeamLogo(parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:teams", "catalog:products"]);
    response.status(204).send();
  }
  static async replaceDriverPhoto(request: Request, response: Response) {
    const value = await MediaService.replaceDriverPhoto(parse(idSchema, request.params.id), request.file); revalidateStorefront(["catalog:products"]); response.json(value);
  }
  static async deleteDriverPhoto(request: Request, response: Response) {
    await MediaService.deleteDriverPhoto(parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:products"]);
    response.status(204).send();
  }

  static async createProductPhoto(request: Request, response: Response) {
    const productId = parse(idSchema, request.params.productId);
    if (!request.file) throw new HttpError(400, "PHOTO_REQUIRED", "A photo file is required");
    const image = MediaService.validateImage(request.file);
    const metadata = parse(photoMetadataSchema, request.body);
    const value = await MediaService.createProductPhoto(
      productId,
      request.file,
      image,
      metadata,
    );
    const product = await ProductService.findProduct(productId);
    revalidateStorefront(["catalog:products", `catalog:product:${product.slug}`]);
    response.status(201).json(value);
  }
  static async updateProductPhoto(request: Request, response: Response) {
    const productId = parse(idSchema, request.params.productId);
    const value = await MediaService.updateProductPhoto(
      productId,
      parse(idSchema, request.params.id),
      parse(photoPatchSchema, request.body),
    );
    const product = await ProductService.findProduct(productId);
    revalidateStorefront(["catalog:products", `catalog:product:${product.slug}`]);
    response.json(value);
  }
  static async deleteProductPhoto(request: Request, response: Response) {
    const productId = parse(idSchema, request.params.productId);
    const product = await ProductService.findProduct(productId);
    await MediaService.deleteProductPhoto(productId, parse(idSchema, request.params.id));
    revalidateStorefront(["catalog:products", `catalog:product:${product.slug}`]);
    response.status(204).send();
  }
}
