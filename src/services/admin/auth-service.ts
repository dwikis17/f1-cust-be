import { config } from "../../config.js";
import { HttpError } from "../../http.js";
import { AuthRepository } from "../../repositories/admin/auth-repository.js";
import { createSessionToken, hashToken, verifyPassword } from "../../security.js";

type LoginInput = { email: string; password: string };

export class AuthService {
  // ponytail: process-local rate limits are enough for one API instance; move to Redis before horizontal scaling.
  private static readonly loginAttempts = new Map<string, { count: number; resetAt: number }>();

  private static checkLoginRate(ip: string) {
    const now = Date.now();
    const attempt = AuthService.loginAttempts.get(ip);
    if (!attempt || attempt.resetAt <= now) {
      AuthService.loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
      return;
    }
    if (attempt.count >= 5) throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Try again later");
    attempt.count += 1;
  }

  static async login(input: LoginInput, ip: string) {
    AuthService.checkLoginRate(ip);
    const admin = await AuthRepository.findAdminByEmail(input.email.toLowerCase());
    const passwordValid = await verifyPassword(
      input.password,
      admin?.passwordSalt ?? "00000000000000000000000000000000",
      admin?.passwordHash ?? "00".repeat(64),
    );
    if (!admin || !admin.active || !passwordValid) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    AuthService.loginAttempts.delete(ip);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlMs);
    await AuthRepository.createSession(admin.id, hashToken(token), expiresAt);
    return { token, expiresAt, admin: { id: admin.id, email: admin.email, displayName: admin.displayName } };
  }

  static async authenticate(token: string) {
    const session = await AuthRepository.findSession(hashToken(token));
    if (!session || !session.admin.active || session.expiresAt <= new Date()) {
      if (session) await AuthRepository.deleteSession(session.id);
      throw new HttpError(401, "UNAUTHORIZED", "Session is invalid or expired");
    }
    return {
      admin: { id: session.admin.id, email: session.admin.email, displayName: session.admin.displayName },
      sessionId: session.id,
    };
  }

  static logout(sessionId: string) {
    return AuthRepository.deleteSession(sessionId);
  }
}
