import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL
  ?? (process.argv.includes("generate") ? "postgresql://generate:generate@localhost:5432/generate" : undefined);

if (!databaseUrl) throw new Error("DATABASE_URL is required for Prisma database commands");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl },
});
