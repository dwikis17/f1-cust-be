import { prisma } from "../db.js";

export class FreeShippingRuleRepository {
  static get() {
    return prisma.freeShippingRule.findUniqueOrThrow({ where: { id: 1 } });
  }

  static update(input: { active: boolean; minimumPurchaseIdr: number; maxCoverageIdr: number }) {
    return prisma.freeShippingRule.update({ where: { id: 1 }, data: input });
  }
}
