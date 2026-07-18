import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../http.js";
import { PublicShippingService } from "./shipping-service.js";

export type CheckoutInput = {
  idempotencyKey: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  items: Array<{ variantId: string; quantity: number }>;
  courierCode: string;
  serviceCode: string;
};

export type MidtransNotification = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  merchant_id: string;
  transaction_status: string;
  fraud_status?: string;
  transaction_id?: string;
  payment_type?: string;
};

const snapResponseSchema = z.object({ token: z.string().min(1), redirect_url: z.string().url() }).passthrough();
const biteshipOrderSchema = z.object({
  id: z.string(),
  courier: z.object({ tracking_id: z.string().nullish(), waybill_id: z.string().nullish() }).passthrough(),
  price: z.number().int().nonnegative(),
  status: z.string(),
}).passthrough();
const biteshipDuplicateSchema = z.object({
  code: z.literal(40002060),
  details: z.object({ order_id: z.string(), waybill_id: z.string().nullish() }).passthrough(),
}).passthrough();

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
type VariantSnapshot = Pick<OrderWithItems["items"][number], "productName" | "sku" | "color" | "size">;

function prismaCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function publicOrder(order: {
  id: string;
  subtotalIdr: number;
  shippingIdr: number;
  totalIdr: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  courierCode: string;
  courierName: string;
  courierServiceCode: string;
  courierServiceName: string;
  courierDuration: string;
  biteshipTrackingId: string | null;
  biteshipWaybillId: string | null;
  biteshipStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: order.id,
    subtotalIdr: order.subtotalIdr,
    shippingIdr: order.shippingIdr,
    totalIdr: order.totalIdr,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    courier: {
      code: order.courierCode,
      name: order.courierName,
      serviceCode: order.courierServiceCode,
      serviceName: order.courierServiceName,
      duration: order.courierDuration,
    },
    tracking: {
      id: order.biteshipTrackingId,
      waybillId: order.biteshipWaybillId,
      status: order.biteshipStatus,
    },
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function checkoutResponse(order: Awaited<ReturnType<typeof prisma.order.findUniqueOrThrow>>) {
  if (!order.midtransSnapToken) throw new HttpError(409, "CHECKOUT_IN_PROGRESS", "Checkout is still being prepared");
  return { orderId: order.id, snapToken: order.midtransSnapToken, paymentStatus: order.paymentStatus, totalIdr: order.totalIdr };
}

function requirePaymentConfig() {
  if (!config.midtransMerchantId || !config.midtransServerKey || !config.storefrontUrl) {
    throw new HttpError(503, "PAYMENT_NOT_CONFIGURED", "Payment is not configured");
  }
  return {
    merchantId: config.midtransMerchantId,
    serverKey: config.midtransServerKey,
    snapUrl: config.midtransEnv === "production"
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions",
  };
}

async function releaseStock(orderId: string, paymentStatus: "FAILED" | "EXPIRED" | "CANCELLED", midtransStatus: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.paymentStatus !== "PENDING" || order.stockReleasedAt) return;
    for (const item of order.items) {
      if (item.variantId) {
        await tx.productVariant.updateMany({
          where: { id: item.variantId },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }
    }
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus, midtransStatus, stockReleasedAt: new Date() },
    });
  });
}

function variantName(item: VariantSnapshot) {
  const options = [item.color, item.size].filter((value): value is string => Boolean(value));
  return options.length ? `${item.productName} (${options.join(" / ")})` : item.productName;
}

function variantDescription(item: VariantSnapshot) {
  const options = [item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`]
    .filter((value): value is string => Boolean(value));
  return options.length ? options.join(" / ") : undefined;
}

async function createSnapToken(order: Awaited<ReturnType<typeof prisma.order.findUniqueOrThrow>> & {
  items: Array<VariantSnapshot & { unitPriceIdr: number; quantity: number }>;
}) {
  const payment = requirePaymentConfig();
  const response = await fetch(payment.snapUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${payment.serverKey}:`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transaction_details: { order_id: order.id, gross_amount: order.totalIdr },
      item_details: [
        ...order.items.map((item) => ({
          id: item.sku.slice(0, 50),
          price: item.unitPriceIdr,
          quantity: item.quantity,
          name: variantName(item).slice(0, 50),
        })),
        { id: "shipping", price: order.shippingIdr, quantity: 1, name: `${order.courierName} ${order.courierServiceName}`.slice(0, 50) },
      ],
      customer_details: {
        first_name: order.firstName,
        last_name: order.lastName,
        email: order.email,
        phone: order.phone,
      },
      expiry: { unit: "hours", duration: 24 },
      callbacks: { finish: `${config.storefrontUrl}/orders/${order.id}` },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = snapResponseSchema.safeParse(body);
  if (!response.ok || !parsed.success) {
    throw new HttpError(502, "PAYMENT_UPSTREAM_ERROR", "Payment could not be started");
  }
  return parsed.data.token;
}

async function bookShipment(tx: Prisma.TransactionClient, order: OrderWithItems) {
  if (order.paymentStatus !== "PAID" || order.fulfillmentStatus === "BOOKED") return false;
  if (!config.biteshipApiKey || !config.biteshipOriginPostalCode || !config.biteshipOriginContactName
    || !config.biteshipOriginContactPhone || !config.biteshipOriginAddress) {
    await tx.order.update({ where: { id: order.id }, data: { fulfillmentStatus: "BOOKING_FAILED" } });
    return true;
  }

  let response: Response;
  try {
    response = await fetch("https://api.biteship.com/v1/orders", {
      method: "POST",
      headers: { authorization: config.biteshipApiKey, "content-type": "application/json" },
      body: JSON.stringify({
        origin_contact_name: config.biteshipOriginContactName,
        origin_contact_phone: config.biteshipOriginContactPhone,
        origin_address: config.biteshipOriginAddress,
        origin_postal_code: Number(config.biteshipOriginPostalCode),
        origin_collection_method: "pickup",
        destination_contact_name: `${order.firstName} ${order.lastName}`,
        destination_contact_phone: order.phone,
        destination_contact_email: order.email,
        destination_address: `${order.address}, ${order.city}, ${order.province} ${order.postalCode}`,
        destination_postal_code: Number(order.postalCode),
        courier_company: order.courierCode,
        courier_type: order.courierServiceCode,
        delivery_type: "now",
        reference_id: order.id,
        items: order.items.map((item) => {
          const description = variantDescription(item);
          return {
            name: variantName(item),
            ...(description ? { description } : {}),
            category: "fashion",
            sku: item.sku,
            value: item.unitPriceIdr,
            quantity: item.quantity,
            weight: item.packageWeightG,
            height: item.packageHeightMm / 10,
            length: item.packageLengthMm / 10,
            width: item.packageWidthMm / 10,
          };
        }),
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    await tx.order.update({ where: { id: order.id }, data: { fulfillmentStatus: "BOOKING_FAILED" } });
    return true;
  }

  const body: unknown = await response.json().catch(() => undefined);
  const created = biteshipOrderSchema.safeParse(body);
  const duplicate = biteshipDuplicateSchema.safeParse(body);
  if ((!response.ok && !duplicate.success) || (response.ok && !created.success)) {
    await tx.order.update({ where: { id: order.id }, data: { fulfillmentStatus: "BOOKING_FAILED" } });
    return true;
  }

  if (created.success) {
    await tx.order.update({
      where: { id: order.id },
      data: {
        fulfillmentStatus: "BOOKED",
        biteshipOrderId: created.data.id,
        biteshipTrackingId: created.data.courier.tracking_id ?? null,
        biteshipWaybillId: created.data.courier.waybill_id ?? null,
        biteshipPriceIdr: created.data.price,
        biteshipStatus: created.data.status,
      },
    });
  } else if (duplicate.success) {
    await tx.order.update({
      where: { id: order.id },
      data: {
        fulfillmentStatus: "BOOKED",
        biteshipOrderId: duplicate.data.details.order_id,
        biteshipWaybillId: duplicate.data.details.waybill_id ?? null,
        biteshipStatus: "confirmed",
      },
    });
  }
  return false;
}

function secureEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export class PublicCheckoutService {
  static async create(input: CheckoutInput) {
    requirePaymentConfig();
    const previous = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (previous) return checkoutResponse(previous);

    const quote = await PublicShippingService.rates({
      destinationPostalCode: input.postalCode,
      items: input.items,
    });
    const rate = quote.rates.find((item) => item.courierCode === input.courierCode && item.serviceCode === input.serviceCode);
    if (!rate) throw new HttpError(409, "SHIPPING_RATE_CHANGED", "The selected shipping service is no longer available");

    const quantities = new Map<string, number>();
    for (const item of input.items) quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const variants = await tx.productVariant.findMany({
          where: { id: { in: [...quantities.keys()] } },
          select: {
            id: true, sku: true, color: true, size: true, stockQuantity: true, packageLengthMm: true, packageWidthMm: true,
            packageHeightMm: true, packageWeightG: true,
            product: { select: { name: true, priceIdr: true, status: true } },
          },
        });
        if (variants.length !== quantities.size || variants.some((variant) =>
          variant.product.status !== "ACTIVE" || variant.stockQuantity < (quantities.get(variant.id) ?? 0))) {
          throw new HttpError(409, "CART_CHANGED", "One or more cart items are unavailable");
        }
        for (const variant of variants) {
          const quantity = quantities.get(variant.id) ?? 0;
          const updated = await tx.productVariant.updateMany({
            where: { id: variant.id, stockQuantity: { gte: quantity } },
            data: { stockQuantity: { decrement: quantity } },
          });
          if (updated.count !== 1) throw new HttpError(409, "CART_CHANGED", "One or more cart items are unavailable");
        }
        const subtotalIdr = variants.reduce((sum, variant) => sum + variant.product.priceIdr * (quantities.get(variant.id) ?? 0), 0);
        return tx.order.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            address: input.address,
            city: input.city,
            province: input.province,
            postalCode: input.postalCode,
            subtotalIdr,
            shippingIdr: rate.price,
            totalIdr: subtotalIdr + rate.price,
            courierCode: rate.courierCode,
            courierName: rate.courierName,
            courierServiceCode: rate.serviceCode,
            courierServiceName: rate.serviceName,
            courierDuration: rate.duration,
            items: {
              create: variants.map((variant) => ({
                variantId: variant.id,
                productName: variant.product.name,
                sku: variant.sku,
                color: variant.color,
                size: variant.size,
                unitPriceIdr: variant.product.priceIdr,
                quantity: quantities.get(variant.id) ?? 0,
                packageLengthMm: variant.packageLengthMm,
                packageWidthMm: variant.packageWidthMm,
                packageHeightMm: variant.packageHeightMm,
                packageWeightG: variant.packageWeightG,
              })),
            },
          },
          include: { items: true },
        });
      });
    } catch (error) {
      if (prismaCode(error) === "P2002") {
        const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return checkoutResponse(existing);
      }
      throw error;
    }

    try {
      const snapToken = await createSnapToken(order);
      const ready = await prisma.order.update({ where: { id: order.id }, data: { midtransSnapToken: snapToken } });
      return checkoutResponse(ready);
    } catch (error) {
      await releaseStock(order.id, "FAILED", "token_failure");
      throw error;
    }
  }

  static async find(id: string) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) notFound("Order not found");
    return publicOrder(order);
  }

  static async notification(input: MidtransNotification) {
    const payment = requirePaymentConfig();
    const signature = createHash("sha512")
      .update(`${input.order_id}${input.status_code}${input.gross_amount}${payment.serverKey}`)
      .digest("hex");
    if (!secureEqual(input.signature_key, signature) || !secureEqual(input.merchant_id, payment.merchantId)) {
      throw new HttpError(401, "INVALID_NOTIFICATION", "Payment notification could not be verified");
    }

    const transaction = {
      midtransStatus: input.transaction_status,
      midtransTransactionId: input.transaction_id,
      midtransPaymentType: input.payment_type,
    };
    const paid = (input.transaction_status === "capture" || input.transaction_status === "settlement")
      && input.fraud_status === "accept";
    const terminal = input.transaction_status === "deny" || input.transaction_status === "failure"
      ? "FAILED"
      : input.transaction_status === "expire" ? "EXPIRED"
      : input.transaction_status === "cancel" ? "CANCELLED"
      : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id" = ${input.order_id}::uuid FOR UPDATE
      `;
      if (!locked.length) notFound("Order not found");
      let order = await tx.order.findUniqueOrThrow({ where: { id: input.order_id }, include: { items: true } });
      const amount = Number(input.gross_amount);
      if (!Number.isInteger(amount) || amount !== order.totalIdr) {
        throw new HttpError(400, "PAYMENT_AMOUNT_MISMATCH", "Payment amount does not match the order");
      }

      if (paid && order.paymentStatus !== "REFUNDED") {
        if (order.stockReleasedAt) {
          const quantities = new Map<string, number>();
          for (const item of order.items) {
            if (!item.variantId) {
              await tx.order.update({
                where: { id: order.id },
                data: { ...transaction, paymentStatus: "PAID", fulfillmentStatus: "BOOKING_FAILED" },
              });
              return { bookingFailed: true, stockUnavailable: true };
            }
            quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
          }

          let stockAvailable = true;
          for (const [variantId, quantity] of [...quantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            const variants = await tx.$queryRaw<Array<{ stockQuantity: number }>>`
              SELECT "stockQuantity" FROM "ProductVariant" WHERE "id" = ${variantId}::uuid FOR UPDATE
            `;
            if (!variants[0] || variants[0].stockQuantity < quantity) stockAvailable = false;
          }
          if (!stockAvailable) {
            await tx.order.update({
              where: { id: order.id },
              data: { ...transaction, paymentStatus: "PAID", fulfillmentStatus: "BOOKING_FAILED" },
            });
            return { bookingFailed: true, stockUnavailable: true };
          }
          for (const [variantId, quantity] of quantities) {
            await tx.productVariant.update({
              where: { id: variantId },
              data: { stockQuantity: { decrement: quantity } },
            });
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              ...transaction,
              paymentStatus: "PAID",
              fulfillmentStatus: order.fulfillmentStatus === "BOOKED" ? "BOOKED" : "UNFULFILLED",
              stockReleasedAt: null,
            },
          });
        } else {
          await tx.order.update({ where: { id: order.id }, data: { ...transaction, paymentStatus: "PAID" } });
        }
      } else if (terminal && order.paymentStatus === "PENDING") {
        if (!order.stockReleasedAt) {
          for (const item of order.items) {
            if (item.variantId) {
              await tx.productVariant.updateMany({
                where: { id: item.variantId },
                data: { stockQuantity: { increment: item.quantity } },
              });
            }
          }
        }
        await tx.order.update({
          where: { id: order.id },
          data: { ...transaction, paymentStatus: terminal, stockReleasedAt: order.stockReleasedAt ?? new Date() },
        });
      } else if ((input.transaction_status === "refund" || input.transaction_status === "chargeback")
        && order.paymentStatus === "PAID") {
        await tx.order.update({ where: { id: order.id }, data: { ...transaction, paymentStatus: "REFUNDED" } });
      } else if (input.transaction_status === "pending" && order.paymentStatus === "PENDING") {
        await tx.order.update({ where: { id: order.id }, data: transaction });
      }

      order = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      const bookingFailed = order.paymentStatus === "PAID" && order.fulfillmentStatus !== "BOOKED"
        ? await bookShipment(tx, order)
        : false;
      return { bookingFailed, stockUnavailable: false };
    }, { timeout: 10_000 });

    if (result.bookingFailed) {
      throw new HttpError(
        503,
        result.stockUnavailable ? "FULFILLMENT_STOCK_UNAVAILABLE" : "FULFILLMENT_UPSTREAM_ERROR",
        result.stockUnavailable ? "Paid order is waiting for stock" : "Shipment booking will be retried",
      );
    }
    return { received: true };
  }
}
