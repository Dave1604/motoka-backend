# Ladipo Marketplace — Migration Guide

> Run all migrations **in order** against your Supabase project using the Supabase dashboard SQL editor or the Supabase CLI.
> Each migration is idempotent (uses `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`) so they are safe to re-run.

---

## Prerequisites

Make sure the following environment variables are set in your backend `.env`:

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Paystack (for Ladipo checkout & webhook)
PAYSTACK_SECRET_KEY=
PAYSTACK_WEBHOOK_SECRET=

# Resend (for Ladipo order emails)
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Frontend base URL (used in email links)
FRONTEND_BASE_URL=https://your-frontend-domain.com

# Supabase storage bucket for Ladipo product images
LADIPO_IMAGES_BUCKET=ladipo-product-images
```

> Create a **public** Supabase Storage bucket named `ladipo-product-images` (or whatever you set for `LADIPO_IMAGES_BUCKET`).
> Allow public reads; uploads are restricted to `service_role` via the backend.

---

## Migration files

All SQL files live in `supabase/migrations/`. Run them in the order listed below.

---

### 050 — Core Ladipo Marketplace tables

**File:** `supabase/migrations/050_ladipo_marketplace.sql`

**What it creates:**

| Object | Type | Description |
|---|---|---|
| `ladipo_categories` | Table | Hierarchical product categories (supports parent/child via `parent_id`) |
| `ladipo_parts` | Table | Product catalog with JSONB images, specs, and features |
| `ladipo_part_inventory` | Table | Price and stock for each part (seller model for Phase 1) |
| `ladipo_orders` | Table | Customer orders linked to `auth.users` |
| `ladipo_condition` | ENUM | `new`, `tokunbo`, `nigerian_used` |
| `ladipo_part_type` | ENUM | `oem`, `oes`, `aftermarket` |
| `ladipo_payment_status` | ENUM | `pending_payment`, `paid`, `failed` |
| `ladipo_order_status` | ENUM | `pending_payment`, `processing`, `shipped`, `delivered`, `cancelled` |
| `decrement_ladipo_stock` | RPC function | Safely decrements inventory stock on successful payment |
| RLS Policies | Policies | Public browse for categories/parts/inventory; users see own orders only |
| Seed data | Rows | 3 initial categories + 6 placeholder parts + inventory rows |

---

### 051 — Real product images

**File:** `supabase/migrations/051_ladipo_real_images.sql`

Updates the 6 seed parts from migration 050 with real product images sourced from
Unsplash and Pexels (both free for commercial use, no attribution required).

No schema changes — data update only.

---

### 052 — Autofactor catalog reseed ⚠️

**File:** `supabase/migrations/052_ladipo_autofactor_reseed.sql`

> **WARNING:** This migration deletes all existing `ladipo_categories`, `ladipo_parts`,
> and `ladipo_part_inventory` rows before reseeding. It does **not** touch `ladipo_orders`.
> Safe to run on a fresh database. If you have live orders that reference existing parts,
> review before running.

Replaces the placeholder catalog from 050/051 with a tighter Autofactor-derived catalog:

- **3 top-level categories:** Spare Parts, Servicing Parts, Lubricants / Fluids
- **4 sub-categories:** Brake & Wheel Hub/Bearings, Suspension Parts, Oil Filter, Engine Oil
- Products with real image URLs

---

### 053 — More products

**File:** `supabase/migrations/053_ladipo_more_products.sql`

Extends the catalog from 052 with additional SKUs across existing categories, for more
comprehensive browse, cart, and checkout testing.

No schema changes — data insert only.

---

### 054 — Persistent cart items

**File:** `supabase/migrations/054_ladipo_cart_items.sql`

**What it creates:**

| Object | Type | Description |
|---|---|---|
| `ladipo_cart_items` | Table | Stores cart items per authenticated user |
| Unique index | Index | One row per `(user_id, product_id)` pair |
| RLS Policies | Policies | Users can only read/write their own cart rows |

Cart items are synced to the database so a user's cart persists across devices.

---

### 055 — Order handler column + indexes

**File:** `supabase/migrations/055_ladipo_order_handler_and_indexes.sql`

**What it adds:**

| Object | Type | Description |
|---|---|---|
| `handled_by_name` | Column on `ladipo_orders` | Name of the admin who last handled the order |
| Index on `handled_by_name` | Index | Filter orders by handler in admin list |
| Index on `ladipo_orders(created_at DESC)` | Index | Stable pagination in admin order list |
| Index on `ladipo_parts(created_at DESC)` | Index | Stable pagination in admin product list |

---

### 056 — Admin workflow columns

**File:** `supabase/migrations/056_ladipo_orders_admin_ops.sql`

Adds columns required for the admin order management workflow (claim, take over, release, block).

**What it adds to `ladipo_orders`:**

| Column | Type | Description |
|---|---|---|
| `handled_by_key` | TEXT | Unique key identifying the admin who owns the order |
| `assigned_at` | TIMESTAMPTZ | When the order was last assigned to an admin |
| `assigned_by_name` | VARCHAR(120) | Display name of the assigning admin |
| `released_at` | TIMESTAMPTZ | When the order was last released |
| `workflow_state` | VARCHAR(20) | `active` or `blocked` (default: `active`) |
| `block_reason` | TEXT | Reason text when an order is blocked |
| `admin_ops_version` | INT | Optimistic concurrency counter (increments on each admin op) |

Also adds a `CHECK` constraint to enforce valid `workflow_state` values and an index on
`(handled_by_key, assigned_at DESC)` for efficient handler-based filtering.

---

## Running the migrations

### Option A — Supabase Dashboard (recommended for first run)

1. Open your Supabase project → **SQL Editor**
2. Open each file in order, paste the content, and click **Run**
3. Confirm success in the **Table Editor** — you should see the `ladipo_*` tables listed

### Option B — Supabase CLI

```bash
# Link your project first (one time)
supabase link --project-ref <your-project-ref>

# Then push all pending migrations
supabase db push
```

> The CLI applies migrations in filename order, so the `050_` → `056_` ordering is respected automatically.

---

## Verification checklist

After running all migrations, confirm the following in the Supabase dashboard:

- [ ] Tables exist: `ladipo_categories`, `ladipo_parts`, `ladipo_part_inventory`, `ladipo_orders`, `ladipo_cart_items`
- [ ] `ladipo_categories` has rows (3 top-level + sub-categories)
- [ ] `ladipo_parts` has rows with real image URLs
- [ ] `ladipo_part_inventory` has stock and price rows
- [ ] `ladipo_orders` has the admin workflow columns: `handled_by_key`, `workflow_state`, `admin_ops_version`
- [ ] RLS is enabled on all `ladipo_*` tables
- [ ] Storage bucket `ladipo-product-images` exists and is **public**
- [ ] `decrement_ladipo_stock` RPC function exists under **Database → Functions**

---

## Notes for the team

- All prices are stored in **kobo** (1 Naira = 100 kobo). The frontend and backend both convert for display.
- The `decrement_ladipo_stock` function uses `SECURITY DEFINER` to bypass RLS — it is only called server-side from the webhook controller after a confirmed Paystack payment.
- Cart items are **soft-synced**: the frontend maintains a Zustand cart store; items are persisted to `ladipo_cart_items` on changes. On app load the DB cart is the source of truth.
- The `admin_ops_version` column enables optimistic concurrency — the admin UI sends the current version with each claim/release/block action; the backend rejects stale writes.
