import { scheduleBackground } from "./background.js";
import { config } from "./config.js";

const delays = [0, 250, 1_000];

async function deliver(tags: string[]) {
  if (!config.storefrontUrl || !config.storefrontRevalidateSecret) return;
  let lastError: unknown;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(`${config.storefrontUrl}/api/revalidate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.storefrontRevalidateSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tags: [...new Set(tags)] }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastError = new Error(`Storefront revalidation failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Storefront revalidation delivery failed", lastError);
}

export function revalidateStorefront(tags: string[]) {
  scheduleBackground(deliver(tags));
}
