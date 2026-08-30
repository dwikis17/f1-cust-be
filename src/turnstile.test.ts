import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import { verifyHuman } from "./turnstile.js";

function isHttpError(status: number, code: string) {
  return (error: unknown) => error instanceof HttpError && error.status === status && error.code === code;
}

test("human verification validates the expected action and can be disabled", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = config.turnstileEnabled;
  const originalSecret = config.turnstileSecretKey;
  const originalStorefrontUrl = config.storefrontUrl;
  config.turnstileSecretKey = "turnstile-test-secret";
  config.storefrontUrl = "https://valydejersey.com";

  try {
    config.turnstileEnabled = false;
    globalThis.fetch = async () => { throw new Error("Turnstile should be disabled"); };
    await verifyHuman(undefined, "checkout");

    config.turnstileEnabled = true;
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { secret: string; response: string; remoteip?: string };
      assert.equal(request.secret, "turnstile-test-secret");
      assert.equal(request.response, "valid-token");
      assert.equal(request.remoteip, "203.0.113.10");
      assert.ok(init?.signal);
      return Response.json({ success: true, action: "checkout", hostname: "valydejersey.com" });
    };
    await verifyHuman("valid-token", "checkout", "203.0.113.10");

    globalThis.fetch = async () => Response.json({
      success: true,
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    });
    await verifyHuman("dummy-test-token", "shipping-rates");

    await assert.rejects(() => verifyHuman(undefined, "checkout"), isHttpError(403, "HUMAN_VERIFICATION_FAILED"));

    for (const body of [
      { success: false, action: "checkout", hostname: "valydejersey.com" },
      { success: true, action: "shipping-rates", hostname: "valydejersey.com" },
      { success: true, action: "checkout", hostname: "example.com" },
    ]) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(() => verifyHuman("rejected-token", "checkout"), isHttpError(403, "HUMAN_VERIFICATION_FAILED"));
    }

    globalThis.fetch = async () => new Response("not-json", { status: 502 });
    await assert.rejects(() => verifyHuman("valid-token", "checkout"), isHttpError(503, "HUMAN_VERIFICATION_UNAVAILABLE"));
    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    await assert.rejects(() => verifyHuman("valid-token", "checkout"), isHttpError(503, "HUMAN_VERIFICATION_UNAVAILABLE"));

    config.turnstileSecretKey = undefined;
    await assert.rejects(() => verifyHuman("valid-token", "checkout"), isHttpError(503, "HUMAN_VERIFICATION_UNAVAILABLE"));
  } finally {
    globalThis.fetch = originalFetch;
    config.turnstileEnabled = originalEnabled;
    config.turnstileSecretKey = originalSecret;
    config.storefrontUrl = originalStorefrontUrl;
  }
});
