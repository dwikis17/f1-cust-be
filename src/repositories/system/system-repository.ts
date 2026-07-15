import { prisma } from "../../db.js";
import { readStoredPhoto } from "../../photo-storage.js";

export class SystemRepository {
  static healthCheck() { return prisma.$queryRaw`SELECT 1`; }
  static readPhoto(key: string) { return readStoredPhoto(key); }
}
