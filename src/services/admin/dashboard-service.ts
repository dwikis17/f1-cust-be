import type { z } from "zod";
import { prisma } from "../../db.js";
import type { dashboardPeriodSchema } from "../../schemas.js";

type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
type PaidOrder = { createdAt: Date; email: string; totalIdr: number };

const JAKARTA_TIME_ZONE = "Asia/Jakarta";
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const LOW_STOCK_THRESHOLD = 5;
const PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELLED", "REFUNDED"] as const;
const SHIPMENT_BOOKING_STATUSES = ["UNFULFILLED", "BOOKED", "BOOKING_FAILED"] as const;
const PERIOD_DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

function jakartaDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: JAKARTA_TIME_ZONE,
    year: "numeric",
  }).format(date);
}

function startOfJakartaDay(date: Date) {
  const jakarta = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  return new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate()) - JAKARTA_OFFSET_MS);
}

function getPeriodRange(period: DashboardPeriod, now: Date) {
  const days = PERIOD_DAYS[period];
  const startAt = new Date(startOfJakartaDay(now).getTime() - (days - 1) * DAY_MS);
  const endAt = now;
  const durationMs = endAt.getTime() - startAt.getTime();
  const previousEndAt = startAt;
  const previousStartAt = new Date(previousEndAt.getTime() - durationMs);
  return { days, startAt, endAt, previousStartAt, previousEndAt };
}

function summarizePaidOrders(orders: PaidOrder[]) {
  const revenueIdr = orders.reduce((total, order) => total + order.totalIdr, 0);
  return {
    revenueIdr,
    paidOrders: orders.length,
    uniqueBuyers: new Set(orders.map((order) => order.email.trim().toLowerCase())).size,
    averageOrderValueIdr: orders.length === 0 ? 0 : Math.round(revenueIdr / orders.length),
  };
}

function metric(value: number, previousValue: number) {
  return {
    value,
    previousValue,
    changePercent: previousValue === 0 ? null : Math.round(((value - previousValue) / previousValue) * 1_000) / 10,
  };
}

function buildSalesSeries(orders: PaidOrder[], startAt: Date, days: number) {
  const totals = new Map<string, { paidOrders: number; revenueIdr: number }>();
  for (const order of orders) {
    const key = jakartaDateKey(order.createdAt);
    const current = totals.get(key) ?? { paidOrders: 0, revenueIdr: 0 };
    current.paidOrders += 1;
    current.revenueIdr += order.totalIdr;
    totals.set(key, current);
  }

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(startAt.getTime() + index * DAY_MS);
    const key = jakartaDateKey(date);
    return { date: key, ...(totals.get(key) ?? { paidOrders: 0, revenueIdr: 0 }) };
  });
}

export class DashboardService {
  static async summary(period: DashboardPeriod, now = new Date()) {
    const { days, startAt, endAt, previousStartAt, previousEndAt } = getPeriodRange(period, now);
    const currentRange = { gte: startAt, lt: endAt };

    const [
      paidOrdersInComparisonWindow,
      paymentGroups,
      shipmentBookingGroups,
      variants,
      paidItems,
      recentOrders,
      readyToProcess,
      packing,
      bookingFailed,
    ] =
      await Promise.all([
        prisma.order.findMany({
          where: { paymentStatus: "PAID", createdAt: { gte: previousStartAt, lt: endAt } },
          select: { createdAt: true, email: true, totalIdr: true },
        }),
        prisma.order.groupBy({
          by: ["paymentStatus"],
          where: { createdAt: currentRange },
          _count: { _all: true },
        }),
        prisma.order.groupBy({
          by: ["shipmentBookingStatus"],
          where: { createdAt: currentRange },
          _count: { _all: true },
        }),
        prisma.productVariant.findMany({
          where: { product: { status: "ACTIVE" } },
          select: {
            id: true,
            sku: true,
            stockQuantity: true,
            product: { select: { id: true, name: true } },
          },
          orderBy: [{ stockQuantity: "asc" }, { sku: "asc" }],
        }),
        prisma.orderItem.findMany({
          where: { order: { paymentStatus: "PAID", createdAt: currentRange } },
          select: { productName: true, quantity: true, unitPriceIdr: true },
        }),
        prisma.order.findMany({
          take: 10,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            orderNumber: true,
            firstName: true,
            lastName: true,
            email: true,
            totalIdr: true,
            paymentStatus: true,
            shipmentBookingStatus: true,
            lifecycleStatus: true,
            externalRefundedAt: true,
            createdAt: true,
            _count: { select: { items: true } },
          },
        }),
        prisma.order.count({ where: { paymentStatus: "PAID", lifecycleStatus: "UNFULFILLED" } }),
        prisma.order.count({
          where: { paymentStatus: "PAID", lifecycleStatus: "PROCESSING", shipmentBookingStatus: "UNFULFILLED" },
        }),
        prisma.order.count({
          where: { paymentStatus: "PAID", lifecycleStatus: "PROCESSING", shipmentBookingStatus: "BOOKING_FAILED" },
        }),
      ]);

    const currentPaidOrders = paidOrdersInComparisonWindow.filter((order) => order.createdAt >= startAt);
    const previousPaidOrders = paidOrdersInComparisonWindow.filter(
      (order) => order.createdAt >= previousStartAt && order.createdAt < previousEndAt,
    );
    const current = summarizePaidOrders(currentPaidOrders);
    const previous = summarizePaidOrders(previousPaidOrders);

    const paymentCounts = new Map(paymentGroups.map((group) => [group.paymentStatus, group._count._all]));
    const shipmentBookingCounts = new Map(
      shipmentBookingGroups.map((group) => [group.shipmentBookingStatus, group._count._all]),
    );
    const productTotals = new Map<string, { grossMerchandiseIdr: number; name: string; unitsSold: number }>();
    for (const item of paidItems) {
      const product = productTotals.get(item.productName) ?? {
        grossMerchandiseIdr: 0,
        name: item.productName,
        unitsSold: 0,
      };
      product.unitsSold += item.quantity;
      product.grossMerchandiseIdr += item.unitPriceIdr * item.quantity;
      productTotals.set(item.productName, product);
    }

    const healthyVariants = variants.filter((variant) => variant.stockQuantity > LOW_STOCK_THRESHOLD).length;
    const lowStockVariants = variants.filter(
      (variant) => variant.stockQuantity > 0 && variant.stockQuantity <= LOW_STOCK_THRESHOLD,
    ).length;
    const outOfStockVariants = variants.filter((variant) => variant.stockQuantity === 0).length;

    return {
      period: {
        value: period,
        timezone: JAKARTA_TIME_ZONE,
        startAt,
        endAt,
        previousStartAt,
        previousEndAt,
      },
      kpis: {
        paidRevenueIdr: metric(current.revenueIdr, previous.revenueIdr),
        paidOrders: metric(current.paidOrders, previous.paidOrders),
        uniqueBuyers: metric(current.uniqueBuyers, previous.uniqueBuyers),
        averageOrderValueIdr: metric(current.averageOrderValueIdr, previous.averageOrderValueIdr),
      },
      salesSeries: buildSalesSeries(currentPaidOrders, startAt, days),
      paymentStatuses: Object.fromEntries(
        PAYMENT_STATUSES.map((status) => [status, paymentCounts.get(status) ?? 0]),
      ),
      shipmentBookingStatuses: Object.fromEntries(
        SHIPMENT_BOOKING_STATUSES.map((status) => [status, shipmentBookingCounts.get(status) ?? 0]),
      ),
      orderQueues: {
        READY_TO_PROCESS: readyToProcess,
        PACKING: packing,
        BOOKING_FAILED: bookingFailed,
      },
      inventory: {
        totalUnits: variants.reduce((total, variant) => total + variant.stockQuantity, 0),
        totalVariants: variants.length,
        healthyVariants,
        lowStockVariants,
        outOfStockVariants,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        lowStockItems: variants
          .filter((variant) => variant.stockQuantity <= LOW_STOCK_THRESHOLD)
          .slice(0, 5)
          .map((variant) => ({
            productId: variant.product.id,
            productName: variant.product.name,
            variantId: variant.id,
            sku: variant.sku,
            stockQuantity: variant.stockQuantity,
          })),
      },
      topProducts: [...productTotals.values()]
        .sort((left, right) =>
          right.unitsSold - left.unitsSold || right.grossMerchandiseIdr - left.grossMerchandiseIdr ||
          left.name.localeCompare(right.name))
        .slice(0, 5),
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: `${order.firstName} ${order.lastName}`.trim(),
        email: order.email,
        totalIdr: order.totalIdr,
        itemCount: order._count.items,
        paymentStatus: order.paymentStatus,
        shipmentBookingStatus: order.shipmentBookingStatus,
        lifecycleStatus: order.lifecycleStatus,
        refundState: order.externalRefundedAt
          ? "EXTERNALLY_REFUNDED"
          : order.lifecycleStatus === "CANCELLED" && order.paymentStatus === "PAID"
            ? "REQUIRED"
            : "NONE",
        createdAt: order.createdAt,
      })),
    };
  }
}
