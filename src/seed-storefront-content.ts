import "dotenv/config";
import { prisma } from "./db-node.js";
import { storefrontContentSeed } from "./storefront-content.js";

try {
  await prisma.storefrontContent.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      supportEmail: storefrontContentSeed.support.email,
      supportWhatsappNumber: storefrontContentSeed.support.whatsappNumber,
      supportWhatsappDisplay: storefrontContentSeed.support.whatsappDisplay,
      shippingReturns: storefrontContentSeed.shippingReturns,
    },
    update: {
      supportEmail: storefrontContentSeed.support.email,
      supportWhatsappNumber: storefrontContentSeed.support.whatsappNumber,
      supportWhatsappDisplay: storefrontContentSeed.support.whatsappDisplay,
      shippingReturns: storefrontContentSeed.shippingReturns,
    },
  });
  console.log("Seeded Storefront Content only");
} finally {
  await prisma.$disconnect();
}
