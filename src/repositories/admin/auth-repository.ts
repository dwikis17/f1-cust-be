import { prisma } from "../../db.js";

export class AuthRepository {
  static findAdminByEmail(email: string) {
    return prisma.admin.findUnique({ where: { email } });
  }

  static findSession(tokenHash: string) {
    return prisma.adminSession.findUnique({ where: { tokenHash }, include: { admin: true } });
  }

  static createSession(adminId: string, tokenHash: string, expiresAt: Date) {
    return prisma.adminSession.create({ data: { adminId, tokenHash, expiresAt } });
  }

  static deleteSession(id: string) {
    return prisma.adminSession.delete({ where: { id } });
  }
}
