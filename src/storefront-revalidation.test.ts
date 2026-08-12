import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithExecutionContext } from "./background.js";
import { config } from "./config.js";
import { revalidateStorefrontNow } from "./storefront-revalidation.js";

test("synchronous storefront revalidation waits once and retries failures in the background", async () => {
  const originalUrl = config.storefrontUrl;
  const originalSecret = config.storefrontRevalidateSecret;
  const originalFetch = globalThis.fetch;
  config.storefrontUrl = "https://storefront.example";
  config.storefrontRevalidateSecret = "test-secret";

  try {
    let release!: () => void;
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    };

    let resolved = false;
    const pending = revalidateStorefrontNow(["catalog:products", "catalog:products"]).then(() => { resolved = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);
    release();
    await pending;
    assert.equal(resolved, true);

    const background: Promise<unknown>[] = [];
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(null, { status: calls === 2 ? 503 : 204 });
    };
    await runWithExecutionContext(
      { waitUntil: (promise) => { background.push(promise); } },
      () => revalidateStorefrontNow(["catalog:products"]),
    );
    assert.equal(background.length, 1);
    await background[0];
    assert.equal(calls, 3);
  } finally {
    config.storefrontUrl = originalUrl;
    config.storefrontRevalidateSecret = originalSecret;
    globalThis.fetch = originalFetch;
  }
});
