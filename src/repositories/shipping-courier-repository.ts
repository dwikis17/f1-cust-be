import { prisma } from "../db.js";

// Instant couriers need exact delivery coordinates, which checkout no longer collects.
export const BLOCKED_COURIER_CODES = new Set(["gojek", "grab", "lalamove", "borzo", "deliveree", "rara"]);

export class ShippingCourierRepository {
  static list() {
    return prisma.shippingCourier.findMany({
      where: { code: { notIn: [...BLOCKED_COURIER_CODES] } },
      orderBy: { code: "asc" },
    });
  }

  static listActiveCodes() {
    return prisma.shippingCourier.findMany({
      where: { active: true, code: { notIn: [...BLOCKED_COURIER_CODES] } },
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
