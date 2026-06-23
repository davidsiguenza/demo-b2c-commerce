# Changelog

All notable changes to `demo-b2c-commerce` are documented here.

## [0.3.0] — Phase 2: Extract the catalog BFF

### Added
- **`b2c-catalog-onboarding-bff`** (`packages/`) — `sfn-marketplace-bff`
  vendored as a generic catalog-import BFF (33 files, no node_modules/uploads/
  .env). De-branded (package renamed; MarketStreet/Santander refs generalized;
  `.env.example` + admin placeholders neutralized). `pnpm typecheck` clean;
  boots and fail-fasts on missing config (Zod-validated).
- **Skill `b2c-catalog-onboarding`** (`plugins/`) — drives steps 9–11: acquire
  product data → flat CSV → BFF (validate/preview/repackage/WebDAV/import) →
  SearchReindex. Registered as the 3rd plugin in `marketplace.json`.
- `bootstrap.sh` now installs the BFF deps (no longer a skipped warning).

### Changed
- `BLOCKERS.md` generalized: `price_book_entries` OCAPI sunset documented as a
  best-effort limitation of *live per-SKU* price edit only — bulk pricing rides
  in via the site-archive import. No short-circuit shipped.

## [0.2.0] — Phase 1: Vendor dsp-storefrontnext-demo

### Added
- **Plugin `dsp-storefrontnext-demo`** vendored into `plugins/dsp-storefrontnext-demo`
  (skills `dsp-sfn-demo-branding` + `dsp-sfn-demo-pd-import`), flattening the old
  `skills/dsp-storefrontnext-demo/skills/*` double-nesting. Registered as the
  second plugin in `marketplace.json`.
- **`sfn-demo-toolkit` CLI** vendored into `packages/sfn-demo-toolkit` (73 files,
  no `node_modules`). `bootstrap.sh` now links it successfully (`sfn-toolkit 0.7.0`).

### Changed
- Branding skill's toolkit-setup references updated from `<plugin-repo>/toolkit`
  to `<demo-b2c-commerce>/packages/sfn-demo-toolkit` + `./scripts/bootstrap.sh`.

## [0.1.0] — Phase 0: Scaffold

The skeleton of the meta-orchestrator.

### Added
- **Master skill** `demo-b2c-commerce` (`plugins/demo-b2c-commerce/skills/`)
  — guides the 11-step B2C Commerce demo flow as a resumable state machine,
  alternating user-owned manual steps with AI-owned automated steps, and
  invoking sub-skills (`dsp-sfn-demo-branding`, `dsp-sfn-demo-pd-import`,
  `b2c-catalog-onboarding`) as sub-steps.
- **State machine** `scripts/lib/state.mjs` (zero-dep) + JSON schema
  `scripts/lib/demo-state.schema.json` + `templates/demo-state.example.json`.
  CLI: `node scripts/lib/state.mjs [validate|next]`.
- **`scripts/bootstrap.sh`** — links the `sfn-demo-toolkit` CLI, installs BFF
  deps, prints the marketplace-registration step. Idempotent; `--check` mode.
- **`.claude-plugin/marketplace.json`** — marketplace manifest (master plugin).
- Docs: `README.md`, `docs/11-step-flow.md`, this changelog.

### Notes
- Phases 1–4 (vendoring the existing skills/toolkit, extracting the catalog
  BFF, end-to-end wiring, deprecating old repos) are tracked in the README
  roadmap and not yet implemented.
