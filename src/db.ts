import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

type DisconnectableClient = object & { $disconnect(): Promise<void> };

export function createPrisma(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const requestClient = new AsyncLocalStorage<PrismaClient>();
let defaultClient: DisconnectableClient | undefined;

function currentClient() {
  const client = requestClient.getStore();
  if (client) return client;
  if (!defaultClient) throw new Error("Prisma is not configured for this request");
  return defaultClient;
}

export function runWithPrisma<T>(client: PrismaClient, callback: () => T) {
  return requestClient.run(client, callback);
}

export function setDefaultPrisma(client: DisconnectableClient) {
  defaultClient = client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = currentClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
