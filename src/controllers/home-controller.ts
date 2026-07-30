import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../http.js";
import { homeHeroSchema, localeSchema } from "../schemas.js";
import { HomeService } from "../services/home-service.js";
import { revalidateStorefront } from "../storefront-revalidation.js";

const publicQuerySchema = z.object({ locale: localeSchema.default("en") }).strict();

function uploadedFile(request: Request, field: string) {
  if (!request.files || Array.isArray(request.files)) return undefined;
  return request.files[field]?.[0];
}

export class HomeController {
  static async getPublic(request: Request, response: Response) {
    const { locale } = parse(publicQuerySchema, request.query);
    response.json(await HomeService.getPublic(locale));
  }

  static async getAdmin(_request: Request, response: Response) {
    response.json(await HomeService.getAdmin());
  }

  static async save(request: Request, response: Response) {
    const hero = await HomeService.save(parse(homeHeroSchema, request.body), {
      desktopImage: uploadedFile(request, "desktopImage"),
      mobileImage: uploadedFile(request, "mobileImage"),
    });
    revalidateStorefront(["content:home"]);
    response.json(hero);
  }
}
