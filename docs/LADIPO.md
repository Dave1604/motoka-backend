# Ladipo Marketplace — Technical Reference

Ladipo is Motoka's integrated vehicle-parts marketplace. Users browse spare parts, add them
to a persistent cart, check out via Paystack, and receive an order-confirmation email.
Admins manage the product catalog and order fulfilment workflow from a dedicated dashboard.
Mo AI connects to Ladipo in real time, recommending actual products when a user describes a
car problem or part need.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Environment variables](#environment-variables)
3. [Database migrations](#database-migrations)
4. [API reference — public & user](#api-reference--public--user)
5. [API reference — admin](#api-reference--admin)
6. [Mo × Ladipo integration](#mo--ladipo-integration)
7. [Image upload (Cloudinary)](#image-upload-cloudinary)
8. [Security highlights](#security-highlights)
9. [Performance notes](#performance-notes)
10. [Local development](#local-development)

---

## Architecture overview

```
Frontend (React + Vite :5173)
  └─ ladipoStore (Zustand)        ← cart state, synced to DB on every change
  └─ LadipoPage                   ← browse / search / cart / checkout
  └─ Mo.jsx                       ← renders LadipoPartCard when Mo suggests parts

Backend (Express :3000)
  └─ /api/ladipo/*                ← public browse + auth cart/orders
  └─ /api/admin/ladipo/*          ← admin CRUD + order workflow
  └─ /api/mo/chat                 ← returns ladipoSuggestions when relevant

Supabase (PostgreSQL + RLS)
  └─ ladipo_categories
  └─ ladipo_parts
  └─ ladipo_part_inventory
  └─ ladipo_cart_items
  └─ ladipo_orders
  └─ ladipo_vehicle_compatibility

Cloudinary                        ← admin image upload (CDN-backed, https only)
Paystack                          ← payment initiation + webhook for stock decrement
```

---

## Environment variables

Add these to your `.env` (they are already set in local dev):

```env
# Cloudinary (admin product image upload)
CLOUDINARY_CLOUD_NAME=dheeu3dmf
CLOUDINARY_API_KEY=317331967575933
CLOUDINARY_API_SECRET=<secret>

# Supabase Storage bucket for product images
LADIPO_IMAGES_BUCKET=ladipo-product-images

# Frontend (used in order-confirmation email links)
FRONTEND_BASE_URL=http://localhost:5173
```

All other required vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`,
`PAYSTACK_WEBHOOK_SECRET`, `RESEND_API_KEY`) are shared with the rest of Motoka.

---

## Database migrations

Migrations live in `supabase/migrations/` and were applied via `supabase db push`.
Run them in order on any fresh environment:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

| File | What it does |
|---|---|
| `054_ladipo_marketplace.sql` | Core tables, ENUMs, RLS policies, `decrement_ladipo_stock` RPC, seed categories/parts |
| `055_ladipo_real_images.sql` | Replaces placeholder images with real product photos |
| `056_ladipo_autofactor_reseed.sql` | Full catalog reseed — Spare Parts, Servicing Parts, Lubricants sub-categories |
| `057_ladipo_more_products.sql` | Additional SKUs for richer browse/search/checkout testing |
| `058_ladipo_cart_items.sql` | `ladipo_cart_items` table — persistent per-user cart synced across devices |
| `059_ladipo_order_handler_and_indexes.sql` | `handled_by_name` column + stable-pagination indexes |
| `060_ladipo_orders_admin_ops.sql` | Admin workflow columns (`handled_by_key`, `workflow_state`, `admin_ops_version`, etc.) + optimistic-concurrency `CHECK` |
| `061_ladipo_vehicle_compatibility.sql` | `ladipo_vehicle_compatibility` table — links parts to make/model/year for filtered browse |
| `062_performance_indexes.sql` | Partial indexes on hot query paths (pending payments, orders by user, Paystack reference) |

### Key database objects

| Object | Type | Notes |
|---|---|---|
| `ladipo_condition` | ENUM | `new`, `tokunbo`, `nigerian_used` |
| `ladipo_part_type` | ENUM | `oem`, `oes`, `aftermarket` |
| `ladipo_payment_status` | ENUM | `pending_payment`, `paid`, `failed` |
| `ladipo_order_status` | ENUM | `pending_payment`, `processing`, `shipped`, `delivered`, `cancelled` |
| `decrement_ladipo_stock` | RPC function | `SECURITY DEFINER`, called only from the webhook handler after confirmed Paystack payment |
| `admin_ops_version` | INT column on `ladipo_orders` | Optimistic concurrency — backend rejects writes where caller's version ≠ current |

All `ladipo_*` tables have RLS enabled:
- Public: read-only access to categories, parts, inventory
- Authenticated users: read/write their own cart rows and orders
- Admin: full access via service-role key (bypasses RLS in backend)

---

## API reference — public & user

Base path: `/api/ladipo`

### Browse (public — no auth required)

#### `GET /api/ladipo/categories`
Returns the category tree (top-level + sub-categories).

```json
{ "success": true, "data": [{ "id": "...", "name": "Spare Parts", "slug": "spare-parts", "children": [...] }] }
```

> Cached in-process for 5 minutes.

#### `GET /api/ladipo/parts`

Query parameters:

| Param | Type | Description |
|---|---|---|
| `q` | string (max 200) | Full-text search (name, brand, description) |
| `category_slug` | string (max 120) | Filter by category slug |
| `make` | string (max 100) | Filter by vehicle make |
| `model` | string (max 100) | Filter by vehicle model |
| `year` | integer | Filter by vehicle year |
| `condition` | string | `new`, `tokunbo`, or `nigerian_used` |
| `part_type` | string | `oem`, `oes`, or `aftermarket` |
| `min_price` | integer | Minimum price in kobo |
| `max_price` | integer | Maximum price in kobo |
| `in_stock` | boolean | Only return parts with stock > 0 |
| `page` | integer | Page number (default 1) |
| `limit` | integer | Results per page (max 50, default 20) |

```json
{ "success": true, "data": { "parts": [...], "total": 20, "page": 1, "limit": 20, "totalPages": 1 } }
```

#### `GET /api/ladipo/parts/:slug`
Returns a single part by slug including full details, images, specs, and inventory.

Slug validation: must match `/^[\w-]+$/` — path traversal attempts (`../../etc/passwd`) return 400.

---

### Cart (requires auth: `Authorization: Bearer <JWT>`)

#### `GET /api/ladipo/cart`
Returns the authenticated user's cart items.

#### `POST /api/ladipo/cart`
Add or update a cart item.

```json
{ "product_id": "uuid", "quantity": 2 }
```

#### `PUT /api/ladipo/cart/:itemId`
Update quantity of a cart item.

```json
{ "quantity": 3 }
```

#### `DELETE /api/ladipo/cart/:itemId`
Remove a single item from the cart.

#### `DELETE /api/ladipo/cart`
Clear the entire cart.

---

### Orders (requires auth)

#### `POST /api/ladipo/orders`
Initiate a new order. Validates stock availability, calculates total, and creates a Paystack payment link.

```json
{ "items": [{ "product_id": "uuid", "quantity": 1 }], "delivery_address": "5 Allen Ave, Lagos" }
```

Response includes `authorization_url` — redirect user there to complete payment.

#### `GET /api/ladipo/orders`
List the authenticated user's orders.

#### `GET /api/ladipo/orders/:orderId`
Get a single order's full details.

#### `GET /api/ladipo/orders/:orderId/verify`
Verify payment status for an order (polls Paystack then updates DB).

---

## API reference — admin

Base path: `/api/admin/ladipo`  
All admin endpoints require: `Authorization: Bearer <ADMIN_JWT>`

### Products

| Method | Path | Description |
|---|---|---|
| `GET` | `/products` | List all products (active + inactive). Supports `?search=`, `?status=`, `?category=`, `?page=`, `?limit=` |
| `POST` | `/products` | Create a new product. Body: full part object (see validation below) |
| `PUT` | `/products/:id` | Update a product |
| `DELETE` | `/products/:id` | Soft-delete (sets `is_active = false`) |
| `POST` | `/products/image-upload` | Upload a product image to Cloudinary. Returns `{ url }` for use in the product form |

**Product validation:**
- `name`: required, max 255 chars
- `slug`: required, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 200 chars
- `price_kobo`: required, integer 1 – 1,000,000,000 (₦10M cap)
- `stock_qty`: required, integer 0 – 1,000,000
- `brand`: max 100 chars
- `description`: max 4,000 chars
- `images`: array of HTTPS URLs only (HTTP rejected)

### Categories

| Method | Path | Description |
|---|---|---|
| `GET` | `/categories` | List all categories including inactive |
| `POST` | `/categories` | Create category |
| `PUT` | `/categories/:id` | Update category |
| `DELETE` | `/categories/:id` | Delete category (only if no active products reference it) |

### Orders

| Method | Path | Description |
|---|---|---|
| `GET` | `/orders` | List all orders. Supports `?status=`, `?workflow_state=`, `?handler_key=`, `?page=`, `?limit=` |
| `GET` | `/orders/:orderId` | Get a single order with full item details |
| `POST` | `/orders/:orderId/claim` | Assign order to calling admin (optimistic lock — requires `admin_ops_version`) |
| `POST` | `/orders/:orderId/release` | Release an order back to unassigned |
| `POST` | `/orders/:orderId/block` | Block an order with a reason |
| `POST` | `/orders/:orderId/status` | Update order status (`processing`, `shipped`, `delivered`, `cancelled`) |

**Optimistic concurrency:** every mutating admin order action requires `{ "admin_ops_version": N }` in the
body where `N` is the version you last read. The backend increments the counter and rejects stale
writes with `409 Conflict`. This prevents two admins silently overwriting each other.

---

## Mo × Ladipo integration

When Mo AI receives a message about car parts, repairs, or maintenance costs, it emits a
structured tag in its response:

```
[LADIPO_SEARCH:{"q":"brake pads","make":"Toyota","model":"Camry","year":2018}]
```

The backend (`mo.controller.js`) intercepts this tag before sending the response to the client:

1. Strips the tag from the reply text
2. Calls `getParts()` from `ladipo.service.js` with the extracted parameters
3. Returns the top 4 matching parts as `ladipoSuggestions` in the JSON response

```json
{
  "success": true,
  "reply": "For your Toyota Camry, you'll need ...",
  "action": null,
  "ladipoSuggestions": [
    {
      "id": "uuid",
      "slug": "toyota-camry-brake-pads-2018",
      "name": "Brake Pads — Toyota Camry",
      "brand": "Bosch",
      "image": "https://res.cloudinary.com/...",
      "price_kobo": 3500000,
      "condition": "new"
    }
  ]
}
```

The `Mo.jsx` component renders `LadipoPartCard` tiles beneath Mo's message bubble for each
suggestion. Clicking a card deep-links the user to `/ladipo?q=PART_NAME`, which pre-populates
the search on the Ladipo page.

---

## Image upload (Cloudinary)

Admin product images are uploaded to Cloudinary via `POST /api/admin/ladipo/products/image-upload`.

- The backend uses `cloudinary.uploader.upload()` via a base64 data-URI or a file stream
- Images are stored in the `ladipo-parts/` Cloudinary folder
- The endpoint returns `{ "url": "https://res.cloudinary.com/dheeu3dmf/..." }`
- That URL is then stored in the `images` JSONB array on `ladipo_parts`
- All stored URLs are validated to be `https:` protocol before save

Credentials are stored in `.env` and loaded via the `cloudinary` npm package at startup.

---

## Security highlights

| Concern | Mitigation |
|---|---|
| Unauthenticated cart/order access | `requireAuth` middleware on all cart and order routes |
| Unauthenticated admin access | `requireAdminAuth` + role check on all `/api/admin/ladipo/*` routes |
| PostgREST filter injection | `q` search term stripped of `'"(),;` before being used in `ilike` filters |
| Path traversal via `:slug` | Slug validated against `/^[\w-]+$/` — rejects `../`, `%2f`, etc. |
| Oversized inputs | `q` capped at 200 chars, `category_slug` at 120, `make`/`model` at 100, search params at 200 |
| Uncapped prices/stock | `price_kobo > 1,000,000,000` and `stock_qty > 1,000,000` rejected |
| Non-HTTPS image URLs | All `images[]` entries validated — HTTP and non-URL strings filtered out |
| Admin race conditions | `admin_ops_version` optimistic concurrency on all claim/release/block/status mutations |
| Rate limiting | Cart: 50 req/5 min per IP; checkout: 10 req/15 min per IP |
| Idempotency | Admin mutations use idempotency keys (in-memory, 24h TTL, 5000-entry cap) |

---

## Performance notes

| Optimization | Effect |
|---|---|
| Category cache (5 min, in-process) | Category tree fetched once; subsequent requests are free |
| Renewal items cache (60 s) | Eliminates duplicate DB round-trip from Monicredit adapter during license renewal |
| Atomic stale-tx cleanup | Payment init collapses 2 DB round-trips into 1 UPDATE…RETURNING |
| Vehicle compatibility filter in DB | `make`/`model`/`year` pushed into the Supabase query; compatible IDs + universal parts fetched in parallel via `Promise.all()` |
| Partial indexes (migration 062) | `WHERE status = 'pending'` indexes for hot payment-status queries; `WHERE paystack_reference IS NOT NULL` for webhook lookups |
| Pagination on all list endpoints | Default 20, max 50; total count returned for cursor display |

---

## Local development

```bash
# 1. Install dependencies (if not already done)
npm install

# 2. Start the backend
npm run dev          # runs on http://localhost:3000

# 3. Start the frontend (separate terminal)
cd ../motoka-frontend
npm run dev          # runs on http://localhost:5173
```

### Test the Ladipo API without auth

```bash
# Browse categories
curl http://localhost:3000/api/ladipo/categories

# Browse parts
curl "http://localhost:3000/api/ladipo/parts?limit=5"

# Search
curl "http://localhost:3000/api/ladipo/parts?q=brake"

# Filter by vehicle
curl "http://localhost:3000/api/ladipo/parts?make=Toyota&model=Camry"

# Single part
curl "http://localhost:3000/api/ladipo/parts/toyota-camry-brake-pads"
```

### Run the test suite

```bash
npm test
```

117 tests pass. 22 pre-existing failures exist in unrelated files (`payment.routes`,
`expiryStatus` message text mismatches, `logInfo` mock) — none relate to Ladipo.

---

## Prices

All prices are stored and transmitted as **kobo** (1 Naira = 100 kobo).
Convert for display: `₦${(price_kobo / 100).toLocaleString()}`.

The `formatNaira(kobo)` helper in `Mo.jsx` and `LadipoPartCard` handles this automatically.
