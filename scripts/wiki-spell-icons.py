"""Discover spell artwork from the current Wiki catalog, preserving revision URLs."""
import importlib.util
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote,urlsplit

PAGE = 'https://wiki.leagueoflegends.com/en-us/Summoner_spell'
spec = importlib.util.spec_from_file_location('wiki_items', Path(__file__).with_name('wiki-item-icons.py'))
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)
ALIASES = {'30': 'Legend of the Poro King#To The King!',
           '31': 'Legend of the Poro King#Poro Toss / Poro Dash', '2201': 'Flee (Arena)',
           '55': 'filename:Placeholder_and_Attack-Smite'}


class SpellImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons = {}

    def handle_starttag(self, tag, attrs):
        if tag != 'img':
            return
        attrs = dict(attrs)
        src = attrs.get('src', '')
        if '/en-us/images/' not in src:
            return
        url = images.original_image(src)
        if not url:
            return
        alt = attrs.get('alt', '')
        filename = unquote(Path(urlsplit(url).path).stem)
        if any(word in filename.lower() for word in ['_old', '_historical', '_2010', '_2011']):
            return
        record = {'name': alt.removeprefix('An icon representing '), 'url': url}
        self.icons.setdefault(images.normalized('filename:' + filename), record)
        if alt.startswith('An icon representing ') and not alt.startswith('An icon representing the keyword '):
            # Current catalog precedes historical references; later variants cannot replace it.
            self.icons.setdefault(images.normalized(record['name']), record)


def spell_index(html):
    parser = SpellImages()
    parser.feed(html)
    for name in ['Flash', 'Teleport', 'Ignite', 'Smite', 'Heal', 'Cleanse', 'Barrier', 'Exhaust', 'Ghost', 'Mark']:
        if images.normalized(name) not in parser.icons:
            raise ValueError('Wiki did not return the expected summoner spell catalog')
    return parser.icons


def lookup(index, identifier, name):
    return index.get(images.normalized(ALIASES.get(str(identifier), name)))
