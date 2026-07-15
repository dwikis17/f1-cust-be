# F1 Merchandise API

Express, TypeScript, Prisma, and PostgreSQL backend for a public F1 merchandise catalog and its admin tools.

## Local setup

Requirements: Node.js 24+, npm, and Docker.

```sh
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run admin:create
npm run dev
```

For non-interactive local setup or automation, provide `ADMIN_EMAIL`, `ADMIN_DISPLAY_NAME`, and `ADMIN_PASSWORD` when running `npm run admin:create`.

The API starts at `http://localhost:3000`. PostgreSQL is available only on `127.0.0.1:5432`. Uploaded images are stored under `uploads/` and served from `/uploads/<filename>`.

Useful commands:

```sh
npm run db:studio    # inspect local data
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
- `GET /api/products?page=1&limit=20&search=&category=&tag=&size=&color=`
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
- `GET|POST /api/admin/products`
- `GET|PATCH /api/admin/products/:id`
- `POST /api/admin/products/:productId/variants`
- `PATCH|DELETE /api/admin/products/:productId/variants/:id`
- `POST /api/admin/products/:productId/photos` using multipart fields `photo`, `altText`, optional `color`, and optional `position`
- `PATCH|DELETE /api/admin/products/:productId/photos/:id`

Products are removed from the storefront by setting `status` to `ARCHIVED`; there is intentionally no destructive product-delete endpoint.

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
