import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { config } from "../../config.js";
import { HttpError, notFound } from "../../http.js";
import { MediaRepository } from "../../repositories/admin/media-repository.js";
import type { photoPatchSchema } from "../../schemas.js";

type PhotoPatch = z.infer<typeof photoPatchSchema>;
type PhotoMetadata = { color?: string; altText: string; position: number };
type UploadedImage = { buffer: Buffer } | undefined;
type ValidImage = { extension: "jpg" | "png" | "webp"; contentType: string };

export class MediaService {
  static validateImage(file: UploadedImage): ValidImage {
    if (!file) throw new HttpError(400, "IMAGE_REQUIRED", "An image file is required");
    const buffer = file.buffer;
    const extension = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "jpg"
      : buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
      : buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" ? "webp"
      : null;
    if (!extension) throw new HttpError(400, "INVALID_IMAGE", "Only valid JPEG, PNG, and WebP images are allowed");
    return {
      extension,
      contentType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
    };
  }

  private static async deleteManagedImage(url?: string | null) {
    const key = url?.startsWith("/uploads/") ? url.slice("/uploads/".length) : null;
    if (!key) return;
    await MediaRepository.deletePhoto(key).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.error("Could not remove image", error);
    });
  }

  static async replaceTeamLogo(id: string, file: UploadedImage) {
    const team = await MediaRepository.findTeam(id);
    if (!team) notFound("Team not found");
    const image = MediaService.validateImage(file);
    const key = MediaRepository.photoKey(`team-${randomUUID()}.${image.extension}`);
    await MediaRepository.storePhoto(key, file!.buffer, image.contentType);
    try {
      const updated = await MediaRepository.updateTeam(id, { logoUrl: `/uploads/${key}` });
      await MediaService.deleteManagedImage(team.logoUrl);
      return updated;
    } catch (error) {
      await MediaRepository.deletePhoto(key).catch(() => undefined);
      throw error;
    }
  }
  static async deleteTeamLogo(id: string) {
    const team = await MediaRepository.findTeam(id);
    if (!team) notFound("Team not found");
    await MediaRepository.updateTeam(id, { logoUrl: null });
    await MediaService.deleteManagedImage(team.logoUrl);
  }

  static async replaceDriverPhoto(id: string, file: UploadedImage) {
    const driver = await MediaRepository.findDriver(id);
    if (!driver) notFound("Driver not found");
    const image = MediaService.validateImage(file);
    const key = MediaRepository.photoKey(`driver-${randomUUID()}.${image.extension}`);
    await MediaRepository.storePhoto(key, file!.buffer, image.contentType);
    try {
      const updated = await MediaRepository.updateDriver(id, { photoUrl: `/uploads/${key}` });
      await MediaService.deleteManagedImage(driver.photoUrl);
      return updated;
    } catch (error) {
      await MediaRepository.deletePhoto(key).catch(() => undefined);
      throw error;
    }
  }
  static async deleteDriverPhoto(id: string) {
    const driver = await MediaRepository.findDriver(id);
    if (!driver) notFound("Driver not found");
    await MediaRepository.updateDriver(id, { photoUrl: null });
    await MediaService.deleteManagedImage(driver.photoUrl);
  }

  static async createProductPhoto(
    productId: string,
    file: { buffer: Buffer },
    image: ValidImage,
    metadata: PhotoMetadata,
    baseUrl: string,
  ) {
    const product = await MediaRepository.findProduct(productId);
    if (!product) notFound("Product not found");
    if (await MediaRepository.countProductPhotos(productId) >= config.maxPhotosPerProduct) {
      throw new HttpError(409, "PHOTO_LIMIT", "Product photo limit reached");
    }
    if (metadata.color && !await MediaRepository.findProductColor(productId, metadata.color)) {
      throw new HttpError(400, "UNKNOWN_COLOR", "Photo color must match a product variant");
    }
    const filename = MediaRepository.photoKey(`${randomUUID()}.${image.extension}`);
    const url = new URL(`/uploads/${filename}`, baseUrl).toString();
    await MediaRepository.storePhoto(filename, file.buffer, image.contentType);
    try {
      const photo = await MediaRepository.createProductPhoto({ productId, path: url, ...metadata });
      return { ...photo, url };
    } catch (error) {
      await MediaRepository.deletePhoto(filename).catch(() => undefined);
      throw error;
    }
  }
  static async updateProductPhoto(productId: string, id: string, input: PhotoPatch) {
    if (input.color && !await MediaRepository.findProductColor(productId, input.color)) {
      throw new HttpError(400, "UNKNOWN_COLOR", "Photo color must match a product variant");
    }
    if (!await MediaRepository.findProductPhoto(id, productId)) notFound("Photo not found");
    return MediaRepository.updateProductPhoto(id, input);
  }
  static async deleteProductPhoto(productId: string, id: string) {
    const photo = await MediaRepository.findProductPhoto(id, productId);
    if (!photo) notFound("Photo not found");
    await MediaRepository.deleteProductPhoto(id);
    await MediaRepository.deletePhoto(MediaRepository.storedPhotoKey(photo.path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.error("Could not remove photo file", error);
    });
  }
}
