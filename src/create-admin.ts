import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { prisma } from "./db.js";
import { hashPassword } from "./security.js";

async function hiddenQuestion(prompt: string) {
  if (!stdin.isTTY) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error("Set ADMIN_PASSWORD when stdin is not interactive");
    return password;
  }
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const onKey = (chunk: Buffer) => {
      const key = chunk.toString();
      if (key === "\r" || key === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
      } else if (key === "\u0003") {
        cleanup();
        reject(new Error("Cancelled"));
      } else if (key === "\u007f") {
        value = value.slice(0, -1);
      } else if (key >= " ") {
        value += key;
      }
    };
    const cleanup = () => {
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onKey);
  });
}

async function main() {
  const rl = stdin.isTTY ? createInterface({ input: stdin, output: stdout }) : null;
  const email = z.string().trim().email().parse(rl ? await rl.question("Email: ") : process.env.ADMIN_EMAIL).toLowerCase();
  const displayName = z.string().trim().min(1).max(120).parse(rl ? await rl.question("Display name: ") : process.env.ADMIN_DISPLAY_NAME);
  rl?.close();
  const password = z.string().min(8).max(200).parse(await hiddenQuestion("Password: "));
  const confirmation = await hiddenQuestion("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match");
  const { salt, hash } = await hashPassword(password);
  const admin = await prisma.admin.upsert({
    where: { email },
    create: { email, displayName, passwordSalt: salt, passwordHash: hash },
    update: { displayName, passwordSalt: salt, passwordHash: hash, active: true },
  });
  console.log(`Admin ready: ${admin.email}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
