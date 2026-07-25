import { z } from "zod";
import { config } from "./config.js";
import { HttpError } from "./http.js";

const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
}).passthrough();

export async function verifyCheckoutHuman(token: string | undefined, remoteIp?: string) {
  if (!token) throw new HttpError(403, "HUMAN_VERIFICATION_FAILED", "Human verification failed");
  if (!config.turnstileSecretKey || !config.storefrontUrl) {
    throw new HttpError(503, "HUMAN_VERIFICATION_UNAVAILABLE", "Human verification is temporarily unavailable");
  }

  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: config.turnstileSecretKey,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new HttpError(503, "HUMAN_VERIFICATION_UNAVAILABLE", "Human verification is temporarily unavailable");
  }

  const body: unknown = await response.json().catch(() => undefined);
  const result = siteverifyResponseSchema.safeParse(body);
  if (!response.ok || !result.success) {
    throw new HttpError(503, "HUMAN_VERIFICATION_UNAVAILABLE", "Human verification is temporarily unavailable");
  }

  const expectedHostname = new URL(config.storefrontUrl).hostname;
  if (!result.data.success || result.data.action !== "checkout" || result.data.hostname !== expectedHostname) {
    throw new HttpError(403, "HUMAN_VERIFICATION_FAILED", "Human verification failed");
  }
}
