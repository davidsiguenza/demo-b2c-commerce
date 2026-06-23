"""
Extract Mayoral product variants from scraped PLP HTML.

For each category:
  - Parse all asset URLs in the PLP page
  - Group by variantId (sku-color, e.g. "26-01267-090")
  - Pick one representative image URL per variant (the one we actually saw)
  - Derive a human-friendly product name from the slug
  - Pick 8 variants per category, prefer those whose master id is unique

Output: products.json with the selected 40 products.
"""
import json
import os
import re
from collections import OrderedDict

CATEGORIES = ['newborn', 'baby', 'boys', 'girls', 'teens']
PRODUCTS_PER_CATEGORY = 8


def slug_to_name(slug: str) -> str:
    """Convert 'conjunto-pantalon-corto-tirantes-y-camisa-recien-nacido-aqua-XL-4'
    into 'Conjunto pantalón corto tirantes y camisa - aqua'.
    """
    # strip trailing -XL-N
    s = re.sub(r'-XL-\d+$', '', slug)
    # find color tokens after the category indicator
    parts = s.split('-')
    # try to detect color (usually last 1-2 words before XL-N): keep all words for now
    # keep capitalisation friendly:
    nice = ' '.join(parts)
    # Common Spanish chars: 'pantalon' → 'pantalón', 'algodon' → 'algodón' (best effort)
    replacements = {
        'pantalon': 'pantalón',
        'camison': 'camisón',
        'camara': 'cámara',
        'algodon': 'algodón',
        'leon': 'león',
        'corazon': 'corazón',
        'terciopelo': 'terciopelo',
    }
    for k, v in replacements.items():
        nice = re.sub(rf'\b{k}\b', v, nice)
    return nice[:1].upper() + nice[1:]


def extract_color_from_slug(slug: str) -> str:
    """Best-effort: the color word usually appears just before the size (-XL-N)."""
    s = re.sub(r'-XL-\d+$', '', slug)
    # Take the last token (often color), but skip if it's a number
    tokens = s.split('-')
    # Common color tokens we know are colors
    known_colors = {
        'aqua', 'topo', 'cielo', 'manzana', 'regata', 'ceramica', 'sunny', 'azul',
        'terracota', 'crudo', 'anacardo', 'avena', 'beige', 'rosa', 'verde', 'blanco',
        'negro', 'gris', 'naranja', 'amarillo', 'morado', 'fucsia', 'turquesa',
        'lavanda', 'salmon', 'coral', 'arena', 'oliva', 'mostaza', 'mar', 'oceano',
        'piedra', 'marino', 'mezcla', 'malva', 'menta', 'paja', 'lila',
    }
    for t in reversed(tokens):
        if t in known_colors:
            return t
    return tokens[-1] if tokens else 'default'


def parse_plp(html: str, category: str):
    """Extract unique variants with their actual image URLs and PDP URLs.

    Mayoral exposes multiple views per variant via XL-1..XL-N. The PLP HTML
    only preloads 1-2 views per variant; we capture them, plus the PDP URL
    so a later pass can fetch the full set from each product page.
    """
    img_pattern = re.compile(
        r'https://assets\.mayoral\.com/images/t_web_plp_750/[^"]+?/(v\d+)/(\d+-\d+-\d+)-XL-(\d+)/([^."]+)\.jpg'
    )
    pdp_pattern = re.compile(
        r'href="(/es/es/[a-z0-9-]+-(\d{10})-\d)"'
    )

    seen_variants: dict[str, dict] = OrderedDict()
    for match in img_pattern.finditer(html):
        version = match.group(1)
        variant_id = match.group(2)
        view_num = int(match.group(3))
        slug = match.group(4)

        if variant_id not in seen_variants:
            seen_variants[variant_id] = {
                'variantId': variant_id,
                'masterId': '-'.join(variant_id.split('-')[:2]),
                'colorCode': variant_id.split('-')[2],
                'slug': re.sub(r'-XL-\d+$', '', slug),
                'name': slug_to_name(slug),
                'color': extract_color_from_slug(slug),
                'pdpUrl': None,
                'views': {},  # view_num → {version, slug}
                'category': category,
            }
        seen_variants[variant_id]['views'][view_num] = {'version': version, 'slug': slug}

    # Map PDP URLs to variants by their numeric id
    for match in pdp_pattern.finditer(html):
        path = match.group(1)
        numeric_id = match.group(2)
        # Reconstruct variant id with dashes: 2601267090 → 26-01267-090
        variant_id = f'{numeric_id[:2]}-{numeric_id[2:7]}-{numeric_id[7:]}'
        if variant_id in seen_variants and seen_variants[variant_id]['pdpUrl'] is None:
            seen_variants[variant_id]['pdpUrl'] = f'https://www.mayoral.com{path}'

    return list(seen_variants.values())


def select_products(variants: list, n: int) -> list:
    """Pick n products preferring variety: one variant per master."""
    seen_masters = set()
    selected = []
    # First pass: one per master
    for v in variants:
        if v['masterId'] not in seen_masters:
            seen_masters.add(v['masterId'])
            selected.append(v)
            if len(selected) >= n:
                return selected
    # Second pass: fill with remaining variants
    for v in variants:
        if v not in selected:
            selected.append(v)
            if len(selected) >= n:
                break
    return selected[:n]


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    all_products = []
    for cat in CATEGORIES:
        plp_path = os.path.join(base, 'plp-data', cat, 'page.html')
        with open(plp_path) as f:
            html = f.read()
        variants = parse_plp(html, cat)
        selected = select_products(variants, PRODUCTS_PER_CATEGORY)
        all_products.extend(selected)
        print(f'{cat}: {len(variants)} total variants → selected {len(selected)}')

    out_path = os.path.join(base, 'products.json')
    with open(out_path, 'w') as f:
        json.dump(all_products, f, ensure_ascii=False, indent=2)
    print(f'\nWrote {len(all_products)} products → {out_path}')


if __name__ == '__main__':
    main()
