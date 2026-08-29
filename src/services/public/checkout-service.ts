import { Buffer } from "node:buffer";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../../config.js";
import { sendPaymentConfirmationEmail } from "../../email-service.js";
import { scheduleBackground } from "../../background.js";
import { HttpError, notFound } from "../../http.js";
import {
  OrderRepository,
  type CheckoutInput,
  type CheckoutOrder,
  type OrderWithItems,
} from "../../repositories/order-repository.js";
import type { ShipmentCollectionMethod } from "../../shipment-collection.js";
import { calculatePromoDiscount } from "../promo-code-service.js";
import { PublicShippingService, requestBiteshipRates } from "./shipping-service.js";
import { sendTelegramPaymentNotification } from "../../telegram-service.js";

export type { CheckoutInput, CheckoutOrder, OrderWithItems } from "../../repositories/order-repository.js";

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
  courier: z.object({
    tracking_id: z.string().nullish(),
    waybill_id: z.string().nullish(),
    insurance: z.object({ amount: z.number().int().nonnegative(), fee: z.number().int().nonnegative() }).nullish(),
  }).passthrough(),
  price: z.number().int().nonnegative(),
  status: z.string(),
}).passthrough();
const biteshipDuplicateSchema = z.object({
  code: z.literal(40002060),
  details: z.object({ order_id: z.string(), waybill_id: z.string().nullish() }).passthrough(),
}).passthrough();
const biteshipTrackingSchema = z.object({
  success: z.literal(true),
  id: z.string(),
  waybill_id: z.string(),
  history: z.array(z.object({
    note: z.string(),
    updated_at: z.string(),
    status: z.string(),
  }).passthrough()),
  link: z.string().url().nullish(),
  status: z.string(),
}).passthrough();
const midtransStatusSchema = z.object({
  order_id: z.string().uuid(),
  status_code: z.string().min(1).max(10),
  gross_amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  signature_key: z.string().min(1).max(256),
  merchant_id: z.string().min(1).max(100),
  transaction_status: z.string().min(1).max(40),
  fraud_status: z.string().max(40).optional(),
  transaction_id: z.string().max(100).optional(),
  payment_type: z.string().max(80).optional(),
}).passthrough();
const midtransExpireSchema = z.object({
  order_id: z.string().uuid(),
  status_code: z.string().min(1).max(10),
  gross_amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  transaction_status: z.literal("expire"),
}).passthrough();

type VariantSnapshot = Pick<OrderWithItems["items"][number], "productName" | "sku" | "color" | "size">;
const PAYMENT_EXPIRY_HOURS = 6;
const HOUR_MS = 60 * 60 * 1_000;
const RECONCILIATION_BATCH_SIZE = 50;

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function publicOrder(order: {
  id: string;
  orderNumber: string;
  subtotalIdr: number;
  discountIdr: number;
  shippingOriginalIdr: number;
  shippingDiscountIdr: number;
  shippingIdr: number;
  insuranceValueIdr: number;
  insuranceFeeIdr: number;
  totalIdr: number;
  promoCode: { code: string } | null;
  paymentStatus: string;
  shipmentBookingStatus: string;
  lifecycleStatus: string;
  externalRefundedAt: Date | null;
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
    orderNumber: order.orderNumber,
    subtotalIdr: order.subtotalIdr,
    discountIdr: order.discountIdr,
    shippingOriginalIdr: order.shippingOriginalIdr,
    shippingDiscountIdr: order.shippingDiscountIdr,
    shippingIdr: order.shippingIdr,
    insuranceValueIdr: order.insuranceValueIdr,
    insuranceFeeIdr: order.insuranceFeeIdr,
    totalIdr: order.totalIdr,
    promoCode: order.promoCode?.code ?? null,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.shipmentBookingStatus,
    lifecycleStatus: order.lifecycleStatus,
    refundState: order.externalRefundedAt
      ? "EXTERNALLY_REFUNDED"
      : order.lifecycleStatus === "CANCELLED" && order.paymentStatus === "PAID"
        ? "REQUIRED"
        : "NONE",
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

function checkoutResponse(order: {
  id: string;
  orderNumber: string;
  midtransSnapToken: string | null;
  paymentStatus: string;
  subtotalIdr: number;
  discountIdr: number;
  shippingOriginalIdr: number;
  shippingDiscountIdr: number;
  shippingIdr: number;
  insuranceValueIdr: number;
  insuranceFeeIdr: number;
  totalIdr: number;
  promoCode: { code: string } | null;
}) {
  if (!order.midtransSnapToken) throw new HttpError(409, "CHECKOUT_IN_PROGRESS", "Checkout is still being prepared");
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    snapToken: order.midtransSnapToken,
    paymentStatus: order.paymentStatus,
    subtotalIdr: order.subtotalIdr,
    discountIdr: order.discountIdr,
    shippingOriginalIdr: order.shippingOriginalIdr,
    shippingDiscountIdr: order.shippingDiscountIdr,
    shippingIdr: order.shippingIdr,
    insuranceValueIdr: order.insuranceValueIdr,
    insuranceFeeIdr: order.insuranceFeeIdr,
    totalIdr: order.totalIdr,
    promoCode: order.promoCode?.code ?? null,
  };
}

function createOrderNumber(id: string) {
  const value = id.replaceAll("-", "").slice(0, 12).toUpperCase();
  return `VLD-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function requirePaymentConfig() {
  if (!config.midtransMerchantId || !config.midtransServerKey || !config.storefrontUrl) {
    throw new HttpError(503, "PAYMENT_NOT_CONFIGURED", "Payment is not configured");
  }
  return {
    merchantId: config.midtransMerchantId,
    serverKey: config.midtransServerKey,
    notificationUrl: config.midtransNotificationUrl,
    snapUrl: config.midtransEnv === "production"
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions",
  };
}

function telegramPaidFields(order: { paymentStatus: string; telegramNotificationQueuedAt: Date | null }) {
  if (!config.telegramBotToken || !config.telegramChatId || order.paymentStatus === "PAID" || order.telegramNotificationQueuedAt) {
    return {};
  }
  return { telegramNotificationQueuedAt: new Date() };
}

async function releaseStock(orderId: string, paymentStatus: "FAILED" | "EXPIRED" | "CANCELLED", midtransStatus: string) {
  return OrderRepository.releaseStock(orderId, paymentStatus, midtransStatus);
}

function midtransStartTime(date: Date) {
  const jakarta = new Date(date.getTime() + 7 * HOUR_MS).toISOString();
  return `${jakarta.slice(0, 10)} ${jakarta.slice(11, 19)} +0700`;
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

async function createSnapToken(order: CheckoutOrder) {
  const payment = requirePaymentConfig();
  const response = await fetch(payment.snapUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${payment.serverKey}:`).toString("base64")}`,
      "content-type": "application/json",
      ...(payment.notificationUrl ? { "X-Override-Notification": payment.notificationUrl } : {}),
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
        ...(order.discountIdr > 0 ? [{
          id: "promo-discount",
          price: -order.discountIdr,
          quantity: 1,
          name: `Promo ${order.promoCode?.code ?? "discount"}`.slice(0, 50),
        }] : []),
        { id: "shipping", price: order.shippingOriginalIdr, quantity: 1, name: `${order.courierName} ${order.courierServiceName}`.slice(0, 50) },
        ...(order.shippingDiscountIdr > 0 ? [{
          id: "free-shipping",
          price: -order.shippingDiscountIdr,
          quantity: 1,
          name: "Free-shipping coverage",
        }] : []),
        ...(order.insuranceFeeIdr > 0 ? [{
          id: "shipping-insurance",
          price: order.insuranceFeeIdr,
          quantity: 1,
          name: "Shipping insurance",
        }] : []),
      ],
      customer_details: {
        first_name: order.firstName,
        last_name: order.lastName,
        email: order.email,
        phone: order.phone,
      },
      expiry: {
        start_time: midtransStartTime(order.createdAt),
        unit: "hours",
        duration: PAYMENT_EXPIRY_HOURS,
      },
      page_expiry: { unit: "hours", duration: PAYMENT_EXPIRY_HOURS },
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

export type ShipmentBookingResult = {
  success: true;
  providerOrderId: string;
  trackingId: string | null;
  waybillId: string | null;
  priceIdr: number | null;
  insuranceValueIdr: number;
  insuranceFeeIdr: number;
  providerStatus: string;
  collectionMethod: ShipmentCollectionMethod;
  availableCollectionMethods: ShipmentCollectionMethod[];
} | {
  success: false;
  code: "CONFIGURATION" | "UPSTREAM" | "INVALID_RESPONSE" | "COLLECTION_METHOD_UNAVAILABLE" | "RATE_UNAVAILABLE";
  message: string;
  availableCollectionMethods?: ShipmentCollectionMethod[];
};

function biteshipItems(order: OrderWithItems) {
  return order.items.map((item) => {
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
  });
}

async function getShipmentCollectionOptionsInternal(order: OrderWithItems) {
  const rates = await requestBiteshipRates({
    destinationPostalCode: order.postalCode,
    items: biteshipItems(order),
    courierCodes: [order.courierCode],
  });
  const rate = rates.find((item) => item.courierCode === order.courierCode && item.serviceCode === order.courierServiceCode);
  if (!rate) throw new HttpError(409, "SHIPMENT_RATE_UNAVAILABLE", "The selected shipping service is no longer available");
  return { rate, availableCollectionMethods: rate.availableCollectionMethods };
}

async function requestShipmentBookingInternal(
  order: OrderWithItems,
  requestedCollectionMethod: ShipmentCollectionMethod = "drop_off",
): Promise<ShipmentBookingResult> {
  if (!config.biteshipApiKey || !config.biteshipOriginPostalCode || !config.biteshipOriginContactName
    || !config.biteshipOriginContactPhone || !config.biteshipOriginAddress) {
    return { success: false, code: "CONFIGURATION", message: "Biteship shipment booking is not configured" };
  }

  let availableCollectionMethods: ShipmentCollectionMethod[];
  try {
    ({ availableCollectionMethods } = await getShipmentCollectionOptionsInternal(order));
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        success: false,
        code: error.code === "SHIPMENT_RATE_UNAVAILABLE" ? "RATE_UNAVAILABLE" : error.code === "SHIPPING_NOT_CONFIGURED" ? "CONFIGURATION" : "UPSTREAM",
        message: error.message,
        ...(error.code === "SHIPMENT_RATE_UNAVAILABLE" ? { availableCollectionMethods: [] } : {}),
      };
    }
    return { success: false, code: "UPSTREAM", message: "Biteship rates are temporarily unavailable" };
  }

  const collectionMethod = requestedCollectionMethod === "drop_off"
    && !availableCollectionMethods.includes("drop_off")
    && availableCollectionMethods.includes("pickup")
    ? "pickup"
    : requestedCollectionMethod;
  if (!availableCollectionMethods.includes(collectionMethod)) {
    return {
      success: false,
      code: "COLLECTION_METHOD_UNAVAILABLE",
      message: "The selected handover method is no longer available; choose another method",
      availableCollectionMethods,
    };
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
        origin_collection_method: collectionMethod,
        destination_contact_name: `${order.firstName} ${order.lastName}`,
        destination_contact_phone: order.phone,
        destination_contact_email: order.email,
        destination_address: `${order.address}, ${order.city}, ${order.province} ${order.postalCode}`,
        destination_postal_code: Number(order.postalCode),
        courier_company: order.courierCode,
        courier_type: order.courierServiceCode,
        ...(order.insuranceValueIdr > 0 ? { courier_insurance: order.insuranceValueIdr } : {}),
        delivery_type: "now",
        reference_id: order.id,
        items: biteshipItems(order),
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    return { success: false, code: "UPSTREAM", message: "Biteship booking is temporarily unavailable" };
  }

  const body: unknown = await response.json().catch(() => undefined);
  const created = biteshipOrderSchema.safeParse(body);
  const duplicate = biteshipDuplicateSchema.safeParse(body);
  if ((!response.ok && !duplicate.success) || (response.ok && !created.success)) {
    return { success: false, code: "INVALID_RESPONSE", message: "Biteship did not accept the shipment booking" };
  }

  if (created.success) {
    return {
      success: true,
      providerOrderId: created.data.id,
      trackingId: created.data.courier.tracking_id ?? null,
      waybillId: created.data.courier.waybill_id ?? null,
      priceIdr: created.data.price,
      insuranceValueIdr: created.data.courier.insurance?.amount ?? order.insuranceValueIdr,
      insuranceFeeIdr: created.data.courier.insurance?.fee ?? order.insuranceFeeIdr,
      providerStatus: created.data.status,
      collectionMethod,
      availableCollectionMethods,
    };
  }
  if (!duplicate.success) {
    return { success: false, code: "INVALID_RESPONSE", message: "Biteship returned an unexpected response" };
  }
  return {
    success: true,
    providerOrderId: duplicate.data.details.order_id,
    trackingId: null,
    waybillId: duplicate.data.details.waybill_id ?? null,
    priceIdr: null,
    insuranceValueIdr: order.insuranceValueIdr,
    insuranceFeeIdr: order.insuranceFeeIdr,
    providerStatus: "confirmed",
    collectionMethod,
    availableCollectionMethods,
  };
}

function secureEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function verifyMidtrans(input: MidtransNotification) {
  const payment = requirePaymentConfig();
  const signature = createHash("sha512")
    .update(`${input.order_id}${input.status_code}${input.gross_amount}${payment.serverKey}`)
    .digest("hex");
  if (!secureEqual(input.signature_key, signature) || !secureEqual(input.merchant_id, payment.merchantId)) {
    throw new HttpError(401, "INVALID_NOTIFICATION", "Payment notification could not be verified");
  }
}

export class PublicCheckoutService {
  static getShipmentCollectionOptions(order: OrderWithItems) {
    return getShipmentCollectionOptionsInternal(order);
  }

  static requestShipmentBooking(
    order: OrderWithItems,
    requestedCollectionMethod: ShipmentCollectionMethod = "drop_off",
  ) {
    return requestShipmentBookingInternal(order, requestedCollectionMethod);
  }

  static async create(input: CheckoutInput) {
    requirePaymentConfig();
    const previous = await OrderRepository.findByIdempotencyKey(input.idempotencyKey);
    if (previous) return checkoutResponse(previous);

    const quote = await PublicShippingService.rates({
      destinationPostalCode: input.postalCode,
      items: input.items,
      promoCode: input.promoCode,
      includeInsurance: input.includeInsurance,
    });
    const rate = quote.rates.find((item) => item.courierCode === input.courierCode && item.serviceCode === input.serviceCode);
    if (!rate || rate.price !== input.quotedShippingIdr || (input.includeInsurance && !rate.insuranceAvailable)) {
      throw new HttpError(409, "SHIPPING_RATE_CHANGED", "The selected shipping service or price has changed");
    }

    const orderId = randomUUID();
    const createdAt = new Date();
    let order: CheckoutOrder;
    try {
      const created = await OrderRepository.createCheckoutOrder({
        ...input,
        orderId,
        orderNumber: createOrderNumber(orderId),
        createdAt,
        paymentExpiresAt: new Date(createdAt.getTime() + PAYMENT_EXPIRY_HOURS * HOUR_MS),
        shippingPrice: rate.price,
        shippingOriginalPrice: rate.originalPrice,
        shippingDiscount: rate.shippingDiscountIdr,
        insuranceValue: input.includeInsurance ? rate.insuranceValueIdr : 0,
        insuranceFee: input.includeInsurance ? rate.insuranceFeeIdr : 0,
        shippingName: rate.courierName,
        shippingServiceName: rate.serviceName,
        shippingDuration: rate.duration,
        availableCollectionMethods: rate.availableCollectionMethods,
        calculateDiscount: calculatePromoDiscount,
      });
      if (created.status !== "CREATED") {
        throw new HttpError(
          409,
          created.status,
          created.status === "CART_CHANGED" ? "One or more cart items are unavailable" : "Promo code is invalid or inactive",
        );
      }
      order = created.order;
    } catch (error) {
      if (errorCode(error) === "P2002") {
        const existing = await OrderRepository.findByIdempotencyKey(input.idempotencyKey);
        if (existing) return checkoutResponse(existing);
      }
      throw error;
    }

    try {
      const snapToken = await createSnapToken(order);
      const ready = await OrderRepository.setSnapToken(order.id, snapToken);
      return checkoutResponse(ready);
    } catch (error) {
      await releaseStock(order.id, "FAILED", "token_failure");
      throw error;
    }
  }

  static async find(id: string) {
    const order = await OrderRepository.findForPublic(id);
    if (!order) notFound("Order not found");
    return publicOrder(order);
  }

  static async track(input: { orderNumber: string; email: string }) {
    const legacyId = z.string().uuid().safeParse(input.orderNumber);
    const order = await OrderRepository.findForTracking(input.orderNumber, input.email, legacyId.success ? legacyId.data : undefined);
    if (!order) throw new HttpError(404, "TRACKING_NOT_FOUND", "No order matches those details");

    const result = {
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.shipmentBookingStatus,
      lifecycleStatus: order.lifecycleStatus,
      refundState: order.externalRefundedAt
        ? "EXTERNALLY_REFUNDED"
        : order.lifecycleStatus === "CANCELLED" && order.paymentStatus === "PAID"
          ? "REQUIRED"
          : "NONE",
      destination: { city: order.city, province: order.province },
      subtotalIdr: order.subtotalIdr,
      discountIdr: order.discountIdr,
      shippingOriginalIdr: order.shippingOriginalIdr,
      shippingDiscountIdr: order.shippingDiscountIdr,
      shippingIdr: order.shippingIdr,
      insuranceValueIdr: order.insuranceValueIdr,
      insuranceFeeIdr: order.insuranceFeeIdr,
      totalIdr: order.totalIdr,
      promoCode: order.promoCode?.code ?? null,
      courier: {
        name: order.courierName,
        serviceName: order.courierServiceName,
        duration: order.courierDuration,
      },
      items: order.items.map((item) => ({
        name: item.productName,
        sku: item.sku,
        color: item.color,
        size: item.size,
        unitPriceIdr: item.unitPriceIdr,
        quantity: item.quantity,
      })),
    };
    if (order.shipmentBookingStatus !== "BOOKED" || !order.biteshipTrackingId) {
      return { ...result, tracking: null };
    }
    if (!config.biteshipApiKey) {
      throw new HttpError(503, "TRACKING_UNAVAILABLE", "Shipment tracking is not configured");
    }

    let upstream: Response;
    try {
      upstream = await fetch(`https://api.biteship.com/v1/trackings/${encodeURIComponent(order.biteshipTrackingId)}`, {
        headers: { authorization: config.biteshipApiKey },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpError(502, "TRACKING_UPSTREAM_ERROR", "Shipment tracking is temporarily unavailable");
    }
    let body: unknown;
    try {
      body = await upstream.json();
    } catch {
      throw new HttpError(502, "TRACKING_UPSTREAM_ERROR", "Biteship returned an unexpected response");
    }
    if (!upstream.ok) {
      const code = z.object({ code: z.number().optional() }).passthrough().safeParse(body);
      if (code.success && code.data.code === 40003002) return { ...result, tracking: null };
      throw new HttpError(502, "TRACKING_UPSTREAM_ERROR", "Shipment tracking is temporarily unavailable");
    }
    const tracking = biteshipTrackingSchema.safeParse(body);
    if (!tracking.success) {
      throw new HttpError(502, "TRACKING_UPSTREAM_ERROR", "Biteship returned an unexpected response");
    }
    return {
      ...result,
      tracking: {
        waybillId: tracking.data.waybill_id,
        status: tracking.data.status,
        link: tracking.data.link ?? null,
        history: tracking.data.history
          .map((event) => ({ status: event.status, note: event.note, updatedAt: event.updated_at }))
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
      },
    };
  }

  static async notification(input: MidtransNotification) {
    verifyMidtrans(input);

    const order = await OrderRepository.findOrderTotal(input.order_id);
    if (!order) notFound("Order not found");
    const { signature_key: _signatureKey, ...redactedPayload } = input;
    const event = await OrderRepository.createPaymentEvent({
      orderId: input.order_id,
      statusCode: input.status_code,
      grossAmount: input.gross_amount,
      transactionStatus: input.transaction_status,
      transactionId: input.transaction_id,
      fraudStatus: input.fraud_status,
      paymentType: input.payment_type,
      payload: redactedPayload,
    });

    const amount = Number(input.gross_amount);
    if (!Number.isInteger(amount) || amount !== order.totalIdr) {
      await OrderRepository.rejectPaymentEvent(event.id);
      throw new HttpError(400, "PAYMENT_AMOUNT_MISMATCH", "Payment amount does not match the order");
    }

    const transaction = {
      midtransStatus: input.transaction_status,
      midtransTransactionId: input.transaction_id,
      midtransPaymentType: input.payment_type,
    };
    const paid = input.transaction_status === "settlement"
      || (input.transaction_status === "capture" && input.fraud_status === "accept");
    const terminal = input.transaction_status === "deny" || input.transaction_status === "failure"
      ? "FAILED"
      : input.transaction_status === "expire" ? "EXPIRED"
      : input.transaction_status === "cancel" ? "CANCELLED"
      : undefined;

    const result = await OrderRepository.processPaymentEvent({
      orderId: input.order_id,
      eventId: event.id,
      transaction,
      paid,
      terminal,
      transactionStatus: input.transaction_status,
      telegramPaidFields,
    });
    if (result.status === "NOT_FOUND") notFound("Order not found");

    scheduleBackground(sendTelegramPaymentNotification(input.order_id).catch((error) => {
      console.error(`Telegram payment notification crashed for order ${input.order_id}`, error);
    }));

    let emailDeliveryFailed = false;
    if (!result.cancelled) {
      try {
        await sendPaymentConfirmationEmail(input.order_id);
      } catch (error) {
        emailDeliveryFailed = true;
        console.error(`Payment confirmation email failed for order ${input.order_id}`, error);
      }
    }

    if (result.stockUnavailable) {
      await OrderRepository.createAudit({
        orderId: input.order_id,
        action: "PAID_STOCK_UNAVAILABLE",
        outcome: "FAILED",
        details: { transactionStatus: input.transaction_status },
      });
    }
    if (emailDeliveryFailed) {
      await OrderRepository.createAudit({
        orderId: input.order_id,
        action: "PAYMENT_CONFIRMATION_EMAIL_FAILED",
        outcome: "FAILED",
        details: { message: "Payment was persisted; an admin can resend the confirmation" },
      });
    }
    return { received: true };
  }

  static async reconcilePendingPayments(now = new Date()) {
    const payment = requirePaymentConfig();
    const orders = await OrderRepository.listPendingPaymentReconciliations(now, RECONCILIATION_BATCH_SIZE);
    const baseUrl = config.midtransEnv === "production" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
    let reconciled = 0;
    let expired = 0;
    let released = 0;
    let failed = 0;
    let catalogChanged = false;

    for (const order of orders) {
      try {
        const response = await fetch(`${baseUrl}/v2/${encodeURIComponent(order.id)}/status`, {
          headers: {
            accept: "application/json",
            authorization: `Basic ${Buffer.from(`${payment.serverKey}:`).toString("base64")}`,
          },
          signal: AbortSignal.timeout(8_000),
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (response.status === 404) {
          const didRelease = await releaseStock(order.id, "EXPIRED", "expire");
          expired += Number(didRelease);
          released += Number(didRelease);
          catalogChanged ||= didRelease;
          continue;
        }
        const parsed = midtransStatusSchema.safeParse(body);
        if (!response.ok || !parsed.success) throw new Error("Midtrans status lookup failed");

        const input: MidtransNotification = {
          ...parsed.data,
          transaction_status: parsed.data.transaction_status.toLowerCase(),
          fraud_status: parsed.data.fraud_status?.toLowerCase(),
        };
        if (input.order_id !== order.id) throw new Error("Midtrans returned a different order");
        verifyMidtrans(input);
        const amount = Number(input.gross_amount);
        if (!Number.isInteger(amount) || amount !== order.totalIdr) throw new Error("Payment amount does not match the order");

        const isPaid = input.transaction_status === "settlement"
          || (input.transaction_status === "capture" && input.fraud_status === "accept");
        const isTerminal = ["deny", "failure", "expire", "cancel"].includes(input.transaction_status);
        if (isPaid || isTerminal) {
          await PublicCheckoutService.notification(input);
          catalogChanged = true;
        } else if (input.transaction_status === "pending") {
          const expireResponse = await fetch(`${baseUrl}/v2/${encodeURIComponent(order.id)}/expire`, {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Basic ${Buffer.from(`${payment.serverKey}:`).toString("base64")}`,
            },
            signal: AbortSignal.timeout(8_000),
          });
          const expireBody: unknown = await expireResponse.json().catch(() => undefined);
          const expireResult = midtransExpireSchema.safeParse(expireBody);
          if (!expireResponse.ok || !expireResult.success
            || expireResult.data.order_id !== order.id
            || Number(expireResult.data.gross_amount) !== order.totalIdr) {
            throw new Error("Midtrans transaction expiry failed");
          }
          const didRelease = await releaseStock(order.id, "EXPIRED", "expire");
          expired += Number(didRelease);
          released += Number(didRelease);
          catalogChanged ||= didRelease;
        } else {
          await OrderRepository.updatePendingPayment(order.id, {
            midtransStatus: input.transaction_status,
            midtransTransactionId: input.transaction_id,
            midtransPaymentType: input.payment_type,
          });
        }
        reconciled += 1;
      } catch (error) {
        failed += 1;
        await OrderRepository.createAudit({
          orderId: order.id,
          action: "PAYMENT_RECONCILIATION_FAILED",
          outcome: "FAILED",
          details: { message: error instanceof Error ? error.message : "Unknown reconciliation error" },
        });
      }
    }

    return { checked: orders.length, expired, released, reconciled, failed, catalogChanged };
  }
}

export const getShipmentCollectionOptions = PublicCheckoutService.getShipmentCollectionOptions;
export const requestShipmentBooking = PublicCheckoutService.requestShipmentBooking;
