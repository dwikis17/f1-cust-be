import "dotenv/config";
import { disconnectLocalPrisma, prisma } from "./db-node.js";

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      variants: {
        select: { id: true },
        orderBy: [{ color: "asc" }, { size: "asc" }, { sku: "asc" }],
      },
    },
  });

  let updated = 0;
  for (const product of products) {
    await prisma.$transaction(
      product.variants.map((variant, position) =>
        prisma.productVariant.update({ where: { id: variant.id }, data: { position } }),
      ),
    );
    updated += product.variants.length;
  }

  console.log(`Backfilled ${updated} product variant positions across ${products.length} products.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectLocalPrisma);
