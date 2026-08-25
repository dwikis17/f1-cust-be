import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../http.js";
import { ShippingCourierRepository } from "../../repositories/shipping-courier-repository.js";
import { FreeShippingRuleRepository } from "../../repositories/free-shipping-rule-repository.js";

const biteshipCourierSchema = z.object({
  success: z.literal(true),
  couriers: z.array(z.object({
    courier_code: z.string().trim().min(1),
    courier_name: z.string().trim().min(1),
    courier_service_code: z.string().trim().min(1),
  }).passthrough()),
}).passthrough();

type CatalogCourier = {
  code: string;
  name: string;
  serviceCodes: Set<string>;
};

async function fetchBiteshipCouriers() {
  if (!config.biteshipApiKey) {
    throw new HttpError(503, "BITESHIP_NOT_CONFIGURED", "Biteship is not configured");
  }

  let response: Response;
  try {
    response = await fetch("https://api.biteship.com/v1/couriers", {
      headers: { authorization: config.biteshipApiKey },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "BITESHIP_CATALOG_UNAVAILABLE", "Biteship's courier catalog is unavailable");
  }

  const body: unknown = await response.json().catch(() => undefined);
  const parsed = biteshipCourierSchema.safeParse(body);
  if (!response.ok || !parsed.success) {
    throw new HttpError(502, "BITESHIP_CATALOG_UNAVAILABLE", "Biteship's courier catalog is unavailable");
  }

  const couriers = new Map<string, CatalogCourier>();
  for (const service of parsed.data.couriers) {
    const code = service.courier_code.toLowerCase();
    const courier = couriers.get(code) ?? {
      code,
      name: service.courier_name,
      serviceCodes: new Set<string>(),
    };
    courier.serviceCodes.add(service.courier_service_code);
    couriers.set(code, courier);
  }
  return couriers;
}

export class CourierService {
  static async list() {
    const [configured, freeShippingRule] = await Promise.all([
      ShippingCourierRepository.list(),
      FreeShippingRuleRepository.get(),
    ]);
    const activeCodes = new Set(configured.filter(({ active }) => active).map(({ code }) => code));

    let catalog: Map<string, CatalogCourier>;
    try {
      catalog = await fetchBiteshipCouriers();
    } catch {
      return {
        catalogAvailable: false,
        warning: "Biteship's courier catalog is unavailable. Only active courier codes are shown.",
        couriers: [...activeCodes].sort().map((code) => ({ code, name: code, serviceCount: 0, active: true })),
        freeShippingRule,
      };
    }

    for (const code of activeCodes) {
      if (!catalog.has(code)) catalog.set(code, { code, name: code, serviceCodes: new Set() });
    }

    const couriers = [...catalog.values()].map((courier) => ({
      code: courier.code,
      name: courier.name,
      serviceCount: courier.serviceCodes.size,
      active: activeCodes.has(courier.code),
    })).sort((left, right) => Number(right.active) - Number(left.active)
      || left.name.localeCompare(right.name)
      || left.code.localeCompare(right.code));

    return { catalogAvailable: true, couriers, freeShippingRule };
  }

  static updateFreeShippingRule(input: { active: boolean; minimumPurchaseIdr: number; maxCoverageIdr: number }) {
    return FreeShippingRuleRepository.update(input);
  }

  static async setActive(code: string, active: boolean) {
    const current = await ShippingCourierRepository.find(code);
    if (current?.active === active) return current;

    if (!active) {
      const result = await ShippingCourierRepository.deactivate(code);
      if (result === "NOT_FOUND") throw new HttpError(404, "COURIER_NOT_FOUND", "Courier configuration was not found");
      if (result === "LAST_ACTIVE") {
        throw new HttpError(409, "LAST_ACTIVE_COURIER", "At least one courier must remain active");
      }
      return result;
    }

    const catalog = await fetchBiteshipCouriers();
    if (!catalog.has(code)) {
      throw new HttpError(400, "UNKNOWN_BITESHIP_COURIER", "Courier is not available in Biteship's catalog");
    }

    return ShippingCourierRepository.setActive(code, true);
  }
}
