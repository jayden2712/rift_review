"""Vendor pinned game icons. Run explicitly with Python 3; normal builds are offline."""
import concurrent.futures
import json
import hashlib
import importlib.util
import sys
from datetime import datetime, timezone
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = '16.18.1'
COMMIT = '6d4dd81a9fde8408d409f9b76b914b7485bd037e'
REPOSITORY = 'TheePepS/League_Of_Legends_Assets'
ROOT = Path(__file__).resolve().parents[1]
CDN = 'https://ddragon.leagueoflegends.com/cdn/'
PNG = b'\x89PNG\r\n\x1a\n'
sys.dont_write_bytecode = True
WIKI_SPEC = importlib.util.spec_from_file_location('wiki_items', ROOT / 'scripts/wiki-item-icons.py')
WIKI = importlib.util.module_from_spec(WIKI_SPEC)
WIKI_SPEC.loader.exec_module(WIKI)


def download(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'RiftReviewAssetSync/1.0'})
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def metadata(kind, locale):
    return json.loads(download(f'{CDN}{VERSION}/data/{locale}/{kind}.json'))


def slug(value):
    return re.sub('[^a-z0-9]', '', value.lower())


def upstream_index(tree, folder):
    return {slug(Path(entry['path']).stem): entry['path'] for entry in tree
            if entry['type'] == 'blob' and entry['path'].startswith(folder + '/')}


def icon_record(kind, identifier, name, english, fallback, index):
    upstream = index.get(slug(english))
    source = (f'https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT}/' +
              urllib.parse.quote(upstream) if upstream else fallback)
    return {'kind': kind, 'id': str(identifier), 'name': name, 'url': source,
            'fallback': fallback, 'repository': bool(upstream), 'english': english}


def flattened_runes(styles):
    return [rune for style in styles for rune in [style] + [
        rune for slot in style['slots'] for rune in slot['runes']]]


def records(tree, wiki):
    result = []
    for kind, file, folder in [('item', 'item', 'Items_assets'),
                                ('spell', 'summoner', 'Summoners_Spells_Assets')]:
        english = metadata(file, 'en_US')['data']
        vietnamese = metadata(file, 'vi_VN')['data']
        index = upstream_index(tree, folder)
        for key, item in english.items():
            if kind == 'item' and not item.get('maps', {}).get('11'):
                continue
            identifier = key if kind == 'item' else item['key']
            fallback = f"{CDN}{VERSION}/img/{kind}/{item['image']['full']}"
            record = icon_record(kind, identifier, vietnamese[key]['name'], item['name'], fallback, index)
            if kind == 'item':
                match = WIKI.lookup(wiki, identifier, item['name'])
                record = {**record, 'url': match['url'] if match else fallback, 'repository': False,
                          'provider': 'League of Legends Wiki' if match else 'Riot Data Dragon',
                          **({'wikiName': match['name']} if match else {'reason': 'No matching icon in wiki Item catalog'})}
            result.append(record)
    localized = {rune['id']: rune['name'] for rune in flattened_runes(metadata('runesReforged', 'vi_VN'))}
    index = upstream_index(tree, 'Runes_Assets')
    for rune in flattened_runes(metadata('runesReforged', 'en_US')):
        result.append(icon_record('rune', rune['id'], localized[rune['id']], rune['name'],
                                  CDN + 'img/' + rune['icon'], index))
    # Stat shards are not included in Data Dragon's runesReforged.json.
    shards = {
        5001: ('Máu theo cấp', 'StatModsHealthScalingIcon'),
        5002: ('Giáp (cũ)', 'StatModsArmorIcon'),
        5003: ('Kháng phép (cũ)', 'StatModsMagicResIcon'),
        5005: ('Tốc độ đánh', 'StatModsAttackSpeedIcon'),
        5007: ('Điểm hồi kỹ năng', 'StatModsCDRScalingIcon'),
        5008: ('Sức mạnh thích ứng', 'StatModsAdaptiveForceIcon'),
        5010: ('Tốc độ di chuyển', 'StatModsMovementSpeedIcon'),
        5011: ('Máu', 'StatModsHealthPlusIcon'),
        5013: ('Kháng hiệu ứng và kháng làm chậm', 'StatModsTenacityIcon'),
    }
    shard_names = {5001: 'Scaling Health', 5002: 'Armor (legacy)', 5003: 'Magic Resist (legacy)',
                   5005: 'Attack Speed', 5007: 'Ability Haste', 5008: 'Adaptive Force',
                   5010: 'Movement Speed', 5011: 'Health', 5013: 'Tenacity and Slow Resist'}
    for identifier, (name, filename) in shards.items():
        result.append(icon_record('rune', identifier, name, shard_names[identifier],
                                  CDN + 'img/perk-images/StatMods/' + filename + '.png', {}))
    for entry in tree:
        if entry['type'] == 'blob' and entry['path'].startswith('Ranks_Icons_Assets/'):
            name = Path(entry['path']).stem.removesuffix('_Icon')
            record = icon_record('rank', name.upper(), name, name + ' Icon', None,
                                 upstream_index(tree, 'Ranks_Icons_Assets'))
            result.append({**record, 'english': name})
    return result


def save(record):
    filename = ROOT / 'public' / (record['kind'] + 's') / (record['id'] + '.png')
    filename.parent.mkdir(exist_ok=True)
    # Updating items must not replace existing champion, rune, spell or rank artwork.
    if record['kind'] != 'item' and filename.exists():
        return record
    data = download(record['url'])
    if not data.startswith(PNG):
        raise ValueError('Not a PNG: ' + record['url'])
    filename.write_bytes(data)
    return {**record, 'sha256': hashlib.sha256(data).hexdigest()}


def write_module(completed):
    maps = {kind: {a['id']: {'vi': a['name'], 'en': a['english']}
                   for a in completed if a['kind'] == kind}
            for kind in ['item', 'spell', 'rune', 'rank']}
    module = f'// Generated by scripts/sync-game-assets.py; Data Dragon {VERSION}.\n'
    module += '// Item icon sources: scripts/item-icon-sources.json. Other icons retain their existing sources.\n'
    module += 'const names = {\n'
    for kind, entries in maps.items():
        module += '  ' + json.dumps(kind) + ': {\n'
        module += ''.join('    ' + json.dumps(identifier) + ': ' +
                          json.dumps(names, ensure_ascii=False) + ',\n'
                          for identifier, names in entries.items())
        module += '  },\n'
    module += '};\n'
    module += """
const assets = Object.freeze(Object.fromEntries(['vi', 'en'].map(locale => [
  locale, Object.freeze(Object.fromEntries(Object.entries(names).map(([kind, entries]) => [
    kind, Object.freeze(Object.fromEntries(Object.entries(entries).map(([id, translated]) => [
      id, Object.freeze({name: translated[locale], src: '/' + kind + 's/' + id + '.png'}),
    ]))),
  ]))),
])));

export function gameAsset(kind, id, language = 'vi') {
  const localized = assets[language === 'en' ? 'en' : 'vi'];
  if (!Object.hasOwn(localized, kind) || !['number', 'string'].includes(typeof id)) return null;
  const key = kind === 'rank' ? String(id).toUpperCase() : String(id);
  return Object.hasOwn(localized[kind], key) ? localized[kind][key] : null;
}
"""
    (ROOT / 'public/game-assets.js').write_text(module)


def main():
    wiki = WIKI.item_index(download(WIKI.PAGE).decode('utf-8'))
    tree = json.loads(download(f'https://api.github.com/repos/{REPOSITORY}/git/trees/{COMMIT}?recursive=1'))['tree']
    assets = records(tree, wiki)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        completed = list(pool.map(save, assets))
    write_module(completed)
    items = {a['id']: {key: a[key] for key in ['english', 'url', 'provider', 'sha256', 'reason', 'wikiName'] if key in a}
             for a in completed if a['kind'] == 'item'}
    manifest = {'metadataVersion': VERSION, 'page': WIKI.PAGE,
                'retrievedAt': datetime.now(timezone.utc).isoformat(), 'items': items}
    (ROOT / 'scripts/item-icon-sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('Item icons:', {provider: sum(a['provider'] == provider for a in items.values())
                          for provider in ['League of Legends Wiki', 'Riot Data Dragon']})


if __name__ == '__main__':
    main()
