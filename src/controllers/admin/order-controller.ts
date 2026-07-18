import type { Request, Response } from "express";
import { parse } from "../../http.js";
import { idSchema } from "../../schemas.js";
import { OrderService } from "../../services/admin/order-service.js";

export class OrderController {
  static async listPaymentEvents(request: Request, response: Response) {
    response.set("cache-control", "no-store");
    response.json(await OrderService.listPaymentEvents(parse(idSchema, request.params.id)));
  }
}
