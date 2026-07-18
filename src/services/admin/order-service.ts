import { prisma } from "../../db.js";
import { notFound } from "../../http.js";

export class OrderService {
  static async listPaymentEvents(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        paymentEvents: {
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!order) notFound("Order not found");
    return order.paymentEvents;
  }
}
