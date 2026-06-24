---
name: b2c-catalog-onboarding
description: Onboard a product catalog into a Salesforce B2C Commerce sandbox without Business Manager UI gymnastics. Acquires product data (from a client site or a CSV/ZIP), then drives the b2c-catalog-onboarding-bff to validate → preview → repackage as a site-archive → WebDAV PUT → trigger sfcc-site-archive-import → SearchReindex, so the storefront picks up products in seconds. Use when the user says "build a catalog for <client>", "upload products to the sandbox", "load a B2C catalog", "import a catalog into <site>", or as steps 9–11 of the demo-b2c-commerce master flow. Pricing is best-effort (bulk via archive; see BLOCKERS.md).
---

# B2C Catalog Onboarding

This skill gets a product catalog — with images, inventory and pricing — into a
B2C Commerce sandbox so a Storefront Next demo shows a real assortment instead
of leftover sample data. It wraps the **`b2c-catalog-onboarding-bff`**
(`packages/b2c-catalog-onboarding-bff`), a small Hono service that runs the
import pipeline and exposes an admin UI + live API trace (great for client
demos).

It maps to **steps 9, 10, 11** of the `demo-b2c-commerce` master flow:

| Step | What | This skill |
|------|------|------------|
| 9  | Build the catalog (acquire data → normalized CSV/ZIP) | acquire + shape |
| 10 | Upload to the sandbox (⚠ irreversible) | drive the BFF pipeline |
| 11 | Reindex (+ the master flow then pushes to MRT) | trigger SearchReindex |

---

## Two responsibilities, one pipeline

**Acquisition (step 9) vs ingestion (steps 10–11) are separate jobs.** Keep them
separate — never build a second upload path.

- **Acquisition** = where products come from. Either:
  - the user supplies a **CSV/ZIP** already, or
  - you scrape the client site with the **`sfn-toolkit` catalog scripts**
    (`packages/sfn-demo-toolkit/catalog/`: `extract-products.py`,
    `download-images.py`, `enrich-products.py`). The output you want is a
    **flat CSV** (and optionally downloaded images), NOT a finished archive —
    the BFF builds the archive.
- **Ingestion** = how products get into the sandbox. Always the BFF:
  validate → preview → repackage site-archive → WebDAV → import job → reindex.

> Do **not** use the toolkit's `generate-archive.py` in this flow — it's
> redundant with the BFF's repackager. The BFF owns archive construction.

---

## The flat CSV contract

The BFF accepts a flat CSV (header row required). Columns:

```
id, name, price, category                              (required)
currency, stock, brand, short_description,
long_description, image_url, category_name             (optional)
```

- `category` supports multiple ids pipe-separated: `demo-category|featured`.
- `category_name` labels every category-id in that row.
- `image_url` is an external URL the BFF downloads and ingests.
- Missing `stock` falls back to `DEFAULT_INVENTORY_UNITS` (env, default 10).
- `brand` / `manufacturer-name` pass through untouched (used for refinement).

Grab a starter template any time: `GET /api/csv-template`.

---

## Prerequisites (verify before step 10)

> **Read this first — three catalog IDs in play, easy to confuse.**
> When the master flow reaches this skill, the site is already rendering thanks
> to a **placeholder Storefront Catalog** that the user assigned in step 2 (e.g.
> a sample `storefront-catalog-*` that ships with the realm). That placeholder
> is **not** the upload target. The whole point of step 10 is to **create a new
> brand-specific catalog from scratch**, import the scraped products into it,
> and then **swap the site's bindings** away from the placeholder to the new
> catalog. Do not reuse the placeholder id as `STOREFRONT_CATALOG_ID`.
>
> **Before configuring the BFF, ask the user which path they want:**
> - **(default) Create a new catalog** — pick a brand-named id like
>   `<brand>-catalog` (e.g. `camper-catalog`). The import job materializes it
>   on first commit; no need to pre-create in BM.
> - **Upload into an existing catalog** — only when the user explicitly wants
>   to keep an existing catalog id (rare in this flow; usually they re-run
>   step 10 to refresh). Confirm the id and warn that existing products with
>   the same ids will be overwritten.

1. **The BFF must be configured.** It reads sandbox + credentials from its
   `.env` (`packages/b2c-catalog-onboarding-bff/.env`, copied from
   `.env.example`). Required:
   - `B2C_INSTANCE_HOST`, `B2C_SHORT_CODE`
   - `STOREFRONT_CATALOG_ID` — **the NEW catalog id we're creating in this
     step** (e.g. `camper-catalog`). The import job materializes it; the
     site's current placeholder catalog stays untouched until we re-point
     bindings (master step 10, final sub-step). Never set this to the
     placeholder catalog id from step 2.
   - `DEFAULT_PRICEBOOK_ID`, `DEFAULT_INVENTORY_LIST_ID` — the pricebook +
     inventory list that **must already exist in the sandbox** (the import
     job won't create them). Two options, ask the user:
     1. **Reuse** the placeholder catalog's pricebook + inventory list (find
        them in BM → Merchant Tools → Products and Catalogs → on the
        placeholder catalog). Fastest path — fine for a demo.
     2. **Use brand-specific ones** the user has pre-created in BM
        (e.g. `camper-pricebook`, `camper-inventory`). Cleaner separation.
     The pipeline rewrites uploaded ids to whichever you pick.
   - `AM_CLIENT_ID` + `AM_CLIENT_SECRET` (Account Manager API client, scope
     `SALESFORCE_COMMERCE_API:<tenant>`)
   - `WEBDAV_USER` + `WEBDAV_PASSWORD` (BM user + per-user WebDAV password)
   - `REINDEX_JOB_ID` (BM SearchReindex job id; empty = skip reindex)

   In the master flow these come from `demo-state.json` (`b2c.*`) plus creds the
   user provides; never write raw secrets into `demo-state.json`.

2. **Boot the BFF and self-test** before uploading anything real:
   ```bash
   cd packages/b2c-catalog-onboarding-bff
   pnpm install            # bootstrap.sh already does this
   pnpm dev                # http://localhost:3001
   ```
   Confirm connectivity (fail fast here, not mid-upload):
   ```bash
   curl -s localhost:3001/health        | jq    # liveness + tenant
   curl -s localhost:3001/diag/auth     | jq    # Account Manager OAuth works
   curl -s localhost:3001/diag/data-api | jq    # OCAPI Data reachable (lists catalogs)
   curl -s localhost:3001/diag/edit-targets | jq # pricebook + inventory list exist
   ```
   Or just open `http://localhost:3001/` and press the **ⓘ** → "Self-test".

---

## Step-by-step

### Step 9 — Build the catalog
1. If the user already has a CSV/ZIP, use it. Otherwise scrape the client site:
   - Use `sfn-toolkit` catalog scripts to extract products, download images, and
     enrich. Aim for 5–8 products per category, real PDP images.
   - Normalize to the **flat CSV contract** above.
2. Sanity-check the CSV locally (headers present, prices numeric, image URLs
   resolve). Record the artifact path; in the master flow write it to the step
   `note` in `demo-state.json`.

### Step 10 — Upload to the sandbox  ⚠ IRREVERSIBLE
> **Hard gate.** Before committing, summarize exactly what will land: target
> `masterCatalogId`, product count, pricebook, inventory list, site. Get
> explicit user confirmation. Do not proceed on assumption.

Drive the BFF pipeline (UI at `/`, or API):

1. **Upload (preview phase).** Flat CSV:
   ```
   POST /api/catalogs/:masterCatalogId/uploads/csv   (multipart: file)
   ```
   or a site-archive ZIP:
   ```
   POST /api/catalogs/:masterCatalogId/uploads        (multipart: file)
   ```
   → returns an `uploadId`. The pipeline extracts → validates → builds a preview.
2. **Review the preview** (`GET /api/uploads/:uploadId/preview`). Surface the
   product/category/price counts to the user. If validation failed, fix the CSV
   and re-upload — don't commit an invalid upload.
3. **Commit** (this is the irreversible part — runs transform → rewrite-ids →
   repackage site-archive → WebDAV PUT to `/Impex/src/instance/` → trigger
   `sfcc-site-archive-import`):
   ```
   POST /api/uploads/:uploadId/commit
   ```
   → returns `202` + a `statusUrl`. Poll `GET /api/uploads/:uploadId` until the
   import job execution reaches `OK`/`FINISHED` (or surfaces an error).
4. The `apiCalls` array on the upload record is the full SFCC API trace — useful
   to show in a demo and to debug failures.

**Master catalog auto-creates** on first import if it doesn't exist (Data API
can't PUT `/catalogs`; the import job materializes it).

**Pricing is best-effort.** Bulk pricing rides in via the site-archive pricebook
XML, which works regardless of pod. The *live per-SKU price PATCH* may 404 on
pods where OCAPI Data sunset `price_book_entries` (e.g. `zzse-258`) — that's a
UI-convenience limitation, not an onboarding failure. See
`packages/b2c-catalog-onboarding-bff/BLOCKERS.md`. If only pricing fails, set
the step status to `blocked` with a note and continue — don't fail the flow.

### Step 11 — Reindex
On import success the BFF fires `triggerSearchReindex(REINDEX_JOB_ID)`
fire-and-forget so the storefront picks up changes in seconds. **Verify it
actually ran** (poll the job execution / re-query the storefront). If
`REINDEX_JOB_ID` is empty, tell the user the storefront will pick up changes on
the next scheduled delta-index, or have them create/assign the job.

> In the master flow, the **MRT push** happens after this step (the master skill
> owns `npm run push` from the SFN repo). This skill stops at reindex.

---

## Live edits (optional, outside the main flow)

`PATCH /api/catalogs/:masterCatalogId/products` runs per-SKU live edits
(product fields + inventory; price is best-effort per the blocker). Batches up
to 200 patches; the response includes the `apiCalls` trace. Handy for
last-minute demo tweaks without a re-import.

## Endpoint reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + tenant |
| GET | `/diag/auth` | Account Manager OAuth check |
| GET | `/diag/data-api` | OCAPI Data reachable (lists catalogs) |
| GET | `/diag/edit-targets` | Pricebook + inventory list exist |
| GET | `/api/csv-template` | Download a starter CSV |
| POST | `/api/catalogs/:id/uploads` | Upload site-archive ZIP (preview) |
| POST | `/api/catalogs/:id/uploads/csv` | Upload flat CSV (preview) |
| GET | `/api/uploads/:id/preview` | Preview of a pending upload |
| POST | `/api/uploads/:id/commit` | Commit → import + reindex (⚠) |
| GET | `/api/uploads/:id` | Upload status, events, apiCalls |
| DELETE | `/api/uploads/:id` | Cancel a previewed/invalid upload |
| GET | `/api/catalogs` / `/api/catalogs/:id` | List / detail |
| GET | `/api/catalogs/:id/products` | Paginated live product list |
| PATCH | `/api/catalogs/:id/products` | Live-edit batch |

## Gotchas (from the source project)

- **OCAPI Data is discovery-only on recent pods.** Writes go through the import
  job, not Data API PUT. New catalogs materialize via import.
- **WebDAV `/Impex/src/instance/`** is the archive staging location.
- **Inventory PUT shape:** `allocation` is `{amount, reset_date}`; the flag is
  `perpetual_flag` (not `perpetual`).
- **Localized markup** (`short_description`/`long_description`) needs the
  `{markup, source}` object form on write, not bare strings.
- **`brand` + `manufacturer-name`** populate standard attributes used for
  refinement — no custom attributes required.
- **Single-catalog mode (master == storefront) needs special handling in
  `transform.ts`.** When `STOREFRONT_CATALOG_ID === targetCatalogId` (the
  common case after the step-2/step-10 fix: one brand-named catalog for
  master AND storefront) the pipeline must NOT write a separate storefront
  delta — the delta only contains `<category>` + `<category-assignment>`
  and would overwrite the master XML that already holds `<product>` rows.
  Fixed in `5415caa` (Jun 2026); symptom was "import OK, 0 products, 26x
  'Category Assignment: <sku>: Product does not exist. Skipping.'". If you
  refactor `transform.ts`, keep the `storefrontCatalogId === targetCatalogId`
  branch that patches `showInMenu` in-place and skips delta emission.
- **Data API 403/404 on a brand-new catalog is expected.** `getCategory` for
  the storefront root fails before the first import materializes the
  catalog. Treat the error as "empty tree" so every category enters as new;
  don't surface it as a pipeline failure.
- **WebDAV PUT uses a full buffer, not a stream.** Node's native `fetch` with
  a Web `ReadableStream` body and `duplex: 'half'` was unreliable against
  the Impex endpoint. The pipeline reads the ZIP into a `Buffer` and PUTs
  that — fine for demo-scale archives (a few MB).
