"""Vendor rune and rank PNGs resolved from current League Wiki pages.

Normal builds remain offline. Run explicitly with Python 3; missing Wiki matches
abort instead of silently retaining older repository artwork.
"""
import argparse
import concurrent.futures
import hashlib
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://wiki.leagueoflegends.com'
PAGES = {'rune': ORIGIN + '/en-us/Rune', 'rank': ORIGIN + '/en-us/Rank_(League_of_Legends)'}
STYLES = {'Precision', 'Domination', 'Sorcery', 'Resolve', 'Inspiration'}
SHARD_NAMES = {'5001': 'Health Scaling', '5002': 'Armor', '5003': 'Magic Resistance'}
RANKS = ('IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER')
PNG = b'\x89PNG\r\n\x1a\n'


def normalized(value):
    return re.sub('[^a-z0-9]', '', value.lower())


def original_image(src):
    """Expand only observed Wiki PNG thumbnails, with a matching thumbnail name."""
    url = urlsplit(urljoin(ORIGIN, src))
    if url.scheme != 'https' or url.netloc != 'wiki.leagueoflegends.com':
        return None
    path = url.path
    thumbnail = re.fullmatch(r'/en-us/images/thumb/([^/]+\.png)/\d+px-([^/]+\.png)', path)
    if thumbnail:
        if thumbnail[1] != thumbnail[2]:
            return None
        path = '/en-us/images/' + thumbnail[1]
    if not re.fullmatch(r'/en-us/images/[^/]+\.png', path):
        return None
    filename = unquote(path.rsplit('/', 1)[1])
    if '/' in filename or '\\' in filename or '..' in filename:
        return None
    return urlunsplit((url.scheme, url.netloc, path, url.query, ''))


class WikiImages(HTMLParser):
    def __init__(self, kind):
        super().__init__()
        self.kind = kind
        self.icons = {}

    def handle_starttag(self, tag, attrs):
        if tag != 'img':
            return
        attributes = dict(attrs)
        url = original_image(attributes.get('src', ''))
        if not url:
            return
        name = self.image_name(attributes.get('alt', ''), url)
        if name:
            # The current catalog precedes patch history and older ranked seasons.
            self.icons.setdefault(normalized(name), {'name': name, 'url': url})

    def image_name(self, alt, url):
        filename = unquote(urlsplit(url).path.rsplit('/', 1)[1])
        if self.kind == 'rank':
            match = re.fullmatch(r'Crest: ([A-Za-z]+)', alt)
            return match[1] if match and match[1].upper() in RANKS else None
        if filename.endswith('_rune.png') and alt.startswith('An icon representing '):
            return alt.removeprefix('An icon representing ')
        if filename.endswith('_icon.png') and filename.removesuffix('_icon.png') in STYLES:
            return filename.removesuffix('_icon.png')
        if filename.startswith('Rune_shard_'):
            return filename.removeprefix('Rune_shard_').removesuffix('.png').replace('_', ' ')
        return None


def wiki_index(page, kind):
    parser = WikiImages(kind)
    parser.feed(page)
    return parser.icons


def rune_records(names, index):
    result = {}
    for identifier, translations in names.items():
        name = translations['en']
        match = index.get(normalized(SHARD_NAMES.get(identifier, name)))
        if not match:
            raise ValueError(f'Missing wiki rune: {identifier} {name}')
        result[identifier] = {'id': identifier, 'name': name, **match,
                              'provider': 'League of Legends Wiki', 'pageUrl': PAGES['rune']}
    return result


def rank_records(index):
    missing = [rank for rank in RANKS if normalized(rank) not in index]
    if missing:
        raise ValueError('Missing wiki rank crests: ' + ', '.join(missing))
    return {rank: {'id': rank, **index[normalized(rank)],
                   'provider': 'League of Legends Wiki', 'pageUrl': PAGES['rank']} for rank in RANKS}


def download(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'RiftReviewAssetSync/2.0'})
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def validate_rune_names(names):
    """Validate external ID-to-English-name metadata before fetching or writing."""
    if not isinstance(names, dict) or not names:
        raise ValueError('Rune names must be a nonempty JSON object')
    for identifier, name in names.items():
        if not isinstance(identifier, str) or not re.fullmatch(r'[1-9][0-9]{0,9}', identifier):
            raise ValueError('Rune IDs must be positive integer strings of at most 10 digits')
        if not isinstance(name, str) or not 1 <= len(name) <= 200 or not name.strip() or not name.isprintable():
            raise ValueError('Rune names must be nonempty printable strings of at most 200 characters')
    return {identifier: name.strip() for identifier, name in names.items()}


def existing_rune_names():
    source = (ROOT / 'public/game-assets.js').read_text()
    block = re.search(r'  "rune": \{(.*?)\n  \},', source, re.S)
    if not block:
        raise ValueError('Cannot read existing rune metadata')
    return json.loads('{' + re.sub(r',\s*$', '', block[1]) + '}')


def fetch_icon(task):
    kind, identifier, record = task
    data = download(record['url'])
    if not data.startswith(PNG):
        raise ValueError('Wiki did not return a PNG: ' + record['url'])
    return kind, identifier, {**record, 'sha256': hashlib.sha256(data).hexdigest()}, data


def sync(rune_page=None, rank_page=None, names=None):
    supplied = names if names is not None else {key: value['en'] for key, value in existing_rune_names().items()}
    rune_names = {key: {'en': name} for key, name in validate_rune_names(supplied).items()}
    pages = {kind: Path(path).read_text() if path else download(PAGES[kind]).decode('utf-8')
             for kind, path in [('rune', rune_page), ('rank', rank_page)]}
    groups = {'runes': rune_records(rune_names, wiki_index(pages['rune'], 'rune')),
              'ranks': rank_records(wiki_index(pages['rank'], 'rank'))}
    tasks = [(kind, identifier, record) for kind, records in groups.items() for identifier, record in records.items()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        downloaded = list(pool.map(fetch_icon, tasks))
    # Resolve and validate the entire batch before replacing any checked-in image.
    for kind, identifier, record, data in downloaded:
        directory = ROOT / 'public' / kind
        directory.mkdir(exist_ok=True)
        (directory / (identifier + '.png')).write_bytes(data)
    manifest = {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
                **{kind: {identifier: record for group, identifier, record, _ in downloaded if group == kind}
                   for kind in groups}}
    (ROOT / 'scripts/rune-rank-icon-sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Vendored {len(manifest['runes'])} rune PNGs and {len(manifest['ranks'])} rank PNGs from League Wiki.")
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rune-page', help='Optional saved Rune page HTML for reproducible resolution')
    parser.add_argument('--rank-page', help='Optional saved Rank page HTML for reproducible resolution')
    parser.add_argument('--rune-names', help='JSON object mapping positive rune IDs to fresh English names')
    args = parser.parse_args()
    names = validate_rune_names(json.loads(Path(args.rune_names).read_text())) if args.rune_names else None
    sync(args.rune_page, args.rank_page, names=names)
