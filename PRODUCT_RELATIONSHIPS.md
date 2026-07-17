# Product Relationships Plan — Backend

## Scope

This plan covers only catalog relationships that affect collection browsing, product filtering, and product option selection. It does not cover checkout, payments, accounts, promotions, reviews, shipping rules, or editorial content.

## Vantage97 reference model (observed 2026-07-17)

- Navigation groups collections under Formula 1, Motorsport, WEC, Accessories, Bikes, and Drivers.
- Individual teams, drivers, merchandise families, and promotions have collection pages.
- Collection facets are **Team**, **Driver**, **Product type**, **Gender**, **Availability**, and **Price**.
- Team is backed by a single product vendor, while Driver is backed by tags and can therefore be multi-valued.
- Apparel products expose **Size** variants.
- Caps can have no selectable option.
- Three McLaren logo caps with the same display name were separate products with distinct URLs, images, and SKUs and no Color selector. For parity, colorways should default to separate products rather than variants.

## Current backend

The useful foundations already exist in `prisma/schema.prisma`:

- `Product -> Category` is required and one-to-many.
- `Product -> Team` and `Product -> Driver` are optional but single-valued.
- `Product <-> Tag` is many-to-many.
- `Product -> ProductVariant` and `Product -> ProductPhoto` are one-to-many.
- Public product filtering already accepts category, tag, team, driver, size, and color.

The gaps are:

1. There is no first-class `Collection` or collection hierarchy.
2. A product can reference only one driver.
3. `ProductService.validateProductTeamDriver` forces a product's driver to be on its team today. This is incorrect for historic merchandise, driver transfers, and multi-driver products.
4. `Driver.teamId` is mandatory, so retired, reserve, unaffiliated, and historical drivers cannot be represented cleanly.
5. There is no audience/gender relationship.
6. Category is technically usable as Product type, but its meaning and API name are inconsistent.
7. `ProductVariant.size`, `color`, and `sizingGuide` are all mandatory. This cannot naturally represent a cap or collectible with a single default SKU and no selectable option.
8. Availability and price are not accepted as public filters; collection-specific facets and counts are not returned.
9. Filters accept one value per facet, while the reference UI is multi-select.
10. The public response exposes no collection membership and only a single driver.

## Target relationship model

Use the following as the cross-repository contract.

### Product type

Keep the existing `Category` table initially, but define it as exactly one **Product type** per product (Headwear, T-Shirts, Jackets, LEGO, Model Cars, and so on). Rename API/UI language to `productType`; a physical table rename is optional and should not block the relationship work.

### Primary team

Keep `Product.teamId` optional and single-valued. It represents the primary team/vendor and powers the Team facet. Do not use generic tags as teams.

### Drivers

Replace `Product.driverId` with a join table:

```prisma
model ProductDriver {
  productId String  @db.Uuid
  driverId  String  @db.Uuid
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  driver    Driver  @relation(fields: [driverId], references: [id], onDelete: Restrict)

  @@id([productId, driverId])
  @@index([driverId])
}
```

`Driver.teamId` becomes nullable and means current team only. Product-driver assignment must not be validated against the driver's current team.

### Audience

Add a normalized `Audience` enum on Product:

```prisma
enum ProductAudience {
  MEN
  WOMEN
  KIDS
  UNISEX
}
```

Make it nullable during migration and required for new active products once data is backfilled. The customer UI may label the facet “Gender & audience” so Kids is not misrepresented as a gender.

### Collections

Add a first-class, hierarchical, many-to-many collection model:

```prisma
enum CollectionKind {
  DOMAIN
  TEAM
  DRIVER
  MERCHANDISE
  BRAND
  PROMOTION
  MANUAL
}

model Collection {
  id          String              @id @default(uuid()) @db.Uuid
  name        String
  slug        String              @unique
  kind        CollectionKind
  parentId    String?             @db.Uuid
  parent      Collection?         @relation("CollectionTree", fields: [parentId], references: [id], onDelete: Restrict)
  children    Collection[]        @relation("CollectionTree")
  imageUrl    String?
  description String              @default("")
  position    Int                 @default(0)
  active      Boolean             @default(true)
  products    ProductCollection[]
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  @@index([parentId, position])
  @@index([kind, active])
}

model ProductCollection {
  productId   String     @db.Uuid
  collectionId String   @db.Uuid
  product     Product    @relation(fields: [productId], references: [id], onDelete: Cascade)
  collection  Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  position    Int?
  featured    Boolean    @default(false)

  @@id([productId, collectionId])
  @@index([collectionId, position])
}
```

Membership is explicit in phase one. Automated collection rules are intentionally out of scope; do not add a rules engine yet.

### Variants

Keep SKU, stock, and package measurements on `ProductVariant`, but change `size`, `color`, and `sizingGuide` to nullable. A product must have at least one purchasable variant, even when that is a hidden/default “one size” SKU.

- Size is the only selectable option required for Vantage97 parity.
- Color can remain in the schema for existing data, but new colorways should normally be separate products.
- Do not build a generic option-definition engine until a real third option is required.
- `ProductPhoto.color` remains backward-compatible, but new separate-colorway products should use unscoped photos.

### Tags

Keep tags many-to-many for non-structural labels such as Limited Edition, New Arrival, or event/campaign flags. Do not use tags as substitutes for Team, Driver, Product type, Audience, or Collection.

## API work

### Admin contracts

Update product create/patch payloads to use:

```ts
{
  categoryId: string;       // Product type
  teamId?: string | null;   // one primary team
  driverIds: string[];      // zero to many
  collectionIds: string[];  // zero to many while draft
  audience?: "MEN" | "WOMEN" | "KIDS" | "UNISEX" | null;
  tagIds: string[];
}
```

Return `drivers: Driver[]` and `collections: Collection[]`. Remove singular `driver`/`driverId` after a compatibility window.

Add authenticated collection CRUD and membership endpoints. Prefer product updates as the canonical way to change a single product's memberships; a collection endpoint may support bulk membership changes for the collection editor.

### Public contracts

Add:

- `GET /api/collections` for the active collection tree.
- `GET /api/collections/:slug` for collection metadata.
- `GET /api/collections/:slug/products` for collection-scoped products and facets.

Support these collection product query parameters:

- `team` (multi-value)
- `driver` (multi-value)
- `productType` (multi-value; map to current Category)
- `audience` (multi-value)
- `availability=in_stock`
- `minPrice` and `maxPrice`
- `search`
- `sort=featured|relevance|name_asc|name_desc|price_asc|price_desc|newest|oldest`
- `page` and `limit`

Use OR within one facet and AND between different facets. Normalize repeated query parameters or comma-separated values in the controller, then pass arrays to the repository.

Vantage97 also displays Best selling. Do not claim to support that order until a real sales metric is available; order aggregation is outside this product-relationship phase. Relevance should only be offered when search text is present.

Return facet metadata with result counts calculated inside the selected collection:

```ts
{
  collection: CollectionSummary;
  data: PublicProduct[];
  page: number;
  limit: number;
  total: number;
  facets: {
    teams: Array<{ slug: string; name: string; count: number }>;
    drivers: Array<{ slug: string; name: string; count: number }>;
    productTypes: Array<{ slug: string; name: string; count: number }>;
    audiences: Array<{ value: ProductAudience; count: number }>;
    availability: { inStock: number };
    price: { min: number; max: number };
  };
}
```

Public products must return `team`, `drivers`, `productType` (or a temporary `category` alias), `audience`, `collections`, variants with `available`, and photos.

## Migration order

1. Add `ProductAudience`, `Collection`, `ProductCollection`, and `ProductDriver`; make driver team and variant option fields nullable.
2. Backfill `ProductDriver` from every non-null `Product.driverId`.
3. Backfill Audience where it can be determined; leave ambiguous drafts null.
4. Seed initial domain/team/driver/merchandise collections and assign known products.
5. Deploy dual-read responses containing both singular `driver` and plural `drivers`.
6. Migrate admin and customer repositories to plural drivers and collection IDs.
7. Stop writing `Product.driverId`, then remove its foreign key, index, and column.
8. Keep existing Category storage unless a separate physical rename is approved.

The migration must preserve existing products, variants, photos, tags, team references, and URLs.

## Repository tasks

- [x] Update `prisma/schema.prisma` with the target relations and indexes.
- [x] Add a forward-only Prisma migration with data backfills.
- [x] Regenerate both Prisma clients.
- [x] Replace `driverId` schemas with `driverIds`; add `collectionIds` and `audience`.
- [x] Make variant size/color/sizing guide validation conditional.
- [x] Remove current-team matching from `ProductService`.
- [x] Validate all referenced team, driver, collection, category, and tag IDs transactionally.
- [x] Update admin repositories to write join tables without partial updates on failure.
- [x] Add collection admin repository/service/controller/routes.
- [x] Update public repository includes and response mappers.
- [x] Add collection-scoped, multi-select filtering and sorting.
- [x] Add facet count queries; avoid N+1 queries.
- [x] Add collection tree and detail public endpoints.
- [x] Keep the current `/api/products` endpoint during migration, but make its filter semantics consistent.
- [x] Update seeds with collections, audience, and multi-driver examples.
- [x] Update API tests and database cleanup for all new join tables.

## Required tests

- A product can relate to zero, one, or multiple drivers.
- A driver product does not need a primary team.
- A driver transfer does not change or invalidate existing product relationships.
- A historical driver with no current team remains filterable.
- A product can belong to multiple nested collections.
- Deleting a referenced driver/team/collection fails or cascades exactly as defined above.
- Multi-select uses OR within Team/Driver/Product type/Audience and AND across facets.
- Collection facet counts change correctly when another facet is selected.
- Availability means at least one variant has `stockQuantity > 0`.
- Minimum and maximum price are inclusive.
- A one-SKU cap can have null size/color/sizing guide.
- Sized apparel can expose S–3XL without a Color selector.
- Public payloads never expose exact stock quantity.
- Existing tag, photo, and SKU uniqueness behavior remains intact.

## Backend definition of done

- The admin can persist the complete target relationship payload atomically.
- The customer app can render a Vantage97-style collection page from one collection-products response plus the collection tree.
- Team, Driver, Product type, Audience, Availability, and Price facets are data-backed and counted.
- Product detail supports sized apparel and optionless/default-SKU products without fake values.
- No product relationship depends on a driver's current team.
