# E2E findings — corrections from live demo runs

A running log of BM-path / wording corrections discovered while running the
master flow against a real sandbox. Each entry is already folded into the
master skill + docs; this file is the trace so the same mistake doesn't recur.

## 2026-06-23 — first E2E run (sandbox ZZSE_262, client Bimba y Lola)

| # | Step | Wrong (as the skill said) | Correct (verified in BM) |
|---|------|---------------------------|--------------------------|
| 1 | 1 — shortcode | "BM → Global Preferences → Salesforce Commerce API Settings" | **BM → Administration → Site Development → Salesforce Commerce API Settings** (field **Short Code**, e.g. `kv7kzm78`) |
| 2 | 2 — site creation | Asked for a "Default locale" on the creation page | The **General** page has only **ID, Name, Time Zone, Default Currency, Taxation, Customer List** — **no locale field**. Locale is set later (Site Preferences / storefront creation). |
| 3 | 4 — SLAS tenant id | "BM → Global Preferences → SLAS Administration → Tenant ID" (does not exist) | The SLAS tenant = the **Organization ID** at **Site Development → Salesforce Commerce API Settings** (e.g. `f_ecom_zzse_262`), usually written without the `f_ecom_` prefix (`zzse_262`). Same page as the Short Code. |

**Pattern noticed:** several B2C admin values the skill needs (Short Code,
Organization ID) live together on **one page**: *Administration → Site
Development → Salesforce Commerce API Settings*. The skill previously scattered
them across non-existent "Global Preferences" paths. When in doubt about where a
SCAPI/SLAS identity value lives, that page is the first place to point the user.

### Behavioural finding — step 6 branding "invisible" to the user

Symptom: the user felt the agent skipped branding and jumped straight to Page
Designer. Transcript analysis (`~/demo-state.json` + session log) showed the
branding **was actually done** (logo, heroes, amber tokens, es-ES copy; 23
`content.ts` + 15 `theme.css` touches, `sfn-toolkit apply` ran) and marked
`6_branding: done` — but the agent **never paused to show it**: it printed a
summary line and chained 5→6→7, and `pnpm dev` had even failed on a busy port
5173 without blocking progress.

Root cause: step 6 said "mark done after a visual check" but didn't make the
checkpoint a hard stop. Fixes applied:
- **Mandatory visual checkpoint** in step 6: boot `pnpm dev` (real URL, not a
  failed boot), hand the user the URL, and **wait for sign-off** before `done`.
- **Prime-directive clarification**: "a step is not done just because the work
  ran" — done means the user confirmed; a failed validation = `blocked`, never
  advance.
- **Steps 7–8 (Page Designer) made optional**: after branding, ask the user
  whether to also build the PD home; if not, mark 7 & 8 `skipped` → jump to
  step 9.

**Pattern noticed:** any step with a user-facing artifact (branded storefront,
catalog preview) needs an explicit "show it and wait" gate. A progress summary
is not proof the user saw the result. Audit other steps for the same gap.

### Sequencing finding — site needs a Storefront Catalog before the step-6 preview

A site with **no Storefront Catalog assigned** doesn't render PLPs/PDPs. But the
client's catalog isn't created until step 10 — so the step-6 visual checkpoint
(open Home/PLP/PDP) would show broken product pages on a brand-new site.

Fix: **step 2 now assigns a placeholder catalog + inventory list** (an existing
one in the sandbox) via BM → Sites → `<siteId>` → Site Configuration, so the
storefront renders during branding. **Step 10 re-points** those bindings to the
client's freshly-imported catalog. Step 6's checkpoint now also tells the agent
that an empty PLP/PDP is a *catalog-assignment* issue, not a branding failure
(Home renders regardless).

### Visual-quality finding — recurring branding defects (Bimba y Lola home)

The branded home showed three defects that are common enough to encode as rules:
1. **Text baked into the hero image** ("REBAJAS ONLINE Y EN TIENDAS") clashing
   with the component's own overlaid title → text-on-text, illegible.
2. **Low-contrast text/CTA** — grey "Comprar" and card subtitles unreadable over
   pale backgrounds.
3. **A featured card with no image** ("Accesorios" rendered an empty grey box)
   while siblings had photos.

Fix — added to the `dsp-sfn-demo-branding` skill, both as **prevention** (step 6
asset-selection + theme rules) and **detection** (a mandatory **visual QA
checklist** in step 7 the agent must pass before declaring branding done):
hero images must be text-free; every featured card must have a real image
(drop the card otherwise); overlay text/CTA must pass contrast (scrim if
needed); no grey-on-grey; no empty placeholders. The master flow's step-6
checkpoint runs this checklist before showing the user.

**Pattern noticed:** "quality" defects that recur across clients (text-in-image,
contrast, missing images) belong in the skill as an explicit pass/fail
checklist, not as vague "make it look good" guidance. When the user spots a new
class of defect, add it as a checklist item here so it's caught automatically
next time.

### Setup finding — preflight should detect what's already installed

The skill told the user to register the marketplace / run bootstrap without
checking whether it was already done — friction on a returning machine. Added an
idempotent **preflight** to "On invocation": the fact that the master skill ran
proves the marketplace is registered; check the sibling plugins via the plugin
cache (`~/.claude/plugins/cache/<plugin>`), `sfn-toolkit --version`, and the
BFF's `node_modules`; then instruct **only** the missing piece (and only when
the step that needs it is reached). On this machine the check revealed
`b2c-catalog-onboarding` was absent (published in Phase 2, after the marketplace
was first registered) while the other two were present — exactly the
partial-setup case the preflight now handles with a single targeted
`/plugin install b2c-catalog-onboarding@demo-b2c-commerce`.

**Correction (same session):** the first version of the preflight checked the
wrong path — `~/.claude/plugins/cache/<plugin>/`. Plugins installed from a
marketplace actually live at `cache/<marketplace>/<plugin>/<version>/`, and the
reliable source of truth is `~/.claude/plugins/installed_plugins.json` →
`.plugins["<plugin>@<marketplace>"]`. After the user installed the catalog
plugin, the bare-cache check still reported it missing (false negative); the
preflight now reads `installed_plugins.json` instead. Verified all three present:
`demo-b2c-commerce@…`, `dsp-storefrontnext-demo@…`, `b2c-catalog-onboarding@…`.

### Image-resolution finding — small images stretched into large slots

A small image/icon (e.g. a 32–64px icon or a thumbnail) wired into a full-width
banner or card slot renders blurry/pixelated. Added objective size thresholds
to `dsp-sfn-demo-branding` (prevention + checklist): hero ≥ 1600px wide, card
≥ 800px, logo prefer SVG / ≥ 2× rendered size. Verify with
`sips -g pixelWidth -g pixelHeight <file>`; never upscale — pull a larger source
from the brand CDN (bump the `w=`/size token), and never use an icon/sprite/
favicon URL as a banner image.
