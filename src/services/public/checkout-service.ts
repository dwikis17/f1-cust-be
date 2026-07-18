import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
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

async function createSnapToken(order: Awaited<ReturnType<typeof prisma.order.findUniqueOrThrow>> & {
  items: Array<{ sku: string; productName: string; unitPriceIdr: number; quantity: number }>;
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
          name: item.productName.slice(0, 50),
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

async function bookShipment(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.paymentStatus !== "PAID" || order.fulfillmentStatus === "BOOKED") return;
  if (!config.biteshipApiKey || !config.biteshipOriginPostalCode || !config.biteshipOriginContactName
    || !config.biteshipOriginContactPhone || !config.biteshipOriginAddress) {
    await prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "BOOKING_FAILED" } });
    throw new HttpError(503, "FULFILLMENT_NOT_CONFIGURED", "Shipment booking is not configured");
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
        items: order.items.map((item) => ({
          name: item.productName,
          category: "fashion",
          sku: item.sku,
          value: item.unitPriceIdr,
          quantity: item.quantity,
          weight: item.packageWeightG,
          height: item.packageHeightMm / 10,
          length: item.packageLengthMm / 10,
          width: item.packageWidthMm / 10,
        })),
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    await prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "BOOKING_FAILED" } });
    throw new HttpError(503, "FULFILLMENT_UPSTREAM_ERROR", "Shipment booking will be retried");
  }

  const body: unknown = await response.json().catch(() => undefined);
  const created = biteshipOrderSchema.safeParse(body);
  const duplicate = biteshipDuplicateSchema.safeParse(body);
  if ((!response.ok && !duplicate.success) || (response.ok && !created.success)) {
    await prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "BOOKING_FAILED" } });
    throw new HttpError(503, "FULFILLMENT_UPSTREAM_ERROR", "Shipment booking will be retried");
  }

  if (created.success) {
    await prisma.order.update({
      where: { id: orderId },
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
    await prisma.order.update({
      where: { id: orderId },
      data: {
        fulfillmentStatus: "BOOKED",
        biteshipOrderId: duplicate.data.details.order_id,
        biteshipWaybillId: duplicate.data.details.waybill_id ?? null,
        biteshipStatus: "confirmed",
      },
    });
  }
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
            id: true, sku: true, stockQuantity: true, packageLengthMm: true, packageWidthMm: true,
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

    const order = await prisma.order.findUnique({ where: { id: input.order_id } });
    if (!order) notFound("Order not found");
    const amount = Number(input.gross_amount);
    if (!Number.isInteger(amount) || amount !== order.totalIdr) {
      throw new HttpError(400, "PAYMENT_AMOUNT_MISMATCH", "Payment amount does not match the order");
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

    if (paid && order.paymentStatus === "PENDING") {
      await prisma.order.update({ where: { id: order.id }, data: { ...transaction, paymentStatus: "PAID" } });
    } else if (terminal && order.paymentStatus === "PENDING") {
      await prisma.order.update({ where: { id: order.id }, data: transaction });
      await releaseStock(order.id, terminal, input.transaction_status);
    } else if ((input.transaction_status === "refund" || input.transaction_status === "chargeback")
      && order.paymentStatus === "PAID") {
      await prisma.order.update({ where: { id: order.id }, data: { ...transaction, paymentStatus: "REFUNDED" } });
    } else if (input.transaction_status === "pending" && order.paymentStatus === "PENDING") {
      await prisma.order.update({ where: { id: order.id }, data: transaction });
    }

    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    if (current.paymentStatus === "PAID" && current.fulfillmentStatus !== "BOOKED") await bookShipment(current.id);
    return { received: true };
  }
}
