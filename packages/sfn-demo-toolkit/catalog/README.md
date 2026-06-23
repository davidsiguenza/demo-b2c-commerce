# Catalog scripts

Reusable Python scripts that scrape a customer site, build a SFCC site
archive, and import it into a sandbox. Used by the
[`sfn-brand-demo` skill](../skill/sfn-brand-demo/SKILL.md) during phase 5.

Two reference implementations are available:

| Client | CDN | Script location |
|--------|-----|-----------------|
| **Mayoral** | Cloudinary (`assets.mayoral.com`) | `scripts/` (this dir) |
| **Desigual** | SFCC DIS (`?sw=<width>`) | `desigual/.sfn-toolkit/catalog/desigual/scripts/` |

## Pipeline

### Cloudinary-based (Mayoral pattern)
```
extract-products.py      PLP HTML → products.json (variantId, slug, color, pdpUrl, views[1..N])
enrich-products.py       PDP HTML → adds missing views to products.json
download-images.py       Cloudinary → images/<vid>/<size>/<vid>-XL-<n>.jpg (4 sizes per view)
generate-archive.py      products.json + images/ → archive/<id>/{catalogs,pricebooks,inventory-lists}
generate-site-assignment.py → archive/<id>/meta-data.xml + sites/<siteId>/
zip                      → ready for BM Site Import & Export
```

### SFCC DIS-based (Desigual pattern)
```
build-products.py        PLP HTML (saved locally) → products.json (hash URLs per view)
download-desigual-images.py  DIS ?sw=<width> → images/<vid>/<size>/<vid>_<view>.jpg (4 sizes)
generate-archive.py      products-selected.json + images/ → archive/desigual/...
generate-site-assignment.py → archive/desigual/meta-data.xml + sites/desigual/
zip                      → ready for BM Site Import & Export
```

## Outputs

| File | Purpose |
|---|---|
| `catalogs/<id>/catalog.xml` | Categories + products + assignments + image-groups + `showInMenu=true` |
| `catalogs/<id>/static/default/images/<vid>/<size>/...` | All product images |
| `pricebooks/pricebook.xml` | EUR list prices |
| `inventory-lists/<id>.xml` | 50 units per product |
| `meta-data.xml` | Required at archive root |

## Manual steps after import (cannot be automated)

1. **Create the site in BM** — Administration → Sites → Manage Sites → New (ID must be lowercase)
2. **Assign storefront catalog** — Administration → Sites → `<id>` → Storefront Catalog
3. **Assign inventory list** — Merchant Tools → Products and Catalogs → Inventory → `<list-id>` → Site Assignments
4. **Assign pricebook** — Merchant Tools → Pricing → Pricebooks → `<id>` → Site Assignments
5. **Add pricebook currency to site** — Merchant Tools → Site Preferences → Currencies → Add `EUR`
   (required if the site's default currency differs from the pricebook — SCAPI returns 500 otherwise)

## .env configuration after import

```
PUBLIC__app__defaultSiteId=<siteId>
PUBLIC__app__global__branding__activeClient=<clientId>
PUBLIC__app__commerce__sites='[{
  "id": "<siteId>",
  "defaultLocale": "<locale>",        ← must exist in BM for this site
  "defaultCurrency": "<currency>",    ← must be in site's currency list (step 5)
  "supportedLocales": [{"id": "<locale>", "preferredCurrency": "<currency>"}],
  "supportedCurrencies": ["<currency>"]
}]'
```

## Schema gotchas

The site-import job validates each XML against XSD. Lessons from Mayoral + Desigual:

- `<category>` child order: `display-name` → `online-flag` → `parent` → `position` → `thumbnail` → `image` → `custom-attributes`
- `<product>`: no `<available-flag>`. Use `<online-flag>` + `<searchable-flag>`.
- `<inventory>`: `list-id` goes on `<header>`, not on `<inventory-list>`. `<description>` is plain text — no `xml:lang`.
- `<preferences>`: `SiteAssignablePriceBooks` / `SiteApplicablePriceBooks` are NOT valid in most sandboxes — omit preferences.xml entirely.
- `<category><thumbnail>` and `<category><image>` need the full path including `images/` prefix (the `base-path` header only applies to product image-groups).
- `showInMenu` custom attribute must be `true` for categories to appear in the navigation menu.
- Image view type `hi-res` generates DATAWARNING on import (non-blocking) — omit if you want a clean log.

See `docs/CLAUDE-BRANDING-PLAYBOOK.md` for the full playbook.
