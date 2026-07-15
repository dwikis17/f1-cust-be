import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import request from "supertest";
import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { hashPassword, hashToken } from "./security.js";

let token = "";
let productId = "";

before(async () => {
  assert.match(config.databaseUrl, /f1_store_test/, "Tests must use the test database");
  await prisma.productPhoto.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productTag.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.adminSession.deleteMany();
  await prisma.admin.deleteMany();
  const password = await hashPassword("correct-horse-battery");
  await prisma.admin.create({
    data: {
      email: "admin@example.com",
      displayName: "Test Admin",
      passwordSalt: password.salt,
      passwordHash: password.hash,
    },
  });
});

after(async () => prisma.$disconnect());

test("health and admin authentication", async () => {
  await request(app).get("/health").expect(200, { status: "ok" });
  await request(app).post("/api/admin/auth/login")
    .send({ email: "admin@example.com", password: "wrong-password" }).expect(401);
  const login = await request(app).post("/api/admin/auth/login")
    .send({ email: "admin@example.com", password: "correct-horse-battery" }).expect(200);
  token = login.body.token;
  assert.ok(token);
  await request(app).get("/api/admin/auth/me").set("authorization", `Bearer ${token}`).expect(200);
});

test("admin creates catalog data and public API hides drafts", async () => {
  const category = await request(app).post("/api/admin/categories").set("authorization", `Bearer ${token}`)
    .send({ name: "Jerseys", slug: "jerseys" }).expect(201);
  const tag = await request(app).post("/api/admin/tags").set("authorization", `Bearer ${token}`)
    .send({ name: "Ferrari", slug: "ferrari" }).expect(201);
  const product = await request(app).post("/api/admin/products").set("authorization", `Bearer ${token}`)
    .send({
      name: "Ferrari Team Jersey",
      slug: "ferrari-team-jersey",
      description: "Official red team jersey",
      priceIdr: 1_250_000,
      categoryId: category.body.id,
      tagIds: [tag.body.id],
      variants: [{
        sku: "FER-JER-RED-M",
        size: "M",
        color: "Red",
        stockQuantity: 8,
        packageLengthMm: 300,
        packageWidthMm: 220,
        packageHeightMm: 40,
        packageWeightG: 450,
        sizingGuide: { unit: "cm", measurements: { chest: 52, length: 72 } },
      }],
    }).expect(201);
  productId = product.body.id;
  const hidden = await request(app).get("/api/products?category=jerseys&tag=ferrari").expect(200);
  assert.equal(hidden.body.total, 0);
  await request(app).get("/api/products/ferrari-team-jersey").expect(404);
});

test("active products are filterable without exposing exact stock", async () => {
  await request(app).patch(`/api/admin/products/${productId}`).set("authorization", `Bearer ${token}`)
    .send({ status: "ACTIVE" }).expect(200);
  const response = await request(app).get("/api/products?search=team&size=M&color=Red").expect(200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.data[0].priceIdr, 1_250_000);
  assert.equal(response.body.data[0].variants[0].available, true);
  assert.equal(response.body.data[0].variants[0].stockQuantity, undefined);
  await request(app).post(`/api/admin/products/${productId}/variants`).set("authorization", `Bearer ${token}`)
    .send({
      sku: "INVALID", size: "L", color: "Red", stockQuantity: -1,
      packageLengthMm: 300, packageWidthMm: 220, packageHeightMm: 40, packageWeightG: 450,
      sizingGuide: { unit: "cm", measurements: { chest: 55 } },
    }).expect(400);
});

test("database uniqueness and transactional tag updates are enforced", async () => {
  const current = await request(app).get(`/api/admin/products/${productId}`)
    .set("authorization", `Bearer ${token}`).expect(200);
  await request(app).post(`/api/admin/products/${productId}/variants`).set("authorization", `Bearer ${token}`)
    .send({
      sku: "FER-JER-RED-L", size: "M", color: "Red", stockQuantity: 1,
      packageLengthMm: 300, packageWidthMm: 220, packageHeightMm: 40, packageWeightG: 450,
      sizingGuide: { unit: "cm", measurements: { chest: 52 } },
    }).expect(409);
  await request(app).patch(`/api/admin/products/${productId}`).set("authorization", `Bearer ${token}`)
    .send({ tagIds: [randomUUID()] }).expect(400);
  const afterRollback = await request(app).get(`/api/admin/products/${productId}`)
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.equal(afterRollback.body.tags.length, current.body.tags.length);
  assert.equal(afterRollback.body.tags[0].tag.slug, "ferrari");
});

test("photo uploads validate signatures and clean up files", async () => {
  await request(app).post(`/api/admin/products/${productId}/photos`).set("authorization", `Bearer ${token}`)
    .field("altText", "Not an image").attach("photo", Buffer.from("not-image"), "fake.png").expect(400);
  await request(app).post(`/api/admin/products/${productId}/photos`).set("authorization", `Bearer ${token}`)
    .field("altText", "Too large")
    .attach("photo", Buffer.alloc(config.maxUploadBytes + 1, 0xff), "large.jpg").expect(400);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const upload = await request(app).post(`/api/admin/products/${productId}/photos`).set("authorization", `Bearer ${token}`)
    .field("altText", "Red Ferrari jersey").field("color", "Red").field("position", "0")
    .attach("photo", pngHeader, "jersey.png").expect(201);
  const storedPath = path.join(config.uploadDir, upload.body.path);
  await access(storedPath);
  await request(app).delete(`/api/admin/products/${productId}/photos/${upload.body.id}`)
    .set("authorization", `Bearer ${token}`).expect(204);
  await assert.rejects(access(storedPath));
});

test("expired sessions are rejected and removed", async () => {
  const expiredToken = "expired-session-token";
  await prisma.adminSession.create({
    data: {
      adminId: (await prisma.admin.findUniqueOrThrow({ where: { email: "admin@example.com" } })).id,
      tokenHash: hashToken(expiredToken),
      expiresAt: new Date(Date.now() - 1_000),
    },
  });
  await request(app).get("/api/admin/auth/me").set("authorization", `Bearer ${expiredToken}`).expect(401);
  assert.equal(await prisma.adminSession.count({ where: { expiresAt: { lt: new Date() } } }), 0);
});

test("archiving and logout remove public and admin access", async () => {
  await request(app).patch(`/api/admin/products/${productId}`).set("authorization", `Bearer ${token}`)
    .send({ status: "ARCHIVED" }).expect(200);
  const products = await request(app).get("/api/products").expect(200);
  assert.equal(products.body.total, 0);
  await request(app).post("/api/admin/auth/logout").set("authorization", `Bearer ${token}`).expect(204);
  await request(app).get("/api/admin/auth/me").set("authorization", `Bearer ${token}`).expect(401);
});
