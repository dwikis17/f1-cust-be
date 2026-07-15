import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deletePhoto,
  type PhotoBucket,
  photoKey,
  readStoredPhoto,
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

  await runWithPhotoBucket(bucket, "development/", async () => {
    const key = photoKey("photo.png");
    assert.equal(key, "development/photo.png");
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

test("stored product photo values support links and legacy keys", () => {
  assert.equal(storedPhotoKey("development/photo.png"), "development/photo.png");
  assert.equal(storedPhotoKey("/uploads/development/photo.png"), "development/photo.png");
  assert.equal(
    storedPhotoKey("https://f1-store-api.dwikis17.workers.dev/uploads/production/photo.png"),
    "production/photo.png",
  );
  assert.equal(storedPhotoUrl("development/photo.png"), "/uploads/development/photo.png");
  assert.equal(storedPhotoUrl("/uploads/development/photo.png"), "/uploads/development/photo.png");
  assert.equal(
    storedPhotoUrl("https://f1-store-api.dwikis17.workers.dev/uploads/production/photo.png"),
    "https://f1-store-api.dwikis17.workers.dev/uploads/production/photo.png",
  );
});
