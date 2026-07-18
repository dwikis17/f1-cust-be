import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

before(async () => {
  assert.match(config.databaseUrl, /f1_store_test/, "Tests must use the test database");
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
      slug: "ferrari-team-jersey",
      description: "Official red team jersey",
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
        sizingGuide: { unit: "cm", measurements: { chest: 52, length: 72 } },
      }],
    }).expect(201);
  productId = product.body.id;
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
    .send({ status: "ACTIVE" }).expect(200);
  const response = await request(app)
    .get("/api/products?search=team&size=M&color=Red&team=ferrari&driver=charles-leclerc")
    .expect(200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.data[0].priceIdr, 1_250_000);
  assert.equal(response.body.data[0].team.slug, "ferrari");
  assert.deepEqual(
    response.body.data[0].drivers.map((driver: { slug: string }) => driver.slug),
    ["charles-leclerc", "niki-lauda"],
  );
  assert.equal(response.body.data[0].audience, "UNISEX");
  assert.equal(response.body.data[0].variants[0].available, true);
  assert.equal(response.body.data[0].variants[0].stockQuantity, undefined);
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
      sizingGuide: { unit: "cm", measurements: { chest: 55 } },
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
        sizingGuide: { unit: "cm", measurements: { chest: 48 } },
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
      sizingGuide: { unit: "cm", measurements: { chest: 52 } },
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
