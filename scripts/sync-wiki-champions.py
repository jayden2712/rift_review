#!/usr/bin/env python3
"""Bundle current Wiki champion portraits using URLs discovered in its live catalog.

Run from any directory: python3 scripts/sync-wiki-champions.py
Existing UI slugs are preserved. All images are validated before any are replaced.
"""
import hashlib
import json
import re
import struct
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
HOST = 'https://wiki.leagueoflegends.com'
PAGE = HOST + '/en-us/List_of_champions'


def original_image(source):
    url = urlsplit(urljoin(PAGE, source))
    if url.scheme != 'https' or url.netloc != 'wiki.leagueoflegends.com':
        raise ValueError('Unexpected champion image host')
    path = url.path
    thumbnail = re.fullmatch(r'/en-us/images/thumb/([^/]+_OriginalSquare\.png)/\d+px-\1', path)
    if thumbnail:
        path = '/en-us/images/' + thumbnail[1]
    if not re.fullmatch(r'/en-us/images/[^/]+_OriginalSquare\.png', path):
        raise ValueError('Expected a current champion OriginalSquare PNG')
    return urlunsplit((url.scheme, url.netloc, path, url.query, ''))


class ChampionImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons = {}

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        label = attributes.get('alt', '')
        # The current champion table uses 42px portraits; sidebar and historical lists do not.
        if tag != 'img' or attributes.get('width') != '42' or not label.startswith('An icon representing '):
            return
        name = label.removeprefix('An icon representing ')
        slug = re.sub('[^a-z0-9]', '', name.lower())
        icon = {'wikiName': name, 'url': original_image(attributes.get('src', ''))}
        if slug in self.icons and self.icons[slug] != icon:
            raise ValueError('Conflicting champion catalog entry: ' + name)
        self.icons[slug] = icon


def champion_index(html, minimum=160):
    parser = ChampionImages()
    parser.feed(html)
    if len(parser.icons) < minimum:
        raise ValueError('Wiki did not return the expected champion catalog')
    return parser.icons


def fetch(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'RiftReviewAssetSync/1.0'}), timeout=45) as response:
                final = urlsplit(response.url)
                if final.scheme != 'https' or final.netloc != 'wiki.leagueoflegends.com':
                    raise ValueError('Unexpected redirect host')
                return response.read()
        except (HTTPError, URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def validate_png(data):
    if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', data[16:24]) != (128, 128):
        raise ValueError('Expected an unmodified 128×128 champion PNG')


def download(entry):
    slug, source = entry
    data = fetch(source['url'])
    validate_png(data)
    return slug, data, {**source, 'provider': 'League of Legends Wiki',
                        'sha256': hashlib.sha256(data).hexdigest()}


def main():
    catalog = champion_index(fetch(PAGE).decode('utf-8'))
    destinations = sorted((ROOT / 'public/champions').glob('*.png'))
    missing = sorted(path.stem for path in destinations if path.stem not in catalog)
    if not destinations or missing:
        raise ValueError('Champion catalog missing existing UI slugs: ' + ', '.join(missing))
    with ThreadPoolExecutor(max_workers=4) as pool:
        images = list(pool.map(download, [(path.stem, catalog[path.stem]) for path in destinations]))
    manifest = {'page': PAGE, 'retrievedAt': datetime.now(timezone.utc).isoformat(),
                'champions': {slug: source for slug, _, source in images}}
    for slug, data, _ in images:
        (ROOT / 'public/champions' / (slug + '.png')).write_bytes(data)
    (ROOT / 'scripts/champion-icon-sources.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Updated {len(images)} champion portraits from League Wiki; no fallback sources.')


if __name__ == '__main__':
    main()
