import { prisma } from "../db.js";
import type { StorefrontContentInput } from "../storefront-content.js";

const STOREFRONT_CONTENT_ID = "default";

export class StorefrontContentRepository {
  static find() {
    return prisma.storefrontContent.findUnique({ where: { id: STOREFRONT_CONTENT_ID } });
  }

  static replace(input: StorefrontContentInput) {
    const data = {
      supportEmail: input.support.email,
      supportWhatsappNumber: input.support.whatsappNumber,
      supportWhatsappDisplay: input.support.whatsappDisplay,
      shippingReturns: input.shippingReturns,
    };
    return prisma.storefrontContent.upsert({
      where: { id: STOREFRONT_CONTENT_ID },
      create: { id: STOREFRONT_CONTENT_ID, ...data },
      update: data,
    });
  }
}
