import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

const server = app.listen(config.port, () => {
  console.log(`F1 store API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
