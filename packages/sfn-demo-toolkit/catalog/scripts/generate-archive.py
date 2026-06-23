"""
Build a SFCC site archive from products.json + downloaded images.

Output structure (zip):
  mayoral/
    catalogs/<catalog-id>/
      catalog.xml             (categories + products + assignments)
      static/default/images/  (product images)
    pricebooks/
      pricebook.xml           (single EUR list price)
"""
import json
import os
import re
import shutil
import xml.sax.saxutils as sax
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUTPUT_DIR = BASE / 'archive' / 'mayoral'
CATALOG_ID = 'mayoral-catalog'
PRICEBOOK_ID = 'mayoral-list-prices-EUR'

CATEGORY_LABELS = {
    'newborn':   {'es-ES': 'Recién Nacido', 'en-US': 'Newborn',  'order': 1},
    'baby':      {'es-ES': 'Bebé',          'en-US': 'Baby',     'order': 2},
    'boys':      {'es-ES': 'Niño',          'en-US': 'Boys',     'order': 3},
    'girls':     {'es-ES': 'Niña',          'en-US': 'Girls',    'order': 4},
    'teens':     {'es-ES': 'Pre-Teen',      'en-US': 'Teens',    'order': 5},
}

# Heuristic price by garment type (EUR). Best-effort guess based on slug keywords.
def guess_price(slug: str) -> float:
    s = slug.lower()
    if any(k in s for k in ('vestido', 'americana', 'chaqueta', 'abrigo', 'ceremonia')):
        return 65.00
    if any(k in s for k in ('conjunto-3-piezas', 'conjunto3piezas')):
        return 49.95
    if any(k in s for k in ('conjunto', 'pelele')):
        return 35.95
    if any(k in s for k in ('pantalon-largo', 'pantalon-chino', 'bermuda-vestir')):
        return 29.95
    if 'pantalon' in s or 'bermuda' in s or 'camisa' in s:
        return 24.95
    if 'camiseta' in s or 'polo' in s or 'top' in s:
        return 16.95
    if 'alpargata' in s or 'pepito' in s or 'zapato' in s:
        return 39.95
    return 22.95


def name_es(p):
    return p['name']


def name_en(p):
    """Best-effort English title — keep the Spanish words but capitalise first word."""
    s = p['name']
    # Drop "recien nacido", "bebe", "nino", "nina", "chico", "chica" suffixes
    s = re.sub(r'\b(recien nacido|recien nacida|bebe|nino|nina|chico|chica)\b', '', s, flags=re.I).strip()
    s = re.sub(r'\s+', ' ', s)
    return s[:1].upper() + s[1:]


def description(p):
    cat_es = CATEGORY_LABELS[p['category']]['es-ES']
    return f"{p['name']}. Colección Mayoral {cat_es}. Color {p['color']}."


def description_en(p):
    return f"Mayoral {CATEGORY_LABELS[p['category']]['en-US']} collection. Color {p['color']}."


def x(s):
    """XML-escape."""
    return sax.escape(str(s), {'"': '&quot;'})


def build_catalog_xml(products):
    """Return the catalog.xml content (UTF-8 string).

    Schema (simplified): http://www.demandware.com/xml/impex/catalog/2006-10-31
    """
    # Build a map of category → first product's medium image path
    cat_hero = {}
    for p in products:
        cat = p['category']
        if cat not in cat_hero:
            pid = p['variantId']
            view_nums = sorted(int(k) for k in p['views'].keys())
            cat_hero[cat] = f"{pid}/medium/{pid}-XL-{view_nums[0]}.jpg"

    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append(f'<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31" catalog-id="{CATALOG_ID}">')
    out.append(f'    <header><image-settings><internal-location base-path="/images" /></image-settings></header>')

    # Root category
    out.append('    <category category-id="root">')
    out.append('        <display-name xml:lang="x-default">Mayoral</display-name>')
    out.append('        <display-name xml:lang="es-ES">Mayoral</display-name>')
    out.append('        <display-name xml:lang="en-US">Mayoral</display-name>')
    out.append('        <online-flag>true</online-flag>')
    out.append('    </category>')

    # Sub-categories
    # Note: SFCC catalog XSD enforces a strict child order. <parent> must come
    # right after display-name/description/online-flag/online-from/online-to
    # and BEFORE position/thumbnail/image/etc. <thumbnail>/<image> come after <position>.
    for cat_id, labels in CATEGORY_LABELS.items():
        hero_img = cat_hero.get(cat_id)
        out.append(f'    <category category-id="{cat_id}">')
        out.append(f'        <display-name xml:lang="x-default">{x(labels["en-US"])}</display-name>')
        out.append(f'        <display-name xml:lang="es-ES">{x(labels["es-ES"])}</display-name>')
        out.append(f'        <display-name xml:lang="en-US">{x(labels["en-US"])}</display-name>')
        out.append('        <online-flag>true</online-flag>')
        out.append('        <parent>root</parent>')
        out.append(f'        <position>{labels["order"]}.0</position>')
        if hero_img:
            out.append(f'        <thumbnail>{x(hero_img)}</thumbnail>')
            out.append(f'        <image>{x(hero_img)}</image>')
        out.append('        <custom-attributes>')
        out.append('            <custom-attribute attribute-id="showInMenu">true</custom-attribute>')
        out.append('        </custom-attributes>')
        out.append('    </category>')

    # Products (simple non-variant for now)
    for p in products:
        pid = p['variantId']
        out.append(f'    <product product-id="{x(pid)}">')
        out.append(f'        <ean />')
        out.append(f'        <upc />')
        out.append(f'        <unit />')
        out.append(f'        <min-order-quantity>1</min-order-quantity>')
        out.append(f'        <step-quantity>1</step-quantity>')
        out.append(f'        <display-name xml:lang="x-default">{x(name_en(p))}</display-name>')
        out.append(f'        <display-name xml:lang="es-ES">{x(name_es(p))}</display-name>')
        out.append(f'        <display-name xml:lang="en-US">{x(name_en(p))}</display-name>')
        out.append(f'        <short-description xml:lang="x-default">{x(description_en(p))}</short-description>')
        out.append(f'        <short-description xml:lang="es-ES">{x(description(p))}</short-description>')
        out.append(f'        <short-description xml:lang="en-US">{x(description_en(p))}</short-description>')
        out.append(f'        <long-description xml:lang="x-default">{x(description_en(p))}</long-description>')
        out.append(f'        <long-description xml:lang="es-ES">{x(description(p))}</long-description>')
        out.append(f'        <long-description xml:lang="en-US">{x(description_en(p))}</long-description>')
        out.append(f'        <online-flag>true</online-flag>')
        out.append(f'        <searchable-flag>true</searchable-flag>')
        # Multi-view, multi-size image groups
        # The catalog header declares base-path="/images" and the SFCC engine
        # appends "<image-group-view-type>/<filename>" — but we instead emit
        # the full sub-path on each <image> so the layout under static/default
        # can match exactly what we ship.
        view_nums = sorted(int(k) for k in p['views'].keys())
        out.append(f'        <images>')
        for group_name in ('hi-res', 'large', 'medium', 'small'):
            out.append(f'            <image-group view-type="{group_name}">')
            for view_num in view_nums:
                out.append(f'                <image path="{pid}/{group_name}/{pid}-XL-{view_num}.jpg" />')
            out.append(f'            </image-group>')
        # Swatch: single image per variant (no gallery semantics)
        out.append(f'            <image-group view-type="swatch">')
        primary_view = view_nums[0]  # use first view as the swatch
        out.append(f'                <image path="{pid}/swatch/{pid}-XL-{primary_view}.jpg" />')
        out.append(f'            </image-group>')
        out.append(f'        </images>')
        out.append(f'    </product>')

    # Category assignments (each product to its category)
    for p in products:
        out.append(f'    <category-assignment category-id="{p["category"]}" product-id="{x(p["variantId"])}">')
        out.append(f'        <primary-flag>true</primary-flag>')
        out.append(f'    </category-assignment>')

    out.append('</catalog>')
    return '\n'.join(out)


def build_inventory_xml(products, list_id='mayoral-inventory', stock=50):
    """Build inventory.xml.

    Per the impex/inventory/2007-05-31 schema:
      - <header list-id="..."> (NOT on <inventory-list>)
      - <description> is a simple type — no xml:lang, plain text only
    """
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append('<inventory xmlns="http://www.demandware.com/xml/impex/inventory/2007-05-31">')
    out.append('    <inventory-list>')
    out.append(f'        <header list-id="{list_id}">')
    out.append('            <default-instock>true</default-instock>')
    out.append('            <description>Mayoral demo inventory</description>')
    out.append('            <use-bundle-inventory-only>false</use-bundle-inventory-only>')
    out.append('            <on-order>false</on-order>')
    out.append('        </header>')
    out.append('        <records>')
    for p in products:
        out.append(f'            <record product-id="{x(p["variantId"])}">')
        out.append(f'                <allocation>{stock}</allocation>')
        out.append(f'                <perpetual>false</perpetual>')
        out.append(f'                <ats>{stock}</ats>')
        out.append(f'                <on-order>0</on-order>')
        out.append(f'                <turnover>0</turnover>')
        out.append(f'            </record>')
    out.append('        </records>')
    out.append('    </inventory-list>')
    out.append('</inventory>')
    return '\n'.join(out)


def build_pricebook_xml(products):
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append('<pricebooks xmlns="http://www.demandware.com/xml/impex/pricebook/2006-10-31">')
    out.append(f'    <pricebook>')
    out.append(f'        <header pricebook-id="{PRICEBOOK_ID}">')
    out.append(f'            <currency>EUR</currency>')
    out.append(f'            <display-name xml:lang="x-default">Mayoral List Prices</display-name>')
    out.append(f'            <online-flag>true</online-flag>')
    out.append(f'        </header>')
    out.append(f'        <price-tables>')
    for p in products:
        price = guess_price(p['slug'])
        out.append(f'            <price-table product-id="{x(p["variantId"])}">')
        out.append(f'                <amount quantity="1">{price:.2f}</amount>')
        out.append(f'            </price-table>')
    out.append(f'        </price-tables>')
    out.append(f'    </pricebook>')
    out.append('</pricebooks>')
    return '\n'.join(out)


def main():
    with open(BASE / 'products.json') as f:
        products = json.load(f)

    # Clean and recreate output dir
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)

    catalog_static = OUTPUT_DIR / 'catalogs' / CATALOG_ID / 'static' / 'default' / 'images'
    catalog_static.mkdir(parents=True, exist_ok=True)
    pricebooks_dir = OUTPUT_DIR / 'pricebooks'
    pricebooks_dir.mkdir(parents=True, exist_ok=True)

    # Copy product images preserving the <variantId>/<size>/<file>.jpg layout.
    # The image paths in catalog.xml are relative to catalog static base-path
    # ("/images"), so on disk we mirror exactly what the XML references.
    src_images = BASE / 'images'
    image_count = 0
    for p in products:
        vid = p['variantId']
        src_dir = src_images / vid
        if not src_dir.exists():
            continue
        dst_dir = catalog_static / vid
        shutil.copytree(src_dir, dst_dir)
        # Count copied files
        image_count += sum(1 for _ in dst_dir.rglob('*.jpg'))

    # Write catalog.xml
    catalog_xml = build_catalog_xml(products)
    (OUTPUT_DIR / 'catalogs' / CATALOG_ID / 'catalog.xml').write_text(catalog_xml, encoding='utf-8')

    # Write pricebook.xml
    pricebook_xml = build_pricebook_xml(products)
    (pricebooks_dir / 'pricebook.xml').write_text(pricebook_xml, encoding='utf-8')

    # Write inventory.xml
    inventory_dir = OUTPUT_DIR / 'inventory-lists'
    inventory_dir.mkdir(parents=True, exist_ok=True)
    inventory_xml = build_inventory_xml(products)
    (inventory_dir / 'mayoral-inventory.xml').write_text(inventory_xml, encoding='utf-8')

    print(f'Wrote site archive to: {OUTPUT_DIR}')
    print(f'  catalog.xml — {len(products)} products + 5 categories + assignments')
    print(f'  pricebook.xml — {len(products)} prices in EUR')
    print(f'  inventory-lists/mayoral-inventory.xml — {len(products)} records, 50 units each')
    print(f'  static/default/images/ — {image_count} jpgs (4 sizes per view + swatch)')


if __name__ == '__main__':
    main()
