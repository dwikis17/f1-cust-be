import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { CourierService } from "../../services/admin/courier-service.js";

const courierCodeSchema = z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9_]+$/);
const courierUpdateSchema = z.object({ active: z.boolean() }).strict();

export class CourierController {
  static async list(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await CourierService.list());
    } catch (error) {
      next(error);
    }
  }

  static async update(request: Request, response: Response, next: NextFunction) {
    try {
      const code = parse(courierCodeSchema, request.params.code);
      const { active } = parse(courierUpdateSchema, request.body);
      response.json(await CourierService.setActive(code, active));
    } catch (error) {
      next(error);
    }
  }
}
