import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../http.js";
import { effectivePriceIdr } from "../../product-price.js";
import { PublicShippingRepository } from "../../repositories/public/shipping-repository.js";
import { ShippingCourierRepository } from "../../repositories/shipping-courier-repository.js";
import { normalizeCollectionMethods, type ShipmentCollectionMethod } from "../../shipment-collection.js";

type ShippingInput = {
  destinationPostalCode: string;
  items: Array<{ variantId: string; quantity: number }>;
};

export type BiteshipRateItem = {
  name: string;
  description?: string;
  category: string;
  sku: string;
  value: number;
  quantity: number;
  weight: number;
  height: number;
  length: number;
  width: number;
};

export type ShippingRate = {
  courierCode: string;
  courierName: string;
  serviceCode: string;
  serviceName: string;
  description: string;
  duration: string;
  serviceType: string;
  currency: string;
  price: number;
  availableCollectionMethods: ShipmentCollectionMethod[];
};

const biteshipResponseSchema = z.object({
  pricing: z.array(z.object({
    courier_code: z.string(),
    courier_name: z.string(),
    courier_service_code: z.string(),
    courier_service_name: z.string(),
    description: z.string().nullish(),
    duration: z.string().nullish(),
    service_type: z.string().nullish(),
    currency: z.string().nullish(),
    price: z.number().nonnegative(),
    available_collection_method: z.array(z.string()).default(["pickup"]),
  }).passthrough()),
}).passthrough();

function upstreamCode(value: unknown) {
  if (!value || typeof value !== "object" || !("code" in value)) return;
  return typeof value.code === "number" ? value.code : undefined;
}

function assertShippingConfig(courierCodes: string[]) {
  if (!config.biteshipApiKey || !config.biteshipOriginPostalCode || courierCodes.length === 0) {
    throw new HttpError(503, "SHIPPING_NOT_CONFIGURED", "Shipping estimates are not configured");
  }
}

export class PublicShippingService {
  static async requestBiteshipRates(input: {
    destinationPostalCode: string;
    items: BiteshipRateItem[];
    courierCodes: string[];
  }) {
    assertShippingConfig(input.courierCodes);
    const apiKey = config.biteshipApiKey;
    if (!apiKey) throw new HttpError(503, "SHIPPING_NOT_CONFIGURED", "Shipping estimates are not configured");

    let upstream: Response;
    try {
      upstream = await fetch("https://api.biteship.com/v1/rates/couriers", {
        method: "POST",
        headers: { authorization: apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          origin_postal_code: Number(config.biteshipOriginPostalCode),
          destination_postal_code: Number(input.destinationPostalCode),
          couriers: input.courierCodes.join(","),
          items: input.items,
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new HttpError(504, "SHIPPING_TIMEOUT", "Shipping estimates took too long; please try again");
      }
      throw new HttpError(502, "SHIPPING_UPSTREAM_ERROR", "Shipping estimates are temporarily unavailable");
    }

    const body: unknown = await upstream.json().catch(() => undefined);
    if (!upstream.ok) {
      const code = upstreamCode(body);
      if (code === 40001001 || code === 40001010) {
        throw new HttpError(422, code === 40001001 ? "INVALID_DESTINATION" : "NO_COURIER_AVAILABLE",
          code === 40001001 ? "The destination postal code is not supported" : "No courier is available for this destination");
      }
      throw new HttpError(502, "SHIPPING_UPSTREAM_ERROR", "Shipping estimates are temporarily unavailable");
    }

    const parsed = biteshipResponseSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(502, "SHIPPING_UPSTREAM_ERROR", "Biteship returned an unexpected response");
    return parsed.data.pricing.map((rate): ShippingRate => ({
      courierCode: rate.courier_code,
      courierName: rate.courier_name,
      serviceCode: rate.courier_service_code,
      serviceName: rate.courier_service_name,
      description: rate.description ?? "",
      duration: rate.duration ?? "",
      serviceType: rate.service_type ?? "",
      currency: rate.currency ?? "IDR",
      price: rate.price,
      availableCollectionMethods: normalizeCollectionMethods(rate.available_collection_method),
    })).sort((left, right) => left.price - right.price);
  }

  static async rates(input: ShippingInput) {
    const courierCodes = await ShippingCourierRepository.listActiveCodes();
    assertShippingConfig(courierCodes);
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const variants = await PublicShippingRepository.findRateVariants([...quantities.keys()]);
    if (variants.length !== quantities.size || variants.some((variant) =>
      variant.product.status !== "ACTIVE" || variant.stockQuantity < (quantities.get(variant.id) ?? 0))) {
      throw new HttpError(409, "CART_CHANGED", "One or more cart items are unavailable; refresh your cart and try again");
    }

    return {
      destinationPostalCode: input.destinationPostalCode,
      rates: await PublicShippingService.requestBiteshipRates({
        destinationPostalCode: input.destinationPostalCode,
        items: variants.map((variant) => ({
          name: variant.product.name,
          category: "fashion",
          sku: variant.sku,
          value: effectivePriceIdr(variant.product),
          quantity: quantities.get(variant.id) ?? 0,
          weight: variant.packageWeightG,
          height: variant.packageHeightMm / 10,
          length: variant.packageLengthMm / 10,
          width: variant.packageWidthMm / 10,
        })),
        courierCodes,
      }),
    };
  }
}

export const requestBiteshipRates = PublicShippingService.requestBiteshipRates;
