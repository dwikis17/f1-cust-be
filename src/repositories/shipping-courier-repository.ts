import { prisma } from "../db.js";

export class ShippingCourierRepository {
  static list() {
    return prisma.shippingCourier.findMany({ orderBy: { code: "asc" } });
  }

  static listActiveCodes() {
    return prisma.shippingCourier.findMany({
      where: { active: true },
      select: { code: true },
      orderBy: { code: "asc" },
    }).then((couriers) => couriers.map(({ code }) => code));
  }

  static find(code: string) {
    return prisma.shippingCourier.findUnique({ where: { code } });
  }

  static setActive(code: string, active: boolean) {
    return prisma.shippingCourier.upsert({
      where: { code },
      create: { code, active },
      update: { active },
    });
  }

  static deactivate(code: string) {
    return prisma.$transaction(async (transaction) => {
      const courier = await transaction.shippingCourier.findUnique({ where: { code } });
      if (!courier) return "NOT_FOUND" as const;
      if (!courier.active) return courier;
      if (await transaction.shippingCourier.count({ where: { active: true } }) <= 1) {
        return "LAST_ACTIVE" as const;
      }
      return transaction.shippingCourier.update({ where: { code }, data: { active: false } });
    }, { isolationLevel: "Serializable" });
  }
}
