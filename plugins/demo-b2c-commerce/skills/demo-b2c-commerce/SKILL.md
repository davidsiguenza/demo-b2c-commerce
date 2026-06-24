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

> **A step is NOT `done` just because the work ran.** Some steps have an
> explicit user-facing checkpoint (e.g. step 6 = "the user has SEEN the branded
> storefront"). For those, "done" means *the user confirmed the result*, not
> *the files were written*. A summary line is not a substitute for showing the
> user the actual output. If a validation command fails (e.g. `pnpm dev`
> doesn't boot), the step is **not** done — fix it or report `blocked`, never
> advance on a failed check.

> **Diagnose first, ask the user last.** When something fails mid-flow (SLAS
> token rejected, import returns 0 products, BFF 4xx), do **not** immediately
> tell the user to fix it in BM / the admin UI. The agent already has
> `dw.json`, AM scopes, SLAS creds and WebDAV — that's enough to reproduce
> the failure with `curl` / `b2c` and pinpoint the layer at fault (env-var
> wiring vs runtime config vs server-side SLAS client vs sandbox state).
> Only escalate to the user with a manual BM action **after** the agent
> has proven the issue isn't fixable from the local side. The reverse order
> wastes the user's time and erodes trust — a single past failure (May 2026,
> SLAS token rejected on `zzse-047` because `.env` had the legacy var name)
> was solved by `curl`-ing SLAS first instead of asking the user to add a
> redirect URI to BM.

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
2. **Preflight — detect what's already set up; only ask for what's missing.**
   Don't tell the user to register the marketplace or run bootstrap before
   checking whether it's already done (the common case on a returning machine).
   Check each, silently, and report a short summary:
   - **Sub-skills available?** The fact that *this* skill (`demo-b2c-commerce`)
     ran means the marketplace is registered. Check the two sibling plugins are
     installed by looking them up in `installed_plugins.json` by their
     `<plugin>@<marketplace>` key (the reliable source of truth — the on-disk
     cache path is `cache/<marketplace>/<plugin>/<version>/`, NOT
     `cache/<plugin>/`, so don't `ls` for a bare plugin dir):
     ```bash
     python3 - <<'PY'
     import json, pathlib
     p = json.loads(pathlib.Path.home().joinpath('.claude/plugins/installed_plugins.json').read_text())
     have = set(p.get('plugins', {}))
     for k in ['dsp-storefrontnext-demo@demo-b2c-commerce', 'b2c-catalog-onboarding@demo-b2c-commerce']:
         print(('OK ' if k in have else 'MISSING '), k)
     PY
     ```
   - **Toolkit CLI linked?** `sfn-toolkit --version` (needed for steps 5–9).
   - **BFF deps installed?** `test -d <repo>/packages/b2c-catalog-onboarding-bff/node_modules`
     (needed for steps 10–11).
   - **Sandbox AI access?** (needed for any AI step that touches the sandbox,
     i.e. steps 5+). Check `b2c.access_setup_done` in state; if absent or
     false, run `b2c sites list` and `b2c bm whoami` once when reaching step 4b
     — both must succeed. If they fail with "Access to resource isn't allowed"
     the API client lacks scopes / OCAPI Data Settings. See the Phase-B
     preflight block (between steps 4 and 5) for the full setup.
   - **MRT auth** (needed for step 11 only — re-check right before the push,
     not at flow start). `sfnext` reads MRT credentials from `~/.mobify`
     (default), a `--credentials-file <path>` flag, or `--api-key <key>`.
     **There is NO `sfnext login` subcommand** — do not suggest it. Verify
     with `test -s ~/.mobify`; if missing or stale, the user generates an
     API key at https://runtime.commercecloud.com → avatar menu →
     **Account Settings** → **API Keys**, then writes:
     ```json
     { "username": "<user@salesforce.com>", "api_key": "<key>" }
     ```
     into `~/.mobify` (chmod 600). Defer this until just before step 11.

   Then act on the result:
   - Everything present → say so in one line ("Entorno listo: marketplace +
     3 plugins + toolkit OK") and proceed. **Do not** ask the user to install
     anything.
   - Only some missing → instruct **only** the missing piece (e.g. just
     `./scripts/bootstrap.sh` if the CLI isn't linked, or just the specific
     `/plugin install …@demo-b2c-commerce` for an absent sub-plugin). Don't
     re-issue steps that are already done.
   - A missing piece isn't needed until a later step → note it and continue;
     re-check right before the step that needs it rather than blocking step 1.
3. Announce the plan (the 11 steps, who owns each) once, then begin at the
   first pending step.

> To find the next step deterministically you may run:
> `node scripts/lib/state.mjs next` (prints the first non-done step + owner).
> To validate state after edits: `node scripts/lib/state.mjs validate`.

---

## The 11 steps

Legend: **[USER]** = you pause and wait for the user. **[IA]** = you do it
(usually by invoking a sub-skill).

### Step 1 — [USER] Sandbox + credentials intake `1_sandbox`
> **Front-load everything.** Don't drip-feed credentials across steps 1–4. The
> goal of this step is that, by the time the user marks it done, the agent has
> in hand **every secret and identifier needed to operate the sandbox
> autonomously through step 11** — except for things that genuinely don't
> exist yet (the site id, created in step 2).

Confirm the sandbox is up and Business Manager is reachable, then collect the
batch below with **a single `AskUserQuestion` round** (or two if the form is
big). Group related items so the user can paste them all from their notes /
sandbox provisioning email.

**A — Client & sandbox identifiers** (non-secret, persisted in state):
- `client.name`, `client.source_url`
- `b2c.instance_url` — `<sandbox>.dx.commercecloud.salesforce.com`
- `b2c.shortcode` — 8-char value at BM → Administration → Site Development →
  **Salesforce Commerce API Settings** (NOT under Global Preferences)
- `b2c.organization_id` — the **Organization ID** on the same page
  (e.g. `f_ecom_zzse_262`)
- `b2c.currency` (default `EUR`), `b2c.locale` (default `es-ES`)

**B — Account Manager + BM + WebDAV credentials** (used to generate `dw.json`,
raw values NEVER persisted in state):
- API client id + secret (the one configured in Account Manager for this realm)
- BM username + password
- WebDAV password (per-user, set in BM → My User → Manage WebDAV access)

→ With these, **the agent writes `dw.json` in the demo working dir** (gitignored)
and persists only `b2c.dw_json_path`:
```json
{
  "hostname":      "<instance_url>",
  "client-id":     "<api-client-id>",
  "client-secret": "<api-client-secret>",
  "username":      "<bm-user>",
  "password":      "<bm-pass>",
  "short-code":    "<shortcode>",
  "tenant-id":     "<organization_id without f_ecom_ prefix>"
}
```
chmod 600.

**C — SLAS credentials** (raw values into the SFN repo `.env` when step 5
clones it; until then keep in env vars):
- SLAS `tenant_id` (typically `b2c.organization_id` without the `f_ecom_`
  prefix — confirm with the user)
- SLAS `client_id` + `client_secret` (created in the SLAS Admin UI)

→ Persist only the **env var names** in `slas.client_id_secret` /
`slas.client_secret_secret`. Don't write raw secrets to `demo-state.json`.

> **⚠ Canonical env var names (SFN runtime expects these exact keys).**
> When step 5 writes `.env`, the SFN runtime reads the SLAS client id from
> `PUBLIC__app__commerce__api__clientId` and the SLAS secret from
> `COMMERCE_API_SLAS_SECRET`. Using `SLAS_CLIENT_ID` / `SLAS_CLIENT_SECRET`
> (the legacy names) causes the runtime to fall back to anonymous / fail with
> **"Access token is invalid or revoked"** even though a `curl` against SLAS
> works. Default to the canonical names in `slas.client_id_secret` and
> `slas.client_secret_secret`:
> ```json
> "slas": {
>   "client_id_secret":     "PUBLIC__app__commerce__api__clientId",
>   "client_secret_secret": "COMMERCE_API_SLAS_SECRET"
> }
> ```

**D — Managed Runtime** (used in step 11 — optional now, can be deferred):
- `sfn.mrt_project` slug (leave empty if the project doesn't exist yet —
  it's created on first push)
- `sfn.mrt_environment` (`staging` / `production` / `preview`, default
  `production` if unsure)
- `~/.mobify` API key. If the user already has it set up, mark
  `sfn.mrt_credentials_ready: true`. If not, give the link
  https://runtime.commercecloud.com → Account Settings → API Keys, and
  write `~/.mobify` (chmod 600) with `{ "username": "<email>", "api_key": "<k>" }`.

**Validation before marking done.** Run these end-to-end — they tell you the
intake is complete and step 4b will succeed without further user prompts:
```bash
b2c --config "$DW_JSON_PATH" setup inspect   # dw.json shape OK
b2c --config "$DW_JSON_PATH" auth token >/dev/null  # AM oauth works
# (If sfn.mrt_credentials_ready=true:) test -s ~/.mobify
```

If `auth token` returns a token that only has `mail` scope, that's expected
**now** — scopes get added in step 4b. The point of step 1 is to have all
the **values** captured; scope/OCAPI hardening happens in 4b.

Persist everything, mark `done`.

### Step 2 — [USER] Site in the sandbox `2_site`
The user creates the storefront **Site** in BM (Administration → Sites → Manage
Sites → New). On the **General** page the mandatory fields are: **ID, Name,
Time Zone, Default Currency, Taxation, Customer List** — there is **no locale
field here**. The site **ID** is **case-sensitive** and is reused in every later
step (catalog archive, env profiles), so pick something short with no spaces
(e.g. `bimylol`).

**Only `b2c.site_id` is captured here** — currency/locale already came from the
step-1 intake. Use those as the defaults the user types into BM; only ask
again if the user explicitly diverges from them. Confirm, write, `done`.

> **Locale set on the site after creation.** Merchant Tools → Site Preferences
> → Locales (or via the storefront creation process in step 3). If the user
> picked a non-default locale in BM, update `b2c.locale` here.

> **⚠ Assign a Storefront Catalog now, or the storefront won't render.** A site
> with **no Storefront Catalog assigned** fails to load PLPs/PDPs — and the
> client catalog doesn't exist until step 10. So the site needs *a* catalog
> bound before the step-6 visual checkpoint. Have the user, in **BM → Sites →
> `<siteId>` → Site Configuration**, set:
> - **Storefront Catalog** → an existing catalog in the sandbox (e.g. a sample
>   `storefront-catalog-*` that ships with the realm, or any populated one)
> - **Storefront Inventory List** → an existing inventory list
>
> If the sandbox has no catalog to borrow, this can wait until the client
> catalog is imported in step 10 — but then **warn the user** that PLPs/PDPs
> will be empty/broken during the step-6 branding preview (Home still renders).
> Record what was assigned in the step `note`; step 10 re-points these to the
> client's catalog + inventory list.

> Why manual: the SFCC site-import job **cannot create new sites**. This is a
> hard platform constraint, not a gap in the tooling.

### Step 3 — [USER] Storefront creation process in BM `3_storefront_bm`
The user runs the Storefront Next storefront-creation process in BM (registers
the storefront, SCAPI/SLAS scaffolding). Print the exact BM path and what to
click. Wait for confirmation; `done`.

### Step 4 — [USER] Confirm SLAS credentials `4_slas_creds`
SLAS tenant_id + client_id + client_secret were already collected in the
step-1 intake (section C). **In step 4 just verify they're usable** — don't
re-ask the user unless something is missing.

Verify:
- `slas.tenant_id` is populated (default = `b2c.organization_id` minus the
  `f_ecom_` prefix; confirm with the user if it differs).
- The env vars named in `slas.client_id_secret` / `slas.client_secret_secret`
  resolve in the current shell. Quick check (uses the names from state — do
  NOT hard-code, the canonical pair is
  `PUBLIC__app__commerce__api__clientId` + `COMMERCE_API_SLAS_SECRET`):
  ```bash
  CID_NAME=$(jq -r '.slas.client_id_secret' demo-state.json)
  CSEC_NAME=$(jq -r '.slas.client_secret_secret' demo-state.json)
  test -n "${!CID_NAME:-}" && test -n "${!CSEC_NAME:-}" && echo OK
  ```
- If the variable names came in via a `.env` file the user pasted, source it
  before checking.
- **Live SLAS curl** — prove the creds actually mint a token before declaring
  step 4 done. Saves debugging step 5 / step 6 later:
  ```bash
  curl -sS -X POST "https://${B2C_SHORTCODE}.api.commercecloud.salesforce.com/shopper/auth/v1/organizations/${SLAS_TENANT_ID}/oauth2/token" \
    -u "${!CID_NAME}:${!CSEC_NAME}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&channel_id=${B2C_SITE_ID}" \
    | jq -r '.access_token | (. // "FAIL") | .[0:40]'
  ```
  Must print a token prefix. If it returns `FAIL` / `invalid_client` /
  `unauthorized_client`, the creds themselves are wrong (or the site_id
  channel is not enabled for this SLAS client) — fix that now, don't push
  to step 5 with bad creds.

If anything is missing or the env vars don't resolve, **only then** prompt
for the specific gap. Otherwise mark `done` immediately — the intake already
did the work.

> **Secret hygiene (still mandatory):** never write the raw client id/secret
> into `demo-state.json`. State holds only the **names** of the env vars.

---

### Phase-B preflight — Sandbox autonomy setup `4b_ai_access` *(one-time per sandbox)*

> **The handoff point.** Steps 1–4 are user-owned. Steps 5+ are AI-owned and
> hit the sandbox via `b2c` CLI, OCAPI Data, WebDAV and SCAPI. **Without this
> block, every AI step fails with "Access to resource isn't allowed"** —
> seen first on the Mayoral run (sandbox `zzse-262`, May 2026) and again on
> every new sandbox until the three sub-steps are done.
>
> Run this **before** invoking step 5. Persist `b2c.access_setup_done: true`
> in state once verified so resumes don't re-prompt.

**Sub-step 1 — `dw.json` at the repo root** (created once, gitignored — the
sandbox-specific path lives in `b2c.dw_json_path`):
```json
{
  "hostname":      "<shortcode>.dx.commercecloud.salesforce.com",
  "client-id":     "<api-client-id>",
  "client-secret": "<api-client-secret>",
  "username":      "<bm-username>",
  "password":      "<bm-password>",
  "short-code":    "<short-code>",
  "tenant-id":     "<tenant-id>"
}
```
Verify with `b2c setup inspect` — it must show the hostname and credentials.

**Sub-step 2 — Account Manager scopes on the API client.** The user opens
https://account.demandware.com → API Clients → the client-id from `dw.json` →
adds these scopes (the defaults ship with only `mail`, which generates a token
but rejects every operation):

| Scope              | Enables                              |
|--------------------|--------------------------------------|
| `sfcc.products`    | Catalogs, products, categories       |
| `sfcc.sites`       | Site CRUD                            |
| `sfcc.jobs`        | Triggering import / reindex jobs     |
| `sfcc.orders`      | Order data (demo customer journeys)  |
| `sfcc.customerlists` | Customer list ops                  |

For broader demo work also add `sfcc.retailuser` plus a BM administrator role.

Verify the token actually carries the scopes:
```bash
b2c auth token | python3 -c "import sys,base64,json; t=sys.stdin.read().strip(); p=t.split('.')[1]+'=='; print(json.loads(base64.urlsafe_b64decode(p))['scope'])"
```
Output must list the scopes — not just `['mail']`.

**Sub-step 3 — OCAPI Data API Settings in BM.** BM → Administration → Site
Development → **Open Commerce API Settings** → **Data** tab → add the API
client with the resources the flow uses (sites, jobs, catalogs):
```json
{
  "_v": "25.1",
  "clients": [
    {
      "client_id": "<api-client-id>",
      "resources": [
        { "resource_id": "/sites",                 "methods": ["get","post","put","patch","delete"], "read_attributes": "(**)", "write_attributes": "(**)" },
        { "resource_id": "/sites/**",              "methods": ["get","post","put","patch","delete"], "read_attributes": "(**)", "write_attributes": "(**)" },
        { "resource_id": "/jobs/*/executions",     "methods": ["post"],                              "read_attributes": "(**)", "write_attributes": "(**)" },
        { "resource_id": "/jobs/*/executions/*",   "methods": ["get"],                               "read_attributes": "(**)", "write_attributes": "(**)" },
        { "resource_id": "/catalogs",              "methods": ["get","post","put","patch","delete"], "read_attributes": "(**)", "write_attributes": "(**)" },
        { "resource_id": "/catalogs/**",           "methods": ["get","post","put","patch","delete"], "read_attributes": "(**)", "write_attributes": "(**)" }
      ]
    }
  ]
}
```

**Final verification** (run this before marking `4b_ai_access` done):
```bash
b2c sites list   # must list the sandbox sites
b2c bm whoami    # must return BM user info
```

> **Demo sandbox only.** These broad scopes (`(**)`, all methods) are fine for
> a SE-owned sandbox where Claude needs autonomy. Never propose this shape on
> a customer prod org — there it must be principle-of-least-privilege per
> client-id, audited by the customer's security team.

---

### Step 5 — [IA] Deploy the SFN template `5_deploy_sfn` → skill `dsp-sfn-demo-branding`
First, **ask the user where the SFN template should come from** (AskUserQuestion)
and record the choice in `sfn.template_source`. Three options:

1. **Official, latest** (`kind: official-latest`) — clone
   `SalesforceCommerceCloud/storefront-next-template` at HEAD. The default; use
   when the user wants the newest template.
2. **A specific version / repo** (`kind: git-ref`) — the user gives a git URL
   and a tag/branch/commit (e.g. the official repo at `v0.4.0`, or a fork). Use
   when they need a pinned/known-good version or a custom base.
3. **An existing local copy** (`kind: local-path`) — the user points at an SFN
   repo already on disk (e.g. one produced by the BM storefront-creation process
   in step 3, or a previous download). Use it in place — do not re-clone. Just
   confirm it's a valid SFN repo before patching.

Then invoke the **`dsp-sfn-demo-branding`** skill to scaffold from the chosen
source and wire it to the sandbox site using the SLAS credentials.

- Inputs from state: `client.*`, `b2c.*`, `slas.*`, `sfn.template_source`.
- Scaffold per the source:
  - `official-latest`: `git clone <official-template> <target>`
  - `git-ref`: `git clone <url> <target>` then `git checkout <ref>`
  - `local-path`: use `sfn.template_source.path` directly as `<target>` (skip
    the clone)
  Then `sfn-toolkit upgrade-check` + `sfn-toolkit patch` as the branding skill
  documents. If `upgrade-check` reports drift, **stop** and surface it — don't
  force-apply on an unsupported version (especially likely with a pinned ref or
  a pre-existing local repo).
- Bootstrap `.env` (use `--inherit-env` if the user has an existing working
  `.env`, else fill from the SLAS creds collected in step 4). **The keys
  must be the canonical SFN names**, not the legacy `SLAS_*` aliases:
  ```bash
  PUBLIC__app__commerce__api__clientId=<slas client_id>
  PUBLIC__app__commerce__api__organizationId=<b2c.organization_id, with f_ecom_ prefix>
  PUBLIC__app__commerce__api__shortCode=<b2c.shortcode>
  PUBLIC__app__commerce__api__privateKeyEnabled=true
  COMMERCE_API_SLAS_SECRET=<slas client_secret>
  PUBLIC__app__defaultSiteId=<b2c.site_id>
  ```
- **Output to persist:** `sfn.target_repo_path` (the local clone/path) — this
  feeds steps 7 and 9.
- Validate `pnpm dev` boots and connects to the sandbox before marking `done`.

> **🩺 Troubleshooting "Access token is invalid or revoked" (during dev /
> step 6 visual checkpoint).** This is the #1 symptom of a misconfigured
> `.env`. Diagnose in this order — **do NOT ask the user to touch BM /
> redirect URIs until the first three checks fail**:
> 1. **Env var name mismatch.** Open `.env` and confirm the keys are the
>    canonical SFN names listed above. Older intakes wrote `SLAS_CLIENT_ID` /
>    `SLAS_CLIENT_SECRET`, which the runtime silently ignores. If wrong, fix
>    the `.env`, restart `pnpm dev`, retry.
> 2. **Raw SLAS curl** (uses the same creds the runtime would, bypasses the
>    framework). Token must come back:
>    ```bash
>    curl -sS -X POST "https://${PUBLIC__app__commerce__api__shortCode}.api.commercecloud.salesforce.com/shopper/auth/v1/organizations/${SLAS_TENANT_ID}/oauth2/token" \
>      -u "${PUBLIC__app__commerce__api__clientId}:${COMMERCE_API_SLAS_SECRET}" \
>      -H "Content-Type: application/x-www-form-urlencoded" \
>      -d "grant_type=client_credentials&channel_id=${PUBLIC__app__defaultSiteId}"
>    ```
>    If you get `200` + access_token, the creds and channel are fine — the
>    problem is purely on the runtime side (env-var wiring, restart, port).
> 3. **Restart vs reload.** Vite / sfnext picks `.env` up at process start.
>    After editing `.env`, kill `pnpm dev` and restart — a browser reload is
>    not enough.
> 4. **Only if the curl returns `unauthorized_client` / `invalid_client`**:
>    the SLAS client itself is misconfigured. Then (and only then) the user
>    must open the SLAS Admin UI in BM → Site Development → SCAPI Settings
>    → SLAS → Manage Clients → the client-id → check that the **channel**
>    (`site_id`) is enabled and, for browser flows, that the redirect URI
>    list includes `http://localhost:5173/callback` plus the MRT
>    `https://*.mobify.com/callback`. The agent should not require these
>    just to serve guest-token requests — only for SLAS-public OAuth flows.
>
> The failure mode the user hit (May 2026, sandbox `zzse-047`) was check #1:
> `.env` had `SLAS_CLIENT_SECRET=…` but the runtime expects
> `COMMERCE_API_SLAS_SECRET=…`. Fixed in 0.1.3 by writing the canonical
> names from the step-1 intake.

### Step 6 — [IA] Branding + content `6_branding` → skill `dsp-sfn-demo-branding`
Continue with **`dsp-sfn-demo-branding`** to do the *creative* part for
`client.source_url`: research the brand, hand-write `content.ts` + `theme.css`,
download real customer assets, override brand tokens.

- Inputs: `client.source_url`, `sfn.target_repo_path`.
- Follow the skill's "Claude is the designer" principle — don't trust the
  heuristic scraper for content quality.

> **⛔ MANDATORY VISUAL CHECKPOINT — do NOT mark this step `done`, and do NOT
> proceed to step 7, until the user has SEEN the branded storefront and
> confirmed it.** This is the heart of the whole flow; skipping the review is
> the #1 failure mode. Specifically:
> 1. Start `pnpm dev` and confirm it actually serves (if the default port is
>    busy, pick another and report the real URL — do **not** treat a failed
>    boot as success).
> 2. Give the user the local URL and explicitly ask them to open **Home, a PLP,
>    and a PDP** and confirm the branding looks right (logo, hero, colours,
>    hover states, copy). If PLP/PDP are empty or error, that's the **catalog
>    assignment** (step 2), not the branding — check a Storefront Catalog is
>    bound to the site; Home should render regardless.
> 3. Before handing it over, **run the branding skill's visual QA checklist**
>    (`dsp-sfn-demo-branding` step 7) yourself: hero images text-free and
>    high-res (≥1600px, not an upscaled icon/thumbnail), every featured card has
>    a real image (≥800px), overlay text/CTA pass contrast (no grey-on-grey, no
>    empty grey placeholder cards). Fix any failure before showing the user —
>    don't make them catch defects the checklist covers.
> 4. **Stop and wait.** Only after the user confirms (or after you iterate on
>    `content.ts`/`theme.css` to fix what they flag) do you set `status: done`
>    and persist. If the user wants changes, stay on step 6.

After the user signs off on the branding, **ask whether they want to also build
the home as a Page Designer page** (steps 7–8) — see the gate below.

### Steps 7–8 are OPTIONAL — gate before starting
> **Page Designer is an add-on, not required for a finished branded demo.**
> After step 6 the storefront is already branded (in React). Steps 7–8 re-create
> the home as a **Page Designer** page so it's editable from Business Manager —
> useful to *demo the content-authoring capability*, unnecessary otherwise.
>
> **Ask the user: "¿Quieres además montar el home en Page Designer (editable
> desde BM), o saltamos directos al catálogo?"**
> - If **no** → set steps `7_pd_template` and `8_pd_content` to `status:
>   skipped` (with a note), persist, and jump to **step 9**.
> - If **yes** → proceed with steps 7 and 8 below.

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

### Steps 9–10 are OPTIONAL — gate before starting
> **A real client catalog is an add-on, not required for a finished demo.** The
> storefront already renders with the placeholder Storefront Catalog assigned in
> step 2 — PLPs/PDPs work, just with the sandbox's sample products instead of the
> client's. Building and uploading a real catalog adds realism (real images,
> brand SKUs, prices) but takes the longest of any step (scrape → normalize →
> validate → site-archive → WebDAV → import → reindex) and depends on the source
> site being scrapable.
>
> **Ask the user: "¿Quieres montar el catálogo real del cliente (scrapeo +
> upload), o nos quedamos con el catálogo placeholder asignado en el paso 2?"**
> - If **no** → set steps `9_catalog_build` and `10_catalog_upload` to `status:
>   skipped` (with a note explaining the placeholder catalog stays in place),
>   persist, and jump to **step 11**. In step 11 the reindex sub-step is also
>   skipped (nothing new to index); only the MRT push runs.
> - If **yes** → proceed with steps 9 and 10 below.

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

> **Before configuring the BFF, ask the user:**
> 1. **"¿Creamos un catálogo nuevo (recomendado) o subimos a uno existente?"**
>    Default = new catalog. The placeholder catalog assigned in step 2 is
>    **NOT** the target — it was scaffolding so the storefront would render.
>    The new catalog id should be brand-named (e.g. `<brand>-catalog`); the
>    sfcc import job materializes it on first commit, no need to pre-create.
> 2. **"¿Reutilizamos el pricebook + inventory list del catálogo placeholder, o
>    usas unos nuevos creados en BM?"** Pricebook and inventory list must
>    already exist in the sandbox (import job won't create them). Reusing the
>    placeholder's is the fastest path for a demo; brand-specific ones (e.g.
>    `<brand>-pricebook`, `<brand>-inventory`) are cleaner. Write the chosen
>    ids into `b2c.{catalog_id,pricebook_id,inventory_list_id}` in state.
>
> Persist these answers in `demo-state.json` before invoking the sub-skill, so
> the BFF `.env` reflects the **target** ids — not the placeholder.

- Inputs: catalog artifact (step 9), `b2c.*` (now populated with the **target**
  catalog/pricebook/inventory ids), WebDAV + Account Manager creds.
- **Pricing caveat:** `price_book_entries` is deprecated in OCAPI Data on some
  pods (e.g. `zzse-258`). Treat pricing as **best-effort**: if it fails, set the
  step `note` to the blocker and continue — do NOT hard-fail the whole flow.
- **Re-point the site's bindings to the client catalog.** After the import, the
  site likely still points at the placeholder catalog assigned in step 2. Have
  the user (or do it if API-driven) set **BM → Sites → `<siteId>` → Site
  Configuration → Storefront Catalog / Storefront Inventory List** to the
  client's freshly-imported catalog + inventory list, then reindex (step 11).
  Until this is done the storefront shows the placeholder assortment, not the
  client's.
- Mark `done` (or `blocked` with a note if only pricing failed).

### Step 11 — [IA] Reindex + push to MRT `11_reindex_push` → skill `b2c-catalog-onboarding`
> **⚠ HARD GATE — irreversible / outward-facing.** Confirm with the user before
> the MRT push.

Two parts:
1. **Reindex** so the storefront sees the catalog: trigger the `SearchReindex`
   job and poll to completion (the `b2c-catalog-onboarding` flow does this
   fire-and-forget after import; verify it actually ran).
   **Skip this sub-step if step 10 was skipped** — there's no new catalog to
   index, the placeholder catalog from step 2 is already indexed. Note this
   in the step `note` ("reindex skipped — placeholder catalog only").
2. **Push to MRT**: in the SFN repo (`sfn.target_repo_path`), run the Managed
   Runtime push (`npm run push` / `pnpm push`) for `sfn.mrt_project`. Capture
   the resulting bundle/deployment URL into the step `note`. **Always runs**,
   regardless of whether catalog/PD steps were skipped — this is the final
   deliverable.

   > **⚠ MRT auth is file-based — verify BEFORE the push, not after a 401.**
   > The push reads credentials from `~/.mobify` by default (or `--api-key` /
   > `--credentials-file`). **`sfnext` has no `login` subcommand** — don't
   > tell the user to run one. Verify:
   > ```bash
   > test -s ~/.mobify && cat ~/.mobify | python3 -c "import json,sys; d=json.load(sys.stdin); print('user:', d.get('username')); print('has_key:', bool(d.get('api_key')))"
   > ```
   > - If both fields are present → proceed to the push. If it then 401s, the
   >   key is stale; fall through to the regeneration steps below.
   > - If file missing / empty / no api_key → instruct the user:
   >   1. Open https://runtime.commercecloud.com
   >   2. Avatar menu → **Account Settings** → **API Keys** → generate
   >      a key (or copy an existing one).
   >   3. Write to `~/.mobify` (chmod 600):
   >      ```json
   >      { "username": "<user@salesforce.com>", "api_key": "<key>" }
   >      ```
   >   4. Confirm "done", then proceed.
   >
   > Persist `mrt.credentials_verified: true` in state once a push succeeds so
   > a resume doesn't re-prompt unnecessarily.

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

Claude Code does not auto-install or version-pin sub-plugins. **Detect first,
then instruct only what's missing** (see the preflight in *On invocation*) —
never ask the user to register the marketplace or run bootstrap without checking
whether it's already done. If a sub-skill genuinely isn't available, tell the
user the one command that fixes it; don't attempt the step manually as if the
tooling were present.

## Resume & idempotency

- Re-invoking this skill always resumes at the first non-`done` step.
- Re-running an already-`done` step should be a no-op unless the user explicitly
  asks to redo it (then set it back to `pending` first).
- Persist after **every** state change so a crashed/closed session loses nothing.
