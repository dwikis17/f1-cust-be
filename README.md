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

The API starts at `http://localhost:3000`. PostgreSQL is available only on `127.0.0.1:5432`. Local Worker development writes product photos to the remote `f1-bucket` R2 bucket under `development/`, so Wrangler must be logged in; deployed Workers use `production/`. Run `npm run dev:node` only when you explicitly want filesystem uploads under `uploads/`.

Useful commands:

```sh
npm run db:studio    # inspect local data
npm run db:seed      # upsert the official 2026 F1 teams and drivers
npm run db:deploy    # apply committed migrations
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
- `GET /api/products?page=1&limit=20&search=&category=&tag=&team=&driver=&size=&color=`
- `GET /api/products/:slug`

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
Product create and update payloads accept nullable `teamId` and `driverId`. Assigning a driver requires its current team, while unassigned products remain valid for general merchandise and backwards compatibility. Driver payloads use `{ name, slug, racingNumber, teamId }`, with unique racing numbers from 1 through 99. Driver transfers do not rewrite historical product team assignments.
Team and driver payloads also expose nullable `logoUrl` and `photoUrl`. The idempotent seed uses the official 2026 roster, numbers, and media assets published by Formula 1. New product photo uploads store their complete Worker-served `/uploads/*` URL in `ProductPhoto.path`; existing rows containing raw object keys remain supported.

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

## Cloudflare Worker deployment

The Express API can run on Cloudflare Workers through `cloudflare:node`. Production PostgreSQL traffic uses the `HYPERDRIVE` binding configured in `wrangler.jsonc`; local Node development continues to use `DATABASE_URL`.

```sh
npm run worker:types
npm run worker:dry-run
npm run worker:deploy
```

Apply Prisma migrations to the production database separately with `npm run db:deploy` before deploying. Product photo upload and `/uploads` serving use the `PHOTO_BUCKET` R2 binding.
