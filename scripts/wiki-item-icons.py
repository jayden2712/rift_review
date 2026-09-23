"""Read the wiki's public Item page; never guess filenames or use historical images."""
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

PAGE = 'https://wiki.leagueoflegends.com/en-us/Item'
ALIASES = {
    '2422': 'Slightly Magical Boots',
    '3599': 'Black Spear', '3600': 'Black Spear',
    '3901': 'Fire at Will', '3902': "Death's Daughter", '3903': 'Raise Morale',
}


def normalized(name):
    return re.sub('[^a-z0-9]', '', name.lower())


def original_image(src):
    url = urlsplit(urljoin(PAGE, src))
    if url.scheme != 'https' or url.netloc != 'wiki.leagueoflegends.com':
        raise ValueError('Unexpected wiki image host')
    path = url.path
    if path.startswith('/en-us/images/thumb/'):
        path = '/en-us/images/' + path.split('/')[4]
    if not re.fullmatch(r'/en-us/images/[^/]+\.png', path):
        return None
    return urlunsplit((url.scheme, url.netloc, path, url.query, ''))


class ItemImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.icons = {}

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'div' and attributes.get('class') == 'item-icon':
            self.current = attributes.get('data-item') if attributes.get('data-game') == 'lol' else None
        if tag == 'img' and self.current:
            name = self.current
            self.current = None
            url = original_image(attributes.get('src', ''))
            if url:
                # First occurrence is the catalog entry; do not replace with later variants.
                self.icons.setdefault(normalized(name), {'name': name, 'url': url})


def item_index(page):
    parser = ItemImages()
    parser.feed(page)
    if len(parser.icons) < 100:
        raise ValueError('Wiki did not return the expected item catalog; stopping import')
    return parser.icons


def lookup(index, identifier, name):
    return index.get(normalized(ALIASES.get(str(identifier), name)))
