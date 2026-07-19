import type { z } from "zod";
import { prisma } from "../db.js";
import type { faqPatchSchema, faqSchema } from "../schemas.js";

type FaqInput = z.infer<typeof faqSchema>;
type FaqPatch = z.infer<typeof faqPatchSchema>;
type Locale = "en" | "id";

const orderBy = [{ position: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

export class FaqService {
  static list() {
    return prisma.faq.findMany({ orderBy });
  }

  static async listPublic(locale: Locale) {
    const faqs = await prisma.faq.findMany({ where: { active: true }, orderBy });
    return faqs.map((faq) => ({
      id: faq.id,
      question: locale === "id" ? faq.questionId ?? faq.question : faq.question,
      answer: locale === "id" ? faq.answerId ?? faq.answer : faq.answer,
    }));
  }

  static create(input: FaqInput) {
    return prisma.faq.create({ data: input });
  }

  static update(id: string, input: FaqPatch) {
    return prisma.faq.update({ where: { id }, data: input });
  }

  static async remove(id: string) {
    await prisma.faq.delete({ where: { id } });
  }
}
