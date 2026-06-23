# sfn-marketplace-bff — B2C Catalog Uploader

A small BFF that turns a CSV or site-archive ZIP into a B2C Commerce catalog
import — no Business Manager UI gymnastics. The user types the **master
catalog id** their products should land on, drops a file, and the BFF
extracts → validates → previews → repackages → WebDAV PUT → triggers
`sfcc-site-archive-import` → triggers `SearchReindex` so the storefront
picks up changes in seconds, not 5–15 min.

The admin SPA at `/` shows the upload pipeline, timeline, and a live trace of
every SFCC API call (method/URL/payload/response) — useful for client demos.
Brand and manufacturer values from your CSV/XML are passed through untouched.

> **First time? Open [`getting-started.html`](./getting-started.html) by
> double-clicking it** — it's a self-contained landing page that walks
> through Node + pnpm install, `.env` setup, and the first run, with no
> server needed yet.

## Run

```bash
cp .env.example .env       # fill credentials and ids (see Replicate below)
pnpm install
pnpm dev                   # http://localhost:3001
```

Once running, click the **ⓘ** button in the header to open the in-app setup
guide and run a one-click self-test against `/health`, `/diag/auth`,
`/diag/data-api`, and `/diag/edit-targets`.

## Pipeline

1. `POST /api/catalogs/:masterCatalogId/uploads` (zip) or
   `…/uploads/csv` → preview phase (extract → validate → buildPreview).
2. User confirms in admin UI → `POST /api/uploads/:uploadId/commit` →
   transform → rewrite-ids → repackage as site-archive → WebDAV PUT to
   `/Impex/src/instance/` → trigger `sfcc-site-archive-import` job → poll
   execution.
3. On `OK`/`FINISHED` → fire-and-forget `triggerSearchReindex(REINDEX_JOB_ID)`
   so storefront picks up changes in seconds.

`PATCH /api/catalogs/:masterCatalogId/products` runs the live-edit flow
(per-SKU PATCH product / PUT inventory record + reindex). The response
includes an `apiCalls` array the admin UI renders as expandable rows.

The master catalog is created automatically on the first import if it doesn't
exist (Data API v23.2 doesn't allow PUT on `/catalogs`; the import job does).

## Replicate in a new environment

This repo is the base for any SFCC catalog-loader demo. The same content is
also embedded in the admin UI behind the **ⓘ** button — pick whichever
surface is more convenient.

### 1. Clone and rename

```bash
git clone https://github.com/davidsiguenza/sfn-marketplace-bff.git <new-name>
cd <new-name>
rm -rf .git && git init -b main
# Edit package.json -> "name"
```

### 2. Configure SFCC sandbox

In Business Manager (Administration → Operations → Jobs), create:

- A `SearchReindex` job for the storefront site (one step,
  `SearchReindex` step type, "Product Search Index" + "Content Search Index"
  selected). Note the assigned job ID — paste it into `.env`.
- Confirm the import job ID is `sfcc-site-archive-import` (default in this
  repo via `siteArchiveJobId` in `src/b2c/jobs.ts`). Most BMs use that ID
  out of the box.

In Merchant Tools → Products and Catalogs:
- Note the **storefront master catalog** id (e.g. `market-storefront`,
  `acme-storefront`). This is the cross-publish target.
- Note the **default pricebook** and **inventory list** assigned to the site
  (each upload's pricebook XML gets rewritten to these IDs so the storefront
  actually sees the prices/stock).

### 3. Account Manager + WebDAV creds

Account Manager (https://account.demandware.com) → API Client:
- Create a client with `SALESFORCE_COMMERCE_API:<tenant>` scope.
- The tenant is the value before `.dx.commercecloud.salesforce.com` written
  with underscores (e.g. `zzse-258` → `zzse_258`).

WebDAV credentials are your BM user + a per-user WebDAV password set in BM
(Administration → Organization → Users → your user → "WebDAV Access").

### 4. `.env` variables — full list

| Variable | Per-environment? | Description |
|---|---|---|
| `B2C_INSTANCE_HOST` | yes | `<sandbox>.dx.commercecloud.salesforce.com` |
| `B2C_TENANT` | yes | `<sandbox>` with hyphens replaced by underscores |
| `B2C_ORG_ID` | yes | `f_ecom_<tenant>` |
| `B2C_SHORT_CODE` | yes | 8-char realm short code (BM → Administration → Salesforce Commerce API Settings) |
| `STOREFRONT_CATALOG_ID` | yes | The storefront master catalog id (cross-publish target) |
| `DEFAULT_PRICEBOOK_ID` | yes | Pricebook the site uses |
| `DEFAULT_INVENTORY_LIST_ID` | yes | Inventory list the site uses |
| `DEFAULT_INVENTORY_UNITS` | sometimes | Units stocked per product when the source upload omits inventory (default `10`) |
| `AM_CLIENT_ID` | yes | Account Manager API client UUID |
| `AM_CLIENT_SECRET` | yes | Account Manager client secret |
| `WEBDAV_USER` | yes | Your BM username (typically your SF email) |
| `WEBDAV_PASSWORD` | yes | BM WebDAV access password |
| `REINDEX_JOB_ID` | yes | BM job id for SearchReindex; empty = skip reindex |
| `PORT` | optional | Default `3001` |

`B2C_TENANT`, `B2C_ORG_ID`, and `B2C_SHORT_CODE` are not currently used by
the import path but are kept for SCAPI integrations you might add.

### 5. Boot

```bash
pnpm install
pnpm typecheck         # sanity
pnpm dev               # http://localhost:3001
```

Hit `/diag/auth` and `/diag/data-api` first to confirm Account Manager auth
and OCAPI Data connectivity before uploading a real catalog. Or just press
the **ⓘ** button in the header → "Self-test".

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/diag/auth` | Confirms Account Manager OAuth works |
| GET | `/diag/data-api` | Lists catalogs (validates OCAPI Data) |
| GET | `/diag/edit-targets` | Confirms pricebook + inventory list exist |
| GET | `/api/catalogs` | List master catalogs (B2C catalogs + upload index) |
| GET | `/api/catalogs/:id` | Catalog detail |
| GET | `/api/catalogs/:id/products` | Paginated product list (live SFCC reads) |
| PATCH | `/api/catalogs/:id/products` | Live-edit batch (returns `apiCalls`) |
| POST | `/api/catalogs/:id/uploads` | Upload zip site-archive |
| POST | `/api/catalogs/:id/uploads/csv` | Upload flat CSV (auto-generates XMLs) |
| POST | `/api/uploads/:id/commit` | Confirm preview, run import + reindex |
| GET | `/api/uploads/:id` | Upload detail (events, apiCalls, status) |
| GET | `/api/csv-template` | Downloadable CSV starter template |
| GET | `/api/discover` | Dropdown options for the upload form |

## Known issues

- **Live per-SKU price edit is best-effort.** On pods where OCAPI Data has
  sunset `price_book_entries` (e.g. `zzse-258`) the live price PATCH 404s and
  is disabled in the admin; stock and product fields edit fine. This does NOT
  affect catalog onboarding — bulk pricing rides in via the site-archive
  import. See [`BLOCKERS.md`](./BLOCKERS.md) for diagnosis and fix options.
- **OCAPI Data v23.2 quirks** (documented in code comments):
  - No catalog-create via PUT (`VersionNotFoundException`); new catalogs
    materialize via the import job.
  - No `/catalogs/{id}/products` listing (`ResourcePathNotFound`); we keep
    a per-catalog index in `src/lib/upload-index.ts`.
  - Inventory records: `allocation` must be `{amount, reset_date}`; flag is
    `perpetual_flag` (not `perpetual`).
  - Pricebook entries: PATCH unsupported, use PUT (replace-row).
  - Localized markup (`short_description`, `long_description`): PATCH
    requires the `{markup, source}` object form, not bare strings.
