# Claude Branding Playbook

A reference guide for the LLM driving `sfn-brand-demo`. This file documents
every lesson learned from real customer runs (the first run was Mayoral on
2026-05-14) so future runs can produce a high-quality demo on the first try.

## The mental model

There are two layers:

- **Mechanical layer** (`sfn-toolkit` CLI) — clones, patches, registers files,
  downloads logos. Fast and idempotent.
- **Creative layer** (Claude) — picks the right images, writes the right copy,
  designs the right palette. Slow but the only thing that makes the demo
  feel real.

Don't try to automate the creative layer with heuristics. Heuristics fail on
SPAs. **Be the curator.**

---

## Phase 1: Discovery

Goal: understand the brand and find real assets.

### Tool 1 — WebFetch

Pass the customer's home URL (the localised one, e.g.
`https://www.mayoral.com/es/es/` not just `mayoral.com`) with a structured
prompt asking for:

- positioning, target, tone (kids fashion 0-16; family-friendly; affectionate)
- palette guess
- 3-4 hero/banner slides with title, subtitle, CTA in the brand's language
- 4-6 featured categories with copy
- editorial line / about
- slogan (Mayoral: *"Confeccionando moda infantil que hace amigos"*)
- language (es-ES vs en-US — affects all the copy)

The LLM rendering the page can usually only see textual content (no rendered
CSS), so don't expect hex codes from WebFetch — just text and structure.

### Tool 2 — direct curl

```bash
curl -sLA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
  (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36" \
  "https://www.<brand>.com/<locale>/" > /tmp/brand-home.html
```

Then mine the HTML:

```bash
# 1. Find the actual brand color
grep -oE '#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b' /tmp/brand-home.html \
  | sort | uniq -c | sort -rn | head -20

# Mayoral example output:
#   73 #101012   ← near-black text
#   31 #FFFFFF   ← surfaces
#   23 #0172EA   ← *this is the brand primary blue*
#   17 #3d7acf   ← hover variant
#   13 #CFCFCF   ← borders
#    4 #FFBAB7   ← coral accent
```

The most-frequent saturated colour is almost always the primary CTA. The
near-black is the body text. Whites and greys are surfaces.

```bash
# 2. Find real CDN images
grep -oE 'https://(assets|cdn|img|static)\.<brand>\.com/[^"&]+\.(jpg|jpeg|png|webp|svg)' \
  /tmp/brand-home.html | sort -u | head -30

# Look for filenames that match brand intent:
#   - hero-*.jpg, banner-*.jpg, home-hero-*.jpg
#   - <category>-*.jpg (e.g. mayoral-newborn-recien-nacido-v26.jpg)
#   - logo*.svg
#   - <eco|sostenible|sustainable>*.jpg
```

If the customer uses Next.js (mayoral.com does), the URL will be
`/_next/image?url=https%3A%2F%2F...filename.jpg&w=...` — URL-decode the
inner `url` parameter to get the real CDN path.

### Tool 3 — sfn-toolkit brand (optional)

```bash
sfn-toolkit brand <url> --client-id <id> --display-name "<name>"
```

Use this **as evidence**, not as final content:
- `analysis.json` lists all images the scraper found (with scores)
- The generated `brand-content.ts` is usually wrong — discard
- The generated `theme.css` may have OK token guesses; keep the colours, drop
  the rest

---

## Phase 2: Curation

This is where you (Claude) earn your keep.

### Writing `clients/<id>/content.ts`

Required Apache-2.0 copyright header at top of every TS file.

For each hero slide:
- Title in the brand's language (es-ES for Mayoral, en-US for default)
- Real subtitle, ideally pulled from a campaign on the customer's site
- Real CTA text ("Comprar Newborn", "Ver colección", not "Click here")
- ctaLink to a category that exists in the demo catalog (e.g.
  `/category/newborn`, `/category/boys`)
- imageUrl pointing to `/images/brands/<id>/<filename>` (downloaded in
  phase 3)

Featured cards:
- Pick the brand's actual primary categories. For a kids brand: bebé / niño;
  for fashion: women / men; for beauty: makeup / skincare.
- TextOnly card: use the brand's slogan or editorial line, NOT "Welcome to X."

### Writing `clients/<id>/theme.css`

The full token map (only override what changes per brand):

```css
:root[data-brand='<id>'] {
    /* CORE — usually safe to keep template defaults if your brand uses
     * white background and dark text. Override only if not. */
    --background: #ffffff;
    --foreground: <brand body text, e.g. #101012>;
    --card: #ffffff;
    --secondary: <off-white surface, e.g. #f6f5f4>;
    --muted: <same as secondary>;
    --border: <subtle border, e.g. #e7e7e7>;

    /* BRAND ACCENTS — these are the ones that change everything */
    --primary: <brand primary CTA>;
    --primary-foreground: <readable on primary, usually #fff>;
    --ring: <brand primary>;
    --focus: <rgba(brand primary, 0.4)>;

    /* IMPORTANT: --accent is the HOVER SURFACE, not a brand color.
     * Used by: outline buttons, dropdown items, hovered cards, badges,
     * collapsibles. Must be neutral. Vivid color here = every hover looks
     * broken. */
    --accent: <neutral, e.g. same as --secondary>;
    --accent-foreground: <brand body text>;

    /* SECONDARY BRAND BUTTONS ("Write a review", utility CTAs) */
    --brand-primary: <brand primary>;
    --brand-primary-hover: <slightly darker primary>;

    /* PDP SWATCHES (color and size selector) */
    --swatch-bg-selected: <brand primary>;
    --swatch-border-selected: <brand primary>;
    --swatch-text-selected: <readable on primary>;
    --swatch-color-border-hover: <brand primary>;

    /* SIDEBAR (mobile menu, faceted filters) */
    --sidebar-primary: <brand primary>;
    --sidebar-primary-foreground: <readable on primary>;
    --sidebar-ring: <brand primary>;

    /* HEADER — only override if the brand's header is NOT the template's
     * default (black bg with white inverted logo). When overriding to a
     * white header, ALSO disable the logo filter (which would otherwise
     * recolor your SVG): --header-logo-filter: none */
    --header-background: #ffffff;
    --header-foreground: <brand body text>;
    --header-border: <border>;
    --header-divider: <border>;
    --header-menu-background: #ffffff;
    --header-menu-foreground: <brand body text>;
    --header-menu-border: <border>;
    --header-menu-hover-background: <secondary>;
    --header-menu-hover-foreground: <brand primary>;
    --header-menu-active-background: <rgba(brand primary, 0.08)>;
    --header-menu-icon: <brand body text>;
    --header-logo-filter: none;
}
```

### Tokens NOT to override

- `--brand-gray-*` scale (neutral grays, system-wide)
- `--paypal-gold`, `--venmo-blue` (provider lock — would break recognition)
- `--rating` (yellow stars are a UX convention)
- `--destructive`, `--success`, `--warning` (status colors must stay
  conventional for accessibility)
- `--popover` if your brand keeps it as a contrasting surface (some
  templates invert it to black; depends on the design system)

---

## Phase 3: Asset download

Download what you need to `public/images/brands/<id>/`:

```bash
DEST=<repo>/public/images/brands/<id>
mkdir -p "$DEST"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

# Logo (prefer SVG when available)
curl -sLA "$UA" "<logo url from header>" -o "$DEST/logo.svg"

# Hero images — sized for the carousel. Cloudinary-style URLs let you ask
# for 1920px wide directly:
curl -sLA "$UA" "https://assets.<brand>.com/.../f_auto,w_1920/<asset>.jpg" \
  -o "$DEST/hero-<n>.jpg"

# Card images — 1200px is plenty
curl -sLA "$UA" "https://.../f_auto,w_1200/<asset>.jpg" \
  -o "$DEST/card-<n>.jpg"
```

Verify with `file <path>` that you didn't get an error page or HTML by mistake:

```bash
file public/images/brands/<id>/*.jpg
# Expected: "JPEG image data, ... 1920x768"
# If you see "ASCII text" or "HTML document": the URL was wrong, retry.
```

Avoid filenames with non-ASCII characters (rename `baño.jpg` → `bano.jpg`).

---

## Phase 4: Validate visually

After `pnpm demo:switch <id> && pnpm dev`, walk through:

| Page | What to check |
|---|---|
| Home `/` | Hero carousel shows brand images and copy. Footer logo is the brand's. Header logo is the brand's, in its native color (not inverted). |
| PLP `/category/...` | Product tile hover is **subtle gray**, not a coloured tint. Filters sidebar uses brand primary. |
| PDP `/product/<id>` | Color and size swatches: selected one is brand primary on white text (or brand text on primary surface). "Add to Cart" is brand primary. Star rating stays yellow. |
| Cart | "Continue to checkout" is brand primary. |
| Checkout | Payment provider buttons (Apple/Google/PayPal/Venmo/Amazon) keep their original colors — they're brand-locked. |

If a hover looks coloured = `--accent` is wrong.
If a swatch is still black = swatch tokens not overridden.
If the header logo looks weird = `--header-logo-filter` not disabled.
If everything is fine = ship it.

---

## Anti-patterns to avoid

1. **Trusting the heuristic crawler output.** Fine for inspiration, never as
   final content.
2. **Putting brand colors in `--accent`.** Always neutral.
3. **Forgetting PDP/PLP.** Home is easy; PDP is where most clients fail.
4. **Inventing copy.** Use what the actual site says — slogans, category
   names, campaign tags. They're public.
5. **Assuming WebFetch sees the rendered page.** It only sees text content;
   palette has to come from `curl + grep`.
6. **Including provider colors in theme.css.** Apple Pay must look like
   Apple Pay.

---

## Phase 5: Catalog (optional, recommended for client demos)

Without a real catalog, PLP/PDP show whatever the sandbox already had. Total
killer of credibility. Build a real one for the customer.

### Pipeline

1. **PLP scrape** — use `sfn-toolkit scrape` with `--wait-for 4000` on each
   category URL. Look for the pattern
   `https://assets.<brand>.com/.../v<version>/<sku>-XL-<view>/<slug>.jpg`.
   Group by `<sku>-<color>` to get unique variants. Pick 5-8 per category.

2. **Capture PDP URLs** — they're in the PLP HTML as `<a href="...">`.
   Pattern is usually `/<locale>/<slug>-<numeric-id>-<n>` where the
   numeric id is the variantId with dashes removed.

3. **PDP scrape (per product)** — PLPs only preload 1-2 image views; PDPs
   expose 4-6 (front/back/detail/lifestyle/model). 40 PDPs at ~5s each =
   ~3-4 min total. Cache results so the script is resumable.

4. **Multi-size download** — for each (variantId, view) pair, fetch:

   | Group | Width | Use |
   |---|---|---|
   | `hi-res` | 2200 | PDP zoom |
   | `large` | 1200 | PDP main |
   | `medium` | 600 | PLP tile |
   | `small` | 280 | Cart, mini-cart |
   | `swatch` | 80 | Color picker (single image, not a gallery) |

   Cloudinary URLs accept any width via `f_auto,q_auto,w_<n>` so just
   substitute the width parameter. ~700-1000 jpgs per 40-product catalog.

5. **Generate the SFCC site archive** following this structure:

   ```
   mayoral.zip/mayoral/
   ├── meta-data.xml
   ├── catalogs/<catalog-id>/
   │   ├── catalog.xml
   │   └── static/default/images/<vid>/<size>/<vid>-XL-<n>.jpg
   ├── pricebooks/pricebook.xml
   ├── inventory-lists/<list-id>.xml
   └── sites/<siteId>/preferences.xml
   ```

### XML schema landmines

The site-import job validates each XML strictly. From the Mayoral run:

**catalog.xml (`impex/catalog/2006-10-31`):**
- In `<category>`: child order is `display-name → description → online-flag
  → online-from → online-to → parent → position → ...`. Putting `<parent>`
  AFTER `<position>` fails with `cvc-complex-type.2.4.a`.
- In `<product>`: `<available-flag>` doesn't exist. Use `<online-flag>` and
  `<searchable-flag>` only.

**inventory.xml (`impex/inventory/2007-05-31`):**
- `list-id` is an attribute of `<header>`, NOT of `<inventory-list>`.
- `<description>` is a simple type — no `xml:lang` allowed (plain text).

**preferences.xml:**
- `SiteAssignablePriceBooks` and `SiteApplicablePriceBooks` are **not**
  standard preferences in most sandboxes — they produce `DATAERROR: Unknown
  preference` and are silently skipped. Do not include a preferences.xml for
  pricebook binding; assign the pricebook manually in BM after import:
  Merchant Tools → Pricing → Pricebooks → `<id>` → Site Assignments.

**site.xml (`impex/site/2007-04-09`):**
- DO NOT ship a `sites/<id>/site.xml` for new-site creation. The job rejects
  it because `site-import` cannot create sites. Have the user create the
  site in BM first; ship only `preferences.xml` to bind data.

### Multi-image image-groups

```xml
<images>
  <image-group view-type="hi-res">
    <image path="<vid>/hi-res/<vid>-XL-4.jpg" />
    <image path="<vid>/hi-res/<vid>-XL-5.jpg" />
    <image path="<vid>/hi-res/<vid>-XL-6.jpg" />
  </image-group>
  <image-group view-type="large">
    <image path="<vid>/large/<vid>-XL-4.jpg" />
    ...
  </image-group>
  <image-group view-type="medium">...</image-group>
  <image-group view-type="small">...</image-group>
  <image-group view-type="swatch">
    <image path="<vid>/swatch/<vid>-XL-<first-view>.jpg" />
  </image-group>
</images>
```

The catalog `<header>` should declare `<image-settings>
<internal-location base-path="/images" /></image-settings>` so SFCC resolves
those paths under `static/default/images/`.

### BM steps the user must do

1. **Create the site** (Administration → Sites → Manage Sites → New). Site
   ID must match exactly the folder name in `sites/<id>/` (case-sensitive,
   lowercase). Set locale, currency, timezone for the client market.
2. **Site Import & Export → Import** the ZIP.
3. **Site Configuration after import** (3 manual steps — cannot be automated):
   - Storefront Catalog → Administration → Sites → `<id>` → select the imported catalog
   - Inventory List → Merchant Tools → Products and Catalogs → Inventory → `<list-id>` → Site Assignments → add the site
   - Pricebook → Merchant Tools → Pricing → Pricebooks → `<pricebook-id>` → Site Assignments → add the site
4. **Add the pricebook currency to the site** — if the site's default currency differs from the pricebook (e.g. site is GBP, pricebook is EUR), you must explicitly add the pricebook currency or SCAPI returns 500 on every product/search call:
   - Merchant Tools → Site Preferences → Currencies → Add → `EUR` (or whichever currency the pricebook uses)

### Update the env profile

After import, switch the brand `.env.profiles/<id>.env` to:
```
PUBLIC__app__defaultSiteId=<SiteId>
PUBLIC__app__commerce__sites='[{"id":"<SiteId>","defaultLocale":"<locale>","defaultCurrency":"<currency>","supportedLocales":[{"id":"<locale>","preferredCurrency":"<currency>"}],"supportedCurrencies":["<currency>"]}]'
```
The `defaultLocale` must be a locale already configured in BM for that site, and `defaultCurrency` must be in the site's currency list (step 4 above).
Restart `pnpm dev`.

---

## Quick reference: the Mayoral run

For posterity, what worked:

- Discovery: `WebFetch + curl` of `https://www.mayoral.com/es/es/`
- Palette source: 23 occurrences of `#0172EA` in HTML → primary blue
- Images: 6 jpg downloads from `assets.mayoral.com` directly (Cloudinary)
- Logo: pulled from `https://www.mayoral.com/icons/mayoral/logo/positive.svg`
- Slogan: *"Confeccionando moda infantil que hace amigos"* (used in textOnly
  card)
- Categories used: newborn / summer / swim / ecofriends (hero) +
  niño / bebé (cards)
- Header overridden to white with `--header-logo-filter: none` so the blue
  Mayoral logo SVG renders with its native color
- `--accent` set to `#f6f5f4` (off-white) after the first run had it as
  `#FFBAB7` and made every hover look pink-broken
