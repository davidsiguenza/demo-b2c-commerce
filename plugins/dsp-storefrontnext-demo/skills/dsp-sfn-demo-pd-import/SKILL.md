---
name: dsp-sfn-demo-pd-import
description: Import Page Designer pages and components programmatically into a Storefront Next (SFN) B2C Commerce site via site archive XML. Use when the user wants to push a homepage, PD page, or branded content to a B2C sandbox without using the Business Manager UI - typical demo workflow for Mayoral, Bimba y Lola, Osborne, or any SFN-branded site. Covers library archive XML format (shared and site-private), image hosting via WebDAV or bundled in the archive, and the gotchas (regions encoded in `type`, image objects with `path`, library-id matching site assignment).
---

# SFN Page Designer Import

Programmatic workflow to push Page Designer content (pages, components, images) to a B2C Commerce sandbox running Storefront Next, without using the Business Manager UI.

**When to use:** Branded SFN demo (Mayoral, Bimba y Lola, Osborne, etc.) where the toolkit generates branding content but you need that content rendered through Page Designer rather than hardcoded in React routes.

**When NOT to use:** SFRA storefronts (use site archive directly), or when content fits in the React `errorElement` fallback (no PD needed).

---

## The 6 gotchas (read before you start)

These are the issues that broke the Mayoral and Bimba y Lola PD imports — solving them upfront saves hours.

### 1. Shared vs site-private library — different XML AND archive paths

Libraries come in two flavors. The XML format and the archive folder structure are **different** for each. Discover which one your site uses **before** writing anything:

```bash
# Try shared first
b2c content list --library <id> --tree

# If "Library not found in archive; for non-shared libraries use the --site-library option":
b2c content list --library <siteId> --site-library --tree
```

**A) Shared library** (e.g. Mayoral → `mayoral-SharedLibrary`). The XML carries `library-id` and the archive uses `libraries/<id>/`:

```xml
<library xmlns="..." library-id="mayoral-SharedLibrary">
```

```
mayoral-homepage/
└── libraries/
    └── mayoral-SharedLibrary/
        └── library.xml
```

**B) Site-private library** (e.g. Bimba y Lola). The XML has **no** `library-id` and the archive uses `sites/<siteId>/library/`:

```xml
<library xmlns="http://www.demandware.com/xml/impex/library/2006-10-31">
```

```
bimbaylola-homepage/
└── sites/
    └── bimbaylola/
        └── library/
            └── library.xml
```

A mismatched format imports without error but the page never appears in the site's PD editor. If `b2c content list` works with `--library <siteId> --site-library`, use site-private. If it works with `--library <sharedId>` (no `--site-library`), use shared.

### 2. Regions are encoded in the `type` attribute, NOT as child elements

Wrong (schema validation fails):
```xml
<content-link content-id="hero" type="component.Layout.heroCarousel">
    <region>main</region>
</content-link>
```

Correct:
```xml
<content-link content-id="hero" type="page.homePage.main">
    <position>1.0</position>
</content-link>
```

Pattern: `<parentType>.<regionId>`. Examples:
- `page.homePage.main` — component goes in the `main` region of `page.homePage`
- `page.homePage.headerbanner` — component goes in `headerbanner` region
- `component.Layout.heroCarousel.slides` — slide inside heroCarousel's `slides` region

### 3. Image attributes need an OBJECT with `path` or `url`, not a string

The PD attribute type `image` is serialized as a JSON object. A string fails silently — the field shows empty in BM and the React component renders the gray fallback.

Wrong:
```json
"imageUrl": "/images/brands/mayoral/hero-newborn.jpg"
```

Correct:
```json
"imageUrl": {"path": "/images/brands/mayoral/hero-newborn.jpg", "focal_point": {"x": 0.5, "y": 0.5}}
```

Use `path` for cartridge-relative paths (most common). Use `url` only for external URLs (rare).

The component reading this needs to support both. Check `src/components/<component>/index.tsx` for `imageUrl?.url` access — if it only checks `.url`, patch it to fallback to `.path`:

```typescript
const resolvedSrc = imageUrl?.url || imageUrl?.path;
if (!resolvedSrc) return <fallback/>;
```

Also extend `src/types/common.ts` `Image` type to include `path?: string`.

### 4. The zip top-level dir MUST match the zip filename

The B2C site-archive importer fails with "Invalid archive. Archive must contain a single top-level subdirectory with the same name as the file itself" if the names don't match.

```
mayoral-homepage.zip
└── mayoral-homepage/                          ← exact same name, no extension
    └── libraries/...
```

Build with:
```bash
cd /tmp/build && zip -r /tmp/mayoral-homepage.zip mayoral-homepage/
```

### 5. Empty PD regions trigger React `errorElement` fallback (double content)

If a PD region (e.g. `headerbanner`) has no components, the SFN `<Region>` component renders the `errorElement` — which often contains the original hardcoded hero. Result: user sees the hardcoded hero AND the PD content stacked.

Fix: every region the route renders MUST have at least one PD component, OR remove the `errorElement` fallback for that region. In Mayoral, the heroCarousel went in `headerbanner` (not `main`) for this reason — `main` only had `popularCategories`.

### 6. `online-flag` syntax differs between shared and site-private

For **shared libraries**, you can scope `online-flag` per assigned site:

```xml
<online-flag site-id="mayoral">true</online-flag>
```

For **site-private libraries**, the library already belongs to one site, so `online-flag` is a plain boolean — adding `site-id="..."` is wrong:

```xml
<online-flag>true</online-flag>
```

Mismatching this against the library type imports without errors but the page stays offline.

---

## Workflow

### Step 1 — Discover the library ID and type (shared vs site-private)

In BM → Content → Libraries. Look for the row with the site name in "Site Assignments". Note the **ID**, not the display name. Also note whether the library is shared (assigned to multiple sites) or private (one site).

Quick CLI check — try both:
```bash
# A) Shared library (e.g. mayoral-SharedLibrary)
b2c content list --library <library-id> --tree

# B) Site-private library (the library ID equals the site ID)
b2c content list --library <siteId> --site-library --tree
```

The one that lists pages is the right form. You'll need the same flags later for `b2c content export`.

Also export an existing page first so you have a known-good XML to mirror:
```bash
b2c content export --library <id> [--site-library] --output _local/pd-export <pageId>
```

This shows you the exact XML namespace, the `online-flag` syntax in use, and the path inside the archive (`libraries/<id>/library.xml` for shared, `sites/<siteId>/library/library.xml` for site-private).

### Step 2 — Discover component types and their attributes

Read the cartridge's experience JSON files to know what types and attributes are available:
```
cartridges/<cartridge>/cartridge/experience/pages/*.json
cartridges/<cartridge>/cartridge/experience/components/<group>/*.json
```

Each JSON defines:
- `region_definitions`: which regions the page/component has (use these as the suffix in `type`)
- `attribute_definition_groups[].attribute_definitions`: which attributes you can set in `data`, with their types

For **string array enums** like `buttonStyle`, the value must be one of the listed strings exactly (`"Primary"`, not `"primary"`).

For type `image`, store as object with `path`/`url` (see gotcha 3).

For type `category`, store as **string** with the category ID (e.g. `"category": "newborn"`).

### Step 3 — Write the library.xml

Use the template at `references/library-template-shared.xml` or `references/library-template-site-private.xml`. Key sections:

1. **Page** with `<type>page.homePage</type>` and `<content-links>` pointing to top-level components in regions
2. **Layout components** (heroCarousel, popularCategories) with their own `<content-links>` to nested children
3. **Content components** (hero slide, popularCategory) with `<data xml:lang="x-default">{...}</data>` containing the actual JSON data

`online-flag` matters: set `<online-flag site-id="<siteId>">true</online-flag>` for the site to render it.

### Step 4 — Get images into the library

Two routes, pick the one that works for your library type:

#### Option A — Bundle images inside the site archive (recommended, works for both library types)

This is the simplest and most reliable approach. Drop the images into the archive's library `static/default/` folder and the same `b2c job import` that loads the XML also publishes the images. No second WebDAV step, no BM-user auth.

For shared libraries:
```
mayoral-homepage/
└── libraries/
    └── mayoral-SharedLibrary/
        ├── library.xml
        └── static/
            └── default/
                └── images/brands/mayoral/<file>.jpg
```

For site-private libraries:
```
bimbaylola-homepage/
└── sites/
    └── bimbaylola/
        └── library/
            ├── library.xml
            └── static/
                └── default/
                    └── images/brands/bimbaylola/<file>.jpg
```

Verify after import:

| Library type   | Public static URL pattern                                                                            |
|----------------|------------------------------------------------------------------------------------------------------|
| Shared         | `https://<host>/on/demandware.static/-/Library-Sites-<libraryId>/default/images/...`                 |
| Site-private   | `https://<host>/on/demandware.static/-/Sites-<siteId>-Library/default/images/...`                    |

A 200 means the image is live; 404 means the archive folder was wrong.

In `library.xml`, reference images as `{"path": "/images/<folder>/<file>"}` — the `path` is library-relative, not site-relative.

#### Option B — Direct WebDAV upload (shared libraries only)

For shared libraries with a working BM user that has WebDAV access, you can upload images independently of the XML. Useful when you want to update images without re-importing the XML.

```bash
HOST="<sandbox>.dx.commercecloud.salesforce.com"
USER="<bm-user>"          # BM user from dw.json — NOT API client_id/secret
PASS='<bm-password>'
LIBPATH="/on/demandware.servlet/webdav/Sites/Libraries/<libraryId>/default/images"

# Create folders
curl -u "${USER}:${PASS}" -X MKCOL "https://${HOST}${LIBPATH}/<folder>"

# Upload file
curl -u "${USER}:${PASS}" -T <local-file> "https://${HOST}${LIBPATH}/<folder>/<file>"
```

This route will **403** for site-private libraries — the WebDAV path `Sites/Sites/<siteId>/Libraries/...` requires permissions that aren't always granted by default. When in doubt or when you hit 403, use Option A.

The `b2c webdav put` command uploads to `Impex/libraries/...` which is the **import staging area**, not the static mount — never use it for live images. It works fine for the site-archive zip itself (Step 5).

### Step 5 — Build, upload, import the archive

Use `references/build-and-import.sh` as a starting point, or run manually:

Shared library example:
```bash
NAME="mayoral-homepage"
LIBID="mayoral-SharedLibrary"
mkdir -p /tmp/build/${NAME}/libraries/${LIBID}/static/default/images
cp library.xml /tmp/build/${NAME}/libraries/${LIBID}/
cp -R public/images/brands/mayoral/* /tmp/build/${NAME}/libraries/${LIBID}/static/default/images/brands/mayoral/
cd /tmp/build && zip -rq /tmp/${NAME}.zip ${NAME}/
```

Site-private library example:
```bash
NAME="bimbaylola-homepage"
SITE="bimbaylola"
mkdir -p /tmp/build/${NAME}/sites/${SITE}/library/static/default/images
cp library.xml /tmp/build/${NAME}/sites/${SITE}/library/
cp -R public/images/brands/bimbaylola/* /tmp/build/${NAME}/sites/${SITE}/library/static/default/images/brands/bimbaylola/
cd /tmp/build && zip -rq /tmp/${NAME}.zip ${NAME}/
```

Then upload + import (same for both):
```bash
# Upload zip to sandbox impex (this IS the right place for site archives)
b2c webdav put /tmp/${NAME}.zip /src/instance/${NAME}.zip

# Import (site-archive job)
b2c job import ${NAME}.zip --remote --wait --show-log

# Verify
b2c content list --library <id> [--site-library] --tree
```

A successful import logs `Import completed: OK`. A schema error means the XML is malformed (usually wrong region encoding or missing `<online-flag>`). If `b2c content list` shows the new tree but BM editor doesn't, hard-refresh the BM tab — Page Designer caches aggressively.

### Step 6 — Publish in BM

The import creates the page as **draft / Offline**. Page Designer doesn't auto-publish.

In BM → Page Designer → site → click your page → button **Publish** (top right).

Until you click Publish, SCAPI returns no page and the storefront falls back to the `errorElement`.

### Step 7 — Verify in the storefront

```bash
cd <project>
pnpm dev
# Open http://localhost:5173/<siteId>/<localeId>
```

If images don't render but text does:
- The component is reading `imageUrl.url`, not `imageUrl.path`. Patch the component (gotcha 3).
- Or the image path is wrong. Test the public static URL directly.

If the page shows the original hardcoded content:
- The page wasn't published, OR
- The `library-id` doesn't match the site's assigned library, OR
- An empty region is triggering the `errorElement` (gotcha 5).

---

## Branded demo specifics

For toolkit-branded sites (Mayoral, Bimba y Lola, etc.):

1. **Find the brand images** at `src/extensions/branding/clients/<client>/content.ts` — these are the URLs the React route was using. They live in `public/images/brands/<client>/` in the cartridge.

2. **Get them into the library** (Step 4). Bundle them in the archive (Option A) unless you already use shared libraries with working BM WebDAV (Option B).

3. **Reuse the original texts** from `content.ts` (titles, subtitles, ctaText, ctaLink). They're already brand-appropriate and localized.

4. **Map the React component data 1:1** — the toolkit-generated content typically has slides with `title`, `subtitle`, `imageUrl`, `imageAlt`, `ctaText`, `ctaLink`. PD's `Content.hero` uses the exact same attribute names.

5. **For featured cards (`featuredCards.primary[]`) prefer `Content.contentCard` inside a `Layout.grid`** — `Content.popularCategory` only takes a category ID and resolves data from the catalog, which loses the curated images and copy. `contentCard` lets you reproduce the React route exactly.

This is the fastest path: hardcoded React → PD takes ~10 minutes if the images and texts already exist in `content.ts`. Validated with Mayoral (shared library) on 2026-05-19 and Bimba y Lola (site-private library) on 2026-05-26.

---

## Reference files

- `references/library-template-shared.xml` — library.xml template for **shared libraries** (Mayoral pattern)
- `references/library-template-site-private.xml` — library.xml template for **site-private libraries** (Bimba y Lola pattern)
- `references/upload-images.sh` — bash helper for direct WebDAV upload (Step 4, Option B)
- `references/build-and-import.sh` — bash helper for the build/upload/import cycle
