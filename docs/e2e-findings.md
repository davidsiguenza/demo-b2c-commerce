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
