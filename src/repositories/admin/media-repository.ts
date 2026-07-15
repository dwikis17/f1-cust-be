import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import { deletePhoto, photoKey, storedPhotoKey, storePhoto } from "../../photo-storage.js";

export class MediaRepository {
  static findTeam(id: string) { return prisma.team.findUnique({ where: { id } }); }
  static updateTeam(id: string, data: Prisma.TeamUpdateInput) { return prisma.team.update({ where: { id }, data }); }
  static findDriver(id: string) { return prisma.driver.findUnique({ where: { id } }); }
  static updateDriver(id: string, data: Prisma.DriverUncheckedUpdateInput) {
    return prisma.driver.update({ where: { id }, data, include: { team: true } });
  }

  static findProduct(id: string) { return prisma.product.findUnique({ where: { id } }); }
  static countProductPhotos(productId: string) { return prisma.productPhoto.count({ where: { productId } }); }
  static findProductColor(productId: string, color: string) { return prisma.productVariant.findFirst({ where: { productId, color } }); }
  static findProductPhoto(id: string, productId: string) { return prisma.productPhoto.findFirst({ where: { id, productId } }); }
  static createProductPhoto(data: Prisma.ProductPhotoUncheckedCreateInput) { return prisma.productPhoto.create({ data }); }
  static updateProductPhoto(id: string, data: Prisma.ProductPhotoUpdateInput) { return prisma.productPhoto.update({ where: { id }, data }); }
  static deleteProductPhoto(id: string) { return prisma.productPhoto.delete({ where: { id } }); }

  static storePhoto(key: string, body: Uint8Array, contentType: string) { return storePhoto(key, body, contentType); }
  static deletePhoto(key: string) { return deletePhoto(key); }
  static photoKey(filename: string) { return photoKey(filename); }
  static storedPhotoKey(value: string) { return storedPhotoKey(value); }
}
