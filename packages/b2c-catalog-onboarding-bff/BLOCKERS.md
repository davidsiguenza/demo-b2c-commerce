# Known Blockers

## Live price edit via OCAPI Data — `ResourcePathNotFoundException` on some pods

**Status:** environment-dependent. Stock and product fields (name, descriptions,
online flag) live-edit fine everywhere; **per-SKU price edits via OCAPI Data are
unavailable on pods where the `price_book_entries` sub-resource has been
sunset** (observed on `zzse-258`, all OCAPI versions tried).

> **For the catalog-onboarding flow this is NOT a hard failure.** Pricing rides
> in with the **site-archive import** (pricebook XML inside the uploaded
> archive), which is the path the onboarding pipeline already uses. The blocker
> below only affects the *live per-SKU price PATCH* in the admin UI, not the
> bulk import. Treat live price edit as **best-effort**: if it 404s, surface a
> warning and fall back to re-importing an archive with the updated pricebook.

### Symptom

`PATCH /api/catalogs/:masterCatalogId/products` with a `price` field returns:

```json
{
  "field": "price",
  "error": "Data API error 404 on PUT /price_books/<pricebook>/price_book_entries/<sku>: ResourcePathNotFoundException — The resource path '...' is unknown."
}
```

### Root cause

On affected pods the OCAPI Data API does **not expose** the `price_book_entries`
sub-resource in any version (`v23_2`, `v22_4`, `v21_10`, `v20_4`).
`ResourcePathNotFoundException` means the path is unknown to the OCAPI Data
router itself — not a permission or auth problem. Salesforce has been removing
OCAPI Data write surfaces in recent releases; new guidance is to use the
**Catalog/Pricebook Import job** or **CSV Pricing Import** instead.

To check whether a given pod still exposes it:

```bash
# 200 (or 400 with a shape error) → still live;  404 ResourcePathNotFound → sunset
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://<shortcode>.api.commercecloud.salesforce.com/pricing/price-books/v1/organizations/f_ecom_<tenant>/price-books/<pricebook>/price-book-entries/test"
```

### How pricing actually gets in (the supported path)

The onboarding pipeline writes a `pricebooks/<id>.xml` into the site-archive ZIP
and lets `sfcc-site-archive-import` materialize it — same mechanism as the
catalog itself. This works regardless of the OCAPI Data sunset. **No
short-circuit is shipped in this codebase**: the bulk import path is the
default and the live per-SKU PATCH is the optional convenience that degrades
gracefully.

### TODO — re-enable live per-SKU price edit when needed

If a deployment needs instant single-SKU price edits (not just bulk import):

1. **Pricebook XML import (recommended):** batch the price patches, generate a
   minimal `pricebook.xml`, repackage as a site-archive (the existing
   `src/pipeline/repackage.ts` already does this for catalogs — add a sibling
   for pricebooks), upload via `src/pipeline/webdav.ts`, trigger the import job
   via `src/b2c/jobs.ts`, and poll the execution (the admin UI already has the
   reindex-polling primitive to mirror). Async (~10–30s/batch) — surface a
   "saving…" state instead of an optimistic check.
2. **SCAPI Product Pricing API:** when a pod re-enables
   `/pricing/price-books/v1/...`, swap `upsertPriceBookEntry` in
   `src/b2c/data-api.ts` from OCAPI Data to SCAPI. Body shape:
   `{ "list-price": { "value": ..., "currency-code": "<ISO>" } }`.
3. **Switch sandbox:** move to a pod where OCAPI Data still exposes
   `price_book_entries` (re-probe with the curl above before committing).

### Reproducing the diagnosis

The BFF keeps two diag endpoints (`src/index.ts`):

```bash
# Per-SKU read probe across product / price entry / inventory
curl -s "http://localhost:3001/diag/sku/<sku>" | jq

# Dry-run PUT for price and stock
curl -s "http://localhost:3001/diag/put-test/<sku>?price=99.99&stock=7" | jq
```

`put-test` returning `200` on the price branch is the green light that live
price edit works on the current pod.
