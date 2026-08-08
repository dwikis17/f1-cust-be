import { z } from "zod";

export const shipmentCollectionMethodSchema = z.enum(["pickup", "drop_off"]);
export type ShipmentCollectionMethod = z.infer<typeof shipmentCollectionMethodSchema>;
export type ShipmentCollectionMethodDb = "PICKUP" | "DROP_OFF";

export function toDbCollectionMethod(method: ShipmentCollectionMethod): ShipmentCollectionMethodDb {
  return method === "drop_off" ? "DROP_OFF" : "PICKUP";
}

export function fromDbCollectionMethod(method: string): ShipmentCollectionMethod {
  return method === "DROP_OFF" ? "drop_off" : "pickup";
}

export function normalizeCollectionMethods(values: readonly string[]): ShipmentCollectionMethod[] {
  const methods = values.filter((value): value is ShipmentCollectionMethod =>
    value === "pickup" || value === "drop_off");
  const unique = [...new Set(methods)];
  return unique.length ? unique : ["pickup"];
}

export function defaultCollectionMethod(methods: readonly ShipmentCollectionMethod[]): ShipmentCollectionMethod {
  return methods.includes("drop_off") ? "drop_off" : methods[0] ?? "drop_off";
}
