import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../../http.js";
import { dashboardPeriodSchema } from "../../schemas.js";
import { DashboardService } from "../../services/admin/dashboard-service.js";

const dashboardQuerySchema = z.object({
  period: dashboardPeriodSchema.default("30d"),
}).strict();

export class DashboardController {
  static async summary(request: Request, response: Response) {
    const { period } = parse(dashboardQuerySchema, request.query);
    response.set("cache-control", "no-store");
    response.json(await DashboardService.summary(period));
  }
}
