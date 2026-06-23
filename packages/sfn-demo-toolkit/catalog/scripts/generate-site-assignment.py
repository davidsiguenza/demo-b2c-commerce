"""
Build the meta-data.xml required at the archive root for an EXISTING site.

The SFCC site-import job cannot create new sites — only data assigned to
existing ones. The user creates the site manually in Business Manager
(Administration > Sites > Manage Sites > New) before importing.

NOTE: SiteAssignablePriceBooks / SiteApplicablePriceBooks are NOT standard
preferences in most sandboxes — they result in DATAERROR "Unknown preference"
and are silently skipped. Pricebook assignment must be done manually in BM:
  Merchant Tools → Pricing → Pricebooks → <pricebook-id> → Site Assignments

Storefront catalog and inventory list assignments are also manual in BM:
  Administration → Sites → <site-id> → Storefront Catalog
  Merchant Tools → Products and Catalogs → Inventory → <list-id> → Site Assignments
"""
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
ARCHIVE = BASE / 'archive' / 'mayoral'

SITE_ID = 'mayoral'  # must match the site ID in BM exactly (case-sensitive, usually lowercase)

META_DATA_XML = '''<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">
</metadata>
'''


def main():
    site_dir = ARCHIVE / 'sites' / SITE_ID
    site_dir.mkdir(parents=True, exist_ok=True)

    # Remove any stale preferences.xml or site.xml from previous runs
    for stale in ['preferences.xml', 'site.xml']:
        stale_path = site_dir / stale
        if stale_path.exists():
            stale_path.unlink()
            print(f'Removed stale {stale_path}')

    # Remove old preferences/ subdir if present from previous run
    nested = site_dir / 'preferences'
    if nested.exists():
        shutil.rmtree(nested)

    (ARCHIVE / 'meta-data.xml').write_text(META_DATA_XML, encoding='utf-8')
    print(f'Wrote {ARCHIVE / "meta-data.xml"}')

    # Remove DSPMarketStreet folder if it leaked from earlier runs
    dspms_dir = ARCHIVE / 'sites' / 'DSPMarketStreet'
    if dspms_dir.exists():
        shutil.rmtree(dspms_dir)
        print(f'Removed stale {dspms_dir}')

    print(f'Done. Archive expects an existing site "{SITE_ID}" in the sandbox.')
    print('After import, assign in BM manually:')
    print('  1. Storefront Catalog → mayoral-catalog')
    print('  2. Inventory List → mayoral-inventory')
    print('  3. Pricebook → mayoral-list-prices-EUR (Pricing → Pricebooks → Site Assignments)')


if __name__ == '__main__':
    main()
