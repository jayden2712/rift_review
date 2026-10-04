"""Regression checks for current rune/rank selection and image URL validation."""
import importlib.util
import sys
import unittest
import tempfile
from unittest.mock import patch
from pathlib import Path

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('wiki_runes_ranks', Path(__file__).resolve().parents[1] / 'scripts/sync-wiki-runes-ranks.py')
WIKI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WIKI)


class WikiRuneRankTests(unittest.TestCase):
    def test_rune_styles_shards_and_punctuation_use_observed_urls(self):
        page = '''<img src="/en-us/images/thumb/Precision_icon.png/52px-Precision_icon.png?v1">
          <img alt="An icon representing Legend: Alacrity" src="/en-us/images/thumb/Legend-_Alacrity_rune.png/52px-Legend-_Alacrity_rune.png?v2">
          <img src="/en-us/images/Rune_shard_Health_Scaling.png?v3">
          <img src="/en-us/images/thumb/Rune_shard_Magic_Resistance.png/20px-Rune_shard_Magic_Resistance.png?v4">'''
        icons = WIKI.wiki_index(page, 'rune')
        self.assertTrue(icons['precision']['url'].endswith('/Precision_icon.png?v1'))
        self.assertTrue(icons['legendalacrity']['url'].endswith('/Legend-_Alacrity_rune.png?v2'))
        self.assertIn('healthscaling', icons)
        self.assertIn('magicresistance', icons)

    def test_first_current_crest_wins_over_later_historical_and_banner_icons(self):
        page = '''<img alt="Crest: Emerald" src="/en-us/images/thumb/Season_2023_-_Emerald.png/120px-Season_2023_-_Emerald.png?v1">
          <img alt="Crest: Gold" src="/en-us/images/Season_2023_-_Gold.png?v1">
          <img alt="Crest: Gold" src="/en-us/images/Season_2022_-_Gold.png?v2">
          <img alt="Banner: Gold" src="/en-us/images/Gold_Banner.png?v3">'''
        icons = WIKI.wiki_index(page, 'rank')
        self.assertEqual(set(icons), {'emerald', 'gold'})
        self.assertIn('Season_2023_-_Gold', icons['gold']['url'])

    def test_rejects_untrusted_and_encoded_traversal_image_urls(self):
        for url in ['https://evil.test/en-us/images/A.png', '//evil.test/A.png',
                    '/en-us/images/%2e%2e%2fA.png', '/en-us/images/A.svg',
                    '/en-us/images/thumb/A.png/40px-Other.png']:
            with self.subTest(url=url):
                self.assertIsNone(WIKI.original_image(url))

    def test_rune_name_metadata_rejects_invalid_ids_and_names_before_network(self):
        invalid = [None, [], {}, {'0': 'Rune'}, {'-1': 'Rune'}, {'01': 'Rune'},
                   {'../1': 'Rune'}, {1: 'Rune'}, {'1': ''}, {'1': '   '},
                   {'1': 123}, {'1': 'x' * 201}, {'1': 'Rune\nInjected'}]
        for names in invalid:
            with self.subTest(names=names), self.assertRaises(ValueError):
                WIKI.validate_rune_names(names)
        with patch.object(WIKI, 'download') as download:
            with self.assertRaises(ValueError):
                WIKI.sync(names={'../1': 'Rune'})
            download.assert_not_called()

    def test_fresh_metadata_adds_new_rune_without_reading_previous_module(self):
        rune_page = '<img alt="An icon representing Brand New Rune" src="/en-us/images/Brand_New_Rune_rune.png?v1">'
        rank_page = ''.join(f'<img alt="Crest: {rank.title()}" src="/en-us/images/{rank}.png?v1">' for rank in WIKI.RANKS)
        def download(url):
            if url == WIKI.PAGES['rune']:
                return rune_page.encode()
            if url == WIKI.PAGES['rank']:
                return rank_page.encode()
            return WIKI.PNG + b'fixture'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'public').mkdir()
            (root / 'scripts').mkdir()
            with patch.object(WIKI, 'ROOT', root), patch.object(WIKI, 'download', side_effect=download), \
                 patch.object(WIKI, 'existing_rune_names', side_effect=AssertionError('stale metadata')):
                manifest = WIKI.sync(names={'99999': 'Brand New Rune'})
            self.assertEqual(set(manifest['runes']), {'99999'})
            self.assertEqual(manifest['runes']['99999']['name'], 'Brand New Rune')
            self.assertEqual((root / 'public/runes/99999.png').read_bytes(), WIKI.PNG + b'fixture')

    def test_missing_rune_is_an_error_and_never_reuses_old_asset(self):
        with self.assertRaisesRegex(ValueError, 'Missing wiki rune'):
            WIKI.rune_records({'9999': {'en': 'Missing'}}, {})


if __name__ == '__main__':
    unittest.main()
