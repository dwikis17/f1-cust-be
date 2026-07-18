import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deletePhoto,
  normalizePhotoPublicBaseUrl,
  type PhotoBucket,
  photoKey,
  photoUrl,
  readStoredPhoto,
  rewrittenPhotoUrl,
  runWithPhotoBucket,
  storedPhotoKey,
  storedPhotoUrl,
  storePhoto,
} from "./photo-storage.js";

test("R2 photo lifecycle uses the request namespace", async () => {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const bucket: PhotoBucket = {
    async put(key, value, options) {
      objects.set(key, { body: value, contentType: options.httpMetadata?.contentType ?? "" });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        arrayBuffer: async () => object.body.slice().buffer,
        httpEtag: '"test-etag"',
        httpMetadata: { contentType: object.contentType },
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };

  await runWithPhotoBucket(bucket, "development/", "https://pub-example.r2.dev", async () => {
    const key = photoKey("photo.png");
    assert.equal(key, "development/photo.png");
    assert.equal(photoUrl(key), "https://pub-example.r2.dev/development/photo.png");
    await storePhoto(key, new Uint8Array([1, 2, 3]), "image/png");
    assert.deepEqual(await readStoredPhoto(key), {
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      etag: '"test-etag"',
    });
    await deletePhoto(key);
    assert.equal(await readStoredPhoto(key), null);
  });
});

test("stored photo values support public links and legacy keys", () => {
  const developmentBaseUrl = "https://pub-example.r2.dev";
  const productionBaseUrl = "https://media.example.com";
  assert.equal(storedPhotoKey("development/photo.png"), "development/photo.png");
  assert.equal(storedPhotoKey("/uploads/development/photo.png"), "development/photo.png");
  assert.equal(
    storedPhotoKey("https://f1-store-api.dwikis17.workers.dev/uploads/production/photo.png"),
    "production/photo.png",
  );
  assert.equal(
    storedPhotoKey("https://pub-example.r2.dev/development/photo.png", developmentBaseUrl),
    "development/photo.png",
  );
  assert.equal(storedPhotoKey("https://media.formula1.com/image/upload/photo.webp", developmentBaseUrl), null);
  assert.equal(storedPhotoUrl("development/photo.png"), "/uploads/development/photo.png");
  assert.equal(storedPhotoUrl("/uploads/development/photo.png"), "/uploads/development/photo.png");
  assert.equal(
    storedPhotoUrl("https://f1-store-api.dwikis17.workers.dev/uploads/production/photo.png"),
    "https://f1-store-api.dwikis17.workers.dev/uploads/production/photo.png",
  );
  assert.equal(
    rewrittenPhotoUrl("/uploads/development/photo.png", developmentBaseUrl),
    "https://pub-example.r2.dev/development/photo.png",
  );
  assert.equal(
    rewrittenPhotoUrl(
      "https://pub-example.r2.dev/development/photo.png",
      productionBaseUrl,
      developmentBaseUrl,
    ),
    "https://media.example.com/development/photo.png",
  );
  assert.equal(
    rewrittenPhotoUrl("https://media.formula1.com/image/upload/photo.webp", productionBaseUrl, developmentBaseUrl),
    "https://media.formula1.com/image/upload/photo.webp",
  );
  assert.equal(normalizePhotoPublicBaseUrl("https://media.example.com/"), "https://media.example.com");
  assert.throws(() => normalizePhotoPublicBaseUrl("http://media.example.com"));
  assert.throws(() => normalizePhotoPublicBaseUrl("https://media.example.com/uploads"));
});
