import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { HttpError, parse } from "../../http.js";
import { AuthService } from "../../services/admin/auth-service.js";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
}).strict();

export class AuthController {
  static async login(request: Request, response: Response, next: NextFunction) {
    try {
      response.json(await AuthService.login(parse(loginSchema, request.body), request.ip ?? "unknown"));
    } catch (error) {
      next(error);
    }
  }

  static async requireAdmin(request: Request, response: Response, next: NextFunction) {
    try {
      const authorization = request.header("authorization");
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!token) {
        next(new HttpError(401, "UNAUTHORIZED", "A bearer token is required"));
        return;
      }
      const session = await AuthService.authenticate(token);
      response.locals.admin = session.admin;
      response.locals.sessionId = session.sessionId;
      next();
    } catch (error) {
      next(error);
    }
  }

  static async logout(_request: Request, response: Response, next: NextFunction) {
    try {
      await AuthService.logout(response.locals.sessionId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  static me(_request: Request, response: Response, next: NextFunction) {
    try {
      response.json(response.locals.admin);
    } catch (error) {
      next(error);
    }
  }
}
