import { scheduleBackground } from "./background.js";
import { config } from "./config.js";

const retryDelays = [250, 1_000];

async function send(tags: string[], timeout: number) {
  const response = await fetch(`${config.storefrontUrl}/api/revalidate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.storefrontRevalidateSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tags: [...new Set(tags)] }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Storefront revalidation failed with ${response.status}`);
}

async function retry(tags: string[], initialError: unknown) {
  let lastError = initialError;
  for (const delay of retryDelays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await send(tags, 5_000);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Storefront revalidation delivery failed", lastError);
}

async function deliver(tags: string[], waitForFirstAttempt: boolean) {
  if (!config.storefrontUrl || !config.storefrontRevalidateSecret) return;
  try {
    await send(tags, waitForFirstAttempt ? 2_000 : 5_000);
  } catch (error) {
    scheduleBackground(retry(tags, error));
  }
}

export function revalidateStorefront(tags: string[]) {
  scheduleBackground(deliver(tags, false));
}

export function revalidateStorefrontNow(tags: string[]) {
  return deliver(tags, true);
}
