# sfn-demo-toolkit

Toolkit + Claude Code skill to bootstrap and brand Salesforce Storefront Next (SFN) demos for customers, end-to-end.

## What it does

The toolkit splits responsibility cleanly:

- **CLI (`sfn-toolkit`)** — does the mechanical steps: clones the SFN template, applies a non-invasive branding extension via anchor-based patches, registers per-client files in the right places.
- **Claude (via the [`sfn-brand-demo`](./skill/sfn-brand-demo/SKILL.md) skill)** — does the creative steps: visits the customer site, picks the real images, writes the right copy in the brand's language, designs the palette using the actual hex codes from the customer's HTML.

The result is a per-client folder under `src/extensions/branding/clients/<id>/` with `content.ts`, `theme.css` and an `.env.profiles/<id>.env`. Switching between clients in dev is a single command: `pnpm demo:switch <clientId>`.

See [docs/CLAUDE-BRANDING-PLAYBOOK.md](./docs/CLAUDE-BRANDING-PLAYBOOK.md) for the playbook the skill follows when curating a new client.

## Status

🚧 **Early development — v0.7.0**. F1-F5 working; Mayoral demo end-to-end with multi-image catalog (40 products, 780 jpgs in 5 sizes). See [docs/STATUS.md](./docs/STATUS.md).

| Phase | Goal | Status |
|---|---|---|
| F1 | Toolkit scaffolding + skill skeleton | ✅ |
| F2 | Patches v0.3 + version drift audit + apply | ✅ |
| F3a | Crawler ported + `scrape` command | ✅ |
| F3b | Brand analysis pipeline → BrandContent | ✅ |
| F4 | Apply branding (per-client artifacts) | ✅ |
| F5 | Catalog (reference scripts; CLI wrapper TODO) | 🟢 |
| F6 | Polish, docs, second-client validation | ⏳ |

## Install (when published)

```bash
npm install -g @davidsiguenza/sfn-demo-toolkit
```

For local development:

```bash
git clone https://github.com/davidsiguenza/sfn-demo-toolkit
cd sfn-demo-toolkit
npm link
sfn-toolkit --help
```

## Usage

### Quickstart: brand a new client end-to-end (F1-F4 working today)

```bash
# 1. Clone a fresh SFN template (or use an existing 0.3.x / 0.4.x clone)
git clone https://github.com/SalesforceCommerceCloud/storefront-next-template ~/clients/nike-demo
cd ~/clients/nike-demo

# 2. Apply the branding system (UI targets + extension + demo:switch script)
sfn-toolkit upgrade-check --target .   # confirm 13/13 anchors found
sfn-toolkit patch .

# 3. Scrape and analyze the customer site
sfn-toolkit brand https://nike.com --client-id nike --display-name "Nike"
# → produces .sfn-toolkit/brand/nike/{analysis.json,brand-content.ts,theme.css,profile.env,preview.html}

# 4. Apply the brand into the repo
#    Option A — start from an empty profile (you'll fill in SCAPI creds by hand):
sfn-toolkit apply --target . --brand-dir .sfn-toolkit/brand/nike

#    Option B (Recommended) — inherit SCAPI creds from a working .env you already have
#    (e.g. another client repo, or the DSPMarketStreet sandbox):
sfn-toolkit apply --target . --brand-dir .sfn-toolkit/brand/nike \
  --inherit-env ~/clients/dspms/.env

# 5. (Only if Option A) Edit .env and fill in clientId/organizationId/shortCode/secret/siteId
#    The toolkit cannot guess these — they come from Account Manager + Business Manager.

# 6. Install + boot
pnpm install
pnpm dev
```

### Other useful commands

```bash
sfn-toolkit scrape <url>                            # raw scrape (page.json/html/md)
sfn-toolkit upgrade-check --target <repo>           # detect SFN version drift
pnpm demo:switch <clientId>                         # swap the active client in dev
pnpm demo:list                                      # list available client profiles
```

### Coming soon (F5+)

```bash
sfn-toolkit new <client-id> --url <url> --catalog fashion   # one-shot: clone + patch + brand + apply + catalog
sfn-toolkit catalog generate --industry fashion --client nike
sfn-toolkit catalog import --target . --sandbox zzpm-048
```

## Architecture

```
sfn-demo-toolkit/
├── bin/sfn-toolkit.js        Main CLI router
├── skill/sfn-brand-demo/     Claude Code skill manifest
├── patches/v0.X/             Per-SFN-version patch bundles
│   ├── manifest.json         Anchor regex + supported version range
│   ├── extensions/branding/  The non-invasive extension
│   ├── core-edits/           Anchor-based instructions for core file edits
│   └── scripts/              demo-switch.mjs, etc.
├── crawler/                  URL scraping → branding proposal
├── catalog/                  Product catalog generator + b2c-cli importer
├── audit/                    Version drift detection
└── docs/                     Architecture, extending, troubleshooting
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
