"""
Enrich products.json with all available views from each product's PDP.

PLPs only preload 1-2 views per variant. PDPs expose 4-6 views (front, back,
detail, lifestyle, model). We fetch each PDP via Playwright (sfn-toolkit
scrape) and parse all XL-N URLs into views[N] = {version, slug}.

Skips PDPs we've already enriched (resumable).
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
PRODUCTS_PATH = BASE / 'products.json'
PDP_CACHE_DIR = BASE / 'pdp-cache'

PDP_CACHE_DIR.mkdir(exist_ok=True)


def fetch_pdp_html(url: str, variant_id: str) -> str:
    """Fetch a PDP via the toolkit's scraper. Returns the rendered HTML.

    Caches per variantId so we can resume on retry.
    """
    cache_path = PDP_CACHE_DIR / f'{variant_id}.html'
    if cache_path.exists() and cache_path.stat().st_size > 50_000:
        return cache_path.read_text()

    out_dir = PDP_CACHE_DIR / f'{variant_id}-tmp'
    result = subprocess.run(
        ['sfn-toolkit', 'scrape', url, '--wait-for', '3500', '--out', str(out_dir)],
        capture_output=True, text=True,
    )
    page_html = out_dir / 'page.html'
    if not page_html.exists():
        print(f'  fetch failed for {variant_id}: {result.stderr[:200]}')
        return ''
    html = page_html.read_text()
    cache_path.write_text(html)
    # Cleanup tmp
    for f in out_dir.glob('*'):
        f.unlink()
    out_dir.rmdir()
    return html


def parse_views(html: str, variant_id: str) -> dict:
    """Find every XL-N view for the given variant in HTML."""
    pattern = re.compile(
        rf'https://assets\.mayoral\.com/images/[^"]*?(v\d+)/{re.escape(variant_id)}-XL-(\d+)/([^."]+)\.jpg'
    )
    views = {}
    for match in pattern.finditer(html):
        version = match.group(1)
        view_num = int(match.group(2))
        slug = match.group(3)
        if view_num not in views:
            views[view_num] = {'version': version, 'slug': slug}
    return views


def main():
    products = json.loads(PRODUCTS_PATH.read_text())
    total = len(products)

    for i, p in enumerate(products, 1):
        url = p.get('pdpUrl')
        variant_id = p['variantId']
        if not url:
            continue

        before = len(p.get('views', {}))
        print(f'[{i}/{total}] {variant_id}  (had {before} views)', end=' ', flush=True)

        html = fetch_pdp_html(url, variant_id)
        if not html:
            print('— skipped')
            continue

        new_views = parse_views(html, variant_id)
        if new_views:
            # Merge: keep existing if present, add new ones
            merged = {**p.get('views', {}), **{str(k): v for k, v in new_views.items()}}
            p['views'] = merged
        after = len(p['views'])
        print(f'→ {after} views ({sorted(int(k) for k in p["views"].keys())})')

    PRODUCTS_PATH.write_text(json.dumps(products, ensure_ascii=False, indent=2))
    print()
    from collections import Counter
    counts = Counter(len(p['views']) for p in products)
    print(f'Done. View distribution: {dict(counts)}')


if __name__ == '__main__':
    main()
