import { Buffer } from "node:buffer";
import { z } from "zod";
import { config } from "../../config.js";
import { sendPaymentConfirmationEmail, sendShipmentConfirmationEmail } from "../../email-service.js";
import { HttpError, notFound } from "../../http.js";
import { createOrderInvoice, createShippingLabel } from "../../order-invoice.js";
import {
  OrderRepository,
  type OrderAuditInput,
  type OrderListInput,
  type OrderWithItems,
} from "../../repositories/order-repository.js";
import {
  getShipmentCollectionOptions,
  requestShipmentBooking,
} from "../public/checkout-service.js";
import {
  defaultCollectionMethod,
  fromDbCollectionMethod,
  type ShipmentCollectionMethod,
} from "../../shipment-collection.js";
import { sendTelegramPaymentNotification } from "../../telegram-service.js";

export type { OrderListInput, OrderQueue } from "../../repositories/order-repository.js";

const trackingSchema = z.object({
  success: z.literal(true),
  waybill_id: z.string(),
  status: z.string(),
  link: z.string().url().nullish(),
  history: z.array(z.object({
    note: z.string(),
    updated_at: z.string(),
    status: z.string(),
  }).passthrough()),
}).passthrough();

const cancelShipmentSchema = z.object({
  success: z.literal(true),
  status: z.string().optional(),
}).passthrough();

const BOOKING_CLAIM_MS = 10 * 60 * 1_000;

function refundState(order: { externalRefundedAt: Date | null; lifecycleStatus: string; paymentStatus: string }) {
  if (order.externalRefundedAt) return "EXTERNALLY_REFUNDED" as const;
  if (order.lifecycleStatus === "CANCELLED" && order.paymentStatus === "PAID") return "REQUIRED" as const;
  return "NONE" as const;
}

function listRow(order: {
  id: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  totalIdr: number;
  paymentStatus: string;
  lifecycleStatus: string;
  shipmentBookingStatus: string;
  externalRefundedAt: Date | null;
  courierCode: string;
  courierName: string;
  biteshipWaybillId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { items: number };
}) {
  return {
    ...order,
    customerName: `${order.firstName} ${order.lastName}`.trim(),
    itemCount: order._count.items,
    refundState: refundState(order),
    _count: undefined,
  };
}

async function audit(input: OrderAuditInput) {
  return OrderRepository.createAudit(input);
}

async function auditExistingOrder(input: OrderAuditInput & { orderId: string }) {
  const exists = await OrderRepository.exists(input.orderId);
  if (exists) await audit(input);
}

async function cancelMidtrans(orderId: string) {
  if (!config.midtransServerKey) throw new HttpError(503, "PAYMENT_NOT_CONFIGURED", "Midtrans is not configured");
  const baseUrl = config.midtransEnv === "production" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v2/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${config.midtransServerKey}:`).toString("base64")}` },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "PAYMENT_UPSTREAM_ERROR", "Midtrans cancellation is temporarily unavailable");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { status_message?: string } | undefined;
    throw new HttpError(409, "PAYMENT_CANCELLATION_FAILED", body?.status_message ?? "Midtrans did not cancel the payment");
  }
}

async function cancelBiteship(orderId: string, reason: string) {
  if (!config.biteshipApiKey) throw new HttpError(503, "SHIPPING_NOT_CONFIGURED", "Biteship is not configured");
  let response: Response;
  try {
    response = await fetch(`https://api.biteship.com/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      headers: { authorization: config.biteshipApiKey, "content-type": "application/json" },
      body: JSON.stringify({ cancellation_reason_code: "others", cancellation_reason: reason }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "SHIPMENT_UPSTREAM_ERROR", "Biteship cancellation is temporarily unavailable");
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = cancelShipmentSchema.safeParse(body);
  if (!response.ok || !parsed.success) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : "Biteship did not cancel the shipment";
    throw new HttpError(409, "SHIPMENT_CANCELLATION_FAILED", message);
  }
  return parsed.data.status ?? "cancelled";
}

export class OrderService {
  static async list(input: OrderListInput) {
    const { data, total, queueCounts } = await OrderRepository.list(input);
    return {
      data: data.map(listRow),
      page: input.page,
      limit: input.limit,
      total,
      queueCounts,
    };
  }

  static async find(id: string) {
    const order = await OrderRepository.find(id);
    if (!order) notFound("Order not found");
    const {
      idempotencyKey: _idempotencyKey,
      midtransSnapToken: _midtransSnapToken,
      paymentConfirmationEmailSendingAt: _paymentConfirmationEmailSendingAt,
      telegramNotificationSendingAt: _telegramNotificationSendingAt,
      telegramNotificationAttempts: _telegramNotificationAttempts,
      telegramNotificationLastError: _telegramNotificationLastError,
      shipmentConfirmationEmailSendingAt: _shipmentConfirmationEmailSendingAt,
      ...safeOrder
    } = order;
    return {
      ...safeOrder,
      shipmentCollectionMethod: order.shipmentCollectionMethod
        ? fromDbCollectionMethod(order.shipmentCollectionMethod)
        : null,
      shipmentAvailableCollectionMethods: order.shipmentAvailableCollectionMethods.map(fromDbCollectionMethod),
      refundState: refundState(order),
      shipmentBookingInProgress: Boolean(
        order.shipmentBookingStartedAt
          && order.shipmentBookingStartedAt.getTime() >= Date.now() - BOOKING_CLAIM_MS,
      ),
    };
  }

  static async listPaymentEvents(orderId: string) {
    const order = await OrderRepository.findPaymentEvents(orderId);
    if (!order) notFound("Order not found");
    return order.paymentEvents;
  }

  static async updateLifecycle(orderId: string, status: "PROCESSING", adminId: string) {
    try {
      const result = await OrderRepository.updateLifecycle(orderId, status, adminId);
      if (result.status === "NOT_FOUND") notFound("Order not found");
      if (result.status === "NOT_ALLOWED") {
        throw new HttpError(
          409,
          "PROCESSING_NOT_ALLOWED",
          "Only paid orders with reserved stock can start processing",
        );
      }
      return result.order;
    } catch (error) {
      await auditExistingOrder({
        orderId,
        adminId,
        action: "LIFECYCLE_UPDATE_FAILED",
        outcome: "FAILED",
        details: { target: status, message: error instanceof Error ? error.message : "Unknown lifecycle error" },
      });
      throw error;
    }
  }

  static async bookShipment(orderId: string, adminId: string, requestedCollectionMethod?: ShipmentCollectionMethod) {
    const claimedAt = new Date();
    const staleBefore = new Date(claimedAt.getTime() - BOOKING_CLAIM_MS);
    let order: OrderWithItems;
    let collectionMethod: ShipmentCollectionMethod;
    try {
      const claimed = await OrderRepository.claimShipment(orderId, claimedAt, staleBefore, requestedCollectionMethod);
      if (claimed.status === "NOT_FOUND") notFound("Order not found");
      if (claimed.status === "NOT_ALLOWED") {
        throw new HttpError(
          409,
          "SHIPMENT_BOOKING_NOT_ALLOWED",
          "Only paid processing orders with reserved stock can be booked",
        );
      }
      if (claimed.status === "IN_PROGRESS") {
        throw new HttpError(409, "SHIPMENT_BOOKING_IN_PROGRESS", "A shipment booking is already in progress");
      }
      order = claimed.order;
      collectionMethod = claimed.collectionMethod;
    } catch (error) {
      await auditExistingOrder({
        orderId,
        adminId,
        action: "SHIPMENT_BOOKING_REJECTED",
        outcome: "FAILED",
        details: { message: error instanceof Error ? error.message : "Shipment booking was rejected" },
      });
      throw error;
    }

    const result = await requestShipmentBooking(order, collectionMethod);
    const action = order.shipmentBookingStatus === "BOOKING_FAILED"
      ? "SHIPMENT_BOOKING_RETRIED"
      : "SHIPMENT_BOOKED";
    if (!result.success) {
      const recorded = await OrderRepository.recordShipmentFailure({
        orderId,
        claimedAt,
        adminId,
        action,
        code: result.code,
        message: result.message,
        availableCollectionMethods: result.availableCollectionMethods,
      });
      if (recorded.status === "CLAIM_LOST") {
        throw new HttpError(409, "SHIPMENT_BOOKING_CLAIM_LOST", "Shipment booking ownership expired");
      }
      if (result.code === "COLLECTION_METHOD_UNAVAILABLE") {
        throw new HttpError(409, result.code, result.message, {
          availableCollectionMethods: result.availableCollectionMethods ?? [],
        });
      }
      throw new HttpError(502, "SHIPMENT_BOOKING_FAILED", result.message);
    }

    const completed = await OrderRepository.completeShipmentBooking({
      orderId,
      claimedAt,
      adminId,
      action,
      result,
    });
    if (completed.status === "CLAIM_LOST") {
      throw new HttpError(409, "SHIPMENT_BOOKING_CLAIM_LOST", "Shipment booking ownership expired");
    }

    try {
      await sendShipmentConfirmationEmail(orderId);
    } catch (error) {
      await audit({
        orderId,
        adminId,
        action: "SHIPMENT_CONFIRMATION_EMAIL_FAILED",
        outcome: "FAILED",
        details: { message: error instanceof Error ? error.message : "Shipment email failed" },
      });
    }
    return OrderService.find(orderId);
  }

  static retryShipment(orderId: string, adminId: string, collectionMethod?: ShipmentCollectionMethod) {
    return OrderService.bookShipment(orderId, adminId, collectionMethod);
  }

  static async cancel(orderId: string, adminId: string, reason: string) {
    const current = await OrderRepository.findWithItems(orderId);
    if (!current) notFound("Order not found");
    if (current.lifecycleStatus === "CANCELLED") return OrderService.find(orderId);
    const bookingStaleBefore = new Date(Date.now() - BOOKING_CLAIM_MS);
    if (current.shipmentBookingStartedAt && current.shipmentBookingStartedAt >= bookingStaleBefore) {
      await audit({
        orderId,
        adminId,
        action: "ORDER_CANCELLATION_FAILED",
        outcome: "FAILED",
        reason,
        details: { message: "Shipment booking is in progress" },
      });
      throw new HttpError(409, "SHIPMENT_BOOKING_IN_PROGRESS", "Wait for shipment booking to finish before cancelling");
    }
    if (current.lifecycleStatus === "FULFILLED"
      && (current.shipmentBookingStatus !== "BOOKED" || !current.biteshipOrderId)) {
      await audit({
        orderId,
        adminId,
        action: "ORDER_CANCELLATION_FAILED",
        outcome: "FAILED",
        reason,
        details: { message: "Fulfilled order has no cancellable Biteship booking" },
      });
      throw new HttpError(409, "ORDER_ALREADY_FULFILLED", "This fulfilled order cannot be cancelled");
    }

    try {
      if (current.paymentStatus === "PENDING") await cancelMidtrans(current.id);
      let biteshipStatus: string | undefined;
      if (current.shipmentBookingStatus === "BOOKED" && current.biteshipOrderId) {
        biteshipStatus = await cancelBiteship(current.biteshipOrderId, reason);
      }
      const cancelled = await OrderRepository.cancelOrder({
        orderId,
        adminId,
        reason,
        bookingStaleBefore,
        biteshipStatus,
      });
      if (cancelled.status === "NOT_FOUND") notFound("Order not found");
      if (cancelled.status === "BOOKING_IN_PROGRESS") {
        throw new HttpError(409, "SHIPMENT_BOOKING_IN_PROGRESS", "Shipment booking is in progress");
      }
      if (cancelled.status === "FULFILLED_NOT_CONFIRMED") {
        throw new HttpError(409, "ORDER_ALREADY_FULFILLED", "Biteship cancellation was not confirmed");
      }
    } catch (error) {
      await audit({
        orderId,
        adminId,
        action: "ORDER_CANCELLATION_FAILED",
        outcome: "FAILED",
        reason,
        details: { message: error instanceof Error ? error.message : "Unknown cancellation error" },
      });
      throw error;
    }
    return OrderService.find(orderId);
  }

  static async markExternalRefund(orderId: string, adminId: string, reason: string) {
    const current = await OrderRepository.find(orderId);
    if (!current) notFound("Order not found");
    if (current.paymentStatus !== "PAID" && current.paymentStatus !== "REFUNDED") {
      await audit({
        orderId,
        adminId,
        action: "EXTERNAL_REFUND_FAILED",
        outcome: "FAILED",
        reason,
        details: { paymentStatus: current.paymentStatus },
      });
      throw new HttpError(409, "REFUND_NOT_ALLOWED", "Only paid orders can be marked refunded");
    }
    if (current.externalRefundedAt) return OrderService.find(orderId);
    if (current.lifecycleStatus !== "FULFILLED" && current.lifecycleStatus !== "CANCELLED") {
      await OrderService.cancel(orderId, adminId, reason);
    }
    await OrderRepository.recordExternalRefund(orderId, adminId, reason);
    return OrderService.find(orderId);
  }

  static async resendConfirmation(orderId: string, adminId: string) {
    try {
      const sent = await sendPaymentConfirmationEmail(orderId, { force: true });
      if (!sent) throw new HttpError(409, "EMAIL_RESEND_NOT_ALLOWED", "Only active paid orders can receive this email");
      await audit({ orderId, adminId, action: "CONFIRMATION_EMAIL_RESENT", outcome: "SUCCEEDED" });
      return { sent: true };
    } catch (error) {
      await audit({
        orderId,
        adminId,
        action: "CONFIRMATION_EMAIL_RESEND_FAILED",
        outcome: "FAILED",
        details: { message: error instanceof Error ? error.message : "Unknown email error" },
      });
      throw error;
    }
  }

  static async resendTelegramNotification(orderId: string, adminId: string) {
    try {
      const order = await OrderRepository.findTelegramNotificationState(orderId);
      if (!order) notFound("Order not found");
      if (!order.telegramNotificationQueuedAt || order.telegramNotificationSentAt || !order.telegramNotificationFailedAt) {
        throw new HttpError(409, "TELEGRAM_RESEND_NOT_ALLOWED", "Only failed Telegram notifications can be resent");
      }
      const sent = await sendTelegramPaymentNotification(orderId, { force: true });
      if (!sent) throw new HttpError(502, "TELEGRAM_DELIVERY_FAILED", "Telegram notification could not be sent");
      await audit({ orderId, adminId, action: "TELEGRAM_NOTIFICATION_RESENT", outcome: "SUCCEEDED" });
      return { sent: true };
    } catch (error) {
      await audit({
        orderId,
        adminId,
        action: "TELEGRAM_NOTIFICATION_RESEND_FAILED",
        outcome: "FAILED",
        details: { message: error instanceof Error ? error.message : "Unknown Telegram error" },
      });
      throw error;
    }
  }

  static async resendShipmentConfirmation(orderId: string, adminId: string) {
    try {
      const sent = await sendShipmentConfirmationEmail(orderId, { force: true });
      if (!sent) {
        throw new HttpError(409, "SHIPMENT_EMAIL_RESEND_NOT_ALLOWED", "Only active booked orders can receive this email");
      }
      await audit({ orderId, adminId, action: "SHIPMENT_CONFIRMATION_EMAIL_RESENT", outcome: "SUCCEEDED" });
      return { sent: true };
    } catch (error) {
      await audit({
        orderId,
        adminId,
        action: "SHIPMENT_CONFIRMATION_EMAIL_RESEND_FAILED",
        outcome: "FAILED",
        details: { message: error instanceof Error ? error.message : "Unknown email error" },
      });
      throw error;
    }
  }

  static async shipmentOptions(orderId: string) {
    const order = await OrderRepository.findWithItems(orderId);
    if (!order) notFound("Order not found");

    let availableCollectionMethods = order.shipmentAvailableCollectionMethods.map(fromDbCollectionMethod);
    if (availableCollectionMethods.length === 0) {
      const quote = await getShipmentCollectionOptions(order);
      availableCollectionMethods = quote.availableCollectionMethods;
      await OrderRepository.updateShipmentCollectionMethods(orderId, availableCollectionMethods);
    }
    const storedCollectionMethod = order.shipmentCollectionMethod
      ? fromDbCollectionMethod(order.shipmentCollectionMethod)
      : null;
    return {
      collectionMethod: storedCollectionMethod && availableCollectionMethods.includes(storedCollectionMethod)
        ? storedCollectionMethod
        : defaultCollectionMethod(availableCollectionMethods),
      availableCollectionMethods,
    };
  }

  static async shipment(orderId: string) {
    const order = await OrderRepository.find(orderId);
    if (!order) notFound("Order not found");
    const stored = {
      bookingStatus: order.shipmentBookingStatus,
      providerOrderId: order.biteshipOrderId,
      trackingId: order.biteshipTrackingId,
      waybillId: order.biteshipWaybillId,
      providerStatus: order.biteshipStatus,
      priceIdr: order.biteshipPriceIdr,
      insuranceValueIdr: order.insuranceValueIdr,
      insuranceFeeIdr: order.insuranceFeeIdr,
      collectionMethod: order.shipmentCollectionMethod
        ? fromDbCollectionMethod(order.shipmentCollectionMethod)
        : null,
      availableCollectionMethods: order.shipmentAvailableCollectionMethods.map(fromDbCollectionMethod),
      courier: {
        code: order.courierCode,
        name: order.courierName,
        serviceCode: order.courierServiceCode,
        serviceName: order.courierServiceName,
        duration: order.courierDuration,
      },
    };
    if (order.shipmentBookingStatus !== "BOOKED" || !order.biteshipTrackingId) {
      return { ...stored, tracking: null, refreshedAt: new Date() };
    }
    if (!config.biteshipApiKey) throw new HttpError(503, "TRACKING_UNAVAILABLE", "Biteship is not configured");
    let response: Response;
    try {
      response = await fetch(`https://api.biteship.com/v1/trackings/${encodeURIComponent(order.biteshipTrackingId)}`, {
        headers: { authorization: config.biteshipApiKey },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpError(502, "TRACKING_UPSTREAM_ERROR", "Shipment tracking is temporarily unavailable");
    }
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = trackingSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      throw new HttpError(502, "TRACKING_UPSTREAM_ERROR", "Biteship returned an unexpected response");
    }
    await OrderRepository.updateBiteshipStatus(orderId, parsed.data.status);
    return {
      ...stored,
      providerStatus: parsed.data.status,
      tracking: {
        waybillId: parsed.data.waybill_id,
        status: parsed.data.status,
        link: parsed.data.link ?? null,
        history: parsed.data.history
          .map((event) => ({ status: event.status, note: event.note, updatedAt: event.updated_at }))
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
      },
      refreshedAt: new Date(),
    };
  }

  static async applyBiteshipStatus(input: {
    providerOrderId: string;
    status: string;
    trackingId?: string | null;
    waybillId?: string | null;
  }) {
    const updated = await OrderRepository.updateBiteshipStatusByProviderOrder(input);
    return updated.count > 0;
  }

  static async invoice(orderId: string, adminId: string) {
    const order = await OrderRepository.findWithItems(orderId);
    if (!order) notFound("Order not found");
    const bytes = await createOrderInvoice(order);
    await audit({ orderId, adminId, action: "INVOICE_DOWNLOADED", outcome: "SUCCEEDED" });
    return { bytes, filename: `invoice-${order.orderNumber}.pdf` };
  }

  static async shippingLabel(orderId: string, adminId: string) {
    const order = await OrderRepository.findWithItems(orderId);
    if (!order) notFound("Order not found");
    if (order.shipmentBookingStatus !== "BOOKED" || order.lifecycleStatus !== "FULFILLED" || !order.biteshipWaybillId) {
      throw new HttpError(409, "SHIPPING_LABEL_NOT_AVAILABLE", "A booked shipment with an airway bill is required");
    }
    const bytes = await createShippingLabel({ ...order, biteshipWaybillId: order.biteshipWaybillId });
    await audit({ orderId, adminId, action: "SHIPPING_LABEL_DOWNLOADED", outcome: "SUCCEEDED" });
    return { bytes, filename: `shipping-label-${order.orderNumber}.pdf` };
  }

  static async exportCsv(input: OrderListInput, adminId: string) {
    const orders = await OrderRepository.listExportOrders(input);
    const fields = (value: unknown) => {
      const raw = String(value ?? "").replaceAll("\r", " ").replaceAll("\n", " ");
      const safe = /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const header = [
      "order_number", "created_at", "customer_name", "email", "phone", "shipping_original_idr",
      "shipping_discount_idr", "shipping_idr", "total_idr", "payment_status",
      "lifecycle_status", "shipment_booking_status", "refund_state", "courier", "waybill", "item_count", "sku_summary",
    ];
    const rows = orders.map((order) => [
      order.orderNumber,
      order.createdAt.toISOString(),
      `${order.firstName} ${order.lastName}`.trim(),
      order.email,
      order.phone,
      order.shippingOriginalIdr,
      order.shippingDiscountIdr,
      order.shippingIdr,
      order.totalIdr,
      order.paymentStatus,
      order.lifecycleStatus,
      order.shipmentBookingStatus,
      refundState(order),
      `${order.courierName} ${order.courierServiceName}`,
      order.biteshipWaybillId ?? "",
      order.items.reduce((total, item) => total + item.quantity, 0),
      order.items.map((item) => `${item.sku} x${item.quantity}`).join("; "),
    ]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(fields).join(",")).join("\r\n")}\r\n`;
    await audit({
      adminId,
      action: "ORDERS_EXPORTED",
      outcome: "SUCCEEDED",
      details: { rowCount: orders.length, filters: input },
    });
    return { csv, filename: `orders-${new Date().toISOString().slice(0, 10)}.csv` };
  }
}
