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

### 1. Sandbox + credentials intake `1_sandbox`
The user has a working B2C Commerce sandbox AND pastes every credential the
agent will need downstream in **one batch**, so the rest of the flow doesn't
keep asking for things. **Captures (4 groups in a single intake):**
- **A. Identifiers** — `client.{name,source_url}`, `b2c.{instance_url,
  shortcode, organization_id, currency, locale}`
- **B. dw.json creds** (BM, Account Manager, WebDAV) — the agent writes
  `dw.json` (chmod 600, gitignored) and stores only `b2c.dw_json_path`. Raw
  values never enter state.
- **C. SLAS** — `slas.tenant_id` (org_id without `f_ecom_` typically); raw
  client_id/secret go into env vars / SFN `.env`, state holds the names in
  `slas.client_id_secret` / `slas.client_secret_secret`. **Default to the
  canonical SFN runtime names** (`PUBLIC__app__commerce__api__clientId` and
  `COMMERCE_API_SLAS_SECRET`); legacy `SLAS_CLIENT_ID`/`SLAS_CLIENT_SECRET`
  are silently ignored by the runtime and produce "Access token is invalid
  or revoked" in step 6 even when raw curl succeeds.
- **D. MRT** (optional, can be deferred until step 11) — `sfn.mrt_project`,
  `sfn.mrt_environment`, `~/.mobify` API key (sets
  `sfn.mrt_credentials_ready`).

Quick validation: `b2c setup inspect` + `b2c auth token >/dev/null` succeed.
(A token with only `mail` scope is fine here — scopes get added in step 4b.)

### 2. Site in the sandbox `2_site`
The user creates the storefront Site in BM (Administration → Sites → Manage
Sites → New). The **General** page mandatory fields are ID, Name, Time Zone,
Default Currency, Taxation, Customer List — **no locale field here**. Site ID is
case-sensitive and must match the future catalog archive. **Captures now:**
only `b2c.site_id` (currency/locale already came from the intake; update locale
here only if the user diverged in BM).
**⚠ Assign a Storefront Catalog + Inventory List now** (Site Configuration) — a
site with no catalog won't render PLPs/PDPs, and the client catalog doesn't
exist until step 10. Bind an existing sandbox catalog as placeholder; step 10
re-points to the client's.
*Why manual:* the site-import job cannot create sites — a platform constraint.

### 3. Storefront creation process in BM `3_storefront_bm`
The user runs the Storefront Next storefront-creation process in BM (storefront
registration + SCAPI/SLAS scaffolding).

### 4. Confirm SLAS credentials `4_slas_creds`
SLAS tenant + client id/secret were captured in the step-1 intake. This step
only **verifies** they're usable: `slas.tenant_id` non-empty, the env vars
named in `slas.client_id_secret` / `slas.client_secret_secret` resolve in
the current shell. Only re-prompt if something is missing.

### 4b. Phase-B preflight — Sandbox autonomy setup `4b_ai_access` *(one-time per sandbox)*
Before invoking step 5, the AI client needs read/write access to the sandbox
or every later step fails with "Access to resource isn't allowed". Three
sub-steps the user does once: (1) **`dw.json`** at the repo root with hostname,
client-id/secret, BM user/password, short-code, tenant-id; (2) **Account
Manager scopes** on that API client — `sfcc.products`, `sfcc.sites`,
`sfcc.jobs`, `sfcc.orders`, `sfcc.customerlists` (the default is just `mail`);
(3) **OCAPI Data API Settings** in BM (Site Development → Open Commerce API
Settings → Data) adding the client-id with resources `/sites`, `/sites/**`,
`/jobs/*/executions[/*]`, `/catalogs`, `/catalogs/**` (methods `get/post/put/
patch/delete`, attrs `(**)`). Verify with `b2c sites list` + `b2c bm whoami`.
Persist `b2c.access_setup_done: true`. **Demo sandbox only** — never propose
`(**)` on a customer prod org.

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
download real assets; override brand tokens.
**⛔ Mandatory visual checkpoint:** boot `pnpm dev`, give the user the URL, and
**wait for them to confirm** Home/PLP/PDP look right before marking `done`. The
step is done when the *user signs off*, not when the files are written.
**Reads:** `client.source_url`, `sfn.target_repo_path`.

> **Steps 7–8 are OPTIONAL.** After step 6 the storefront is already branded.
> Ask the user whether they also want the home as a Page Designer page (editable
> in BM). If not → mark 7 & 8 `skipped` and jump to step 9.

### 7. Page Designer template `7_pd_template` → `dsp-sfn-demo-pd-import` *(optional)*
Create a PD template mirroring the SFN home component set/regions. Discover
shared vs site-private library first (mind the 6 documented gotchas).
**Reads:** `b2c.site_id`, `sfn.target_repo_path`.

### 8. Apply client content to PD `8_pd_content` → `dsp-sfn-demo-pd-import` *(optional)*
Populate the PD template with the step-6 content (hero, featured cards, images
via WebDAV or bundled). Verify the PD home renders branded.

---

## Phase C — AI loads catalog & ships (steps 9–11)

> **Steps 9–10 are OPTIONAL.** The site already has the placeholder catalog
> assigned in step 2, so PLPs/PDPs render even if we skip the real catalog.
> Ask: "¿Montamos catálogo real del cliente o nos quedamos con el placeholder?"
> If no → mark 9 & 10 `skipped` and in step 11 skip the reindex sub-step (the
> MRT push still runs).

### 9. Build the catalog `9_catalog_build` → `b2c-catalog-onboarding` *(optional)*
Acquire product data from `client.source_url` (scrape PLP/PDP, download images,
enrich) and produce a **normalized CSV/ZIP** with inventory + pricing. Do not
build the final site-archive here — the uploader does that next.
**Reads:** `client.source_url`, `b2c.{site_id,currency}`. **Writes:** artifact
path in the step `note`.

> Data acquisition uses the `sfn-demo-toolkit` catalog scripts; the BFF owns
> ingestion. This split avoids two competing upload paths.

### 10. Upload catalog `10_catalog_upload` → `b2c-catalog-onboarding` ⚠ *(optional)*
**Hard gate:** summarize (catalog id, # products, site, pricebook, inventory)
and get explicit confirmation first. Then validate → preview → repackage
site-archive → WebDAV PUT → trigger `sfcc-site-archive-import` → poll to
`OK`/`FINISHED`.
**Pricing caveat:** `price_book_entries` is deprecated in OCAPI Data on some
pods (e.g. `zzse-258`) — treat pricing as best-effort; on failure set the step
`note` and continue rather than hard-failing.
**Re-point the site bindings** (Site Configuration → Storefront Catalog +
Inventory List) from the step-2 placeholder to the client's imported catalog,
then reindex (step 11).

### 11. Reindex + push to MRT `11_reindex_push` → `b2c-catalog-onboarding` ⚠
**Hard gate** (outward-facing). 1) Trigger `SearchReindex` and verify it ran so
the storefront sees the catalog — **skip this sub-step if step 10 was skipped**
(placeholder catalog is already indexed). 2) **Verify MRT auth FIRST**:
`~/.mobify` must contain `{ "username", "api_key" }` (sfnext has NO `login`
subcommand). If missing/stale, the user generates an API key at
https://runtime.commercecloud.com → avatar → Account Settings → API Keys
and writes it to `~/.mobify` (chmod 600); pause until done. Then push to Managed Runtime (`npm run push`) for
`sfn.mrt_project`; capture the bundle/deploy URL. **The MRT push always runs**,
regardless of whether PD/catalog steps were skipped — this is the final
deliverable. Print the final summary: storefront URL, catalog status, MRT bundle.

---

## Resume semantics

`demo-state.json` is the single source of truth. Re-invoking the master skill
finds the first step not `done`/`skipped` and continues there. A crashed or
closed session loses nothing because state is persisted after every change.

Check the next step any time:

```bash
node scripts/lib/state.mjs next
```
