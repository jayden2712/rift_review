import importlib.util
import json
from pathlib import Path
import hashlib
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('wiki_champions', ROOT / 'scripts/sync-wiki-champions.py')
wiki = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wiki)


class ChampionWikiTests(unittest.TestCase):
    def test_catalog_uses_actual_square_urls_and_display_name(self):
        html = '''<img alt="An icon representing Nunu &amp; Willump" width="42"
          src="/en-us/images/thumb/Nunu_OriginalSquare.png/42px-Nunu_OriginalSquare.png?abc12">
          <img alt="An icon representing Removed" width="20"
          src="/en-us/images/thumb/Removed_OriginalSquare.png/20px-Removed_OriginalSquare.png?12345">'''
        self.assertEqual(wiki.champion_index(html, minimum=1), {
            'nunuwillump': {'wikiName': 'Nunu & Willump', 'url':
                'https://wiki.leagueoflegends.com/en-us/images/Nunu_OriginalSquare.png?abc12'}})

    def test_rejects_external_historical_and_invalid_catalog_images(self):
        for src in ['https://example.com/en-us/images/Ahri_OriginalSquare.png',
                    '/en-us/images/Ahri_OriginalSquare_Old.png', '/en-us/images/Ahri_OriginalSquare.png/secret']:
            html = '<img alt="An icon representing Ahri" width="42" src="' + src + '">'
            with self.assertRaises(ValueError):
                wiki.champion_index(html, minimum=1)

    def test_manifest_matches_all_bundled_bytes(self):
        manifest = json.loads((ROOT / 'scripts/champion-icon-sources.json').read_text())
        files = {p.stem: p for p in (ROOT / 'public/champions').glob('*.png')}
        self.assertEqual(set(files), set(manifest['champions']))
        for slug, entry in manifest['champions'].items():
            self.assertEqual(entry['provider'], 'League of Legends Wiki')
            self.assertTrue(entry['url'].startswith(wiki.HOST + '/en-us/images/'))
            self.assertTrue(entry['url'].split('?')[0].endswith('_OriginalSquare.png'))
            self.assertEqual(hashlib.sha256(files[slug].read_bytes()).hexdigest(), entry['sha256'])
            wiki.validate_png(files[slug].read_bytes())


if __name__ == '__main__':
    unittest.main()
