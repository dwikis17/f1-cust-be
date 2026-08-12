import type { z } from "zod";
import { prisma } from "../db.js";
import type { faqPatchSchema, faqSchema } from "../schemas.js";

export type FaqInput = z.infer<typeof faqSchema>;
export type FaqPatch = z.infer<typeof faqPatchSchema>;

const orderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

export class FaqRepository {
  static list() {
    return prisma.faq.findMany({ orderBy });
  }

  static listActive() {
    return prisma.faq.findMany({ where: { active: true }, orderBy });
  }

  static create(input: FaqInput) {
    return prisma.faq.create({ data: input });
  }

  static update(id: string, input: FaqPatch) {
    return prisma.faq.update({ where: { id }, data: input });
  }

  static remove(id: string) {
    return prisma.faq.delete({ where: { id } });
  }
}
