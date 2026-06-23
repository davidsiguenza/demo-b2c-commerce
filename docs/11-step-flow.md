# The 11-step B2C Commerce demo flow

This is the reference for what each step does, who owns it, the inputs it reads
from `demo-state.json`, and the outputs it writes back. The master skill
(`plugins/demo-b2c-commerce/skills/demo-b2c-commerce/SKILL.md`) is the
authoritative runtime; this doc is the human-readable map.

## Owners

- **🧑 User** — a manual step. The AI prints an exact checklist, then **pauses**
  and waits for the user to confirm before advancing.
- **🤖 AI** — the AI performs it, almost always by invoking a specialist
  sub-skill, then persists the result.

## Golden rule

> One step at a time. Persist `demo-state.json` after each. Never batch.
> Hard confirmation gate before steps 10 and 11 (both irreversible).

---

## Phase A — User sets up the platform (steps 1–4)

### 1. B2C sandbox `1_sandbox`
The user has a working B2C Commerce sandbox and can log into Business Manager.
**Captures:** `b2c.instance_url`, `b2c.shortcode`.

### 2. Site in the sandbox `2_site`
The user creates the storefront Site in BM (Administration → Sites → Manage
Sites → New). The **General** page mandatory fields are ID, Name, Time Zone,
Default Currency, Taxation, Customer List — **no locale field here**. Site ID is
case-sensitive and must match the future catalog archive. **Captures now:**
`b2c.site_id`, `b2c.currency`. **`b2c.locale`** is set later (step 3 / Site
Preferences), not on this page.
*Why manual:* the site-import job cannot create sites — a platform constraint.

### 3. Storefront creation process in BM `3_storefront_bm`
The user runs the Storefront Next storefront-creation process in BM (storefront
registration + SCAPI/SLAS scaffolding).

### 4. Provide SLAS credentials `4_slas_creds`
The user provides SLAS tenant id + client id/secret so the AI can connect the
SFN template. The **tenant id** is the **Organization ID** at BM → Administration
→ Site Development → Salesforce Commerce API Settings (e.g. `f_ecom_zzse_262`),
usually written without the `f_ecom_` prefix (`zzse_262`) — there is no separate
"SLAS Administration → Tenant ID" page. The **client id/secret** are created in
the SLAS Admin UI. **Secret hygiene:** raw id/secret go into env vars / the SFN
`.env`; only their **names** are stored in `slas.client_id_secret` /
`slas.client_secret_secret`.

---

## Phase B — AI builds the storefront (steps 5–8)

### 5. Deploy the SFN template `5_deploy_sfn` → `dsp-sfn-demo-branding`
**First ask the user the template source** (recorded in `sfn.template_source`):
(1) **official latest** — clone `SalesforceCommerceCloud/storefront-next-template`
HEAD; (2) **git-ref** — a specific repo URL + tag/branch; (3) **local-path** —
reuse an SFN repo already on disk (skip the clone). Then `sfn-toolkit patch`,
bootstrap `.env` from the SLAS creds, confirm `pnpm dev` connects to the sandbox.
**Reads:** `client.*`, `b2c.*`, `slas.*`, `sfn.template_source`.
**Writes:** `sfn.target_repo_path`.

### 6. Branding + content `6_branding` → `dsp-sfn-demo-branding`
Research the brand at `client.source_url`; hand-write `content.ts` + `theme.css`;
download real assets; override brand tokens. Visual check Home/PLP/PDP.
**Reads:** `client.source_url`, `sfn.target_repo_path`.

### 7. Page Designer template `7_pd_template` → `dsp-sfn-demo-pd-import`
Create a PD template mirroring the SFN home component set/regions. Discover
shared vs site-private library first (mind the 6 documented gotchas).
**Reads:** `b2c.site_id`, `sfn.target_repo_path`.

### 8. Apply client content to PD `8_pd_content` → `dsp-sfn-demo-pd-import`
Populate the PD template with the step-6 content (hero, featured cards, images
via WebDAV or bundled). Verify the PD home renders branded.

---

## Phase C — AI loads catalog & ships (steps 9–11)

### 9. Build the catalog `9_catalog_build` → `b2c-catalog-onboarding`
Acquire product data from `client.source_url` (scrape PLP/PDP, download images,
enrich) and produce a **normalized CSV/ZIP** with inventory + pricing. Do not
build the final site-archive here — the uploader does that next.
**Reads:** `client.source_url`, `b2c.{site_id,currency}`. **Writes:** artifact
path in the step `note`.

> Data acquisition uses the `sfn-demo-toolkit` catalog scripts; the BFF owns
> ingestion. This split avoids two competing upload paths.

### 10. Upload catalog `10_catalog_upload` → `b2c-catalog-onboarding` ⚠
**Hard gate:** summarize (catalog id, # products, site, pricebook, inventory)
and get explicit confirmation first. Then validate → preview → repackage
site-archive → WebDAV PUT → trigger `sfcc-site-archive-import` → poll to
`OK`/`FINISHED`.
**Pricing caveat:** `price_book_entries` is deprecated in OCAPI Data on some
pods (e.g. `zzse-258`) — treat pricing as best-effort; on failure set the step
`note` and continue rather than hard-failing.

### 11. Reindex + push to MRT `11_reindex_push` → `b2c-catalog-onboarding` ⚠
**Hard gate** (outward-facing). 1) Trigger `SearchReindex` and verify it ran so
the storefront sees the catalog. 2) In `sfn.target_repo_path`, push to Managed
Runtime (`npm run push`) for `sfn.mrt_project`; capture the bundle/deploy URL.
Print the final summary: storefront URL, catalog status, MRT bundle.

---

## Resume semantics

`demo-state.json` is the single source of truth. Re-invoking the master skill
finds the first step not `done`/`skipped` and continues there. A crashed or
closed session loses nothing because state is persisted after every change.

Check the next step any time:

```bash
node scripts/lib/state.mjs next
```
