import "dotenv/config";
import { prisma } from "./db-node.js";
import { driversCopy, driverCopies, formulaOneCopy, teamCopies } from "./seed-f1.js";

const descriptions = [
  { slug: "team", ...formulaOneCopy },
  { slug: "drivers", ...driversCopy },
  ...Object.entries(teamCopies).map(([slug, copy]) => ({ slug, ...copy })),
  ...Object.entries(driverCopies).map(([slug, copy]) => ({ slug, ...copy })),
];

async function main() {
  const slugs = descriptions.map(({ slug }) => slug);
  const existing = await prisma.collection.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map(({ slug }) => slug));
  const missing = slugs.filter((slug) => !existingSlugs.has(slug));
  if (missing.length > 0) {
    throw new Error("Cannot seed collection descriptions; missing collections: " + missing.join(", "));
  }

  await prisma.$transaction(
    descriptions.map(({ slug, description, descriptionId }) =>
      prisma.collection.update({
        where: { slug },
        data: { description, descriptionId },
      }),
    ),
  );
  console.log("Updated English and Indonesian descriptions for " + descriptions.length + " collections");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
