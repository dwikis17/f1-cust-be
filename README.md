# F1 Merchandise API

Express, TypeScript, Prisma, and PostgreSQL backend for a public F1 merchandise catalog and its admin tools.

## Local setup

Requirements: Node.js 24+, npm, and Docker.

```sh
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run admin:create
npm run dev
```

For non-interactive local setup or automation, provide `ADMIN_EMAIL`, `ADMIN_DISPLAY_NAME`, and `ADMIN_PASSWORD` when running `npm run admin:create`.

The API starts at `http://localhost:3000`. PostgreSQL is available only on `127.0.0.1:5432`. Local Worker development writes uploaded images to the remote `f1-bucket` R2 bucket under `development/`, so Wrangler must be logged in. Set `PHOTO_PUBLIC_BASE_URL` to the bucket's HTTPS public origin; development currently uses its `r2.dev` URL, while production should use an R2 custom domain. Deployed Workers use `production/`. Run `npm run dev:node` only when you explicitly want filesystem uploads and `/uploads/*` URLs.

Useful commands:

```sh
npm run db:studio    # inspect local data
npm run db:seed      # upsert the official 2026 F1 teams and drivers
npm run db:deploy    # apply committed migrations
npm run photos:rewrite-urls # preview managed image URL changes
npm run build        # generate Prisma Client and compile TypeScript
npm test             # migrate the isolated test DB and run integration tests
npm run db:down      # stop local PostgreSQL
```

## API

Public endpoints:

- `GET /health`
- `GET /api/categories`
- `GET /api/tags`
- `GET /api/teams`
- `GET /api/drivers?team=<team-slug>`
- `GET /api/products?page=1&limit=20&locale=en|id&search=&category=&tag=&team=&driver=&size=&color=`
- `GET /api/products/:slug?locale=en|id`
- `POST /api/shipping/rates`
- `POST /api/checkout`
- `GET /api/orders/:id`
- `POST /api/payments/midtrans/notification`

Admin authentication:

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/me`

Send the login token as `Authorization: Bearer <token>` for all remaining admin endpoints:

- `GET|POST /api/admin/categories`
- `PATCH|DELETE /api/admin/categories/:id`
- `GET|POST /api/admin/tags`
- `PATCH|DELETE /api/admin/tags/:id`
- `GET|POST /api/admin/teams`
- `PATCH|DELETE /api/admin/teams/:id`
- `POST|DELETE /api/admin/teams/:id/logo` using multipart field `image`
- `GET|POST /api/admin/drivers`
- `PATCH|DELETE /api/admin/drivers/:id`
- `POST|DELETE /api/admin/drivers/:id/photo` using multipart field `image`
- `GET|POST /api/admin/products`
- `GET|PATCH /api/admin/products/:id`
- `POST /api/admin/products/:productId/variants`
- `PATCH|DELETE /api/admin/products/:productId/variants/:id`
- `POST /api/admin/products/:productId/photos` using multipart fields `photo`, `altText`, optional `color`, and optional `position`
- `PATCH|DELETE /api/admin/products/:productId/photos/:id`

Products are removed from the storefront by setting `status` to `ARCHIVED`; there is intentionally no destructive product-delete endpoint.
Product create and update payloads use `name` and `description` for English copy and accept nullable `nameId` and `descriptionId` for optional Indonesian copy. Public product endpoints default to English; `locale=id` returns Indonesian copy with field-by-field English fallback and does not expose the raw translation fields.
Product create and update payloads accept nullable `teamId` and `driverId`. Assigning a driver requires its current team, while unassigned products remain valid for general merchandise and backwards compatibility. Driver payloads use `{ name, slug, racingNumber, teamId }`, with unique racing numbers from 1 through 99. Driver transfers do not rewrite historical product team assignments.
Team and driver payloads also expose nullable `logoUrl` and `photoUrl`. The idempotent seed uses the official 2026 roster, numbers, and media assets published by Formula 1. R2 uploads store complete `PHOTO_PUBLIC_BASE_URL/<environment>/<object>` URLs in `Team.logoUrl`, `Driver.photoUrl`, and `ProductPhoto.path`; filesystem uploads and legacy rows containing `/uploads/*` URLs or raw product-photo keys remain supported.

### Example login

```sh
curl -X POST http://localhost:3000/api/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"your-password"}'
```

### Product variant shape

```json
{
  "sku": "FER-JER-RED-M",
  "size": "M",
  "color": "Red",
  "stockQuantity": 8,
  "packageLengthMm": 300,
  "packageWidthMm": 220,
  "packageHeightMm": 40,
  "packageWeightG": 450,
  "sizingGuide": {
    "unit": "cm",
    "measurements": { "chest": 52, "length": 72 }
  }
}
```

Prices use integer Indonesian rupiah. Public product responses expose `available` for each variant but do not expose exact stock quantities.

### Biteship shipping estimates

`POST /api/shipping/rates` accepts a five-digit destination postal code and cart lines shaped as `{ variantId, quantity }`. The API resolves price, stock, weight, and package dimensions from the database before requesting live Biteship courier rates, so clients cannot supply shipping measurements.

For local development, set `BITESHIP_API_KEY`, `BITESHIP_ORIGIN_POSTAL_CODE`, and optionally `BITESHIP_COURIERS` in `.env`. The courier list defaults to `jne,jnt,sicepat,anteraja`. For the deployed Worker, keep the API key secret and set the origin independently for each environment:

```sh
npx wrangler secret put BITESHIP_API_KEY
npx wrangler secret put BITESHIP_ORIGIN_POSTAL_CODE
```

Before production traffic, add an edge rate-limit rule for `POST /api/shipping/rates` (default: 10 requests per minute per IP). Biteship Rates requests use paid live data even with a testing key, so automated tests mock Biteship and never make billable calls.

### Checkout payments and fulfillment

Guest checkout uses Midtrans Snap. The backend owns all price and stock calculations, verifies Midtrans notifications, and creates the Biteship shipment only after an accepted `capture` or `settlement`. Configure the local variables shown in `.env.example`; keep `MIDTRANS_SERVER_KEY` and `BITESHIP_API_KEY` as Worker secrets when deployed. Set the Midtrans Payment Notification URL to `https://<api-host>/api/payments/midtrans/notification`.

The storefront loads Snap using `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`. Biteship booking also requires the full pickup contact and address variables; a paid order remains visible as `BOOKING_FAILED` and a replayed Midtrans notification safely retries it.

## Cloudflare Worker deployment

The Express API can run on Cloudflare Workers through `cloudflare:node`. Production PostgreSQL traffic uses the `HYPERDRIVE` binding configured in `wrangler.jsonc`; local Node development continues to use `DATABASE_URL`.

```sh
npm run worker:types
npm run worker:dry-run
npm run worker:deploy
```

Apply Prisma migrations to the production database separately with `npm run db:deploy` before deploying. Product photo upload and `/uploads` serving use the `PHOTO_BUCKET` R2 binding.

### Changing the R2 public domain

Attach the new custom domain before changing application configuration so both origins work during the transition. Set `PHOTO_PUBLIC_BASE_URL` to the new origin for the Worker and admin build, then preview and apply the database rewrite:

```sh
PHOTO_PUBLIC_BASE_URL=https://media.example.com PHOTO_PREVIOUS_PUBLIC_BASE_URL=https://pub-example.r2.dev npm run photos:rewrite-urls
PHOTO_PUBLIC_BASE_URL=https://media.example.com PHOTO_PREVIOUS_PUBLIC_BASE_URL=https://pub-example.r2.dev npm run photos:rewrite-urls -- --apply
```

The command only rewrites managed team, driver, and product-photo values, preserves external image URLs, and is idempotent. Verify that no managed rows use the old origin before disabling it. Cloudflare's `r2.dev` public development URL exposes the entire bucket and is intended only for development; use a custom R2 domain in production.
