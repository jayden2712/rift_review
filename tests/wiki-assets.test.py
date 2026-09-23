import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('wiki', Path(__file__).resolve().parents[1] / 'scripts/wiki-item-icons.py')
wiki = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wiki)


class WikiIconsTests(unittest.TestCase):
    def test_original_image_preserves_current_revision(self):
        self.assertEqual(wiki.original_image('/en-us/images/thumb/Boots_item.png/40px-Boots_item.png?abc'),
                         'https://wiki.leagueoflegends.com/en-us/images/Boots_item.png?abc')
        self.assertIsNone(wiki.original_image('/en-us/images/Boots.svg'))
        with self.assertRaises(ValueError):
            wiki.original_image('https://example.com/Boots_item.png')

    def test_selects_lol_catalog_images_and_retains_first_match(self):
        parser = wiki.ItemImages()
        parser.feed('''<div class="item-icon" data-game="lol" data-item="Boots"><img src="/en-us/images/Boots_item.png?abc"></div>
        <div class="item-icon" data-game="lol" data-item="Boots"><img src="/en-us/images/Boots_old_item.png?old"></div>
        <div class="item-icon" data-game="tft" data-item="Armor"><img src="/en-us/images/Armor_item.png"></div>''')
        self.assertEqual(len(parser.icons), 1)
        self.assertTrue(wiki.lookup(parser.icons, '1001', 'Boots')['url'].endswith('Boots_item.png?abc'))

    def test_aliases_and_case_match_without_guessing_other_items(self):
        index = {wiki.normalized('Slightly Magical Boots'): {'url': 'boots'},
                 wiki.normalized('Blade of the Ruined King'): {'url': 'blade'}}
        self.assertEqual(wiki.lookup(index, '2422', 'Slightly Magical Footwear')['url'], 'boots')
        self.assertEqual(wiki.lookup(index, '3153', 'Blade of The Ruined King')['url'], 'blade')
        self.assertIsNone(wiki.lookup(index, '123', 'Unknown Item'))

    def test_stops_on_unexpected_html_or_challenge(self):
        with self.assertRaises(ValueError):
            wiki.item_index('<html>Access denied</html>')


if __name__ == '__main__':
    unittest.main()
