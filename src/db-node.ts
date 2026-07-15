import { PrismaPg } from "@prisma/adapter-pg";
import { requireDatabaseUrl } from "./config.js";
import { prisma, setDefaultPrisma } from "./db.js";
import { PrismaClient } from "./generated/prisma-node/client.js";

const nodePrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: requireDatabaseUrl() }) });
setDefaultPrisma(nodePrisma);

export { prisma };

export async function disconnectLocalPrisma() {
  await nodePrisma.$disconnect();
}
