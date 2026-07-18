import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { HttpError } from "../../http.js";

type ShippingInput = {
  destinationPostalCode: string;
  items: Array<{ variantId: string; quantity: number }>;
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
  }).passthrough()),
}).passthrough();

function upstreamCode(value: unknown) {
  if (!value || typeof value !== "object" || !("code" in value)) return;
  return typeof value.code === "number" ? value.code : undefined;
}

export class PublicShippingService {
  static async rates(input: ShippingInput) {
    const apiKey = config.biteshipApiKey;
    const originPostalCode = config.biteshipOriginPostalCode;
    const couriers = config.biteshipCouriers;
    if (!apiKey || !originPostalCode || couriers.length === 0) {
      throw new HttpError(503, "SHIPPING_NOT_CONFIGURED", "Shipping estimates are not configured");
    }

    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: [...quantities.keys()] } },
      select: {
        id: true,
        sku: true,
        stockQuantity: true,
        packageLengthMm: true,
        packageWidthMm: true,
        packageHeightMm: true,
        packageWeightG: true,
        product: { select: { name: true, priceIdr: true, status: true } },
      },
    });
    if (variants.length !== quantities.size || variants.some((variant) =>
      variant.product.status !== "ACTIVE" || variant.stockQuantity < (quantities.get(variant.id) ?? 0))) {
      throw new HttpError(409, "CART_CHANGED", "One or more cart items are unavailable; refresh your cart and try again");
    }

    let upstream: Response;
    try {
      upstream = await fetch("https://api.biteship.com/v1/rates/couriers", {
        method: "POST",
        headers: { authorization: apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          origin_postal_code: Number(originPostalCode),
          destination_postal_code: Number(input.destinationPostalCode),
          couriers: couriers.join(","),
          items: variants.map((variant) => ({
            name: variant.product.name,
            category: "fashion",
            sku: variant.sku,
            value: variant.product.priceIdr,
            quantity: quantities.get(variant.id),
            weight: variant.packageWeightG,
            height: variant.packageHeightMm / 10,
            length: variant.packageLengthMm / 10,
            width: variant.packageWidthMm / 10,
          })),
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
    if (!parsed.success) {
      throw new HttpError(502, "SHIPPING_UPSTREAM_ERROR", "Biteship returned an unexpected response");
    }
    return {
      destinationPostalCode: input.destinationPostalCode,
      rates: parsed.data.pricing.map((rate) => ({
        courierCode: rate.courier_code,
        courierName: rate.courier_name,
        serviceCode: rate.courier_service_code,
        serviceName: rate.courier_service_name,
        description: rate.description ?? "",
        duration: rate.duration ?? "",
        serviceType: rate.service_type ?? "",
        currency: rate.currency ?? "IDR",
        price: rate.price,
      })).sort((left, right) => left.price - right.price),
    };
  }
}
