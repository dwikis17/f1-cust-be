import { FaqRepository, type FaqInput, type FaqPatch } from "../repositories/faq-repository.js";

type Locale = "en" | "id";

export type { FaqInput, FaqPatch } from "../repositories/faq-repository.js";

export class FaqService {
  static list() {
    return FaqRepository.list();
  }

  static async listPublic(locale: Locale) {
    const faqs = await FaqRepository.listActive();
    return faqs.map((faq) => ({
      id: faq.id,
      question: locale === "id" ? faq.questionId ?? faq.question : faq.question,
      answer: locale === "id" ? faq.answerId ?? faq.answer : faq.answer,
    }));
  }

  static create(input: FaqInput) {
    return FaqRepository.create(input);
  }

  static update(id: string, input: FaqPatch) {
    return FaqRepository.update(id, input);
  }

  static async remove(id: string) {
    await FaqRepository.remove(id);
  }
}
