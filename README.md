# demo-b2c-commerce

**Meta-orchestrator for end-to-end Salesforce B2C Commerce (Storefront Next) demos.**

Clone one repo, run one bootstrap, then tell Claude Code:

> **"Quiero hacer una demo de B2C Commerce"**

…and a master skill guides you through 11 steps — from an empty sandbox to a
branded storefront with catalog and Page Designer, pushed to Managed Runtime —
doing all the automatable work for you and pausing only where you must act.

---

## The 11-step flow

| # | Step | Owner | How |
|---|------|-------|-----|
| 1 | B2C sandbox available | 🧑 User | manual |
| 2 | Site created in the sandbox | 🧑 User | manual (BM — sites can't be created by import) |
| 3 | Storefront creation process in BM | 🧑 User | manual |
| 4 | Provide SLAS credentials | 🧑 User | manual (stored by name, never in clear) |
| 5 | Deploy the SFN template, wired to the site | 🤖 AI | `dsp-sfn-demo-branding` |
| 6 | Branding + content for the client | 🤖 AI | `dsp-sfn-demo-branding` |
| 7 | Page Designer template (mirrors SFN home) | 🤖 AI | `dsp-sfn-demo-pd-import` |
| 8 | Apply client content to the PD template | 🤖 AI | `dsp-sfn-demo-pd-import` |
| 9 | Build the product catalog (inventory + pricing) | 🤖 AI | `b2c-catalog-onboarding` |
| 10 | Upload catalog to the sandbox | 🤖 AI | `b2c-catalog-onboarding` ⚠ irreversible |
| 11 | Reindex Search + push to MRT | 🤖 AI | `b2c-catalog-onboarding` ⚠ irreversible |

Full detail: [`docs/11-step-flow.md`](./docs/11-step-flow.md).

---

## Architecture — one marketplace, multiple plugins

This repo is a **Claude Code marketplace** that ships the orchestrator and
vendors the specialist skills + tools it drives, so there is no cross-repo
version skew and a single `git clone` gets everything.

```
demo-b2c-commerce/
├── .claude-plugin/marketplace.json     # lists the plugins below
├── plugins/
│   ├── demo-b2c-commerce/              # ✅ master orchestrator skill (this repo)
│   ├── dsp-storefrontnext-demo/        # ⏳ Phase 1 — branding + PD-import skills
│   └── b2c-catalog-onboarding/         # ⏳ Phase 2 — catalog onboarding skill
├── packages/
│   ├── sfn-demo-toolkit/               # ⏳ Phase 1 — npm-linkable CLI (catalog/branding)
│   └── b2c-catalog-onboarding-bff/     # ⏳ Phase 2 — CSV/ZIP → site-archive uploader
├── scripts/
│   ├── bootstrap.sh                    # links toolkit, installs BFF deps, prints register step
│   └── lib/{state.mjs, demo-state.schema.json}
├── templates/demo-state.example.json
└── docs/11-step-flow.md
```

> **Build status:** Phase 0 (this skeleton + master skill + state machine) is
> done. Phases 1–2 vendor the existing assets in. See *Roadmap* below.

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/davidsiguenza/demo-b2c-commerce.git
cd demo-b2c-commerce

# 2. Bootstrap (links the toolkit CLI, installs BFF deps)
./scripts/bootstrap.sh

# 3. Register the marketplace in Claude Code (one time)
#    /plugin add-marketplace github davidsiguenza/demo-b2c-commerce
#    /plugin install demo-b2c-commerce@demo-b2c-commerce

# 4. From your demo working dir, start the flow:
#    "Quiero hacer una demo de B2C Commerce"
```

The master skill creates `demo-state.json` in your working dir on first run and
**resumes** from the first incomplete step every time you re-invoke it.

---

## State & secrets

The flow is driven by **`demo-state.json`** (gitignored) in your working dir,
validated against `scripts/lib/demo-state.schema.json`.

- Inspect the next step: `node scripts/lib/state.mjs next`
- Validate state: `node scripts/lib/state.mjs validate`

**Secret hygiene:** SLAS client id/secret are referenced by **name** (env var /
secret-store key), never written into `demo-state.json` in clear.

---

## Roadmap

- **Phase 0 — ✅ Scaffold.** Master skill, state machine, bootstrap, docs.
- **Phase 1 — Vendor `dsp-storefrontnext-demo`.** Move the branding + PD-import
  skills and the `sfn-demo-toolkit` CLI in (flattening the old double-nesting),
  add both to `marketplace.json`.
- **Phase 2 — Extract the BFF.** Bring in `sfn-marketplace-bff` as the generic
  `b2c-catalog-onboarding-bff` (de-branded), author the `b2c-catalog-onboarding`
  skill. Carry over `BLOCKERS.md` without the `price_book_entries` short-circuit.
- **Phase 3 — Wire E2E.** Connect the master skill to the real sub-skills and
  dry-run on a throwaway sandbox.
- **Phase 4 — Deprecate.** Once E2E passes, archive `sfn-marketplace-bff` and
  re-point/archive the standalone `dsp-storefrontnext-demo`.

## Related repos

| Repo | Relationship |
|------|--------------|
| `davidsiguenza/dsp-storefrontnext-demo` | Source of the branding + PD-import skills (vendored in Phase 1) |
| `davidsiguenza/sfn-marketplace-bff` | Source of the catalog uploader (extracted in Phase 2) |
| `davidsiguenza/sfn-agentforce-b2c-pack` | **Independent** Agentforce add-on — layered on a finished storefront, not part of this flow |

## License

Apache 2.0.
