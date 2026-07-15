import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError, parse } from "../../http.js";
import { idSchema, photoPatchSchema } from "../../schemas.js";
import { MediaService } from "../../services/admin/media-service.js";

const photoMetadataSchema = z.object({
  color: z.string().trim().min(1).max(60).optional(),
  altText: z.string().trim().min(1).max(240),
  position: z.coerce.number().int().nonnegative().default(0),
}).strict();

export class MediaController {
  static async replaceTeamLogo(request: Request, response: Response) {
    response.json(await MediaService.replaceTeamLogo(parse(idSchema, request.params.id), request.file));
  }
  static async deleteTeamLogo(request: Request, response: Response) {
    await MediaService.deleteTeamLogo(parse(idSchema, request.params.id));
    response.status(204).send();
  }
  static async replaceDriverPhoto(request: Request, response: Response) {
    response.json(await MediaService.replaceDriverPhoto(parse(idSchema, request.params.id), request.file));
  }
  static async deleteDriverPhoto(request: Request, response: Response) {
    await MediaService.deleteDriverPhoto(parse(idSchema, request.params.id));
    response.status(204).send();
  }

  static async createProductPhoto(request: Request, response: Response) {
    const productId = parse(idSchema, request.params.productId);
    if (!request.file) throw new HttpError(400, "PHOTO_REQUIRED", "A photo file is required");
    const image = MediaService.validateImage(request.file);
    const metadata = parse(photoMetadataSchema, request.body);
    response.status(201).json(await MediaService.createProductPhoto(
      productId,
      request.file,
      image,
      metadata,
      `${request.protocol}://${request.get("host")}`,
    ));
  }
  static async updateProductPhoto(request: Request, response: Response) {
    response.json(await MediaService.updateProductPhoto(
      parse(idSchema, request.params.productId),
      parse(idSchema, request.params.id),
      parse(photoPatchSchema, request.body),
    ));
  }
  static async deleteProductPhoto(request: Request, response: Response) {
    await MediaService.deleteProductPhoto(parse(idSchema, request.params.productId), parse(idSchema, request.params.id));
    response.status(204).send();
  }
}
