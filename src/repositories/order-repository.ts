import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db.js";
import { effectivePriceIdr } from "../product-price.js";
import { ProductRepository } from "./admin/product-repository.js";
import {
  defaultCollectionMethod,
  fromDbCollectionMethod,
  toDbCollectionMethod,
  type ShipmentCollectionMethod,
} from "../shipment-collection.js";

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

export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
export type CheckoutOrder = Prisma.OrderGetPayload<{ include: { items: true; promoCode: true } }>;

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
  quotedShippingIdr: number;
  includeInsurance?: boolean;
  promoCode?: string;
};

export type PaymentTransaction = {
  midtransStatus: string;
  midtransTransactionId?: string;
  midtransPaymentType?: string;
};

export type CheckoutDiscountCalculator = (
  subtotalIdr: number,
  promoCode: { discountPercentage: number; maxDiscountIdr: number | null },
) => number;

class CheckoutTransactionOutcome extends Error {
  constructor(public status: "CART_CHANGED" | "PROMO_CODE_UNAVAILABLE") {
    super(status);
  }
}

export type OrderAuditInput = {
  orderId?: string;
  adminId?: string;
  action: string;
  outcome: "SUCCEEDED" | "FAILED";
  reason?: string;
  details?: unknown;
};

export type ShipmentBookingSuccess = {
  providerOrderId: string;
  trackingId: string | null;
  waybillId: string | null;
  priceIdr: number | null;
  insuranceValueIdr: number;
  insuranceFeeIdr: number;
  providerStatus: string;
  collectionMethod: ShipmentCollectionMethod;
  availableCollectionMethods: ShipmentCollectionMethod[];
};

const queueWhere: Record<OrderQueue, Prisma.OrderWhereInput> = {
  READY_TO_PROCESS: { paymentStatus: "PAID", lifecycleStatus: "UNFULFILLED" },
  PACKING: { paymentStatus: "PAID", lifecycleStatus: "PROCESSING", shipmentBookingStatus: "UNFULFILLED" },
  BOOKING_FAILED: { paymentStatus: "PAID", lifecycleStatus: "PROCESSING", shipmentBookingStatus: "BOOKING_FAILED" },
};

function orderWhere(input: Omit<OrderListInput, "page" | "limit" | "sort">): Prisma.OrderWhereInput {
  const search = input.search?.trim();
  const where: Prisma.OrderWhereInput = {
    ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    ...(input.lifecycleStatus ? { lifecycleStatus: input.lifecycleStatus } : {}),
    ...(input.shipmentBookingStatus ? { shipmentBookingStatus: input.shipmentBookingStatus } : {}),
    ...(input.courier ? { courierCode: input.courier } : {}),
    ...(input.from || input.to ? {
      createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) },
    } : {}),
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

export class OrderRepository {
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
    return { data, total, queueCounts: { READY_TO_PROCESS: readyToProcess, PACKING: packing, BOOKING_FAILED: bookingFailed } };
  }

  static find(id: string) {
    return prisma.order.findUnique({
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
  }

  static findPaymentEvents(orderId: string) {
    return prisma.order.findUnique({
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
  }

  static createAudit(input: OrderAuditInput) {
    const { details, ...data } = input;
    return prisma.orderAuditEvent.create({
      data: { ...data, ...(details === undefined ? {} : { details: details as Prisma.InputJsonValue }) },
    });
  }

  static exists(id: string) {
    return prisma.order.count({ where: { id } });
  }

  static async updateLifecycle(orderId: string, status: "PROCESSING", adminId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) return { status: "NOT_FOUND" as const };
      const allowed = order.paymentStatus === "PAID" && order.lifecycleStatus === "UNFULFILLED"
        && !order.stockReleasedAt && order.shipmentBookingStatus !== "BOOKED";
      if (!allowed) return { status: "NOT_ALLOWED" as const };
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
      return { status: "UPDATED" as const, order: updated };
    });
  }

  static async claimShipment(
    orderId: string,
    claimedAt: Date,
    staleBefore: Date,
    requestedCollectionMethod?: ShipmentCollectionMethod,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!current) return { status: "NOT_FOUND" as const };
      if (current.paymentStatus !== "PAID" || current.lifecycleStatus !== "PROCESSING"
        || current.stockReleasedAt || current.shipmentBookingStatus === "BOOKED") {
        return { status: "NOT_ALLOWED" as const };
      }
      if (current.shipmentBookingStartedAt && current.shipmentBookingStartedAt >= staleBefore) {
        return { status: "IN_PROGRESS" as const };
      }
      const availableCollectionMethods = current.shipmentAvailableCollectionMethods.map(fromDbCollectionMethod);
      const collectionMethod = requestedCollectionMethod
        ?? (current.shipmentCollectionMethod
          ? fromDbCollectionMethod(current.shipmentCollectionMethod)
          : defaultCollectionMethod(availableCollectionMethods));
      await tx.order.update({
        where: { id: orderId },
        data: {
          shipmentBookingStartedAt: claimedAt,
          shipmentCollectionMethod: toDbCollectionMethod(collectionMethod),
        },
      });
      return { status: "CLAIMED" as const, order: current, collectionMethod };
    });
  }

  static async recordShipmentFailure(input: {
    orderId: string;
    claimedAt: Date;
    adminId: string;
    action: string;
    code: string;
    message: string;
    availableCollectionMethods?: ShipmentCollectionMethod[];
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId}::uuid FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: input.orderId } });
      if (!current || current.shipmentBookingStartedAt?.getTime() !== input.claimedAt.getTime()) {
        return { status: "CLAIM_LOST" as const };
      }
      await tx.order.update({
        where: { id: input.orderId },
        data: {
          shipmentBookingStartedAt: null,
          shipmentBookingStatus: "BOOKING_FAILED",
          ...(input.availableCollectionMethods
            ? { shipmentAvailableCollectionMethods: input.availableCollectionMethods.map(toDbCollectionMethod) }
            : {}),
        },
      });
      await tx.orderAuditEvent.create({
        data: {
          orderId: input.orderId,
          adminId: input.adminId,
          action: input.action,
          outcome: "FAILED",
          details: {
            code: input.code,
            message: input.message,
            availableCollectionMethods: input.availableCollectionMethods ?? [],
          },
        },
      });
      return { status: "RECORDED" as const };
    });
  }

  static async completeShipmentBooking(input: {
    orderId: string;
    claimedAt: Date;
    adminId: string;
    action: string;
    result: ShipmentBookingSuccess;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId}::uuid FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: input.orderId } });
      if (!current || current.shipmentBookingStartedAt?.getTime() !== input.claimedAt.getTime()
        || current.paymentStatus !== "PAID" || current.lifecycleStatus !== "PROCESSING") {
        return { status: "CLAIM_LOST" as const };
      }
      await tx.order.update({
        where: { id: input.orderId },
        data: {
          shipmentBookingStartedAt: null,
          shipmentBookingStatus: "BOOKED",
          shipmentCollectionMethod: toDbCollectionMethod(input.result.collectionMethod),
          shipmentAvailableCollectionMethods: input.result.availableCollectionMethods.map(toDbCollectionMethod),
          lifecycleStatus: "FULFILLED",
          biteshipOrderId: input.result.providerOrderId,
          biteshipTrackingId: input.result.trackingId,
          biteshipWaybillId: input.result.waybillId,
          biteshipPriceIdr: input.result.priceIdr,
          insuranceValueIdr: input.result.insuranceValueIdr,
          insuranceFeeIdr: input.result.insuranceFeeIdr,
          biteshipStatus: input.result.providerStatus,
        },
      });
      await tx.orderAuditEvent.create({
        data: {
          orderId: input.orderId,
          adminId: input.adminId,
          action: input.action,
          outcome: "SUCCEEDED",
          details: {
            providerOrderId: input.result.providerOrderId,
            waybillId: input.result.waybillId,
            providerStatus: input.result.providerStatus,
            collectionMethod: input.result.collectionMethod,
          },
        },
      });
      return { status: "COMPLETED" as const };
    });
  }

  static findWithItems(orderId: string) {
    return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  }

  static async cancelOrder(input: {
    orderId: string;
    adminId: string;
    reason: string;
    bookingStaleBefore: Date;
    biteshipStatus?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
      if (!order) return { status: "NOT_FOUND" as const };
      if (order.lifecycleStatus === "CANCELLED") return { status: "ALREADY_CANCELLED" as const };
      if (order.shipmentBookingStartedAt && order.shipmentBookingStartedAt >= input.bookingStaleBefore) {
        return { status: "BOOKING_IN_PROGRESS" as const };
      }
      if (order.lifecycleStatus === "FULFILLED" && !input.biteshipStatus) {
        return { status: "FULFILLED_NOT_CONFIRMED" as const };
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
        where: { id: input.orderId },
        data: {
          lifecycleStatus: "CANCELLED",
          shipmentBookingStartedAt: null,
          cancelledAt: new Date(),
          stockReleasedAt: order.stockReleasedAt ?? new Date(),
          ...(order.paymentStatus === "PENDING" ? { paymentStatus: "CANCELLED", midtransStatus: "cancel" } : {}),
          ...(input.biteshipStatus ? { biteshipStatus: input.biteshipStatus } : {}),
        },
      });
      await tx.orderAuditEvent.create({
        data: {
          orderId: input.orderId,
          adminId: input.adminId,
          action: "ORDER_CANCELLED",
          outcome: "SUCCEEDED",
          reason: input.reason,
          details: { paymentStatus: order.paymentStatus, biteshipStatus: input.biteshipStatus ?? null },
        },
      });
      return { status: "CANCELLED" as const };
    });
  }

  static async recordExternalRefund(orderId: string, adminId: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, externalRefundedAt: null },
        data: { externalRefundedAt: new Date(), externalRefundedByAdminId: adminId },
      });
      if (updated.count) {
        await tx.orderAuditEvent.create({
          data: { orderId, adminId, action: "EXTERNAL_REFUND_RECORDED", outcome: "SUCCEEDED", reason },
        });
      }
      return updated.count;
    });
  }

  static findTelegramNotificationState(orderId: string) {
    return prisma.order.findUnique({
      where: { id: orderId },
      select: {
        telegramNotificationQueuedAt: true,
        telegramNotificationSentAt: true,
        telegramNotificationFailedAt: true,
      },
    });
  }

  static updateShipmentCollectionMethods(orderId: string, methods: ShipmentCollectionMethod[]) {
    return prisma.order.update({
      where: { id: orderId },
      data: { shipmentAvailableCollectionMethods: methods.map(toDbCollectionMethod) },
    });
  }

  static updateBiteshipStatus(orderId: string, status: string) {
    return prisma.order.update({ where: { id: orderId }, data: { biteshipStatus: status } });
  }

  static updateBiteshipStatusByProviderOrder(input: {
    providerOrderId: string;
    status: string;
    trackingId?: string | null;
    waybillId?: string | null;
  }) {
    return prisma.order.updateMany({
      where: { biteshipOrderId: input.providerOrderId },
      data: {
        biteshipStatus: input.status,
        ...(input.trackingId ? { biteshipTrackingId: input.trackingId } : {}),
        ...(input.waybillId ? { biteshipWaybillId: input.waybillId } : {}),
      },
    });
  }

  static listExportOrders(input: OrderListInput) {
    return prisma.order.findMany({
      where: orderWhere(input),
      orderBy: orderBy(input.sort),
      include: { items: { select: { sku: true, quantity: true } } },
    });
  }

  static findByIdempotencyKey(idempotencyKey: string) {
    return prisma.order.findUnique({ where: { idempotencyKey }, include: { promoCode: true } });
  }

  static async createCheckoutOrder(input: CheckoutInput & {
    orderId: string;
    orderNumber: string;
    createdAt: Date;
    paymentExpiresAt: Date;
    shippingPrice: number;
    shippingOriginalPrice: number;
    shippingDiscount: number;
    insuranceValue: number;
    insuranceFee: number;
    shippingName: string;
    shippingServiceName: string;
    shippingDuration: string;
    availableCollectionMethods: ShipmentCollectionMethod[];
    calculateDiscount: CheckoutDiscountCalculator;
  }) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        const quantities = new Map<string, number>();
        for (const item of input.items) {
          quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
        }
        const variants = await tx.productVariant.findMany({
          where: { id: { in: [...quantities.keys()] } },
          select: {
            id: true,
            sku: true,
            color: true,
            size: true,
            stockQuantity: true,
            packageLengthMm: true,
            packageWidthMm: true,
            packageHeightMm: true,
            packageWeightG: true,
            product: {
              select: { name: true, priceIdr: true, salePriceIdr: true, status: true },
            },
          },
        });
        if (variants.length !== quantities.size || variants.some((variant) =>
          variant.product.status !== "ACTIVE" || variant.stockQuantity < (quantities.get(variant.id) ?? 0))) {
          throw new CheckoutTransactionOutcome("CART_CHANGED");
        }
        const promoCode = input.promoCode
          ? await tx.promoCode.findUnique({ where: { code: input.promoCode } })
          : null;
        if (input.promoCode && !promoCode?.active) {
          throw new CheckoutTransactionOutcome("PROMO_CODE_UNAVAILABLE");
        }
        for (const variant of variants) {
          const quantity = quantities.get(variant.id) ?? 0;
          const updated = await tx.productVariant.updateMany({
            where: { id: variant.id, stockQuantity: { gte: quantity } },
            data: { stockQuantity: { decrement: quantity } },
          });
          if (updated.count !== 1) throw new CheckoutTransactionOutcome("CART_CHANGED");
        }
        const subtotalIdr = variants.reduce(
          (sum, variant) => sum + effectivePriceIdr(variant.product) * (quantities.get(variant.id) ?? 0),
          0,
        );
        const discountIdr = promoCode ? input.calculateDiscount(subtotalIdr, promoCode) : 0;
        return tx.order.create({
          data: {
            id: input.orderId,
            orderNumber: input.orderNumber,
            createdAt: input.createdAt,
            paymentExpiresAt: input.paymentExpiresAt,
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
            discountIdr,
            shippingOriginalIdr: input.shippingOriginalPrice,
            shippingDiscountIdr: input.shippingDiscount,
            shippingIdr: input.shippingPrice,
            insuranceValueIdr: input.insuranceValue,
            insuranceFeeIdr: input.insuranceFee,
            totalIdr: subtotalIdr - discountIdr + input.shippingPrice,
            promoCodeId: promoCode?.id,
            courierCode: input.courierCode,
            courierName: input.shippingName,
            courierServiceCode: input.serviceCode,
            courierServiceName: input.shippingServiceName,
            courierDuration: input.shippingDuration,
            shipmentAvailableCollectionMethods: input.availableCollectionMethods.map(toDbCollectionMethod),
            items: {
              create: variants.map((variant) => ({
                variantId: variant.id,
                productName: variant.product.name,
                sku: variant.sku,
                color: variant.color,
                size: variant.size,
                unitPriceIdr: effectivePriceIdr(variant.product),
                quantity: quantities.get(variant.id) ?? 0,
                packageLengthMm: variant.packageLengthMm,
                packageWidthMm: variant.packageWidthMm,
                packageHeightMm: variant.packageHeightMm,
                packageWeightG: variant.packageWeightG,
              })),
            },
          },
          include: { items: true, promoCode: true },
        });
      });
      return { status: "CREATED" as const, order };
    } catch (error) {
      if (error instanceof CheckoutTransactionOutcome) return { status: error.status };
      throw error;
    }
  }

  static setSnapToken(orderId: string, snapToken: string) {
    return prisma.order.update({
      where: { id: orderId },
      data: { midtransSnapToken: snapToken },
      include: { promoCode: true },
    });
  }

  static findForPublic(id: string) {
    return prisma.order.findUnique({ where: { id }, include: { promoCode: true } });
  }

  static findForTracking(orderNumber: string, email: string, legacyId?: string) {
    return prisma.order.findFirst({
      where: {
        ...(legacyId ? { id: legacyId } : { orderNumber }),
        email: { equals: email, mode: "insensitive" },
      },
      include: { items: true, promoCode: { select: { code: true } } },
    });
  }

  static findOrderTotal(id: string) {
    return prisma.order.findUnique({ where: { id }, select: { totalIdr: true } });
  }

  static createPaymentEvent(input: {
    orderId: string;
    statusCode: string;
    grossAmount: string;
    transactionStatus: string;
    transactionId?: string;
    fraudStatus?: string;
    paymentType?: string;
    payload: unknown;
  }) {
    return prisma.midtransPaymentEvent.create({
      data: {
        orderId: input.orderId,
        statusCode: input.statusCode,
        grossAmount: input.grossAmount,
        transactionStatus: input.transactionStatus,
        transactionId: input.transactionId,
        fraudStatus: input.fraudStatus,
        paymentType: input.paymentType,
        payload: input.payload as Prisma.InputJsonObject,
      },
    });
  }

  static rejectPaymentEvent(id: string) {
    return prisma.midtransPaymentEvent.update({
      where: { id },
      data: { processingResult: "REJECTED", processingError: "PAYMENT_AMOUNT_MISMATCH", processedAt: new Date() },
    });
  }

  static async processPaymentEvent(input: {
    orderId: string;
    eventId: string;
    transaction: PaymentTransaction;
    paid: boolean;
    terminal?: "FAILED" | "EXPIRED" | "CANCELLED";
    transactionStatus: string;
    telegramPaidFields: (order: { paymentStatus: string; telegramNotificationQueuedAt: Date | null }) => Record<string, unknown>;
  }) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id" = ${input.orderId}::uuid FOR UPDATE
      `;
      if (!locked.length) return { status: "NOT_FOUND" as const };
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { items: { include: { variant: { select: { productId: true } } } } },
      });
      if (!order) return { status: "NOT_FOUND" as const };
      const updateData = (data: Record<string, unknown>) => data as Prisma.OrderUpdateInput;
      const productIds = [...new Set(order.items.flatMap(({ variant }) => variant?.productId ? [variant.productId] : []))];

      if (input.paid && order.lifecycleStatus === "CANCELLED" && order.paymentStatus !== "REFUNDED") {
        await tx.order.update({
          where: { id: order.id },
          data: updateData({ ...input.transaction, ...input.telegramPaidFields(order), paymentStatus: "PAID" }),
        });
        await tx.orderAuditEvent.create({
          data: {
            orderId: order.id,
            action: "LATE_PAYMENT_AFTER_CANCELLATION",
            outcome: "SUCCEEDED",
            details: { transactionStatus: input.transactionStatus },
          },
        });
        await tx.midtransPaymentEvent.update({
          where: { id: input.eventId },
          data: { processingResult: "PROCESSED", processedAt: new Date() },
        });
        return { status: "PROCESSED" as const, stockUnavailable: false, cancelled: true };
      }

      if (input.paid && order.paymentStatus !== "REFUNDED") {
        const redemption = order.promoCodeId && !order.promoRedeemedAt ? { promoRedeemedAt: new Date() } : {};
        if (order.stockReleasedAt) {
          const quantities = new Map<string, number>();
          for (const item of order.items) {
            if (!item.variantId) {
              await tx.order.update({
                where: { id: order.id },
                data: updateData({
                  ...input.transaction,
                  ...redemption,
                  ...input.telegramPaidFields(order),
                  paymentStatus: "PAID",
                  lifecycleStatus: "CANCELLED",
                  shipmentBookingStatus: "UNFULFILLED",
                  cancelledAt: order.cancelledAt ?? new Date(),
                }),
              });
              await tx.midtransPaymentEvent.update({
                where: { id: input.eventId },
                data: { processingResult: "PROCESSED", processedAt: new Date() },
              });
              return { status: "PROCESSED" as const, stockUnavailable: true, cancelled: true };
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
              data: updateData({
                ...input.transaction,
                ...redemption,
                ...input.telegramPaidFields(order),
                paymentStatus: "PAID",
                lifecycleStatus: "CANCELLED",
                shipmentBookingStatus: "UNFULFILLED",
                cancelledAt: order.cancelledAt ?? new Date(),
              }),
            });
            await tx.midtransPaymentEvent.update({
              where: { id: input.eventId },
              data: { processingResult: "PROCESSED", processedAt: new Date() },
            });
            return { status: "PROCESSED" as const, stockUnavailable: true, cancelled: true };
          }
          for (const [variantId, quantity] of quantities) {
            await tx.productVariant.update({
              where: { id: variantId },
              data: { stockQuantity: { decrement: quantity } },
            });
          }
          await tx.order.update({
            where: { id: order.id },
            data: updateData({
              ...input.transaction,
              ...redemption,
              ...input.telegramPaidFields(order),
              paymentStatus: "PAID",
              shipmentBookingStatus: order.shipmentBookingStatus === "BOOKED" ? "BOOKED" : "UNFULFILLED",
              stockReleasedAt: null,
            }),
          });
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: updateData({ ...input.transaction, ...redemption, ...input.telegramPaidFields(order), paymentStatus: "PAID" }),
          });
        }
        await ProductRepository.archiveSoldOutProducts(tx, productIds);
      } else if (input.terminal && order.paymentStatus === "PENDING") {
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
          data: updateData({
            ...input.transaction,
            paymentStatus: input.terminal,
            stockReleasedAt: order.stockReleasedAt ?? new Date(),
          }),
        });
      } else if ((input.transactionStatus === "refund" || input.transactionStatus === "chargeback")
        && order.paymentStatus === "PAID") {
        await tx.order.update({
          where: { id: order.id },
          data: updateData({ ...input.transaction, paymentStatus: "REFUNDED" }),
        });
      } else if (input.transactionStatus === "pending" && order.paymentStatus === "PENDING") {
        await tx.order.update({ where: { id: order.id }, data: updateData(input.transaction) });
      }

      await tx.midtransPaymentEvent.update({
        where: { id: input.eventId },
        data: { processingResult: "PROCESSED", processedAt: new Date() },
      });
      return { status: "PROCESSED" as const, stockUnavailable: false, cancelled: false };
    }, { timeout: 10_000 });
  }

  static listPendingPaymentReconciliations(now: Date, batchSize: number) {
    return prisma.order.findMany({
      where: {
        paymentStatus: "PENDING",
        midtransSnapToken: { not: null },
        paymentExpiresAt: { lte: now },
      },
      select: { id: true, totalIdr: true },
      orderBy: [{ paymentExpiresAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });
  }

  static updatePendingPayment(orderId: string, transaction: PaymentTransaction) {
    return prisma.order.updateMany({
      where: { id: orderId, paymentStatus: "PENDING" },
      data: transaction,
    });
  }

  static async releaseStock(orderId: string, paymentStatus: "FAILED" | "EXPIRED" | "CANCELLED", midtransStatus: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order || order.paymentStatus !== "PENDING" || order.stockReleasedAt) return false;
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
      return true;
    });
  }
}
