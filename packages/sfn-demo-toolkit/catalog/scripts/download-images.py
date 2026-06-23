"""
Download all product images in 5 SFCC-friendly sizes.

For every (variantId, view) pair we download:
  hi-res   2200w
  large    1200w
  medium    600w
  small     280w
  swatch     80w

Output: images/<variantId>/<size>/<variantId>-XL-<view>.jpg
"""
import json
import subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent
PRODUCTS_PATH = BASE / 'products.json'
IMAGES_DIR = BASE / 'images'

UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
)

# (group, width). Cloudinary delivers any width on demand.
SIZES = [
    ('hi-res', 2200),
    ('large',  1200),
    ('medium',  600),
    ('small',   280),
    ('swatch',   80),
]


def main():
    products = json.loads(PRODUCTS_PATH.read_text())

    # Wipe and recreate to avoid stale files
    if IMAGES_DIR.exists():
        import shutil
        shutil.rmtree(IMAGES_DIR)
    IMAGES_DIR.mkdir()

    total = 0
    for p in products:
        vid = p['variantId']
        product_dir = IMAGES_DIR / vid
        for size_name, _w in SIZES:
            (product_dir / size_name).mkdir(parents=True, exist_ok=True)

        for view_str, view_meta in sorted(p['views'].items(), key=lambda kv: int(kv[0])):
            view_num = int(view_str)
            slug = view_meta['slug']
            version = view_meta['version']
            for size_name, w in SIZES:
                out_path = product_dir / size_name / f'{vid}-XL-{view_num}.jpg'
                if out_path.exists() and out_path.stat().st_size > 1500:
                    continue
                url = (
                    f'https://assets.mayoral.com/images/'
                    f'f_auto,q_auto,w_{w}/{version}/{vid}-XL-{view_num}/{slug}.jpg'
                )
                subprocess.run(
                    ['curl', '-sLA', UA, url, '-o', str(out_path)],
                    capture_output=True,
                )
                if out_path.exists() and out_path.stat().st_size > 1500:
                    total += 1
        print(f'{vid}: {len(p["views"])} views × {len(SIZES)} sizes = {len(p["views"]) * len(SIZES)} images')

    print(f'\nDownloaded {total} images total in {IMAGES_DIR}')


if __name__ == '__main__':
    main()
