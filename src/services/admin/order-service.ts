import { Buffer } from "node:buffer";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { sendPaymentConfirmationEmail, sendShipmentConfirmationEmail } from "../../email-service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../http.js";
import { createOrderInvoice } from "../../order-invoice.js";
import { requestShipmentBooking } from "../public/checkout-service.js";

export type OrderQueue = "READY_TO_PROCESS" | "PACKING" | "BOOKING_FAILED";

export type OrderListInput = {
  search?: string;
  paymentStatus?: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "REFUNDED";
  lifecycleStatus?: "UNFULFILLED" | "PROCESSING" | "FULFILLED" | "CANCELLED";
  shipmentBookingStatus?: "UNFULFILLED" | "BOOKED" | "BOOKING_FAILED";
  queue?: OrderQueue;
  refundState?: "NONE" | "REQUIRED" | "EXTERNALLY_REFUNDED";
  courier?: string;
  from?: Date;
  to?: Date;
  sort: "createdAt_desc" | "createdAt_asc" | "total_desc" | "total_asc";
  page: number;
  limit: number;
};

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

const queueWhere: Record<OrderQueue, Prisma.OrderWhereInput> = {
  READY_TO_PROCESS: { paymentStatus: "PAID", lifecycleStatus: "UNFULFILLED" },
  PACKING: { paymentStatus: "PAID", lifecycleStatus: "PROCESSING", shipmentBookingStatus: "UNFULFILLED" },
  BOOKING_FAILED: { paymentStatus: "PAID", lifecycleStatus: "PROCESSING", shipmentBookingStatus: "BOOKING_FAILED" },
};

function refundState(order: { externalRefundedAt: Date | null; lifecycleStatus: string; paymentStatus: string }) {
  if (order.externalRefundedAt) return "EXTERNALLY_REFUNDED" as const;
  if (order.lifecycleStatus === "CANCELLED" && order.paymentStatus === "PAID") return "REQUIRED" as const;
  return "NONE" as const;
}

function orderWhere(input: Omit<OrderListInput, "page" | "limit" | "sort">): Prisma.OrderWhereInput {
  const search = input.search?.trim();
  const where: Prisma.OrderWhereInput = {
    ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    ...(input.lifecycleStatus ? { lifecycleStatus: input.lifecycleStatus } : {}),
    ...(input.shipmentBookingStatus ? { shipmentBookingStatus: input.shipmentBookingStatus } : {}),
    ...(input.courier ? { courierCode: input.courier } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) } } : {}),
    ...(search ? {
      OR: [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { biteshipTrackingId: { contains: search, mode: "insensitive" } },
        { biteshipWaybillId: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  if (input.queue) where.AND = [queueWhere[input.queue]];
  if (input.refundState === "EXTERNALLY_REFUNDED") where.externalRefundedAt = { not: null };
  if (input.refundState === "REQUIRED") {
    Object.assign(where, { lifecycleStatus: "CANCELLED", paymentStatus: "PAID", externalRefundedAt: null });
  }
  if (input.refundState === "NONE") {
    where.NOT = [
      { externalRefundedAt: { not: null } },
      { lifecycleStatus: "CANCELLED", paymentStatus: "PAID", externalRefundedAt: null },
    ];
  }
  return where;
}

function orderBy(sort: OrderListInput["sort"]): Prisma.OrderOrderByWithRelationInput[] {
  if (sort === "createdAt_asc") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "total_desc") return [{ totalIdr: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  if (sort === "total_asc") return [{ totalIdr: "asc" }, { createdAt: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
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

async function audit(input: {
  orderId?: string;
  adminId?: string;
  action: string;
  outcome: "SUCCEEDED" | "FAILED";
  reason?: string;
  details?: Prisma.InputJsonValue;
}) {
  return prisma.orderAuditEvent.create({ data: input });
}

async function auditExistingOrder(input: Parameters<typeof audit>[0] & { orderId: string }) {
  const exists = await prisma.order.count({ where: { id: input.orderId } });
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
    const where = orderWhere(input);
    const [data, total, readyToProcess, packing, bookingFailed] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: orderBy(input.sort),
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: {
          id: true,
          orderNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          totalIdr: true,
          paymentStatus: true,
          lifecycleStatus: true,
          shipmentBookingStatus: true,
          externalRefundedAt: true,
          courierCode: true,
          courierName: true,
          biteshipWaybillId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { items: true } },
        },
      }),
      prisma.order.count({ where }),
      prisma.order.count({ where: queueWhere.READY_TO_PROCESS }),
      prisma.order.count({ where: queueWhere.PACKING }),
      prisma.order.count({ where: queueWhere.BOOKING_FAILED }),
    ]);
    return {
      data: data.map(listRow),
      page: input.page,
      limit: input.limit,
      total,
      queueCounts: { READY_TO_PROCESS: readyToProcess, PACKING: packing, BOOKING_FAILED: bookingFailed },
    };
  }

  static async find(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        promoCode: { select: { code: true } },
        externalRefundedByAdmin: { select: { id: true, displayName: true, email: true } },
        paymentEvents: {
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            statusCode: true,
            grossAmount: true,
            transactionStatus: true,
            transactionId: true,
            fraudStatus: true,
            paymentType: true,
            payload: true,
            processingResult: true,
            processingError: true,
            receivedAt: true,
            processedAt: true,
          },
        },
        auditEvents: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { admin: { select: { id: true, displayName: true, email: true } } },
        },
      },
    });
    if (!order) notFound("Order not found");
    const {
      idempotencyKey: _idempotencyKey,
      midtransSnapToken: _midtransSnapToken,
      paymentConfirmationEmailSendingAt: _paymentConfirmationEmailSendingAt,
      shipmentConfirmationEmailSendingAt: _shipmentConfirmationEmailSendingAt,
      ...safeOrder
    } = order;
    return {
      ...safeOrder,
      refundState: refundState(order),
      shipmentBookingInProgress: Boolean(
        order.shipmentBookingStartedAt
          && order.shipmentBookingStartedAt.getTime() >= Date.now() - BOOKING_CLAIM_MS,
      ),
    };
  }

  static async listPaymentEvents(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        paymentEvents: {
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            statusCode: true,
            grossAmount: true,
            transactionStatus: true,
            transactionId: true,
            fraudStatus: true,
            paymentType: true,
            payload: true,
            processingResult: true,
            processingError: true,
            receivedAt: true,
            processedAt: true,
          },
        },
      },
    });
    if (!order) notFound("Order not found");
    return order.paymentEvents;
  }

  static async updateLifecycle(orderId: string, status: "PROCESSING", adminId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) notFound("Order not found");
        const allowed = order.paymentStatus === "PAID" && order.lifecycleStatus === "UNFULFILLED"
          && !order.stockReleasedAt && order.shipmentBookingStatus !== "BOOKED";
        if (!allowed) {
          throw new HttpError(
            409,
            "PROCESSING_NOT_ALLOWED",
            "Only paid orders with reserved stock can start processing",
          );
        }
        const updated = await tx.order.update({ where: { id: orderId }, data: { lifecycleStatus: status } });
        await tx.orderAuditEvent.create({
          data: {
            orderId,
            adminId,
            action: "LIFECYCLE_UPDATED",
            outcome: "SUCCEEDED",
            details: { from: order.lifecycleStatus, to: status },
          },
        });
        return updated;
      });
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

  static async bookShipment(orderId: string, adminId: string) {
    const claimedAt = new Date();
    const staleBefore = new Date(claimedAt.getTime() - BOOKING_CLAIM_MS);
    let order: Prisma.OrderGetPayload<{ include: { items: true } }>;
    try {
      order = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!current) notFound("Order not found");
        if (current.paymentStatus !== "PAID" || current.lifecycleStatus !== "PROCESSING"
          || current.stockReleasedAt || current.shipmentBookingStatus === "BOOKED") {
          throw new HttpError(
            409,
            "SHIPMENT_BOOKING_NOT_ALLOWED",
            "Only paid processing orders with reserved stock can be booked",
          );
        }
        if (current.shipmentBookingStartedAt && current.shipmentBookingStartedAt >= staleBefore) {
          throw new HttpError(409, "SHIPMENT_BOOKING_IN_PROGRESS", "A shipment booking is already in progress");
        }
        await tx.order.update({
          where: { id: orderId },
          data: { shipmentBookingStartedAt: claimedAt },
        });
        return current;
      });
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

    const result = await requestShipmentBooking(order);
    const action = order.shipmentBookingStatus === "BOOKING_FAILED"
      ? "SHIPMENT_BOOKING_RETRIED"
      : "SHIPMENT_BOOKED";
    if (!result.success) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        if (current.shipmentBookingStartedAt?.getTime() !== claimedAt.getTime()) {
          throw new HttpError(409, "SHIPMENT_BOOKING_CLAIM_LOST", "Shipment booking ownership expired");
        }
        await tx.order.update({
          where: { id: orderId },
          data: { shipmentBookingStartedAt: null, shipmentBookingStatus: "BOOKING_FAILED" },
        });
        await tx.orderAuditEvent.create({
          data: {
            orderId,
            adminId,
            action,
            outcome: "FAILED",
            details: { code: result.code, message: result.message },
          },
        });
      });
      throw new HttpError(502, "SHIPMENT_BOOKING_FAILED", result.message);
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (current.shipmentBookingStartedAt?.getTime() !== claimedAt.getTime()
        || current.paymentStatus !== "PAID" || current.lifecycleStatus !== "PROCESSING") {
        throw new HttpError(409, "SHIPMENT_BOOKING_CLAIM_LOST", "Shipment booking ownership expired");
      }
      await tx.order.update({
        where: { id: orderId },
        data: {
          shipmentBookingStartedAt: null,
          shipmentBookingStatus: "BOOKED",
          lifecycleStatus: "FULFILLED",
          biteshipOrderId: result.providerOrderId,
          biteshipTrackingId: result.trackingId,
          biteshipWaybillId: result.waybillId,
          biteshipPriceIdr: result.priceIdr,
          biteshipStatus: result.providerStatus,
        },
      });
      await tx.orderAuditEvent.create({
        data: {
          orderId,
          adminId,
          action,
          outcome: "SUCCEEDED",
          details: {
            providerOrderId: result.providerOrderId,
            waybillId: result.waybillId,
            providerStatus: result.providerStatus,
          },
        },
      });
    });

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

  static retryShipment(orderId: string, adminId: string) {
    return OrderService.bookShipment(orderId, adminId);
  }

  static async cancel(orderId: string, adminId: string, reason: string) {
    const current = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
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
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!order) notFound("Order not found");
        if (order.lifecycleStatus === "CANCELLED") return;
        if (order.shipmentBookingStartedAt && order.shipmentBookingStartedAt >= bookingStaleBefore) {
          throw new HttpError(409, "SHIPMENT_BOOKING_IN_PROGRESS", "Shipment booking is in progress");
        }
        if (order.lifecycleStatus === "FULFILLED" && !biteshipStatus) {
          throw new HttpError(409, "ORDER_ALREADY_FULFILLED", "Biteship cancellation was not confirmed");
        }
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
          where: { id: orderId },
          data: {
            lifecycleStatus: "CANCELLED",
            shipmentBookingStartedAt: null,
            cancelledAt: new Date(),
            stockReleasedAt: order.stockReleasedAt ?? new Date(),
            ...(order.paymentStatus === "PENDING" ? { paymentStatus: "CANCELLED", midtransStatus: "cancel" } : {}),
            ...(biteshipStatus ? { biteshipStatus } : {}),
          },
        });
        await tx.orderAuditEvent.create({
          data: {
            orderId,
            adminId,
            action: "ORDER_CANCELLED",
            outcome: "SUCCEEDED",
            reason,
            details: { paymentStatus: order.paymentStatus, biteshipStatus: biteshipStatus ?? null },
          },
        });
      });
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
    const current = await prisma.order.findUnique({ where: { id: orderId } });
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
    await prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, externalRefundedAt: null },
        data: { externalRefundedAt: new Date(), externalRefundedByAdminId: adminId },
      });
      if (updated.count) {
        await tx.orderAuditEvent.create({
          data: { orderId, adminId, action: "EXTERNAL_REFUND_RECORDED", outcome: "SUCCEEDED", reason },
        });
      }
    });
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

  static async shipment(orderId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) notFound("Order not found");
    const stored = {
      bookingStatus: order.shipmentBookingStatus,
      providerOrderId: order.biteshipOrderId,
      trackingId: order.biteshipTrackingId,
      waybillId: order.biteshipWaybillId,
      providerStatus: order.biteshipStatus,
      priceIdr: order.biteshipPriceIdr,
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
    await prisma.order.update({ where: { id: orderId }, data: { biteshipStatus: parsed.data.status } });
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

  static async invoice(orderId: string, adminId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) notFound("Order not found");
    const bytes = await createOrderInvoice(order);
    await audit({ orderId, adminId, action: "INVOICE_DOWNLOADED", outcome: "SUCCEEDED" });
    return { bytes, filename: `invoice-${order.orderNumber}.pdf` };
  }

  static async exportCsv(input: OrderListInput, adminId: string) {
    const orders = await prisma.order.findMany({
      where: orderWhere(input),
      orderBy: orderBy(input.sort),
      include: { items: { select: { sku: true, quantity: true } } },
    });
    const fields = (value: unknown) => {
      const raw = String(value ?? "").replaceAll("\r", " ").replaceAll("\n", " ");
      const safe = /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const header = [
      "order_number", "created_at", "customer_name", "email", "phone", "total_idr", "payment_status",
      "lifecycle_status", "shipment_booking_status", "refund_state", "courier", "waybill", "item_count", "sku_summary",
    ];
    const rows = orders.map((order) => [
      order.orderNumber,
      order.createdAt.toISOString(),
      `${order.firstName} ${order.lastName}`.trim(),
      order.email,
      order.phone,
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
      details: { rowCount: orders.length, filters: input as unknown as Prisma.InputJsonValue },
    });
    return { csv, filename: `orders-${new Date().toISOString().slice(0, 10)}.csv` };
  }
}
