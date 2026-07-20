import { Buffer } from "node:buffer";
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { idSchema } from "../../schemas.js";
import { OrderService, type OrderListInput } from "../../services/admin/order-service.js";

const paymentStatus = z.enum(["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELLED", "REFUNDED"]);
const lifecycleStatus = z.enum(["UNFULFILLED", "PROCESSING", "FULFILLED", "CANCELLED"]);
const shipmentBookingStatus = z.enum(["UNFULFILLED", "BOOKED", "BOOKING_FAILED"]);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  paymentStatus: paymentStatus.optional(),
  lifecycleStatus: lifecycleStatus.optional(),
  shipmentBookingStatus: shipmentBookingStatus.optional(),
  queue: z.enum(["READY_TO_PROCESS", "PACKING", "BOOKING_FAILED"]).optional(),
  refundState: z.enum(["NONE", "REQUIRED", "EXTERNALLY_REFUNDED"]).optional(),
  courier: z.string().trim().min(1).max(50).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  sort: z.enum(["createdAt_desc", "createdAt_asc", "total_desc", "total_asc"]).default("createdAt_desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const lifecycleBodySchema = z.object({ status: z.literal("PROCESSING") }).strict();
const reasonBodySchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

function jakartaDate(value: string, endExclusive = false) {
  const date = new Date(`${value}T00:00:00+07:00`);
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function listInput(request: Request): OrderListInput {
  const query = parse(listQuerySchema, request.query);
  const { from, to, ...rest } = query;
  return {
    ...rest,
    ...(from ? { from: jakartaDate(from) } : {}),
    ...(to ? { to: jakartaDate(to, true) } : {}),
  };
}

function orderId(request: Request) {
  return parse(idSchema, request.params.id);
}

function adminId(response: Response) {
  return response.locals.admin.id as string;
}

export class OrderController {
  static async list(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await OrderService.list(listInput(request)));
  }

  static async find(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await OrderService.find(orderId(request)));
  }

  static async listPaymentEvents(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await OrderService.listPaymentEvents(orderId(request)));
  }

  static async updateLifecycle(request: Request, response: Response) {
    const { status } = parse(lifecycleBodySchema, request.body);
    response.json(await OrderService.updateLifecycle(orderId(request), status, adminId(response)));
  }

  static async retryShipment(request: Request, response: Response) {
    response.json(await OrderService.retryShipment(orderId(request), adminId(response)));
  }

  static async bookShipment(request: Request, response: Response) {
    response.json(await OrderService.bookShipment(orderId(request), adminId(response)));
  }

  static async cancel(request: Request, response: Response) {
    const { reason } = parse(reasonBodySchema, request.body);
    response.json(await OrderService.cancel(orderId(request), adminId(response), reason));
  }

  static async markExternalRefund(request: Request, response: Response) {
    const { reason } = parse(reasonBodySchema, request.body);
    response.json(await OrderService.markExternalRefund(orderId(request), adminId(response), reason));
  }

  static async resendConfirmation(request: Request, response: Response) {
    response.json(await OrderService.resendConfirmation(orderId(request), adminId(response)));
  }

  static async resendShipmentConfirmation(request: Request, response: Response) {
    response.json(await OrderService.resendShipmentConfirmation(orderId(request), adminId(response)));
  }

  static async shipment(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await OrderService.shipment(orderId(request)));
  }

  static async invoice(request: Request, response: Response) {
    const invoice = await OrderService.invoice(orderId(request), adminId(response));
    response.set({
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${invoice.filename}"`,
      "content-type": "application/pdf",
    });
    response.send(Buffer.from(invoice.bytes));
  }

  static async exportCsv(request: Request, response: Response) {
    const exported = await OrderService.exportCsv(listInput(request), adminId(response));
    response.set({
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${exported.filename}"`,
      "content-type": "text/csv; charset=utf-8",
    });
    response.send(exported.csv);
  }
}
