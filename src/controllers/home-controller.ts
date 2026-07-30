import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../http.js";
import {
  homeCollectionBlockSchema,
  homeHeroOrderSchema,
  homeHeroSchema,
  homeHeroStatusSchema,
  idSchema,
  localeSchema,
} from "../schemas.js";
import { HomeCollectionBlockService, HomeService } from "../services/home-service.js";
import { revalidateStorefront } from "../storefront-revalidation.js";

const publicQuerySchema = z.object({ locale: localeSchema.default("en") }).strict();

function uploadedFile(request: Request, field: string) {
  if (!request.files || Array.isArray(request.files)) return undefined;
  return request.files[field]?.[0];
}

function images(request: Request) {
  return {
    desktopImage: uploadedFile(request, "desktopImage"),
    mobileImage: uploadedFile(request, "mobileImage"),
  };
}

function blockImages(request: Request) {
  return {
    leadImage: uploadedFile(request, "leadImage"),
    sideImageOne: uploadedFile(request, "sideImageOne"),
    sideImageTwo: uploadedFile(request, "sideImageTwo"),
  };
}

function revalidate() {
  revalidateStorefront(["content:home"]);
}

export class HomeController {
  static async listPublic(request: Request, response: Response) {
    const { locale } = parse(publicQuerySchema, request.query);
    response.json(await HomeService.listPublic(locale));
  }

  static async listAdmin(_request: Request, response: Response) {
    response.json(await HomeService.listAdmin());
  }

  static async create(request: Request, response: Response) {
    const campaign = await HomeService.create(parse(homeHeroSchema, request.body), images(request));
    revalidate();
    response.status(201).json(campaign);
  }

  static async update(request: Request, response: Response) {
    const campaign = await HomeService.update(
      parse(idSchema, request.params.id),
      parse(homeHeroSchema, request.body),
      images(request),
    );
    revalidate();
    response.json(campaign);
  }

  static async setActive(request: Request, response: Response) {
    const { active } = parse(homeHeroStatusSchema, request.body);
    const campaign = await HomeService.setActive(parse(idSchema, request.params.id), active);
    revalidate();
    response.json(campaign);
  }

  static async reorder(request: Request, response: Response) {
    const campaigns = await HomeService.reorder(parse(homeHeroOrderSchema, request.body));
    revalidate();
    response.json(campaigns);
  }

  static async remove(request: Request, response: Response) {
    await HomeService.remove(parse(idSchema, request.params.id));
    revalidate();
    response.status(204).end();
  }

  static async listPublicCollectionBlocks(request: Request, response: Response) {
    const { locale } = parse(publicQuerySchema, request.query);
    response.json(await HomeCollectionBlockService.listPublic(locale));
  }

  static async listAdminCollectionBlocks(_request: Request, response: Response) {
    response.json(await HomeCollectionBlockService.listAdmin());
  }

  static async createCollectionBlock(request: Request, response: Response) {
    const block = await HomeCollectionBlockService.create(
      parse(homeCollectionBlockSchema, request.body),
      blockImages(request),
    );
    revalidate();
    response.status(201).json(block);
  }

  static async updateCollectionBlock(request: Request, response: Response) {
    const block = await HomeCollectionBlockService.update(
      parse(idSchema, request.params.id),
      parse(homeCollectionBlockSchema, request.body),
      blockImages(request),
    );
    revalidate();
    response.json(block);
  }

  static async setCollectionBlockActive(request: Request, response: Response) {
    const { active } = parse(homeHeroStatusSchema, request.body);
    const block = await HomeCollectionBlockService.setActive(parse(idSchema, request.params.id), active);
    revalidate();
    response.json(block);
  }

  static async reorderCollectionBlocks(request: Request, response: Response) {
    const blocks = await HomeCollectionBlockService.reorder(parse(homeHeroOrderSchema, request.body));
    revalidate();
    response.json(blocks);
  }

  static async removeCollectionBlock(request: Request, response: Response) {
    await HomeCollectionBlockService.remove(parse(idSchema, request.params.id));
    revalidate();
    response.status(204).end();
  }
}
