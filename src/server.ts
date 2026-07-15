import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { disconnectLocalPrisma } from "./db-node.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`F1 store API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close(async () => {
    await disconnectLocalPrisma();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
