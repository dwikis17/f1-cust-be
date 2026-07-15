import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export type PhotoBucket = {
  put(key: string, value: Uint8Array, options: R2PutOptions): Promise<unknown>;
  get(key: string): Promise<Pick<R2ObjectBody, "arrayBuffer" | "httpEtag" | "httpMetadata"> | null>;
  delete(key: string): Promise<void>;
};

type PhotoStorageContext = { bucket: PhotoBucket; prefix: string };
type StoredPhoto = { body: Uint8Array; contentType: string; etag: string };

const requestStorage = new AsyncLocalStorage<PhotoStorageContext>();

export function runWithPhotoBucket<T>(bucket: PhotoBucket, prefix: string, callback: () => T) {
  return requestStorage.run({ bucket, prefix }, callback);
}

export function photoKey(filename: string) {
  return `${requestStorage.getStore()?.prefix ?? ""}${filename}`;
}

export async function storePhoto(key: string, body: Uint8Array, contentType: string) {
  const storage = requestStorage.getStore();
  if (storage) {
    await storage.bucket.put(key, body, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    });
    return;
  }
  await mkdir(config.uploadDir, { recursive: true });
  await writeFile(path.join(config.uploadDir, key), body, { flag: "wx" });
}

export async function deletePhoto(key: string) {
  const storage = requestStorage.getStore();
  if (storage) {
    await storage.bucket.delete(key);
    return;
  }
  await unlink(path.join(config.uploadDir, key));
}

export async function readStoredPhoto(key: string): Promise<StoredPhoto | null> {
  const storage = requestStorage.getStore();
  if (!storage) {
    const body = await readFile(path.join(config.uploadDir, key)).catch(() => null);
    if (!body) return null;
    return { body, contentType: contentTypeForKey(key), etag: "" };
  }
  const object = await storage.bucket.get(key);
  if (!object) return null;
  // ponytail: uploads are capped at 5 MB, so buffering keeps the Express bridge simple.
  return {
    body: new Uint8Array(await object.arrayBuffer()),
    contentType: object.httpMetadata?.contentType ?? contentTypeForKey(key),
    etag: object.httpEtag,
  };
}

function contentTypeForKey(key: string) {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
