# Changelog

All notable changes to `demo-b2c-commerce` are documented here.

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
