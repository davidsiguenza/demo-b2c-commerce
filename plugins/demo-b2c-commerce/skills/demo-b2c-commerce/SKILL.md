---
name: demo-b2c-commerce
description: Guide a complete, end-to-end Salesforce B2C Commerce (Storefront Next) demo from an empty sandbox to a branded storefront pushed to Managed Runtime (MRT). Orchestrates 11 steps, alternating user-owned manual steps (sandbox, site, SLAS creds) with AI-owned automated steps (deploy SFN, branding, Page Designer, catalog, reindex, push). Use when the user says "quiero hacer una demo de B2C Commerce", "I want to build a B2C Commerce demo", "monta una demo de Storefront Next", "new SFN demo end to end", or similar. This is the master flow — it invokes the dsp-sfn-demo-branding, dsp-sfn-demo-pd-import, and b2c-catalog-onboarding skills as sub-steps.
---

# Demo B2C Commerce — Master Orchestrator

This skill turns *"quiero hacer una demo de B2C Commerce"* into a single guided,
**resumable** flow. It owns a state file, walks 11 ordered steps, and at each
step either **pauses for the user** (manual steps) or **invokes a specialist
sub-skill** (automated steps).

You (Claude) are the conductor. You do **not** re-implement what the sub-skills
already do — you sequence them, pass state between them, and persist progress.

---

## The prime directive: one step at a time

> **Do ONE step, persist state, then stop and report. Never batch steps. Never
> skip ahead.** Long-running manual steps (sandbox provisioning) and irreversible
> automated steps (catalog upload, MRT push) make batching dangerous.

After every step: write `demo-state.json`, print a progress line
(`Paso N/11 ✓ — <qué pasó>. Siguiente: Paso N+1 (<owner>)`), and hand back to
the user before starting the next step.

---

## State file — `demo-state.json`

The flow is driven by `demo-state.json` in the **current working directory**.
Helpers live in `scripts/lib/state.mjs` (zero-dep). Schema:
`scripts/lib/demo-state.schema.json`.

- **Secrets are stored by NAME, never in clear.** `slas.client_id_secret` holds
  the *name* of an env var / secret-store key (e.g. `SLAS_CLIENT_ID`), not the
  value. `demo-state.json` is gitignored.
- Each step has `{ owner: "user" | "ia", status, skill? , note? }`.
  `status ∈ pending | in_progress | done | skipped | blocked`.

### On invocation (do this first, every time)

1. Check for `demo-state.json` in the cwd.
   - **Absent** → create it from `templates/demo-state.example.json` (the
     `state.mjs` `load()` helper does this), then gather the client basics
     (`client.name`, `client.source_url`) with **AskUserQuestion** and write them.
   - **Present** → load it. This is a **resume**: find the first step whose
     status is not `done`/`skipped` and continue there. Tell the user where you
     are picking up.
2. Verify the sub-skill plugins are installed (see *Dependencies* below). If a
   needed sub-skill is missing, stop and instruct the user to run
   `scripts/bootstrap.sh` + register the marketplace.
3. Announce the plan (the 11 steps, who owns each) once, then begin at the
   first pending step.

> To find the next step deterministically you may run:
> `node scripts/lib/state.mjs next` (prints the first non-done step + owner).
> To validate state after edits: `node scripts/lib/state.mjs validate`.

---

## The 11 steps

Legend: **[USER]** = you pause and wait for the user. **[IA]** = you do it
(usually by invoking a sub-skill).

### Step 1 — [USER] B2C sandbox `1_sandbox`
The user must have a B2C Commerce sandbox available (on-demand or provisioned).
Print this checklist, then **ask the user to confirm** the sandbox is up and
they can log into Business Manager. On confirmation: capture
`b2c.instance_url` + `b2c.shortcode`, set status `done`, persist.

### Step 2 — [USER] Site in the sandbox `2_site`
The user creates the storefront **Site** in BM (Administration → Sites → Manage
Sites → New). The site id is **case-sensitive** and must match what the catalog
archive will reference later. Ask for the chosen `site_id`, `currency`, `locale`;
write them; confirm; `done`.

> Why manual: the SFCC site-import job **cannot create new sites**. This is a
> hard platform constraint, not a gap in the tooling.

### Step 3 — [USER] Storefront creation process in BM `3_storefront_bm`
The user runs the Storefront Next storefront-creation process in BM (registers
the storefront, SCAPI/SLAS scaffolding). Print the exact BM path and what to
click. Wait for confirmation; `done`.

### Step 4 — [USER] Provide SLAS credentials `4_slas_creds`
The user provides SLAS credentials so the AI steps can connect the SFN template
to the sandbox. Collect:
- `slas.tenant_id`
- the SLAS **client id** and **client secret**

> **Secret hygiene (mandatory):** do NOT write the raw client id/secret into
> `demo-state.json`. Instead, instruct the user to export them as env vars
> (or place them in the SFN repo `.env`), and store only the **names** in
> `slas.client_id_secret` / `slas.client_secret_secret`. Confirm you can read
> the env vars; then `done`.

---

### Step 5 — [IA] Deploy the SFN template `5_deploy_sfn` → skill `dsp-sfn-demo-branding`
Invoke the **`dsp-sfn-demo-branding`** skill to clone the official Storefront
Next template and wire it to the sandbox site using the SLAS credentials.

- Inputs from state: `client.*`, `b2c.*`, `slas.*`.
- This skill scaffolds the repo (`git clone` template + `sfn-toolkit patch`) and
  bootstraps `.env` (use `--inherit-env` if the user has an existing working
  `.env`, else fill from the SLAS creds collected in step 4).
- **Output to persist:** `sfn.target_repo_path` (the local clone path) — this
  feeds steps 7 and 9.
- Validate `pnpm dev` boots and connects to the sandbox before marking `done`.

### Step 6 — [IA] Branding + content `6_branding` → skill `dsp-sfn-demo-branding`
Continue with **`dsp-sfn-demo-branding`** to do the *creative* part for
`client.source_url`: research the brand, hand-write `content.ts` + `theme.css`,
download real customer assets, override brand tokens.

- Inputs: `client.source_url`, `sfn.target_repo_path`.
- Follow the skill's "Claude is the designer" principle — don't trust the
  heuristic scraper for content quality.
- Mark `done` after a visual check of Home / PLP / PDP in `pnpm dev`.

### Step 7 — [IA] Page Designer template `7_pd_template` → skill `dsp-sfn-demo-pd-import`
Invoke **`dsp-sfn-demo-pd-import`** to create a Page Designer template whose
components mirror the SFN home template (same component set/regions), so the
home can be authored through PD rather than hardcoded in React.

- Inputs: `b2c.site_id`, `sfn.target_repo_path`.
- Discover whether the site uses a **shared** vs **site-private** library first
  (the skill documents the 6 gotchas — read them before writing XML).
- Mark `done` once the empty PD page/components import cleanly.

### Step 8 — [IA] Apply client content to PD `8_pd_content` → skill `dsp-sfn-demo-pd-import`
Continue with **`dsp-sfn-demo-pd-import`** to populate the PD template with the
client content produced in step 6 (hero copy, featured cards, images via WebDAV
or bundled in the archive).

- Inputs: branding content from step 6, `b2c.site_id`.
- Mark `done` after the PD home renders the branded content in the storefront.

### Step 9 — [IA] Build the catalog `9_catalog_build` → skill `b2c-catalog-onboarding`
Invoke **`b2c-catalog-onboarding`** (or, until it exists, the toolkit catalog
scripts) to **acquire** product data from `client.source_url` and produce a
normalized catalog (CSV/ZIP) with inventory + pricing.

- Inputs: `client.source_url`, `b2c.{site_id,currency}`.
- Product-data acquisition (scrape PLP/PDP, download images, enrich) uses the
  `sfn-toolkit` catalog scripts. The **output is a normalized CSV/ZIP** that the
  next step ingests — do not generate the final site-archive here (the BFF does
  that in step 10).
- Persist the catalog artifact path in the step `note`. Mark `done`.

### Step 10 — [IA] Upload catalog to the sandbox `10_catalog_upload` → skill `b2c-catalog-onboarding`
> **⚠ HARD GATE — irreversible.** Before running, summarize exactly what will be
> uploaded (catalog id, # products, target site, pricebook, inventory list) and
> **get explicit user confirmation**. Do not proceed on assumption.

Invoke **`b2c-catalog-onboarding`** to ingest the step-9 artifact: validate →
preview → repackage as site-archive → WebDAV PUT to `/Impex/src/instance/` →
trigger `sfcc-site-archive-import` → poll until `OK`/`FINISHED`.

- Inputs: catalog artifact (step 9), `b2c.*`, WebDAV + Account Manager creds.
- **Pricing caveat:** `price_book_entries` is deprecated in OCAPI Data on some
  pods (e.g. `zzse-258`). Treat pricing as **best-effort**: if it fails, set the
  step `note` to the blocker and continue — do NOT hard-fail the whole flow.
- Mark `done` (or `blocked` with a note if only pricing failed).

### Step 11 — [IA] Reindex + push to MRT `11_reindex_push` → skill `b2c-catalog-onboarding`
> **⚠ HARD GATE — irreversible / outward-facing.** Confirm with the user before
> the MRT push.

Two parts:
1. **Reindex** so the storefront sees the catalog: trigger the `SearchReindex`
   job and poll to completion (the `b2c-catalog-onboarding` flow does this
   fire-and-forget after import; verify it actually ran).
2. **Push to MRT**: in the SFN repo (`sfn.target_repo_path`), run the Managed
   Runtime push (`npm run push` / `pnpm push`) for `sfn.mrt_project`. Capture
   the resulting bundle/deployment URL into the step `note`.

Mark `done`. Print the final summary: storefront URL, catalog status, MRT
bundle. The demo is ready.

---

## Sub-skill invocation contract

- Invoke a sub-skill **by name** via the Skill tool. Pass the relevant slice of
  `demo-state.json` as context.
- Treat each sub-skill as a **black box**: let it run to completion, then write
  its outputs back into `demo-state.json` (notably `sfn.target_repo_path` from
  step 5, catalog artifact path from step 9, MRT bundle from step 11).
- If a sub-skill needs input you don't have in state, gather it with
  **AskUserQuestion**, persist it, then invoke.
- If a sub-skill fails, set the step to `blocked` with a `note`, report to the
  user, and stop — do not silently advance.

## Step → sub-skill map

| Steps | Owner | Sub-skill |
|-------|-------|-----------|
| 1–4   | user  | — (manual, you pause) |
| 5, 6  | ia    | `dsp-sfn-demo-branding` |
| 7, 8  | ia    | `dsp-sfn-demo-pd-import` |
| 9–11  | ia    | `b2c-catalog-onboarding` |

## Dependencies (verify on first run)

This master skill orchestrates sub-skills that live in the same marketplace:

- `dsp-sfn-demo-branding` + `dsp-sfn-demo-pd-import` — plugin
  `dsp-storefrontnext-demo`. Requires the `sfn-toolkit` CLI on PATH
  (`sfn-toolkit --version`). If missing → run `scripts/bootstrap.sh`.
- `b2c-catalog-onboarding` — plugin `b2c-catalog-onboarding` (wraps the
  `b2c-catalog-onboarding-bff`). *Until this plugin is published* (Phase 2),
  fall back to the `sfn-toolkit` catalog scripts for steps 9–11 and tell the
  user that automated upload/reindex is not yet wired.

Claude Code does not auto-install or version-pin sub-plugins. If a sub-skill is
not available, **detect and instruct** — do not attempt the step manually
without telling the user what's missing.

## Resume & idempotency

- Re-invoking this skill always resumes at the first non-`done` step.
- Re-running an already-`done` step should be a no-op unless the user explicitly
  asks to redo it (then set it back to `pending` first).
- Persist after **every** state change so a crashed/closed session loses nothing.
