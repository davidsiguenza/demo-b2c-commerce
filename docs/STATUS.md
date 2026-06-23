# Status

Snapshot of where `demo-b2c-commerce` stands. For the running list of live-run
corrections see [`e2e-findings.md`](./e2e-findings.md); for the flow itself see
[`11-step-flow.md`](./11-step-flow.md).

_Last updated: 2026-06-23._

## Build phases

| Phase | What | Status |
|-------|------|--------|
| 0 | Scaffold: marketplace.json, master skill + state machine, `state.mjs`+schema+template, `bootstrap.sh`, docs | ✅ done |
| 1 | Vendor `dsp-storefrontnext-demo` skills + `sfn-demo-toolkit` CLI (double-nesting flattened) | ✅ done |
| 2 | Extract `sfn-marketplace-bff` → `b2c-catalog-onboarding-bff` (de-branded) + `b2c-catalog-onboarding` skill | ✅ done |
| 3 | End-to-end validation against a real sandbox | 🔄 in progress |
| 4 | Deprecate old standalone repos (only after E2E passes) | ⏳ pending |

The repo is **public** on GitHub. All three plugins are registered in
`marketplace.json`; `bootstrap.sh` links the toolkit (`sfn-toolkit 0.7.0`) and
installs the BFF deps.

## Phase 3 — E2E validation (in progress)

First live run: sandbox **zzse-262**, client **Bimba y Lola**. The happy path
through steps 1–6 works; the run surfaced **7 corrections**, all applied and
logged in `e2e-findings.md`:

1. Shortcode lives under **Site Development**, not Global Preferences.
2. The BM site-creation page has **no locale field** (locale set later).
3. The **SLAS tenant id is the Organization ID** (same page as the shortcode).
4. Step 5 now **lets the user choose the SFN template source** (official latest / git-ref / existing local repo).
5. **Mandatory visual checkpoint** on branding (step 6) + **Page Designer made optional** (steps 7–8) — the agent was doing the branding but never pausing to show it.
6. **Assign a Storefront Catalog at site creation** (placeholder) so PLPs/PDPs render before the client catalog exists (step 10 re-points the bindings).
7. **Visual QA checklist** for branding: text-free heroes, contrast, every card has an image, minimum image resolution.

Plus an **idempotent preflight** on invocation: detect what's already installed
(marketplace via the running skill, sibling plugins via
`~/.claude/plugins/installed_plugins.json`, `sfn-toolkit --version`, BFF deps)
and ask only for what's missing.

### Not yet exercised
- **Steps 9–11 (catalog)** — first real use of the `b2c-catalog-onboarding`
  skill + the extracted BFF. Needs the BFF's `.env` filled (Account Manager +
  WebDAV creds for the sandbox) and `pnpm install` in
  `packages/b2c-catalog-onboarding-bff` (or run `./scripts/bootstrap.sh`).
- **Step 11 MRT push** — end of the flow.

## Next session

1. Run a full E2E from zero in a fresh session ("Quiero hacer una demo de B2C
   Commerce") against zzse-262.
2. Validate the catalog leg (steps 9–11) for the first time.
3. Capture any new corrections in `e2e-findings.md`.
