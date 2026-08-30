import { notFound } from "../http.js";
import { StorefrontContentRepository } from "../repositories/storefront-content-repository.js";
import {
  shippingReturnsDocumentSchema,
  storefrontContentSchema,
  type StorefrontContentInput,
} from "../storefront-content.js";

type Locale = "en" | "id";

function support(row: Awaited<ReturnType<typeof StorefrontContentRepository.find>>) {
  if (!row) notFound("Storefront content not found");
  return {
    email: row.supportEmail,
    whatsappNumber: row.supportWhatsappNumber,
    whatsappDisplay: row.supportWhatsappDisplay,
    mailtoUrl: `mailto:${row.supportEmail}`,
    whatsappUrl: `https://wa.me/${row.supportWhatsappNumber}`,
  };
}

export class StorefrontContentService {
  static async findAdmin() {
    const row = await StorefrontContentRepository.find();
    if (!row) notFound("Storefront content not found");
    return storefrontContentSchema.parse({
      support: {
        email: row.supportEmail,
        whatsappNumber: row.supportWhatsappNumber,
        whatsappDisplay: row.supportWhatsappDisplay,
      },
      shippingReturns: row.shippingReturns,
    });
  }

  static async findSupport() {
    return support(await StorefrontContentRepository.find());
  }

  static async findShippingReturns(locale: Locale) {
    const row = await StorefrontContentRepository.find();
    if (!row) notFound("Storefront content not found");
    const document = shippingReturnsDocumentSchema.parse(row.shippingReturns);
    return {
      title: document.title[locale],
      intro: document.intro[locale],
      facts: document.facts.map((fact) => ({
        id: fact.id,
        label: fact.label[locale],
        value: fact.value[locale],
      })),
      sections: document.sections.map((section) => ({
        id: section.id,
        title: section.title[locale],
        body: section.body[locale],
        items: section.items.map((item) => ({ id: item.id, text: item.text[locale] })),
      })),
      support: support(row),
    };
  }

  static async replace(input: StorefrontContentInput) {
    await StorefrontContentRepository.replace(input);
    return input;
  }
}
