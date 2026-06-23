---
name: dsp-sfn-demo-branding
description: Build a high-quality, branded Salesforce Storefront Next demo for a specific customer. Claude orchestrates the whole flow — clones the SFN template, applies the branding system patches via sfn-toolkit, then **personally curates** the per-client content (hero copy, featured cards, palette, real customer assets) instead of relying on heuristic scrapers. Use when the user says "create a Storefront Next demo for <customer>", "brand a SFN demo from a URL", "set up a new SFN client", or similar.
---

# SFN Brand Demo Skill

This skill turns a customer URL into a branded Storefront Next demo. The
**`sfn-toolkit` CLI** does the mechanical parts (cloning, patching, registering
files). **Claude does the creative parts** (reading the customer site,
selecting images, writing the copy, picking the palette).

> **Toolkit setup:** if `sfn-toolkit --version` fails, run the repo bootstrap
> (`./scripts/bootstrap.sh` at the `demo-b2c-commerce` root), or link it
> manually: `cd <demo-b2c-commerce>/packages/sfn-demo-toolkit && npm install && npm link`

## Core principle: Claude is the designer

The toolkit ships a heuristic scraper, but it produces poor results on most
modern sites (SPAs, lazy-loaded content, generic image filenames). **Don't rely
on it for content quality.** Use it only to discover assets; then write
`content.ts` and `theme.css` yourself with real care.

The full flow is:

```
[CLI: scaffold]    sfn-toolkit patch  →  branding extension installed
[CLAUDE: research] WebFetch + curl    →  understand brand, find images
[CLAUDE: curate]   write content.ts   →  Spanish/EN copy that matches the site
[CLAUDE: curate]   write theme.css    →  override brand-aware tokens
[CLAUDE: curate]   download assets    →  real customer images
[CLI: register]    sfn-toolkit apply  →  wires files into the repo
                   pnpm dev           →  validate visually
```

## Inputs to gather (use AskUserQuestion)

Before doing anything:

1. **Customer URL** (e.g. `https://www.mayoral.com/es/es/`) — the public site
2. **Client id** — short kebab-case slug (e.g. `mayoral`, `nike-2026`)
3. **Display name** — human-readable brand name
4. **Target folder** — where to clone (default: cwd + `/<client-id>`)
5. **Reuse existing sandbox?** — typically yes; ask the path to an existing
   working `.env` (e.g. `~/Documents/SFNenablement/DSPMarketStreet-zzpm048/.env`)
   so Claude can copy the SCAPI credentials with `--inherit-env`. If no, the
   user must fill them manually.

## Step-by-step playbook

### 1. Pre-check
- Confirm `sfn-toolkit --version` works. If not, run `./scripts/bootstrap.sh` at the repo root (or `cd <demo-b2c-commerce>/packages/sfn-demo-toolkit && npm install && npm link`).
- Ask the user the inputs above.

### 2. Scaffold the repo
```bash
git clone https://github.com/SalesforceCommerceCloud/storefront-next-template <target>
cd <target>
sfn-toolkit upgrade-check --target .   # confirm anchors found
sfn-toolkit patch .
```
If `upgrade-check` reports drift, **stop** and surface to the user — don't
force-apply on an unsupported version.

### 3. Research the brand (Claude does this)

Two complementary approaches:

a) **WebFetch the customer URL** with a structured prompt asking for:
   - brand positioning, target audience, tone
   - palette guess (often the LLM can only see textual content; that's OK)
   - hero/banner section copy and CTAs
   - featured categories and their copy
   - editorial/about block
   - slogan/claim
   - language and tone

b) **curl the URL directly** to get the raw HTML and:
   - Grep for `#[0-9a-fA-F]{6}` to find actual hex colors. The most-frequent
     vivid colour is usually the primary CTA.
   - Grep for asset URLs (`assets.<brand>.com`, `cdn.<brand>.com`,
     `<brand>.com/_next/image?url=...`) to find real image filenames
   - Look for the actual logo URL (often `<header>` or `<a class="logo">`)

> **Important:** the toolkit's `sfn-toolkit scrape` and `brand` commands
> exist but are weak on modern SPAs. Treat their output as a hint, not the
> source of truth.

### 4. Run the toolkit's brand command (optional, for hints)
```bash
sfn-toolkit brand <url> --client-id <id> --display-name "<name>"
```
This produces `.sfn-toolkit/brand/<id>/{analysis.json, brand-content.ts, theme.css, profile.env}`.

The `analysis.json` is useful as **evidence of what the scraper found** (image
URLs, color tokens picked up). The generated `brand-content.ts` is usually
poor — replace it.

### 5. Apply (registers files mechanically)
```bash
sfn-toolkit apply --target . --brand-dir .sfn-toolkit/brand/<id> \
  --inherit-env <path-to-existing-working-.env>
```
This:
- copies `brand-content.ts`, `theme.css`, `profile.env` into the right places
- registers the client in `registry.ts` and `themes.css`
- downloads the logo (if URL works) to `public/images/brands/<id>/logo.<ext>`
- bootstraps `.env` if missing (with credentials inherited if `--inherit-env`)

### 6. **Claude rewrites the curated content** (the heart of the skill)

After step 5 the registration is done but the content is mediocre. Now:

a) **Write `src/extensions/branding/clients/<id>/content.ts`** by hand, using
   the research from step 3:
   - Each hero slide: title in the brand's language, real subtitle from the
     site, real CTA text, link to a relevant category
   - Featured cards: pick the actual primary categories (boys/girls,
     newborn/teen, etc.). Use real category copy, not "Discover Women."
   - TextOnly card: use the brand's actual slogan or editorial line

b) **Download real assets** from the customer's CDN to
   `public/images/brands/<id>/`. Example for Mayoral:
   ```bash
   curl -sLA "<browser-UA>" \
     "https://assets.mayoral.com/.../mayoral-newborn-recien-nacido-v26.jpg" \
     -o public/images/brands/mayoral/hero-newborn.jpg
   ```
   Update `content.ts` `imageUrl` fields to `/images/brands/<id>/<filename>`.

c) **Rewrite `src/extensions/branding/clients/<id>/theme.css`** with proper
   token overrides. **CRITICAL** lessons learned:

   - `--accent` is the **hover/highlight** surface (outline buttons,
     dropdowns, hovered cards). It MUST be a low-saturation neutral. Putting
     a vivid brand color here makes every hover look broken.
   - `--primary` drives the main CTAs everywhere (Add to Cart, etc.)
   - For PDP swatches (variant selectors) override `--swatch-bg-selected`,
     `--swatch-border-selected`, `--swatch-text-selected`,
     `--swatch-color-border-hover`. Without this, swatches stay
     template-default black.
   - For "Write a Review"-type buttons override `--brand-primary` and
     `--brand-primary-hover`.
   - For the focus ring override `--ring` and `--focus`.
   - For mobile menus override `--sidebar-primary`, `--sidebar-ring`.
   - For non-default header styles (e.g. white instead of template's black),
     override the `--header-*` family AND set `--header-logo-filter: none`
     so the logo SVG renders with its native colors.

   Always check the brand's **PLP and PDP** visually after — that's where
   incomplete theming bites.

### 7. Validate
```bash
pnpm install   # if not already
pnpm demo:switch <id>
pnpm dev
```
Open `http://localhost:5173`. Walk through:
- **Home**: hero, featured cards, footer logo all show the brand
- **PLP**: hover state on product tiles is neutral, not coloured
- **PDP**: swatches, "Add to Cart", "Add to Wishlist" all in brand color

If something is off, iterate on `content.ts` / `theme.css` and refresh.

### 8. Catalog (optional but recommended for client demos)

Without a real catalog the PLP/PDP show whatever the sandbox already had,
which kills realism. Build one:

a) **Discover and select products from the customer site** (10-15 min):
   - Use Playwright via `sfn-toolkit scrape` on each PLP to find real product
     image URLs (look for the `assets.<brand>.com/.../<sku>-XL-N/<slug>.jpg`
     pattern).
   - Group by SKU/variant id. Pick 5-8 products per category. Store the PDP
     URL for each (usually visible as `<a href>` in the PLP HTML).

b) **Scrape each PDP** to get all available views (XL-1..XL-N). PLPs only
   preload 1-2 images per product — PDPs expose 4-6 (front, back, detail,
   lifestyle, model). 40 PDP fetches take ~3-4 min.

c) **Download every view in 5 sizes** (hi-res 2200, large 1200, medium 600,
   small 280, swatch 80). Total ~700-1000 jpgs for a 40-product catalog.

d) **Generate a SFCC site archive** with strict XML schema compliance:
   - `catalogs/<id>/catalog.xml` with proper child order: in `<category>`,
     `<parent>` MUST come before `<position>`. In `<product>`, do NOT use
     `<available-flag>` (it doesn't exist; use `<online-flag>` only).
   - `pricebooks/pricebook.xml` with EUR/USD prices.
   - `inventory-lists/<id>.xml` with the schema:
     `<inventory-list><header list-id="...">...</header><records>...</records></inventory-list>`.
     The `list-id` attribute goes on `<header>`, NOT on `<inventory-list>`.
     Inventory `<description>` is a simple type — no `xml:lang`, plain text.
   - `sites/<siteId>/preferences.xml` with the pricebook bindings (under
     `<standard-preferences><all-instances>` not `<custom-preferences>`).
   - `meta-data.xml` at the archive root.
   - Static images at
     `catalogs/<id>/static/default/images/<variantId>/<size>/<variantId>-XL-<n>.jpg`.

e) **5 image-groups per product** in catalog.xml, each pointing to a
   different size folder:
   ```xml
   <images>
     <image-group view-type="hi-res">
       <image path="<vid>/hi-res/<vid>-XL-4.jpg" />
       <image path="<vid>/hi-res/<vid>-XL-5.jpg" />
       <image path="<vid>/hi-res/<vid>-XL-6.jpg" />
     </image-group>
     <image-group view-type="large">...</image-group>
     <image-group view-type="medium">...</image-group>
     <image-group view-type="small">...</image-group>
     <image-group view-type="swatch">
       <image path="<vid>/swatch/<vid>-XL-<first-view>.jpg" />
     </image-group>
   </images>
   ```
   Multiple `<image>` per group (except swatch) gives PDP a real gallery,
   not a single hero shot. PLP uses `medium`. PDP zoom uses `hi-res`.

f) **Site creation in BM is manual** — the SFCC site-import job CANNOT
   create new sites. Ask the user to:
   1. BM → Administration → Sites → Manage Sites → New
   2. Site ID matching exactly the one in `sites/<siteId>/` (case-sensitive)
   3. Locale, currency, timezone matching the client market

g) **Import the ZIP** via BM → Site Import & Export → Upload + Import.

h) **Manual bindings in BM after import** (these can't go in preferences.xml
   because they're direct site attributes):
   1. BM → Sites → `<siteId>` → Site Configuration:
      - **Storefront Catalog** → select `<catalog-id>`
      - **Storefront Inventory List** → select `<inventory-list-id>`
   2. Save.
   3. Pricebook bindings should already apply via preferences.xml.

i) **Update the env profile** to point at the new site:
   `PUBLIC__app__defaultSiteId=<siteId>` plus the `commerce.sites` array
   with the locales the new site supports. Restart `pnpm dev`.

After all this, the PLP shows real customer products with proper images,
PDP has a real gallery, prices and stock display correctly, and the demo
becomes credible.

## Common pitfalls (Mayoral run, May 2026)

1. **Heuristic crawler picks up cookie banner content.** The `sfn-toolkit
   brand` command may extract OneTrust banner copy ("Remember my selection",
   "Click here") and trust badges (norton-certificate.png) as hero content
   on SPAs. Always replace.
2. **Header has TWO logo variants in v0.4** (mobile-simplified for checkout +
   desktop). The patch wraps both via `replace-anchor` with `all: true`.
3. **Footer logo is separate** from header — it has its own `UITarget`
   (`footer.logo`) and its own component (`branded-footer-logo.tsx`).
4. **`--accent` token is NOT a brand color.** It's the UI hover surface.
   Putting brand color there makes every hover look like an error.
5. **Logo SVGs already have brand colors** — when overriding the header for
   a brand whose logo isn't black, set `--header-logo-filter: none`.

### Catalog phase pitfalls

6. **`site-import` job cannot create sites.** It only writes data to existing
   ones. The user must create the new site in BM first. Don't ship a
   `site.xml` root-level descriptor — it's not a valid input shape.
7. **Schema is strict, child order matters.** In `<category>`, `<parent>`
   must come BEFORE `<position>`. In `<product>`, `<available-flag>` doesn't
   exist (only `<online-flag>` and `<searchable-flag>`).
8. **Inventory `list-id` goes on `<header>`**, not on `<inventory-list>`.
   Inventory `<description>` rejects `xml:lang` (plain text only, unlike
   catalog/pricebook descriptions).
9. **Storefront catalog and inventory list bindings are NOT in
   preferences.xml.** They are direct site attributes set in BM after
   import. Pricebook can go in preferences (under `standard-preferences`
   `all-instances` `SiteAssignablePriceBooks` and `SiteApplicablePriceBooks`).
10. **PLPs only preload 1-2 images per product.** To get a real PDP gallery
    you have to also scrape each PDP. The view numbers are non-contiguous
    (some products only have 4,5,6; others 1,2,3,4,5,6).
11. **Cloudinary URLs preserve aspect ratio** — pass `f_auto,q_auto,w_<n>`
    and you get any width on demand. No need for the original `t_web_plp_750`
    transform; it just locks you to one size.

## Output: a complete, branded demo

When done, the user can:
- `pnpm demo:switch <id>` to swap brands instantly in dev
- Add more clients without touching core code (just clone the same
  pattern in `clients/<new-id>/`)
- Upgrade SFN later (the patches are self-documented via
  `@sfdc-extension-line SFDC_EXT_BRANDING` markers)
