import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import request from "supertest";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db-node.js";
import { storePhoto } from "./photo-storage.js";

const app = createApp();
import { hashPassword, hashToken } from "./security.js";

let token = "";
let productId = "";
let categoryId = "";
let teamId = "";
let secondTeamId = "";
let driverId = "";
let historicalDriverId = "";
let ferrariCollectionId = "";
let driverCollectionId = "";
let historicalDriverCollectionId = "";
let promoCodeId = "";

before(async () => {
  assert.match(config.databaseUrl, /f1_store_test/, "Tests must use the test database");
  await prisma.order.deleteMany();
  await prisma.promoCode.deleteMany();
  await prisma.faq.deleteMany();
  await prisma.productPhoto.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productTag.deleteMany();
  await prisma.productDriver.deleteMany();
  await prisma.productCollection.deleteMany();
  await prisma.product.deleteMany();
  await prisma.collection.deleteMany({ where: { parentId: { not: null } } });
  await prisma.collection.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.team.deleteMany();
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

test("admin dashboard aggregates real commerce data and handles empty periods", async () => {
  await request(app).get("/api/admin/dashboard").expect(401);
  await request(app).get("/api/admin/dashboard?period=365d")
    .set("authorization", `Bearer ${token}`).expect(400);

  const category = await prisma.category.create({
    data: { name: "Dashboard Products", slug: "dashboard-products" },
  });
  const activeProduct = await prisma.product.create({
    data: {
      name: "Dashboard Jersey",
      slug: "dashboard-jersey",
      priceIdr: 100_000,
      status: "ACTIVE",
      categoryId: category.id,
      variants: {
        create: [
          {
            sku: "DASH-HEALTHY",
            stockQuantity: 10,
            packageLengthMm: 100,
            packageWidthMm: 100,
            packageHeightMm: 100,
            packageWeightG: 100,
          },
          {
            sku: "DASH-LOW",
            stockQuantity: 5,
            packageLengthMm: 100,
            packageWidthMm: 100,
            packageHeightMm: 100,
            packageWeightG: 100,
          },
          {
            sku: "DASH-OUT",
            stockQuantity: 0,
            packageLengthMm: 100,
            packageWidthMm: 100,
            packageHeightMm: 100,
            packageWeightG: 100,
          },
        ],
      },
    },
  });
  await prisma.product.create({
    data: {
      name: "Dashboard Draft",
      slug: "dashboard-draft",
      priceIdr: 100_000,
      status: "DRAFT",
      categoryId: category.id,
      variants: {
        create: {
          sku: "DASH-DRAFT-OUT",
          stockQuantity: 0,
          packageLengthMm: 100,
          packageWidthMm: 100,
          packageHeightMm: 100,
          packageWeightG: 100,
        },
      },
    },
  });

  type DashboardPaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "REFUNDED";
  type DashboardFulfillmentStatus = "UNFULFILLED" | "BOOKED" | "BOOKING_FAILED";
  const dayMs = 24 * 60 * 60 * 1_000;
  const now = Date.now();
  const createOrder = (
    orderNumber: string,
    paymentStatus: DashboardPaymentStatus,
    createdAt: Date,
    totalIdr: number,
    email: string,
    fulfillmentStatus: DashboardFulfillmentStatus = "UNFULFILLED",
    item?: { quantity: number; unitPriceIdr: number },
  ) => prisma.order.create({
    data: {
      orderNumber,
      idempotencyKey: randomUUID(),
      email,
      firstName: "Dashboard",
      lastName: "Buyer",
      phone: "+628123456789",
      address: "Dashboard Street 1",
      city: "Jakarta",
      province: "DKI Jakarta",
      postalCode: "12345",
      subtotalIdr: totalIdr,
      shippingIdr: 0,
      totalIdr,
      courierCode: "jne",
      courierName: "JNE",
      courierServiceCode: "reg",
      courierServiceName: "Regular",
      courierDuration: "1 - 2 days",
      paymentStatus,
      fulfillmentStatus,
      createdAt,
      updatedAt: createdAt,
      ...(item ? {
        items: {
          create: {
            productName: activeProduct.name,
            sku: "DASH-SOLD",
            unitPriceIdr: item.unitPriceIdr,
            quantity: item.quantity,
            packageLengthMm: 100,
            packageWidthMm: 100,
            packageHeightMm: 100,
            packageWeightG: 100,
          },
        },
      } : {}),
    },
  });

  const [latestOrder] = await Promise.all([
    createOrder("DASH-PENDING", "PENDING", new Date(now - dayMs / 2), 50_000, "pending@example.com"),
    createOrder(
      "DASH-PAID-1",
      "PAID",
      new Date(now - dayMs),
      100_000,
      "Buyer@Example.com",
      "BOOKED",
      { quantity: 2, unitPriceIdr: 50_000 },
    ),
    createOrder(
      "DASH-PAID-2",
      "PAID",
      new Date(now - 2 * dayMs),
      300_000,
      "buyer@example.com",
      "BOOKING_FAILED",
      { quantity: 1, unitPriceIdr: 100_000 },
    ),
    createOrder("DASH-FAILED", "FAILED", new Date(now - 3 * dayMs), 75_000, "failed@example.com"),
    createOrder("DASH-REFUNDED", "REFUNDED", new Date(now - 4 * dayMs), 125_000, "refund@example.com"),
    createOrder("DASH-PREVIOUS", "PAID", new Date(now - 35 * dayMs), 200_000, "previous@example.com"),
  ]);

  const response = await request(app).get("/api/admin/dashboard")
    .set("authorization", `Bearer ${token}`).expect("cache-control", "no-store").expect(200);
  assert.equal(response.body.period.value, "30d");
  assert.equal(response.body.period.timezone, "Asia/Jakarta");
  assert.deepEqual(response.body.kpis.paidRevenueIdr, { value: 400_000, previousValue: 200_000, changePercent: 100 });
  assert.deepEqual(response.body.kpis.paidOrders, { value: 2, previousValue: 1, changePercent: 100 });
  assert.deepEqual(response.body.kpis.uniqueBuyers, { value: 1, previousValue: 1, changePercent: 0 });
  assert.deepEqual(response.body.kpis.averageOrderValueIdr, { value: 200_000, previousValue: 200_000, changePercent: 0 });
  assert.equal(response.body.salesSeries.length, 30);
  assert.equal(response.body.salesSeries.reduce((sum: number, item: { revenueIdr: number }) => sum + item.revenueIdr, 0), 400_000);
  assert.deepEqual(response.body.paymentStatuses, {
    PENDING: 1,
    PAID: 2,
    FAILED: 1,
    EXPIRED: 0,
    CANCELLED: 0,
    REFUNDED: 1,
  });
  assert.deepEqual(response.body.fulfillmentStatuses, { UNFULFILLED: 3, BOOKED: 1, BOOKING_FAILED: 1 });
  assert.deepEqual(
    {
      totalUnits: response.body.inventory.totalUnits,
      totalVariants: response.body.inventory.totalVariants,
      healthyVariants: response.body.inventory.healthyVariants,
      lowStockVariants: response.body.inventory.lowStockVariants,
      outOfStockVariants: response.body.inventory.outOfStockVariants,
    },
    { totalUnits: 15, totalVariants: 3, healthyVariants: 1, lowStockVariants: 1, outOfStockVariants: 1 },
  );
  assert.deepEqual(response.body.inventory.lowStockItems.map((item: { sku: string }) => item.sku), [
    "DASH-OUT",
    "DASH-LOW",
  ]);
  assert.deepEqual(response.body.topProducts[0], {
    name: "Dashboard Jersey",
    unitsSold: 3,
    grossMerchandiseIdr: 200_000,
  });
  assert.equal(response.body.recentOrders[0].id, latestOrder.id);

  await request(app).get("/api/admin/dashboard?period=7d").set("authorization", `Bearer ${token}`).expect(200);
  await request(app).get("/api/admin/dashboard?period=90d").set("authorization", `Bearer ${token}`).expect(200);

  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: "DASH-" } } });
  await prisma.product.deleteMany({ where: { categoryId: category.id } });
  await prisma.category.delete({ where: { id: category.id } });

  const empty = await request(app).get("/api/admin/dashboard?period=7d")
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.equal(empty.body.salesSeries.length, 7);
  assert.ok(empty.body.salesSeries.every((item: { paidOrders: number; revenueIdr: number }) =>
    item.paidOrders === 0 && item.revenueIdr === 0));
  assert.deepEqual(empty.body.kpis.paidRevenueIdr, { value: 0, previousValue: 0, changePercent: null });
  assert.deepEqual(empty.body.topProducts, []);
  assert.deepEqual(empty.body.recentOrders, []);
});

test("admins manage ordered bilingual FAQs and the public API exposes published localized copy", async () => {
  await request(app).get("/api/admin/faqs").expect(401);
  await request(app).post("/api/admin/faqs").set("authorization", `Bearer ${token}`)
    .send({ question: "", answer: "Missing question" }).expect(400);

  const fallback = await request(app).post("/api/admin/faqs").set("authorization", `Bearer ${token}`)
    .send({
      question: "How long does delivery take?",
      answer: "Delivery timing appears at checkout.",
      answerId: "Waktu pengiriman tampil saat checkout.",
      position: 20,
    }).expect(201);
  const hidden = await request(app).post("/api/admin/faqs").set("authorization", `Bearer ${token}`)
    .send({ question: "Hidden question", answer: "Hidden answer", position: 0, active: false }).expect(201);
  const translated = await request(app).post("/api/admin/faqs").set("authorization", `Bearer ${token}`)
    .send({
      question: "Can I return an item?",
      questionId: "Apakah produk dapat dikembalikan?",
      answer: "Unused items can be returned within 14 days.",
      answerId: "Produk yang belum digunakan dapat dikembalikan dalam 14 hari.",
      position: 10,
    }).expect(201);

  const managed = await request(app).get("/api/admin/faqs")
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.deepEqual(managed.body.map((faq: { id: string }) => faq.id), [hidden.body.id, translated.body.id, fallback.body.id]);

  const english = await request(app).get("/api/faqs").expect(200);
  assert.deepEqual(english.body.map((faq: { question: string }) => faq.question), [
    "Can I return an item?",
    "How long does delivery take?",
  ]);
  assert.equal(english.body[0].active, undefined);
  const indonesian = await request(app).get("/api/faqs?locale=id").expect(200);
  assert.equal(indonesian.body[0].question, "Apakah produk dapat dikembalikan?");
  assert.equal(indonesian.body[1].question, "How long does delivery take?");
  assert.equal(indonesian.body[1].answer, "Waktu pengiriman tampil saat checkout.");
  await request(app).get("/api/faqs?locale=fr").expect(400);

  const updated = await request(app).patch(`/api/admin/faqs/${fallback.body.id}`)
    .set("authorization", `Bearer ${token}`).send({ position: 5, active: false }).expect(200);
  assert.equal(updated.body.position, 5);
  assert.equal(updated.body.active, false);
  const afterUpdate = await request(app).get("/api/faqs").expect(200);
  assert.deepEqual(afterUpdate.body.map((faq: { id: string }) => faq.id), [translated.body.id]);

  await request(app).delete(`/api/admin/faqs/${hidden.body.id}`)
    .set("authorization", `Bearer ${token}`).expect(204);
  await request(app).patch(`/api/admin/faqs/${hidden.body.id}`)
    .set("authorization", `Bearer ${token}`).send({ active: true }).expect(404);
});

test("admin creates catalog data and public API hides drafts", async () => {
  const team = await request(app).post("/api/admin/teams").set("authorization", `Bearer ${token}`)
    .send({ name: "Ferrari", slug: "ferrari", logoUrl: "https://example.com/ferrari.webp" }).expect(201);
  teamId = team.body.id;
  const secondTeam = await request(app).post("/api/admin/teams").set("authorization", `Bearer ${token}`)
    .send({ name: "Mercedes", slug: "mercedes" }).expect(201);
  secondTeamId = secondTeam.body.id;
  const driver = await request(app).post("/api/admin/drivers").set("authorization", `Bearer ${token}`)
    .send({
      name: "Charles Leclerc",
      slug: "charles-leclerc",
      racingNumber: 16,
      photoUrl: "https://example.com/charles-leclerc.webp",
      teamId,
    }).expect(201);
  driverId = driver.body.id;
  const historicalDriver = await request(app).post("/api/admin/drivers").set("authorization", `Bearer ${token}`)
    .send({ name: "Niki Lauda", slug: "niki-lauda", racingNumber: 12, teamId: null }).expect(201);
  historicalDriverId = historicalDriver.body.id;
  const category = await request(app).post("/api/admin/categories").set("authorization", `Bearer ${token}`)
    .send({ name: "Jerseys", slug: "jerseys" }).expect(201);
  categoryId = category.body.id;
  const tag = await request(app).post("/api/admin/tags").set("authorization", `Bearer ${token}`)
    .send({ name: "Limited Edition", slug: "limited-edition" }).expect(201);
  const formulaOne = await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Formula 1", slug: "formula-1", kind: "DOMAIN", position: 0 }).expect(201);
  const drivers = await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Drivers", slug: "drivers", kind: "DOMAIN", position: 1 }).expect(201);
  const ferrariCollection = await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Ferrari", slug: "ferrari", kind: "TEAM", teamId, parentId: formulaOne.body.id }).expect(201);
  assert.equal(ferrariCollection.body.team.id, teamId);
  ferrariCollectionId = ferrariCollection.body.id;
  const driverCollection = await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Charles Leclerc", slug: "charles-leclerc", kind: "DRIVER", driverId, parentId: drivers.body.id })
    .expect(201);
  assert.equal(driverCollection.body.driver.id, driverId);
  driverCollectionId = driverCollection.body.id;
  const historicalDriverCollection = await request(app).post("/api/admin/collections")
    .set("authorization", `Bearer ${token}`)
    .send({
      name: "Niki Lauda",
      slug: "niki-lauda",
      kind: "DRIVER",
      driverId: historicalDriverId,
      parentId: drivers.body.id,
    }).expect(201);
  historicalDriverCollectionId = historicalDriverCollection.body.id;
  const crossTeamProduct = await request(app).post("/api/admin/products").set("authorization", `Bearer ${token}`)
    .send({
      name: "Historic Driver Product",
      slug: "historic-driver-product",
      priceIdr: 1,
      categoryId,
      teamId: secondTeamId,
      driverIds: [driverId, historicalDriverId],
    }).expect(201);
  assert.equal(crossTeamProduct.body.drivers.length, 2);
  const product = await request(app).post("/api/admin/products").set("authorization", `Bearer ${token}`)
    .send({
      name: "Ferrari Team Jersey",
      nameId: "Jersey Tim Ferrari",
      slug: "ferrari-team-jersey",
      description: "Official red team jersey",
      descriptionId: "Jersey tim merah resmi",
      sizingNote: "Measured flat across the garment.",
      priceIdr: 1_250_000,
      categoryId,
      teamId,
      driverIds: [driverId, historicalDriverId],
      collectionIds: [ferrariCollectionId, driverCollectionId, historicalDriverCollectionId],
      audience: "UNISEX",
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
        sizingGuide: { unit: "cm", measurements: { length: 72, chestWidth: 52, waistWidth: 50 } },
      }],
    }).expect(201);
  productId = product.body.id;
  assert.equal(product.body.nameId, "Jersey Tim Ferrari");
  assert.equal(product.body.descriptionId, "Jersey tim merah resmi");
  assert.equal(product.body.sizingNote, "Measured flat across the garment.");
  assert.equal(product.body.team.slug, "ferrari");
  assert.deepEqual(product.body.drivers.map((driver: { slug: string }) => driver.slug), ["charles-leclerc", "niki-lauda"]);
  assert.equal(product.body.collections.length, 3);
  const unassigned = await request(app).post("/api/admin/products").set("authorization", `Bearer ${token}`)
    .send({ name: "General F1 Cap", slug: "general-f1-cap", priceIdr: 300_000, categoryId }).expect(201);
  assert.equal(unassigned.body.team, null);
  assert.deepEqual(unassigned.body.drivers, []);
  const hidden = await request(app)
    .get("/api/products?productType=jerseys&tag=limited-edition&team=ferrari&driver=charles-leclerc")
    .expect(200);
  assert.equal(hidden.body.total, 0);
  await request(app).get("/api/products/ferrari-team-jersey").expect(404);
});

test("collection relations validate kind and allow multiple collections per entity", async () => {
  await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Missing Driver", slug: "missing-driver", kind: "DRIVER" }).expect(400);
  await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Unknown Driver", slug: "unknown-driver", kind: "DRIVER", driverId: randomUUID() }).expect(400);
  await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Wrong Relation", slug: "wrong-relation", kind: "TEAM", driverId }).expect(400);
  const second = await request(app).post("/api/admin/collections").set("authorization", `Bearer ${token}`)
    .send({ name: "Charles Leclerc Featured", slug: "charles-leclerc-featured", kind: "DRIVER", driverId })
    .expect(201);
  assert.equal(second.body.driver.id, driverId);
  await request(app).delete(`/api/admin/collections/${second.body.id}`).set("authorization", `Bearer ${token}`).expect(204);
});

test("admin can update and delete unreferenced teams and drivers", async () => {
  const team = await request(app).post("/api/admin/teams").set("authorization", `Bearer ${token}`)
    .send({ name: "Alpine", slug: "alpine" }).expect(201);
  const updatedTeam = await request(app).patch(`/api/admin/teams/${team.body.id}`)
    .set("authorization", `Bearer ${token}`).send({ name: "Alpine F1 Team", slug: "alpine-f1-team" }).expect(200);
  assert.equal(updatedTeam.body.slug, "alpine-f1-team");
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await request(app).post(`/api/admin/teams/${team.body.id}/logo`).set("authorization", `Bearer ${token}`)
    .attach("image", Buffer.from("not-image"), "fake.png").expect(400);
  const firstLogo = await request(app).post(`/api/admin/teams/${team.body.id}/logo`)
    .set("authorization", `Bearer ${token}`).attach("image", pngHeader, "alpine.png").expect(200);
  const firstLogoPath = path.join(config.uploadDir, firstLogo.body.logoUrl.replace("/uploads/", ""));
  await access(firstLogoPath);
  await request(app).get(firstLogo.body.logoUrl).expect("content-type", /image\/png/).expect(200);
  const replacementLogo = await request(app).post(`/api/admin/teams/${team.body.id}/logo`)
    .set("authorization", `Bearer ${token}`).attach("image", pngHeader, "alpine-new.png").expect(200);
  const replacementLogoPath = path.join(config.uploadDir, replacementLogo.body.logoUrl.replace("/uploads/", ""));
  await assert.rejects(access(firstLogoPath));
  await access(replacementLogoPath);
  const driver = await request(app).post("/api/admin/drivers").set("authorization", `Bearer ${token}`)
    .send({ name: "Pierre Gasly", slug: "pierre-gasly", racingNumber: 10, teamId: team.body.id }).expect(201);
  const updatedDriver = await request(app).patch(`/api/admin/drivers/${driver.body.id}`)
    .set("authorization", `Bearer ${token}`).send({ racingNumber: 11 }).expect(200);
  assert.equal(updatedDriver.body.racingNumber, 11);
  const photo = await request(app).post(`/api/admin/drivers/${driver.body.id}/photo`)
    .set("authorization", `Bearer ${token}`).attach("image", pngHeader, "gasly.png").expect(200);
  const photoPath = path.join(config.uploadDir, photo.body.photoUrl.replace("/uploads/", ""));
  await access(photoPath);
  await request(app).delete(`/api/admin/drivers/${driver.body.id}/photo`)
    .set("authorization", `Bearer ${token}`).expect(204);
  await assert.rejects(access(photoPath));
  await request(app).delete(`/api/admin/drivers/${driver.body.id}`).set("authorization", `Bearer ${token}`).expect(204);
  await request(app).delete(`/api/admin/teams/${team.body.id}`).set("authorization", `Bearer ${token}`).expect(204);
  await assert.rejects(access(replacementLogoPath));
});

test("public team and driver references support catalog filters", async () => {
  const teams = await request(app).get("/api/teams").expect(200);
  assert.deepEqual(teams.body.map((team: { slug: string }) => team.slug), ["ferrari", "mercedes"]);
  assert.equal(teams.body[0].logoUrl, "https://example.com/ferrari.webp");
  const ferrariDrivers = await request(app).get("/api/drivers?team=ferrari").expect(200);
  assert.equal(ferrariDrivers.body.length, 1);
  assert.equal(ferrariDrivers.body[0].slug, "charles-leclerc");
  assert.equal(ferrariDrivers.body[0].photoUrl, "https://example.com/charles-leclerc.webp");
  assert.equal(ferrariDrivers.body[0].team.slug, "ferrari");
  const mercedesDrivers = await request(app).get("/api/drivers?team=mercedes").expect(200);
  assert.equal(mercedesDrivers.body.length, 0);
});

test("active products are filterable without exposing exact stock", async () => {
  await request(app).patch(`/api/admin/products/${productId}`).set("authorization", `Bearer ${token}`)
    .send({ status: "ACTIVE", sizingNote: "  Allow a 1 cm tolerance.  " }).expect(200);
  const response = await request(app)
    .get("/api/products?search=team&size=M&color=Red&team=ferrari&driver=charles-leclerc")
    .expect(200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.data[0].priceIdr, 1_250_000);
  assert.equal(response.body.data[0].sizingNote, "Allow a 1 cm tolerance.");
  assert.equal(response.body.data[0].team.slug, "ferrari");
  assert.deepEqual(
    response.body.data[0].drivers.map((driver: { slug: string }) => driver.slug),
    ["charles-leclerc", "niki-lauda"],
  );
  assert.equal(response.body.data[0].audience, "UNISEX");
  assert.equal(response.body.data[0].variants[0].available, true);
  assert.equal(response.body.data[0].variants[0].stockQuantity, undefined);
  assert.equal(response.body.data[0].name, "Ferrari Team Jersey");
  assert.equal(response.body.data[0].nameId, undefined);
  assert.equal(response.body.data[0].descriptionId, undefined);
  const indonesian = await request(app).get("/api/products/ferrari-team-jersey?locale=id").expect(200);
  assert.equal(indonesian.body.name, "Jersey Tim Ferrari");
  assert.equal(indonesian.body.description, "Jersey tim merah resmi");
  assert.equal(indonesian.body.nameId, undefined);
  assert.equal(indonesian.body.descriptionId, undefined);
  const indonesianSearch = await request(app).get("/api/products?locale=id&search=merah").expect(200);
  assert.equal(indonesianSearch.body.total, 1);
  assert.equal(indonesianSearch.body.data[0].name, "Jersey Tim Ferrari");
  await request(app).get("/api/products?locale=fr").expect(400);
  await request(app).patch(`/api/admin/products/${productId}`).set("authorization", `Bearer ${token}`)
    .send({ descriptionId: null }).expect(200);
  const fallback = await request(app).get("/api/products/ferrari-team-jersey?locale=id").expect(200);
  assert.equal(fallback.body.name, "Jersey Tim Ferrari");
  assert.equal(fallback.body.description, "Official red team jersey");
  const wrongTeam = await request(app).get("/api/products?team=mercedes&driver=charles-leclerc").expect(200);
  assert.equal(wrongTeam.body.total, 0);
  const eitherDriver = await request(app).get("/api/products?driver=charles-leclerc,niki-lauda").expect(200);
  assert.equal(eitherDriver.body.total, 1);
  const multiFacetOr = await request(app)
    .get("/api/products?team=ferrari,mercedes&driver=charles-leclerc,niki-lauda&productType=jerseys&audience=MEN,UNISEX")
    .expect(200);
  assert.equal(multiFacetOr.body.total, 1);
  await request(app).post(`/api/admin/products/${productId}/variants`).set("authorization", `Bearer ${token}`)
    .send({
      sku: "INVALID", size: "L", color: "Red", stockQuantity: -1,
      packageLengthMm: 300, packageWidthMm: 220, packageHeightMm: 40, packageWeightG: 450,
      sizingGuide: { unit: "cm", measurements: { length: 74, chestWidth: 55, waistWidth: 53 } },
    }).expect(400);
  const invalidVariant = {
    sku: "INVALID-GUIDE",
    size: "L",
    color: "Blue",
    stockQuantity: 1,
    packageLengthMm: 300,
    packageWidthMm: 220,
    packageHeightMm: 40,
    packageWeightG: 450,
  };
  await request(app).post(`/api/admin/products/${productId}/variants`).set("authorization", `Bearer ${token}`)
    .send({
      ...invalidVariant,
      sizingGuide: { unit: "cm", measurements: { length: 74, chestWidth: 55 } },
    }).expect(400);
  await request(app).post(`/api/admin/products/${productId}/variants`).set("authorization", `Bearer ${token}`)
    .send({
      ...invalidVariant,
      sizingGuide: { unit: "cm", measurements: { length: 74, chestWidth: 55, waistWidth: 0 } },
    }).expect(400);
});

test("shipping rates use authoritative cart data and normalize Biteship responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalShippingConfig = {
    apiKey: config.biteshipApiKey,
    originPostalCode: config.biteshipOriginPostalCode,
    couriers: config.biteshipCouriers,
  };
  const product = await request(app).get("/api/products/ferrari-team-jersey").expect(200);
  const variantId = product.body.variants[0].id as string;
  config.biteshipApiKey = "biteship_test.test-key";
  config.biteshipOriginPostalCode = "12440";
  config.biteshipCouriers = ["jne", "sicepat"];

  try {
    let upstreamBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, "biteship_test.test-key");
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        pricing: [
          {
            courier_code: "sicepat", courier_name: "SiCepat", courier_service_code: "reg",
            courier_service_name: "Reguler", description: "Regular service", duration: "1 - 2 days",
            service_type: "standard", currency: "IDR", price: 32_000,
          },
          {
            courier_code: "jne", courier_name: "JNE", courier_service_code: "reg",
            courier_service_name: "Reguler", description: "Regular service", duration: "2 - 3 days",
            service_type: "standard", currency: "IDR", price: 18_000,
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const quote = await request(app).post("/api/shipping/rates").send({
      destinationPostalCode: "12240",
      items: [{ variantId, quantity: 2 }, { variantId, quantity: 1 }],
    }).expect("cache-control", "no-store").expect(200);
    assert.deepEqual(quote.body.rates.map((rate: { price: number }) => rate.price), [18_000, 32_000]);
    assert.deepEqual(upstreamBody, {
      origin_postal_code: 12440,
      destination_postal_code: 12240,
      couriers: "jne,sicepat",
      items: [{
        name: "Ferrari Team Jersey", category: "fashion", sku: "FER-JER-RED-M", value: 1_250_000,
        quantity: 3, weight: 450, height: 4, length: 30, width: 22,
      }],
    });

    await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "123", items: [{ variantId, quantity: 1 }] }).expect(400);
    await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "12240", items: [{ variantId: randomUUID(), quantity: 1 }] }).expect(409);
    await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "12240", items: [{ variantId, quantity: 9 }] }).expect(409);

    globalThis.fetch = async () => new Response(JSON.stringify({ code: 40001001, message: "Invalid postal code" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "99999", items: [{ variantId, quantity: 1 }] })
      .expect(422, { error: { code: "INVALID_DESTINATION", message: "The destination postal code is not supported" } });

    globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
    await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "12240", items: [{ variantId, quantity: 1 }] }).expect(504);

    globalThis.fetch = async () => new Response(JSON.stringify({ pricing: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const empty = await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "12240", items: [{ variantId, quantity: 1 }] }).expect(200);
    assert.deepEqual(empty.body.rates, []);

    config.biteshipApiKey = undefined;
    await request(app).post("/api/shipping/rates")
      .send({ destinationPostalCode: "12240", items: [{ variantId, quantity: 1 }] }).expect(503);
  } finally {
    globalThis.fetch = originalFetch;
    config.biteshipApiKey = originalShippingConfig.apiKey;
    config.biteshipOriginPostalCode = originalShippingConfig.originPostalCode;
    config.biteshipCouriers = originalShippingConfig.couriers;
  }
});

test("promo codes are normalized, validated, previewed, and managed by admins", async () => {
  const product = await request(app).get("/api/products/ferrari-team-jersey").expect(200);
  const variantId = product.body.variants[0].id as string;
  await request(app).get("/api/admin/promo-codes").expect(401);
  const created = await request(app).post("/api/admin/promo-codes")
    .set("authorization", `Bearer ${token}`)
    .send({ code: "grid20", discountPercentage: 20, maxDiscountIdr: 100_000, active: true })
    .expect(201);
  promoCodeId = created.body.id;
  assert.equal(created.body.code, "GRID20");
  await request(app).post("/api/admin/promo-codes")
    .set("authorization", `Bearer ${token}`)
    .send({ code: "GRID20", discountPercentage: 10, active: true })
    .expect(409);
  await request(app).post("/api/admin/promo-codes")
    .set("authorization", `Bearer ${token}`)
    .send({ code: "BAD", discountPercentage: 0, active: true })
    .expect(400);

  const preview = await request(app).post("/api/promo-codes/preview")
    .send({ code: "grid20", items: [{ variantId, quantity: 1 }] })
    .expect(200);
  assert.deepEqual(preview.body, {
    code: "GRID20",
    discountPercentage: 20,
    maxDiscountIdr: 100_000,
    subtotalIdr: 1_250_000,
    discountIdr: 100_000,
    discountedSubtotalIdr: 1_150_000,
  });

  await request(app).patch(`/api/admin/promo-codes/${promoCodeId}`)
    .set("authorization", `Bearer ${token}`).send({ maxDiscountIdr: null }).expect(200);
  const uncapped = await request(app).post("/api/promo-codes/preview")
    .send({ code: "GRID20", items: [{ variantId, quantity: 1 }] }).expect(200);
  assert.equal(uncapped.body.discountIdr, 250_000);

  await request(app).patch(`/api/admin/promo-codes/${promoCodeId}`)
    .set("authorization", `Bearer ${token}`).send({ maxDiscountIdr: 100_000, active: false }).expect(200);
  await request(app).post("/api/promo-codes/preview")
    .send({ code: "GRID20", items: [{ variantId, quantity: 1 }] })
    .expect(409, { error: { code: "PROMO_CODE_UNAVAILABLE", message: "Promo code is invalid or inactive" } });
  await request(app).patch(`/api/admin/promo-codes/${promoCodeId}`)
    .set("authorization", `Bearer ${token}`).send({ active: true }).expect(200);
  const listed = await request(app).get("/api/admin/promo-codes")
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.equal(listed.body[0].redemptionCount, 0);
  assert.equal(listed.body[0].redeemedDiscountIdr, 0);
});

test("checkout verifies payment notifications, reserves stock, and books Biteship once", async () => {
  const originalFetch = globalThis.fetch;
  const originalConfig = {
    apiKey: config.biteshipApiKey,
    originPostalCode: config.biteshipOriginPostalCode,
    originName: config.biteshipOriginContactName,
    originPhone: config.biteshipOriginContactPhone,
    originAddress: config.biteshipOriginAddress,
    couriers: config.biteshipCouriers,
    midtransEnv: config.midtransEnv,
    merchantId: config.midtransMerchantId,
    serverKey: config.midtransServerKey,
    storefrontUrl: config.storefrontUrl,
  };
  const product = await request(app).get("/api/products/ferrari-team-jersey").expect(200);
  const variantId = product.body.variants[0].id as string;
  config.biteshipApiKey = "biteship_test.checkout";
  config.biteshipOriginPostalCode = "12440";
  config.biteshipOriginContactName = "Warehouse";
  config.biteshipOriginContactPhone = "081234567890";
  config.biteshipOriginAddress = "Jl. Warehouse 1, Jakarta";
  config.biteshipCouriers = ["jne"];
  config.midtransEnv = "sandbox";
  config.midtransMerchantId = "merchant-test";
  config.midtransServerKey = "server-test";
  config.storefrontUrl = "http://localhost:3001";

  let rateCalls = 0;
  let snapCalls = 0;
  let bookingCalls = 0;
  let trackingCalls = 0;
  let trackingMode: "success" | "unavailable" | "malformed" = "success";
  let failNextBooking = false;
  const snapBodies: Array<{
    transaction_details: { gross_amount: number };
    item_details: Array<{ id: string; name: string; price: number; quantity: number }>;
  }> = [];
  const bookingBodies: Array<{
    reference_id: string;
    courier_company: string;
    courier_type: string;
    items: Array<{ name: string; description?: string; sku: string }>;
  }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/rates/couriers")) {
      rateCalls += 1;
      return new Response(JSON.stringify({ pricing: [{
        courier_code: "jne", courier_name: "JNE", courier_service_code: "reg", courier_service_name: "Reguler",
        description: "Regular service", duration: "2 - 3 days", service_type: "standard", currency: "IDR",
        price: 18_000, available_collection_method: ["pickup"],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("midtrans.com/snap/v1/transactions")) {
      snapCalls += 1;
      const body = JSON.parse(String(init?.body)) as typeof snapBodies[number];
      snapBodies.push(body);
      assert.equal(
        body.item_details.reduce((sum, item) => sum + item.price * item.quantity, 0),
        body.transaction_details.gross_amount,
      );
      return new Response(JSON.stringify({ token: `snap-${snapCalls}`, redirect_url: "https://app.sandbox.midtrans.com/snap/test" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/v1/orders")) {
      bookingCalls += 1;
      if (failNextBooking) {
        failNextBooking = false;
        bookingBodies.push(JSON.parse(String(init?.body)) as typeof bookingBodies[number]);
        return new Response(JSON.stringify({ code: 50000000 }), { status: 503, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body)) as typeof bookingBodies[number];
      bookingBodies.push(body);
      assert.equal(body.courier_company, "jne");
      assert.equal(body.courier_type, "reg");
      return new Response(JSON.stringify({
        id: `biteship-${body.reference_id}`,
        courier: { tracking_id: "tracking-1", waybill_id: "waybill-1" },
        price: 18_000,
        status: "confirmed",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v1/trackings/tracking-1")) {
      trackingCalls += 1;
      assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, "biteship_test.checkout");
      if (trackingMode === "unavailable") {
        return new Response(JSON.stringify({ code: 40003002, message: "Courier tracking not available" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (trackingMode === "malformed") {
        return new Response(JSON.stringify({ success: true, status: "in_transit" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        id: "tracking-1",
        waybill_id: "waybill-1",
        courier: { company: "jne", driver_name: "Private Driver", driver_phone: "0811111111" },
        origin: { address: "Private warehouse address" },
        destination: { address: "Private customer address" },
        history: [
          { note: "Package is moving", updated_at: "2026-07-20T10:00:00+07:00", status: "in_transit" },
          { note: "Package collected", updated_at: "2026-07-19T09:00:00+07:00", status: "picked" },
        ],
        link: "https://example.com/track/waybill-1",
        status: "in_transit",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  function notification(orderId: string, status: string, grossAmount = "1268000.00") {
    const statusCode = status === "settlement" ? "200" : "201";
    return {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      merchant_id: "merchant-test",
      transaction_status: status,
      fraud_status: "accept",
      transaction_id: `transaction-${orderId}`,
      payment_type: "bank_transfer",
      settlement_time: "2026-07-18 12:00:00",
      signature_key: createHash("sha512").update(`${orderId}${statusCode}${grossAmount}server-test`).digest("hex"),
    };
  }

  const payload = {
    idempotencyKey: randomUUID(),
    email: "buyer@example.com",
    firstName: "Ayu",
    lastName: "Racer",
    phone: "081234567890",
    address: "Jl. Finish Line 1",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "12240",
    items: [{ variantId, quantity: 1 }],
    courierCode: "jne",
    serviceCode: "reg",
  };

  try {
    const promoPayload = { ...payload, promoCode: "grid20" };
    const checkout = await request(app).post("/api/checkout").send(promoPayload).expect(201);
    assert.equal(checkout.body.subtotalIdr, 1_250_000);
    assert.equal(checkout.body.discountIdr, 100_000);
    assert.equal(checkout.body.shippingIdr, 18_000);
    assert.equal(checkout.body.totalIdr, 1_168_000);
    assert.equal(checkout.body.promoCode, "GRID20");
    assert.equal(checkout.body.snapToken, "snap-1");
    const repeated = await request(app).post("/api/checkout").send(promoPayload).expect(201);
    assert.equal(repeated.body.orderId, checkout.body.orderId);
    assert.equal(rateCalls, 1);
    assert.equal(snapCalls, 1);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 7);
    assert.deepEqual(snapBodies[0].item_details[0], {
      id: "FER-JER-RED-M",
      name: "Ferrari Team Jersey (Red / M)",
      price: 1_250_000,
      quantity: 1,
    });
    assert.deepEqual(snapBodies[0].item_details[1], {
      id: "promo-discount",
      name: "Promo GRID20",
      price: -100_000,
      quantity: 1,
    });
    const itemSnapshot = await prisma.orderItem.findFirstOrThrow({ where: { orderId: checkout.body.orderId } });
    assert.equal(itemSnapshot.sku, "FER-JER-RED-M");
    assert.equal(itemSnapshot.color, "Red");
    assert.equal(itemSnapshot.size, "M");

    await request(app).patch(`/api/admin/promo-codes/${promoCodeId}`)
      .set("authorization", `Bearer ${token}`).send({ active: false }).expect(200);
    await request(app).post("/api/checkout")
      .send({ ...promoPayload, idempotencyKey: randomUUID() }).expect(409, {
        error: { code: "PROMO_CODE_UNAVAILABLE", message: "Promo code is invalid or inactive" },
      });
    await request(app).patch(`/api/admin/promo-codes/${promoCodeId}`)
      .set("authorization", `Bearer ${token}`).send({ active: true }).expect(200);

    const receipt = await request(app).get(`/api/orders/${checkout.body.orderId}`).expect(200);
    assert.match(receipt.body.orderNumber, /^VLD-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal(receipt.body.orderNumber, checkout.body.orderNumber);
    assert.equal(receipt.body.paymentStatus, "PENDING");
    assert.equal(receipt.body.promoCode, "GRID20");
    assert.equal(receipt.body.discountIdr, 100_000);
    assert.equal(receipt.body.midtransSnapToken, undefined);
    assert.equal(receipt.body.address, undefined);
    const missingTracking = await request(app).post("/api/orders/track")
      .send({ orderNumber: receipt.body.orderNumber, email: "wrong@example.com" })
      .expect(404, { error: { code: "TRACKING_NOT_FOUND", message: "No order matches those details" } });
    assert.equal(missingTracking.body.error.fields, undefined);
    const pendingTracking = await request(app).post("/api/orders/track")
      .send({ orderNumber: receipt.body.orderNumber.toLowerCase(), email: "BUYER@EXAMPLE.COM" }).expect(200);
    assert.equal(pendingTracking.body.tracking, null);
    assert.equal(trackingCalls, 0);

    await request(app).post("/api/payments/midtrans/notification")
      .send({ ...notification(checkout.body.orderId, "pending"), signature_key: "invalid" }).expect(401);
    assert.equal(await prisma.midtransPaymentEvent.count({ where: { orderId: checkout.body.orderId } }), 0);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(checkout.body.orderId, "pending", "1268001.00")).expect(400);
    const rejectedEvent = await prisma.midtransPaymentEvent.findFirstOrThrow({ where: { orderId: checkout.body.orderId } });
    assert.equal(rejectedEvent.processingResult, "REJECTED");
    assert.equal(rejectedEvent.processingError, "PAYMENT_AMOUNT_MISMATCH");
    assert.ok(rejectedEvent.processedAt);
    assert.equal((rejectedEvent.payload as Record<string, unknown>).settlement_time, "2026-07-18 12:00:00");
    assert.equal((rejectedEvent.payload as Record<string, unknown>).signature_key, undefined);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(checkout.body.orderId, "pending", "1168000.00")).expect(200);
    assert.equal(bookingCalls, 0);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(checkout.body.orderId, "settlement", "1168000.00")).expect(200);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(checkout.body.orderId, "settlement", "1168000.00")).expect(200);
    assert.equal(bookingCalls, 1);
    await request(app).get(`/api/admin/orders/${checkout.body.orderId}/payment-events`).expect(401);
    await request(app).get(`/api/admin/orders/${randomUUID()}/payment-events`)
      .set("authorization", `Bearer ${token}`).expect(404);
    const paymentEvents = await request(app).get(`/api/admin/orders/${checkout.body.orderId}/payment-events`)
      .set("authorization", `Bearer ${token}`).expect("cache-control", "no-store").expect(200);
    assert.deepEqual(paymentEvents.body.map((event: { transactionStatus: string }) => event.transactionStatus), [
      "pending", "pending", "settlement", "settlement",
    ]);
    assert.deepEqual(paymentEvents.body.map((event: { processingResult: string }) => event.processingResult), [
      "REJECTED", "PROCESSED", "PROCESSED", "PROCESSED",
    ]);
    assert.ok(paymentEvents.body.every((event: { processedAt?: string }) => event.processedAt));
    assert.ok(paymentEvents.body.every((event: { payload: Record<string, unknown> }) => event.payload.signature_key === undefined));
    assert.ok(paymentEvents.body.every((event: { payload: Record<string, unknown> }) =>
      event.payload.settlement_time === "2026-07-18 12:00:00"));
    const paid = await request(app).get(`/api/orders/${checkout.body.orderId}`).expect(200);
    assert.equal(paid.body.paymentStatus, "PAID");
    assert.equal(paid.body.fulfillmentStatus, "BOOKED");
    assert.equal(paid.body.tracking.waybillId, "waybill-1");
    const tracked = await request(app).post("/api/orders/track")
      .send({ orderNumber: paid.body.orderNumber.toLowerCase(), email: "BUYER@EXAMPLE.COM" }).expect(200);
    assert.equal(tracked.body.orderNumber, paid.body.orderNumber);
    assert.deepEqual(tracked.body.destination, { city: "Jakarta Selatan", province: "DKI Jakarta" });
    assert.deepEqual(tracked.body.courier, { name: "JNE", serviceName: "Reguler", duration: "2 - 3 days" });
    assert.deepEqual(tracked.body.items[0], {
      name: "Ferrari Team Jersey", sku: "FER-JER-RED-M", color: "Red", size: "M", unitPriceIdr: 1_250_000, quantity: 1,
    });
    assert.deepEqual(tracked.body.tracking.history.map((event: { status: string }) => event.status), ["picked", "in_transit"]);
    assert.equal(tracked.body.tracking.link, "https://example.com/track/waybill-1");
    assert.equal(tracked.body.address, undefined);
    assert.equal(tracked.body.tracking.courier, undefined);
    assert.equal(tracked.body.tracking.origin, undefined);
    const legacyTracked = await request(app).post("/api/orders/track")
      .send({ orderNumber: checkout.body.orderId, email: "buyer@example.com" }).expect(200);
    assert.equal(legacyTracked.body.orderNumber, paid.body.orderNumber);
    trackingMode = "unavailable";
    const unavailableTracking = await request(app).post("/api/orders/track")
      .send({ orderNumber: paid.body.orderNumber, email: "buyer@example.com" }).expect(200);
    assert.equal(unavailableTracking.body.tracking, null);
    trackingMode = "malformed";
    await request(app).post("/api/orders/track")
      .send({ orderNumber: paid.body.orderNumber, email: "buyer@example.com" })
      .expect(502, { error: { code: "TRACKING_UPSTREAM_ERROR", message: "Biteship returned an unexpected response" } });
    trackingMode = "success";
    assert.deepEqual(bookingBodies.find((body) => body.reference_id === checkout.body.orderId)?.items[0], {
      name: "Ferrari Team Jersey (Red / M)",
      description: "Color: Red / Size: M",
      sku: "FER-JER-RED-M",
      value: 1_250_000,
      quantity: 1,
      weight: 450,
      height: 4,
      length: 30,
      width: 22,
      category: "fashion",
    });
    const redeemed = await prisma.order.findUniqueOrThrow({ where: { id: checkout.body.orderId } });
    assert.ok(redeemed.promoRedeemedAt);
    const promoTotals = await request(app).get("/api/admin/promo-codes")
      .set("authorization", `Bearer ${token}`).expect(200);
    assert.equal(promoTotals.body[0].redemptionCount, 1);
    assert.equal(promoTotals.body[0].redeemedDiscountIdr, 100_000);

    const promoExpiring = await request(app).post("/api/checkout")
      .send({ ...promoPayload, idempotencyKey: randomUUID() }).expect(201);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(promoExpiring.body.orderId, "expire", "1168000.00")).expect(200);
    const usages = await request(app).get(`/api/admin/promo-codes/${promoCodeId}/usages?page=1&limit=50`)
      .set("authorization", `Bearer ${token}`).expect(200);
    assert.equal(usages.body.total, 2);
    assert.equal(usages.body.data.filter((usage: { promoRedeemedAt: string | null }) => usage.promoRedeemedAt).length, 1);
    const totalsAfterExpired = await request(app).get("/api/admin/promo-codes")
      .set("authorization", `Bearer ${token}`).expect(200);
    assert.equal(totalsAfterExpired.body[0].redemptionCount, 1);

    const expiring = await request(app).post("/api/checkout")
      .send({ ...payload, idempotencyKey: randomUUID() }).expect(201);
    assert.equal(expiring.body.discountIdr, 0);
    assert.equal(expiring.body.totalIdr, 1_268_000);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 6);
    const expired = notification(expiring.body.orderId, "expire");
    await request(app).post("/api/payments/midtrans/notification").send(expired).expect(200);
    await request(app).post("/api/payments/midtrans/notification").send(expired).expect(200);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 7);

    const retrying = await request(app).post("/api/checkout")
      .send({ ...payload, idempotencyKey: randomUUID() }).expect(201);
    failNextBooking = true;
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(retrying.body.orderId, "settlement")).expect(503);
    const failedBooking = await request(app).get(`/api/orders/${retrying.body.orderId}`).expect(200);
    assert.equal(failedBooking.body.paymentStatus, "PAID");
    assert.equal(failedBooking.body.fulfillmentStatus, "BOOKING_FAILED");
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(retrying.body.orderId, "settlement")).expect(200);
    const bookedRetry = await request(app).get(`/api/orders/${retrying.body.orderId}`).expect(200);
    assert.equal(bookedRetry.body.fulfillmentStatus, "BOOKED");

    const concurrent = await request(app).post("/api/checkout")
      .send({ ...payload, idempotencyKey: randomUUID() }).expect(201);
    const bookingsBeforeConcurrent = bookingCalls;
    const [paidNotification, expireNotification] = await Promise.all([
      request(app).post("/api/payments/midtrans/notification")
        .send(notification(concurrent.body.orderId, "settlement")),
      request(app).post("/api/payments/midtrans/notification")
        .send(notification(concurrent.body.orderId, "expire")),
    ]);
    assert.equal(paidNotification.status, 200);
    assert.equal(expireNotification.status, 200);
    const concurrentOrder = await prisma.order.findUniqueOrThrow({ where: { id: concurrent.body.orderId } });
    assert.equal(concurrentOrder.paymentStatus, "PAID");
    assert.equal(concurrentOrder.fulfillmentStatus, "BOOKED");
    assert.equal(concurrentOrder.stockReleasedAt, null);
    assert.equal(bookingCalls, bookingsBeforeConcurrent + 1);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 5);

    const latePaid = await request(app).post("/api/checkout")
      .send({ ...payload, idempotencyKey: randomUUID() }).expect(201);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(latePaid.body.orderId, "expire")).expect(200);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 5);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(latePaid.body.orderId, "settlement")).expect(200);
    const recovered = await prisma.order.findUniqueOrThrow({ where: { id: latePaid.body.orderId } });
    assert.equal(recovered.paymentStatus, "PAID");
    assert.equal(recovered.fulfillmentStatus, "BOOKED");
    assert.equal(recovered.stockReleasedAt, null);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 4);

    const optionless = await prisma.product.create({
      data: {
        name: "Checkout Cap",
        slug: "checkout-cap",
        priceIdr: 500_000,
        status: "ACTIVE",
        categoryId,
        variants: { create: [{
          sku: "CHECKOUT-CAP-DEFAULT",
          stockQuantity: 2,
          packageLengthMm: 250,
          packageWidthMm: 200,
          packageHeightMm: 120,
          packageWeightG: 220,
        }] },
      },
      include: { variants: true },
    });
    const optionlessCheckout = await request(app).post("/api/checkout").send({
      ...payload,
      idempotencyKey: randomUUID(),
      items: [{ variantId: optionless.variants[0].id, quantity: 1 }],
    }).expect(201);
    const optionlessSnapItem = snapBodies.at(-1)?.item_details[0];
    assert.deepEqual(optionlessSnapItem, {
      id: "CHECKOUT-CAP-DEFAULT",
      name: "Checkout Cap",
      price: 500_000,
      quantity: 1,
    });
    const optionlessSnapshot = await prisma.orderItem.findFirstOrThrow({ where: { orderId: optionlessCheckout.body.orderId } });
    assert.equal(optionlessSnapshot.color, null);
    assert.equal(optionlessSnapshot.size, null);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(optionlessCheckout.body.orderId, "expire", "518000.00")).expect(200);
    await prisma.product.update({ where: { id: optionless.id }, data: { status: "ARCHIVED" } });

    const insufficient = await request(app).post("/api/checkout").send({
      ...payload,
      idempotencyKey: randomUUID(),
      items: [{ variantId, quantity: 2 }],
    }).expect(201);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(insufficient.body.orderId, "expire", "2518000.00")).expect(200);
    await prisma.productVariant.update({ where: { id: variantId }, data: { stockQuantity: 1 } });
    const bookingsBeforeInsufficient = bookingCalls;
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(insufficient.body.orderId, "settlement", "2518000.00")).expect(503);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(insufficient.body.orderId, "settlement", "2518000.00")).expect(503);
    const unavailable = await prisma.order.findUniqueOrThrow({ where: { id: insufficient.body.orderId } });
    assert.equal(unavailable.paymentStatus, "PAID");
    assert.equal(unavailable.fulfillmentStatus, "BOOKING_FAILED");
    assert.ok(unavailable.stockReleasedAt);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 1);
    assert.equal(bookingCalls, bookingsBeforeInsufficient);
    await prisma.productVariant.update({ where: { id: variantId }, data: { stockQuantity: 4 } });
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(insufficient.body.orderId, "settlement", "2518000.00")).expect(200);
    const restocked = await prisma.order.findUniqueOrThrow({ where: { id: insufficient.body.orderId } });
    assert.equal(restocked.fulfillmentStatus, "BOOKED");
    assert.equal(restocked.stockReleasedAt, null);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity, 2);

    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(checkout.body.orderId, "refund", "1168000.00")).expect(200);
    await request(app).post("/api/payments/midtrans/notification")
      .send(notification(checkout.body.orderId, "settlement", "1168000.00")).expect(200);
    const refunded = await prisma.order.findUniqueOrThrow({ where: { id: checkout.body.orderId } });
    assert.equal(refunded.paymentStatus, "REFUNDED");
    assert.ok(refunded.promoRedeemedAt);
  } finally {
    globalThis.fetch = originalFetch;
    config.biteshipApiKey = originalConfig.apiKey;
    config.biteshipOriginPostalCode = originalConfig.originPostalCode;
    config.biteshipOriginContactName = originalConfig.originName;
    config.biteshipOriginContactPhone = originalConfig.originPhone;
    config.biteshipOriginAddress = originalConfig.originAddress;
    config.biteshipCouriers = originalConfig.couriers;
    config.midtransEnv = originalConfig.midtransEnv;
    config.midtransMerchantId = originalConfig.merchantId;
    config.midtransServerKey = originalConfig.serverKey;
    config.storefrontUrl = originalConfig.storefrontUrl;
  }
});

test("collection hierarchy, memberships, and counted facets are public", async () => {
  await request(app).put(`/api/admin/collections/${ferrariCollectionId}/products`)
    .set("authorization", `Bearer ${token}`)
    .send({ productIds: [productId], featuredProductIds: [productId] }).expect(200);
  const managedCollection = await request(app).get(`/api/admin/collections/${ferrariCollectionId}`)
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.equal(managedCollection.body.products[0].featured, true);
  assert.equal(managedCollection.body.products[0].position, 0);
  await request(app).put(`/api/admin/collections/${ferrariCollectionId}/products`)
    .set("authorization", `Bearer ${token}`)
    .send({ productIds: [productId], featuredProductIds: [randomUUID()] }).expect(400);
  const tree = await request(app).get("/api/collections").expect(200);
  assert.deepEqual(tree.body.map((collection: { slug: string }) => collection.slug), ["formula-1", "drivers"]);
  assert.equal(tree.body[0].children[0].slug, "ferrari");

  const response = await request(app)
    .get("/api/collections/ferrari/products?driver=charles-leclerc&productType=jerseys&audience=UNISEX&availability=in_stock")
    .expect(200);
  assert.equal(response.body.collection.slug, "ferrari");
  assert.equal(response.body.total, 1);
  assert.equal(response.body.facets.teams[0].slug, "ferrari");
  assert.deepEqual(
    response.body.facets.drivers.map((driver: { slug: string; count: number }) => [driver.slug, driver.count]),
    [["charles-leclerc", 1], ["niki-lauda", 1]],
  );
  assert.equal(response.body.facets.productTypes[0].slug, "jerseys");
  assert.equal(response.body.facets.audiences[0].value, "UNISEX");
  assert.equal(response.body.facets.availability.inStock, 1);
  assert.deepEqual(response.body.facets.price, { min: 1_250_000, max: 1_250_000 });
  const indonesian = await request(app).get("/api/collections/ferrari/products?locale=id").expect(200);
  assert.equal(indonesian.body.data[0].name, "Jersey Tim Ferrari");
  const inclusivePrice = await request(app)
    .get("/api/collections/ferrari/products?minPrice=1250000&maxPrice=1250000").expect(200);
  assert.equal(inclusivePrice.body.total, 1);
  const outsidePrice = await request(app).get("/api/collections/ferrari/products?minPrice=1250001").expect(200);
  assert.equal(outsidePrice.body.total, 0);

  const driverCollection = await request(app).get("/api/collections/charles-leclerc/products").expect(200);
  const historicalCollection = await request(app).get("/api/collections/niki-lauda/products").expect(200);
  assert.equal(driverCollection.body.total, 1);
  assert.equal(historicalCollection.body.total, 1);
  await request(app).delete(`/api/admin/collections/${ferrariCollectionId}`)
    .set("authorization", `Bearer ${token}`).expect(409);
});

test("optionless products use a default SKU without fake size or color", async () => {
  const cap = await request(app).post("/api/admin/products").set("authorization", `Bearer ${token}`)
    .send({
      name: "Ferrari Team Cap",
      slug: "ferrari-team-cap",
      priceIdr: 500_000,
      status: "ACTIVE",
      categoryId,
      teamId,
      audience: "UNISEX",
      collectionIds: [ferrariCollectionId],
      variants: [{
        sku: "FER-CAP-DEFAULT",
        stockQuantity: 3,
        packageLengthMm: 250,
        packageWidthMm: 200,
        packageHeightMm: 120,
        packageWeightG: 220,
      }],
    }).expect(201);
  assert.equal(cap.body.variants[0].size, null);
  assert.equal(cap.body.variants[0].color, null);
  assert.equal(cap.body.variants[0].sizingGuide, null);
  const publicCap = await request(app).get("/api/products/ferrari-team-cap").expect(200);
  assert.equal(publicCap.body.variants[0].available, true);
  await request(app).patch(`/api/admin/collections/${ferrariCollectionId}`)
    .set("authorization", `Bearer ${token}`).send({ active: false }).expect(409);
  const sizedProduct = await request(app).post("/api/admin/products").set("authorization", `Bearer ${token}`)
    .send({
      name: "Size-only Shirt",
      slug: "size-only-shirt",
      priceIdr: 700_000,
      categoryId,
      variants: [{
        sku: "SIZE-ONLY-S",
        size: "S",
        stockQuantity: 2,
        packageLengthMm: 300,
        packageWidthMm: 220,
        packageHeightMm: 40,
        packageWeightG: 400,
        sizingGuide: { unit: "cm", measurements: { length: 68, chestWidth: 48, waistWidth: 46 } },
      }],
    }).expect(201);
  assert.equal(sizedProduct.body.variants[0].color, null);
  await request(app).delete(`/api/admin/products/${cap.body.id}/variants/${cap.body.variants[0].id}`)
    .set("authorization", `Bearer ${token}`).expect(409);
  await request(app).patch(`/api/admin/products/${cap.body.id}`).set("authorization", `Bearer ${token}`)
    .send({ status: "ARCHIVED" }).expect(200);
});

test("database uniqueness and transactional tag updates are enforced", async () => {
  await request(app).post("/api/admin/teams").set("authorization", `Bearer ${token}`)
    .send({ name: "Ferrari", slug: "another-ferrari" }).expect(409);
  await request(app).post("/api/admin/drivers").set("authorization", `Bearer ${token}`)
    .send({ name: "Other Driver", slug: "other-driver", racingNumber: 16, teamId }).expect(409);
  await request(app).post("/api/admin/drivers").set("authorization", `Bearer ${token}`)
    .send({ name: "Invalid Number", slug: "invalid-number", racingNumber: 100, teamId }).expect(400);
  const current = await request(app).get(`/api/admin/products/${productId}`)
    .set("authorization", `Bearer ${token}`).expect(200);
  await request(app).post(`/api/admin/products/${productId}/variants`).set("authorization", `Bearer ${token}`)
    .send({
      sku: "FER-JER-RED-M", size: "L", color: "Red", stockQuantity: 1,
      packageLengthMm: 300, packageWidthMm: 220, packageHeightMm: 40, packageWeightG: 450,
      sizingGuide: { unit: "cm", measurements: { length: 72, chestWidth: 52, waistWidth: 50 } },
    }).expect(409);
  await request(app).patch(`/api/admin/products/${productId}`).set("authorization", `Bearer ${token}`)
    .send({ tagIds: [randomUUID()] }).expect(400);
  const afterRollback = await request(app).get(`/api/admin/products/${productId}`)
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.equal(afterRollback.body.tags.length, current.body.tags.length);
  assert.equal(afterRollback.body.tags[0].tag.slug, "limited-edition");
});

test("driver transfers preserve historical product teams and references", async () => {
  await request(app).patch(`/api/admin/drivers/${driverId}`).set("authorization", `Bearer ${token}`)
    .send({ teamId: secondTeamId }).expect(200);
  const product = await request(app).get(`/api/admin/products/${productId}`)
    .set("authorization", `Bearer ${token}`).expect(200);
  assert.equal(product.body.team.id, teamId);
  assert.equal(product.body.drivers.find((driver: { id: string }) => driver.id === driverId).teamId, secondTeamId);
  const publicProduct = await request(app).get("/api/products/ferrari-team-jersey").expect(200);
  assert.equal(publicProduct.body.team.slug, "ferrari");
  assert.equal(publicProduct.body.drivers.find((driver: { id: string }) => driver.id === driverId).teamId, secondTeamId);
  const transferredDrivers = await request(app).get("/api/drivers?team=mercedes").expect(200);
  assert.equal(transferredDrivers.body[0].id, driverId);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const logo = await request(app).post(`/api/admin/teams/${teamId}/logo`)
    .set("authorization", `Bearer ${token}`).attach("image", pngHeader, "ferrari.png").expect(200);
  const photo = await request(app).post(`/api/admin/drivers/${driverId}/photo`)
    .set("authorization", `Bearer ${token}`).attach("image", pngHeader, "leclerc.png").expect(200);
  const logoPath = path.join(config.uploadDir, logo.body.logoUrl.replace("/uploads/", ""));
  const photoPath = path.join(config.uploadDir, photo.body.photoUrl.replace("/uploads/", ""));
  await request(app).delete(`/api/admin/drivers/${driverId}`).set("authorization", `Bearer ${token}`).expect(409);
  await request(app).delete(`/api/admin/teams/${teamId}`).set("authorization", `Bearer ${token}`).expect(409);
  await request(app).delete(`/api/admin/teams/${secondTeamId}`).set("authorization", `Bearer ${token}`).expect(409);
  await access(logoPath);
  await access(photoPath);
  await request(app).delete(`/api/admin/teams/${teamId}/logo`).set("authorization", `Bearer ${token}`).expect(204);
  await request(app).delete(`/api/admin/drivers/${driverId}/photo`).set("authorization", `Bearer ${token}`).expect(204);
  await assert.rejects(access(logoPath));
  await assert.rejects(access(photoPath));
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
  assert.match(upload.body.path, /^\/uploads\//);
  assert.equal(upload.body.url, upload.body.path);
  const storedKey = upload.body.path.replace("/uploads/", "");
  const storedPath = path.join(config.uploadDir, storedKey);
  await access(storedPath);
  await request(app).get(upload.body.path).expect("content-type", /image\/png/).expect(200);
  const publicProduct = await request(app).get("/api/products/ferrari-team-jersey").expect(200);
  assert.equal(publicProduct.body.photos[0].url, upload.body.path);
  await request(app).delete(`/api/admin/products/${productId}/photos/${upload.body.id}`)
    .set("authorization", `Bearer ${token}`).expect(204);
  await assert.rejects(access(storedPath));

  const legacyKey = `legacy-${randomUUID()}.png`;
  await storePhoto(legacyKey, pngHeader, "image/png");
  const legacy = await prisma.productPhoto.create({
    data: { productId, path: legacyKey, altText: "Legacy product image", position: 0 },
  });
  const legacyPath = path.join(config.uploadDir, legacyKey);
  await access(legacyPath);
  const legacyProduct = await request(app).get("/api/products/ferrari-team-jersey").expect(200);
  assert.equal(legacyProduct.body.photos[0].url, `/uploads/${legacyKey}`);
  await request(app).delete(`/api/admin/products/${productId}/photos/${legacy.id}`)
    .set("authorization", `Bearer ${token}`).expect(204);
  await assert.rejects(access(legacyPath));
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
