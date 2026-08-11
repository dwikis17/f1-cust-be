import { prisma } from "../../db.js";

export type DashboardRange = {
  startAt: Date;
  endAt: Date;
  previousStartAt: Date;
  previousEndAt: Date;
};

export class DashboardRepository {
  static async summarySources(range: DashboardRange) {
    const currentRange = { gte: range.startAt, lt: range.endAt };
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
    ] = await Promise.all([
      prisma.order.findMany({
        where: { paymentStatus: "PAID", createdAt: { gte: range.previousStartAt, lt: range.endAt } },
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

    return {
      paidOrdersInComparisonWindow,
      paymentGroups,
      shipmentBookingGroups,
      variants,
      paidItems,
      recentOrders,
      readyToProcess,
      packing,
      bookingFailed,
    };
  }
}
