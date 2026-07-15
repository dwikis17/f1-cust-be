import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { HttpError } from "./http.js";
import { hashToken } from "./security.js";

export async function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    next(new HttpError(401, "UNAUTHORIZED", "A bearer token is required"));
    return;
  }

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { admin: true },
  });
  if (!session || !session.admin.active || session.expiresAt <= new Date()) {
    if (session) await prisma.adminSession.delete({ where: { id: session.id } });
    next(new HttpError(401, "UNAUTHORIZED", "Session is invalid or expired"));
    return;
  }

  response.locals.admin = { id: session.admin.id, email: session.admin.email, displayName: session.admin.displayName };
  response.locals.sessionId = session.id;
  next();
}
