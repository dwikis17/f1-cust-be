import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError, parse } from "../../http.js";

const searchSchema = z.object({ query: z.string().trim().min(5).max(500) }).strict();
const responseSchema = z.object({
  features: z.array(z.object({
    id: z.string(),
    place_name: z.string(),
    center: z.tuple([z.number().finite(), z.number().finite()]),
  })).default([]),
}).passthrough();

export class PublicLocationController {
  static async search(request: Request, response: Response, next: NextFunction) {
    try {
      const { query } = parse(searchSchema, request.body);
      if (!config.mapboxPermanentGeocodingToken) {
        throw new HttpError(503, "LOCATION_NOT_CONFIGURED", "Address search is not configured");
      }
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&country=id&limit=5&autocomplete=false&permanent=true&format=v5&access_token=${encodeURIComponent(config.mapboxPermanentGeocodingToken)}`, {
          headers: config.storefrontUrl ? { referer: config.storefrontUrl } : undefined,
          signal: AbortSignal.timeout(8_000),
        });
      } catch (error) {
        console.error("Mapbox geocoding fetch failed", error instanceof Error ? error.name : "unknown");
        throw new HttpError(502, "LOCATION_UPSTREAM_ERROR", "Address search is temporarily unavailable");
      }
      const body: unknown = await upstream.json().catch(() => undefined);
      if (!upstream.ok) {
        console.error("Mapbox geocoding rejected request", upstream.status, upstream.statusText);
        throw new HttpError(502, "LOCATION_UPSTREAM_ERROR", "Address search is temporarily unavailable");
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        console.error("Mapbox geocoding returned an unexpected response");
        throw new HttpError(502, "LOCATION_UPSTREAM_ERROR", "Address search returned an unexpected response");
      }
      response.set("cache-control", "no-store");
      response.json({ candidates: parsed.data.features.map((feature) => ({
        id: feature.id,
        label: feature.place_name,
        longitude: feature.center[0],
        latitude: feature.center[1],
      })) });
    } catch (error) {
      next(error);
    }
  }
}
